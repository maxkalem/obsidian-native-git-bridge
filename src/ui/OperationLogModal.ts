import { App, Modal } from "obsidian";
import { addCopyButton } from "./copyable";
import type { OperationLog } from "../ops/OperationLog";

export class OperationLogModal extends Modal {
  constructor(app: App, private log: OperationLog) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: operation log");
    const c = this.contentEl;
    const topBar = c.createDiv({ cls: "ngb-buttons ngb-buttons-top" });
    addCopyButton(topBar, () => this.logAsText(), "Copy log", "Log copied.");
    const clearTop = topBar.createEl("button", { text: "Clear log" });
    clearTop.addEventListener("click", () => {
      this.log.clear();
      this.close();
    });
    const entries = this.log.list();
    if (entries.length === 0) {
      c.createEl("p", { text: "Log is empty." });
    } else {
      const box = c.createDiv({ cls: "ngb-output" });
      for (const e of [...entries].reverse()) {
        const line = box.createDiv({ cls: "ngb-mono" });
        line.createSpan({
          text: `${e.ts} [${e.level}] ${e.action}: ${e.message}`,
          cls: e.level === "error" ? "ngb-status-error" : e.level === "warn" ? "ngb-status-waiting" : "",
        });
        if (e.detail) {
          const details = box.createEl("details", { cls: "ngb-details" });
          details.createEl("summary", { text: "detail" });
          details.createEl("pre", { text: e.detail, cls: "ngb-mono" });
        }
      }
    }
  }

  private logAsText(): string {
    return this.log
      .list()
      .map((e) => `${e.ts} [${e.level}] ${e.action}: ${e.message}${e.detail ? "\n  " + e.detail.replace(/\n/g, "\n  ") : ""}`)
      .join("\n");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
