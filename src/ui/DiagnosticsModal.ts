import { App, Modal } from "obsidian";

export interface DiagnosticsReport {
  pluginSide: Record<string, string>;
  runnerSide?: Record<string, string>;
  problems: string[];
}

export class DiagnosticsModal extends Modal {
  constructor(app: App, private report: DiagnosticsReport) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: diagnostics");
    const c = this.contentEl;

    if (this.report.problems.length > 0) {
      const warn = c.createDiv({ cls: "ngb-warning" });
      warn.createEl("strong", { text: "Problems found:" });
      const ul = warn.createEl("ul", { cls: "ngb-file-list" });
      for (const p of this.report.problems) ul.createEl("li", { text: p });
    } else {
      c.createEl("p", { cls: "ngb-ok", text: "No problems detected." });
    }

    const renderKv = (title: string, data: Record<string, string>) => {
      const sec = c.createDiv({ cls: "ngb-section" });
      sec.createEl("h3", { text: title });
      const kv = sec.createDiv({ cls: "ngb-kv" });
      for (const [k, v] of Object.entries(data)) {
        kv.createDiv({ cls: "k", text: k });
        kv.createDiv({ cls: "ngb-mono", text: v });
      }
    };
    renderKv("Plugin (this device)", this.report.pluginSide);
    if (this.report.runnerSide) renderKv("Termux runner", this.report.runnerSide);
    else
      c.createEl("p", {
        cls: "ngb-settings-note",
        text: "Runner-side diagnostics unavailable (no response from Termux — run the GitBridge shortcut or check the integration settings).",
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
