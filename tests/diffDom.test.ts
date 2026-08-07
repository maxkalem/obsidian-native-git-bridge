import { beforeEach, describe, expect, it } from "vitest";
import { __fakeEl, __findAllByClass, __findByClass, __resetObsidianMock, __textOf } from "./mocks/obsidian";
import { renderUnifiedDiff } from "../src/ui/diffDom";

/**
 * The rendered DOM is a contract with styles.css: 27 rules are keyed to these
 * class names. They are still diff2html's names, so that replacing the
 * dependency could not shift the appearance. This file checks that.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const SAMPLE = `--- a/Notes/note.md
+++ b/Notes/note.md
@@ -1,4 +1,4 @@
 context line
-the quick brown fox
+the quick red fox
 tail
`;

function render(diff: string): Any {
  const parent = __fakeEl("div", "ngb-diff-view");
  renderUnifiedDiff(parent, diff);
  return parent;
}

/** Rows, skipping the hunk-header row. */
function codeRows(root: Any): Any[] {
  const tbody = __findByClass(root, "d2h-diff-tbody");
  return tbody.children.filter((tr: Any) => !__findByClass(tr, "d2h-info"));
}

beforeEach(() => __resetObsidianMock());

describe("the structure styles.css depends on", () => {
  it("nests wrapper → file → code-wrapper → table → tbody", () => {
    const root = render(SAMPLE);
    const wrapper = __findByClass(root, "d2h-wrapper");
    const file = __findByClass(wrapper, "d2h-file-wrapper");
    const codeWrap = __findByClass(file, "d2h-code-wrapper");
    const table = __findByClass(codeWrap, "d2h-diff-table");
    expect(__findByClass(table, "d2h-diff-tbody")).not.toBeNull();
    expect(table.tagName).toBe("TABLE");
  });

  // The stylesheet has always hidden it with display:none, so emitting the file
  // name, the CHANGED tag and the "Viewed" checkbox was markup nobody saw.
  it("does not emit the file header at all", () => {
    expect(__findByClass(render(SAMPLE), "d2h-file-header")).toBeNull();
  });

  it("gives every code row a gutter cell and a code cell", () => {
    for (const tr of codeRows(render(SAMPLE))) {
      expect(__findByClass(tr, "d2h-code-linenumber")).not.toBeNull();
      expect(__findByClass(tr, "d2h-code-line")).not.toBeNull();
      expect(__findByClass(tr, "d2h-code-line-ctn")).not.toBeNull();
    }
  });

  // gutterWidthCh() measures these, and the wrapped layout sizes the sticky
  // first column from that measurement.
  it("puts both line numbers in the gutter, blank on the side that has none", () => {
    const rows = codeRows(render(SAMPLE));
    const nums = (tr: Any) => [
      __findByClass(tr, "line-num1").textContent,
      __findByClass(tr, "line-num2").textContent,
    ];
    expect(nums(rows[0]!)).toEqual(["1", "1"]); // context
    expect(nums(rows[1]!)).toEqual(["2", ""]); // deletion
    expect(nums(rows[2]!)).toEqual(["", "2"]); // insertion
    expect(nums(rows[3]!)).toEqual(["3", "3"]); // context
  });

  // The prefix belongs to the sticky gutter, not the code cell: in the code
  // cell it scrolled away horizontally and, when wrapping, read like content.
  // It used to be moved there by DOM surgery after rendering; now it starts there.
  it("puts the +/- prefix inside the gutter cell, never in the code cell", () => {
    for (const tr of codeRows(render(SAMPLE))) {
      const gutter = __findByClass(tr, "d2h-code-linenumber");
      expect(__findByClass(gutter, "d2h-code-line-prefix")).not.toBeNull();
      expect(__findByClass(__findByClass(tr, "d2h-code-line"), "d2h-code-line-prefix")).toBeNull();
    }
  });

  it("uses the right prefix per line kind", () => {
    const rows = codeRows(render(SAMPLE));
    const prefix = (tr: Any) => __findByClass(tr, "d2h-code-line-prefix").textContent;
    expect(prefix(rows[0]!)).toBe(" ");
    expect(prefix(rows[1]!)).toBe("-");
    expect(prefix(rows[2]!)).toBe("+");
  });

  it("tints both cells of a row, so the gutter matches the code", () => {
    const rows = codeRows(render(SAMPLE));
    const del = rows[1]!;
    expect(__findByClass(del, "d2h-code-linenumber").hasClass("d2h-del")).toBe(true);
    expect(del.children[1].hasClass("d2h-del")).toBe(true);
    const ins = rows[2]!;
    expect(__findByClass(ins, "d2h-code-linenumber").hasClass("d2h-ins")).toBe(true);
    expect(ins.children[1].hasClass("d2h-ins")).toBe(true);
  });

  it("renders the hunk header as its own d2h-info row", () => {
    const tbody = __findByClass(render(SAMPLE), "d2h-diff-tbody");
    const info = tbody.children[0];
    expect(__findByClass(info, "d2h-info")).not.toBeNull();
    expect(__textOf(info)).toContain("@@ -1,4 +1,4 @@");
  });
});

