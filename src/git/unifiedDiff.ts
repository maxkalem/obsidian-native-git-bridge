/**
 * Unified diff, parsed for RENDERING.
 *
 * `hunks.ts` also parses unified diffs and stays separate. It produces the
 * before/after text blocks that per-block restore needs, and discards line
 * numbers. Rendering needs the opposite: every line in order, with both line
 * numbers and the side it belongs to.
 *
 * Everything here is a pure function over the text git printed in Termux. No
 * git implementation, no templating, nothing that builds markup.
 */

import { inlineDiff, worthHighlighting, type InlineRun } from "./inlineDiff";

export type DiffLineKind = "context" | "insert" | "delete";

export interface DiffLine {
  kind: DiffLineKind;
  /** The line itself, without git's leading `+`, `-` or space. */
  text: string;
  /** Number on the old side; null for an insertion. */
  oldNumber: number | null;
  /** Number on the new side; null for a deletion. */
  newNumber: number | null;
  /**
   * This line is one half of a change: a deletion with a matching insertion, or
   * the other way round, as opposed to a pure removal or a pure addition.
   */
  paired?: boolean;
  /**
   * Intra-line highlight runs. Set only on a paired line whose counterpart
   * shares something worth pointing at. A pair with nothing in common gets
   * `paired` but no runs: wrapping the entire line in `<del>` on top of an
   * already-coloured row makes it harder to read, not easier.
   * Undefined means "render the text plainly".
   */
  runs?: InlineRun[];
}

export interface DiffHunk {
  /** The `@@ … @@` line exactly as git printed it, trailing context included. */
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  /** Path as taken from the `+++ b/…` header, or "" for a headerless diff. */
  path: string;
  hunks: DiffHunk[];
}

/**
 * `@@ -old,count +new,count @@ trailing`.
 *
 * The extra `-N,M` groups and the `@@+` accept a COMBINED hunk header
 * (`@@@ -1,2 -1,2 +1,2 @@@`), which `git diff` emits for a merge commit. This
 * plugin never asks for one, and the per-line prefixes of a combined diff are
 * two columns wide rather than one, so those lines are not decoded correctly.
 * Matching the header still keeps the hunk and its text on screen, instead of
 * making the whole diff disappear.
 */
const HUNK_RE = /^@@+ -(\d+)(?:,\d+)?(?: -\d+(?:,\d+)?)* \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff. Handles several files in one text, because `git show`
 * and `git diff` without a pathspec both produce that, even though the plugin
 * currently asks for one path at a time.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const ensureFile = (): DiffFile => {
    if (!file) {
      file = { path: "", hunks: [] };
      files.push(file);
    }
    return file;
  };

  // Drop the newline that TERMINATES the last line, not empty lines in general.
  // Without this, `split` hands back a trailing "" for every diff git prints,
  // the empty-context branch below accepts it, and every diff in the pane grew
  // a phantom blank line with a line number of its own at the bottom.
  const body = diff.endsWith("\n") ? diff.slice(0, -1) : diff;

  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "");

    if (line.startsWith("diff --git ")) {
      file = { path: "", hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      // `+++ b/path`, or `+++ /dev/null` for a deletion.
      const p = line.slice(4).trim();
      ensureFile().path = p === "/dev/null" ? "" : p.replace(/^[abciwo]\//, "");
      continue;
    }
    const m = HUNK_RE.exec(line);
    if (m) {
      hunk = { header: line, lines: [] };
      ensureFile().hunks.push(hunk);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }
    // Everything before the first hunk is metadata: `index`, `--- a/…`, mode
    // changes, `similarity index`, `Binary files … differ`, and the free-text
    // that `git diff --stat` style output can carry.
    if (hunk === null) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"

    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "insert", text: line.slice(1), oldNumber: null, newNumber: newNo++ });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "delete", text: line.slice(1), oldNumber: oldNo++, newNumber: null });
    } else if (line.startsWith(" ") || line === "") {
      // A context line is " " + text, so an EMPTY string is git's context line
      // for an empty line with the trailing space stripped somewhere in transit.
      // Treating it as the end of the hunk would silently truncate the diff.
      hunk.lines.push({
        kind: "context",
        text: line.slice(1),
        oldNumber: oldNo++,
        newNumber: newNo++,
      });
    }
    // Anything else (a stray header inside a hunk) is ignored rather than
    // guessed at.
  }

  for (const f of files) for (const h of f.hunks) pairChangedLines(h.lines);
  return files;
}

/**
 * Attach intra-line runs to lines that were changed rather than purely added or
 * removed.
 *
 * The rule: inside one hunk, a run of consecutive deletions immediately
 * followed by a run of consecutive insertions is a change, and the k-th
 * deletion is compared with the k-th insertion. Leftovers on either side are a
 * plain removal or a plain addition and get no highlighting.
 *
 * Positional pairing is chosen over anything cleverer because it is
 * predictable: the reader can see why two lines are being compared. A
 * similarity search would sometimes pair line 1 with line 4 and leave the
 * reader wondering.
 */
function pairChangedLines(lines: DiffLine[]): void {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "delete") {
      i++;
      continue;
    }
    let d = i;
    while (d < lines.length && lines[d]!.kind === "delete") d++;
    let a = d;
    while (a < lines.length && lines[a]!.kind === "insert") a++;
    const dels = d - i;
    const adds = a - d;
    for (let k = 0; k < Math.min(dels, adds); k++) {
      const del = lines[i + k]!;
      const ins = lines[d + k]!;
      del.paired = true;
      ins.paired = true;
      const r = inlineDiff(del.text, ins.text);
      if (worthHighlighting(r.before)) {
        del.runs = r.before;
        ins.runs = r.after;
      }
    }
    i = a > i ? a : i + 1;
  }
}
