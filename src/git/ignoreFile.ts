import type { GitStatusSummary } from "../types";

/**
 * The entries of a `.gitignore` or `.git/info/exclude`, as things a person can
 * act on.
 *
 * Both files are line-based, and both routinely open with git's own preamble:
 *
 *     # File patterns to ignore; see `git help ignore` for more information.
 *     # Lines that start with '#' are comments.
 *
 * Splitting on newlines and dropping the blanks listed those two as entries
 * with a Remove button beside each — an offer to delete a comment, presented as
 * an ignore rule. The settings panel showed twenty "entries" for a file with a
 * handful of real ones.
 *
 * A comment is not a rule and a blank line is not a rule. Neither belongs in a
 * list whose whole purpose is "these are the paths git is ignoring".
 */
export function parseIgnoreEntries(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

/**
 * Does this file already ignore `path`?
 *
 * git accepts the same path written several ways — anchored or not, with or
 * without a trailing slash — and the plugin writes the anchored form. All four
 * are recognised so a rule added by hand in Termux is not offered a second
 * time.
 */
export function ignoreEntryMatches(entries: readonly string[], path: string): boolean {
  const variants = [`/${path}`, path, `/${path}/`, `${path}/`];
  return entries.some((e) => variants.includes(e));
}

/**
 * Which of these paths does git currently TRACK, judged from the last status?
 *
 * Ignore rules (.gitignore, .git/info/exclude) affect untracked files only: a
 * rule added for a tracked path changes nothing, and the file keeps appearing
 * in the panel and in every commit until it is untracked. The plugin uses this
 * to say so at the moment the rule is added, instead of leaving the user to
 * discover it from a refresh that "did not work".
 *
 * Judged from status, so a tracked file with NO current changes is not
 * caught. That is accepted: such a file is not in the panel either, and the
 * case that actually confuses people is the one that reappears after every
 * change (.obsidian/workspace-mobile.json being the canonical example).
 */
export function trackedPathsAmong(status: GitStatusSummary, paths: readonly string[]): string[] {
  const tracked = new Set<string>();
  for (const e of [...status.staged, ...status.unstaged, ...status.conflicted]) {
    tracked.add(e.path);
    if (e.origPath !== undefined) tracked.add(e.origPath);
  }
  return paths.filter((p) => tracked.has(p));
}
