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
 */
export function identitySetupCommand(repoPathHint: string): string | null {
  const repo = termuxRepoPath(repoPathHint);
  if (repo === null) return null;
  return (
    `cd "${repo}" && read -p "user.name: " n && git config --local user.name "$n" && ` +
    `read -p "user.email: " e && git config --local user.email "$e" && ` +
    `git config --local --name-only --get-regexp '^user\\.'`
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
