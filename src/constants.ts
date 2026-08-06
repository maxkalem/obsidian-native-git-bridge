export const PLUGIN_ID = "native-git-bridge";
export const PROTOCOL_VERSION = 1;
export const RUNNER_MIN_VERSION = 11;

/**
 * git's canonical empty-tree object (constant across all repositories).
 * Diffing the ROOT commit against its (non-existent) parent fails; diffing
 * against the empty tree shows it as all-additions instead.
 */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * No baked-in defaults: protected paths are derived from the repository's own
 * sparse-checkout exclusions (read from git through the runner) plus whatever
 * the user adds manually in settings.
 */
export const DEFAULT_PROTECTED_PATHS: string[] = [];

export const RUNTIME_DIR_NAME = "runtime";
export const REQUESTS_DIR = "requests";
export const RESULTS_DIR = "results";
export const CANCEL_DIR = "cancel";
export const DONE_DIR = "done";

export const POLL_INTERVAL_MS = 400;
export const DEFAULT_TIMEOUT_SECONDS = 90;

/**
 * Actions that take as long as the network takes, rather than as long as git
 * takes. A clone of a real vault over a phone connection routinely outlives
 * the ordinary 90 s budget, and a timeout there would leave the user staring
 * at an error while Termux is still working.
 */
export const ACTION_TIMEOUT_SECONDS: Readonly<Record<string, number>> = {
  "clone-into-vault": 900,
  "adopt-remote": 900,
};
export const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STALE_LOCK_MS = 30 * 60 * 1000;
export const DISPLAY_OUTPUT_LIMIT = 100 * 1024;
export const LOG_MAX_ENTRIES = 200;

export const SPARSE_SAFETY_WARNING =
  "Sparse checkout safety check failed. The excluded directories appear as Git changes. " +
  "No commit or push was performed.";

/** localStorage key prefix; versioned for migrations. */
export const STORAGE_PREFIX = "ngb:v1";

export const REPO_URL = "https://github.com/maxkalem/obsidian-native-git-bridge";

/**
 * The install command fetches from a RELEASE, never from `main`: the branch is
 * the development state and may be mid-change, while a release is a tested,
 * immutable set of files. Pinned to the plugin's OWN version, so the runner it
 * installs is the one this build was tested against (that is also what the
 * version handshake expects). Falls back to the newest release when this
 * version has no published assets yet (e.g. a local dev build).
 */
export function bootstrapCommand(pluginVersion: string, repoPathHint: string): string {
  const base = /^\d+\.\d+\.\d+$/.test(pluginVersion)
    ? `${REPO_URL}/releases/download/${pluginVersion}`
    : `${REPO_URL}/releases/latest/download`;
  const cmd = `curl -fsSL ${base}/bootstrap.sh | NGB_VERSION=${pluginVersion} bash -s --`;
  return repoPathHint ? `${cmd} "${repoPathHint}"` : cmd;
}
export const PAIRING_FILE = "pairing.json";

/**
 * Written by this vault when it has no profile yet, read by the runner on an
 * otherwise idle run: it asks Termux to pair THIS vault. It carries no secret —
 * the token is generated in Termux and comes back in pairing.json.
 */
export const CLAIM_FILE = "claim.json";

/** Written by the runner; ties this runtime directory to a profile id. */
export const PROFILE_MARKER_FILE = "profile.json";

/** How long the plugin waits for Termux to answer a pairing request. */
export const PAIRING_WAIT_MS = 20000;

/** Opens the companion app's setup checklist (permission + Termux + round trip). */
export const COMPANION_SETUP_URI = "nativegitbridge://setup";

/**
 * The latest release page — where the companion APK (and the plugin files)
 * live. A direct asset link was tried and dropped: Obsidian opens https in a
 * Chrome Custom Tab whose download session is discarded when the tab closes,
 * so the APK never arrived. The release page works everywhere, needs no
 * fixed asset name, and lets the user pick the versioned APK.
 */
export const COMPANION_RELEASES_URL =
  "https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest";

/** Asks the companion to bring Termux to the foreground (launch intent). */
export const COMPANION_OPEN_TERMUX_URI = "nativegitbridge://open-termux";

/**
 * Asks the companion to open the release page in the REAL default browser.
 * Carries no payload — the companion holds the URL itself, so the URI keeps
 * its "no content, only intent" property. Needed because a download started
 * inside Obsidian's Chrome Custom Tab is frequently discarded when the tab
 * closes (the file never reaches Downloads).
 */
export const COMPANION_DOWNLOAD_APK_URI = "nativegitbridge://download-apk";

/** Official Termux site (the F-Droid build; Play Store build is deprecated). */
export const TERMUX_SITE_URL = "https://termux.dev";

/** Termux on F-Droid — the supported build, linked directly. */
export const TERMUX_FDROID_URL = "https://f-droid.org/packages/com.termux/";

/**
 * Asks the companion to open Termux on F-Droid (or F-Droid's web page in the
 * real browser). The companion never installs anything itself: that would
 * require REQUEST_INSTALL_PACKAGES on an app that already holds RUN_COMMAND,
 * and Android would still ask the user to confirm.
 */
export const COMPANION_GET_TERMUX_URI = "nativegitbridge://get-termux";

/** Shown whenever the Termux-side runner is older than RUNNER_MIN_VERSION. */
export const RUNNER_OUTDATED_HINT =
  "The Termux runner script is outdated. Updating the plugin does not update it — " +
  "re-run the install command in Termux (Settings -> Native Git Bridge -> Copy command, " +
  "or the 'Set up Termux' button in the companion app).";
