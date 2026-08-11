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
