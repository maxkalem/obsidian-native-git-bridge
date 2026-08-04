import { addIcon } from "obsidian";

/**
 * Custom icons. Obsidian's addIcon expects the SVG body in a 0 0 100 100
 * coordinate system, so 24x24 Lucide-style paths must be scaled by 100/24;
 * the stroke width is divided by the same factor to keep it visually correct.
 */
export const NGB_ICON_PUSH = "ngb-push";
export const NGB_ICON_PULL = "ngb-pull";
export const NGB_ICON_STAGE_ALL = "ngb-stage-all";
export const NGB_ICON_UNSTAGE_ALL = "ngb-unstage-all";
export const NGB_ICON_SYNC = "ngb-sync";

const SCALE = 100 / 24;

function scaled(path: string, strokeWidth = 2): string {
  return (
    `<g transform="scale(${SCALE})" fill="none" stroke="currentColor" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</g>`
  );
}

export function registerIcons(): void {
  addIcon(NGB_ICON_PUSH, scaled('<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>'));
  addIcon(NGB_ICON_PULL, scaled('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'));
  // Stage all / unstage all: a file stack with a plus / minus badge.
  addIcon(
    NGB_ICON_STAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M17 10v8M13 14h8"/>')
  );
  addIcon(
    NGB_ICON_UNSTAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M13 14h8"/>')
  );
  // Sync: two opposing arrows (deliberately unlike the circular refresh icon).
  addIcon(
    NGB_ICON_SYNC,
    scaled('<path d="M8 3v14M4 13l4 4 4-4M16 21V7M12 11l4-4 4 4"/>')
  );
}
