/**
 * "Tap to see the whole thing" for a label that had to be shortened.
 *
 * Two places need it and they need the same interaction, not two similar ones:
 * the file-count badge, whose column is a fixed four characters wide, and the
 * "moved from" hint on a rename row, whose path is longer than any phone. In
 * both cases the shortened text is the only thing on screen, so the exact value
 * has to be reachable — and reachable the same way, or the panel teaches two
 * gestures for one idea.
 *
 * Tap shows the popup for three seconds; holding the finger (or the mouse
 * button) down keeps it open and the countdown restarts on release.
 */

/**
 * Obsidian's trash, at the vault root. Named here rather than written twice:
 * `.trash` is the user's own folder — nothing this plugin creates ever goes
 * there — and this module only ever reads the name to tell a deletion apart
 * from a move.
 */
const TRASH_DIR = ".trash";

/** Which edge of the target the popup lines up with. */
export type RevealAlign = "left" | "right";

/**
 * A move, described as the reader reads it: where it was, an arrow, where it is
 * now. One string with an arrow in the middle of it made the two paths one
 * blob, and the eye has to find the difference between them.
 *
 * `describeMove` drops the directory when only the name changed. Repeating an
 * identical path twice states nothing and buries the part that did change.
 */
export function describeMove(from: string, to: string): string[] {
  const dir = (p: string) => {
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i) : "";
  };
  const name = (p: string) => {
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(i + 1) : p;
  };
  // Git reports a delete-to-trash as a rename, because that is what it is on
  // disk: same content, new path. It is not what the user did, though — they
  // deleted a file — and reading `Private/Inbox/x.jpg ↓ .trash/x.jpg` as a
  // rename is how someone goes looking for a file they think they moved.
  if (to === TRASH_DIR || to.startsWith(`${TRASH_DIR}/`)) {
    return [from, "↓ deleted, into Obsidian's trash", to];
  }
  const sameDir = dir(from) === dir(to);
  if (sameDir) {
    // Renamed in place. The directory is stated once, above both names, when
    // there is one at all.
    const head = dir(from) === "" ? [] : [`${dir(from)}/`];
    return [...head, name(from), "↓", name(to)];
  }
  return [from, "↓", to];
}

export interface RevealOptions {
  /**
   * Default "right", which is what the count badge wants: it sits in the
   * right-hand column, so a popup growing leftwards from its right edge stays
   * on screen. A label at the start of a row wants "left" for the mirror
   * reason.
   */
  align?: RevealAlign;
}

/**
 * Make `el` reveal `text` on tap. Returns `el` so it can be chained onto a
 * `createSpan` call.
 *
 * The popup is `position: fixed` on the element's own document body, so it is
 * not clipped by the panel's scroller and it works in a popout window.
 */
export function revealOnTap(
  el: HTMLElement,
  text: string | string[],
  opts: RevealOptions = {}
): HTMLElement {
  const align = opts.align ?? "right";
  el.addClass("ngb-reveal-target");
  let pop: HTMLElement | null = null;
  let timer: number | null = null;
  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const hide = () => {
    clearTimer();
    pop?.remove();
    pop = null;
  };
  const show = () => {
    clearTimer();
    if (pop !== null) return;
    pop = el.doc.body.createDiv({ cls: "ngb-reveal-pop" });
    // One div per line, not one string with newlines in it: `↓` on a line of
    // its own is what makes a move read as a move.
    for (const line of Array.isArray(text) ? text : [text]) {
      // The arrow line may carry words after the glyph ("↓ deleted, into
      // Obsidian's trash"), so the test is the prefix, not equality.
      pop.createDiv({
        cls: line.startsWith("↓") ? "ngb-reveal-arrow" : "ngb-reveal-line",
        text: line,
      });
    }
    const r = el.getBoundingClientRect();
    // Anchored above the target and clamped to the viewport, so a target on the
    // bottom row of a phone screen still shows its popup on screen.
    pop.style.top = `${Math.max(4, r.top - 4)}px`;
    if (align === "right") {
      pop.style.right = `${Math.max(4, el.win.innerWidth - r.right)}px`;
    } else {
      // Measured after insertion rather than guessed: the popup's width depends
      // on its text, and a long path anchored at a row's left edge would
      // otherwise run off the right of the screen.
      const w = pop.getBoundingClientRect().width;
      const maxLeft = Math.max(4, el.win.innerWidth - w - 4);
      pop.style.left = `${Math.min(Math.max(4, r.left), maxLeft)}px`;
    }
  };
  // Started and cleared through the SAME window. The count badge armed its
  // timer on `el.win` and cleared it through the global `window`, which in a
  // popout are two different objects: the clear was aimed at a timer id
  // belonging to another window. `window.setTimeout` for both, per Obsidian's
  // own recommendation for timers; only the geometry below needs `el.win`,
  // because that is genuinely per window.
  const arm = () => {
    clearTimer();
    timer = window.setTimeout(hide, 3000);
  };
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    show();
    arm();
  });
  // Press-and-hold keeps it open; the timer starts again when released.
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    show();
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
    el.addEventListener(ev, () => {
      if (pop !== null) arm();
    });
  }
  return el;
}
