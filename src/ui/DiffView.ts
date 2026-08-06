import { ItemView, sanitizeHTMLToDom, setIcon, WorkspaceLeaf } from "obsidian";
import { html as diff2html } from "diff2html";
import { DIFF_COLOR_VARS } from "./colors";

export const NGB_DIFF_VIEW = "native-git-bridge-diff";

/**
 * State of one diff pane. Serializable (getState/setState) so Obsidian can
 * restore the pane across restarts; the diff itself is re-fetched from the
 * runner on restore.
 */
export interface DiffViewState {
  path: string;
  /** Commit-ish (possibly with a trailing ^) the diff starts from. */
  from: string;
  /** Commit-ish or "WORKTREE". */
  to: string;
  /** Human description, e.g. "a1b2c3d4 → working tree". */
  label: string;
}

export interface DiffViewActions {
  /**
   * Fetch the unified diff text via the bridge. Returns null when the
   * operation failed (the error has already been surfaced to the user).
   */
  loadDiff(path: string, from: string, to: string): Promise<{ diff: string; truncated: boolean } | null>;
  /** Shared preference: wrap long lines instead of scrolling horizontally. */
  wrapLines(): boolean;
  /** Shared preference: render whitespace glyphs (· → ␍). */
  showInvisibles(): boolean;
  /**
   * Shared preference: custom colours as CSS variables, or null while the
   * "custom colours" toggle is off (the theme's own values then apply).
   */
  colors(): Record<string, string> | null;
  /** Progress line of the operation in flight ("" when idle), for the wait indicator. */
  progressText(): string;
}

/**
 * Replace whitespace inside rendered code lines with visible glyphs (space →
 * ·, tab → →, CR → ␍), VSCode-style, wrapped in a muted span. Runs over text
 * nodes only, so diff2html's own <ins>/<del> char highlighting is preserved.
 * Trade-off (documented in the setting): copying from the diff copies the
 * glyphs, not the original whitespace.
 *
 * `selector` exists because the conflict pane renders its own rows rather than
 * diff2html's, and the setting is one setting: whitespace is either visible in
 * this plugin's file views or it is not.
 */
export function markInvisibles(root: HTMLElement, selector = ".d2h-code-line-ctn"): void {
  for (const ctn of Array.from(root.querySelectorAll(selector))) {
    // Idempotent: a container that already carries glyphs is left alone, so
    // the pass can safely run again after a resize or a re-attach.
    if (ctn.querySelector(".ngb-ws-glyph")) continue;
    const walker = ctn.ownerDocument.createTreeWalker(ctn, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) textNodes.push(n as Text);
    for (const node of textNodes) {
      const text = node.nodeValue ?? "";
      if (!/[ \t\r]/.test(text)) continue;
      const frag = ctn.ownerDocument.createDocumentFragment();
      for (const part of text.split(/([ \t\r]+)/)) {
        if (part === "") continue;
        if (/^[ \t\r]+$/.test(part)) {
          const span = ctn.ownerDocument.createElement("span");
          span.className = "ngb-ws-glyph";
          span.textContent = part.replace(/ /g, "·").replace(/\t/g, "→").replace(/\r/g, "␍");
          frag.appendChild(span);
        } else {
          frag.appendChild(ctn.ownerDocument.createTextNode(part));
        }
      }
      node.replaceWith(frag);
    }
  }
}

/**
 * Width the sticky number gutter needs for the longest line number pair plus
 * the relocated +/- prefix, in `ch` (the font is monospace, so `ch` is exact).
 *
 * Wrapping switches the table to `table-layout: fixed`, which needs an explicit
 * width on the first column — and a guessed one is what put the prefix in the
 * wrong place: with three-digit line numbers the gutter's content was wider
 * than the guess and spilled PAST the cell border, so `+`/`-` appeared to sit
 * inside the code. Measuring the numbers keeps the prefix where it belongs.
 */
export function gutterWidthCh(root: ParentNode): number {
  let digits = 1;
  for (const el of Array.from(root.querySelectorAll(".line-num1, .line-num2"))) {
    const t = (el.textContent ?? "").trim();
    if (t.length > digits) digits = t.length;
  }
  // two numbers side by side + one column for the prefix + cell padding
  return 2 * digits + 4;
}

/** Apply the measured gutter width to the pane (used by the wrapped layout). */
export function sizeGutter(box: HTMLElement): void {
  const host = box.closest<HTMLElement>(".ngb-diff-view") ?? box;
  host.style.setProperty("--ngb-diff-gutter-w", `${gutterWidthCh(box)}ch`);
}

/**
 * File diff in a regular Obsidian pane (like obsidian-git's diff view), but
 * rendered in the obsidian-version-history-diff style: diff2html line-by-line
 * output with character-level intra-line highlighting (diffStyle "char").
 * git produces the unified diff in Termux; diff2html only renders it — no JS
 * git implementation is involved, and the HTML goes through Obsidian's
 * sanitizeHTMLToDom.
 */
export class DiffView extends ItemView {
  private state: DiffViewState | null = null;
  /** Guards against a stale fetch rendering over a newer one. */
  private loadSeq = 0;

