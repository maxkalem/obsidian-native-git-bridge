/**
 * Right click (desktop) and long press (touch) on a row or header. The touch
 * timer backs up `contextmenu`, which Android's WebView delivers
 * inconsistently, and is cancelled by movement so scrolling never opens a
 * menu. The caller receives the anchor position and opens the menu itself.
 *
 * Lived as a private method of StatusView until the repository-history rows
 * needed the same gesture (0.6.7); one copy here, per §7's duplication rule.
 */
export function attachContextMenu(
  el: HTMLElement,
  open: (pos: { x: number; y: number }) => void
): void {
  const anchor = (ev: MouseEvent | TouchEvent): { x: number; y: number } => {
    // The typeof guard is for the unit-test DOM, which has no MouseEvent
    // constructor; a WebView always does.
    if (typeof MouseEvent !== "undefined" && ev instanceof MouseEvent && ev.clientX) {
      return { x: ev.clientX, y: ev.clientY };
    }
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  };
  el.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    open(anchor(ev));
  });
  let longPress: number | null = null;
  const clearLongPress = () => {
    if (longPress !== null) {
      window.clearTimeout(longPress);
      longPress = null;
    }
  };
  el.addEventListener(
    "touchstart",
    (ev) => {
      clearLongPress();
      longPress = window.setTimeout(() => {
        longPress = null;
        open(anchor(ev));
      }, 500);
    },
    { passive: true }
  );
  for (const e of ["touchend", "touchmove", "touchcancel"]) {
    el.addEventListener(e, clearLongPress, { passive: true });
  }
}
