import { ItemView, Menu, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import type { GitFileEntry, GitStatusSummary, SparseStateSummary } from "../types";
import { buildPathTree, type PathTreeNode } from "./pathTree";
import {
  NGB_ICON_PULL,
  NGB_ICON_PUSH,
  NGB_ICON_STAGE_ALL,
  NGB_ICON_SYNC,
  NGB_ICON_UNSTAGE_ALL,
} from "./icons";
import { applySweepIcon } from "./animatedIcons";

export const NGB_STATUS_VIEW = "native-git-bridge-status";

export interface StatusViewData {
  state: string;
  branch?: string;
  ahead: number;
  behind: number;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  conflicted: GitFileEntry[];
  /**
   * Files inside fully untracked directories, keyed by the "dir/" entry in
   * `untracked` (v5+ runner). The folder row becomes a grouping control with
   * the files rendered as actionable child rows underneath it.
   */
  untrackedChildren?: Record<string, string[]>;
  sparse?: SparseStateSummary;
  activeOperation?: string;
  /** Progress line shown at the bottom while an operation runs. */
  progress?: string;
  /** Action currently running; its toolbar button is animated. */
  runningAction?: string;
  /**
   * Target of the running action when it is per-path (stage-file,
   * unstage-file, discard-file). Scopes the row animation to the acted file —
   * or, for a folder, to the folder row and its visible descendants — instead
   * of every row whose button happens to share the action name.
   */
  runningPath?: string;
  lastSyncAt?: string;
  fetchedAt?: string;
  bridge: string;
  /** Shared preference: render the file groups as a folder tree. */
  treeView?: boolean;
}

export interface StatusViewActions {
  refresh: () => void;
  sync: () => void;
  pull: () => void;
  push: () => void;
  fetch: () => void;
  commit: () => void;
  stageAll: () => void;
  unstageAll: () => void;
  /** Operation log (pane menu + settings; no strip button since the tree toggle took its slot). */
  openLog: () => void;
  /** Flip the shared tree/list preference (re-render arrives via setData). */
  toggleTree: () => void;
  /** Open the repository-wide history panel. */
  openHistory: () => void;
  /**
   * Group-scoped folder action: applies to every file under `folderPath`
   * that is IN this group's state (stage in Changes stages tracked changes
   * only; unstage on Staged unstages only what was staged; discard in
   * Untracked moves the new files to Obsidian's trash).
   */
  folderAction: (group: Group, folderPath: string, kind: "stage" | "unstage" | "discard") => void;
  cancel: () => void;
  openFile: (path: string) => void;
  /** Open the diff for a changed file in an Obsidian pane (HEAD → worktree). */
  openDiff: (path: string, group: Group) => void;
  /**
   * Open conflict resolution for a conflicted file: a resolution pane for
   * text files, or the Git context menu (keep ours/theirs, open in default
   * app) anchored at `pos` for files the pane cannot display.
   */
  openConflict: (path: string, pos: { x: number; y: number }) => void;
  stage: (path: string) => void;
  unstage: (path: string) => void;
  discard: (path: string) => void;
  /** Fill a context menu with the Git entries for this path (long press / right click). */
  fileMenu: (menu: Menu, path: string) => void;
}

export type Group = "conflicted" | "staged" | "unstaged" | "untracked";

const CHANGE_LABEL: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "conflicted",
  "?": "untracked",
};

/**
 * Source-control style panel: collapsible groups, per-file actions
 * (open / stage / unstage / discard) and the change type for each entry.
 * This is the primary status surface on mobile, where the status bar is hidden.
 */
