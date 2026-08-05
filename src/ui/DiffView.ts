import { ItemView, sanitizeHTMLToDom, WorkspaceLeaf } from "obsidian";
import { html as diff2html } from "diff2html";

export const NGB_DIFF_VIEW = "native-git-bridge-diff";

/**
 * State of one diff pane. Serializable (getState/setState) so Obsidian can
 * restore the pane across restarts; the diff itself is re-fetched from the
 * runner on restore.
 */
export interface DiffViewState {
  path: string;
  /** Commit-ish (possibly with a trailing ^) the diff starts from. */
  from: string;
  /** Commit-ish or "WORKTREE". */
  to: string;
  /** Human description, e.g. "a1b2c3d4 → working tree". */
  label: string;
}

export interface DiffViewActions {
  /**
   * Fetch the unified diff text via the bridge. Returns null when the
   * operation failed (the error has already been surfaced to the user).
   */
  loadDiff(path: string, from: string, to: string): Promise<{ diff: string; truncated: boolean } | null>;
}

/**
 * File diff in a regular Obsidian pane (like obsidian-git's diff view), but
 * rendered in the obsidian-version-history-diff style: diff2html line-by-line
 * output with character-level intra-line highlighting (diffStyle "char").
 * git produces the unified diff in Termux; diff2html only renders it — no JS
 * git implementation is involved, and the HTML goes through Obsidian's
 * sanitizeHTMLToDom.
 */
export class DiffView extends ItemView {
  private state: DiffViewState | null = null;
  /** Guards against a stale fetch rendering over a newer one. */
  private loadSeq = 0;

  constructor(leaf: WorkspaceLeaf, private actions: DiffViewActions) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return NGB_DIFF_VIEW;
  }
  getDisplayText(): string {
    if (!this.state) return "Diff";
    const base = this.state.path.split("/").pop() ?? this.state.path;
    return `Diff: ${base}`;
  }
  getIcon(): string {
    return "file-diff";
  }

  override getState(): Record<string, unknown> {
    return { ...(this.state ?? {}) };
  }

  override async setState(state: unknown, result: unknown): Promise<void> {
    const s = state as Partial<DiffViewState> | null;
    if (s && typeof s.path === "string" && typeof s.from === "string" && typeof s.to === "string") {
      this.state = {
        path: s.path,
        from: s.from,
        to: s.to,
        label: typeof s.label === "string" ? s.label : `${s.from} → ${s.to}`,
      };
      await this.loadAndRender();
    }
    return super.setState(state, result as never);
  }

  private async loadAndRender(): Promise<void> {
    const st = this.state;
    if (!st) return;
    const seq = ++this.loadSeq;
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-diff-view");
    c.createDiv({ cls: "ngb-settings-note ngb-mono", text: `${st.path} · ${st.label}` });
    const box = c.createDiv({ cls: "ngb-diff-pane-body" });
    box.createEl("p", { cls: "ngb-settings-note", text: "Loading diff…" });
    const res = await this.actions.loadDiff(st.path, st.from, st.to);
    if (seq !== this.loadSeq) return; // superseded by a newer setState
    box.empty();
    if (res === null) {
      box.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      box.createEl("p", { cls: "ngb-ok", text: "No differences." });
      return;
    }
    const rendered = diff2html(res.diff, {
      drawFileList: false,
      diffStyle: "char",
      outputFormat: "line-by-line",
    });
    box.appendChild(sanitizeHTMLToDom(rendered));
    if (res.truncated) {
      box.createDiv({
        cls: "ngb-warning",
        text: "Diff truncated (too large). The full diff is available via git in Termux.",
      });
    }
  }

  async onOpen(): Promise<void> {
    // setState drives rendering; nothing to draw for a bare pane.
    if (!this.state) {
      this.contentEl.createEl("p", { cls: "ngb-settings-note", text: "No diff selected." });
    }
  }
}
