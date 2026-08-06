import { ItemView, Notice, sanitizeHTMLToDom, setIcon, WorkspaceLeaf } from "obsidian";
import { html as diff2html } from "diff2html";
import { describeFileChange, type FileLogEntry } from "../git/historyParsers";
import { parseHunks, restoreHunk, type DiffHunk } from "../git/hunks";
import { markInvisibles } from "./DiffView";

export const NGB_FILE_HISTORY_VIEW = "native-git-bridge-file-history";

export interface FileHistoryActions {
  /** One page of commits touching this file; null when the operation failed. */
  loadPage(path: string, skip: number, limit: number): Promise<FileLogEntry[] | null>;
  /** The diff this commit introduced for the file. */
  loadCommitDiff(entry: FileLogEntry): Promise<{ diff: string; truncated: boolean } | null>;
  /** Current worktree text of the file, or null when it is binary/absent. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  /** Whole-file restore, with the confirmation the command already has. */
  restoreWholeFile(path: string, entry: FileLogEntry): void;
  /** Progress line of the operation currently in flight ("" when idle). */
  progressText(): string;
  wrapLines(): boolean;
  showInvisibles(): boolean;
}

/**
 * History of one file: the commits that touched it, each expandable into the
 * diff it introduced, with a restore button for the whole file and one per
 * diff block. Structurally the same as the repository history panel, which is
 * why it reuses its row classes; the difference is that every row here is the
 * same file at a different point in time.
 */
