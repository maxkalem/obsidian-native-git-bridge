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
    const code = e.index !== "." ? e.index : e.worktree;
    violations.push({ path: e.path, status: label(code), source: "worktree" });
  }
  for (const e of parseNameStatus(stagedProtectedRaw)) {
    violations.push({ path: e.path, status: label(e.index), source: "staged" });
  }

  return {
    safe: violations.length === 0,
    violations,
    protectedPaths: [...protectedPaths],
    checkedAt: now.toISOString(),
  };
}
