/**
 * Word-level intra-line diff: which parts of a changed line changed.
 *
 * The only part of `diff2html` the plugin did not already have its own version
 * of. Replacing it removed the last runtime dependency, and with it the Mustache
 * templates diff2html compiled through `new Function`.
 *
 * Implemented from the algorithm (a longest common subsequence over tokens)
 * rather than from another implementation, and kept as a pure function so it can
 * be tested on its own.
 *
 * The comparison unit differs from what diff2html produced. It ran with
 * `diffStyle: "char"`, which compares single characters and turns "brown" →
 * "red" into `<del>b</del>r<del>own</del>`: minimal, and hard to read in prose.
 * For notes, the useful unit is the word.
 */

/** One stretch of a line, and whether it is shared with the other side. */
export interface InlineRun {
  text: string;
  kind: "same" | "add" | "remove";
}

/**
 * Longest-common-subsequence cost is O(n·m), and a diff of a bundled `main.js`
 * really does contain single lines tens of thousands of tokens long. Past this
 * many tokens on either side the line is reported as wholly changed instead of
 * hanging the pane; the row is already coloured, so nothing is lost but the
 * detail.
 */
export const INLINE_DIFF_TOKEN_LIMIT = 400;

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
export function inlineDiff(before: string, after: string): { before: InlineRun[]; after: InlineRun[] } {
  if (before === after) {
    return { before: single(before, "same"), after: single(after, "same") };
  }
  const a = tokenizeLine(before);
  const b = tokenizeLine(after);
  if (a.length > INLINE_DIFF_TOKEN_LIMIT || b.length > INLINE_DIFF_TOKEN_LIMIT) {
    return { before: single(before, "remove"), after: single(after, "add") };
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  // Filled from the end so the walk below can move forward and emit runs in
  // reading order.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const beforeRuns = new RunBuilder();
  const afterRuns = new RunBuilder();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      beforeRuns.push("same", a[i]!);
      afterRuns.push("same", b[j]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      // Dropping a[i] keeps at least as much in common: it is a removal.
      beforeRuns.push("remove", a[i]!);
      i++;
    } else {
      afterRuns.push("add", b[j]!);
      j++;
    }
  }
  for (; i < n; i++) beforeRuns.push("remove", a[i]!);
  for (; j < m; j++) afterRuns.push("add", b[j]!);

  return { before: beforeRuns.done(), after: afterRuns.done() };
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