export class FileHistoryView extends ItemView {
  private path: string | null = null;
  private entries: FileLogEntry[] = [];
  private skip = 0;
  private readonly pageSize = 30;
  private exhausted = false;
  private loading = false;
  private expanded = new Set<string>();
  private listEl: HTMLElement | null = null;
  private moreBtn: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private actions: FileHistoryActions) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return NGB_FILE_HISTORY_VIEW;
  }
  getDisplayText(): string {
    const base = this.path?.split("/").pop();
    return base ? `History: ${base}` : "File history";
  }
  getIcon(): string {
    return "history";
  }

  override getState(): Record<string, unknown> {
    return { path: this.path };
  }

  override async setState(state: unknown, result: unknown): Promise<void> {
    const s = state as { path?: unknown } | null;
    if (s && typeof s.path === "string" && s.path !== this.path) {
      this.path = s.path;
      this.entries = [];
      this.skip = 0;
      this.exhausted = false;
      this.expanded.clear();
      this.renderShell();
      await this.loadMore();
    }
    return super.setState(state, result as never);
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    if (this.path !== null && this.entries.length === 0) await this.loadMore();
  }

  private renderShell(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view", "ngb-filehist-view");
    // The full path, on ONE line: it is the only thing identifying which file
    // this history belongs to, and wrapping it would push the commits down.
    const head = c.createDiv({ cls: "ngb-filehist-path ngb-mono" });
    head.setText(this.path ?? "");
    head.setAttribute("aria-label", this.path ?? "");
    this.listEl = c.createDiv({ cls: "ngb-hist-list" });
    const btns = c.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }

  private async loadMore(): Promise<void> {
    const path = this.path;
    if (path === null || this.loading) return;
    this.loading = true;
    const waiting = this.listEl?.createDiv({ cls: "ngb-filehist-waiting" });
    if (waiting) this.renderWaiting(waiting, "Loading history");
    const page = await this.actions.loadPage(path, this.skip, this.pageSize);
    waiting?.remove();
    this.loading = false;
    if (page === null) return;
    if (this.skip === 0 && page.length === 0) {
      this.listEl?.createEl("p", {
        cls: "ngb-settings-note",
        text: "No commits touch this file yet.",
      });
      return;
    }
    if (page.length < this.pageSize) this.exhausted = true;
    else this.moreBtn?.show();
    this.entries.push(...page);
    this.skip += page.length;
    for (const e of page) this.renderCommit(e);
  }

  /** The panel's own "the runner is working" indicator, repeated in place. */
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
    const id = this.registerInterval(window.setInterval(tick, 500));
    void id;
  }

  private renderCommit(e: FileLogEntry): void {
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
    // What actually happened to the file in this commit.
    titles.createDiv({ cls: "ngb-filehist-change", text: describeFileChange(e) });
    // Restore the whole file from this commit. The label may be clipped on a
    // narrow screen; the icon is a separate element and never is.
    const restore = header.createEl("button", { cls: "ngb-filehist-restore" });
    const ic = restore.createSpan({ cls: "ngb-filehist-restore-icon" });
    setIcon(ic, "rotate-ccw");
    restore.createSpan({ cls: "ngb-filehist-restore-label", text: "Restore file" });
    restore.setAttribute("aria-label", `Restore this file from ${e.hash.slice(0, 8)}`);
    restore.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.path !== null) this.actions.restoreWholeFile(this.path, e);
    });

    const body = wrap.createDiv({ cls: "ngb-filehist-body" });
    header.addEventListener("click", () => {
      if (this.expanded.has(e.hash)) {
        this.expanded.delete(e.hash);
        setIcon(chevron, "chevron-right");
        body.empty();
        return;
      }
      this.expanded.add(e.hash);
      setIcon(chevron, "chevron-down");
      void this.renderCommitDiff(body, e);
    });
    if (open) void this.renderCommitDiff(body, e);
  }

  private async renderCommitDiff(body: HTMLElement, e: FileLogEntry): Promise<void> {
    body.empty();
    this.renderWaiting(body.createDiv({ cls: "ngb-filehist-waiting" }), "Loading diff");
    const res = await this.actions.loadCommitDiff(e);
    if (!this.expanded.has(e.hash)) return; // collapsed while we waited
    body.empty();
    if (res === null) {
      body.createEl("p", { cls: "ngb-warning", text: "Could not load this diff." });
      return;
    }
    if (res.diff.trim() === "") {
      body.createEl("p", { cls: "ngb-settings-note", text: "No textual changes in this commit." });
      return;
    }
    const hunks = parseHunks(res.diff);
    const rendered = diff2html(res.diff, {
      drawFileList: false,
      diffStyle: "char",
      outputFormat: "line-by-line",
    });
    const pane = body.createDiv({ cls: "ngb-diff-view ngb-filehist-diff" });
    pane.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    pane.appendChild(sanitizeHTMLToDom(rendered));
    for (const tr of Array.from(pane.querySelectorAll("tr"))) {
      const gutter = tr.querySelector(".d2h-code-linenumber");
      const prefix = tr.querySelector(".d2h-code-line-prefix");
      if (gutter && prefix) gutter.appendChild(prefix);
    }
    if (this.actions.showInvisibles()) markInvisibles(pane);
    // One restore control per block, placed ABOVE its hunk in a bar of its
    // own (own background, interface font, full width) so it cannot be read
    // as part of the monospaced diff.
    const files = Array.from(pane.querySelectorAll(".d2h-file-wrapper"));
    const rows = files.length > 0 ? Array.from(files[0]!.querySelectorAll("tr")) : [];
    let hunkIndex = 0;
    for (const tr of rows) {
      if (tr.querySelector(".d2h-info") === null) continue;
      const hunk = hunks[hunkIndex++];
      if (hunk === undefined) continue;
      const bar = createDiv({ cls: "ngb-hunk-bar" });
      const b = bar.createEl("button", { cls: "ngb-hunk-restore" });
      const bi = b.createSpan({ cls: "ngb-filehist-restore-icon" });
      setIcon(bi, "rotate-ccw");
      b.createSpan({ text: "Restore this block" });
      b.setAttribute("aria-label", `Restore this block from ${e.hash.slice(0, 8)}`);
      b.addEventListener("click", () => void this.restoreBlock(hunk, e));
      tr.parentElement?.insertBefore(wrapRow(bar, tr), tr);
    }
    if (res.truncated) {
      body.createDiv({
        cls: "ngb-warning",
        text: "Diff truncated (too large). Restoring whole blocks may be incomplete.",
      });
    }
  }

  /** Put one block back the way this commit left it, or explain why not. */
  private async restoreBlock(hunk: DiffHunk, e: FileLogEntry): Promise<void> {
    const path = this.path;
    if (path === null) return;
    const current = await this.actions.readFile(path);
    if (current === null) {
      new Notice("This file cannot be edited here (binary or unreadable).");
      return;
    }
    const out = restoreHunk(current, hunk);
    if (!out.ok) {
      new Notice(
        "That block no longer matches the current file, so it was not touched. Restore the whole file version instead."
      );
      return;
    }
    if (!out.changed) {
      new Notice("This block already matches that commit.");
      return;
    }
    await this.actions.writeFile(path, out.text);
    new Notice(`Restored one block from ${e.hash.slice(0, 8)}.`);
  }
}

/** Wrap a bar element in a full-width table row so it can sit between hunks. */
function wrapRow(bar: HTMLElement, sibling: Element): HTMLElement {
  const tr = createEl("tr", { cls: "ngb-hunk-bar-row" });
  const td = tr.createEl("td");
  const cols = sibling.children.length || 2;
  td.setAttribute("colspan", String(cols));
  td.appendChild(bar);
  return tr;
}
