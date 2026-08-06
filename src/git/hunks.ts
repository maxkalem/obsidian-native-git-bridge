/**
 * Unified-diff hunks and per-block restore.
 *
 * The file-history view shows the diff a commit introduced for one file and
 * offers "restore this block from this commit". That is a text operation on
 * the CURRENT working-tree file, not a git operation: git can restore whole
 * files, not fragments, and reaching for `git apply` would need a temporary
 * patch file and would fail on any drift anyway.
 *
 * The rule here is deliberately strict: a block is restored only when the
 * current file still contains that block verbatim, either as it was before
 * the commit (then it is replaced by the commit's version) or as it was after
 * it (then there is nothing to do). Anything else is refused, because
 * guessing where a drifted block belongs would silently corrupt a note.
 */

export interface DiffHunk {
  /** Hunk header as git printed it, e.g. "@@ -12,7 +12,9 @@ context". */
  header: string;
  /** Lines as they were BEFORE the commit (context + deletions). */
  before: string[];
  /** Lines as they are AFTER the commit (context + additions). */
  after: string[];
}

/** Split a unified diff for a single file into hunks. */
export function parseHunks(diff: string): DiffHunk[] {
  const out: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  for (const rawLine of diff.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("@@")) {
      cur = { header: line, before: [], after: [] };
      out.push(cur);
      continue;
    }
    if (cur === null) continue; // file headers before the first hunk
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const body = line.slice(1);
    if (line.startsWith("+")) cur.after.push(body);
    else if (line.startsWith("-")) cur.before.push(body);
    else if (line.startsWith(" ")) {
      cur.before.push(body);
      cur.after.push(body);
    }
    // "\\ No newline at end of file" and anything else is ignored.
  }
  return out;
}

export type RestoreOutcome =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; reason: "not-found" };

/**
 * Put the commit's version of one hunk into `currentText`.
 *
 * Returns `changed: false` when the block is already in the committed state,
 * and refuses when neither side of the hunk is present verbatim.
 */
export function restoreHunk(currentText: string, hunk: DiffHunk): RestoreOutcome {
  const lines = currentText.split("\n");
  const already = indexOfBlock(lines, hunk.after);
  if (already >= 0) return { ok: true, text: currentText, changed: false };
  const at = indexOfBlock(lines, hunk.before);
  if (at < 0) return { ok: false, reason: "not-found" };
  const next = [...lines.slice(0, at), ...hunk.after, ...lines.slice(at + hunk.before.length)];
  return { ok: true, text: next.join("\n"), changed: true };
}

/** First index where `block` appears in `lines`, or -1. Empty block never matches. */
function indexOfBlock(lines: string[], block: string[]): number {
  if (block.length === 0) return -1;
  for (let i = 0; i + block.length <= lines.length; i++) {
    let hit = true;
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}
