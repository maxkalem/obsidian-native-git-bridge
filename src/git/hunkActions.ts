/**
 * Which hunk actions a diff pane may offer, decided by what the pane is showing.
 *
 * A diff has a direction, and the direction is what makes an action meaningful:
 *
 *   HEAD  → INDEX      the staged side.   Unstage is the only move.
 *   INDEX → WORKTREE   the unstaged side. Stage, and discard.
 *   commit → anything  history.           Neither: there is nothing to stage.
 *
 * Kept apart from the view so the rule is stated once and tested, rather than
 * being re-derived from `from`/`to` strings wherever a button is drawn.
 */

export type HunkAction = "stage" | "unstage" | "discard";

export interface HunkActionPlan {
  action: HunkAction;
  /** Whole-hunk label. */
  label: string;
  /** Label while the pane is picking individual lines. */
  selectedLabel: string;
  /** Where the patch goes, and in which direction. */
  target: "index" | "worktree";
  reverse: boolean;
  /**
   * True when the action removes work rather than moving it between the index
   * and the working tree. Only discard does, and only discard is confirmed.
   */
  destructive: boolean;
}

const STAGE: HunkActionPlan = {
  action: "stage",
  label: "Stage hunk",
  selectedLabel: "Stage selected",
  target: "index",
  reverse: false,
  destructive: false,
};

const UNSTAGE: HunkActionPlan = {
  action: "unstage",
  label: "Unstage hunk",
  selectedLabel: "Unstage selected",
  target: "index",
  reverse: true,
  destructive: false,
};

const DISCARD: HunkActionPlan = {
  action: "discard",
  label: "Discard hunk",
  selectedLabel: "Discard selected",
  target: "worktree",
  reverse: true,
  destructive: true,
};

/**
 * Actions for a pane showing `from` → `to`, in the order they should appear.
 *
 * Empty for a history diff. The `INDEX` pseudo-ref is the runner's, and its two
 * legal combinations are the two working states.
 */
export function hunkActionsFor(from: string, to: string): HunkActionPlan[] {
  if (to === "INDEX") return [UNSTAGE];
  if (from === "INDEX" && to === "WORKTREE") return [STAGE, DISCARD];
  return [];
}

/** True when this pane can pick individual lines, which needs at least one action. */
export function supportsLineSelection(from: string, to: string): boolean {
  return hunkActionsFor(from, to).length > 0;
}
