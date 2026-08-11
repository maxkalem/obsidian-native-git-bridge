/**
 * The sentence in git's output that says what went wrong.
 *
 * A failed sync reported "git pull failed during sync." and put everything else
 * behind a collapsed `stderr` — which on a repository of this size opens with
 * the reason and then buries it under two hundred lines of
 * `Updating index flags: 67% (4590/6783)`. The user could not tell why the sync
 * failed without expanding it and scrolling back up.
 *
 * Progress is written with carriage returns, so it arrives as one enormous
 * "line" that no amount of scrolling makes readable. Splitting on `\r` as well
 * as `\n` is what turns it back into something that can be filtered.
 */

/**
 * Does this output say the object database is damaged?
 *
 * The shape seen on the device: `error: object file …/2d/9ebf… is empty` then
 * `fatal: unable to read tree (…)`. It is what git leaves behind when it was
 * killed between creating an object file and writing to it — routine on
 * Android, where the system stops Termux in the background, and guaranteed by
 * any operation cancelled while git was mid-write.
 *
 * It has to be recognised because the symptom is unrelated to the cause: the
 * commit fails, or the merge fails, or the checkout fails, and none of the
 * messages mention that the repository itself is the problem.
 */
export function looksLikeObjectCorruption(stderr?: string, stdout?: string): boolean {
  const s = `${stderr ?? ""}\n${stdout ?? ""}`;
  return (
    /object file .* is empty/i.test(s) ||
    /unable to read (tree|sha1 file|object)/i.test(s) ||
    /loose object .* is corrupt/i.test(s) ||
    /(^|\n)error: (garbage|inflate)/i.test(s)
  );
}

/**
 * Lines git writes to describe how far along it is. They are noise in a report
 * and they are the bulk of it: every one of these is emitted once per percent.
 */
const PROGRESS = new RegExp(
  "^(" +
    [
      "Updating index flags",
      "Updating files",
      "Counting objects",
      "Compressing objects",
      "Receiving objects",
      "Resolving deltas",
      "Unpacking objects",
      "Filtering content",
      "Checking out files",
      "remote: (Counting|Compressing|Enumerating|Resolving|Total)",
    ].join("|") +
    ")"
);

/** Lines that carry no information of their own. */
function isNoise(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (PROGRESS.test(t)) return true;
  // A bare percentage tail left over from a split carriage return.
  if (/^\d{1,3}% \(\d+\/\d+\)$/.test(t)) return true;
  return false;
}

/**
 * The first meaningful lines of git's output, for the body of an error window.
 *
 * `limit` is small on purpose: this is the summary, and the full output is
 * still one tap away under the fold. Git puts its reason first and its advice
 * immediately after ("Please commit your changes or stash them before you
 * merge."), which is exactly the part a reader needs and exactly the part that
 * was being hidden.
 */
export function summarizeGitError(stderr?: string, stdout?: string, limit = 6): string[] {
  const source = [stderr ?? "", stdout ?? ""].join("\n");
  const lines = source
    .split(/[\r\n]+/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => !isNoise(l));
  const out: string[] = [];
  for (const l of lines) {
    // git indents the file list under "would be overwritten by merge:"; keep
    // the indent, it is what makes the list read as a list.
    if (!out.includes(l)) out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}