export class StatusView extends ItemView {
  private data: StatusViewData | null = null;
  private progressEl: HTMLElement | null = null;
  private cancelBtn: HTMLElement | null = null;
  private collapsed: Record<Group, boolean> = {
    conflicted: false,
    staged: false,
    unstaged: false,
    untracked: true,
  };
  /**
   * Untracked folder rows the user collapsed. Folders start EXPANDED: the
   * whole point of listing their children is that a freshly created folder
   * must show the notes inside it as actionable rows.
   */
  private collapsedDirs = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private actions: StatusViewActions) {
    super(leaf);
  }

  getViewType(): string {
    return NGB_STATUS_VIEW;
  }
  getDisplayText(): string {
    return "Native Git";
  }
  getIcon(): string {
    return "git-branch";
  }

  setData(data: StatusViewData): void {
    this.data = data;
    this.render();
  }

  /**
   * Update only the elapsed-time text. A full re-render would recreate the
   * toolbar buttons every tick and restart their CSS animations from the first
   * frame, which made the activity animation look erratic.
   */
  updateProgressText(text: string | null): void {
    if (this.data) this.data.progress = text ?? undefined;
    if (this.progressEl && this.cancelBtn) {
      this.applyStripState(text, this.data?.activeOperation ?? null);
      return;
    }
    this.render();
  }

  /** Toggle the reserved cancel slot and the label without rebuilding the row. */
  private applyStripState(progress: string | null, activeOperation: string | null): void {
    const running = progress !== null && progress !== "";
    if (this.cancelBtn) {
      this.cancelBtn.toggleClass("ngb-slot-inactive", !running);
      this.cancelBtn.setAttribute("aria-disabled", running ? "false" : "true");
    }
    if (this.progressEl) {
      this.progressEl.toggleClass("ngb-sv-progress-idle", !running);
      this.progressEl.setText(
        running ? progress : activeOperation ? `${activeOperation} pending…` : "Idle"
      );
    }
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  onPaneMenu(menu: Menu): void {
    menu.addItem((item) =>
      item
        .setTitle("Native Git: operation log")
        .setIcon("file-clock")
        .onClick(() => this.actions.openLog())
    );
    menu.addItem((item) =>
      item
        .setTitle("Refresh status")
        .setIcon("refresh-cw")
        .onClick(() => this.actions.refresh())
    );
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view");
    const d = this.data;

    // --- toolbar: fixed order, animated while the matching action runs ---
    const bar = c.createDiv({ cls: "ngb-sv-toolbar" });
    const running = d?.runningAction;
    const iconBtn = (
      icon: string,
      tooltip: string,
      cb: () => void,
      actionName?: string,
      /** Activity animation: rotation is reserved for refresh. */
      anim: "spin" | "pulse" | "sweep-down" | "sweep-up" = "pulse"
    ) => {
      const b = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
      b.setAttribute("aria-label", tooltip);
      const active = Boolean(actionName) && running === actionName;
      if (active && (anim === "sweep-down" || anim === "sweep-up")) {
        // Travelling highlight along the button's OWN icon: downwards for
        // pull/fetch, upwards for push.
        applySweepIcon(b, icon, anim === "sweep-down" ? "down" : "up");
        b.addClass("ngb-sv-icon-active");
      } else {
        setIcon(b, icon);
        if (active) {
          b.addClass(`ngb-anim-${anim}`);
          b.addClass("ngb-sv-icon-active");
        }
      }
      b.addEventListener("click", cb);
    };
    iconBtn(NGB_ICON_SYNC, "Sync", this.actions.sync, "sync", "pulse");
    iconBtn("check", "Commit", this.actions.commit, "commit", "pulse");
    iconBtn(NGB_ICON_STAGE_ALL, "Stage all", this.actions.stageAll, "stage-all", "pulse");
    iconBtn(NGB_ICON_UNSTAGE_ALL, "Unstage all", this.actions.unstageAll, "unstage-all", "pulse");
    iconBtn("cloud-download", "Fetch", this.actions.fetch, "fetch", "sweep-down");
    iconBtn(NGB_ICON_PULL, "Pull", this.actions.pull, "pull", "sweep-down");
    iconBtn(NGB_ICON_PUSH, "Push", this.actions.push, "push", "sweep-up");
    iconBtn("refresh-cw", "Refresh status", this.actions.refresh, "status", "spin");

    // --- operation strip: one operation runs at a time, so it lives here,
    // directly above the repository state. Cancel on the left, log on the right.
    const strip = c.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    // The cancel slot is ALWAYS created so the row never reflows and the button
    // cannot go missing when only the elapsed-time text is refreshed.
    const cancel = stripLeft.createEl("button", {
      cls: "clickable-icon ngb-sv-icon ngb-sv-icon-warn ngb-sv-cancel-slot",
    });
    cancel.setAttribute("aria-label", "Cancel current operation");
    setIcon(cancel, "x");
    cancel.addEventListener("click", () => this.actions.cancel());
    this.cancelBtn = cancel;
    this.progressEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    this.applyStripState(d?.progress ?? null, d?.activeOperation ?? null);
    const stripRight = strip.createDiv({ cls: "ngb-sv-strip-right" });
    // Tree/list layout toggle (took the operation-log slot; the log moved to
    // settings). The icon shows the CURRENT layout; a tap switches to the other.
    const treeBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    const treeOn = d?.treeView === true;
    treeBtn.setAttribute("aria-label", treeOn ? "Tree layout (tap for list)" : "List layout (tap for tree)");
    setIcon(treeBtn, treeOn ? "folder-tree" : "list");
    treeBtn.addEventListener("click", this.actions.toggleTree);
    // Repository history uses the SAME icon as the history panel itself.
    const histBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    histBtn.setAttribute("aria-label", "Repository history");
    setIcon(histBtn, "history");
    histBtn.addEventListener("click", this.actions.openHistory);

    // --- header line ---
    const head = c.createDiv({ cls: "ngb-sv-header" });
    head.createSpan({ cls: `ngb-sv-dot ngb-sv-${d?.state ?? "unknown"}` });
    head.createSpan({ cls: "ngb-sv-state", text: d ? stateLabel(d.state) : "not checked yet" });
    if (d) {
      head.createSpan({
        cls: "ngb-settings-note",
        text: ` ${d.branch ?? "—"} ↑${d.ahead} ↓${d.behind}`,
      });
    }

    if (!d) {
      c.createEl("p", { cls: "ngb-settings-note", text: "Press refresh to query native Git." });
      return;
    }

    // --- file groups ---
    const stageable = d.unstaged.length + d.untracked.length > 0;
    this.renderGroup(c, "conflicted", "Conflicts", d.conflicted.map((e) => entry(e, "U")), true);
    // Keep the staged group visible whenever something could be staged, so the
    // destination of the "+" buttons is always on screen.
    this.renderGroup(
      c,
      "staged",
      "Staged changes",
      d.staged.map((e) => entry(e, e.index)),
      false,
      stageable
    );
    this.renderGroup(c, "unstaged", "Changes", d.unstaged.map((e) => entry(e, e.worktree)), false);
    this.renderGroup(
      c,
      "untracked",
      "Untracked",
      d.untracked.map((p) => ({ path: p, code: "?" })),
      false
    );

    if (
      d.conflicted.length + d.staged.length + d.unstaged.length + d.untracked.length === 0
    ) {
      c.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
    }

    // --- footer: details + progress (bottom of the panel, never covering content) ---
    const foot = c.createDiv({ cls: "ngb-sv-footer" });
    const kv = foot.createDiv({ cls: "ngb-sv-kv" });
    const row = (k: string, v: string) => {
      const line = kv.createDiv({ cls: "ngb-sv-kv-row" });
      line.createSpan({ cls: "ngb-sv-kv-key", text: k });
      line.createSpan({ cls: "ngb-sv-kv-val", text: v });
    };
    if (d.sparse) {
      row("Sparse", d.sparse.enabled ? `on (${d.sparse.patterns.length} rules)` : "off");
      row("Hidden files", String(d.sparse.skipWorktreeCount));
    }
    row("Bridge", d.bridge);
    row("Last sync", d.lastSyncAt ?? "never");
    if (d.fetchedAt) row("Updated", d.fetchedAt);

  }

  private renderGroup(
    parent: HTMLElement,
    group: Group,
    title: string,
    items: { path: string; code: string }[],
    danger: boolean,
    showWhenEmpty = false
  ): void {
    if (items.length === 0 && !showWhenEmpty) return;
    const wrap = parent.createDiv({ cls: "ngb-sv-group" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    setIcon(chevron, this.collapsed[group] ? "chevron-right" : "chevron-down");
    header.createSpan({
      cls: danger ? "ngb-sv-group-title ngb-status-conflict" : "ngb-sv-group-title",
      text: title,
    });
    header.createSpan({ cls: "ngb-badge", text: String(items.length) });
    header.addEventListener("click", () => {
      this.collapsed[group] = !this.collapsed[group];
      this.render();
    });
    if (this.collapsed[group]) return;

    const list = wrap.createDiv({ cls: "ngb-sv-list" });
    if (items.length === 0) {
      list.createDiv({ cls: "ngb-sv-empty", text: "Nothing staged yet." });
      return;
    }
    if (this.data?.treeView) {
      this.renderTreeItems(list, group, items);
      return;
    }
    for (const it of items) {
      this.renderRow(list, group, it, 0);
      // An untracked FOLDER is a grouping control, not a replacement for the
      // file rows inside it: render its files (reported by a v5+ runner) as
      // actionable child rows, collapsible via the folder row's chevron.
      const children = group === "untracked" ? this.data?.untrackedChildren?.[it.path] : undefined;
      if (children && children.length > 0 && !this.collapsedDirs.has(it.path)) {
        for (const c of children) this.renderRow(list, group, { path: c, code: "?" }, 1);
      }
    }
  }

  /** Tree layout: group items nested under collapsible folder rows. */
  private renderTreeItems(
    list: HTMLElement,
    group: Group,
    items: { path: string; code: string }[]
  ): void {
    // Untracked "dir/" entries expand into their enumerated files so the tree
    // shows real rows; the entry stays a leaf when nothing enumerated it.
    let expanded = items;
    if (group === "untracked") {
      expanded = [];
      for (const it of items) {
        const children = this.data?.untrackedChildren?.[it.path];
        if (it.path.endsWith("/") && children && children.length > 0) {
          for (const c of children) expanded.push({ path: c, code: "?" });
        } else {
          expanded.push(it);
        }
      }
    }
    const tree = buildPathTree(expanded, (i) => i.path);
    for (const it of tree.rootItems) this.renderRow(list, group, it, 0);
    for (const f of tree.folders) this.renderFolderNode(list, group, f, 0);
  }

  private renderFolderNode(
    list: HTMLElement,
    group: Group,
    node: PathTreeNode<{ path: string; code: string }>,
    depth: number
  ): void {
    const rowEl = list.createDiv({ cls: `ngb-sv-file ngb-ind-${Math.min(depth, 6)}` });
    const key = `${group}:${node.path}`;
    const collapsed = this.collapsedDirs.has(key);
    const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
    const chev = main.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
    setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
    main.createSpan({ cls: "ngb-sv-file-name ngb-sv-folder-name", text: `${node.name}/` });
    // A collapsed folder still tells how many files in THIS state it holds.
    main.createSpan({ cls: "ngb-badge", text: String(node.count) });
    main.addEventListener("click", () => {
      if (collapsed) this.collapsedDirs.delete(key);
      else this.collapsedDirs.add(key);
      this.render();
    });
    const busy = this.data?.runningAction;
    const hit = isRowAffected(this.data?.runningPath, `${node.path}/`);
    if (hit && (busy === "stage-file" || busy === "unstage-file" || busy === "discard-file")) {
      rowEl.addClass("ngb-sv-file-busy");
    }
    // Folder actions apply to every file under the folder IN THIS GROUP's
    // state; main.ts scopes the git invocation accordingly. The action area
    // mirrors the FILE row slot for slot ([open] [stage/unstage] [discard]
    // plus the change-letter column), with invisible placeholders where a
    // folder has no equivalent action, so every button sits in the same
    // column as the ones above and below it.
    const acts = rowEl.createDiv({ cls: "ngb-sv-file-actions" });
    const slot = (
      icon: string | null,
      tooltip?: string,
      cb?: () => void,
      warn = false
    ) => {
      const b = acts.createEl("button", {
        cls:
          `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}` +
          `${icon === null ? " ngb-slot-inactive" : ""}`,
      });
      if (icon === null) {
        // Keeps the column width; never focusable or clickable.
        setIcon(b, "circle");
        b.setAttribute("aria-hidden", "true");
        b.tabIndex = -1;
        return;
      }
      b.setAttribute("aria-label", tooltip ?? "");
      setIcon(b, icon);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        cb?.();
      });
    };
    slot(null); // aligns with the file rows' "open file" button
    if (group === "staged") {
      slot("minus", "Unstage everything staged in this folder", () =>
        this.actions.folderAction(group, node.path, "unstage")
      );
      slot(null); // files offer discard here; a staged folder does not
    } else if (group === "unstaged") {
      slot("plus", "Stage the changed (tracked) files in this folder", () =>
        this.actions.folderAction(group, node.path, "stage")
      );
      slot("undo-2", "Discard the changes in this folder", () =>
        this.actions.folderAction(group, node.path, "discard"), true);
    } else if (group === "untracked") {
      slot("plus", "Stage the new files in this folder", () =>
        this.actions.folderAction(group, node.path, "stage")
      );
      slot("trash", "Move the new files in this folder to Obsidian's trash", () =>
        this.actions.folderAction(group, node.path, "discard"), true);
    } else {
      slot(null);
      slot(null);
    }
    // Placeholder for the change-letter column of file rows.
    rowEl.createSpan({ cls: "ngb-sv-file-code" });
    if (collapsed) return;
    for (const it of node.items) this.renderRow(list, group, it, depth + 1);
    for (const ch of node.children) this.renderFolderNode(list, group, ch, depth + 1);
  }

  private renderRow(
    list: HTMLElement,
    group: Group,
    it: { path: string; code: string },
    depth: number
  ): void {
    {
      const rowEl = list.createDiv({
        cls: depth === 0 ? "ngb-sv-file" : `ngb-sv-file ngb-ind-${Math.min(depth, 6)}`,
      });
      const children = group === "untracked" && depth === 0 ? this.data?.untrackedChildren?.[it.path] : undefined;
      if (children && children.length > 0) {
        // Same collapse affordance as the group headers, scoped to this folder.
        const chev = rowEl.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
        setIcon(chev, this.collapsedDirs.has(it.path) ? "chevron-right" : "chevron-down");
        chev.setAttribute("aria-label", this.collapsedDirs.has(it.path) ? "Expand folder" : "Collapse folder");
        chev.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.collapsedDirs.has(it.path)) this.collapsedDirs.delete(it.path);
          else this.collapsedDirs.add(it.path);
          this.render();
        });
      }
      const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
      const kind = CHANGE_LABEL[it.code] ?? it.code;
      // Conflicted rows carry an explicit warning glyph in addition to the
      // red "U" code letter at the row's end.
      if (group === "conflicted") {
        const warn = main.createSpan({ cls: "ngb-conf-row-icon" });
        setIcon(warn, "alert-triangle");
        warn.setAttribute("aria-label", "Merge conflict");
      }
      const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName(it.path) });
      name.setAttribute("aria-label", `${it.path} - ${kind}`);
      // Tap behaviour per group: conflicts open resolution (pane for text
      // files, context menu for the rest); tracked changes open their diff in
      // a pane (obsidian-git convention); untracked files and folders have no
      // diff, so they open directly. Go-to-file always opens the file.
      const isDir = it.path.endsWith("/");
      if (group === "conflicted") {
        main.addEventListener("click", (ev) => {
          const r = rowEl.getBoundingClientRect();
          this.actions.openConflict(it.path, { x: ev.clientX || r.left, y: ev.clientY || r.bottom });
        });
      } else if (group === "untracked" || isDir) {
        main.addEventListener("click", () => this.actions.openFile(it.path));
      } else {
        main.addEventListener("click", () => this.actions.openDiff(it.path, group));
      }

      // Same Git menu as the file explorer, on the whole row: right click on
      // desktop, long press on touch (Obsidian maps contextmenu for both, but
      // WebViews are inconsistent about it, so a touch timer backs it up).
      const openMenu = (ev: MouseEvent | TouchEvent) => {
        const menu = new Menu();
        this.actions.fileMenu(menu, it.path);
        // showAtMouseEvent needs a MouseEvent; for touch, anchor the menu to
        // the row itself (MenuPositionDef takes x/y, not a DOMRect).
        if (ev instanceof MouseEvent) {
          menu.showAtMouseEvent(ev);
        } else {
          const r = rowEl.getBoundingClientRect();
          menu.showAtPosition({ x: r.left, y: r.bottom });
        }
      };
      rowEl.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        openMenu(ev);
      });
      let longPress: number | null = null;
      const clearLongPress = () => {
        if (longPress !== null) {
          window.clearTimeout(longPress);
          longPress = null;
        }
      };
      rowEl.addEventListener("touchstart", (ev) => {
        clearLongPress();
        longPress = window.setTimeout(() => {
          longPress = null;
          openMenu(ev);
        }, 500);
      }, { passive: true });
      for (const e of ["touchend", "touchmove", "touchcancel"]) {
        rowEl.addEventListener(e, clearLongPress, { passive: true });
      }
      // Tooltips are unavailable on touch, so the change is spelled out there.
      if (Platform.isMobile) {
        main.createSpan({ cls: "ngb-sv-file-kind", text: kind });
      }

      const acts = rowEl.createDiv({ cls: "ngb-sv-file-actions" });
      const act = (icon: string, tooltip: string, cb: () => void, warn = false, spinning = false) => {
        const b = acts.createEl("button", {
          cls:
            `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}` +
            `${spinning ? " ngb-anim-pulse ngb-sv-icon-active" : ""}`,
        });
        b.setAttribute("aria-label", tooltip);
        setIcon(b, icon);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          cb();
        });
      };
      // A per-path action animates ONLY the acted row (or, for a folder, the
      // folder row and its visible descendants) — never sibling rows that
      // merely share the action name, and never the global toolbar buttons.
      const busy = this.data?.runningAction;
      const hit = isRowAffected(this.data?.runningPath, it.path);
      const rowBusy =
        hit && (busy === "stage-file" || busy === "unstage-file" || busy === "discard-file");
      if (rowBusy) rowEl.addClass("ngb-sv-file-busy");
      // Explicit open button (obsidian-git convention), since the name click
      // now goes to the diff for tracked changes. Folders have nothing to open.
      if (!it.path.endsWith("/")) {
        act("go-to-file", "Open file", () => this.actions.openFile(it.path));
      }
      if (group === "staged") {
        act("minus", "Unstage", () => this.actions.unstage(it.path), false, busy === "unstage-file" && hit);
      } else {
        act("plus", "Stage", () => this.actions.stage(it.path), false, busy === "stage-file" && hit);
      }
      act("undo-2", "Discard changes", () => this.actions.discard(it.path), true, busy === "discard-file" && hit);

      // The change letter lives at the END of the row: next to the file name it
      // read like part of the file name.
      const codeEl = rowEl.createSpan({
        cls: `ngb-sv-file-code ngb-code-${it.code}`,
        text: it.code,
      });
      codeEl.setAttribute("aria-label", kind);
    }
  }
}

