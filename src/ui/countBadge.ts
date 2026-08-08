/**
 * The file-count badge that sits in the right-hand column of the panels, in
 * the same slot as a file row's change letter.
 *
 * That column is a FIXED width, the same on every kind of row, so the action
 * buttons to its left line up down the whole panel. Which means the text can
 * never be longer than four characters: a four-digit count (2415 untracked
 * files in one folder is an ordinary number here) used to widen the column and
 * shift that row's buttons out of line with every other row. Anything from a
 * thousand up is therefore abbreviated, and the exact figure is one tap away.
 */

export interface CountBadgeFormat {
  text: string;
  /** Render at a smaller size (the value no longer fits two digits). */
  small: boolean;
  /** The exact value is not readable from the badge alone. */
  clamped: boolean;
}

export function formatCount(count: number): CountBadgeFormat {
  const n = Math.max(0, Math.floor(count));
  if (n > 99999) return { text: "99k+", small: true, clamped: true };
  // Rounded DOWN throughout: a badge must never claim more files than there
  // are, and "9.9k" for 9999 is the honest reading of it.
  if (n >= 10000) return { text: `${Math.floor(n / 1000)}k`, small: true, clamped: true };
  if (n >= 1000) {
    const whole = Math.floor(n / 1000);
    const tenth = Math.floor((n % 1000) / 100);
    return { text: `${whole}.${tenth}k`, small: true, clamped: true };
  }
  return { text: String(n), small: n > 99, clamped: n > 99 };
}

/**
 * Render the badge into `parent`. When the number is too big to read at a
 * glance, tapping it shows the exact figure for three seconds; keeping the
 * finger (or mouse button) down holds the popup open, and the countdown
 * restarts on release.
 */
export function renderCountBadge(
  parent: HTMLElement,
  count: number,
  describe: (n: number) => string
): HTMLElement {
  const fmt = formatCount(count);
  const el = parent.createSpan({
    cls: `ngb-sv-count${fmt.small ? " ngb-sv-count-sm" : ""}`,
    text: fmt.text,
  });
  el.setAttribute("aria-label", describe(count));
  if (!fmt.clamped) return el;

  el.addClass("ngb-sv-count-more");
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
    if (pop === null) {
      pop = el.doc.body.createDiv({ cls: "ngb-count-pop", text: describe(count) });
      const r = el.getBoundingClientRect();
      // Anchored above the badge and clamped to the viewport, so a badge near
      // the bottom edge of a phone screen still shows its popup on screen.
      pop.style.top = `${Math.max(4, r.top - 4)}px`;
      pop.style.right = `${Math.max(4, el.win.innerWidth - r.right)}px`;
    }
  };
  const arm = () => {
    clearTimer();
    timer = el.win.setTimeout(hide, 3000);
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
