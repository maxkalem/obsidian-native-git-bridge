import { App, Modal } from "obsidian";
import { addCopyButton } from "./copyable";
import { DISPLAY_OUTPUT_LIMIT } from "../constants";
import type { GitStatusSummary, SparseSafetyReport, SparseStateSummary } from "../types";

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
    const btns = c.createDiv({ cls: "ngb-buttons" });
    addCopyButton(btns, () => this.fullText(), "Copy details", "Details copied.");
    const ok = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    ok.addEventListener("click", () => this.close());
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
      cancelLabel?: string;
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
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const cancel = btns.createEl("button", { text: this.opts.cancelLabel ?? "Cancel" });
    cancel.addEventListener("click", () => {
      this.decided = true;
      this.close();
      this.onDecision(false);
    });
    const confirm = btns.createEl("button", {
      text: this.opts.confirmLabel,
      cls: this.opts.danger ? "mod-warning" : "mod-cta",
    });
    confirm.addEventListener("click", () => {
      this.decided = true;
      this.close();
      this.onDecision(true);
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
export class SparseSafetyModal extends Modal {
  constructor(
    app: App,
    private report: SparseSafetyReport,
    private warningText: string
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
          "No automatic repair is performed. Use 'Run diagnostics' to inspect the sparse state, " +
          "and resolve the changes manually in Termux (e.g. review why the protected paths were touched).",
      });
    }
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Protected paths: ${this.report.protectedPaths.join(", ")} · checked ${this.report.checkedAt}`,
    });
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