function entry(e: GitFileEntry, code: string): { path: string; code: string } {
  return { path: e.path, code: code === "." ? "M" : code };
}

/**
 * Whether a per-path operation on `actionPath` affects the row for `rowPath`:
 * the row IS the acted path, or lives inside it when the acted path is a
 * folder. Trailing slashes are normalised because git reports untracked
 * directories as "Dir/" while menu actions may hand over "Dir". Pure prefix
 * matching is segment-aware ("Doc" must not match "Docs/a.md").
 */
export function isRowAffected(actionPath: string | undefined, rowPath: string): boolean {
  if (!actionPath) return false;
  const a = actionPath.endsWith("/") ? actionPath.slice(0, -1) : actionPath;
  const r = rowPath.endsWith("/") ? rowPath.slice(0, -1) : rowPath;
  if (a === "") return false;
  return r === a || r.startsWith(a + "/");
}

/**
 * Last path segment for display. Untracked *directories* are reported by git
 * with a trailing slash (e.g. "Private/Work/"), which previously produced an
 * empty label, so the slash is stripped first and folders keep a trailing "/".
 */
function displayName(path: string): string {
  const isDir = path.endsWith("/");
  const trimmed = isDir ? path.slice(0, -1) : path;
  const i = trimmed.lastIndexOf("/");
  const base = i >= 0 ? trimmed.slice(i + 1) : trimmed;
  const label = base === "" ? trimmed || path : base;
  return isDir ? `${label}/` : label;
}

function stateLabel(state: string): string {
  switch (state) {
    case "clean":
      return "Clean";
    case "changed":
      return "Local changes";
    case "syncing":
      return "Working…";
    case "waiting":
      return "Waiting for Termux";
    case "conflict":
      return "Conflict";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled on this device";
    default:
      return state;
  }
}

export function summaryToViewData(
  s: GitStatusSummary,
  extra: Omit<
    StatusViewData,
    | "state"
    | "branch"
    | "ahead"
    | "behind"
    | "staged"
    | "unstaged"
    | "untracked"
    | "untrackedChildren"
    | "conflicted"
  >,
  state: string
): StatusViewData {
  return {
    state,
    branch: s.detached ? "(detached)" : s.branch,
    ahead: s.ahead,
    behind: s.behind,
    staged: s.staged,
    unstaged: s.unstaged,
    untracked: s.untracked,
    untrackedChildren: s.untrackedChildren,
    conflicted: s.conflicted,
    ...extra,
  };
}
