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

/** The stale-lock facts, from `repair-triage` (runner v16). */
export interface LockFacts {
  lockExists: boolean;
  /** Seconds since the lock file's mtime; null when the runner could not say. */
  lockAgeSeconds: number | null;
  /** A live process whose command name is git. */
  liveGit: boolean;
  /** Every other live process of the uid, "pid comm" per line. */
  liveProcesses: string[];
}

export type LockPlan =
  /** No lock file: nothing to do, and nothing to kill over it. */
  | { kind: "no-lock" }
  /**
   * A live git plus a fresh lock is a RUNNING command, not a corpse: the
   * right choice is to wait, and interrupting a write is how object files
   * end up empty. The kill stays available behind its own confirmation.
   */
  | { kind: "running" }
  /**
   * A lock with no process that could be holding it is a corpse from Android
   * stopping Termux: it is simply removed, no kill needed, nothing closes.
   */
  | { kind: "corpse" }
  /** Something is alive; removing safely needs the kill, and the kill needs a yes. */
  | { kind: "ask-kill" };

/**
 * v15 killed blind: every uid process, no questions, and it had never said it
 * closes Termux sessions. The distinction the user asked for falls out of two
 * facts the triage now reads — is a git alive, and how old is the lock.
 */
export function decideStaleLock(f: LockFacts, freshSeconds = 120): LockPlan {
  if (!f.lockExists) return { kind: "no-lock" };
  if (f.liveGit && f.lockAgeSeconds !== null && f.lockAgeSeconds <= freshSeconds) {
    return { kind: "running" };
  }
  if (f.liveProcesses.length === 0) return { kind: "corpse" };
  return { kind: "ask-kill" };
}

/** What `repair-triage` (v16) reports, digested for the step planner. */
export interface RepairTriageFacts {
  lock: LockFacts;
  identity: {
    /** Both user.name and user.email exist in the LOCAL scope. */
    local: boolean;
    /** Either key exists in the GLOBAL scope. */
    global: boolean;
    /** Both keys resolve in SOME scope: a commit would succeed. */
    any: boolean;
  };
  /** A credential.helper in the global or system scope (shadows the profile's file). */
  globalCredHelper: boolean;
  sparse: {
    enabled: boolean;
    cone: boolean;
    /** The include-everything base `/*` is present in the pattern list. */
    hasBase: boolean;
    /** git's own emptying default (the `!` + `/*` + `/` line) is present. */
    hasEmptyingDefault: boolean;
  };
  rescueBranches: string[];
  previousGitDirs: string[];
}

export type RepairPlanItem =
  /** A lock nothing can be holding: removed without killing anything. */
  | { step: "lock"; act: "remove-corpse" }
  /** A live git with a fresh lock: the whole repair waits, by design. */
  | { step: "lock"; act: "wait-running" }
  /** Something is alive; the removal needs the kill and the kill needs a yes. */
  | { step: "lock"; act: "ask-kill" }
  /** No usable identity for a commit, or none local: offer the Termux command. */
  | { step: "identity"; act: "offer-set" }
  /** A local identity exists AND a global one does: offer the value-free removal. */
  | { step: "identity"; act: "offer-drop-global" }
  /** A global helper answers before the profile's file: offer the local reset. */
  | { step: "cred-helper"; act: "offer-reset" }
  /** Non-cone sparse missing its base or carrying the emptying default: fixable. */
  | { step: "sparse"; act: "repair-definition" }
  /** Cone mode is somebody's setup; switching modes is the user's decision. */
  | { step: "sparse"; act: "cone-needs-decision" }
  | { step: "leftovers"; act: "rescue-branches" }
  | { step: "leftovers"; act: "previous-git" };

/**
 * The unified repair's step list, in the user's order: blockers first, cheap
 * before expensive. Ownership is handled BEFORE this (a refused repository
 * answers the triage itself with REPO_MISSING), and the object-database steps
 * run AFTER it (they have their own decision table above). Pure, so a unit
 * test can replay a device's triage verbatim.
 */
export function planRepair(f: RepairTriageFacts): RepairPlanItem[] {
  const plan: RepairPlanItem[] = [];
  const lock = decideStaleLock(f.lock);
  if (lock.kind === "corpse") plan.push({ step: "lock", act: "remove-corpse" });
  else if (lock.kind === "running") plan.push({ step: "lock", act: "wait-running" });
  else if (lock.kind === "ask-kill") plan.push({ step: "lock", act: "ask-kill" });
  if (!f.identity.any || !f.identity.local) {
    plan.push({ step: "identity", act: "offer-set" });
  } else if (f.identity.global) {
    plan.push({ step: "identity", act: "offer-drop-global" });
  }
  if (f.globalCredHelper) plan.push({ step: "cred-helper", act: "offer-reset" });
  if (f.sparse.enabled) {
    if (f.sparse.cone) plan.push({ step: "sparse", act: "cone-needs-decision" });
    else if (!f.sparse.hasBase || f.sparse.hasEmptyingDefault) {
      plan.push({ step: "sparse", act: "repair-definition" });
    }
  }
  if (f.rescueBranches.length > 0) plan.push({ step: "leftovers", act: "rescue-branches" });
  if (f.previousGitDirs.length > 0) plan.push({ step: "leftovers", act: "previous-git" });
  return plan;
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

