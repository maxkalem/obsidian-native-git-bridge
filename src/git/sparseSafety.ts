import { parseNameStatus, parseStatusPorcelainV1 } from "./parsers";
import type { SparseSafetyReport, SparseSafetyViolation } from "../types";

const STATUS_LABEL: Record<string, string> = {
  D: "deleted",
  M: "modified",
  A: "added",
  R: "renamed",
  C: "copied",
  T: "type-changed",
  U: "unmerged",
  "?": "untracked",
};

function label(code: string): string {
  return STATUS_LABEL[code] ?? `changed (${code})`;
}

/**
 * One line of the worktree listing, as a phrase that names BOTH columns when
 * they disagree.
 *
 * The old version read only the index column, so an `AD` entry — added to the
 * index, then removed from the worktree by `sparse-checkout reapply` — printed
 * as plain "added", twice (once here and once from the staged diff). The modal
 * then offered "Delete files locally" for a file that was not on disk at all,
 * the delete silently moved nothing, and the check kept blocking. Saying what
 * git actually reported is what leaves the state repairable.
 */
function worktreeLabel(index: string, worktree: string): string {
  // "??" and "UU" put the SAME code in both columns; they describe one state,
  // not two, and naming it twice reads as a bug.
  if (index === worktree) return label(index);
  if (index !== "." && worktree === "D") return `${label(index)} to the index, missing from the worktree`;
  if (index !== "." && worktree !== ".") return `${label(index)} (index), ${label(worktree)} (worktree)`;
  return label(index !== "." ? index : worktree);
}

/** True when `path` equals or lives under one of the protected paths. */
export function isPathProtected(path: string, protectedPaths: readonly string[]): boolean {
  const p = path.replace(/\/+$/, "");
  return protectedPaths.some((base) => {
    const b = base.replace(/\/+$/, "");
    return p === b || p.startsWith(b + "/");
  });
}

/**
 * Evaluate the mandatory pre-commit/pre-push sparse safety check.
 *
 * @param statusProtectedRaw  raw `git status --porcelain=v1 -- <protected...>` output
 * @param stagedProtectedRaw  raw `git diff --cached --name-status -- <protected...>` output
 *
 * ANY entry in either output blocks the operation: a protected sparse path must
 * never appear as deleted, modified, renamed, added, staged, or otherwise changed.
 * Sparse-checkout omissions must never be interpreted as deletions.
 */
export function evaluateSparseSafety(
  statusProtectedRaw: string,
  stagedProtectedRaw: string,
  protectedPaths: readonly string[],
  now: Date = new Date()
): SparseSafetyReport {
  const violations: SparseSafetyViolation[] = [];

  for (const e of parseStatusPorcelainV1(statusProtectedRaw)) {
    violations.push({
      path: e.path,
      status: worktreeLabel(e.index, e.worktree),
      source: "worktree",
      index: e.index,
      worktree: e.worktree,
    });
  }
  for (const e of parseNameStatus(stagedProtectedRaw)) {
    // `git diff --cached` compares HEAD to the index and says nothing about the
    // worktree, so only the index column is known here.
    violations.push({ path: e.path, status: label(e.index), source: "staged", index: e.index });
  }

  return {
    safe: violations.length === 0,
    violations,
    protectedPaths: [...protectedPaths],
    checkedAt: now.toISOString(),
  };
}

/**
 * What the one repair button has to do, per path.
 *
 * A protected path can be in the way in three different shapes, and the same
 * path can appear twice in the report (once from the worktree listing, once
 * from the staged diff), so the decision is made per path over ALL of its
 * violations, never per violation.
 *
 * - `trash`   — the file is only on disk (untracked). Move it to the trash.
 * - `unstage` — the path is only in the index (added, then removed from the
 *               worktree by a sparse reapply). There is nothing to delete;
 *               the index entry has to go, or the block never clears. This is
 *               safe precisely because the path is NOT in HEAD: dropping the
 *               entry cannot turn into a staged deletion of tracked content.
 * - both      — added to the index AND still on disk. Doing only one of the
 *               two leaves the other half behind and the check still blocks.
 * - `blocked` — the path is tracked in HEAD. Deleting or unstaging it would
 *               create the staged deletion this check exists to prevent.
 *               Listed with a reason rather than dropped from the plan.
 */
export interface SparseRepairPlan {
  /** Paths to move to Obsidian's trash. */
  trash: string[];
  /** Paths to drop from the index (`git rm --cached`). */
  unstage: string[];
  /** Paths the plugin refuses to touch, with why. */
  blocked: { path: string; reason: string }[];
}

export function planSparseRepair(report: SparseSafetyReport): SparseRepairPlan {
  const byPath = new Map<string, SparseSafetyViolation[]>();
  for (const v of report.violations) {
    const list = byPath.get(v.path);
    if (list) list.push(v);
    else byPath.set(v.path, [v]);
  }

  const plan: SparseRepairPlan = { trash: [], unstage: [], blocked: [] };
  for (const [path, vs] of byPath) {
    // Untracked entries carry "?" in BOTH columns; either one is the signal.
    const untracked = vs.some((v) => v.index === "?" || v.worktree === "?");
    const indexCodes = vs.map((v) => v.index).filter((c): c is string => c !== undefined);
    const worktreeOnly = vs.some(
      (v) => v.source === "worktree" && v.index === "." && v.worktree !== "." && v.worktree !== "?"
    );

    // Unmerged paths belong to the conflict UI, never to this repair. `AA`
    // (both added) and `AU` (added by us) carry an "A" in the index column, so
    // the plain "is it an addition" test below reads them as ordinary staged
    // additions — and trashing the file plus dropping the index entry of a path
    // that is mid-conflict destroys the merge state. Any "U" in either column,
    // or "A" in both, is a conflict.
    const unmerged = vs.some(
      (v) => v.index === "U" || v.worktree === "U" || (v.index === "A" && v.worktree === "A")
    );

    // "In HEAD" is the only question that matters, and it is answered two ways.
    // An index code other than A/?/blank means the entry differs from committed
    // content, so committed content exists. A change in the WORKTREE column
    // with a blank index column means the same thing more plainly: git only
    // reports M/D/T there for a path it already tracks. Missing this second
    // case is how " M <file>" first slipped through as deletable.
    const tracked =
      indexCodes.some((c) => c !== "?" && c !== "." && c !== "A") || (!untracked && worktreeOnly);
    if (unmerged) {
      plan.blocked.push({
        path,
        reason: "conflicted (unmerged) — finish or abort the merge first",
      });
      continue;
    }
    if (tracked) {
      plan.blocked.push({
        path,
        reason:
          "tracked in the last commit — removing it here would create the staged deletion this check blocks",
      });
      continue;
    }

    const inIndex = indexCodes.includes("A");
    // Only the worktree listing knows what is on disk. "D" there means git
    // looked and did not find the file. A violation that came ONLY from the
    // staged diff says nothing about disk, so it is treated as index-only; if a
    // file does turn out to be there, the re-run of the check lists it and the
    // next repair trashes it.
    const wt = vs.find((v) => v.source === "worktree");
    const onDisk = untracked || (wt !== undefined && wt.worktree !== "D");

    if (onDisk) plan.trash.push(path);
    if (inIndex) plan.unstage.push(path);
    if (!onDisk && !inIndex) {
      // Neither column offers a handle: report it rather than pretend the
      // button did something. "Moved 0 files" was exactly that pretence.
      plan.blocked.push({ path, reason: "not on disk and not in the index — resolve it in Termux" });
    }
  }
  return plan;
}
