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
  | "exclude-list"
  | "repo-log"
  | "resolve-conflict"
  | "discard-all"
  | "reset-all"
  // Runner v11: the beginning of the story — a vault that is not a repository
  // yet, or one without a remote.
  | "init-repo"
  | "set-remote"
  | "clone-into-vault"
  | "adopt-remote"
  // The rebase state machine. Only the two exits are implemented: nothing in
  // the plugin STARTS a rebase yet. They exist because an unfinished rebase can
  // arrive from Termux, and until now the panel had no way out of one — the
  // same dead end that unfinished merges were in.
  | "abort-rebase"
  | "continue-rebase"
  /**
   * Clear protected sparse paths out of the INDEX. The one thing the runner
   * will do to a protected path, and only for paths that HEAD does not
   * contain — see the runner for why that constraint is what makes it safe.
   */
  | "unstage-protected";

/**
 * Runner version each late-added action first appeared in. The pre-flight gate
 * compares against THESE, not RUNNER_MIN_VERSION: the minimum moves with every
 * runner change, but e.g. a v4 runner still executes the v4 config-management
 * actions perfectly well. Actions absent here exist since the first supported
 * runner. An old runner would answer a bare BAD_REQUEST ("action not allowed"),
 * which reads like a plugin bug — the gate names the real cause up front.
 */
export const ACTION_MIN_RUNNER: ReadonlyMap<BridgeAction, number> = new Map([
  ["sparse-exclude-add", 4],
  ["sparse-exclude-remove", 4],
  ["exclude-add", 4],
  ["exclude-remove", 4],
  ["exclude-list", 4],
  ["repo-log", 5],
  ["resolve-conflict", 6],
  ["discard-all", 8],
  ["reset-all", 8],
  ["init-repo", 11],
  ["set-remote", 11],
  ["clone-into-vault", 11],
  ["adopt-remote", 11],
  ["abort-rebase", 11],
  ["continue-rebase", 11],
  ["unstage-protected", 11],
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
  "resolve-conflict",
  "discard-all",
  "reset-all",
  "init-repo",
  "set-remote",
  "clone-into-vault",
  "adopt-remote",
  "abort-rebase",
  "continue-rebase",
  "unstage-protected",
]);

export interface BridgeRequest {
  protocolVersion: number;
  id: string;
  token: string;
  action: BridgeAction;
  createdAt: string;
  timeoutSeconds: number;
  args: Record<string, unknown>;
  /**
   * Which paired vault this request belongs to (runner v10+). It is an opaque
   * id the runner LOOKS UP; a repository path is never sent. Omitted while this
   * vault has not learned its profile yet (an older pairing), in which case the
   * request directory it lands in decides — and the token still has to match.
   */
  profileId?: string;
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
  | "TOO_LARGE"
  /** The profile's repository is gone or is no longer a work tree (runner v10+). */
  | "REPO_MISSING"
  /** Refusing to initialise or clone over a repository that already exists (v11). */
  | "REPO_EXISTS";

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
  /** The profile that answered (runner v10+); how a vault learns its own id. */
  profileId?: string;
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
  /**
   * The two porcelain columns as git reported them, "." for a blank one.
   * Kept because the human-readable `status` collapses them and loses the fact
   * that decides what can be repaired: `AD` is an index entry whose file is
   * NOT on disk, and no amount of deleting files will clear it.
   */
  index?: string;
  worktree?: string;
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
