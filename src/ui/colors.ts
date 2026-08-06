/**
 * Optional custom colours for the diff and conflict panes.
 *
 * By default the panes use the values in styles.css, which are built from
 * Obsidian's own theme variables and follow whatever theme is active. A user
 * who wants different colours turns ONE toggle on; only then do the pickers
 * appear, and only then are the variables written (inline, on the pane) at
 * all. Turning the toggle off removes them again, so the theme takes over
 * with no reload and nothing is left behind.
 *
 * Light and dark are stored separately because one set of hex values cannot
 * be legible in both.
 */

export type ThemeMode = "light" | "dark";

export interface NgbColorSet {
  /** Diff pane: background tint of an added line. */
  diffAddBg: string;
  /** Diff pane: highlight behind the characters that were added. */
  diffAddHl: string;
  /** Diff pane: background tint of a deleted line. */
  diffDelBg: string;
  /** Diff pane: highlight behind the characters that were deleted. */
  diffDelHl: string;
  /** Conflict pane: background of the LOCAL (yours) side. */
  conflictLocalBg: string;
  /** Conflict pane: background of the REMOTE (theirs) side. */
  conflictRemoteBg: string;
}

/**
 * Seeds for the pickers, close to what the stylesheet draws by default.
 * `diffDelHl` is #AA1414 in both themes: the translucent red it replaced was
 * not readable against a red row on a phone screen.
 */
export const DEFAULT_COLORS: Record<ThemeMode, NgbColorSet> = {
  dark: {
    diffAddBg: "#1e4620",
    diffAddHl: "#2f8f2f",
    diffDelBg: "#4a1f22",
    diffDelHl: "#AA1414",
    conflictLocalBg: "#14361f",
    conflictRemoteBg: "#12283f",
  },
  light: {
    diffAddBg: "#d7f5d7",
    diffAddHl: "#7fd07f",
    diffDelBg: "#ffd9dc",
    diffDelHl: "#AA1414",
    conflictLocalBg: "#e6f7ec",
    conflictRemoteBg: "#e3eefb",
  },
};

/** CSS variables the diff pane owns (also the list to clear when custom colours go off). */
export const DIFF_COLOR_VARS = [
  "--ngb-diff-ins-bg",
  "--ngb-diff-ins-hl",
  "--ngb-diff-del-bg",
  "--ngb-diff-del-hl",
] as const;

/** CSS variables the conflict pane owns. */
export const CONFLICT_COLOR_VARS = ["--ngb-conf-ours-bg", "--ngb-conf-theirs-bg"] as const;

export function diffColorVars(set: NgbColorSet): Record<string, string> {
  return {
    "--ngb-diff-ins-bg": set.diffAddBg,
    "--ngb-diff-ins-hl": set.diffAddHl,
    "--ngb-diff-del-bg": set.diffDelBg,
    "--ngb-diff-del-hl": set.diffDelHl,
  };
}

export function conflictColorVars(set: NgbColorSet): Record<string, string> {
  return {
    "--ngb-conf-ours-bg": set.conflictLocalBg,
    "--ngb-conf-theirs-bg": set.conflictRemoteBg,
  };
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Merge stored values over the defaults, ignoring anything that is not a plain
 * hex colour. The values end up in a `style` attribute, so a stray string from
 * a hand-edited data.json must never travel further than this function.
 */
export function sanitizeColorSet(raw: unknown, mode: ThemeMode): NgbColorSet {
  const base = DEFAULT_COLORS[mode];
  const out: NgbColorSet = { ...base };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof NgbColorSet)[]) {
    const v = r[k];
    if (typeof v === "string" && HEX.test(v)) out[k] = v;
  }
  return out;
}
