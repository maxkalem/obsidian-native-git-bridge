/** Actions understood by the Termux runner. Phase 2 implements the first five. */
export type BridgeAction =
  | "ping"
  | "status"
  | "verify-sparse-safety"
  | "sparse-reapply"
  | "diagnostics"
  // Phase 3+ (declared for forward-compat; runner rejects unknown actions):
  | "fetch"
  | "pull"
  | "commit"
  | "push"
  | "sync"
  | "file-log"
  | "show-file-at-commit"
  | "diff-file"
  | "restore-file"
  | "abort-merge"
  | "stage-file"
  | "unstage-file"
  | "discard-file";

export const PHASE2_ACTIONS: ReadonlySet<string> = new Set([
  "ping",
  "status",
  "verify-sparse-safety",
  "sparse-reapply",
  "diagnostics",
]);

/** Actions that may modify repository state; serialized behind the operation lock. */
export const MUTATING_ACTIONS: ReadonlySet<string> = new Set([
  "sparse-reapply",
  "pull",
  "commit",
  "push",
  "sync",
  "restore-file",
  "abort-merge",
  "stage-file",
  "unstage-file",
  "discard-file",
]);

export interface BridgeRequest {
  protocolVersion: number;
  id: string;
  token: string;
  action: BridgeAction;
  createdAt: string;
  timeoutSeconds: number;
  args: Record<string, unknown>;
}

export interface BridgeErrorInfo {
  code:
    | "AUTH"
    | "BAD_REQUEST"
    | "GIT_FAILED"
    | "CANCELLED"
    | "SAFETY_BLOCKED"
    | "TIMEOUT"
    | "PROTOCOL"
    | string;
  message: string;
  stdout?: string;
  stderr?: string;
}

export interface BridgeResult {
  protocolVersion: number;
  id: string;
  action: string;
  ok: boolean;
  exitCode: number;
  startedAt?: string;
  finishedAt?: string;
  runnerVersion?: number;
  data?: Record<string, string>;
  error?: BridgeErrorInfo | null;
}

/** One porcelain entry, either v1 or v2 derived. */
export interface GitFileEntry {
  path: string;
  origPath?: string;
  /** index (staged) status char, "." when unchanged */
  index: string;
  /** worktree status char, "." when unchanged */
  worktree: string;
}

export interface GitStatusSummary {
  oid?: string;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  detached: boolean;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  conflicted: GitFileEntry[];
}

export interface SparseStateSummary {
  enabled: boolean;
  coneMode: boolean | undefined;
  patterns: string[];
  skipWorktreeCount: number;
}

export interface SparseSafetyViolation {
  path: string;
  status: string;
  source: "worktree" | "staged";
}

export interface SparseSafetyReport {
  safe: boolean;
  violations: SparseSafetyViolation[];
  protectedPaths: string[];
  checkedAt: string;
}

export type BridgeIntegrationType = "widget-manual" | "companion-intent";

export interface OperationMarker {
  id: string;
  action: string;
  startedAt: number;
}
