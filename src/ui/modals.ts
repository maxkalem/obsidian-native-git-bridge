import { App, Modal, Platform, setIcon } from "obsidian";
import { addCopyButton } from "./copyable";
import { DISPLAY_OUTPUT_LIMIT } from "../constants";
import type { GitStatusSummary, SparseSafetyReport, SparseStateSummary } from "../types";
import { planSparseRepair, type SparseRepairPlan } from "../git/sparseSafety";

/**
 * The ONE action button of an agree/decline modal. There is no Cancel button
 * anywhere: the modal's close (X) IS the cancel. Placement is platform-aware —
 * mobile puts the button (icon + label) in the TOP-LEFT corner, mirroring the
 * panel toolbar; desktop centers it under the content.
 */
export function placeModalAction(
  modal: Modal,
  opts: {
    label: string;
    icon: string;
    danger?: boolean;
    /**
     * The modal has a text field. Only then does the action move to the
     * top-left corner on mobile: with the keyboard open a button at the bottom
     * is unreachable. A modal that is only a question keeps its action at the
     * bottom centre, where it does not collide with the title.
     */
    hasInput?: boolean;
    onClick: () => void;
  }
): HTMLButtonElement {
  // `createEl` on the modal's own element rather than `document.createElement`:
  // it uses the right document (a modal opened from a popout window belongs to
  // that window) and it is what Obsidian's guidelines ask for. The button is
  // detached again below and re-inserted where the platform wants it.
  const b = modal.modalEl.createEl("button", {
    cls: `ngb-modal-action ${opts.danger ? "mod-warning" : "mod-cta"}`,
  });
  const ic = b.createSpan({ cls: "ngb-modal-action-icon" });
  setIcon(ic, opts.icon);
  b.createSpan({ text: opts.label });
  b.setAttribute("aria-label", opts.label);
  b.addEventListener("click", opts.onClick);
  if (Platform.isMobile && opts.hasInput === true) {
    modal.modalEl.addClass("ngb-modal-has-top-action");
    b.addClass("ngb-modal-action-top");
    modal.modalEl.insertBefore(b, modal.modalEl.firstChild);
  } else {
    const wrap = modal.contentEl.createDiv({ cls: "ngb-buttons ngb-modal-action-bottom" });
    wrap.appendChild(b);
  }
  return b;
}

function outputSection(el: HTMLElement, label: string, text: string | undefined): void {
  if (!text || text.trim() === "") return;
  const details = el.createEl("details", { cls: "ngb-details" });
  details.createEl("summary", { text: label });
  const box = details.createDiv({ cls: "ngb-output" });
  const shown =
    text.length > DISPLAY_OUTPUT_LIMIT
      ? text.slice(0, DISPLAY_OUTPUT_LIMIT) + "\n… (truncated; full output in runner.log)"
      : text;
  box.createEl("pre", { text: shown });
}

/** Generic result modal: summary + collapsible stdout/stderr, never a bare "failed". */
/**
 * Render a text line into `parent`, turning every http(s) URL into a real
 * clickable <a> (Obsidian routes it to the system browser). Plain setText
 * would leave URLs as dead, uncopyable text on mobile.
 */
