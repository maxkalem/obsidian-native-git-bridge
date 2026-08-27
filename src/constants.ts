export const PLUGIN_ID = "native-git-bridge";
export const PROTOCOL_VERSION = 1;
export const RUNNER_MIN_VERSION = 12;
/**
 * The runner version this build SHIPS (RUNNER_VERSION in
 * native-git-bridge/termux/native-git-bridge-runner.sh; a test asserts the two
 * agree). Version advice compares against this, not against the minimum: any
 * runner in [min, shipped] is a correct installation, and comparing against
 * the floor branded every up-to-date runner "newer than expected" — the
 * released 0.6.3 showed that warning to every correctly installed device.
 */
export const RUNNER_SHIPPED_VERSION = 17;

/**
 * The oldest companion APK this plugin works with — the same floor model the
 * runner has had all along: anything in [floor, current] is a correct
 * installation, and only BELOW the floor is a refusal. The companion is
 * updated by hand (an APK install), so the floor moves only when the plugin
 * starts DEPENDING on a companion behavior, never just because a release
 * happened. 0.4.1 is where the ack gained the `termux=` flag, which
 * versionAdvice, the self-check and the setup guide all read.
 */
export const COMPANION_MIN_VERSION = "0.4.1";

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
/**
 * Where the runner streams stderr while a request is still running, one file
 * per request id. Read while waiting so a long operation can say what it is
 * doing; kept afterwards so the shared log bundle can carry it.
 */
export const PROGRESS_DIR = "progress";

export const POLL_INTERVAL_MS = 400;
export const DEFAULT_TIMEOUT_SECONDS = 90;

/**
 * Actions that take as long as the network takes, rather than as long as git
 * takes. A clone of a real vault over a phone connection routinely outlives
 * the ordinary 90 s budget, and a timeout there would leave the user staring
 * at an error while Termux is still working.
 */
export const ACTION_TIMEOUT_SECONDS: Readonly<Record<string, number>> = {
  // 3600, raised from 900 at the user's instruction: a full clone of a real
  // vault outlives fifteen minutes on a phone connection, and the interactive
  // credential route adds the time a person takes to paste the command and
  // answer git's prompts. The runner's own NGB_CLONE_TIMEOUT matches.
  "clone-into-vault": 3600,
  "adopt-remote": 900,
  // The repair steps. Each ends with `git fsck --connectivity-only`, which is
  // minutes on a vault of real size, so none of them fits the ordinary 90 s.
  // The two fetch steps get the clone-sized budget: the refetch downloads the
  // whole history, and the targeted fetch is cheap on the wire but still pays
  // for the fsck that verifies it.
  "repair-scan": 600,
  "repair-fetch-missing": 900,
  "repair-refetch": 900,
  "repair-reset-upstream": 300,
  // Storage maintenance. The repack rewrites every reachable object into one
  // pack, which on a multi-gigabyte object database is tens of minutes of CPU
  // on a phone — the longest budget in the file, and honestly so. Prune is
  // I/O-bound and cheap next to it; the scan is one count-objects.
  "maintenance-scan": 300,
  "maintenance-prune": 600,
  "maintenance-repack": 3600,
  // Footprint changes. Shallowing transfers almost nothing (the history is
  // already here); unshallow and partial-disable download history or content
  // wholesale; partial-enable may shed and prefetch, both long on a real vault.
  "repo-shallow": 900,
  "repo-unshallow": 1800,
  "repo-partial-enable": 1800,
  "repo-partial-disable": 1800,
};

/**
 * Actions that talk to a remote, and the floor their budget may not go below.
 *
 * The setting is one number for every action, and it was the network ones that
 * paid for that. On a device where a local `status` takes seven seconds and
 * staging one file takes eight, a budget of ten leaves a pull no chance at all
 * — and what the user then sees is not "this took too long" but a bridge check
 * that says the runtime folder is healthy, because it is. The runner was
 * working the whole time.
 *
 * A floor rather than a fixed override: someone who raises the setting means it
 * for these too, and clone still has its own much larger number above.
 */
export const NETWORK_ACTIONS: ReadonlySet<string> = new Set(["fetch", "pull", "push", "sync"]);
export const MIN_NETWORK_TIMEOUT_SECONDS = 120;

/** The budget one request actually gets, from the action and the device setting. */
export function timeoutSecondsFor(action: string, settingSeconds: number): number {
  const fixed = ACTION_TIMEOUT_SECONDS[action];
  if (fixed !== undefined) return fixed;
  const base = Number.isFinite(settingSeconds) && settingSeconds > 0
    ? Math.floor(settingSeconds)
    : DEFAULT_TIMEOUT_SECONDS;
  return NETWORK_ACTIONS.has(action) ? Math.max(base, MIN_NETWORK_TIMEOUT_SECONDS) : base;
}
export const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STALE_LOCK_MS = 30 * 60 * 1000;
export const DISPLAY_OUTPUT_LIMIT = 100 * 1024;
export const LOG_MAX_ENTRIES = 200;

/**
 * When a wait stops being a wait and becomes a question.
 *
 * Half a minute: past that, a local action has certainly failed to be local, and
 * "is this thing working?" is what the user is actually asking. Used only by the
 * opt-in that opens the output panel by itself.
 */
export const LONG_OPERATION_SECONDS = 30;

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
/**
 * The same install, without a network: the Termux scripts ship inside the
 * plugin folder, so the vault on the device already carries them.
 * bootstrap.sh takes install.sh and the runner from the directory it is
 * started from, which is why nothing else has to be passed.
 *
 * `vaultPath` is the vault as TERMUX sees it (the repository path hint in
 * settings, e.g. /storage/emulated/0/Documents/Kalem); `configDir` is
 * Obsidian's config directory, usually `.obsidian` but not always.
 */
export function bootstrapCommandLocal(vaultPath: string, configDir: string): string {
  const base = `${vaultPath}/${configDir}/plugins/${PLUGIN_ID}/termux`;
  return `bash "${base}/bootstrap.sh" "${vaultPath}"`;
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

/**
 * The release page of ONE version — where its own APK and plugin files live.
 * The pinned counterpart of COMPANION_RELEASES_URL: the newer-half and
 * stay-on-this-version routes need the release matching a KNOWN number, not
 * whatever is newest today.
 */
export function releaseTagUrl(version: string): string {
  return `https://github.com/maxkalem/obsidian-native-git-bridge/releases/tag/${version}`;
}

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
  "re-run the install command in Termux (Settings -> Native Git Bridge -> " +
  "Copy command & open Termux, or the 'Set up Termux' button in the companion app).";
