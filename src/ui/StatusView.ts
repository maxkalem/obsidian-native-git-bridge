import { ItemView, Menu, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import type { GitFileEntry, GitStatusSummary, SparseStateSummary } from "../types";
import { buildPathTree, type PathTreeNode } from "./pathTree";
import { renderCountBadge } from "./countBadge";
import { describeMove, revealOnTap } from "./revealOnTap";
import { attachContextMenu } from "./contextMenu";
import {
  NGB_ICON_FETCH,
  NGB_ICON_PULL,
  NGB_ICON_PUSH,
  NGB_ICON_STAGE_ALL,
  NGB_ICON_SYNC,
  NGB_ICON_UNSTAGE_ALL,
} from "./icons";
import { applySweepIcon } from "./animatedIcons";
import { describeInProgressOp, type InProgressKind } from "../git/inProgressOp";

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
  /**
   * Rows drawn per group before the panel offers the rest (device-local). Falls
   * back to `DEFAULT_ROWS_PER_GROUP` when absent.
   */
  rowsPerGroup?: number;
  /**
   * `false` when no status has been read from the repository yet, so the empty
   * lists above mean "not asked" rather than "nothing there".
   *
   * The panel has to say which, because the two look identical and one of them
   * is a lie the user can act on: it reported "Clean — working tree clean, ↑0
   * ↓0" on a device that was sitting in an unfinished merge with six conflicts,
   * because the push builds an empty summary when it has none. Absent means
   * loaded, so nothing that already sets real data has to change.
   */
  statusLoaded?: boolean;
  sparse?: SparseStateSummary;
  activeOperation?: string;
  /** Progress line shown at the bottom while an operation runs. */
  progress?: string;
  /**
   * What the runner said it is doing (the last progress-stream line). Drawn on
   * its own reserved line under the state line, so the state text never grows
   * sideways and the layout never jumps when the runner starts talking.
   */
  progressDetail?: string;
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
  /** An unfinished merge (MERGE_HEAD present), regardless of conflict count. */
  mergeInProgress?: boolean;
  /** An unfinished rebase (a rebase-merge/rebase-apply state directory). */
  rebaseInProgress?: boolean;
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
   * Finish the unfinished merge or rebase the banner is showing: commit the
   * merge, or `rebase --continue`. Only called when the banner enabled it.
   */
  finishInProgressOp: (kind: InProgressKind) => void;
  /** Abandon it: `merge --abort` / `rebase --abort`. */
  abortInProgressOp: (kind: InProgressKind) => void;
  /**
   * Group-scoped folder action: applies to every file under `folderPath`
   * that is IN this group's state (stage in Changes stages tracked changes
   * only; unstage on Staged unstages only what was staged; discard in
   * Untracked moves the new files to Obsidian's trash).
   */
  folderAction: (group: Group, folderPath: string, kind: "stage" | "unstage" | "discard") => void;
  /** The same, scoped to a whole group (buttons on the group header). */
  groupAction: (group: Group, kind: "stage" | "unstage" | "discard") => void;
  /** Group-wide context menu (bulk unstage, .gitignore, sparse, exclude). */
  groupMenu: (group: Group, pos: { x: number; y: number }) => void;
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
  /**
   * The group is part of the request, not a detail the receiver can infer: an
   * untracked path has nothing to revert to and takes the delete route, a
   * tracked one goes back to what is committed. The row knows which group it is
   * in; nothing downstream should have to guess.
   */
  discard: (path: string, group: Group) => void;
  /**
   * "Tell me the current state." Called when the panel opens, because the
   * plugin's push cannot reach a panel that did not exist when it fired.
   */
  syncState: () => void;
  /** Open the live output panel — what Termux is saying while it says it. */
  openOutput: () => void;
  /**
   * Shared preference: spell the change out beside the file name (`modified`,
   * `conflicted`, `deleted`) on mobile, where there is no tooltip to carry it.
   * On by default. Turning it off gives the name the whole row; the change
   * letter in the right-hand column still states it.
   */
  showChangeWords: () => boolean;
  /**
   * Open the Git menu for a path (long press / right click). `group` is the
   * panel group the row belongs to, so the entries reflect the state the
   * panel is showing instead of re-deriving it.
   */
  fileMenu: (path: string, group: Group, pos: { x: number; y: number }) => void;
}

