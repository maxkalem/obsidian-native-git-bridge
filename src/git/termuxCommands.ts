/**
 * The commands the plugin copies to the clipboard for fixes that can only
 * happen at a Termux terminal. Nothing here is executed by the plugin: a
 * clipboard string is data, and the values the commands ask for are ENTERED
 * at the terminal and stay there — the user's rule that neither the plugin
 * nor the runner may learn the git name or email is what shapes both.
 *
 * Built under `manualCloneCommand`'s guards: refuse a repository path that is
 * unknown or not absolute (the command addresses the vault by the path Termux
 * sees, and there is nothing honest to build without it), quote it, and never
 * interpolate anything the user typed into the plugin.
 */

/** The one shared guard: the vault as Termux sees it, absolute, trimmed. */
function termuxRepoPath(repoPathHint: string): string | null {
  const repo = repoPathHint.trim().replace(/\/+$/, "");
  if (repo === "" || !repo.startsWith("/")) return null;
  return repo;
}

/**
 * Set a LOCAL git identity, with git's own prompts. `read -p` is what makes
 * the values visible as they are typed, and the closing `--name-only` listing
 * is what makes git answer visibly that both keys now exist — without ever
 * printing a value into a log the plugin could see.
 *
 * The listing carries `--no-pager`: it runs at a real tty, where git pages
 * multi-line output, and a device with a broken `core.pager` (a program that
 * does not exist — a real phone has exactly that) dies with "unable to
 * execute pager" AFTER the identity was already written, which reads as the
 * whole command failing. The runner is immune via `-c core.pager=cat`; a
 * pasted command has to defend itself.
 */
export function identitySetupCommand(repoPathHint: string): string | null {
  const repo = termuxRepoPath(repoPathHint);
  if (repo === null) return null;
  return (
    `cd "${repo}" && read -p "user.name: " n && git config --local user.name "$n" && ` +
    `read -p "user.email: " e && git config --local user.email "$e" && ` +
    `git --no-pager config --local --name-only --get-regexp '^user\\.'`
  );
}

/**
 * The `safe.directory` fix for a repository git refuses over dubious
 * ownership. This stays a clipboard command by the user's decision
 * (2026-08-25): a repository git refuses is a profile the runner rejects
 * before the dispatcher, so a one-tap action would need a new dispatch state
 * in the runner's most load-bearing gating, and the risk was judged not worth
 * one paste. The command re-applies the same trust the pairing established.
 */
export function safeDirectoryCommand(repoPathHint: string): string | null {
  const repo = termuxRepoPath(repoPathHint);
  if (repo === null) return null;
  return `git config --global --add safe.directory "${repo}"`;
}

/**
 * Remove the credential helper from Termux's GLOBAL git configuration.
 *
 * The local reset (`cred-helper-local-reset`) already stops a global helper
 * answering for this repository, and it is the fix to reach for, because it
 * changes nothing outside the vault. This is the other half of the same
 * problem: a global helper keeps answering for every OTHER repository on the
 * device, including ones cloned later that never got the reset, and a device
 * where two accounts are in play authenticates as whichever one that helper
 * holds. Removing it is the only thing that ends that, and it is destructive
 * in a way the reset is not — hence the terminal, where the user runs it
 * themselves and sees the result, rather than a one-tap action.
 *
 * `--unset-all` needs no value, so nothing is read. The listing that follows
 * prints key NAMES only, and `|| echo` is not decoration: `--get-regexp`
 * exits 1 when it matches nothing, which after a successful removal is
 * exactly what happens, and a bare non-zero exit reads as the command having
 * failed. `--no-pager` for the same reason as the identity command — a
 * device with a broken `core.pager` dies on the listing AFTER the removal
 * already happened.
 *
 * No repository path: the global configuration is the same from anywhere.
 */
export function dropGlobalCredHelperCommand(): string {
  return (
    `git config --global --unset-all credential.helper; ` +
    `git --no-pager config --global --name-only --get-regexp '^credential\\.' ` +
    `|| echo "no credential.* left in the global configuration"`
  );
}

/** Profile ids are generated, and this is their whole alphabet. */
const PROFILE_ID_RE = /^p-[0-9a-f]{8,32}$/;
/**
 * The https remote, in the subset that is safe to put inside double quotes.
 * `lastRemoteUrl` comes from `git config`, not from a field this plugin
 * validated, so a URL carrying `"`, `$`, a backtick or a backslash would be
 * read by the shell rather than by git. Such a URL falls back to the plain
 * fetch below instead of being quoted more cleverly.
 */
const QUOTABLE_HTTPS = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!&'()*+,;=%-]+$/;

/**
 * Enter working credentials again, after a token expired or was revoked.
 *
 * git's own answer to a rejected credential is to ask for another one, and
 * the runner is the one place that can never ask: `GIT_TERMINAL_PROMPT=0` is
 * what stops an operation from hanging forever behind an invisible prompt
 * (protocol.md). So the fix is not an action, it is a terminal — and what
 * makes it one paste instead of four is that the three things which have to
 * be true afterwards are all in the command.
 *
 * For an https remote:
 * - the local `credential.helper` is rewritten to the profile's own file,
 *   empty value first. The list ACCUMULATES across scopes and the first
 *   helper that answers wins, so a global helper would otherwise keep serving
 *   the same dead token, and a repository with no helper at all would ask
 *   again on the very next operation instead of saving what was just typed;
 * - `git credential reject` erases the stored entry for exactly this remote.
 *   git erases a rejected credential itself, but only on the run that was
 *   rejected, and the run that failed was the runner's — doing it explicitly
 *   is what makes the prompt appear rather than depend on that;
 * - `git fetch` is the prompt. It is also the proof: it succeeds or it says
 *   why, at a terminal, where the answer can be read.
 *
 * For ssh, and for a remote this cannot recognise, the command is the fetch
 * alone. `credential.helper` has nothing to do with an ssh key, and the case
 * the pattern matches there is a host key that was never accepted, which the
 * fetch itself asks about. Nothing is typed into the plugin either way: what
 * the user answers stays in Termux (rule 11).
 */
export function credentialsSetupCommand(opts: {
  repoPathHint: string;
  profileId: string;
  /** The remote as the last status reported it; empty when unknown. */
  remoteUrl: string;
}): string | null {
  const repo = termuxRepoPath(opts.repoPathHint);
  if (repo === null) return null;
  const fetch = `cd "${repo}" && git fetch`;
  const url = opts.remoteUrl.trim();
  if (!QUOTABLE_HTTPS.test(url) || !PROFILE_ID_RE.test(opts.profileId)) return fetch;
  const credsFile = `$HOME/.config/native-git-bridge/creds/${opts.profileId}`;
  return (
    `cd "${repo}" && ` +
    // `;` and not `&&`: unsetting a key that is not there exits 5, and a
    // repository whose helper was never configured is exactly the one that
    // needs the two adds below.
    `git config --local --unset-all credential.helper; ` +
    `git config --local --add credential.helper '' && ` +
    `git config --local --add credential.helper "store --file=${credsFile}" && ` +
    `printf 'url=%s\\n\\n' "${url}" | git credential reject && ` +
    `git fetch`
  );
}
