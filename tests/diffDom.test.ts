import { beforeEach, describe, expect, it } from "vitest";
import { __fakeEl, __findAllByClass, __findByClass, __resetObsidianMock, __textOf } from "./mocks/obsidian";
import { renderUnifiedDiff } from "../src/ui/diffDom";
import { gutterWidthCh } from "../src/ui/DiffView";

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

describe("hunk controls and line picking", () => {
  const TWO_HUNKS = `+++ b/f.md
@@ -1,2 +1,2 @@
-a
+b
@@ -9,2 +9,2 @@
 ctx
-c
+d
`;

  it("draws no controls when the caller asks for none, only the line range", () => {
    // The bar itself always exists: it carries the range, which is a fact about
    // the hunk rather than something only an actionable pane needs. What a pane
    // with no actions must not grow is a button.
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, TWO_HUNKS);
    expect(__findAllByClass(root, "ngb-hunk-bar")).toHaveLength(2);
    expect(__findAllByClass(root, "ngb-hunk-btn")).toHaveLength(0);
    // Taken from the lines that actually arrived, not from the `@@` counts:
    // this fixture's first hunk claims two lines a side and carries one, and
    // the label has to agree with the numbers in the gutter beside it.
    expect(__findAllByClass(root, "ngb-hunk-range").map((e: Any) => e.textContent)).toEqual([
      "1",
      "9-10",
    ]);
  });

  it("names the OLD side when a hunk only deletes", () => {
    // A pure deletion has no lines on the new side, so there is no range there
    // to report; saying nothing would leave the one hunk that needs explaining
    // unlabelled.
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, "+++ b/f.md\n@@ -4,2 +3,0 @@\n-gone\n-also gone\n");
    expect(__findAllByClass(root, "ngb-hunk-range").map((e: Any) => e.textContent)).toEqual(["4-5"]);
  });

  it("marks both ends of every hunk so the stylesheet can separate them", () => {
    // Half the air below the closing row, half above the next header, and the
    // rule between the two. A gap belonging entirely to one side reads as
    // attached to it, and the rule has to cross the number gutter as well —
    // which needs a class on the row, not on the code cell.
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, TWO_HUNKS);
    expect(__findAllByClass(root, "ngb-hunk-start")).toHaveLength(2);
    expect(__findAllByClass(root, "ngb-hunk-end")).toHaveLength(2);
  });

  it("puts the closing marker on the LAST line of each hunk", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, TWO_HUNKS);
    const ends = __findAllByClass(root, "ngb-hunk-end");
    expect(ends.map((tr: Any) => __textOf(tr)).map((t: string) => t.trim().endsWith("b") || t.trim().endsWith("d"))).toEqual([true, true]);
  });

  it("puts one bar per hunk, inside that hunk's header row", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    const seen: number[] = [];
    renderUnifiedDiff(root, TWO_HUNKS, {
      hunkBar: (bar, _h, i) => {
        seen.push(i);
        bar.createEl("button", { cls: "ngb-hunk-btn", text: "Stage hunk" });
      },
    });
    expect(seen).toEqual([0, 1]);
    const bars = __findAllByClass(root, "ngb-hunk-bar");
    expect(bars).toHaveLength(2);
    // The bar sits in the info cell, so it scrolls with the hunk it belongs to.
    expect(bars[0].parent.hasClass("d2h-info")).toBe(true);
  });

  // A caller holding "hunk 3" must not have to know which file it came from.
  it("numbers hunks across the whole diff, not per file", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    const seen: number[] = [];
    renderUnifiedDiff(
      root,
      `diff --git a/one.md b/one.md
+++ b/one.md
@@ -1 +1 @@
-a
+b
diff --git a/two.md b/two.md
+++ b/two.md
@@ -1 +1 @@
-c
+d
`,
      { hunkBar: (_b, _h, i) => seen.push(i) }
    );
    expect(seen).toEqual([0, 1]);
  });

  it("hands the caller the hunk itself, so it can build the patch", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    const texts: string[][] = [];
    renderUnifiedDiff(root, TWO_HUNKS, {
      hunkBar: (_b, h) => texts.push(h.lines.map((l) => l.text)),
    });
    expect(texts).toEqual([
      ["a", "b"],
      ["ctx", "c", "d"],
    ]);
  });

  it("puts a checkbox on changed lines only, never on context", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    const coords: string[] = [];
    renderUnifiedDiff(root, TWO_HUNKS, {
      lineCheckbox: (_b, h, l) => coords.push(`${h}:${l}`),
    });
    // Hunk 0: lines 0 and 1 both change. Hunk 1: line 0 is context, 1 and 2 change.
    expect(coords).toEqual(["0:0", "0:1", "1:1", "1:2"]);
    const ctxRow = codeRows(root)[2]!; // the " ctx" line
    expect(__findByClass(ctxRow, "ngb-line-pick")).toBeNull();
  });

  /**
   * The checkbox goes into the number column that has NO number.
   *
   * It used to sit before both numbers, which widened the gutter by its own
   * width — so turning line-picking on shifted every number and every +/- to
   * the right and the diff appeared to move under the reader. Exactly the lines
   * that can be picked are the lines with a gap: an addition has no old number,
   * a deletion has no new one.
   */
  it("puts the checkbox in the empty half of the number column", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, TWO_HUNKS, { lineCheckbox: () => undefined });
    for (const row of codeRows(root)) {
      const gutter = __findByClass(row, "d2h-code-linenumber");
      const box = __findByClass(gutter, "ngb-line-pick");
      if (box === null) continue;
      // Whichever number cell holds it must be the empty one.
      expect(box.parent.textContent).toBe("");
      expect(box.parent.hasClass("line-num1") || box.parent.hasClass("line-num2")).toBe(true);
    }
    // The numbers keep their order and their place whether picking is on or off.
    const g = __findByClass(codeRows(root)[0]!, "d2h-code-linenumber");
    expect(g.children[0].hasClass("line-num1")).toBe(true);
    expect(g.children[1].hasClass("line-num2")).toBe(true);
  });

  it("offers no checkbox on a context line, which has both numbers", () => {
    // Nothing to pick there: a context line is not part of any change, and a
    // box on it would have no gap to sit in either.
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, TWO_HUNKS, { lineCheckbox: () => undefined });
    for (const row of codeRows(root)) {
      const gutter = __findByClass(row, "d2h-code-linenumber");
      const nums = __findAllByClass(gutter, "line-num1").concat(__findAllByClass(gutter, "line-num2"));
      const bothNumbered = nums.every((n: Any) => n.textContent !== "");
      if (bothNumbered) expect(__findByClass(gutter, "ngb-line-pick")).toBeNull();
    }
  });

  /**
   * The `@@` row is ONE cell spanning both columns.
   *
   * It used to be an empty gutter cell followed by the content, and that empty
   * cell was the whole reason the sticky hunk bar drifted: it started at the
   * gutter's width and only reached the pane's left edge after the reader had
   * scrolled that far. Nothing was ever drawn in it.
   */
  it("gives the hunk header one cell across both columns", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, TWO_HUNKS);
    const header = __findAllByClass(root, "ngb-hunk-start")[0]!;
    const cells = header.children.filter((c: Any) => c.tagName === "TD");
    expect(cells).toHaveLength(1);
    expect(cells[0].getAttribute("colspan")).toBe("2");
    // And no empty gutter cell left behind on that row.
    expect(__findByClass(header, "d2h-code-linenumber")).toBeNull();
  });

  it("makes them real checkboxes", () => {
    const root = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(root, TWO_HUNKS, { lineCheckbox: () => undefined });
    expect(__findAllByClass(root, "ngb-line-pick").every((b: Any) => b.type === "checkbox")).toBe(true);
  });

  // The wrapped layout gives the gutter a fixed width from this measurement, so
  // a checkbox it does not know about pushes the numbers past the cell border.
  it("measures the same gutter width whether picking is on or off", () => {
    // This is the assertion the old one inverted. The width used to grow by two
    // when picking was switched on, and the whole column moved with it.
    const plain = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(plain, TWO_HUNKS);
    const picking = __fakeEl("div", "ngb-diff-view");
    renderUnifiedDiff(picking, TWO_HUNKS, { lineCheckbox: () => undefined });
    expect(gutterWidthCh(picking)).toBe(gutterWidthCh(plain));
  });

  it("the picking coordinate is what buildHunkPatch takes", () => {
    // The pair (hunkIndex, lineIndex) has to index hunk.lines directly, or a
    // patch would be built from the wrong lines.
    const root = __fakeEl("div", "ngb-diff-view");
    const hunks: Any[] = [];
    const coords: [number, number][] = [];
    renderUnifiedDiff(root, TWO_HUNKS, {
      hunkBar: (_b, h) => hunks.push(h),
      lineCheckbox: (_b, h, l) => coords.push([h, l]),
    });
    for (const [h, l] of coords) {
      expect(hunks[h].lines[l].kind).not.toBe("context");
    }
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
