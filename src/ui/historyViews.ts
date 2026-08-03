import { App, Modal, Notice } from "obsidian";
import type { FileLogEntry } from "../git/historyParsers";

/** Plain-text preview of a file version (mono, scrollable). */
export class TextPreviewModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private meta: string,
    private text: string
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    c.createDiv({ cls: "ngb-settings-note", text: this.meta });
    const box = c.createDiv({ cls: "ngb-output ngb-output-tall" });
    box.createEl("pre", { text: this.text });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Unified diff rendering with +/- line coloring. */
export class DiffModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private meta: string,
    private diffText: string,
    private truncated: boolean
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    c.createDiv({ cls: "ngb-settings-note", text: this.meta });
    if (this.diffText.trim() === "") {
      c.createEl("p", { cls: "ngb-ok", text: "No differences." });
      return;
    }
    const box = c.createDiv({ cls: "ngb-output ngb-output-tall ngb-diff" });
    for (const line of this.diffText.split("\n")) {
      const cls =
        line.startsWith("+") && !line.startsWith("+++")
          ? "ngb-diff-add"
          : line.startsWith("-") && !line.startsWith("---")
            ? "ngb-diff-del"
            : line.startsWith("@@")
              ? "ngb-diff-hunk"
              : line.startsWith("diff ") || line.startsWith("index ") ||
                  line.startsWith("+++") || line.startsWith("---")
                ? "ngb-diff-meta"
                : "";
      box.createDiv({ cls: `ngb-diff-line ${cls}`, text: line === "" ? " " : line });
    }
    if (this.truncated) {
      c.createDiv({ cls: "ngb-warning", text: "Diff truncated (too large). Full diff is available via git in Termux." });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface HistoryActions {
  loadPage(skip: number, limit: number): Promise<FileLogEntry[] | null>;
  viewAt(entry: FileLogEntry): void;
  diffVsCurrent(entry: FileLogEntry): void;
  diffVsPrevious(entry: FileLogEntry, prev: FileLogEntry): void;
  restore(entry: FileLogEntry): void;
}

/** Paginated history list for one file with per-commit actions. */
export class FileHistoryModal extends Modal {
  private entries: FileLogEntry[] = [];
  private skip = 0;
  private readonly pageSize = 30;
  private listEl!: HTMLElement;
  private moreBtn!: HTMLButtonElement;
  private exhausted = false;

  constructor(
    app: App,
    private filePath: string,
    private actions: HistoryActions
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("History");
    const c = this.contentEl;
    c.createDiv({ cls: "ngb-settings-note ngb-mono", text: this.filePath });
    this.listEl = c.createDiv();
    const btns = c.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    void this.loadMore();
  }

  private async loadMore(): Promise<void> {
    this.moreBtn.disabled = true;
    this.moreBtn.setText("Loading…");
    const page = await this.actions.loadPage(this.skip, this.pageSize);
    this.moreBtn.disabled = false;
    this.moreBtn.setText("Load more");
    if (page === null) return; // error already shown by caller
    if (this.skip === 0 && page.length === 0) {
      this.listEl.createEl("p", { text: "No history for this file (not committed yet?)." });
      this.moreBtn.hide();
      return;
    }
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn.hide();
    }
    const startIndex = this.entries.length;
    this.entries.push(...page);
    this.skip += page.length;
    page.forEach((e, i) => this.renderRow(e, startIndex + i));
  }

  private renderRow(e: FileLogEntry, index: number): void {
    const row = this.listEl.createDiv({ cls: "ngb-history-row" });
    const head = row.createDiv();
    head.createSpan({ cls: "ngb-badge", text: e.hash.slice(0, 8) });
    head.createSpan({ text: ` ${e.date.slice(0, 16).replace("T", " ")} · ${e.author}` , cls: "ngb-settings-note"});
    row.createDiv({ text: e.subject });
    if (e.pathAtCommit !== this.filePath) {
      row.createDiv({ cls: "ngb-settings-note ngb-mono", text: `as: ${e.pathAtCommit}` });
    }
    const acts = row.createDiv({ cls: "ngb-history-actions" });
    const mk = (label: string, cb: () => void, danger = false) => {
      const b = acts.createEl("button", { text: label, cls: danger ? "mod-warning" : "" });
      b.addEventListener("click", cb);
    };
    mk("View", () => this.actions.viewAt(e));
    mk("Diff vs now", () => this.actions.diffVsCurrent(e));
    const prev = this.entries[index + 1];
    mk("Diff vs previous", () => {
      const p = this.entries[index + 1];
      if (p) this.actions.diffVsPrevious(e, p);
      else if (this.exhausted) new Notice("This is the oldest known commit for the file.");
      else new Notice("Load more history first (the previous commit is not loaded yet).");
    });
    void prev;
    mk("Restore…", () => this.actions.restore(e), true);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
