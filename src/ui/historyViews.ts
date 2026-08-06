import { App, Modal } from "obsidian";

/*
 * What used to live here: a DiffModal that rendered a unified diff as coloured
 * lines, and a FileHistoryModal that listed a file's commits with View / Diff /
 * Restore buttons. Both were replaced by panes (DiffView, FileHistoryView),
 * which render the same data with diff2html, honour the display preferences
 * and can restore a single block. Keeping the modals meant the command palette
 * answered the same question with a different-looking UI, so they are gone;
 * the whole-file preview below is the one piece that had no equivalent.
 */

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
