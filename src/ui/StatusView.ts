import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";
import type { GitFileEntry, GitStatusSummary, SparseStateSummary } from "../types";
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
  sparse?: SparseStateSummary;
  activeOperation?: string;
  /** Progress line shown at the bottom while an operation runs. */
  progress?: string;
  /** Action currently running; its toolbar button is animated. */
  runningAction?: string;
  lastSyncAt?: string;
  fetchedAt?: string;
  bridge: string;
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
  openLog: () => void;
  cancel: () => void;
  openFile: (path: string) => void;
  stage: (path: string) => void;
  unstage: (path: string) => void;
  discard: (path: string) => void;
}

type Group = "conflicted" | "staged" | "unstaged" | "untracked";

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
  private collapsed: Record<Group, boolean> = {
    conflicted: false,
    staged: false,
    unstaged: false,
    untracked: true,
  };

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
        // Travelling highlight along the arrow: down for pull/fetch, up for push.
        applySweepIcon(b, anim === "sweep-down" ? "down" : "up");
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
    this.renderGroup(c, "conflicted", "Conflicts", d.conflicted.map((e) => entry(e, "U")), true);
    this.renderGroup(c, "staged", "Staged changes", d.staged.map((e) => entry(e, e.index)), false);
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
    const kv = foot.createDiv({ cls: "ngb-kv" });
    const row = (k: string, v: string) => {
      kv.createDiv({ cls: "k", text: k });
      kv.createDiv({ text: v });
    };
    if (d.sparse) {
      row("Sparse", d.sparse.enabled ? `on (${d.sparse.patterns.length} rules)` : "off");
      row("Hidden files", String(d.sparse.skipWorktreeCount));
    }
    row("Bridge", d.bridge);
    row("Last sync", d.lastSyncAt ?? "never");
    if (d.fetchedAt) row("Updated", d.fetchedAt);

    const footActions = foot.createDiv({ cls: "ngb-sv-foot-actions" });
    const logBtn = footActions.createEl("button", { cls: "ngb-sv-foot-btn" });
    setIcon(logBtn.createSpan(), "file-clock");
    logBtn.createSpan({ text: " Operation log" });
    logBtn.addEventListener("click", this.actions.openLog);

    if (d.progress) {
      const p = foot.createDiv({ cls: "ngb-sv-progress" });
      p.createSpan({ text: d.progress });
      const cancel = p.createEl("button", { text: "Cancel", cls: "ngb-sv-cancel" });
      cancel.addEventListener("click", this.actions.cancel);
    }
  }

  private renderGroup(
    parent: HTMLElement,
    group: Group,
    title: string,
    items: { path: string; code: string }[],
    danger: boolean
  ): void {
    if (items.length === 0) return;
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
    for (const it of items) {
      const rowEl = list.createDiv({ cls: "ngb-sv-file" });
      const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
      main.createSpan({ cls: `ngb-badge ngb-code-${it.code}`, text: it.code });
      const name = main.createSpan({ cls: "ngb-sv-file-name", text: shortName(it.path) });
      name.setAttribute("aria-label", `${it.path} — ${CHANGE_LABEL[it.code] ?? it.code}`);
      main.addEventListener("click", () => this.actions.openFile(it.path));
      main.createSpan({ cls: "ngb-sv-file-kind", text: CHANGE_LABEL[it.code] ?? it.code });

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
      const busy = this.data?.runningAction;
      if (group === "staged") {
        act("minus", "Unstage", () => this.actions.unstage(it.path), false, busy === "unstage-file");
      } else {
        act("plus", "Stage", () => this.actions.stage(it.path), false, busy === "stage-file");
      }
      act("undo-2", "Discard changes", () => this.actions.discard(it.path), true, busy === "discard-file");
    }
  }
}

function entry(e: GitFileEntry, code: string): { path: string; code: string } {
  return { path: e.path, code: code === "." ? "M" : code };
}

function shortName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function stateLabel(state: string): string {
  switch (state) {
    case "clean":
      return "Clean";
    case "changed":
      return "Local changes";
    case "syncing":
      return "Working…";
    case "waiting-tap":
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
    "state" | "branch" | "ahead" | "behind" | "staged" | "unstaged" | "untracked" | "conflicted"
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
    conflicted: s.conflicted,
    ...extra,
  };
}
