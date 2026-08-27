import { App, Modal, Notice, setIcon } from "obsidian";
import { placeModalAction, renderFileBadge } from "./modals";
import { TEMPLATE_VARIABLES } from "../git/commitMessage";

/** Commit message input with explicit, labeled buttons. Resolves null on cancel. */
export class CommitMessageModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private opts: {
      title: string;
      placeholder: string;
      submitLabel: string;
      initial?: string;
      /**
       * Two pickers under the input (the user's design, 2026-08-27, second
       * round): "Recent messages" and "Templates", side by side, opening one
       * CLOSES the other, and a picked entry APPENDS to the text instead of
       * replacing it, so a message can be composed from pieces. Entries are
       * RAW template text — variables like {{date}} stay visible here and
       * are substituted at commit time, which the ? button explains.
       */
      recents?: string[];
      templates?: string[];
      /** Show the ? button that lists the usable variables. */
      showVariablesHelp?: boolean;
    },
    /** May be async. See the note on ConfirmModal's `onDecision`. */
    private onDone: (message: string | null) => void | Promise<void>
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
    // Two STANDARD dropdowns side by side (the user's pick after the custom
    // list: native selects, whose platform picker guarantees only one is open
    // at a time). Choosing an entry APPENDS it to the message — with a space
    // when one is needed — and the select snaps back to its label; closing
    // the picker without choosing adds nothing. Both are always present so
    // the layout never changes; an empty one is disabled rather than absent.
    const recents = this.opts.recents ?? [];
    const templates = this.opts.templates ?? [];
    if (recents.length > 0 || templates.length > 0) {
      const row = c.createDiv({ cls: "ngb-msg-pick-row" });
      const picker = (label: string, items: string[]) => {
        const sel = row.createEl("select", { cls: "dropdown ngb-msg-pick" });
        sel.createEl("option", { text: label, value: "" });
        if (items.length === 0) {
          sel.disabled = true;
          return;
        }
        for (const s of items) sel.createEl("option", { text: s, value: s });
        sel.addEventListener("change", () => {
          if (sel.value === "") return;
          const cur = ta.value;
          ta.value = cur === "" || /\s$/.test(cur) ? cur + sel.value : `${cur} ${sel.value}`;
          sel.value = "";
          ta.focus();
        });
      };
      picker("Recent messages…", recents);
      picker("Templates…", templates);
    }
    if (this.opts.showVariablesHelp === true) {
      // The ? sits in the modal's own corner (the user's mock): what the
      // {{…}} variables mean, one modal away, with each token copyable.
      const help = this.modalEl.createEl("button", { cls: "clickable-icon ngb-msg-help" });
      help.setAttribute("aria-label", "Which variables can a message use?");
      setIcon(help, "help-circle");
      help.addEventListener("click", () => new TemplateVarsModal(this.app).open());
    }
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
      // See ConfirmModal.onDecision: the modal does not wait for what the
      // caller does with the message.
      void this.onDone(msg);
    };
    // No Cancel button — the X closes and resolves null. The action button
    // carries the same check icon as the panel's commit button; top-left on
    // mobile, bottom-center on desktop.
    placeModalAction(this, {
      label: this.opts.submitLabel,
      icon: "check",
      hasInput: true,
      onClick: doSubmit,
    });
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doSubmit();
    });
    window.setTimeout(() => ta.focus(), 10);
  }

  onClose(): void {
    if (!this.resolved) void this.onDone(null);
    this.contentEl.empty();
  }
}

/**
 * THE ONE window for adding a template, wherever the add starts (a trigger
 * slot's "+ New template…", the manager's add button): the destination is
 * always the shared list in data.json, so the window is shared too (the
 * user's rule, 2026-08-27). Carries the ? that explains the variables.
 */
export function promptNewTemplate(app: App, onSave: (template: string) => void | Promise<void>): void {
  new CommitMessageModal(
    app,
    {
      title: "New template",
      placeholder: "Commit message… ({{date}} allowed)",
      submitLabel: "Save",
      showVariablesHelp: true,
    },
    async (msg) => {
      if (msg !== null) await onSave(msg);
    }
  ).open();
}

/**
 * The template list's own window (settings shows only a count and a button):
 * one editable row per template with a delete button, and an add row — a list
 * of any length stopped fitting the settings page (the user's report). Every
 * change is saved immediately through the callbacks; `onChanged` lets the
 * settings tab refresh the trigger dropdowns behind it.
 */
export class TemplateManagerModal extends Modal {
  constructor(
    app: App,
    private io: {
      get(): string[];
      set(next: string[]): Promise<void>;
      onChanged(): void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Message templates");
    this.render();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.createDiv({
      cls: "ngb-settings-note",
      text: "Each row is one template; the commit window and the three automatic triggers pick from this list. Shared across devices.",
    });
    const list = this.io.get();
    for (let i = 0; i < list.length; i++) {
      const row = c.createDiv({ cls: "ngb-tpl-row" });
      const input = row.createEl("input", { cls: "ngb-tpl-input" });
      input.type = "text";
      input.value = list[i]!;
      input.addEventListener("change", () => {
        const next = [...this.io.get()];
        next[i] = input.value;
        void this.io.set(next).then(() => this.io.onChanged());
      });
      const del = row.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
      del.setAttribute("aria-label", "Delete this template");
      setIcon(del, "trash");
      del.addEventListener("click", () => {
        void this.io
          .set(this.io.get().filter((_, j) => j !== i))
          .then(() => {
            this.io.onChanged();
            this.render();
          });
      });
    }
    const addRow = c.createDiv({ cls: "ngb-tpl-row" });
    const add = addRow.createEl("button", { text: "Add template…", cls: "mod-cta" });
    add.addEventListener("click", () =>
      promptNewTemplate(this.app, async (t) => {
        await this.io.set([...this.io.get(), t]);
        this.io.onChanged();
        this.render();
      })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * The commit window's ? answer: every variable a message may carry, what it
 * becomes, and a copy button per token — substitution happens at commit
 * time, in typed messages and templates alike.
 */
export class TemplateVarsModal extends Modal {
  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Message variables");
    const c = this.contentEl;
    c.createDiv({
      cls: "ngb-settings-note",
      text: "A commit message may carry these; each is replaced with its value when the commit happens.",
    });
    for (const v of TEMPLATE_VARIABLES) {
      const row = c.createDiv({ cls: "ngb-var-row" });
      const head = row.createDiv({ cls: "ngb-var-head" });
      head.createEl("code", { text: v.token });
      const copy = head.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
      copy.setAttribute("aria-label", `Copy ${v.token}`);
      setIcon(copy, "copy");
      copy.addEventListener("click", () => {
        void navigator.clipboard.writeText(v.token);
        new Notice(`${v.token} copied.`);
      });
      row.createDiv({ cls: "ngb-settings-note", text: v.description });
    }
  }

  onClose(): void {
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
      /** May be async. See the note on ConfirmModal's `onDecision`. */
      abortMerge: () => void | Promise<void>;
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
      // Every path in this window is conflicted, so it gets the same warning
      // glyph the panel and the changed-files window use for that state.
      renderFileBadge(li, null);
      const link = li.createEl("a", { cls: "ngb-badge-path", text: f });
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
      void this.actions.abortMerge();
    });
    const close = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
