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
  | "discard-file"
  | "stage-all"
  | "unstage-all"
  | "sparse-exclude-add"
  | "sparse-exclude-remove"
  | "exclude-add"
  | "exclude-remove"
  | "exclude-list";

/**
 * The runner version that introduced RUNNER4_ACTIONS. The pre-flight gate must
 * compare against THIS, not RUNNER_MIN_VERSION: the minimum moves with every
 * runner change (v5 added untrackedChildren), but a v4 runner still executes
 * these actions perfectly well.
 */
export const RUNNER4_INTRODUCED = 4;

/** Actions that only exist from runner v4 on (config management). */
export const RUNNER4_ACTIONS: ReadonlySet<BridgeAction> = new Set([
  "sparse-exclude-add",
  "sparse-exclude-remove",
  "exclude-add",
  "exclude-remove",
  "exclude-list",
]);

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
  "stage-all",
  "unstage-all",
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

/** Codes this plugin knows how to explain; the runner may add new ones. */
export type KnownBridgeErrorCode =
  | "AUTH"
  | "BAD_REQUEST"
  | "GIT_FAILED"
  | "CANCELLED"
  | "SAFETY_BLOCKED"
  | "TIMEOUT"
  | "PROTOCOL"
  | "CONFLICT"
  | "EXPIRED"
  | "RUNNER_INTERNAL"
  | "FILE_ABSENT"
  | "TOO_LARGE";

/**
 * `(string & {})` keeps the literals visible to autocompletion while still
 * accepting a code from a newer runner. A plain `| string` union erased them.
 */
export interface BridgeErrorInfo {
  code: KnownBridgeErrorCode | (string & {});
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
  /**
   * Files inside fully untracked directories, keyed by the directory entry as
   * it appears in `untracked` (with its trailing slash). git status collapses
   * such a directory to one "dir/" line; a v5+ runner enumerates the files so
   * the panel can show them. Absent on results from older runners.
   */
  untrackedChildren?: Record<string, string[]>;
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

export interface OperationMarker {
  id: string;
  action: string;
  startedAt: number;
}
