/**
 * What the status panel should say and offer while a merge or a rebase is
 * unfinished.
 *
 * This exists because the panel used to have no answer at all for that state.
 * "Abort merge" lived only in the context menu of the Conflicts group, and that
 * group renders only when git reports unmerged index entries. A merge whose
 * conflicts were already resolved and staged therefore left MERGE_HEAD behind
 * with nothing on screen to act on: every pull answered "A merge is already in
 * progress", and the only way out was Termux.
 *
 * The decision is a pure function so it can be tested without a DOM, and so
 * the merge and rebase cases cannot drift into two different vocabularies.
 */

export type InProgressKind = "merge" | "rebase";

export interface InProgressButton {
  label: string;
  /** False while the operation cannot legally be finished yet. */
  enabled: boolean;
}

export interface InProgressBanner {
  kind: InProgressKind;
  /** Headline: what is unfinished, and whether anything is still in the way. */
  title: string;
  /** What each button will do, including what aborting costs. */
  detail: string;
  /**
   * The same two lines for a phone, where the banner sits in the panel's fixed
   * region and every line it takes is a line of file list nobody can see. The
   * text is SHORTER, not smaller: shrinking the font on the one control that
   * must not be missed is the wrong trade.
   */
  shortTitle: string;
  shortDetail: string;
  /** The way forward. */
  finish: InProgressButton;
  /** The way out. Never disabled: it is the escape hatch. */
  abort: InProgressButton;
}

export interface InProgressState {
  mergeInProgress?: boolean;
  rebaseInProgress?: boolean;
  /** Files git reports as unmerged (`U` in porcelain), i.e. still conflicted. */
  conflictCount: number;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `null` when nothing is in progress — the normal case, and the reason the
 * banner costs no screen space on a healthy repository.
 *
 * Rebase takes precedence over merge when both look active. A rebase that stops
 * on a conflict can leave MERGE_HEAD behind from the replayed commit, so the
 * merge flag alone would name the wrong operation and offer `git commit`, which
 * is not how a rebase is finished.
 */
export function describeInProgressOp(s: InProgressState): InProgressBanner | null {
  const kind: InProgressKind | null = s.rebaseInProgress
    ? "rebase"
    : s.mergeInProgress
      ? "merge"
      : null;
  if (kind === null) return null;

  const n = Math.max(0, s.conflictCount);
  const clean = n === 0;
  const noun = kind === "merge" ? "Merge" : "Rebase";
  const undoes =
    kind === "merge"
      ? "Aborting puts the branch back where it was before the pull."
      : "Aborting puts the branch back where it was before the rebase started.";

  const title = clean
    ? `${noun} in progress — everything is resolved`
    : `${noun} in progress — ${plural(n, "file is", "files are")} still conflicted`;

  const detail = clean
    ? kind === "merge"
      ? `Nothing is left to resolve. Commit the merge to finish it. ${undoes}`
      : `Nothing is left to resolve. Continue to replay the remaining commits. ${undoes}`
    : kind === "merge"
      ? `Resolve the conflicted files listed below, then commit the merge. ${undoes}`
      : `Resolve the conflicted files listed below, then continue. ${undoes}`;

  // Phone wording. The branch state is already on the line above and the
  // conflicted files are already listed below, so the banner only has to say
  // which operation is open and what the two buttons do.
  const shortTitle = clean
    ? kind === "merge"
      ? "Merge ready to commit"
      : "Rebase ready to continue"
    : `${noun}: ${plural(n, "conflict", "conflicts")} left`;
  const shortDetail = clean
    ? kind === "merge"
      ? "Commit to finish, or abort to undo the pull."
      : "Continue to replay the rest, or abort."
    : kind === "merge"
      ? "Resolve them below, then commit."
      : "Resolve them below, then continue.";

  return {
    kind,
    title,
    detail,
    shortTitle,
    shortDetail,
    // Disabled rather than hidden: the button is where the user will look, and
    // a greyed one with the count above it explains itself. Enabling it would
    // send a commit that git refuses, or a `rebase --continue` that opens an
    // editor the runner has no terminal for.
    finish: {
      label: kind === "merge" ? "Commit merge" : "Continue rebase",
      enabled: clean,
    },
    abort: { label: kind === "merge" ? "Abort merge" : "Abort rebase", enabled: true },
  };
}
