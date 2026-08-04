export const PLUGIN_ID = "native-git-bridge";
export const PROTOCOL_VERSION = 1;
export const RUNNER_MIN_VERSION = 2;

export const DEFAULT_PROTECTED_PATHS = ["Private/AgentsMemory", "Projects/Backus"];

export const RUNTIME_DIR_NAME = "runtime";
export const REQUESTS_DIR = "requests";
export const RESULTS_DIR = "results";
export const CANCEL_DIR = "cancel";
export const DONE_DIR = "done";

export const POLL_INTERVAL_MS = 400;
export const DEFAULT_TIMEOUT_SECONDS = 90;
export const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STALE_LOCK_MS = 30 * 60 * 1000;
export const DISPLAY_OUTPUT_LIMIT = 100 * 1024;
export const LOG_MAX_ENTRIES = 200;

export const SPARSE_SAFETY_WARNING =
  "Sparse checkout safety check failed. The excluded directories appear as Git changes. " +
  "No commit or push was performed.";

/** localStorage key prefix; versioned for migrations. */
export const STORAGE_PREFIX = "ngb:v1";

/** Raw base URL for the one-line Termux bootstrap (used only for display/copy in settings). */
export const REPO_RAW_BASE = "https://raw.githubusercontent.com/maxkalem/obsidian-native-git-bridge/main/native-git-bridge";
export const PAIRING_FILE = "pairing.json";

/** Shown whenever the Termux-side runner is older than RUNNER_MIN_VERSION. */
export const RUNNER_OUTDATED_HINT =
  "The Termux runner script is outdated. Updating the plugin does not update it — " +
  "re-run the install command in Termux (Settings -> Native Git Bridge -> Copy command, " +
  "or the 'Set up Termux' button in the companion app).";
