import { setIcon } from "obsidian";

/**
 * Directional "thirds" activity animation: the button's own icon is drawn twice
 * — a dim base layer and a bright accent layer clipped to one third of the
 * glyph at a time. A CSS keyframe animation with discrete steps moves the lit
 * third downwards (pull, fetch) or upwards (push).
 *
 * Any icon can be animated, including Obsidian's built-ins, because both layers
 * are produced by setIcon rather than by a hardcoded path.
 *
 * Implemented in CSS, not SMIL: SMIL animations inside SVG inserted via
 * innerHTML stop after the first cycle in Android's WebView.
 */
export function applySweepIcon(
  button: HTMLElement,
  iconName: string,
  direction: "down" | "up"
): void {
  button.empty();
  const wrap = button.createSpan({ cls: "ngb-sweep" });
  const base = wrap.createSpan({ cls: "ngb-sweep-base" });
  setIcon(base, iconName);
  const lit = wrap.createSpan({ cls: `ngb-sweep-lit ngb-sweep-${direction}` });
  setIcon(lit, iconName);
}
