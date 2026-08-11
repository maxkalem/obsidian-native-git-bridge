import type { RuntimeFS } from "./BridgeClient";
import type { RuntimePaths } from "./runtimePaths";
import { CLAIM_FILE, PAIRING_FILE, PROFILE_MARKER_FILE } from "../constants";

export interface SelfCheckReport {
  runtimeDirExists: boolean;
  queuedRequests: string[];
  runnerLogExists: boolean;
  runnerLogTail: string;
  pairingFilePresent: boolean;
  /** Profile this vault believes it is paired with (device-local setting). */
  profileId: string;
  /** Profile id the runner wrote into this runtime directory, if any. */
  markerProfileId: string;
  /** Waiting to be paired: a claim file is present and unanswered. */
  claimPending: boolean;
  /**
   * The cause in one line, for the window's TITLE.
   *
   * Split from `verdict` because a wall of prose that opens with "the runtime
   * folder is healthy" buries the one sentence the reader needs. The title says
   * what happened; the body says what to do about it, if anything.
   *
   * Thirty characters. A modal header on a phone truncates past roughly that,
   * and a truncated title states even less than a generic one: the first
   * attempt read "The plugin stopped waiting; the run.." on the device.
   */
  headline: string;
  /** Human verdict describing the most likely cause when something is wrong. */
  verdict: string;
  ok: boolean;
}

const LOG_TAIL_BYTES = 4000;

/**
 * Diagnose the bridge WITHOUT a round trip to Termux, which is exactly what is
 * needed when requests time out (a round trip would time out too).
 *
 * The runner writes runner.log into the runtime directory it was configured
 * with (NGB_RUNTIME_DIR). If the plugin's runtime directory contains no
 * runner.log at all, the runner is pointed at a different path — usually a
 * different vault folder detected by the installer.
 */
export async function runSelfCheck(
  fs: RuntimeFS,
  paths: RuntimePaths,
  hasQueuedTimeout: boolean,
  profileId = ""
): Promise<SelfCheckReport> {
  const runtimeDirExists = await safeExists(fs, paths.root);
  const queuedRequests = runtimeDirExists && (await safeExists(fs, paths.requestsDir))
    ? (await safeList(fs, paths.requestsDir)).filter((f) => f.endsWith(".json")).map(baseName)
    : [];
  const logPath = `${paths.root}/runner.log`;
  const runnerLogExists = await safeExists(fs, logPath);
  let runnerLogTail = "";
  if (runnerLogExists) {
    try {
      const text = await fs.read(logPath);
      runnerLogTail = text.length > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text;
    } catch {
      runnerLogTail = "(runner.log could not be read)";
    }
  }
  const pairingFilePresent = await safeExists(fs, `${paths.root}/${PAIRING_FILE}`);
  const claimPending = await safeExists(fs, `${paths.root}/${CLAIM_FILE}`);
  let markerProfileId = "";
  try {
    const raw = await fs.read(`${paths.root}/${PROFILE_MARKER_FILE}`);
    const parsed = JSON.parse(raw) as { profileId?: unknown };
    if (typeof parsed.profileId === "string") markerProfileId = parsed.profileId;
  } catch {
    /* absent or unreadable: the runner has not claimed this folder */
  }

  let verdict: string;
  let headline: string;
  let ok = false;
  if (!runtimeDirExists) {
    headline = "No runtime folder yet";
    verdict =
      "The runtime folder does not exist yet. Run a command once (it is created automatically), " +
      "or complete the Termux setup.";
  } else if (!runnerLogExists) {
    // The runner writes into the runtime folder of every profile it knows. No
    // log here means no profile points at THIS vault — which is the normal
    // state of a second vault that was never paired, not a broken install.
    headline = claimPending ? "Waiting to be paired" : "Termux has never written here";
    verdict = claimPending
      ? "This vault is waiting to be paired: the pairing request is still lying here, so Termux has not " +
        "run yet. Open Termux (or tap 'Pair this vault' again) — the runner picks the request up on its next run."
      : "No runner.log in this vault's runtime folder — the Termux runner has never written here, so " +
        "no profile points at THIS vault. Fix: run the install command below in Termux with this vault's path " +
        "(each vault gets its own profile and token; other vaults keep working), or use 'Pair this vault' " +
        "if Termux is already set up.";
  } else if (markerProfileId && profileId && markerProfileId !== profileId) {
    headline = "Profile mismatch";
    verdict =
      `This vault is paired with profile ${profileId}, but the runner last wrote profile ${markerProfileId} here. ` +
      "Re-run the install command for this vault to get the two back in step.";
  } else if (hasQueuedTimeout && queuedRequests.length > 0) {
    // Likely cause FIRST. With a short timeout a queued request is the
    // ordinary case, not evidence of a broken trigger, and leading with
    // "the runner was not triggered" sent the user to check permissions that
    // were fine.
    headline = "Still in the queue";
    verdict =
      "The runner has not picked your request up yet. Usually it is just slow to start — raise " +
      "'Operation timeout' in settings and try again. If the queue never clears, the trigger is not " +
      "reaching Termux: check the companion's permission and Termux's allow-external-apps.";
  } else if (queuedRequests.length > 0) {
    headline = `${queuedRequests.length} request(s) waiting`;
    verdict = `${queuedRequests.length} request(s) waiting to be processed.`;
  } else if (hasQueuedTimeout) {
    // Healthy folder AND nothing queued, reached from a timeout: the runner
    // took the request and is still on it. Saying "looks healthy" here is true
    // and useless — it invites a hunt for a break that is not there. The budget
    // is the thing that ran out, and it is the thing the user can change.
    headline = "Timed out — nothing is broken";
    verdict =
      "The runner has your request and is still working on it. It will finish, and the result is picked " +
      "up when it lands. Raise 'Operation timeout' in settings if this keeps happening.";
    ok = true;
  } else {
    headline = "Nothing is stuck";
    verdict = "The runner writes into this vault's runtime folder and no requests are waiting.";
    ok = true;
  }
  return {
    runtimeDirExists,
    queuedRequests,
    runnerLogExists,
    runnerLogTail,
    pairingFilePresent,
    profileId,
    markerProfileId,
    headline,
    claimPending,
    verdict,
    ok,
  };
}

async function safeExists(fs: RuntimeFS, p: string): Promise<boolean> {
  try {
    return await fs.exists(p);
  } catch {
    return false;
  }
}

async function safeList(fs: RuntimeFS, p: string): Promise<string[]> {
  try {
    return await fs.listFiles(p);
  } catch {
    return [];
  }
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}