export type Group = "conflicted" | "staged" | "unstaged" | "untracked";

/** One action column of a folder row or a group header; `icon: null` = placeholder. */
export interface ActionSlot {
  icon: string | null;
  tooltip?: string;
  action?: "stage" | "unstage" | "discard";
  warn?: boolean;
}

/**
 * The action columns of a folder row or a group header, ALWAYS three of them,
 * in the file rows' order: [open] [stage/unstage] [discard]. Empty columns are
 * placeholders, which is the whole point: a header that rendered only its one
 * real button parked it in the "open file" column, so the group read as
 * misaligned against every row beneath it.
 *
 * Pure and exported so the alignment is testable without a DOM.
 */
export function actionSlots(scope: "group" | "folder", group: Group, hasItems = true): ActionSlot[] {
  const none: ActionSlot = { icon: null };
  if (!hasItems) return [none, none, none];
  const where = scope === "group" ? "" : " in this folder";
  switch (group) {
    case "staged":
      return [
        none,
        { icon: "minus", tooltip: `Unstage everything staged${where || ""}`, action: "unstage" },
        none, // files offer discard here; staged content does not
      ];
    case "unstaged":
      return [
        none,
        { icon: "plus", tooltip: `Stage the changed (tracked) files${where}`, action: "stage" },
        { icon: "undo-2", tooltip: `Discard the changes${where}`, action: "discard", warn: true },
      ];
    case "untracked":
      return [
        none,
        { icon: "plus", tooltip: `Stage the new files${where}`, action: "stage" },
        // `trash`, not `undo-2`: there is nothing to revert to. The icon says
        // which of the two things a control does, at every scope — revert to
        // what is committed, or delete something git never had. The wording
        // stays neutral about the trash because a device setting decides
        // whether the deletion is reversible; the confirmation says which.
        { icon: "trash", tooltip: `Delete the new files${where}`, action: "discard", warn: true },
      ];
    default:
      return [none, none, none];
  }
}

/**
 * How many FILES a group holds, which is not how many entries git printed.
 * A fully untracked directory arrives as one `dir/` entry, and the panel lists
 * its contents from `untrackedChildren`; the count has to agree with the rows
 * the user can see, not with the length of git's list.
 *
 * Pure and exported for the test: the number and the rows come from two
 * different places, and that is exactly how they drifted apart.
 */
export function groupFileCount(
  items: Array<{ path: string }>,
  children?: Record<string, string[]>
): number {
  let n = 0;
  for (const it of items) {
    const kids = it.path.endsWith("/") ? children?.[it.path] : undefined;
    n += kids !== undefined && kids.length > 0 ? kids.length : 1;
  }
  return n;
}

/**
 * How many rows the panel draws per group before it stops and offers the rest.
 *
 * Every group can be long at once — a conflicted merge, a large staged set, the
 * changes beside it, and an untracked directory git collapsed into one entry
 * that holds thousands of files (2415 in one inbox folder on the device this was
 * measured on). Each row costs about a dozen DOM nodes, and the cost is paid
 * again on every re-render: with that folder open the spinner took two seconds
 * to appear, and four groups at a hundred rows each would be four hundred rows
 * before anything is visible.
 *
 * The budget is per group, so one long group cannot starve the others, and the
 * group's count still states the true total: nothing is hidden from git, the
 * rows are simply not built until asked for. Configurable per device, because
 * what it buys is render time on that device.
 */
export const DEFAULT_ROWS_PER_GROUP = 30;

/**
 * How many pages a group may draw in TREE layout before it stops altogether.
 *
 * The per-folder budget below puts the truncation where the user can see it,
 * which a per-group one cannot: with several folders cut short, a single row at
 * the end of the group says nothing about where the missing files are. But a
 * budget that is only per folder is not a budget at all — fifty folders at
 * thirty files each is fifteen hundred rows, which is the cost this whole
 * mechanism exists to bound. So the per-folder rule decides placement and this
 * one decides cost, and they are separate because they answer different
 * questions.
 */
