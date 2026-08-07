import { describe, expect, it } from "vitest";
import {
  buildHunkPatch,
  buildWholeFilePatch,
  needsNoNewlineMarker,
  selectableLines,
  selectionHasChanges,
} from "../src/git/hunkPatch";
import { parseUnifiedDiff, type DiffHunk } from "../src/git/unifiedDiff";

/**
 * The patch text these produce is fed straight to `git apply`, which rejects
 * anything whose `@@` counts disagree with the lines below it. The e2e suite
 * applies the output to real repositories; this file pins the text itself, so a
 * failure says which rule broke rather than just "git refused".
 */

/** First hunk of a diff, for brevity in the cases below. */
function hunkOf(diff: string): DiffHunk {
  return parseUnifiedDiff(diff)[0]!.hunks[0]!;
}

const TWO_CHANGES = `--- a/f.md
+++ b/f.md
@@ -1,4 +1,4 @@
 keep
-old one
-old two
+new one
+new two
 tail
`;

describe("buildHunkPatch: the whole hunk", () => {
  it("reproduces the hunk with a file header", () => {
    expect(buildHunkPatch({ path: "f.md", hunk: hunkOf(TWO_CHANGES) })).toBe(
      `--- a/f.md
+++ b/f.md
@@ -1,4 +1,4 @@
 keep
-old one
-old two
+new one
+new two
 tail
`
    );
  });

  it("keeps the path verbatim, spaces and unicode included", () => {
    // Vault paths are not identifiers. git apply reads the filename to the end
    // of the line, so no quoting is needed, but the path must not be mangled.
    const p = "Private/Мої нотатки/one two.md";
    const patch = buildHunkPatch({ path: p, hunk: hunkOf(TWO_CHANGES) })!;
    expect(patch).toContain(`--- a/${p}\n`);
    expect(patch).toContain(`+++ b/${p}\n`);
  });

  it("ends with a newline, as git's own patches do", () => {
    expect(buildHunkPatch({ path: "f.md", hunk: hunkOf(TWO_CHANGES) })!.endsWith("\n")).toBe(true);
  });
});

describe("buildHunkPatch: a subset of the lines", () => {
  const hunk = hunkOf(TWO_CHANGES);
  // lines: 0 context, 1 delete, 2 delete, 3 insert, 4 insert, 5 context

  it("demotes an UNSELECTED removal to context, so git leaves that line alone", () => {
    // The whole point of the line mode. Dropping the line instead would make
    // git remove it too, which is the opposite of not selecting it.
    const patch = buildHunkPatch({ path: "f.md", hunk, selected: new Set([1, 3]) })!;
    expect(patch).toBe(
      `--- a/f.md
+++ b/f.md
@@ -1,4 +1,4 @@
 keep
-old one
 old two
+new one
 tail
`
    );
  });

  it("drops an unselected addition entirely", () => {
    const patch = buildHunkPatch({ path: "f.md", hunk, selected: new Set([3]) })!;
    expect(patch).not.toContain("new two");
    expect(patch).toContain("+new one");
  });

  it("recomputes the counts to match the lines it emitted", () => {
    for (const sel of [new Set([1]), new Set([3]), new Set([1, 4]), new Set([1, 2, 3, 4])]) {
      const patch = buildHunkPatch({ path: "f.md", hunk, selected: sel })!;
      const [, oldCount, newCount] = /@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(patch)!;
      const body = patch.split("\n").slice(3).filter((l) => l !== "");
      const olds = body.filter((l) => l.startsWith(" ") || l.startsWith("-")).length;
      const news = body.filter((l) => l.startsWith(" ") || l.startsWith("+")).length;
      expect(Number(oldCount ?? 1)).toBe(olds);
      expect(Number(newCount ?? 1)).toBe(news);
    }
  });

  it("returns null when only context is selected", () => {
    expect(buildHunkPatch({ path: "f.md", hunk, selected: new Set([0, 5]) })).toBeNull();
    expect(buildHunkPatch({ path: "f.md", hunk, selected: new Set() })).toBeNull();
  });

  it("selecting every changed line equals the whole hunk", () => {
    const all = new Set(selectableLines(hunk));
    expect(buildHunkPatch({ path: "f.md", hunk, selected: all })).toBe(
      buildHunkPatch({ path: "f.md", hunk })
    );
  });
});

