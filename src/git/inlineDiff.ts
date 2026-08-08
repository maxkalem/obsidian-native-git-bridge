/**
 * Intra-line diff: which parts of a changed line changed.
 *
 * The only part of `diff2html` the plugin did not already have its own version
 * of. Replacing it removed the last runtime dependency, and with it the Mustache
 * templates diff2html compiled through `new Function`.
 *
 * Implemented from the algorithm (a longest common subsequence over tokens)
 * rather than from another implementation, and kept as a pure function so it can
 * be tested on its own.
 *
 * Two comparison units, chosen by the reader. Words are the default: "brown" →
 * "red" is one word replaced, which is what a note actually changed. Characters
 * are what diff2html produced (`diffStyle: "char"`), and they are the better
 * unit for a path, an identifier or a number, where one letter is the whole
 * edit.
 */

/** One stretch of a line, and whether it is shared with the other side. */
export interface InlineRun {
  text: string;
  kind: "same" | "add" | "remove";
}

/** Comparison unit. Shared preference; see `SharedUiPrefs.inlineDiffUnit`. */
export type InlineDiffUnit = "word" | "char";

/**
 * Longest-common-subsequence cost is O(n·m), and a diff of a bundled `main.js`
 * really does contain single lines tens of thousands of tokens long. Past this
 * many tokens on either side the line is reported as wholly changed instead of
 * hanging the pane; the row is already coloured, so nothing is lost but the
 * detail.
 */
export const INLINE_DIFF_TOKEN_LIMIT = 400;

/**
 * Character mode is a REFINEMENT of the word pass, not a second algorithm.
 *
 * A single character-level LCS over a whole line would cost O(n·m) in
 * characters, so the 400-element ceiling above would fall at 400 characters —
 * shorter than an ordinary paragraph in a note, and every paragraph would come
 * back as "wholly changed". Running the word pass first and then re-diffing
 * only the stretches it already marked as changed keeps the cost at the word
 * pass's, and those stretches are short: this limit is per stretch, not per
 * line, and a pair longer than it is simply left at word granularity.
 */
export const INLINE_DIFF_CHAR_LIMIT = 300;

/**
 * Split into words, whitespace runs, and single punctuation characters.
 *
 * Whitespace is a token of its own rather than being attached to a word, so
 * that inserting one space is one insertion instead of rewriting both
 * neighbours. Unicode-aware: a vault is not ASCII, and `\w` would make every
 * Cyrillic word a run of punctuation.
 */
export function tokenizeLine(line: string): string[] {
  return line.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

/**
 * Runs for both sides of a changed line.
 *
 * Identical lines produce a single `same` run each, which callers can use to
 * skip the highlighting entirely.
 */
export function inlineDiff(
  before: string,
  after: string,
  unit: InlineDiffUnit = "word"
): { before: InlineRun[]; after: InlineRun[] } {
  if (before === after) {
    return { before: single(before, "same"), after: single(after, "same") };
  }
  const a = tokenizeLine(before);
  const b = tokenizeLine(after);
  if (a.length > INLINE_DIFF_TOKEN_LIMIT || b.length > INLINE_DIFF_TOKEN_LIMIT) {
    return { before: single(before, "remove"), after: single(after, "add") };
  }

  const beforeRuns = new RunBuilder();
  const afterRuns = new RunBuilder();
  const emit = (g: DiffGroup): void => {
    if (g.removed === g.added) {
      beforeRuns.push("same", g.removed);
      afterRuns.push("same", g.added);
      return;
    }
    if (g.removed !== "") beforeRuns.push("remove", g.removed);
    if (g.added !== "") afterRuns.push("add", g.added);
  };

  for (const g of diffGroups(a, b)) {
    if (unit === "char" && refinable(g)) {
      for (const fine of diffGroups(characters(g.removed), characters(g.added))) emit(fine);
    } else {
      emit(g);
    }
  }
  return { before: beforeRuns.done(), after: afterRuns.done() };
}

/**
 * One aligned step of the comparison: a stretch that is shared (`removed` and
 * `added` are the same text) or one that changed.
 *
 * Groups rather than two independent lists of runs, because the character pass
 * needs to know which removal belongs to which addition. Coalescing runs per
 * side loses that: an insertion between two shared tokens merges those two into
 * one run on the removal side but leaves three on the insertion side, and the
 * two lists no longer line up.
 */
interface DiffGroup {
  removed: string;
  added: string;
}

/**
 * The longest-common-subsequence walk itself, over whatever the caller split
 * the two sides into. Run twice in character mode: once over words, then again
 * over the characters of each stretch it reported as changed.
 */
function diffGroups(a: string[], b: string[]): DiffGroup[] {
  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  // Filled from the end so the walk below can move forward and emit groups in
  // reading order.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffGroup[] = [];
  // Shared tokens accumulate into one group and changed ones into another, so a
  // consumer sees "this stretch is the same, this stretch became that".
  let shared = "";
  let removed = "";
  let added = "";
  const flushChange = (): void => {
    if (removed === "" && added === "") return;
    out.push({ removed, added });
    removed = added = "";
  };
  const flushShared = (): void => {
    if (shared === "") return;
    out.push({ removed: shared, added: shared });
    shared = "";
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flushChange();
      shared += a[i]!;
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      // Dropping a[i] keeps at least as much in common: it is a removal.
      flushShared();
      removed += a[i]!;
      i++;
    } else {
      flushShared();
      added += b[j]!;
      j++;
    }
  }
  flushShared();
  for (; i < n; i++) removed += a[i]!;
  for (; j < m; j++) added += b[j]!;
  flushChange();
  return out;
}