export const GROUP_PAGES_CEILING = 10;

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
  private progressDetailEl: HTMLElement | null = null;
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
  /**
   * Rows the user asked to see beyond the budget, per group. Absent means the
   * plain budget. Not persisted: it is a rendering allowance for this session,
   * not a preference.
   */
  private groupLimits = new Map<Group, number>();
  /** Rows drawn in the group being rendered right now; reset per group. */
  private drawn = 0;
  /**
   * Files the user asked to see inside one tree folder, keyed "<group>:<path>"
   * like `collapsedDirs`. Tree layout budgets per folder so the "more" control
   * sits under the folder it belongs to; the group ceiling above is what keeps
   * the total bounded.
   */
  private folderLimits = new Map<string, number>();
  /**
   * The scrolling half of the panel. The toolbar, the operation strip and the
   * branch line stay put while this scrolls, so the controls are reachable
   * without scrolling back up through a long file list.
   */
  private bodyEl: HTMLElement | null = null;
  /**
   * Scroll offset carried across re-renders. `render()` rebuilds the whole
   * panel on every status refresh, and with auto-refresh on a timer that threw
   * the user back to the top of the list mid-scroll.
   */
  private savedScroll = 0;

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
  updateProgressText(text: string | null, detail?: string | null): void {
    if (this.data) {
      this.data.progress = text ?? undefined;
      this.data.progressDetail = detail ?? undefined;
    }
    if (this.progressEl && this.cancelBtn) {
      this.applyStripState(text, this.data?.activeOperation ?? null, detail ?? null);
      return;
    }
    this.render();
  }

  /** Toggle the reserved cancel slot and the label without rebuilding the row. */
  private applyStripState(
    progress: string | null,
    activeOperation: string | null,
    detail: string | null
  ): void {
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
    // The reserved line keeps its height when empty, so the head region cannot
    // grow and push the repository state down the moment the runner speaks.
    if (this.progressDetailEl) {
      this.progressDetailEl.setText(running && detail !== null ? detail : "");
    }
  }

  async onOpen(): Promise<void> {
    this.render();
    // Ask for the current state instead of waiting to be told.
    //
    // A panel gets its data from the plugin's push, and that push returns early
    // when no panel exists yet. So a panel that appears WHILE an operation runs
    // — restored by the workspace at startup, or opened by hand a second later
    // — was built with no running action, and the per-second progress update
    // deliberately does not re-render (it would restart the toolbar
    // animations), so the refresh icon stayed still for the whole operation
    // while the progress line ticked beside it.
    this.actions.syncState();
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
    this.savedScroll = this.bodyEl?.scrollTop ?? this.savedScroll;
    c.empty();
    c.addClass("ngb-status-view");
    const d = this.data;

    // Three regions: a fixed head, a scrolling body (the file groups and the
    // details footer), and a fixed bottom bar. Both fixed regions size to their
    // content and never scroll; only the list in the middle does.
    //
    // Where the git controls go is the one difference between platforms. On a
    // phone they sit in the BOTTOM bar, within thumb reach and out of the way
    // of the branch line; on desktop they stay at the top, where this panel has
    // always had them. Everything else is identical, so there is one render
    // path and one set of handlers.
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    const footBar = c.createDiv({ cls: "ngb-sv-footbar" });
    this.bodyEl = body;
    const mobile = Platform.isPhone;

    // --- toolbar: fixed order, animated while the matching action runs ---
    // Created before the strip and the branch line so that on desktop it comes
    // first inside the head; on a phone it lands in the bottom bar instead.
    const bar = (mobile ? footBar : headEl).createDiv({ cls: "ngb-sv-toolbar" });
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
    iconBtn(NGB_ICON_FETCH, "Fetch", this.actions.fetch, "fetch", "sweep-down");
    iconBtn(NGB_ICON_PULL, "Pull", this.actions.pull, "pull", "sweep-down");
    iconBtn(NGB_ICON_PUSH, "Push", this.actions.push, "push", "sweep-up");
    iconBtn("refresh-cw", "Refresh status", this.actions.refresh, "status", "spin");

    // --- operation strip: one operation runs at a time, so it lives here,
    // directly above the repository state. Cancel on the left, log on the right.
    const strip = headEl.createDiv({ cls: "ngb-sv-strip" });
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
    // The state line opens the output panel.
    //
    // This line is what the user watches during a long operation, and until now
    // watching it was all they could do: `sync… 240s` says a number and nothing
    // about what git is doing. It is the obvious thing to tap, so it is now the
    // thing that answers.
    this.progressEl.addClass("ngb-sv-progress-tap");
    this.progressEl.setAttribute("aria-label", "Show what Termux is doing");
    this.progressEl.addEventListener("click", () => this.actions.openOutput());
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

    // --- runner detail line ---
    // What the runner said it is doing, on its own line so the state line above
    // never grows sideways. Created ALWAYS and sized by CSS even when empty:
    // reserving the room is what keeps the repository state below from jumping
    // the moment the first progress line arrives.
    const detailEl = headEl.createDiv({ cls: "ngb-sv-progress-detail ngb-sv-progress-tap" });
    detailEl.setAttribute("aria-label", "Show what Termux is doing");
    detailEl.addEventListener("click", () => this.actions.openOutput());
    this.progressDetailEl = detailEl;
    this.applyStripState(d?.progress ?? null, d?.activeOperation ?? null, d?.progressDetail ?? null);

    // --- header line ---
    const head = headEl.createDiv({ cls: "ngb-sv-header" });
    // `d` is null before the first push, and `statusLoaded === false` after a
    // push that had no status to give: both mean "nothing was read".
    const loaded = d != null && d.statusLoaded !== false;
    const working = d?.state === "syncing";
    head.createSpan({
      cls: `ngb-sv-dot ngb-sv-${loaded ? d.state : working ? "syncing" : "unknown"}`,
    });
    head.createSpan({
      cls: "ngb-sv-state",
      text: loaded ? stateLabel(d.state) : working ? stateLabel("syncing") : "not checked yet",
    });
    // The branch and the ahead/behind counts come from a status that was read.
    // Printing "↑0 ↓0" from an empty summary states two facts nobody checked.
    if (loaded) {
      head.createSpan({
        cls: "ngb-settings-note",
        text: ` ${d.branch ?? "—"} ↑${d.ahead} ↓${d.behind}`,
      });
    }

    // --- unfinished merge / rebase ---
    // In the HEAD region, directly under the branch line it is about: this is
    // the one state where every other control is refused until it is dealt
    // with, so it must not be something the user can scroll past.
    if (d) this.renderInProgressBanner(headEl, d, mobile);

    if (!d) {
      body.createEl("p", { cls: "ngb-settings-note", text: "Press refresh to query native Git." });
      return;
    }

    // --- file groups ---
    const stageable = d.unstaged.length + d.untracked.length > 0;
    this.renderGroup(body, "conflicted", "Conflicts", d.conflicted.map((e) => entry(e, "U")), true);
    // Keep the staged group visible whenever something could be staged, so the
    // destination of the "+" buttons is always on screen.
    this.renderGroup(
      body,
      "staged",
      "Staged changes",
      d.staged.map((e) => entry(e, e.index)),
      false,
      stageable
    );
    this.renderGroup(body, "unstaged", "Changes", d.unstaged.map((e) => entry(e, e.worktree)), false);
    this.renderGroup(
      body,
      "untracked",
      "Untracked",
      d.untracked.map((p) => ({ path: p, code: "?" })),
      false
    );

    if (
      d.conflicted.length + d.staged.length + d.unstaged.length + d.untracked.length === 0
    ) {
      // Only when a status was actually read. Otherwise this line asserted a
      // clean tree over an unfinished merge, which is the one claim in this
      // panel a user might commit or push on.
      if (d.statusLoaded === false) {
        body.createEl("p", {
          cls: "ngb-settings-note",
          text: "No status read yet — refresh to see the repository.",
        });
      } else {
        body.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
      }
    }

    // --- footer: details + progress (bottom of the panel, never covering content) ---
    const foot = body.createDiv({ cls: "ngb-sv-footer" });
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

    // Put the list back where the user left it. Clamped by the browser when the
    // content shrank, which is the behaviour we want: never scrolled past the end.
    if (this.savedScroll > 0) body.scrollTop = this.savedScroll;
  }

  /**
   * The way out of an unfinished merge or rebase. Renders nothing at all when
   * neither is running, which is the normal case.
   */
  private renderInProgressBanner(parent: HTMLElement, d: StatusViewData, mobile: boolean): void {
    const b = describeInProgressOp({
      mergeInProgress: d.mergeInProgress,
      rebaseInProgress: d.rebaseInProgress,
      conflictCount: d.conflicted.length,
    });
    if (!b) return;
    const wrap = parent.createDiv({ cls: mobile ? "ngb-sv-banner ngb-sv-banner-compact" : "ngb-sv-banner" });
    const head = wrap.createDiv({ cls: "ngb-sv-banner-title" });
    // No icon on a phone: the coloured border already marks the banner, and the
    // icon costs horizontal room the shortened title can use instead.
    if (!mobile) {
      const icon = head.createSpan({ cls: "ngb-sv-banner-icon" });
      setIcon(icon, "git-merge");
    }
    head.createSpan({ text: mobile ? b.shortTitle : b.title });
    wrap.createDiv({ cls: "ngb-sv-banner-detail", text: mobile ? b.shortDetail : b.detail });
    const row = wrap.createDiv({ cls: "ngb-sv-banner-actions" });
    const finish = row.createEl("button", { cls: "mod-cta", text: b.finish.label });
    finish.disabled = !b.finish.enabled;
    finish.addEventListener("click", () => this.actions.finishInProgressOp(b.kind));
    // mod-warning is Obsidian's red TEXT; the escape hatch gets a red FILL so
    // it reads as the destructive option at a glance on both platforms.
    const abort = row.createEl("button", { cls: "ngb-sv-banner-abort", text: b.abort.label });
    abort.addEventListener("click", () => this.actions.abortInProgressOp(b.kind));
  }

  private renderGroup(
    parent: HTMLElement,
    group: Group,
    title: string,
    items: { path: string; code: string; origPath?: string }[],
    danger: boolean,
    showWhenEmpty = false
  ): void {
    if (items.length === 0 && !showWhenEmpty) return;
    const wrap = parent.createDiv({ cls: "ngb-sv-group" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    setIcon(chevron, this.collapsed[group] ? "chevron-right" : "chevron-down");
    // A dangerous group reads the way its rows do: the same warning glyph in
    // the same colour. It used to carry `ngb-status-conflict`, a class the
    // stylesheet has no rule for, so the header of a group of conflicts was
    // indistinguishable from any other header while every row under it was
    // marked. The group is the outermost row of its state; it says so.
    if (danger) {
      const warn = header.createSpan({ cls: "ngb-conf-row-icon" });
      setIcon(warn, "alert-triangle");
      warn.setAttribute("aria-label", "Merge conflicts");
    }
    header.createSpan({
      cls: danger ? "ngb-sv-group-title ngb-sv-group-danger" : "ngb-sv-group-title",
      text: title,
    });
    // Group-wide actions, in the same slots (and with the same glyphs) the
    // folder rows use, so a group reads as the outermost folder of its state.
    // Every slot is emitted, empty ones as invisible placeholders: without
    // them a header with one button parked it in the file rows' "open file"
    // column and the whole group read as misaligned.
    const gslot = this.slotFactory(header.createDiv({ cls: "ngb-sv-file-actions" }));
    for (const s of actionSlots("group", group, items.length > 0)) {
      gslot(s.icon, s.tooltip, s.action ? () => this.actions.groupAction(group, s.action!) : undefined, s.warn);
    }
    // Same right-hand column as the rows below it, and the same NUMBER: files,
    // not git's entries. The untracked group is one entry, `Private/!inbox/1/`,
    // with 2415 files behind it, so a header reading "1" above a folder row
    // reading "2.4k" was the panel disagreeing with itself.
    const total = groupFileCount(items, this.data?.untrackedChildren);
    renderCountBadge(header, total, (n) => `${n} files in ${title.toLowerCase()}`);
    header.addEventListener("click", () => {
      this.collapsed[group] = !this.collapsed[group];
      this.render();
    });
    // Long press / right click on the header: the group's own menu (bulk
    // unstage, .gitignore, sparse, exclude), gated by the settings toggles.
    attachContextMenu(header, (pos) => this.actions.groupMenu(group, pos));
    if (this.collapsed[group]) return;

    const list = wrap.createDiv({ cls: "ngb-sv-list" });
    if (items.length === 0) {
      list.createDiv({ cls: "ngb-sv-empty", text: "Nothing staged yet." });
      return;
    }
    this.drawn = 0;
    if (this.data?.treeView) {
      this.renderTreeItems(list, group, items);
    } else {
      for (const it of items) {
        if (!this.hasRowBudget(group)) break;
        this.renderRow(list, group, it, 0);
        // An untracked FOLDER is a grouping control, not a replacement for the
        // file rows inside it: render its files (reported by a v5+ runner) as
        // actionable child rows, collapsible via the folder row's chevron.
        const children = group === "untracked" ? this.data?.untrackedChildren?.[it.path] : undefined;
        if (children && children.length > 0 && !this.collapsedDirs.has(it.path)) {
          for (const c of children) {
            if (!this.hasRowBudget(group)) break;
            this.renderRow(list, group, { path: c, code: "?" }, 1);
          }
        }
      }
    }
    // Outside the layout branch, deliberately. It used to sit after the list
    // loop, and the tree layout returned before reaching it, so on a device in
    // tree layout the panel stopped at the budget with nothing saying why and
    // no way to see the rest.
    this.renderRowOverflow(list, group, items);
  }

  /** One page: the device's row budget. */
  private page(): number {
    const n = this.data?.rowsPerGroup ?? DEFAULT_ROWS_PER_GROUP;
    return n > 0 ? n : DEFAULT_ROWS_PER_GROUP;
  }

  /**
   * How many rows this group may draw in total.
   *
   * List layout: one page, because there is no structure to hang a partial
   * listing on and the group-level row is the whole answer. Tree layout: the
   * cost ceiling, since the per-folder budget already limits each folder and
   * this only stops a group with a very large number of folders.
   */
  private rowLimit(group: Group): number {
    const base = this.page() * (this.data?.treeView ? GROUP_PAGES_CEILING : 1);
    return this.groupLimits.get(group) ?? base;
  }

  /** Files drawn inside one tree folder before it offers the rest. */
  private folderLimit(key: string): number {
    return this.folderLimits.get(key) ?? this.page();
  }

  /**
   * The files directly inside one tree folder, up to that folder's page, and
   * the control that adds the next page.
   *
   * The control is a row of the file list, indented with the files it belongs
   * to, because that is where the user is looking when a folder stops short.
   * `depth` is the folder's own depth; `-1` means the group's root, whose files
   * sit at depth 0.
   */
  private renderFolderItems(
    list: HTMLElement,
    group: Group,
    key: string,
    items: { path: string; code: string; origPath?: string }[],
    depth: number
  ): void {
    const limit = this.folderLimit(key);
    let shown = 0;
    for (const it of items) {
      if (shown >= limit) break;
      // The group ceiling still applies: a group of very many folders stops
      // here rather than drawing a page in each of them.
      if (!this.hasRowBudget(group)) return;
      this.renderRow(list, group, it, depth + 1);
      shown += 1;
    }
    if (shown >= items.length) return;
    const rest = items.length - shown;
    const row = list.createDiv({
      cls: `ngb-sv-file ngb-sv-more-children ngb-ind-${Math.min(Math.max(depth + 1, 1), 6)}`,
    });
    // Short on purpose: this sits in a file list on a phone, where a sentence
    // wraps to two lines and stops looking like a control.
    row.setText(`${shown}/${items.length} files • Tap for more`);
    row.setAttribute(
      "aria-label",
      `Showing ${shown} of ${items.length} files here; tap to show ${Math.min(rest, this.page())} more`
    );
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.folderLimits.set(key, shown + this.page());
      this.render();
    });
  }

  private hasRowBudget(group: Group): boolean {
    return this.drawn < this.rowLimit(group);
  }

  /**
   * The "N of M shown" row, at the end of the group in BOTH layouts. Tree
   * layout flattens files into a path tree, so there is no "after this folder"
   * to hang it under; the same place in both is what keeps the two layouts
   * answering alike.
   */
  private renderRowOverflow(
    list: HTMLElement,
    group: Group,
    items: { path: string }[]
  ): void {
    // Tree layout answers per folder, so the group-level row appears only when
    // the COST ceiling stopped the render — a group with more folders than the
    // ceiling allows pages. Otherwise every folder speaks for itself.
    if (this.data?.treeView && this.drawn < this.rowLimit(group)) return;
    const total = groupFileCount(items, this.data?.untrackedChildren);
    const shown = this.drawn;
    if (shown >= total) return;
    const page = this.data?.rowsPerGroup ?? DEFAULT_ROWS_PER_GROUP;
    const rest = total - shown;
    const row = list.createDiv({ cls: "ngb-sv-empty ngb-sv-more-children" });
    // "rows", not "files": a folder row is a row and not a file, so the unit is
    // named rather than implied. Same short shape as the per-folder control.
    row.setText(`${shown}/${total} rows • Tap for more`);
    row.setAttribute(
      "aria-label",
      `Showing ${shown} rows of ${total} files in this group; tap to show ${Math.min(rest, page)} more`
    );
    row.setAttribute("aria-label", `Show more rows in this group`);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.groupLimits.set(group, shown + page);
      this.render();
    });
  }

  /**
   * One action column, used by folder rows AND group headers so both mirror
   * the file rows slot for slot ([open] [stage/unstage] [discard] plus the
   * count column). `null` renders an invisible placeholder that keeps the
   * column width without being focusable or clickable.
   */
  private slotFactory(
    acts: HTMLElement
  ): (icon: string | null, tooltip?: string, cb?: () => void, warn?: boolean) => void {
    return (icon, tooltip, cb, warn = false) => {
      const b = acts.createEl("button", {
        cls:
          `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}` +
          `${icon === null ? " ngb-slot-inactive" : ""}`,
      });
      if (icon === null) {
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
  }

  /** Tree layout: group items nested under collapsible folder rows. */
  private renderTreeItems(
    list: HTMLElement,
    group: Group,
    items: { path: string; code: string; origPath?: string }[]
  ): void {
    // Untracked "dir/" entries expand into their enumerated files so the tree
    // shows real rows; the entry stays a leaf when nothing enumerated it.
    let expanded: { path: string; code: string; origPath?: string }[] = items;
    if (group === "untracked") {
      expanded = [];
      for (const it of items) {
        const children = this.data?.untrackedChildren?.[it.path];
        if (it.path.endsWith("/") && children && children.length > 0) {
          // Every child, uncapped. An earlier version capped here and the tree
          // then knew nothing about the rest, so a folder holding 2415 files
          // offered "60 of 300" — the cap's own number, reported as the truth.
          // Building the nodes is cheap; it was drawing them that cost two
          // seconds, and the row budget is what bounds that.
          for (const c of children) expanded.push({ path: c, code: "?" });
        } else {
          expanded.push(it);
        }
      }
    }
    const tree = buildPathTree(expanded, (i) => i.path);
    // The group's root files are a "folder" too, keyed by the empty path, so
    // they get their own page and their own control rather than borrowing the
    // ceiling and disappearing without explanation.
    this.renderFolderItems(list, group, `${group}:`, tree.rootItems, -1);
    for (const f of tree.folders) {
      if (!this.hasRowBudget(group)) return;
      this.renderFolderNode(list, group, f, 0);
    }
  }

  private renderFolderNode(
    list: HTMLElement,
    group: Group,
    node: PathTreeNode<{ path: string; code: string; origPath?: string }>,
    depth: number
  ): void {
    // A folder row is a row: it costs the same nodes and the same layout pass.
    this.drawn += 1;
    const rowEl = list.createDiv({ cls: `ngb-sv-file ngb-ind-${Math.min(depth, 6)}` });
    const key = `${group}:${node.path}`;
    const collapsed = this.collapsedDirs.has(key);
    const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
    const chev = main.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
    setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
    main.createSpan({ cls: "ngb-sv-file-name ngb-sv-folder-name", text: `${node.name}/` });
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
    // The folder's own menu: the same entries a file gets, applied to every
    // child in this group's state (the runner takes a directory path).
    attachContextMenu(rowEl, (pos) => this.actions.fileMenu(node.path, group, pos));
    // Folder actions apply to every file under the folder IN THIS GROUP's
    // state; main.ts scopes the git invocation accordingly. The action area
    // mirrors the FILE row slot for slot ([open] [stage/unstage] [discard]
    // plus the change-letter column), with invisible placeholders where a
    // folder has no equivalent action, so every button sits in the same
    // column as the ones above and below it.
    const slot = this.slotFactory(rowEl.createDiv({ cls: "ngb-sv-file-actions" }));
    for (const s of actionSlots("folder", group)) {
      slot(
        s.icon,
        s.tooltip,
        s.action ? () => this.actions.folderAction(group, node.path, s.action!) : undefined,
        s.warn
      );
    }
    // The count lives in the change-letter column, right-aligned with the
    // file rows' status letters. A collapsed folder still tells how many
    // files in THIS state it holds.
    renderCountBadge(rowEl, node.count, (n) => `${n} files in ${node.path}/`);
    if (collapsed) return;
    this.renderFolderItems(list, group, key, node.items, depth);
    for (const ch of node.children) {
      if (!this.hasRowBudget(group)) return;
      this.renderFolderNode(list, group, ch, depth + 1);
    }
  }

  private renderRow(
    list: HTMLElement,
    group: Group,
    it: { path: string; code: string; origPath?: string },
    depth: number
  ): void {
    // Counted here rather than at each call site: the tree layout draws rows
    // from three places, one of them recursive, and a budget that only some of
    // them respect is not a budget.
    this.drawn += 1;
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
      // A rename/copy shows where the file came from, so a move reads as a
      // move instead of a deletion plus an addition.
      if (it.origPath !== undefined && it.origPath !== it.path) {
        const from = main.createSpan({ cls: "ngb-sv-file-from", text: `← ${displayName(it.origPath)}` });
        from.setAttribute("aria-label", `moved from ${it.origPath}`);
        // Same gesture and same three lines as the repository history's rename
        // hint: one question, one answer, wherever it is asked.
        revealOnTap(from, describeMove(it.origPath, it.path), { align: "left" });
      }
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

      // Same Git menu as the file explorer, on the whole row. The menu is told
      // WHICH GROUP the row came from, so its entries match the state the
      // panel is showing rather than being re-inferred.
      attachContextMenu(rowEl, (pos) => this.actions.fileMenu(it.path, group, pos));
      // Tooltips are unavailable on touch, so the change is spelled out there —
      // unless the reader has turned the words off, which is what someone with
      // long file names wants: `conflicted` and `modified` take room from the
      // name, and the change letter at the end of the row says the same thing.
      if (Platform.isMobile && this.actions.showChangeWords()) {
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
      // Same rule as the group and folder rows: `trash` where there is nothing
      // to revert to, `undo-2` where the file has a committed version.
      if (group === "untracked") {
        act("trash", "Delete new file", () => this.actions.discard(it.path, group), true, busy === "discard-file" && hit);
      } else {
        act("undo-2", "Discard changes", () => this.actions.discard(it.path, group), true, busy === "discard-file" && hit);
      }

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

function entry(e: GitFileEntry, code: string): { path: string; code: string; origPath?: string } {
  // git reports a rename or copy as ONE entry with both paths; the old path is
  // carried through so the row can say "moved from where" instead of looking
  // like an unrelated addition.
  return { path: e.path, code: code === "." ? "M" : code, origPath: e.origPath };
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
  // `extra` carries mergeInProgress/rebaseInProgress through unchanged; they
  // are not derivable from the porcelain summary, which knows about unmerged
  // FILES but nothing about whether an operation is half-finished.
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