describe("buildHunkPatch: hunks that are only one side", () => {
  it("a pure addition", () => {
    const patch = buildHunkPatch({
      path: "f.md",
      hunk: hunkOf("--- a/f.md\n+++ b/f.md\n@@ -1,1 +1,3 @@\n keep\n+added one\n+added two\n"),
    })!;
    expect(patch).toContain("@@ -1 +1,3 @@");
  });

  it("a pure removal", () => {
    const patch = buildHunkPatch({
      path: "f.md",
      hunk: hunkOf("--- a/f.md\n+++ b/f.md\n@@ -1,3 +1,1 @@\n keep\n-gone one\n-gone two\n"),
    })!;
    expect(patch).toContain("@@ -1,3 +1 @@");
  });

  it("writes a bare start when the count is 1, as git does", () => {
    const patch = buildHunkPatch({
      path: "f.md",
      hunk: hunkOf("--- a/f.md\n+++ b/f.md\n@@ -5 +5 @@\n-a\n+b\n"),
    })!;
    expect(patch).toContain("@@ -5 +5 @@");
  });

  it("keeps the hunk's own start line, not 1", () => {
    const patch = buildHunkPatch({
      path: "f.md",
      hunk: hunkOf("--- a/f.md\n+++ b/f.md\n@@ -40,2 +40,2 @@\n ctx\n-a\n+b\n"),
    })!;
    expect(patch).toContain("@@ -40,");
  });

  it("preserves a line that looks like diff syntax", () => {
    // A note about diffs contains lines starting with - and +. They must be
    // carried through with their own prefix added, not interpreted.
    const hunk = hunkOf("--- a/f.md\n+++ b/f.md\n@@ -1,2 +1,2 @@\n-- old bullet\n+++ new bullet\n");
    const patch = buildHunkPatch({ path: "f.md", hunk })!;
    expect(patch).toContain("\n-- old bullet\n");
    expect(patch).toContain("\n+++ new bullet\n");
  });
});

describe("selection helpers", () => {
  const hunk = hunkOf(TWO_CHANGES);

  it("offers only the changed lines for picking", () => {
    expect(selectableLines(hunk)).toEqual([1, 2, 3, 4]);
  });

  it("knows whether a selection would do anything", () => {
    expect(selectionHasChanges(hunk, new Set([0]))).toBe(false);
    expect(selectionHasChanges(hunk, new Set([0, 2]))).toBe(true);
  });
});

describe("buildWholeFilePatch: per-block restore", () => {
  it("replaces every line of the file", () => {
    const patch = buildWholeFilePatch("f.md", "a\nb\n", "a\nB\n")!;
    expect(patch).toBe(
      `--- a/f.md
+++ b/f.md
@@ -1,2 +1,2 @@
-a
-b
+a
+B
`
    );
  });

  it("returns null for identical texts", () => {
    expect(buildWholeFilePatch("f.md", "same\n", "same\n")).toBeNull();
  });

  it("handles a file becoming empty and vice versa", () => {
    // git writes a zero side as "0,0", not a bare "0".
    expect(buildWholeFilePatch("f.md", "gone\n", "")).toContain("@@ -1 +0,0 @@");
    expect(buildWholeFilePatch("f.md", "", "new\n")).toContain("@@ -0,0 +1 @@");
  });

  it("flags the case it cannot encode", () => {
    // A file with no trailing newline needs git's "\ No newline" marker, and
    // guessing it wrong corrupts the last line. Callers check before building.
    expect(needsNoNewlineMarker("no newline")).toBe(true);
    expect(needsNoNewlineMarker("with newline\n")).toBe(false);
    expect(needsNoNewlineMarker("")).toBe(false);
  });
});
