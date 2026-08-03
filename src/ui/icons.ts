import { addIcon } from "obsidian";

/** Custom icons registered once at load. Obsidian's built-ins are used elsewhere
 * (refresh-cw, file-clock, git-branch, …) to match obsidian-git's visual language. */
export const NGB_ICON_PUSH = "ngb-push";
export const NGB_ICON_PULL = "ngb-pull";

const STROKE_WRAP = (path: string): string =>
  `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</g>`;

export function registerIcons(): void {
  addIcon(NGB_ICON_PUSH, STROKE_WRAP('<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>'));
  addIcon(NGB_ICON_PULL, STROKE_WRAP('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'));
}
