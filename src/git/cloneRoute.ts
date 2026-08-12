/**
 * Which way a clone request should reach Termux.
 *
 * Credentials only ever exist in Termux (rule 11), and the runner never
 * permits a prompt on an ordinary run, so a clone that has to authenticate
 * with nothing saved can only fail there. The decision is therefore made
 * BEFORE the round trip, from what is already known:
 *
 * - "companion": the ordinary route — queue the request and fire the trigger.
 *   Taken whenever saved credentials can plausibly serve the clone: an SSH or
 *   file remote (keys and local paths never prompt), or a re-clone whose
 *   status reports Termux-side credentials (the profile's credential file, or
 *   a global helper in Termux's own gitconfig). Credentials are never reused
 *   from inside the vault, so nothing else counts.
 * - "termux": queue the request, but hand the user the interactive runner
 *   command instead of firing the trigger. git asks for the credentials at
 *   the terminal and the credential helper saves them per repository — in
 *   Termux, never in the vault — so the next operation needs no prompt.
 *   Taken when it is KNOWN there is nothing to authenticate with: a fresh
 *   https clone (a repository that does not exist yet has no credentials by
 *   construction), or a re-clone whose status says Termux holds none.
 *
 * `credsConfigured` is tri-state on purpose: `null` means the status came
 * from a runner too old to report the field, and unknown is treated as "try
 * the ordinary route first" — the failure handler still offers the terminal.
 */
export type CloneRoute = "companion" | "termux";

/**
 * The command the user pastes into Termux for the download half of a manual
 * clone: plain `git clone`, so the prompts and the progress meter are git's
 * own — the first handoff design pasted `runner.sh interactive`, and the
 * runner's redirected stderr made the clone look hung the moment the
 * credential prompt was answered.
 *
 * The pieces, each there for a reason:
 * - `rm -rf` first: an interrupted clone leaves a non-empty target that
 *   `git clone` refuses, and the path is the plugin's own scratch directory
 *   inside `runtime/`, safe to wipe by construction.
 * - `--no-checkout`: only the download happens here. The working tree is
 *   materialised by the runner's collision-safe finish, never by a checkout
 *   that could overwrite the vault's files.
 * - `-c credential.helper=store --file=$HOME/.config/native-git-bridge/creds/<profile>`:
 *   clone-time `-c` both APPLIES during the initial fetch and PERSISTS into
 *   the cloned config, so what the user types is saved per repository, in
 *   Termux, and every later operation runs without asking (rule 11: the file
 *   never lives in the vault; `$HOME` expands in Termux's own shell).
 * - `--` before the URL: the URL is validated, but git must still never read
 *   it as an option.
 *
 * Returns null when the vault's Termux-side path is not known yet — the
 * command addresses the vault by absolute path, so there is nothing honest
 * to build without it.
 */
export function manualCloneCommand(opts: {
  url: string;
  /** The vault as TERMUX sees it (repository path hint), absolute. */
  vaultPath: string;
  /** Obsidian's config directory name, usually `.obsidian`. */
  configDir: string;
  profileId: string;
  filter?: string;
  depth?: number;
}): string | null {
  const vault = opts.vaultPath.trim().replace(/\/+$/, "");
  if (vault === "" || !vault.startsWith("/") || opts.profileId === "") return null;
  const dir = `${vault}/${opts.configDir}/plugins/native-git-bridge/runtime/clone-tmp/repo`;
  const extras =
    (opts.filter !== undefined ? ` --filter=${opts.filter}` : "") +
    (opts.depth !== undefined ? ` --depth ${opts.depth}` : "");
  const helper = `-c credential.helper="store --file=$HOME/.config/native-git-bridge/creds/${opts.profileId}"`;
  return `rm -rf "${dir}" && git clone --no-checkout --progress${extras} ${helper} -- "${opts.url}" "${dir}"`;
}

export function cloneRoute(opts: {
  url: string;
  replaceExisting: boolean;
  /** From the last status; null when the runner did not report it. */
  credsConfigured: boolean | null;
}): CloneRoute {
  if (!opts.url.startsWith("https://")) return "companion";
  if (!opts.replaceExisting) return "termux";
  if (opts.credsConfigured === false) return "termux";
  return "companion";
}
