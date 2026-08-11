/**
 * The decisions between the repair steps, as pure functions.
 *
 * The repair used to be one 4–13 minute runner action that decided everything
 * in bash, and all three defects it shipped were in those decisions (the fetch
 * gated on `removed > 0`, `ok=true` on a broken repository, findings never
 * logged). A fourth was in its verdict: missing objects that survive a full
 * refetch can belong to LOCAL, unpushed commits — the remote never had them —
 * and "clone the vault again" throws those commits away. So the runner now
 * executes four short primitives and answers with raw fsck findings, and what
 * happens next is decided HERE, where a unit test can replay the exact
 * timeline from the device's log bundle.
 */

/** Everything a decision needs from the last step's result. */
export interface RepairFindings {
  /** Raw fsck lines naming missing objects; "" when nothing is missing. */
  fsckMissing: string;
  /** All raw fsck findings, missing and damaged both. */
  fsckRemaining: string;
}

/** Context established once by `repair-scan` and carried through the job. */
export interface RepairContext {
  /** Commits on this branch that the upstream does not have. */
  ahead: number;
  /** fsck named the index's cache-tree — damage inside device-local state. */
  cacheTreeBroken: boolean;
  hasUpstream: boolean;
}

export type RepairStage = "scan" | "fetch-missing" | "refetch";

export type RepairDecision =
  /** Nothing missing, nothing damaged: the store is complete. */
  | { kind: "clean" }
  /** Nothing missing, but damaged (non-empty) objects remain — left alone by design. */
  | { kind: "damaged" }
  /** Objects are missing; ask the remote for exactly those. */
  | { kind: "fetch-missing"; oids: string[] }
  /** The targeted fetch did not finish it; the full refetch needs the user's yes. */
  | { kind: "ask-refetch" }
  /**
   * Missing objects survived a full refetch AND the evidence says they belong
   * to local-only state (unpushed commits, or the index's cache-tree). The
   * remote never had them, so no download can help — and a re-clone would
   * DISCARD the local commits. The exit is `repair-reset-upstream`.
   */
  | { kind: "offer-reset" }
  /**
   * Missing objects survived a full refetch and nothing points at local-only
   * state: the remote genuinely does not have them. A fresh clone is the
   * honest advice, and it is the user's decision.
   */
  | { kind: "missing-remote" };

/**
 * The unique full object ids out of fsck's own lines, capped at what one
 * `repair-fetch-missing` request accepts. fsck prints full 40-hex ids;
 * anything shorter in the text (an abbreviated id in prose) is not something
 * the runner could validate, so it is not extracted.
 */
export function missingOids(fsckMissing: string, cap = 64): string[] {
  const seen = new Set<string>();
  for (const m of fsckMissing.matchAll(/\b[0-9a-f]{40}\b/g)) {
    seen.add(m[0]);
    if (seen.size >= cap) break;
  }
  return [...seen];
}

/** One decision table for the whole job; `stage` says which step just answered. */
export function decideRepair(
  stage: RepairStage,
  findings: RepairFindings,
  ctx: RepairContext
): RepairDecision {
  const oids = missingOids(findings.fsckMissing);
  if (oids.length === 0) {
    return findings.fsckRemaining.trim() === "" ? { kind: "clean" } : { kind: "damaged" };
  }
  if (stage === "scan") return { kind: "fetch-missing", oids };
  if (stage === "fetch-missing") return { kind: "ask-refetch" };
  // After a full refetch. Ahead-of-upstream commits and a broken cache-tree
  // are both states the remote cannot know about; either one means the missing
  // object was never on the remote and the reset is the exit. Without an
  // upstream there is nothing to rebuild on, so the honest ending is the
  // remote-cannot-help one even when the evidence points local.
  if (ctx.hasUpstream && (ctx.ahead > 0 || ctx.cacheTreeBroken)) return { kind: "offer-reset" };
  return { kind: "missing-remote" };
}