describe("intra-line highlighting", () => {
  it("marks removals with <del> on the deletion row only", () => {
    const rows = codeRows(render(SAMPLE));
    const del = __findByClass(rows[1]!, "d2h-code-line-ctn");
    const dels = del.children.filter((c: Any) => c.tagName === "DEL");
    expect(dels.map((c: Any) => c.textContent)).toEqual(["brown"]);
    expect(del.children.some((c: Any) => c.tagName === "INS")).toBe(false);
  });

  it("marks additions with <ins> on the insertion row only", () => {
    const rows = codeRows(render(SAMPLE));
    const ins = __findByClass(rows[2]!, "d2h-code-line-ctn");
    const inss = ins.children.filter((c: Any) => c.tagName === "INS");
    expect(inss.map((c: Any) => c.textContent)).toEqual(["red"]);
    expect(ins.children.some((c: Any) => c.tagName === "DEL")).toBe(false);
  });

  it("keeps the full line text either way, so nothing is lost to the markup", () => {
    const rows = codeRows(render(SAMPLE));
    expect(__textOf(__findByClass(rows[1]!, "d2h-code-line-ctn"))).toContain("the quick");
    expect(__textOf(__findByClass(rows[1]!, "d2h-code-line-ctn"))).toContain("brown");
    expect(__textOf(__findByClass(rows[2]!, "d2h-code-line-ctn"))).toContain("red");
  });

  it("leaves a pair with nothing in common plain, no del/ins at all", () => {
    const rows = codeRows(render("@@ -1 +1 @@\n-alpha\n+beta\n"));
    for (const tr of rows) {
      const ctn = __findByClass(tr, "d2h-code-line-ctn");
      expect(ctn.children.filter((c: Any) => c.tagName === "DEL" || c.tagName === "INS")).toEqual([]);
    }
    expect(__textOf(__findByClass(rows[0]!, "d2h-code-line-ctn"))).toBe("alpha");
  });

  it("leaves context lines plain", () => {
    const ctn = __findByClass(codeRows(render(SAMPLE))[0]!, "d2h-code-line-ctn");
    expect(ctn.children).toEqual([]);
    expect(ctn.textContent).toBe("context line");
  });
});

describe("edge cases the pane will actually meet", () => {
  it("renders nothing but an empty wrapper for an empty diff", () => {
    const root = render("");
    expect(__findByClass(root, "d2h-wrapper")).not.toBeNull();
    expect(__findByClass(root, "d2h-diff-table")).toBeNull();
  });

  it("renders one file block per file", () => {
    const root = render(`diff --git a/one.md b/one.md
+++ b/one.md
@@ -1 +1 @@
-a
+b
diff --git a/two.md b/two.md
+++ b/two.md
@@ -1 +1 @@
-c
+d
`);
    expect(__findAllByClass(root, "d2h-file-wrapper")).toHaveLength(2);
    expect(__findAllByClass(root, "d2h-diff-table")).toHaveLength(2);
  });

  it("renders several hunks into one table", () => {
    const root = render(`+++ b/f.md
@@ -1 +1 @@
-a
+b
@@ -9 +9 @@
-c
+d
`);
    expect(__findAllByClass(root, "d2h-diff-table")).toHaveLength(1);
    expect(__findAllByClass(root, "d2h-info").length).toBeGreaterThanOrEqual(2);
  });

  it("does not add a phantom row for the diff's terminating newline", () => {
    // Three real lines in the hunk; a naive split would make it four.
    expect(codeRows(render(SAMPLE))).toHaveLength(4);
  });
});
