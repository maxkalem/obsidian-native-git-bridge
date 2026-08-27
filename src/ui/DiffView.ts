import { ItemView, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import { DIFF_COLOR_VARS } from "./colors";
import { renderHunkRange, renderUnifiedDiff } from "./diffDom";
import type { InlineDiffUnit } from "../git/inlineDiff";
import { describeDiffBudget, type DiffBudgetNotice } from "../git/diffBudget";
import { hunkActionsFor, supportsLineSelection, type HunkActionPlan } from "../git/hunkActions";
import { buildHunkPatch, selectableLines, selectionHasChanges } from "../git/hunkPatch";
import { parseUnifiedDiff, type DiffHunk } from "../git/unifiedDiff";
import { parseHunks, type DiffHunk as RestorableHunk } from "../git/hunks";

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

/**
 * A diff as it came back, with the facts about what the budget left out.
 *
 * The runner keeps whole hunks within the budget and counts the rest, so the
 * pane can name what is missing instead of showing a bare "truncated".
 */
export interface DiffLoadResult {
  diff: string;
  truncated: boolean;
  hunksShown: number;
  hunksTotal: number;
  totalBytes: number;
  limitBytes: number;
}

export interface DiffViewActions {
  /**
   * Fetch the unified diff text via the bridge. Returns null when the
   * operation failed (the error has already been surfaced to the user).
   * `limitKb` overrides the device-local budget for this one request.
   */
  loadDiff(path: string, from: string, to: string, limitKb?: number): Promise<DiffLoadResult | null>;
  /**
   * Ask the user to accept a one-off larger budget. Resolves to the KB to use,
   * or null when they declined.
   */
  confirmLargerDiff(notice: DiffBudgetNotice): Promise<number | null>;
  /** Shared preference: wrap long lines instead of scrolling horizontally. */
  wrapLines(): boolean;
  /** Shared preference: render whitespace glyphs (· → ␍). */
  showInvisibles(): boolean;
  /** Shared preference: compare changed lines by word or by character. */
  inlineUnit(): InlineDiffUnit;
  /**
   * Shared preference: leave line-picking mode on when the pane is pointed at
   * a different diff. Off (the default) turns it off with every new file.
   */
  keepLineSelection(): boolean;
  /**
   * Shared preference: custom colours as CSS variables, or null while the
   * "custom colours" toggle is off (the theme's own values then apply).
   */
  colors(): Record<string, string> | null;
  /** Progress line of the operation in flight ("" when idle), for the wait indicator. */
  progressText(): string;
  /**
   * Show the file itself rather than a comparison of it. `commitish` is
   * `"WORKTREE"` for the file on disk, or a commit for the version at that
   * commit.
   *
   * The pane needs it because "no differences" is a perfectly ordinary answer —
   * a file staged and then reverted, or a commit that only renamed something —
   * and until now that answer was a dead end: the pane said there was nothing
   * to compare and offered no way to look at what it had been comparing.
   */
  openFileAt(path: string, commitish: string): void;
  /**
   * Put one block back the way it was at the commit this diff is showing.
   *
   * Only meaningful for a diff anchored at a commit, which is the diff the
   * repository history opens. The file-history panel offers the same act on the
   * same blocks; both go through `restoreBlockInFile`, so there is one
   * implementation and one set of outcomes.
   */
  restoreBlock(path: string, hunk: RestorableHunk, commitish: string): Promise<void>;
  /**
   * Send one patch to the runner. Resolves true when it applied, so the pane
   * knows to reload; the error has already been surfaced when it did not.
   */
  applyPatch(patch: string, target: "index" | "worktree", reverse: boolean): Promise<boolean>;
  /**
   * Confirm a destructive hunk action. Only discard is destructive: everything
   * else moves a change between the index and the file and is undone by its
   * opposite.
   */
  confirmDiscard(lines: number): Promise<boolean>;
}

/**
 * Replace whitespace inside rendered code lines with visible glyphs (space →
 * ·, tab → →, CR → ␍), VSCode-style, wrapped in a muted span. Runs over text
 * nodes only, so the <ins>/<del> intra-line highlighting survives.
 * Trade-off (documented in the setting): copying from the diff copies the
 * glyphs, not the original whitespace.
 *
 * `selector` exists because the conflict pane renders rows of its own shape,
 * and the setting is one setting: whitespace is either visible in this plugin's
 * file views or it is not.
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
          // Built with Obsidian's `createSpan` (per its own guidelines, and it
          // uses the container's document, which matters in a popout window),
          // then MOVED into the fragment. `createSpan` has to attach somewhere
          // to exist, and a fragment does not carry Obsidian's helpers.
          const span = ctn.createSpan({
            cls: "ngb-ws-glyph",
            text: part.replace(/ /g, "·").replace(/\t/g, "→").replace(/\r/g, "␍"),
          });
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
  // Two numbers side by side + one column for the prefix + cell padding + the
  // separation between the three, without which three-digit numbers touch and
  // read as one six-digit number.
  // No allowance for the picking checkbox: it sits inside the number column
  // that has no number, so it adds nothing to the width. Adding two here was
  // what made the gutter jump when picking was switched on.
  return 2 * digits + 5;
}

/**
 * Apply the measured gutter width to the pane (used by the wrapped layout).
 *
 * The digit-count formula, deliberately: a scrollWidth-based measurement was
 * tried and reverted the same day — it read the CELL, whose width already
 * included the previous value, so every re-render could only grow it. The
 * real cause of the half-pane gutter was never the number here at all: fixed
 * table layout ignored the td width and split the columns 50/50, which the
 * <colgroup> in diffDom now prevents.
 */
export function sizeGutter(box: HTMLElement): void {
  const host = box.closest<HTMLElement>(".ngb-diff-view") ?? box;
  host.style.setProperty("--ngb-diff-gutter-w", `${gutterWidthCh(box)}ch`);
}

/**
 * File diff in a regular Obsidian pane (like obsidian-git's diff view), in the
 * obsidian-version-history-diff style: line-by-line, with word-level
 * intra-line highlighting.
 *
 * git produces the unified diff in Termux; `diffDom.ts` only turns it into
 * nodes. No JS git implementation is involved, and no HTML string is ever
 * built, so there is nothing to sanitize.
 */
export class DiffView extends ItemView {
  private state: DiffViewState | null = null;
  /** Guards against a stale fetch rendering over a newer one. */
  private loadSeq = 0;
  /** Interval behind the wait indicator; one per loaded diff. */
  private waitTicker: number | null = null;

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
      const changed =
        this.state === null ||
        this.state.path !== s.path ||
        this.state.from !== s.from ||
        this.state.to !== s.to;
      this.state = {
        path: s.path,
        from: s.from,
        to: s.to,
        label: typeof s.label === "string" ? s.label : `${s.from} → ${s.to}`,
      };
      // The pane is reused for every diff, so an override accepted for one file
      // must not silently apply to the next. Line-picking mode is the same
      // story and a sharper one: the picks are coordinates into the diff that
      // was on screen, they mean nothing in another file, and a mode left on
      // means the next file opens with checkboxes the reader did not ask for.
      if (changed) {
        this.overrideKb = null;
        if (!this.actions.keepLineSelection()) this.picking = false;
        this.picked.clear();
      }
      await this.loadAndRender();
    }
    return super.setState(state, result as never);
  }

  /** Last fetched diff, cached so display toggles re-render without a Termux round trip. */
  private lastResult: DiffLoadResult | null = null;
  /**
   * Budget the user accepted for THIS diff, in KB. Reset whenever the pane is
   * pointed at a different diff, so an override never leaks to the next one.
   */
  private overrideKb: number | null = null;
  /** Line-picking mode: off by default, reset whenever the diff is reloaded. */
  private picking = false;
  /** Picked lines, as "<hunkIndex>:<lineIndex>" — the coordinate buildHunkPatch takes. */
  private picked = new Set<string>();
  /**
   * The same hunks parsed the other way, for restoring a block from a commit.
   * Rebuilt with every render, from the diff text the pane is showing.
   */
  private restorableHunks: RestorableHunk[] = [];

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
    const ticker = this.renderWaiting(box.createDiv({ cls: "ngb-filehist-waiting" }));
    const res = await this.actions.loadDiff(st.path, st.from, st.to, this.overrideKb ?? undefined);
    // Only this load's own ticker: the pane is reused, so a diff opened while
    // an older one is in flight owns the indicator by the time the older
    // answer lands, and an unqualified stop froze the newer progress line.
    this.stopWaitTicker(ticker);
    if (seq !== this.loadSeq) return; // superseded by a newer setState
    this.lastResult = res;
    this.renderBody(box, res);
  }

  /**
   * "The runner is working" indicator, identical to the file-history panel's.
   * Returns the ticker id so the wait that started it can stop it and nothing
   * else can.
   */
  private renderWaiting(el: HTMLElement): number | null {
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    setIcon(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? "Loading diff…" : p);
    };
    tick();
    // See HistoryView.stopWaitTicker: registering alone left one timer per
    // loaded diff, and this pane is reused for every diff the user opens.
    this.stopWaitTicker();
    this.waitTicker = this.registerInterval(window.setInterval(tick, 500));
    return this.waitTicker;
  }

  /**
   * With an id, stops only while that wait still owns the ticker. Same rule as
   * the two history panels: a request that finishes must not take down the
   * indicator a later one is using.
   */
  private stopWaitTicker(id?: number | null): void {
    if (this.waitTicker === null) return;
    if (id !== undefined && id !== null && id !== this.waitTicker) return;
    window.clearInterval(this.waitTicker);
    this.waitTicker = null;
  }

  private renderBody(box: HTMLElement, res: DiffLoadResult | null): void {
    this.contentEl.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    box.empty();
    if (res === null) {
      box.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      box.createEl("p", { cls: "ngb-ok", text: "No differences." });
      // Which side to show: the working tree if this comparison ends there,
      // otherwise the newer of the two commits — the version the reader came
      // here to look at, not the one it was measured against.
      const st = this.state;
      if (st) {
        const target = st.to === "WORKTREE" ? "WORKTREE" : st.to;
        const btns = box.createDiv({ cls: "ngb-buttons ngb-buttons-top" });
        const b = btns.createEl("button", {
          text: target === "WORKTREE" ? "Open the file" : "Show the file at this commit",
        });
        b.addEventListener("click", () => this.actions.openFileAt(st.path, target));
      }
      return;
    }
    this.restorableHunks = parseHunks(res.diff);
    const plans = hunkActionsFor(this.state?.from ?? "", this.state?.to ?? "");
    renderUnifiedDiff(box, res.diff, {
      unit: this.actions.inlineUnit(),
      hunkBar: (bar, hunk, i) => this.renderHunkBar(bar, hunk, i, plans),
      lineCheckbox: this.picking
        ? (b, hunkIndex, lineIndex) => {
            const key = `${hunkIndex}:${lineIndex}`;
            b.checked = this.picked.has(key);
            b.addEventListener("change", () => {
              if (b.checked) this.picked.add(key);
              else this.picked.delete(key);
              // Only the labels and the disabled state change, so the diff is
              // left alone: rebuilding it on every tap would lose the scroll
              // position and, on a long diff, be felt.
              this.refreshHunkBars();
            });
          }
        : undefined,
    });
    sizeGutter(box);
    this.renderBudgetNotice(box, res);
    this.applyDisplayPrefs();
  }

  /**
   * One hunk's controls: its actions, which lines of the file it is, and the
   * toggle that switches the pane between whole-hunk and picked-lines.
   *
   * The toggle sits beside the actions rather than in the pane header because it
   * changes what those very buttons do, and a control that changes another
   * control belongs next to it. It used to be pushed to the far end with
   * `margin-left: auto`, which worked only in the wrapped layout: without
   * wrapping the table is as wide as the longest line of code, so "the far end"
   * was somewhere off the right of the horizontal scroller and the toggle could
   * not be reached at all. Every control now sits at the start of the row, in
   * the order it is used.
   */
  private renderHunkBar(
    bar: HTMLElement,
    hunk: DiffHunk,
    hunkIndex: number,
    plans: HunkActionPlan[]
  ): void {
    const selected = this.selectionFor(hunk, hunkIndex);
    // In picking mode a button acts on the ticked lines, so it is dead until
    // something is ticked. Disabled rather than hidden: the row must not reflow
    // every time a checkbox changes.
    const empty = this.picking && !selectionHasChanges(hunk, selected);

    for (const plan of plans) {
      const btn = bar.createEl("button", {
        cls: plan.destructive ? "ngb-hunk-btn mod-warning" : "ngb-hunk-btn",
        text: this.picking ? plan.selectedLabel : plan.label,
      });
      btn.disabled = empty;
      btn.addEventListener("click", () => { void this.runHunkAction(plan, hunk, hunkIndex); });
    }

    // A diff anchored at a commit has no index or worktree to move a hunk
    // between, so `plans` is empty and the bar carried nothing but a range. The
    // act that DOES make sense there is the one the file-history panel already
    // offers on the same blocks: put this block back the way it was.
    const st = this.state;
    // `restoreHunk` needs the hunk's raw before/after text, which the rendered
    // form does not carry — the same reason the file-history panel parses the
    // diff a second time with `parseHunks`. Indexed by position, which is what
    // both parsers agree on.
    const restorable = this.restorableHunks[hunkIndex];
    if (plans.length === 0 && st && restorable && st.to !== "WORKTREE" && st.to !== "INDEX") {
      const b = bar.createEl("button", { cls: "ngb-hunk-btn" });
      setIcon(b.createSpan({ cls: "ngb-hunk-btn-icon" }), "rotate-ccw");
      b.createSpan({ text: "Restore this block" });
      b.setAttribute("aria-label", `Restore this block from ${st.to.slice(0, 8)}`);
      b.addEventListener("click", () => { void this.actions.restoreBlock(st.path, restorable, st.to); });
    }

    // Directly after the actions: it names what they would act on.
    renderHunkRange(bar, hunk);

    if (!supportsLineSelection(this.state?.from ?? "", this.state?.to ?? "")) return;
    const toggle = bar.createEl("button", { cls: "ngb-hunk-btn ngb-hunk-pick-toggle" });
    const toggleLabel = this.picking ? "Select hunk" : "Select lines";
    toggle.setAttribute("aria-label", toggleLabel);
    setIcon(toggle.createSpan({ cls: "ngb-hunk-btn-icon" }), this.picking ? "square" : "list-checks");
    if (!Platform.isPhone) toggle.createSpan({ text: toggleLabel });
    toggle.addEventListener("click", () => {
      this.picking = !this.picking;
      // Leaving the mode drops the picks: keeping them invisible would mean a
      // later "Stage hunk" quietly acting on a subset.
      this.picked.clear();
      const box = this.contentEl.querySelector<HTMLElement>(".ngb-diff-pane-body");
      if (box) this.renderBody(box, this.lastResult);
    });
  }

  /** Which lines of this hunk are picked. Whole hunk when not in picking mode. */
  private selectionFor(hunk: DiffHunk, hunkIndex: number): Set<number> {
    if (!this.picking) return new Set(selectableLines(hunk));
    const out = new Set<number>();
    for (const i of selectableLines(hunk)) {
      if (this.picked.has(`${hunkIndex}:${i}`)) out.add(i);
    }
    return out;
  }

  /** Relabel and re-enable the bars after a checkbox changed, without rebuilding the diff. */
  private refreshHunkBars(): void {
    const box = this.contentEl.querySelector<HTMLElement>(".ngb-diff-pane-body");
    if (!box || !this.lastResult) return;
    const hunks = parseUnifiedDiff(this.lastResult.diff).flatMap((f) => f.hunks);
    const bars = Array.from(box.querySelectorAll<HTMLElement>(".ngb-hunk-bar"));
    bars.forEach((bar, i) => {
      const hunk = hunks[i];
      if (!hunk) return;
      const empty = !selectionHasChanges(hunk, this.selectionFor(hunk, i));
      // The ACTIONS only. The mode toggle carries the same class so it looks
      // like its neighbours, and disabling it with them was a trap: unticking
      // the last line left the user in picking mode with no way back out of it.
      const actions = Array.from(bar.querySelectorAll<HTMLButtonElement>(".ngb-hunk-btn")).filter(
        (b) => !b.hasClass("ngb-hunk-pick-toggle")
      );
      for (const b of actions) b.disabled = empty;
    });
  }

  /**
   * Build the patch for one hunk and send it. Reloads afterwards, because the
   * diff the pane is showing is exactly what the action changed.
   */
  private async runHunkAction(plan: HunkActionPlan, hunk: DiffHunk, hunkIndex: number): Promise<void> {
    const st = this.state;
    if (!st) return;
    const selected = this.selectionFor(hunk, hunkIndex);
    const patch = buildHunkPatch({
      path: st.path,
      hunk,
      selected: this.picking ? selected : undefined,
    });
    if (patch === null) return; // nothing picked but context; the button was disabled
    if (plan.destructive && !(await this.actions.confirmDiscard(selected.size))) return;
    if (!(await this.actions.applyPatch(patch, plan.target, plan.reverse))) return;
    // A successful action invalidates the picks: the line indices it described
    // no longer point at the same lines.
    this.picked.clear();
    await this.loadAndRender();
  }

  /**
   * What the budget left out, and the one-tap way to get it.
   *
   * Placed after the diff rather than before it: the user came to read the
   * change, and a diff that fits says nothing here at all.
   */
  private renderBudgetNotice(box: HTMLElement, res: DiffLoadResult): void {
    const notice = describeDiffBudget({
      hunksShown: res.hunksShown,
      hunksTotal: res.hunksTotal,
      totalBytes: res.totalBytes,
      limitBytes: res.limitBytes,
      linesShown: box.querySelectorAll(".d2h-code-line-ctn").length,
    });
    if (!notice) return;
    const wrap = box.createDiv({ cls: "ngb-warning ngb-diff-budget" });
    wrap.createDiv({ text: notice.text });
    if (notice.overrideLabel === null) return;
    const btn = wrap.createEl("button", { text: notice.overrideLabel });
    btn.addEventListener("click", () => { void (async () => {
      const kb = await this.actions.confirmLargerDiff(notice);
      if (kb === null) return;
      // Held on the pane, not in settings: the next diff opened here starts
      // from the configured budget again.
      this.overrideKb = kb;
      await this.loadAndRender();
    })(); });
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
      if (c && c[name]) this.contentEl.style.setProperty(name, c[name]);
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
