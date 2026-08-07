import { ItemView, Notice, sanitizeHTMLToDom, setIcon, WorkspaceLeaf } from "obsidian";
import { html as diff2html } from "diff2html";
import { describeFileChange, type FileLogEntry } from "../git/historyParsers";
import { parseHunks, restoreHunk, type DiffHunk } from "../git/hunks";
import { markInvisibles, sizeGutter } from "./DiffView";
import { DIFF_COLOR_VARS } from "./colors";

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
  /** Show the file's full content as it was at this commit (read-only preview). */
  viewAtCommit(entry: FileLogEntry): void;
  /** Progress line of the operation currently in flight ("" when idle). */
  progressText(): string;
  wrapLines(): boolean;
  showInvisibles(): boolean;
  /** Custom colours as CSS variables, or null while the toggle is off. */
  colors(): Record<string, string> | null;
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
  /**
   * Diffs already fetched, by commit hash. Without it a theme switch or a
   * colour tweak re-ran `diff-file` in Termux for every expanded commit —
   * rerender() promises "no round trip" and now keeps that promise.
   */
  private diffCache = new Map<string, { diff: string; truncated: boolean } | null>();

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
    // Not "history": that is the repository panel's icon, and on a narrow tab
    // header the icon is what survives when the title is truncated.
    return "file-clock";
  }

  override getState(): Record<string, unknown> {
    return { path: this.path };
  }

  override async setState(state: unknown, result: unknown): Promise<void> {
    const s = state as { path?: unknown } | null;
    // Reload even when the path is unchanged: the panel is REUSED, so running
    // "show history" again after a commit used to redisplay the stale list
    // with no way to refresh it.
    if (s && typeof s.path === "string") {
      this.path = s.path;
      this.entries = [];
      this.diffCache.clear();
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

  /**
   * Redraw the loaded commits from memory — no Termux round trip. Used when a
   * display preference (wrap, invisibles, colours) or the theme changes, so
   * this panel follows them exactly like the diff pane does.
   */
  rerender(): void {
    if (this.path === null) return;
    const entries = this.entries;
    this.renderShell();
    for (const e of entries) this.renderCommit(e);
    if (!this.exhausted) this.moreBtn?.show();
  }

  private renderShell(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view", "ngb-filehist-view");
    // Same regions as the other two panels. This pane shares the
    // `ngb-status-view` class, which stops `.view-content` from scrolling, so
    // it MUST provide its own scrolling body — without one the commits past the
    // fold become unreachable with no scrollbar anywhere. It has no controls of
    // its own, so there is no bottom bar.
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    // The full path, on ONE line: it is the only thing identifying which file
    // this history belongs to, and wrapping it would push the commits down.
    // It stays in the head so it is still on screen deep into the history.
    const head = headEl.createDiv({ cls: "ngb-filehist-path ngb-mono" });
    head.setText(this.path ?? "");
    head.setAttribute("aria-label", this.path ?? "");
    this.listEl = body.createDiv({ cls: "ngb-hist-list" });
    const btns = body.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }

  private async loadMore(): Promise<void> {
    const path = this.path;
    if (path === null || this.loading || this.exhausted) return;
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
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn?.hide();
    } else {
      this.moreBtn?.show();
    }
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
    // Read-only preview of the whole file at this commit. It used to live in a
    // separate modal reachable only from the command palette; the panel is the
    // one place a file's history is answered, so it belongs here.
    const viewAt = header.createEl("button", { cls: "ngb-filehist-restore ngb-filehist-viewat" });
    const vi = viewAt.createSpan({ cls: "ngb-filehist-restore-icon" });
    setIcon(vi, "eye");
    viewAt.setAttribute("aria-label", `Show the file as it was at ${e.hash.slice(0, 8)}`);
    viewAt.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.actions.viewAtCommit(e);
    });
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

  /**
   * Obsidian calls this on every size change, including a rotation. The
   * embedded diffs are the same diff2html DOM the diff pane renders, and its
   * wrapped layout is measured, so they have to be re-measured here too.
   */
  override onResize(): void {
    for (const pane of Array.from(this.contentEl.querySelectorAll<HTMLElement>(".ngb-filehist-diff"))) {
      pane.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
      sizeGutter(pane);
    }
  }

  private async renderCommitDiff(body: HTMLElement, e: FileLogEntry): Promise<void> {
    body.empty();
    const cached = this.diffCache.get(e.hash);
    let res: { diff: string; truncated: boolean } | null;
    if (cached !== undefined) {
      res = cached;
    } else {
      this.renderWaiting(body.createDiv({ cls: "ngb-filehist-waiting" }), "Loading diff");
      res = await this.actions.loadCommitDiff(e);
      if (res !== null) this.diffCache.set(e.hash, res);
    }
    if (!this.expanded.has(e.hash)) return; // collapsed while we waited
    body.empty();
    if (res === null) {
      body.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      body.createEl("p", { cls: "ngb-ok", text: "No differences." });
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
    // Same measured gutter and the same optional colours as the diff pane:
    // this IS a diff pane, just embedded in a commit row.
    sizeGutter(pane);
    const colors = this.actions.colors();
    for (const name of DIFF_COLOR_VARS) {
      if (colors && colors[name]) pane.style.setProperty(name, colors[name]!);
      else pane.style.removeProperty(name);
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
