import { ItemView, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import type { RepoLogEntry, RepoLogFile } from "../git/historyParsers";
import { buildPathTree, type PathTreeNode } from "./pathTree";
import { renderCountBadge } from "./countBadge";
import { describeMove, revealOnTap } from "./revealOnTap";
import { attachContextMenu } from "./contextMenu";

export const NGB_HISTORY_VIEW = "native-git-bridge-history";
/** One icon for the panel AND the strip button that opens it. */
export const NGB_HISTORY_ICON = "history";

export interface HistoryViewActions {
  /** Page of repository commits; null when the operation failed (error already shown). */
  loadPage(skip: number, limit: number): Promise<RepoLogEntry[] | null>;
  /** Open the diff this commit introduced for one file, in an Obsidian pane. */
  openDiffAtCommit(file: RepoLogFile, entry: RepoLogEntry): void;
  /** Open the file itself (current working-tree version). */
  openFile(path: string): void;
  /**
   * The file-at-commit context menu (long press / right click on a file row):
   * restore from this commit, view as of it, its diff, file history, copy.
   * The file-history panel's rows answer the same questions; this is what
   * keeps the two surfaces from answering differently (open item 10).
   */
  fileMenu(file: RepoLogFile, entry: RepoLogEntry, pos: { x: number; y: number }): void;
  /** Progress line of the operation in flight ("" when idle), for the wait indicator. */
  progressText(): string;
  /** What the runner said it is doing, for the reserved detail line. */
  progressDetail(): string;
  /** Shared preference: render each commit's files as a folder tree. */
  treeView(): boolean;
  /** Flip the shared tree/list preference. */
  toggleTree(): void;
  /** Open (or focus) the status panel; the mirror of its "history" button. */
  openStatusPanel(): void;
  /** Open the live output panel — the state line answers here, as everywhere. */
  openOutput(): void;
  /**
   * Device-local row budget, the same number the status panel uses.
   *
   * A commit that touched 2400 files drew 2400 rows here, which is the cost the
   * status panel got a budget for — and it is worse in this panel, because
   * several commits can be expanded at once.
   */
  rowsPerGroup(): number;
}

/**
 * Repository-wide history panel (obsidian-git style): a list of commits, each
 * expandable to its changed files; tapping a file opens the diff that commit
 * introduced for it. Data comes from ONE `repo-log` round trip per page — the
 * name-status block rides along with every commit, so expanding is free.
 */
export class HistoryView extends ItemView {
  private entries: RepoLogEntry[] = [];
  private skip = 0;
  private readonly pageSize = 30;
  private exhausted = false;
  private loading = false;
  private expanded = new Set<string>();
  /** Collapsed folder nodes in tree layout, keyed "<hash>:<folderPath>". */
  private collapsedDirs = new Set<string>();
  /**
   * Rows the user asked to see past the budget, per commit hash. Not persisted:
   * it is an allowance for this session, like the status panel's.
   */
  private extraRows = new Map<string, number>();
  private listEl: HTMLElement | null = null;
  private moreBtn: HTMLButtonElement | null = null;
  /** The scrolling middle of the panel; the head and the bottom bar do not move. */
  private bodyEl: HTMLElement | null = null;
  /** Scroll offset carried across shell rebuilds (layout toggle, re-render). */
  private savedScroll = 0;
  /** State line in the strip, mirroring the status panel's. */
  private progressEl: HTMLElement | null = null;
  private progressDetailEl: HTMLElement | null = null;
  /**
   * The refresh button, kept so its animation can follow `loading`.
   *
   * It used to be decided once, inside `renderShell`, from a flag that
   * `loadMore` sets afterwards — so the button never span at all, no matter how
   * long the runner took.
   */
  private refreshBtn: HTMLElement | null = null;
  /**
   * Interval behind the in-list wait indicator. One per load, cleared when the
   * load ends: `registerInterval` ties an interval to the VIEW's lifetime, so
   * without this every refresh left another timer ticking into a detached node
   * until the panel was closed.
   */
  private waitTicker: number | null = null;
  /**
   * Bumped by every `refresh()`. A load carries the epoch it started under, so
   * a page that arrives after a refresh can tell that it belongs to a list
   * which no longer exists and drop itself.
   */
  private loadEpoch = 0;
  /**
   * A refresh asked for while a request was in flight, to be run when that
   * request answers. Two requests are never in flight at once: the panel has
   * one operation lock behind it, and a scope change in the branch graph has
   * to obey the same rule.
   */
  private refreshQueued = false;
  /** The in-list wait indicator while one is showing; see `startWaiting`. */
  private waitingEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private actions: HistoryViewActions) {
    super(leaf);
  }

  getViewType(): string {
    return NGB_HISTORY_VIEW;
  }
  getDisplayText(): string {
    return "Native Git history";
  }
  getIcon(): string {
    return NGB_HISTORY_ICON;
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    await this.refresh();
  }

  /** Reload from the first page (also wired to external refreshes). */
  async refresh(): Promise<void> {
    this.loadEpoch += 1;
    this.entries = [];
    this.skip = 0;
    this.exhausted = false;
    // renderShell rebuilds the list, so the indicator element goes with it.
    this.waitingEl = null;
    this.renderShell();
    // AFTER renderShell, which is what captures the current offset. Setting it
    // before was dead code. A reload starts at the newest commit; carrying the
    // old offset over would drop the user into the middle of a list they asked
    // to rebuild.
    this.savedScroll = 0;
    if (this.loading) {
      // A request is already in flight. Racing a second one against it is the
      // thing to avoid; its answer describes the list this refresh just threw
      // away, so let it finish, let it discard itself, and reload after it.
      //
      // Show the indicator straight away. Without it the list is empty and
      // silent for the rest of the request in flight, which reads as a panel
      // that gave up rather than one that is waiting its turn.
      this.refreshQueued = true;
      this.startWaiting();
      return;
    }
    await this.loadMore();
  }

  /** Redraw from the already-loaded commits (layout toggles; no round trip). */
  rerender(): void {
    this.renderShell();
    for (const e of this.entries) this.renderCommit(e);
    if (this.moreBtn && this.entries.length > 0 && !this.exhausted) this.moreBtn.show();
    this.restoreScroll();
  }

  private renderShell(): void {
    const c = this.contentEl;
    this.savedScroll = this.bodyEl?.scrollTop ?? this.savedScroll;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view");
    // The same three regions, in the same places, as the status panel: a fixed
    // head, a scrolling commit list, and a fixed bottom bar. Two panels that
    // sit side by side in the same sidebar must not put the same control in
    // two different corners, so refresh lands where the status panel's refresh
    // lands, and the layout toggle lands where its layout toggle lands.
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    const footBar = c.createDiv({ cls: "ngb-sv-footbar" });
    this.bodyEl = body;
    const mobile = Platform.isPhone;

    const bar = (mobile ? footBar : headEl).createDiv({ cls: "ngb-sv-toolbar" });
    const refreshBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    refreshBtn.setAttribute("aria-label", "Refresh history");
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => void this.refresh());
    this.refreshBtn = refreshBtn;

    // The strip mirrors the status panel's: state on the left, the two view
    // controls on the right.
    const strip = headEl.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    this.progressEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    // The state line opens the output panel here exactly as it does in the
    // status panel: one state, one answer, whichever panel the finger is on.
    this.progressEl.addClass("ngb-sv-progress-tap");
    this.progressEl.setAttribute("aria-label", "Show what Termux is doing");
    this.progressEl.addEventListener("click", () => this.actions.openOutput());
    const stripRight = strip.createDiv({ cls: "ngb-sv-strip-right" });
    // Same tree/list toggle as the status panel: icon = CURRENT layout.
    const treeBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    const treeOn = this.actions.treeView();
    treeBtn.setAttribute("aria-label", treeOn ? "Tree layout (tap for list)" : "List layout (tap for tree)");
    setIcon(treeBtn, treeOn ? "folder-tree" : "list");
    treeBtn.addEventListener("click", () => this.actions.toggleTree());
    // The counterpart of the status panel's history button, in the same slot:
    // the two panels open each other from the same corner.
    const statusBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    statusBtn.setAttribute("aria-label", "Git panel");
    setIcon(statusBtn, "git-branch");
    statusBtn.addEventListener("click", () => this.actions.openStatusPanel());
    // Reserved even when empty (CSS keeps the height), mirroring the status
    // panel: the list below must not jump when the runner starts talking.
    this.progressDetailEl = headEl.createDiv({ cls: "ngb-sv-progress-detail ngb-sv-progress-tap" });
    this.progressDetailEl.setAttribute("aria-label", "Show what Termux is doing");
    this.progressDetailEl.addEventListener("click", () => this.actions.openOutput());
    this.applyLoadingState();

    this.listEl = body.createDiv({ cls: "ngb-hist-list" });
    // "Load more" belongs after the commits, inside the scrolled region: it is
    // the end of the list, not a panel control.
    const btns = body.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }

  /**
   * The strip's state line and the refresh animation, both driven by `loading`.
   *
   * Called whenever `loading` changes rather than only at render time. An
   * indicator that keeps moving after the work stopped is worse than no
   * indicator: it says the runner is busy when it is not. The same rule applies
   * to a refused operation, where the animation must never start.
   *
   * "Idle" is the word the status panel uses, so the two panels do not describe
   * the same condition differently.
   */
  private applyLoadingState(): void {
    if (this.refreshBtn) {
      this.refreshBtn.toggleClass("ngb-anim-spin", this.loading);
      this.refreshBtn.toggleClass("ngb-sv-icon-active", this.loading);
    }
    if (!this.progressEl) return;
    const p = this.actions.progressText();
    const running = this.loading || p !== "";
    this.progressEl.toggleClass("ngb-sv-progress-idle", !running);
    this.progressEl.setText(this.loading ? "Loading history…" : p !== "" ? p : "Idle");
    // Only while the plugin's own operation runs: this panel's page loads have
    // no stream of their own, and a stale line under "Idle" reads as running.
    if (this.progressDetailEl) {
      this.progressDetailEl.setText(p !== "" ? this.actions.progressDetail() : "");
    }
  }

  /**
   * The plugin's per-second tick. The state line reads `progressText()` only
   * when something re-renders it, so without this call the copy shown here
   * froze at whatever second the panel last drew itself.
   */
  updatePluginProgress(): void {
    this.applyLoadingState();
  }

  /**
   * Put the list back where it was. Called AFTER the commits are re-added:
   * setting scrollTop on a container that is still empty is a no-op, which is
   * how the layout toggle used to jump back to the newest commit.
   */
  private restoreScroll(): void {
    if (this.bodyEl && this.savedScroll > 0) this.bodyEl.scrollTop = this.savedScroll;
  }

  private async loadMore(): Promise<void> {
    if (this.loading) return;
    const epoch = this.loadEpoch;
    this.loading = true;
    this.applyLoadingState();
    if (this.moreBtn) {
      this.moreBtn.disabled = true;
      this.moreBtn.setText("Loading…");
    }
    // The FIRST page hides the Load-more button, so without this the panel is
    // simply blank while the runner works. Same indicator as the other panels.
    const ticker = this.skip === 0 ? this.startWaiting() : null;
    const page = await this.actions.loadPage(this.skip, this.pageSize);
    this.loading = false;
    if (epoch !== this.loadEpoch) {
      // `refresh()` rebuilt the list while this request was out. The page
      // describes the old list: appending it would show the state from BEFORE
      // the refresh as its result, and would advance `skip` by a length that
      // belongs to a different list. Drop it, and run the refresh that waited.
      //
      // The indicator stays up: `refresh()` put a fresh one in the rebuilt
      // list, and the reload below takes it over rather than replacing it.
      if (this.refreshQueued) {
        this.refreshQueued = false;
        await this.loadMore();
      } else {
        this.stopWaiting(ticker);
        this.applyLoadingState();
      }
      return;
    }
    this.stopWaiting(ticker);
    this.applyLoadingState();
    if (this.moreBtn) {
      this.moreBtn.disabled = false;
      this.moreBtn.setText("Load more");
      this.moreBtn.show();
    }
    if (page === null) return; // error already surfaced by the caller
    if (this.skip === 0 && page.length === 0) {
      this.listEl?.createEl("p", {
        cls: "ngb-settings-note",
        text: "No commits yet (or the repository is not reachable).",
      });
      this.moreBtn?.hide();
      return;
    }
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn?.hide();
    }
    this.entries.push(...page);
    this.skip += page.length;
    for (const e of page) this.renderCommit(e);
  }

  /**
   * The in-list wait indicator. One per panel, reused rather than duplicated:
   * a refresh that has to wait for a request in flight puts it there, and the
   * load that follows finds it already showing instead of adding a second.
   *
   * `refresh()` clears the field, because `renderShell` throws the element away
   * with the rest of the list.
   */
  private startWaiting(): number | null {
    if (!this.listEl) return null;
    if (this.waitingEl === null) {
      this.waitingEl = this.listEl.createDiv({ cls: "ngb-filehist-waiting" });
    }
    return this.renderWaiting(this.waitingEl, "Loading history");
  }

  /** Takes the indicator down, unless a later wait has taken it over. */
  private stopWaiting(id: number | null): void {
    if (id !== null && id !== this.waitTicker) return;
    this.waitingEl?.remove();
    this.waitingEl = null;
    this.stopWaitTicker(id);
  }

  /** "The runner is working" indicator, identical in all four panels. */
  private renderWaiting(el: HTMLElement, what: string): number | null {
    el.empty();
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    setIcon(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? `${what}…` : p);
    };
    tick();
    // Registered with the view AND remembered here. `registerInterval` only
    // guarantees the timer dies with the panel, which left one ticking per
    // refresh, each writing into a node that had already been removed.
    this.stopWaitTicker();
    this.waitTicker = this.registerInterval(window.setInterval(tick, 500));
    return this.waitTicker;
  }

  /**
   * With an id, stops only while that wait still owns the ticker. A request
   * that finishes must not clear the indicator a later one is using: that is
   * how the panel came to show a spinner with a frozen progress line.
   */
  private stopWaitTicker(id?: number | null): void {
    if (this.waitTicker === null) return;
    if (id !== undefined && id !== null && id !== this.waitTicker) return;
    window.clearInterval(this.waitTicker);
    this.waitTicker = null;
  }

  private renderCommit(e: RepoLogEntry): void {
    if (!this.listEl) return;
    const wrap = this.listEl.createDiv({ cls: "ngb-hist-commit" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header ngb-hist-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    const open = this.expanded.has(e.hash);
    setIcon(chevron, open ? "chevron-down" : "chevron-right");
    const titles = header.createDiv({ cls: "ngb-hist-titles" });
    titles.createDiv({ cls: "ngb-hist-subject", text: e.subject || "(no subject)" });
    titles.createDiv({
      cls: "ngb-settings-note ngb-hist-meta",
      text: `${e.hash.slice(0, 8)} · ${e.date.slice(0, 16).replace("T", " ")} · ${e.author}`,
    });
    renderCountBadge(header, e.files.length, (n) => `${n} files changed in ${e.hash.slice(0, 8)}`);
    const body = wrap.createDiv({ cls: "ngb-sv-list" });
    const renderBody = () => {
      body.empty();
      if (!this.expanded.has(e.hash)) return;
      // One page per commit, with the same budget the status panel uses and the
      // same control at the end of it. Drawing is what costs: a commit that
      // touched thousands of files froze this panel exactly as an untracked
      // folder of thousands froze that one, and here several commits can be
      // open at once.
      const budget = this.fileBudget(e.hash);
      let drawn = 0;
      const room = () => drawn < budget;
      const draw = (f: RepoLogFile, depth: number) => {
        if (!room()) return;
        drawn += 1;
        this.renderFile(body, f, e, depth);
      };
      if (this.actions.treeView()) {
        const tree = buildPathTree(e.files, (f) => f.path);
        for (const f of tree.rootItems) draw(f, 0);
        for (const n of tree.folders) drawn = this.renderFolderNode(body, n, e, 0, renderBody, drawn, budget);
      } else {
        for (const f of e.files) draw(f, 0);
      }
      if (e.files.length > drawn) this.renderMore(body, e, drawn, renderBody);
    };
    header.addEventListener("click", () => {
      if (this.expanded.has(e.hash)) this.expanded.delete(e.hash);
      else this.expanded.add(e.hash);
      setIcon(chevron, this.expanded.has(e.hash) ? "chevron-down" : "chevron-right");
      renderBody();
    });
    renderBody();
  }

  /** Collapsible folder row inside a commit's file tree. */
  /** Rows this commit may draw: the budget, plus anything the user asked for. */
  private fileBudget(hash: string): number {
    const page = Math.max(1, Math.floor(this.actions.rowsPerGroup()));
    return page + (this.extraRows.get(hash) ?? 0);
  }

  /**
   * "N of M shown", at the end of the commit's list.
   *
   * Placed where the list stops rather than in the header: the header already
   * carries the real total, and a control that explains a truncation belongs
   * where the truncation is visible.
   */
  private renderMore(
    body: HTMLElement,
    e: RepoLogEntry,
    shown: number,
    rerenderBody: () => void
  ): void {
    const row = body.createDiv({ cls: "ngb-sv-file ngb-sv-more-children" });
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    main.createSpan({
      cls: "ngb-settings-note",
      text: `${shown} of ${e.files.length} shown — tap for more`,
    });
    row.addEventListener("click", () => {
      const page = Math.max(1, Math.floor(this.actions.rowsPerGroup()));
      this.extraRows.set(e.hash, (this.extraRows.get(e.hash) ?? 0) + page);
      rerenderBody();
    });
  }

  private renderFolderNode(
    body: HTMLElement,
    node: PathTreeNode<RepoLogFile>,
    e: RepoLogEntry,
    depth: number,
    rerenderBody: () => void,
    drawn: number,
    budget: number
  ): number {
    const row = body.createDiv({ cls: `ngb-sv-file ngb-ind-${Math.min(depth, 6)}` });
    const key = `${e.hash}:${node.path}`;
    const collapsed = this.collapsedDirs.has(key);
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    const chev = main.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
    setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
    main.createSpan({ cls: "ngb-sv-file-name ngb-sv-folder-name", text: `${node.name}/` });
    main.addEventListener("click", () => {
      if (collapsed) this.collapsedDirs.delete(key);
      else this.collapsedDirs.add(key);
      rerenderBody();
    });
    // Same slot layout as the file rows below, so the go-to-file button and
    // the change-letter column line up across folders and files.
    const acts = row.createDiv({ cls: "ngb-sv-file-actions" });
    const spacer = acts.createEl("button", { cls: "clickable-icon ngb-sv-icon ngb-slot-inactive" });
    setIcon(spacer, "circle");
    spacer.setAttribute("aria-hidden", "true");
    spacer.tabIndex = -1;
    renderCountBadge(row, node.count, (n) => `${n} files in ${node.path}/`);
    if (collapsed) return drawn;
    for (const f of node.items) {
      if (drawn >= budget) return drawn;
      drawn += 1;
      this.renderFile(body, f, e, depth + 1);
    }
    for (const ch of node.children) {
      if (drawn >= budget) return drawn;
      drawn = this.renderFolderNode(body, ch, e, depth + 1, rerenderBody, drawn, budget);
    }
    return drawn;
  }

  private renderFile(body: HTMLElement, f: RepoLogFile, e: RepoLogEntry, depth: number): void {
    const row = body.createDiv({
      cls: depth === 0 ? "ngb-sv-file" : `ngb-sv-file ngb-ind-${Math.min(depth, 6)}`,
    });
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName(f.path) });
    name.setAttribute("aria-label", `${f.path} @ ${e.hash.slice(0, 8)}`);
    if (f.origPath) {
      // The NAME it came from, not the path: a rename inside a deep tree
      // otherwise printed six lines of directories into a row that has to stay
      // one line tall, and `text-overflow: ellipsis` cannot save a box that is
      // allowed to wrap. The whole path is one tap away, the same gesture a
      // clamped count uses, and it is in the aria-label either way.
      const from = main.createSpan({
        cls: "ngb-settings-note ngb-hist-rename",
        text: `← ${displayName(f.origPath)}`,
      });
      from.setAttribute("aria-label", `moved from ${f.origPath}`);
      revealOnTap(from, describeMove(f.origPath, f.path), { align: "left" });
    }
    // Tap on the row = the diff this commit introduced for the file, in a pane.
    main.addEventListener("click", () => this.actions.openDiffAtCommit(f, e));
    // Long press / right click = the file-at-commit menu.
    attachContextMenu(row, (pos) => this.actions.fileMenu(f, e, pos));
    const acts = row.createDiv({ cls: "ngb-sv-file-actions" });
    const openBtn = acts.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    openBtn.setAttribute("aria-label", "Open file (current version)");
    setIcon(openBtn, "go-to-file");
    openBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.actions.openFile(f.path);
    });
    const codeEl = row.createSpan({ cls: `ngb-sv-file-code ngb-code-${f.code}`, text: f.code });
    codeEl.setAttribute("aria-label", f.code);
  }

  /** Number of loaded commits (used by tests and diagnostics). */
  get loadedCount(): number {
    return this.entries.length;
  }
  get isExhausted(): boolean {
    return this.exhausted;
  }
}

/** Last path segment for display (same convention as the status panel). */
function displayName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
