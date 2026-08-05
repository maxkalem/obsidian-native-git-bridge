import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { parseConflictFile, resolveBlock, type ParsedConflictFile } from "../git/conflictParser";

export const NGB_CONFLICT_VIEW = "native-git-bridge-conflict";

export interface ConflictViewActions {
  /** File content, or null when the file is binary/unreadable. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /** Stage the file — for a conflicted path this marks it resolved. */
  stageFile(path: string): Promise<void>;
}

/**
 * Per-block merge-conflict resolution for TEXT files. The working-tree file
 * (with git's conflict markers) is rendered with real file line numbers;
 * every block shows its "ours" and "theirs" sides with a Keep button on the
 * marker rows. Lines wrap (no horizontal scrolling), so the buttons can never
 * scroll out of reach. The bridge never picks a side by itself — every
 * resolution here is an explicit user tap, written back through the vault.
 */
export class ConflictView extends ItemView {
  private path: string | null = null;
  /** Content as last read; guards against clobbering outside edits. */
  private originalText: string | null = null;
  private parsed: ParsedConflictFile | null = null;
  private loadSeq = 0;

  constructor(leaf: WorkspaceLeaf, private actions: ConflictViewActions) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return NGB_CONFLICT_VIEW;
  }
  getDisplayText(): string {
    const base = this.path?.split("/").pop();
    return base ? `Conflict: ${base}` : "Conflict";
  }
  getIcon(): string {
    return "alert-triangle";
  }

  override getState(): Record<string, unknown> {
    return { path: this.path };
  }

  override async setState(state: unknown, result: unknown): Promise<void> {
    const s = state as { path?: unknown } | null;
    if (s && typeof s.path === "string") {
      this.path = s.path;
      await this.reload();
    }
    return super.setState(state, result as never);
  }

  async reload(): Promise<void> {
    const path = this.path;
    if (path === null) return;
    const seq = ++this.loadSeq;
    const text = await this.actions.readFile(path);
    if (seq !== this.loadSeq) return;
    this.originalText = text;
    this.parsed = text === null ? null : parseConflictFile(text);
    this.render();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-conflict-view");
    const path = this.path;
    if (path === null) {
      c.createEl("p", { cls: "ngb-settings-note", text: "No file selected." });
      return;
    }
    c.createDiv({ cls: "ngb-settings-note ngb-mono", text: path });
    if (this.originalText === null || this.parsed === null) {
      c.createEl("p", {
        cls: "ngb-warning",
        text: "This file cannot be shown here (binary or unreadable). Use the file's context menu: keep ours / keep theirs / open in the default app.",
      });
      return;
    }
    if (this.parsed.conflictCount === 0) {
      c.createEl("p", { cls: "ngb-ok", text: "No conflict markers left in this file." });
      const btns = c.createDiv({ cls: "ngb-buttons" });
      const stage = btns.createEl("button", { text: "Mark resolved (stage this file)", cls: "mod-cta" });
      stage.addEventListener("click", () => {
        void (async () => {
          await this.actions.stageFile(path);
          new Notice("Marked resolved.");
        })();
      });
      return;
    }
    c.createEl("p", {
      cls: "ngb-settings-note",
      text: `${this.parsed.conflictCount} conflict${this.parsed.conflictCount === 1 ? "" : "s"} — pick a side per block. Other lines stay untouched.`,
    });
    const list = c.createDiv({ cls: "ngb-conf-list" });
    let lineNo = 1;
    const row = (num: number | null, text: string, cls: string, gutterCls = "") => {
      const r = list.createDiv({ cls: `ngb-conf-row ${cls}` });
      r.createSpan({ cls: `ngb-conf-num ${gutterCls}`, text: num === null ? "" : String(num) });
      r.createSpan({ cls: "ngb-conf-text", text: text === "" ? " " : text });
      return r;
    };
    const markerRow = (
      num: number,
      label: string,
      cls: string,
      btnLabel: string | null,
      onKeep: (() => void) | null
    ) => {
      const r = list.createDiv({ cls: `ngb-conf-row ngb-conf-marker ${cls}` });
      r.createSpan({ cls: "ngb-conf-num", text: String(num) });
      const body = r.createDiv({ cls: "ngb-conf-marker-body" });
      body.createSpan({ cls: "ngb-conf-marker-label", text: label });
      if (btnLabel !== null && onKeep !== null) {
        const b = body.createEl("button", { text: btnLabel, cls: "ngb-conf-keep" });
        b.addEventListener("click", onKeep);
      }
    };
    for (const seg of this.parsed.segments) {
      if (seg.kind === "text") {
        for (const l of seg.lines) row(lineNo++, l, "");
        continue;
      }
      const idx = seg.index;
      // Say WHO the conflict is with: "local (yours)" vs "remote" plus the
      // incoming side's marker label — a branch name, or the first characters
      // of the merged commit's hash.
      const remote = shortRefLabel(seg.theirsLabel);
      markerRow(
        lineNo++,
        `Local — yours (${seg.oursLabel || "HEAD"})`,
        "ngb-conf-ours-head",
        "Keep local (yours)",
        () => void this.applyResolution(idx, "ours")
      );
      for (const l of seg.ours) row(lineNo++, l, "ngb-conf-ours");
      if (seg.base !== undefined) {
        row(lineNo++, "……… common ancestor:", "ngb-conf-base ngb-conf-base-head");
        for (const l of seg.base) row(lineNo++, l, "ngb-conf-base");
      }
      row(lineNo++, "———", "ngb-conf-divider");
      for (const l of seg.theirs) row(lineNo++, l, "ngb-conf-theirs");
      markerRow(
        lineNo++,
        `Remote — theirs${remote ? ` (${remote})` : ""}`,
        "ngb-conf-theirs-head",
        remote ? `Keep remote (${remote})` : "Keep remote",
        () => void this.applyResolution(idx, "theirs")
      );
    }
  }

  private async applyResolution(blockIndex: number, side: "ours" | "theirs"): Promise<void> {
    const path = this.path;
    if (path === null || this.parsed === null || this.originalText === null) return;
    // The file may have been edited elsewhere since we read it (Obsidian
    // editor, sync, another device). Never overwrite unseen changes.
    const current = await this.actions.readFile(path);
    if (current !== this.originalText) {
      new Notice("The file changed on disk — reloading instead of overwriting.");
      await this.reload();
      return;
    }
    const next = resolveBlock(this.parsed, blockIndex, side);
    await this.actions.writeFile(path, next);
    await this.reload();
  }
}

/**
 * Human identification of the incoming side from the `>>>>>>>` marker label:
 * a bare commit hash is abbreviated to its first 8 characters, a branch/ref
 * name is kept (trimmed if very long), and an empty label stays empty.
 */
export function shortRefLabel(label: string): string {
  const l = label.trim();
  if (/^[0-9a-f]{12,40}$/i.test(l)) return l.slice(0, 8);
  return l.length > 24 ? `${l.slice(0, 24)}…` : l;
}
