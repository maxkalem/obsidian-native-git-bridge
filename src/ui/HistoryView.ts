import { ItemView, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import type { RepoLogEntry, RepoLogFile } from "../git/historyParsers";
import { buildPathTree, type PathTreeNode } from "./pathTree";
import { renderCountBadge } from "./countBadge";

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
  /** Progress line of the operation in flight ("" when idle), for the wait indicator. */
  progressText(): string;
  /** Shared preference: render each commit's files as a folder tree. */
  treeView(): boolean;
  /** Flip the shared tree/list preference. */
  toggleTree(): void;
  /** Open (or focus) the status panel; the mirror of its "history" button. */
  openStatusPanel(): void;
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
  private listEl: HTMLElement | null = null;
  private moreBtn: HTMLButtonElement | null = null;
  /** The scrolling middle of the panel; the head and the bottom bar do not move. */
  private bodyEl: HTMLElement | null = null;
  /** Scroll offset carried across shell rebuilds (layout toggle, re-render). */
  private savedScroll = 0;
  /** State line in the strip, mirroring the status panel's. */
  private progressEl: HTMLElement | null = null;
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
    this.entries = [];
    this.skip = 0;
    this.exhausted = false;
    this.renderShell();
    // AFTER renderShell, which is what captures the current offset. Setting it
    // before was dead code. A reload starts at the newest commit; carrying the
    // old offset over would drop the user into the middle of a list they asked
    // to rebuild.
    this.savedScroll = 0;
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
    this.applyLoadingState();
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
    this.loading = true;
    this.applyLoadingState();
    if (this.moreBtn) {
      this.moreBtn.disabled = true;
      this.moreBtn.setText("Loading…");
    }
    // The FIRST page hides the Load-more button, so without this the panel is
    // simply blank while the runner works. Same indicator as the other panels.
    const waiting = this.skip === 0 ? this.listEl?.createDiv({ cls: "ngb-filehist-waiting" }) : undefined;
    if (waiting) this.renderWaiting(waiting, "Loading history");
    const page = await this.actions.loadPage(this.skip, this.pageSize);
    waiting?.remove();
    this.stopWaitTicker();
    this.loading = false;
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

  /** "The runner is working" indicator, identical in all four panels. */
  private renderWaiting(el: HTMLElement, what: string): void {
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
  }

  private stopWaitTicker(): void {
    if (this.waitTicker !== null) {
      window.clearInterval(this.waitTicker);
      this.waitTicker = null;
    }
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
      if (this.actions.treeView()) {
        const tree = buildPathTree(e.files, (f) => f.path);
        for (const f of tree.rootItems) this.renderFile(body, f, e, 0);
        for (const n of tree.folders) this.renderFolderNode(body, n, e, 0, renderBody);
        return;
      }
      for (const f of e.files) this.renderFile(body, f, e, 0);
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
  private renderFolderNode(
    body: HTMLElement,
    node: PathTreeNode<RepoLogFile>,
    e: RepoLogEntry,
    depth: number,
    rerenderBody: () => void
  ): void {
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
    if (collapsed) return;
    for (const f of node.items) this.renderFile(body, f, e, depth + 1);
    for (const ch of node.children) this.renderFolderNode(body, ch, e, depth + 1, rerenderBody);
  }

  private renderFile(body: HTMLElement, f: RepoLogFile, e: RepoLogEntry, depth: number): void {
    const row = body.createDiv({
      cls: depth === 0 ? "ngb-sv-file" : `ngb-sv-file ngb-ind-${Math.min(depth, 6)}`,
    });
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName(f.path) });
    name.setAttribute("aria-label", `${f.path} @ ${e.hash.slice(0, 8)}`);
    if (f.origPath) {
      main.createSpan({ cls: "ngb-settings-note ngb-hist-rename", text: `← ${f.origPath}` });
    }
    // Tap on the row = the diff this commit introduced for the file, in a pane.
    main.addEventListener("click", () => this.actions.openDiffAtCommit(f, e));
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
