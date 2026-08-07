/**
 * Turn one hunk of a diff back into a patch `git apply` will take.
 *
 * All three hunk operations are the same patch pointed in different
 * directions, which is why there is one builder and not three:
 *
 *   stage    `git apply --cached`        patch into the index
 *   unstage  `git apply --cached -R`     patch out of the index
 *   discard  `git apply -R`              patch out of the working tree
 *
 * The only real work is the line selection, and it is fiddly enough to deserve
 * a pure function with tests: the counts in the `@@` header have to match the
 * lines that follow, or git rejects the patch, and an unselected removal has to
 * become CONTEXT rather than disappear, or git applies it anyway.
 */

import type { DiffHunk, DiffLine } from "./unifiedDiff";

export interface HunkPatchRequest {
  /** Repository-relative path, as it appears in the diff. */
  path: string;
  hunk: DiffHunk;
  /**
   * Indices into `hunk.lines` the user picked. Omitted means the whole hunk,
   * which is the ordinary "stage this hunk" case.
   */
  selected?: ReadonlySet<number>;
}

/**
 * The patch text, or `null` when there is nothing to apply.
 *
 * `null` covers a selection of context lines only. Handing git an empty patch
 * is not an error it reports usefully, so the caller is expected to keep the
 * button disabled instead.
 */
export function buildHunkPatch(req: HunkPatchRequest): string | null {
  const { path, hunk, selected } = req;
  const body: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  let changes = 0;

  hunk.lines.forEach((line, i) => {
    const picked = selected === undefined || selected.has(i);
    if (line.kind === "context") {
      body.push(` ${line.text}`);
      oldCount++;
      newCount++;
      return;
    }
    if (line.kind === "delete") {
      if (picked) {
        body.push(`-${line.text}`);
        oldCount++;
        changes++;
      } else {
        // The line stays in the result, so it must be present on BOTH sides of
        // the patch. Dropping it instead would make git remove it as well.
        body.push(` ${line.text}`);
        oldCount++;
        newCount++;
      }
      return;
    }
    // insert
    if (picked) {
      body.push(`+${line.text}`);
      newCount++;
      changes++;
    }
    // An unselected insertion simply is not in this patch: it exists on neither
    // side, so nothing has to stand in for it.
  });

  if (changes === 0) return null;

  // Starts are left as git reported them and only the counts are recomputed,
  // which is what `git add -p` does. git locates the hunk by its old side and
  // by context, so a new-side start that has drifted does not matter.
  const oldStart = hunk.lines.find((l) => l.oldNumber !== null)?.oldNumber ?? 1;
  const newStart = hunk.lines.find((l) => l.newNumber !== null)?.newNumber ?? 1;

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`,
    ...body,
    "",
  ].join("\n");
}

/**
 * `start,count`, or a bare `start` when the count is 1, matching git's own
 * output. A count of 0 keeps a start of 0, which is how git writes a hunk that
 * adds to an empty file.
 */
function range(start: number, count: number): string {
  const s = count === 0 ? 0 : start;
  return count === 1 ? `${s}` : `${s},${count}`;
}

/** Line indices of a hunk that the user can pick: the added and removed ones. */
export function selectableLines(hunk: DiffHunk): number[] {
  const out: number[] = [];
  hunk.lines.forEach((l, i) => {
    if (l.kind !== "context") out.push(i);
  });
  return out;
}

/** True when at least one selected line is an addition or a removal. */
export function selectionHasChanges(hunk: DiffHunk, selected: ReadonlySet<number>): boolean {
  return hunk.lines.some((l, i) => l.kind !== "context" && selected.has(i));
}

/**
 * The patch that turns `before` into `after` for one whole file.
 *
 * Used by per-block restore, which knows both texts outright and does not go
 * through a git diff to get them. Falls back to `null` when the texts match.
 *
 * Deliberately a single hunk covering the entire file rather than a minimal
 * diff: the caller has already written `after` to disk, so the patch only has
 * to be something git will accept against that exact content, and a whole-file
 * hunk cannot mis-locate.
 */
export function buildWholeFilePatch(path: string, before: string, after: string): string | null {
  if (before === after) return null;
  const oldLines = splitKeepingShape(before);
  const newLines = splitKeepingShape(after);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${range(1, oldLines.length)} +${range(1, newLines.length)} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
    "",
  ].join("\n");
}

/**
 * Split into lines, dropping the trailing empty piece a final newline produces.
 * A file that does not end in a newline is a case this deliberately does not
 * try to represent: git needs a `\ No newline at end of file` marker for it,
 * and getting that subtly wrong corrupts the last line.
 */
function splitKeepingShape(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** True when `text` ends without a newline, which the builders above cannot encode. */
export function needsNoNewlineMarker(text: string): boolean {
  return text !== "" && !text.endsWith("\n");
}
