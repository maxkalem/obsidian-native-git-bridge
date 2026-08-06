import type { RuntimeFS } from "./BridgeClient";
import type { RuntimePaths } from "./runtimePaths";

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
  const pairingFilePresent = await safeExists(fs, `${paths.root}/pairing.json`);
  const claimPending = await safeExists(fs, `${paths.root}/claim.json`);
  let markerProfileId = "";
  try {
    const raw = await fs.read(`${paths.root}/profile.json`);
    const parsed = JSON.parse(raw) as { profileId?: unknown };
    if (typeof parsed.profileId === "string") markerProfileId = parsed.profileId;
  } catch {
    /* absent or unreadable: the runner has not claimed this folder */
  }

  let verdict: string;
  let ok = false;
  if (!runtimeDirExists) {
    verdict =
      "The runtime folder does not exist yet. Run a command once (it is created automatically), " +
      "or complete the Termux setup.";
  } else if (!runnerLogExists) {
    // The runner writes into the runtime folder of every profile it knows. No
    // log here means no profile points at THIS vault — which is the normal
    // state of a second vault that was never paired, not a broken install.
    verdict = claimPending
      ? "This vault is waiting to be paired: the pairing request is still lying here, so Termux has not " +
        "run yet. Open Termux (or tap 'Pair this vault' again) — the runner picks the request up on its next run."
      : "No runner.log in this vault's runtime folder — the Termux runner has never written here, so " +
        "no profile points at THIS vault. Fix: run the install command below in Termux with this vault's path " +
        "(each vault gets its own profile and token; other vaults keep working), or use 'Pair this vault' " +
        "if Termux is already set up.";
  } else if (markerProfileId && profileId && markerProfileId !== profileId) {
    verdict =
      `This vault is paired with profile ${profileId}, but the runner last wrote profile ${markerProfileId} here. ` +
      "Re-run the install command for this vault to get the two back in step.";
  } else if (hasQueuedTimeout && queuedRequests.length > 0) {
    verdict =
      "The runner has written here before, but your request is still queued. Either the runner was not " +
      "triggered (companion permission / allow-external-apps), or it stopped before processing the queue — " +
      "see the log tail below.";
  } else if (queuedRequests.length > 0) {
    verdict = `${queuedRequests.length} request(s) waiting to be processed.`;
  } else {
    verdict = "Runtime folder looks healthy: the runner writes here and no requests are stuck.";
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
