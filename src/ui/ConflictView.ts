import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { CONFLICT_COLOR_VARS } from "./colors";
import { markInvisibles } from "./DiffView";
import { parseConflictFile, resolveBlock, type ParsedConflictFile } from "../git/conflictParser";

export const NGB_CONFLICT_VIEW = "native-git-bridge-conflict";

export interface ConflictViewActions {
  /** File content, or null when the file is binary/unreadable. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /** Stage the file — for a conflicted path this marks it resolved. */
  stageFile(path: string): Promise<void>;
  /**
   * Shared preference: show the RAW marker lines (<<<<<<< / ======= /
   * >>>>>>>) as file content, with the side labels and Keep buttons rendered
   * as separate chrome rows. Off (default) hides the markers underneath the
   * chrome rows.
   */
  markersVisible(): boolean;
  /** Shared preference: render whitespace glyphs (· → ␍), as in the diff pane. */
  showInvisibles(): boolean;
  /**
   * Shared preference: custom colours as CSS variables, or null while the
   * "custom colours" toggle is off (the theme's own values then apply).
   */
  colors(): Record<string, string> | null;
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

  /** Path this pane is resolving (whole-file resolution closes matching panes). */
  get filePath(): string | null {
    return this.path;
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

  /**
   * Custom colours (shared preference, off by default) as inline CSS
   * variables — the only way to beat the stylesheet's defaults on the same
   * element. Removing them hands the pane back to the theme, no reload needed.
   */
  private applyColors(): void {
    const c = this.actions.colors();
    for (const name of CONFLICT_COLOR_VARS) {
      if (c && c[name]) this.contentEl.style.setProperty(name, c[name]!);
      else this.contentEl.style.removeProperty(name);
    }
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
    this.applyColors();
    const path = this.path;
    if (path === null) {
      c.createEl("p", { cls: "ngb-settings-note", text: "No file selected." });
      return;
    }
    const head = c.createDiv({ cls: "ngb-pane-path", text: path });
    head.setAttribute("aria-label", path);
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
          // The job here is done — leaving a stale resolution pane open
          // only confused people.
          this.leaf.detach();
        })();
      });
      return;
    }
    c.createEl("p", {
      cls: "ngb-settings-note",
      text: `${this.parsed.conflictCount} conflict${this.parsed.conflictCount === 1 ? "" : "s"} — pick a side per block. Other lines stay untouched.`,
    });
    const list = c.createDiv({ cls: "ngb-conf-list" });
    const rawMarkers = this.actions.markersVisible();
    let lineNo = 1;
    /** A physical file line: exactly ONE number per line (wraps continue with an empty gutter). */
    const row = (num: number | null, text: string, cls: string) => {
      const r = list.createDiv({ cls: `ngb-conf-row ${cls}` });
      r.createSpan({ cls: "ngb-conf-num", text: num === null ? "" : String(num) });
      r.createSpan({ cls: "ngb-conf-text", text: text === "" ? " " : text });
      return r;
    };
    /**
     * Chrome row (side label + Keep button): visually unmistakable for file
     * content — own background, chip-styled label, button pinned right, no
     * overlap. With markers hidden it carries the marker line's NUMBER; with
     * raw markers shown it carries ▸ instead, so an un-numbered chrome row
     * can never be misread as a wrapped continuation of a file line.
     */
    const chromeRow = (
      num: number | null,
      chip: string,
      sideCls: string,
      btnLabel: string,
      onKeep: () => void
    ) => {
      const r = list.createDiv({ cls: `ngb-conf-row ngb-conf-marker ${sideCls}` });
      r.createSpan({
        cls: `ngb-conf-num${num === null ? " ngb-conf-num-chrome" : ""}`,
        text: num === null ? "▸" : String(num),
      });
      const body = r.createDiv({ cls: "ngb-conf-marker-body" });
      body.createSpan({ cls: "ngb-conf-side-chip", text: chip });
      const b = body.createEl("button", { text: btnLabel, cls: "ngb-conf-keep" });
      b.addEventListener("click", onKeep);
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
      const oursChip = `LOCAL — yours (${seg.oursLabel || "HEAD"})`;
      const theirsChip = `REMOTE — theirs${remote ? ` (${remote})` : ""}`;
      const keepOursLabel = "Keep local";
      const keepTheirsLabel = remote ? `Keep remote (${remote})` : "Keep remote";
      const keepOurs = () => void this.applyResolution(idx, "ours");
      const keepTheirs = () => void this.applyResolution(idx, "theirs");

      if (rawMarkers) {
        row(lineNo++, `<<<<<<< ${seg.oursLabel}`.trimEnd(), "ngb-conf-raw ngb-conf-ours");
        chromeRow(null, oursChip, "ngb-conf-ours-head", keepOursLabel, keepOurs);
      } else {
        chromeRow(lineNo++, oursChip, "ngb-conf-ours-head", keepOursLabel, keepOurs);
      }
      for (const l of seg.ours) row(lineNo++, l, "ngb-conf-ours");
      if (seg.base !== undefined) {
        row(lineNo++, rawMarkers ? "|||||||" : "……… common ancestor:", "ngb-conf-base ngb-conf-raw");
        for (const l of seg.base) row(lineNo++, l, "ngb-conf-base");
      }
      row(lineNo++, rawMarkers ? "=======" : "———", "ngb-conf-divider ngb-conf-raw");
      for (const l of seg.theirs) row(lineNo++, l, "ngb-conf-theirs");
      if (rawMarkers) {
        row(lineNo++, `>>>>>>> ${seg.theirsLabel}`.trimEnd(), "ngb-conf-raw ngb-conf-theirs");
        chromeRow(null, theirsChip, "ngb-conf-theirs-head", keepTheirsLabel, keepTheirs);
      } else {
        chromeRow(lineNo++, theirsChip, "ngb-conf-theirs-head", keepTheirsLabel, keepTheirs);
      }
    }
    // Same preference, same glyphs as the diff pane. Whitespace-only
    // differences are a common reason two sides of a conflict look identical,
    // so hiding them here while showing them in the diff made no sense.
    if (this.actions.showInvisibles()) markInvisibles(list, ".ngb-conf-text");
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
