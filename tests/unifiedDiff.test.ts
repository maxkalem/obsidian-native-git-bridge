import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/git/unifiedDiff";

/**
 * The parser that feeds the diff panes. It replaced diff2html's, so its job is
 * to get every line and BOTH line numbers right: the numbers drive the sticky
 * gutter, and a number that drifts by one turns a diff into a lie.
 */

const SAMPLE = `diff --git a/Notes/note.md b/Notes/note.md
index 1234567..89abcde 100644
--- a/Notes/note.md
+++ b/Notes/note.md
@@ -1,5 +1,6 @@
 first line unchanged
-the quick brown fox
+the quick red fox jumps
 middle stays
-removed entirely
 tail
+brand new line
@@ -20,2 +21,2 @@ trailing context here
-alpha
+beta
`;

describe("parseUnifiedDiff", () => {
  it("finds the file and its hunks", () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("Notes/note.md");
    expect(files[0]!.hunks).toHaveLength(2);
  });

  it("keeps the hunk header verbatim, trailing context included", () => {
    const [, second] = parseUnifiedDiff(SAMPLE)[0]!.hunks;
    expect(second!.header).toBe("@@ -20,2 +21,2 @@ trailing context here");
  });

  it("numbers both sides the way git does", () => {
    const lines = parseUnifiedDiff(SAMPLE)[0]!.hunks[0]!.lines;
    expect(lines.map((l) => [l.kind, l.oldNumber, l.newNumber, l.text])).toEqual([
      ["context", 1, 1, "first line unchanged"],
      ["delete", 2, null, "the quick brown fox"],
      ["insert", null, 2, "the quick red fox jumps"],
      ["context", 3, 3, "middle stays"],
      ["delete", 4, null, "removed entirely"],
      ["context", 5, 4, "tail"],
      ["insert", null, 5, "brand new line"],
    ]);
  });

  it("restarts numbering from the second hunk's header", () => {
    const lines = parseUnifiedDiff(SAMPLE)[0]!.hunks[1]!.lines;
    expect(lines[0]).toMatchObject({ kind: "delete", oldNumber: 20 });
    expect(lines[1]).toMatchObject({ kind: "insert", newNumber: 21 });
  });

  it("pairs a deletion with the insertion that replaced it, and leaves loners alone", () => {
    const lines = parseUnifiedDiff(SAMPLE)[0]!.hunks[0]!.lines;
    expect(lines[1]!.paired).toBe(true); // the fox line
    expect(lines[2]!.paired).toBe(true);
    expect(lines[1]!.runs).toBeDefined();
    // "removed entirely" and "brand new line" are separated by a context line,
    // so they are a pure removal and a pure addition, not a change.
    expect(lines[4]!.paired).toBeUndefined();
    expect(lines[6]!.paired).toBeUndefined();
  });

  it("marks a pair with nothing in common as paired but gives it no runs", () => {
    // alpha -> beta share only the letter "a". Wrapping the whole line in <del>
    // on top of an already-coloured row is noise, so the runs are withheld.
    const lines = parseUnifiedDiff(SAMPLE)[0]!.hunks[1]!.lines;
    expect(lines[0]!.paired).toBe(true);
    expect(lines[0]!.runs).toBeUndefined();
  });

  it("ignores metadata before the first hunk", () => {
    const lines = parseUnifiedDiff(SAMPLE)[0]!.hunks[0]!.lines;
    // `index`, `--- a/…`, `+++ b/…` must never become diff lines: the `---`
    // and `+++` headers look exactly like a deletion and an addition.
    expect(lines.some((l) => l.text.startsWith("-- a/"))).toBe(false);
    expect(lines.some((l) => l.text.includes("1234567"))).toBe(false);
  });

  it("drops the no-newline marker", () => {
    const files = parseUnifiedDiff(`+++ b/f.md
@@ -1 +1 @@
-a
+b
\\ No newline at end of file
`);
    expect(files[0]!.hunks[0]!.lines.map((l) => l.text)).toEqual(["a", "b"]);
  });

  it("treats a bare empty line as an empty context line, not the end of the hunk", () => {
    // Git writes " " for an empty context line; anything that strips trailing
    // whitespace in transit turns it into "". Ending the hunk there would
    // silently truncate everything after the first blank line in a note.
    const lines = parseUnifiedDiff(`+++ b/f.md
@@ -1,3 +1,3 @@
 before

-old
+new
`)[0]!.hunks[0]!.lines;
    expect(lines.map((l) => l.kind)).toEqual(["context", "context", "delete", "insert"]);
    expect(lines[1]!.text).toBe("");
    expect(lines[2]!.oldNumber).toBe(3);
  });

  it("handles several files in one diff", () => {
    const files = parseUnifiedDiff(`diff --git a/one.md b/one.md
--- a/one.md
+++ b/one.md
@@ -1 +1 @@
-a
+b
diff --git a/two.md b/two.md
--- a/two.md
+++ b/two.md
@@ -1 +1 @@
-c
+d
`);
    expect(files.map((f) => f.path)).toEqual(["one.md", "two.md"]);
    expect(files.every((f) => f.hunks.length === 1)).toBe(true);
  });

  it("copes with a diff that has no file header at all", () => {
    const files = parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b\n");
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("");
    expect(files[0]!.hunks[0]!.lines).toHaveLength(2);
  });

  it("reads a hunk header without line counts", () => {
    const lines = parseUnifiedDiff("@@ -7 +9 @@\n-a\n+b\n")[0]!.hunks[0]!.lines;
    expect(lines[0]!.oldNumber).toBe(7);
    expect(lines[1]!.newNumber).toBe(9);
  });

  // A combined diff (a merge commit) has two-column line prefixes this parser
  // does not decode. Matching the header anyway keeps the hunk on screen
  // instead of making the entire diff vanish, which is the failure mode that
  // matters.
  it("still finds a combined-diff hunk rather than dropping the whole diff", () => {
    const files = parseUnifiedDiff("@@@ -1,2 -1,2 +1,2 @@@\n-a\n+b\n");
    expect(files[0]!.hunks).toHaveLength(1);
    expect(files[0]!.hunks[0]!.header).toBe("@@@ -1,2 -1,2 +1,2 @@@");
  });

  // Every diff git prints ends with a newline, so a naive split hands back a
  // trailing "". The empty-context branch accepted it, so every diff in the pane
  // grew a phantom blank line with a line number of its own at the bottom.
  it("does not invent a trailing blank line", () => {
    for (const d of ["@@ -1 +1 @@\n-a\n+b\n", SAMPLE]) {
      for (const f of parseUnifiedDiff(d)) {
        const last = f.hunks[f.hunks.length - 1]!.lines;
        expect(last[last.length - 1]!.text).not.toBe("");
      }
    }
  });

  it("but keeps a real empty context line at the end of a hunk", () => {
    const lines = parseUnifiedDiff("@@ -1,2 +1,2 @@\n-a\n+b\n \n")[0]!.hunks[0]!.lines;
    expect(lines.map((l) => l.kind)).toEqual(["delete", "insert", "context"]);
    expect(lines[2]!.text).toBe("");
  });

  it("returns nothing for an empty or metadata-only diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("Binary files a/x.png and b/x.png differ\n")).toEqual([]);
  });

  it("survives a deletion against /dev/null", () => {
    const files = parseUnifiedDiff(`--- a/gone.md
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`);
    expect(files[0]!.path).toBe("");
    expect(files[0]!.hunks[0]!.lines.map((l) => l.kind)).toEqual(["delete", "delete"]);
  });

  it("pairs multiple deletions with multiple insertions positionally", () => {
    const lines = parseUnifiedDiff(`@@ -1,4 +1,4 @@
-one alpha
-two beta
+one gamma
+two delta
`)[0]!.hunks[0]!.lines;
    expect(lines.map((l) => l.paired)).toEqual([true, true, true, true]);
    // First deletion pairs with the FIRST insertion: "one alpha" vs "one gamma"
    // shares "one ", so the runs keep it.
    expect(lines[0]!.runs?.some((r) => r.kind === "same" && r.text.includes("one"))).toBe(true);
    expect(lines[1]!.runs?.some((r) => r.kind === "same" && r.text.includes("two"))).toBe(true);
  });

  it("leaves the extra deletions unpaired when the sides are uneven", () => {
    const lines = parseUnifiedDiff(`@@ -1,3 +1,1 @@
-one
-two
-three
+one changed
`)[0]!.hunks[0]!.lines;
    expect(lines.map((l) => l.paired)).toEqual([true, undefined, undefined, true]);
  });
});
