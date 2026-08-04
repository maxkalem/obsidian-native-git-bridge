/**
 * Directional "travelling highlight" icons for pull/fetch (downwards) and push
 * (upwards). The stroke is painted with a repeating vertical gradient whose
 * gradientTransform is animated (SMIL), so a bright band sweeps along the arrow
 * while the rest of the glyph stays dimmed. Colors come from Obsidian CSS
 * variables, so light/dark themes are handled automatically.
 */

let gradientSeq = 0;

const PATHS: Record<"down" | "up", string> = {
  // Same glyphs as the static icons (24x24 coordinate system).
  down: "M12 3v12M7 10l5 5 5-5M5 21h14",
  up: "M12 15V3M7 8l5-5 5 5M5 21h14",
};

export function directionalHighlightSvg(direction: "down" | "up"): string {
  const id = `ngb-grad-${++gradientSeq}`;
  // Band travels 0 -> +24 for "down" and 0 -> -24 for "up" (one glyph height).
  const from = direction === "down" ? "0 -24" : "0 24";
  const to = "0 0";
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="ngb-anim-sweep-svg">
  <defs>
    <linearGradient id="${id}" gradientUnits="userSpaceOnUse"
                    x1="0" y1="0" x2="0" y2="24" spreadMethod="repeat">
      <stop offset="0"    stop-color="var(--text-muted)"/>
      <stop offset="0.28" stop-color="var(--text-muted)"/>
      <stop offset="0.5"  stop-color="var(--text-accent)"/>
      <stop offset="0.72" stop-color="var(--text-muted)"/>
      <stop offset="1"    stop-color="var(--text-muted)"/>
      <animateTransform attributeName="gradientTransform" type="translate"
                        from="${from}" to="${to}" dur="1s" repeatCount="indefinite"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#${id})" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="${PATHS[direction]}"/>
  </g>
</svg>`.trim();
}

/** Replace a button's icon with the animated variant. */
export function applySweepIcon(button: HTMLElement, direction: "down" | "up"): void {
  button.empty();
  const wrapper = button.createSpan({ cls: "ngb-sweep-wrap" });
  // Built from a trusted constant template; no external input is interpolated.
  wrapper.innerHTML = directionalHighlightSvg(direction);
}
