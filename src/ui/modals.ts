import { App, Modal, Platform, setIcon } from "obsidian";
import { addCopyButton } from "./copyable";
import { DISPLAY_OUTPUT_LIMIT } from "../constants";
import type { GitStatusSummary, SparseSafetyReport, SparseStateSummary } from "../types";

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
  const b = document.createElement("button");
  b.className = `ngb-modal-action ${opts.danger ? "mod-warning" : "mod-cta"}`;
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
    private onDecision: (confirmed: boolean) => void
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
        this.onDecision(true);
      },
    });
  }

  onClose(): void {
    if (!this.decided) this.onDecision(false);
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
  /** Move the listed files to Obsidian's trash, leaving git history alone. */
  deleteLocally(paths: string[]): void;
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
    // Deleting is offered ONLY for paths that are new here (untracked, or
    // added to the index). Deleting a tracked protected file would turn the
    // block into a staged deletion, which is the exact accident this plugin
    // exists to prevent; those the user resolves in Termux.
    const isNew = (s: string) => s === "untracked" || s === "added";
    // A path counts as risky if ANY of its violations is something other than
    // "new here"; the same path can appear twice (worktree and index).
    const other = new Set(
      this.report.violations.filter((v) => !isNew(v.status)).map((v) => v.path)
    );
    const paths = [
      ...new Set(
        this.report.violations
          .filter((v) => isNew(v.status) && !other.has(v.path))
          .map((v) => v.path)
      ),
    ];
    // Which protected directories the violations actually fall under; dropping
    // the exclusion for anything else would be unrelated collateral.
    const allPaths = [...new Set(this.report.violations.map((v) => v.path))];
    const dirs = this.report.protectedPaths.filter((p) =>
      allPaths.some((f) => f === p || f.startsWith(`${p}/`))
    );
    if (paths.length === 0 && dirs.length === 0) return;
    const row = c.createDiv({ cls: "ngb-fix-row" });
    if (paths.length > 0) {
      const b = row.createEl("button", { cls: "ngb-fix-btn mod-warning", text: "Delete files locally" });
      b.setAttribute("aria-label", `Move ${paths.length} listed files to Obsidian's trash`);
      b.addEventListener("click", () => {
        this.close();
        this.fixes?.deleteLocally(paths);
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
    if (paths.length > 0) {
      notes.push(
        `Delete: moves ${paths.length} new file${paths.length === 1 ? "" : "s"} to Obsidian's trash (reversible; git history untouched).`
      );
    }
    if (other.size > 0) {
      notes.push(
        `${other.size} listed path${other.size === 1 ? " is" : "s are"} tracked here, so deleting would create the very deletion this check blocks. Resolve those in Termux.`
      );
    }
    if (dirs.length > 0) {
      notes.push(
        `Unprotect: removes ${dirs.join(", ")} from the sparse exclusions, so it is checked out and committed like any other directory.`
      );
    }
    c.createDiv({ cls: "ngb-settings-note", text: notes.join(" ") });
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
