export const PLUGIN_ID = "native-git-bridge";
export const PROTOCOL_VERSION = 1;
export const RUNNER_MIN_VERSION = 1;

export const DEFAULT_PROTECTED_PATHS = ["Private/AgentsMemory", "Projects/Backus"];

export const RUNTIME_DIR_NAME = "runtime";
export const REQUESTS_DIR = "requests";
export const RESULTS_DIR = "results";
export const CANCEL_DIR = "cancel";
export const DONE_DIR = "done";

export const POLL_INTERVAL_MS = 400;
export const DEFAULT_TIMEOUT_SECONDS = 180;
export const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STALE_LOCK_MS = 30 * 60 * 1000;
export const DISPLAY_OUTPUT_LIMIT = 100 * 1024;
export const LOG_MAX_ENTRIES = 200;

export const SPARSE_SAFETY_WARNING =
  "Sparse checkout safety check failed. The excluded directories appear as Git changes. " +
  "No commit or push was performed.";

/** localStorage key prefix; versioned for migrations. */
export const STORAGE_PREFIX = "ngb:v1";
