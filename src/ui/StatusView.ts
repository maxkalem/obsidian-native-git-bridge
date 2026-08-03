import { ItemView, WorkspaceLeaf } from "obsidian";
import type { GitStatusSummary, SparseStateSummary } from "../types";

export const NGB_STATUS_VIEW = "native-git-bridge-status";

export interface StatusViewData {
  state: string;
  branch?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  sparse?: SparseStateSummary;
  activeOperation?: string;
  lastSyncAt?: string;
  fetchedAt?: string;
  bridge: string;
}

/**
 * Sidebar status panel. Obsidian's status bar is unreliable/hidden on mobile,
 * so this view is the primary always-visible status surface on Android.
 */
export class StatusView extends ItemView {
  private data: StatusViewData | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private actions: {
      refresh: () => void;
      sync: () => void;
      showChanged: () => void;
      openLog: () => void;
    }
  ) {
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

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view");
    const d = this.data;

    const header = c.createDiv({ cls: "ngb-sv-header" });
    header.createSpan({ cls: `ngb-sv-dot ngb-sv-${d?.state ?? "unknown"}` });
    header.createSpan({ cls: "ngb-sv-state", text: d ? stateLabel(d.state) : "not checked yet" });

    const btns = c.createDiv({ cls: "ngb-sv-actions" });
    const mk = (label: string, cb: () => void, cta = false) => {
      const b = btns.createEl("button", { text: label, cls: cta ? "mod-cta" : "" });
      b.addEventListener("click", cb);
    };
    mk("Refresh", this.actions.refresh, true);
    mk("Sync", this.actions.sync);
    mk("Changes", this.actions.showChanged);
    mk("Log", this.actions.openLog);

    if (!d) {
      c.createEl("p", { cls: "ngb-settings-note", text: "Press Refresh to query native Git." });
      return;
    }

    const kv = c.createDiv({ cls: "ngb-kv" });
    const row = (k: string, v: string) => {
      kv.createDiv({ cls: "k", text: k });
      kv.createDiv({ text: v });
    };
    row("Branch", d.branch ?? "—");
    row("Ahead / behind", `${d.ahead} / ${d.behind}`);
    row("Staged", String(d.staged));
    row("Unstaged", String(d.unstaged));
    row("Untracked", String(d.untracked));
    row("Conflicted", String(d.conflicted));
    if (d.sparse) {
      row("Sparse", d.sparse.enabled ? `on (${d.sparse.patterns.length} rules)` : "off");
      row("Skip-worktree", String(d.sparse.skipWorktreeCount));
    }
    row("Bridge", d.bridge);
    row("Operation", d.activeOperation ?? "idle");
    row("Last sync", d.lastSyncAt ?? "never");
    if (d.fetchedAt) row("Updated", d.fetchedAt);
  }
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
  extra: Omit<StatusViewData, "state" | "branch" | "ahead" | "behind" | "staged" | "unstaged" | "untracked" | "conflicted">,
  state: string
): StatusViewData {
  return {
    state,
    branch: s.detached ? "(detached)" : s.branch,
    ahead: s.ahead,
    behind: s.behind,
    staged: s.staged.length,
    unstaged: s.unstaged.length,
    untracked: s.untracked.length,
    conflicted: s.conflicted.length,
    ...extra,
  };
}
