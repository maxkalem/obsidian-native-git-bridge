import { addIcon } from "obsidian";

/**
 * Custom icons. Obsidian's addIcon expects the SVG body in a 0 0 100 100
 * coordinate system, so 24x24 Lucide-style paths must be scaled by 100/24;
 * the stroke width is divided by the same factor to keep it visually correct.
 */
export const NGB_ICON_PUSH = "ngb-push";
export const NGB_ICON_PULL = "ngb-pull";
export const NGB_ICON_FETCH = "ngb-fetch";
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

/**
 * The three network operations share one cloud body so they read as a family,
 * and differ only in what happens under it: an arrow down for pull (the shape
 * users already recognise as "download"), an arrow up for push, a question
 * mark for fetch (it asks the remote what is there and changes nothing).
 * The cloud is Lucide's `cloud` outline, redrawn open at the bottom so the
 * three glyphs have room.
 */
const CLOUD = "M17.5 15a4.5 4.5 0 0 0-.9-8.9A6 6 0 0 0 5.2 8.4A3.8 3.8 0 0 0 6 15";

export function registerIcons(): void {
  // Down into the cloud's mouth: what the standard download icon looks like,
  // which is what people expect from "pull".
  addIcon(NGB_ICON_PULL, scaled(`<path d="${CLOUD}"/><path d="M12 11v8M8.5 15.5 12 19l3.5-3.5"/>`));
  addIcon(NGB_ICON_PUSH, scaled(`<path d="${CLOUD}"/><path d="M12 19v-8M8.5 14.5 12 11l3.5 3.5"/>`));
  // Fetch asks and reports; nothing moves into the working tree.
  addIcon(
    NGB_ICON_FETCH,
    scaled(
      `<path d="${CLOUD}"/>` +
        '<path d="M10.4 13.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.8-1.8 3"/>' +
        '<path d="M12.1 19.6h.01"/>'
    )
  );
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
