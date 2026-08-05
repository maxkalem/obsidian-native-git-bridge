import { App, Modal } from "obsidian";
import { placeModalAction } from "./modals";

/** Commit message input with explicit, labeled buttons. Resolves null on cancel. */
export class CommitMessageModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private opts: { title: string; placeholder: string; submitLabel: string; initial?: string },
    private onDone: (message: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.opts.title);
    const c = this.contentEl;
    const ta = c.createEl("textarea", { cls: "ngb-mono ngb-textarea-full" });
    ta.rows = 3;
    ta.placeholder = this.opts.placeholder;
    ta.value = this.opts.initial ?? "";
    const note = c.createDiv({ cls: "ngb-invalid" });
    const doSubmit = () => {
      const msg = ta.value.trim();
      if (msg.length === 0) {
        note.setText("Commit message must not be empty.");
        return;
      }
      if (msg.length > 1000) {
        note.setText("Commit message is longer than 1000 characters.");
        return;
      }
      this.resolved = true;
      this.close();
      this.onDone(msg);
    };
    // No Cancel button — the X closes and resolves null. The action button
    // carries the same check icon as the panel's commit button; top-left on
    // mobile, bottom-center on desktop.
    placeModalAction(this, { label: this.opts.submitLabel, icon: "check", onClick: doSubmit });
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doSubmit();
    });
    window.setTimeout(() => ta.focus(), 10);
  }

  onClose(): void {
    if (!this.resolved) this.onDone(null);
    this.contentEl.empty();
  }
}

/**
 * Conflict state: lists conflicted files, opens them, offers abort-merge after
 * explicit confirmation. Never auto-resolves, never picks ours/theirs.
 */
export class ConflictModal extends Modal {
  constructor(
    app: App,
    private conflicts: string[],
    private actions: {
      openFile: (path: string) => void;
      abortMerge: () => void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Merge conflicts — sync stopped");
    const c = this.contentEl;
    c.createDiv({
      cls: "ngb-warning",
      text:
        "Pulling produced merge conflicts. Nothing was pushed. Resolve the conflict markers in the files below " +
        "(then run Sync again), or abort the merge to return to the previous state.",
    });
    const ul = c.createEl("ul", { cls: "ngb-file-list" });
    for (const f of this.conflicts) {
      const li = ul.createEl("li");
      li.createSpan({ cls: "ngb-badge", text: "U" });
      const link = li.createEl("a", { text: f });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.close();
        this.actions.openFile(f);
      });
    }
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const abort = btns.createEl("button", { text: "Abort merge…", cls: "mod-warning" });
    abort.addEventListener("click", () => {
      this.close();
      this.actions.abortMerge();
    });
    const close = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
