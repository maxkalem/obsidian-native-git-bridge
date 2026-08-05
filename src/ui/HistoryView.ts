import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type { RepoLogEntry, RepoLogFile } from "../git/historyParsers";
import { buildPathTree, type PathTreeNode } from "./pathTree";

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
  /** Shared preference: render each commit's files as a folder tree. */
  treeView(): boolean;
  /** Flip the shared tree/list preference. */
  toggleTree(): void;
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
    await this.loadMore();
  }

  /** Redraw from the already-loaded commits (layout toggles; no round trip). */
  rerender(): void {
    this.renderShell();
    for (const e of this.entries) this.renderCommit(e);
    if (this.moreBtn && this.entries.length > 0 && !this.exhausted) this.moreBtn.show();
  }

  private renderShell(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view");
    const bar = c.createDiv({ cls: "ngb-sv-toolbar" });
    const refreshBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    refreshBtn.setAttribute("aria-label", "Refresh history");
    setIcon(refreshBtn, "refresh-cw");
    if (this.loading) refreshBtn.addClass("ngb-anim-spin", "ngb-sv-icon-active");
    refreshBtn.addEventListener("click", () => void this.refresh());
    // Same tree/list toggle as the status panel: icon = CURRENT layout.
    const treeBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    const treeOn = this.actions.treeView();
    treeBtn.setAttribute("aria-label", treeOn ? "Tree layout (tap for list)" : "List layout (tap for tree)");
    setIcon(treeBtn, treeOn ? "folder-tree" : "list");
    treeBtn.addEventListener("click", () => this.actions.toggleTree());
    this.listEl = c.createDiv({ cls: "ngb-hist-list" });
    const btns = c.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }

  private async loadMore(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    if (this.moreBtn) {
      this.moreBtn.disabled = true;
      this.moreBtn.setText("Loading…");
    }
    const page = await this.actions.loadPage(this.skip, this.pageSize);
    this.loading = false;
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
    header.createSpan({ cls: "ngb-badge", text: String(e.files.length) });
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
    main.createSpan({ cls: "ngb-badge", text: String(node.count) });
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
    row.createSpan({ cls: "ngb-sv-file-code" });
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