export function linkifyInto(parent: HTMLElement, text: string): void {
  const re = /https?:\/\/[^\s)"']+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parent.appendText(text.slice(last, i));
    parent.createEl("a", { href: m[0], text: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) parent.appendText(text.slice(last));
}

export interface ResultModalAction {
  label: string;
  onClick: () => void;
  cta?: boolean;
  /** Keep the modal open after the click (default: close). */
  keepOpen?: boolean;
}

export class ResultModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private lines: string[],
    private opts: {
      stdout?: string;
      stderr?: string;
      isError?: boolean;
      /** One-tap fix buttons rendered ABOVE Copy/Close. */
      actions?: ResultModalAction[];
    } = {}
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    const sec = c.createDiv({ cls: "ngb-section" });
    for (const line of this.lines) {
      const div = sec.createDiv({ cls: this.opts.isError ? "ngb-status-error" : "" });
      linkifyInto(div, line);
    }
    if (this.opts.actions && this.opts.actions.length > 0) {
      const fixes = c.createDiv({ cls: "ngb-buttons ngb-action-buttons" });
      for (const a of this.opts.actions) {
        const b = fixes.createEl("button", { text: a.label, cls: a.cta ? "mod-cta" : "" });
        b.addEventListener("click", () => {
          a.onClick();
          if (!a.keepOpen) this.close();
        });
      }
    }
    outputSection(c, "stdout", this.opts.stdout);
    outputSection(c, "stderr", this.opts.stderr);
    // No Close button: the window's own ✕ closes it, and a second control
    // doing the same thing next to the real actions only competed with them.
    const btns = c.createDiv({ cls: "ngb-buttons" });
    addCopyButton(btns, () => this.fullText(), "Copy details", "Details copied.");
  }

  private fullText(): string {
    const parts = [this.title, ...this.lines];
    if (this.opts.stdout) parts.push("", "--- stdout ---", this.opts.stdout);
    if (this.opts.stderr) parts.push("", "--- stderr ---", this.opts.stderr);
    return parts.join("\n");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Explicit confirmation modal with labeled buttons (never ambiguous icon-only
 * actions). Used before every destructive operation.
 */
export class ConfirmModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private opts: {
      title: string;
      body: string[];
      confirmLabel: string;
      /** Icon for the single action button (default: check). */
      icon?: string;
      danger?: boolean;
    },
    /**
     * The type admits `Promise<void>`. Almost every decision this modal reports
     * leads to a Termux round trip, so nearly all callers pass an `async`
     * function, and a callback typed `() => void` receiving one is what
     * "Promise returned where a void return was expected" reports. Widening the
     * contract here covers about thirty call sites. Adding `void` at each of
     * them would silence the warning and leave the mismatch in place.
     *
     * The modal itself does not await the result: it has already closed, and
     * there is nothing it could do with a rejection. Callers own their errors,
     * which is what `runOperation` and `renderMutationError` are for.
     */
    private onDecision: (confirmed: boolean) => void | Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.opts.title);
    const c = this.contentEl;
    for (const line of this.opts.body) linkifyInto(c.createEl("p"), line);
    // No Cancel button: closing the modal (X / backdrop / Esc) declines.
    placeModalAction(this, {
      label: this.opts.confirmLabel,
      icon: this.opts.icon ?? "check",
      danger: this.opts.danger,
      onClick: () => {
        this.decided = true;
        this.close();
        // `void` here, and not at the ~30 call sites, is the point of typing
        // `onDecision` as possibly async: the decision NOT to wait belongs to
        // the modal. It has already closed and has nothing to do with a
        // rejection; the caller owns its own errors.
        void this.onDecision(true);
      },
    });
  }

  onClose(): void {
    if (!this.decided) void this.onDecision(false);
    this.contentEl.empty();
  }
}