/**
 * Whether a changed stretch is worth re-diffing character by character.
 *
 * A stretch with nothing on one side is a pure insertion or deletion: there is
 * no counterpart to compare it with, and the word pass already describes it
 * exactly. The length ceiling is per stretch rather than per line, which is
 * what keeps the second pass cheap.
 */
function refinable(g: DiffGroup): boolean {
  if (g.removed === "" || g.added === "") return false;
  return g.removed.length <= INLINE_DIFF_CHAR_LIMIT && g.added.length <= INLINE_DIFF_CHAR_LIMIT;
}

/**
 * Split into characters by CODE POINT, not by UTF-16 unit.
 *
 * `"…".split("")` cuts an emoji or any other astral character into two halves,
 * and half a surrogate pair rendered on its own is a replacement glyph. A vault
 * contains emoji.
 */
function characters(text: string): string[] {
  return Array.from(text);
}

/**
 * Compare two blocks of lines position by position: the k-th line of one side
 * against the k-th line of the other.
 *
 * Shared by the diff pane (a run of deletions followed by a run of insertions)
 * and the conflict pane (the "ours" block against the "theirs" block), because
 * it is the same question asked twice. Positional pairing is chosen over
 * anything cleverer because it is predictable: the reader can see why two lines
 * are being compared. A similarity search would sometimes pair line 1 with line
 * 4 and leave them wondering.
 *
 * `null` at a position means "render this line plainly": either it has no
 * counterpart, or the two share nothing worth pointing at.
 */
export function pairLineBlocks(
  before: string[],
  after: string[],
  unit: InlineDiffUnit = "word"
): { before: (InlineRun[] | null)[]; after: (InlineRun[] | null)[] } {
  const out = {
    before: new Array<InlineRun[] | null>(before.length).fill(null),
    after: new Array<InlineRun[] | null>(after.length).fill(null),
  };
  for (let k = 0; k < Math.min(before.length, after.length); k++) {
    const r = inlineDiff(before[k]!, after[k]!, unit);
    if (!worthHighlighting(r.before)) continue;
    out.before[k] = r.before;
    out.after[k] = r.after;
  }
  return out;
}

function single(text: string, kind: InlineRun["kind"]): InlineRun[] {
  return text === "" ? [] : [{ text, kind }];
}

/** Coalesces neighbouring tokens of the same kind into one run. */
class RunBuilder {
  private runs: InlineRun[] = [];
  push(kind: InlineRun["kind"], text: string): void {
    const last = this.runs[this.runs.length - 1];
    if (last && last.kind === kind) last.text += text;
    else this.runs.push({ kind, text });
  }
  done(): InlineRun[] {
    return this.runs;
  }
}

/**
 * Whether intra-line highlighting adds anything.
 *
 * A pair of lines with nothing in common yields one `remove` run and one `add`
 * run covering the whole text. The row colour already says that, and a `<del>`
 * around the entire line on top of it is harder to read, not easier.
 */
export function worthHighlighting(runs: InlineRun[]): boolean {
  return runs.some((r) => r.kind === "same" && r.text.trim() !== "");
}
