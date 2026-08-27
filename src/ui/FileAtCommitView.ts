import { ItemView, WorkspaceLeaf } from "obsidian";

export const NGB_FILE_AT_COMMIT_VIEW = "native-git-bridge-file-at-commit";

export interface FileAtCommitState {
  path: string;
  hash: string;
  /** Commit date, for the header line ("" when unknown). */
  date: string;
}

export interface FileAtCommitActions {
  /**
   * The file's text at the commit, or null when it is binary (or unreadable).
   * One `show-file-at-commit` round trip; errors are surfaced by the caller.
   */
  loadContent(path: string, hash: string): Promise<string | null>;
}

/**
 * One file, whole, as of one commit — in an Obsidian PANE. It answers the
 * same question the "File at commit" modal used to (the whole file at one
 * commit, not a comparison), moved into a pane on the user's ask
 * (2026-08-27): a modal cannot sit beside the note being edited, and this
 * reads as reference material, not as an interruption.
 *
 * Rendering is the diff table's own markup with one number column, always
 * wrapped — the same shape the modal used, so styles.css already covers it.
 */
export class FileAtCommitView extends ItemView {
  private atState: FileAtCommitState | null = null;

  constructor(leaf: WorkspaceLeaf, private actions: FileAtCommitActions) {
    super(leaf);
  }

  getViewType(): string {
    return NGB_FILE_AT_COMMIT_VIEW;
  }
  getDisplayText(): string {
    if (this.atState === null) return "File at commit";
    const cut = this.atState.path.lastIndexOf("/");
    return `${cut >= 0 ? this.atState.path.slice(cut + 1) : this.atState.path} @ ${this.atState.hash.slice(0, 8)}`;
  }
  getIcon(): string {
    return "eye";
  }

  async setState(state: unknown, result: unknown): Promise<void> {
    const s = state as Partial<FileAtCommitState> | null;
    if (s && typeof s.path === "string" && typeof s.hash === "string") {
      this.atState = { path: s.path, hash: s.hash, date: typeof s.date === "string" ? s.date : "" };
      await this.render();
    }
    await super.setState(state, result as never);
  }

  getState(): Record<string, unknown> {
    return { ...(this.atState ?? {}) };
  }

  private async render(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    if (this.atState === null) return;
    const { path, hash, date } = this.atState;
    c.createDiv({
      cls: "ngb-settings-note ngb-fac-head",
      text: `${path} @ ${hash.slice(0, 8)}${date !== "" ? ` · ${date.slice(0, 16).replace("T", " ")}` : ""}`,
    });
    const loading = c.createDiv({ cls: "ngb-settings-note", text: "Reading…" });
    const text = await this.actions.loadContent(path, hash);
    loading.remove();
    if (text === null) {
      c.createDiv({
        cls: "ngb-settings-note",
        text: "This version of the file is binary (or could not be read as text), so there is nothing to show here.",
      });
      return;
    }
    const box = c.createDiv({ cls: "ngb-diff-view ngb-diff-wrap ngb-preview-view" });
    const table = box
      .createDiv({ cls: "d2h-code-wrapper" })
      .createEl("table", { cls: "d2h-diff-table" });
    // Fixed layout reads widths from <col> (see diffDom's colgroup comment).
    const colgroup = table.createEl("colgroup");
    colgroup.createEl("col", { cls: "ngb-col-gutter" });
    colgroup.createEl("col");
    const tbody = table.createEl("tbody", { cls: "d2h-diff-tbody" });
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    const lines = body === "" ? [] : body.split("\n");
    lines.forEach((line, i) => {
      const tr = tbody.createEl("tr");
      const gutter = tr.createEl("td", { cls: "d2h-code-linenumber d2h-cntx" });
      gutter.createDiv({ cls: "line-num1", text: String(i + 1) });
      const code = tr.createEl("td", { cls: "d2h-cntx" }).createDiv({ cls: "d2h-code-line" });
      code.createSpan({ cls: "d2h-code-line-ctn", text: line.replace(/\r$/, "") });
    });
    // Same measurement the diff pane uses: fixed layout needs the column told.
    box.style.setProperty("--ngb-diff-gutter-w", `${String(Math.max(lines.length, 1)).length + 2}ch`);
    if (lines.length === 0) {
      box.createEl("p", { cls: "ngb-settings-note", text: "This version of the file is empty." });
    }
  }
}