/** Changed-files modal fed by the last native `git status` result. */
export class ChangedFilesModal extends Modal {
  constructor(
    app: App,
    private status: GitStatusSummary,
    private fetchedAt: string
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git: changed files");
    const c = this.contentEl;
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Branch ${this.status.branch ?? "(detached)"} · ↑${this.status.ahead} ↓${this.status.behind} · as of ${this.fetchedAt}`,
    });
    const groups: [string, { path: string; badge: string }[]][] = [
      ["Conflicted", this.status.conflicted.map((e) => ({ path: e.path, badge: "!" }))],
      ["Staged", this.status.staged.map((e) => ({ path: e.path, badge: e.index }))],
      ["Unstaged", this.status.unstaged.map((e) => ({ path: e.path, badge: e.worktree }))],
      ["Untracked", this.status.untracked.map((p) => ({ path: p, badge: "?" }))],
    ];
    let any = false;
    for (const [name, items] of groups) {
      if (items.length === 0) continue;
      any = true;
      const sec = c.createDiv({ cls: "ngb-section" });
      sec.createEl("h3", { text: `${name} (${items.length})` });
      const ul = sec.createEl("ul", { cls: "ngb-file-list" });
      for (const it of items) {
        const li = ul.createEl("li");
        li.createSpan({ cls: "ngb-badge", text: it.badge });
        li.createSpan({ text: it.path });
      }
    }
    if (!any) c.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Sparse safety verdict modal, including the mandated warning on failure. */
/** Recovery actions offered on a blocked safety check (both confirmed first). */
export interface SparseSafetyFixes {
  /**
   * Carry out the plan: trash the files that are on disk, drop the index-only
   * entries, and report honestly on both halves. One call, because the user
   * made one decision.
   */
  repair(plan: SparseRepairPlan): void;
  /** Drop the sparse exclusion for these directories, so they stop being protected. */
  unprotect(paths: string[]): void;
}

export class SparseSafetyModal extends Modal {
  constructor(
    app: App,
    private report: SparseSafetyReport,
    private warningText: string,
    private fixes?: SparseSafetyFixes
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Sparse checkout safety check");
    const c = this.contentEl;
    if (this.report.safe) {
      c.createEl("p", {
        cls: "ngb-ok",
        text: "Safe: no protected sparse path appears as a Git change.",
      });
    } else {
      c.createDiv({ cls: "ngb-warning", text: this.warningText });
      const ul = c.createEl("ul", { cls: "ngb-file-list" });
      for (const v of this.report.violations) {
        ul.createEl("li", { text: `${v.path} — ${v.status} (${v.source})` });
      }
      c.createEl("p", {
        cls: "ngb-settings-note",
        text:
          "Nothing is repaired automatically. The two fixes below are the usual ones; " +
          "'Run diagnostics' inspects the sparse state, and anything else is resolved in Termux.",
      });
      this.renderFixes(c);
    }
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Protected paths: ${this.report.protectedPaths.join(", ")} · checked ${this.report.checkedAt}`,
    });
  }

  /**
   * The two recoveries that actually apply here, side by side. Both stay on
   * one row on a phone: equal flex widths, small type, labels truncated
   * rather than wrapped, and the detail spelled out underneath instead of in
   * the button.
   */
  private renderFixes(c: HTMLElement): void {
    if (!this.fixes) return;
    // What each blocking path actually needs, decided from both porcelain
    // columns rather than from the collapsed human label. The old version read
    // only the index column, offered "delete the files" for an entry that had
    // no file on disk, moved nothing, and left the block exactly where it was.
    const plan = planSparseRepair(this.report);
    // Which protected directories the violations actually fall under; dropping
    // the exclusion for anything else would be unrelated collateral.
    const allPaths = [...new Set(this.report.violations.map((v) => v.path))];
    const dirs = this.report.protectedPaths.filter((p) =>
      allPaths.some((f) => f === p || f.startsWith(`${p}/`))
    );
    const repairable = plan.trash.length + plan.unstage.length;
    if (repairable === 0 && dirs.length === 0) {
      if (plan.blocked.length > 0) this.renderBlockedNote(c, plan);
      return;
    }
    const row = c.createDiv({ cls: "ngb-fix-row" });
    if (repairable > 0) {
      // ONE button, because it is one decision: "get these out of the way".
      // Whether that means the file, the index entry or both is git's business,
      // not something the user should have to diagnose from a status code.
      const label = this.repairLabel(plan);
      const b = row.createEl("button", { cls: "ngb-fix-btn mod-warning", text: label });
      b.setAttribute(
        "aria-label",
        `Clear ${repairable} blocking path${repairable === 1 ? "" : "s"} out of the way`
      );
      b.addEventListener("click", () => {
        this.close();
        this.fixes?.repair(plan);
      });
    }
    if (dirs.length > 0) {
      const b = row.createEl("button", { cls: "ngb-fix-btn", text: "Unprotect path" });
      b.setAttribute("aria-label", `Remove ${dirs.join(", ")} from the sparse exclusions`);
      b.addEventListener("click", () => {
        this.close();
        this.fixes?.unprotect(dirs);
      });
    }
    const notes: string[] = [];
    if (plan.trash.length > 0) {
      notes.push(
        `${plan.trash.length} file${plan.trash.length === 1 ? "" : "s"} go to Obsidian's trash (reversible; git history untouched).`
      );
    }
    if (plan.unstage.length > 0) {
      notes.push(
        `${plan.unstage.length} entr${plan.unstage.length === 1 ? "y is" : "ies are"} removed from the index only — those are staged additions with no file on disk, which deleting alone cannot clear. Nothing committed is touched.`
      );
    }
    if (dirs.length > 0) {
      notes.push(
        `Unprotect: removes ${dirs.join(", ")} from the sparse exclusions, so it is checked out and committed like any other directory.`
      );
    }
    c.createDiv({ cls: "ngb-settings-note", text: notes.join(" ") });
    if (plan.blocked.length > 0) this.renderBlockedNote(c, plan);
  }

  /** Button text names what will actually happen, not a fixed verb. */
  private repairLabel(plan: SparseRepairPlan): string {
    if (plan.trash.length === 0) return "Remove from index";
    if (plan.unstage.length === 0) return "Delete files locally";
    return "Delete and unstage";
  }

  /**
   * The paths the plugin will not repair, and why. Listed rather than dropped:
   * silently offering a button that covers three of five paths is how "the
   * check still blocks after the fix" happens.
   */
  private renderBlockedNote(c: HTMLElement, plan: SparseRepairPlan): void {
    const d = c.createDiv({ cls: "ngb-settings-note" });
    d.createDiv({
      text: `${plan.blocked.length} path${plan.blocked.length === 1 ? "" : "s"} cannot be repaired from here:`,
    });
    const ul = d.createEl("ul", { cls: "ngb-file-list" });
    for (const b of plan.blocked.slice(0, 12)) ul.createEl("li", { text: `${b.path} — ${b.reason}` });
    if (plan.blocked.length > 12) {
      ul.createEl("li", { text: `…and ${plan.blocked.length - 12} more` });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Status modal: branch, counts, sparse state, bridge availability, active op. */
export class StatusModal extends Modal {
  constructor(
    app: App,
    private data: {
      status?: GitStatusSummary;
      sparse?: SparseStateSummary;
      lastCommit?: { hash: string; date: string; subject: string };
      lastSyncAt?: string;
      bridgeAvailable: string;
      activeOperation?: string;
      fetchedAt?: string;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git: status");
    const c = this.contentEl;
    const kv = c.createDiv({ cls: "ngb-kv" });
    const row = (k: string, v: string) => {
      kv.createDiv({ cls: "k", text: k });
      kv.createDiv({ text: v });
    };
    const s = this.data.status;
    if (s) {
      row("Branch", s.detached ? "(detached)" : s.branch ?? "?");
      row("Upstream", s.upstream ?? "—");
      row("Ahead / behind", `${s.ahead} / ${s.behind}`);
      row("Staged", String(s.staged.length));
      row("Unstaged", String(s.unstaged.length));
      row("Untracked", String(s.untracked.length));
      row("Conflicted", String(s.conflicted.length));
    } else {
      row("Status", "not fetched yet");
    }
    if (this.data.lastCommit) {
      row(
        "Last commit",
        `${this.data.lastCommit.hash.slice(0, 8)} · ${this.data.lastCommit.subject}`
      );
    }
    const sp = this.data.sparse;
    if (sp) {
      row("Sparse checkout", sp.enabled ? "enabled" : "disabled");
      row("Sparse mode", sp.coneMode === undefined ? "—" : sp.coneMode ? "cone" : "non-cone");
      row("Sparse patterns", String(sp.patterns.length));
      row("Skip-worktree entries", String(sp.skipWorktreeCount));
    }
    row("Bridge", this.data.bridgeAvailable);
    row("Active operation", this.data.activeOperation ?? "none");
    row("Last successful sync", this.data.lastSyncAt ?? "never");
    if (this.data.fetchedAt) row("Fetched", this.data.fetchedAt);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Read-only preview of one file version, numbered and wrapped.
 *
 * Rendered with the diff pane's own table and class names rather than a `pre`:
 * this answers a question about the same file the diff pane answers questions
 * about, and two monospaced views of one file that number their lines
 * differently — or, as here, one that numbers them and one that does not — make
 * the reader translate between them.
 *
 * Wrapping is not optional here, unlike in the diff pane. There is nothing to
 * align against on a second side, so horizontal scrolling would only hide text
 * inside a modal that cannot be widened.
 */
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
    const box = c.createDiv({ cls: "ngb-diff-view ngb-diff-wrap ngb-preview-view" });
    const tbody = box
      .createDiv({ cls: "d2h-code-wrapper" })
      .createEl("table", { cls: "d2h-diff-table" })
      .createEl("tbody", { cls: "d2h-diff-tbody" });
    // A file that ends with a newline does not have an extra empty last line;
    // the newline terminates the line before it. Numbering one anyway would
    // claim the file is a line longer than it is.
    const body = this.text.endsWith("\n") ? this.text.slice(0, -1) : this.text;
    const lines = body === "" ? [] : body.split("\n");
    lines.forEach((line, i) => {
      const tr = tbody.createEl("tr");
      const gutter = tr.createEl("td", { cls: "d2h-code-linenumber d2h-cntx" });
      gutter.createDiv({ cls: "line-num1", text: String(i + 1) });
      const code = tr.createEl("td", { cls: "d2h-cntx" }).createDiv({ cls: "d2h-code-line" });
      code.createSpan({ cls: "d2h-code-line-ctn", text: line.replace(/\r$/, "") });
    });
    // The gutter width is measured from the numbers, exactly as the diff pane
    // measures it: `table-layout: fixed` needs an explicit width on this
    // column, and a guess too small pushes the numbers past the cell border.
    box.style.setProperty("--ngb-diff-gutter-w", `${String(lines.length).length + 2}ch`);
    if (lines.length === 0) {
      box.createEl("p", { cls: "ngb-settings-note", text: "This version of the file is empty." });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