  constructor(leaf: WorkspaceLeaf, private actions: DiffViewActions) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return NGB_DIFF_VIEW;
  }
  getDisplayText(): string {
    if (!this.state) return "Diff";
    const base = this.state.path.split("/").pop() ?? this.state.path;
    return `Diff: ${base}`;
  }
  getIcon(): string {
    return "file-diff";
  }

  override getState(): Record<string, unknown> {
    return { ...(this.state ?? {}) };
  }

  override async setState(state: unknown, result: unknown): Promise<void> {
    const s = state as Partial<DiffViewState> | null;
    if (s && typeof s.path === "string" && typeof s.from === "string" && typeof s.to === "string") {
      this.state = {
        path: s.path,
        from: s.from,
        to: s.to,
        label: typeof s.label === "string" ? s.label : `${s.from} → ${s.to}`,
      };
      await this.loadAndRender();
    }
    return super.setState(state, result as never);
  }

  /** Last fetched diff, cached so display toggles re-render without a Termux round trip. */
  private lastResult: { diff: string; truncated: boolean } | null = null;

  private async loadAndRender(): Promise<void> {
    const st = this.state;
    if (!st) return;
    const seq = ++this.loadSeq;
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-diff-view");
    const head = c.createDiv({ cls: "ngb-pane-path", text: `${st.path} · ${st.label}` });
    head.setAttribute("aria-label", `${st.path} · ${st.label}`);
    const box = c.createDiv({ cls: "ngb-diff-pane-body" });
    // Same wait indicator as the file-history panel: a spinning glyph and the
    // operation's own elapsed-time line, not a static sentence.
    this.renderWaiting(box.createDiv({ cls: "ngb-filehist-waiting" }));
    const res = await this.actions.loadDiff(st.path, st.from, st.to);
    if (seq !== this.loadSeq) return; // superseded by a newer setState
    this.lastResult = res;
    this.renderBody(box, res);
  }

  /** "The runner is working" indicator, identical to the file-history panel's. */
  private renderWaiting(el: HTMLElement): void {
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    setIcon(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? "Loading diff…" : p);
    };
    tick();
    this.registerInterval(window.setInterval(tick, 500));
  }

  private renderBody(box: HTMLElement, res: { diff: string; truncated: boolean } | null): void {
    this.contentEl.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    box.empty();
    if (res === null) {
      box.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      box.createEl("p", { cls: "ngb-ok", text: "No differences." });
      return;
    }
    const rendered = diff2html(res.diff, {
      drawFileList: false,
      diffStyle: "char",
      outputFormat: "line-by-line",
    });
    box.appendChild(sanitizeHTMLToDom(rendered));
    // The +/- prefix belongs to the STICKY number gutter, not to the code: in
    // the code cell it scrolled away horizontally and, when wrapping, read
    // like content. One number per line, prefix beside it, everything compact.
    for (const tr of Array.from(box.querySelectorAll("tr"))) {
      const gutter = tr.querySelector(".d2h-code-linenumber");
      const prefix = tr.querySelector(".d2h-code-line-prefix");
      if (gutter && prefix) gutter.appendChild(prefix);
    }
    sizeGutter(box);
    if (res.truncated) {
      box.createDiv({
        cls: "ngb-warning",
        text: "Diff truncated (too large). The full diff is available via git in Termux.",
      });
    }
    this.applyDisplayPrefs();
  }

  /**
   * Apply the display preferences to whatever is currently rendered. Kept
   * separate from rendering and idempotent, because the pane is REUSED for
   * every diff: a single "apply once, right after building the DOM" step
   * silently lost the glyphs whenever a later render, a re-attach or a
   * layout change replaced or re-measured that DOM.
   */
  private applyDisplayPrefs(): void {
    this.contentEl.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    const box = this.contentEl.querySelector<HTMLElement>(".ngb-diff-pane-body");
    if (!box) return;
    const wanted = this.actions.showInvisibles();
    const present = box.querySelector(".ngb-ws-glyph") !== null;
    if (wanted && !present) markInvisibles(box);
    else if (!wanted && present) this.renderBody(box, this.lastResult); // rebuild without glyphs
    else sizeGutter(box); // renderBody sizes it itself
    this.applyColors();
  }

  /**
   * Custom colours (shared preference, off by default) are written as inline
   * CSS variables on the pane, which is the only way to beat the stylesheet's
   * own defaults on the same element. Turning the toggle off removes them, so
   * the theme takes over again with no reload.
   */
  private applyColors(): void {
    const c = this.actions.colors();
    for (const name of DIFF_COLOR_VARS) {
      if (c && c[name]) this.contentEl.style.setProperty(name, c[name]!);
      else this.contentEl.style.removeProperty(name);
    }
  }

  /** Re-render from the cached diff when a display preference changed. */
  refreshDisplay(): void {
    const box = this.contentEl.querySelector<HTMLElement>(".ngb-diff-pane-body");
    if (box) this.renderBody(box, this.lastResult);
    else this.applyDisplayPrefs();
  }

  /**
   * Obsidian calls this whenever the pane's size changes, including the first
   * time a reused pane becomes visible at its real width. Re-applying here is
   * what keeps wrapped lines inside the pane instead of measuring against the
   * width some earlier diff happened to be rendered at.
   */
  override onResize(): void {
    this.applyDisplayPrefs();
  }

  async onOpen(): Promise<void> {
    // setState drives rendering; nothing to draw for a bare pane.
    if (!this.state) {
      this.contentEl.createEl("p", { cls: "ngb-settings-note", text: "No diff selected." });
      return;
    }
    this.applyDisplayPrefs();
  }
}
