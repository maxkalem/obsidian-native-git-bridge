import type { App, Plugin } from "obsidian";
import { signLetter, signTitle, type ExplorerSigns } from "./explorerSigns";

/**
 * Paints git signs onto Obsidian's file explorer.
 *
 * The explorer is somebody else's DOM: Obsidian builds the rows, rebuilds
 * them when files come and go, and knows nothing about this plugin. So the
 * marks are decorations that have to be re-applied, not a render of our own,
 * and everything here is written for that:
 *
 * - Rows are found by class and read by their `data-path` attribute, which
 *   the explorer has carried on every title element for years. No private
 *   view internals are touched; if the attribute ever went away the signs
 *   would simply stop appearing, and nothing else would break.
 * - A `MutationObserver` on each explorer container re-applies after
 *   Obsidian re-renders (a created or renamed file rebuilds its subtree),
 *   debounced, and blind to its own writes: observer records are delivered
 *   asynchronously, so a flag set while painting would already be down by
 *   the time they arrive — instead the records a paint produced are taken
 *   and dropped (`takeRecords`) before the paint returns. A paint is also
 *   idempotent, so even a missed record costs one pass that changes nothing.
 * - The lookup is a `Map` built once per status (`computeExplorerSigns`);
 *   a pass costs one map lookup per row on screen and never walks the
 *   status. A real vault has thousands of rows and a status of a few dozen
 *   entries, so the pass has to be cheap on the row side.
 */
export class ExplorerSignsController {
  private observers: MutationObserver[] = [];
  private observed = new WeakSet<HTMLElement>();
  private timer: number | null = null;

  constructor(
    private app: App,
    private signs: () => ExplorerSigns,
    private enabled: () => boolean
  ) {}

  /**
   * Hooks in; the first paint is the plugin's `onLayoutReady` callback's job
   * (the explorer exists only once the layout does), and every layout change
   * after that — an explorer opened later, a popout — schedules one here.
   */
  attach(plugin: Plugin): void {
    plugin.registerEvent(this.app.workspace.on("layout-change", () => this.schedule()));
    plugin.register(() => this.detach());
  }

  /** Re-paint soon: coalesces the bursts a status refresh and a re-render produce. */
  schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.apply();
    }, 50);
  }

  /** Paint now. Idempotent: a row already carrying the right sign is left alone. */
  apply(): void {
    const containers = this.explorerContainers();
    for (const c of containers) this.observe(c);
    const on = this.enabled();
    const signs = this.signs();
    try {
      for (const c of containers) {
        const rows = c.querySelectorAll(".nav-file-title, .nav-folder-title");
        for (const row of Array.from(rows) as HTMLElement[]) {
          const path = row.getAttribute("data-path");
          if (!path) continue;
          const isFolder = row.hasClass("nav-folder-title");
          let letter = "";
          let kind = "";
          let title = "";
          if (on) {
            if (isFolder) {
              const s = signs.folders.get(path);
              if (s) {
                letter = "●";
                kind = s;
                title = signTitle(s);
              }
            } else {
              const s = signs.files.get(path);
              if (s) {
                letter = signLetter(s);
                kind = s;
                title = signTitle(s);
              }
            }
          }
          this.paintRow(row, letter, kind, title, isFolder);
        }
      }
    } finally {
      // Our own writes, discarded before they can schedule another pass.
      for (const mo of this.observers) mo.takeRecords();
    }
  }

  private paintRow(row: HTMLElement, letter: string, kind: string, title: string, isFolder: boolean): void {
    const existing = row.querySelector(".ngb-sign") as HTMLElement | null;
    if (letter === "") {
      if (existing) existing.remove();
      row.removeClass("ngb-signed");
      return;
    }
    const cls = `ngb-sign ngb-sign-${kind}${isFolder ? " ngb-sign-folder" : ""}`;
    if (existing) {
      if (existing.className !== cls) existing.className = cls;
      if (existing.textContent !== letter) existing.setText(letter);
      if (existing.getAttribute("aria-label") !== title) existing.setAttribute("aria-label", title);
    } else {
      const span = row.createSpan({ cls, text: letter });
      span.setAttribute("aria-label", title);
    }
    row.addClass("ngb-signed");
  }

  private explorerContainers(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const el = (leaf.view as { containerEl?: HTMLElement }).containerEl;
      if (el) out.push(el);
    }
    return out;
  }

  private observe(container: HTMLElement): void {
    if (this.observed.has(container) || typeof MutationObserver === "undefined") return;
    this.observed.add(container);
    const mo = new MutationObserver(() => this.schedule());
    mo.observe(container, { childList: true, subtree: true });
    this.observers.push(mo);
  }

  /** Remove every sign and stop watching; the explorer is left as Obsidian built it. */
  detach(): void {
    for (const mo of this.observers) mo.disconnect();
    this.observers = [];
    this.observed = new WeakSet();
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    for (const c of this.explorerContainers()) {
      for (const s of Array.from(c.querySelectorAll(".ngb-sign"))) s.remove();
      for (const r of Array.from(c.querySelectorAll(".ngb-signed"))) (r as HTMLElement).removeClass("ngb-signed");
    }
  }
}
