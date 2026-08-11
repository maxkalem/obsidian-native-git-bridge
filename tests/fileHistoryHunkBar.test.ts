import { beforeEach, describe, expect, it } from "vitest";
import { __findAllByClass, __findByClass, __resetObsidianMock } from "./mocks/obsidian";
import { FileHistoryView, type FileHistoryActions } from "../src/ui/FileHistoryView";
import type { FileLogEntry } from "../src/git/historyParsers";

/**
 * Where the file-history panel puts a hunk's restore control.
 *
 * It used to be a table row of its own, inserted ABOVE the hunk's `@@` header,
 * right aligned across a table as wide as the longest line of code — so on a
 * real diff the button sat off the horizontal scroller and was never seen. It
 * now goes in the `@@` row itself, through the same hook the diff pane uses,
 * with the same class, so the two panels put the same kind of thing in the same
 * place.
 *
 * What this canNOT tell you: whether it is visible on a phone. That is CSS, the
 * mock has no layout engine, and it stays a device-screenshot question.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

(globalThis as Any).window = {
  setInterval: (fn: Any, ms: Any) => setInterval(fn, ms),
  clearInterval: (id: Any) => clearInterval(id),
};

// Counts that agree with the bodies, so the ranges below are what git itself
// would have produced rather than what a malformed fixture happens to yield.
const DIFF = `+++ b/note.md
@@ -3,2 +3,2 @@
 context
-was
+is
@@ -20,1 +22,1 @@
-old
+new
`;

const ENTRY: FileLogEntry = {
  hash: "abcdef1234567890",
  date: "2026-08-05T01:02:03+03:00",
  author: "maxkalem",
  subject: "vault sync",
  pathAtCommit: "note.md",
} as FileLogEntry;

function actions(over: Partial<FileHistoryActions> = {}): FileHistoryActions {
  return {
    loadPage: () => Promise.resolve([ENTRY]),
    loadCommitDiff: () => Promise.resolve({ diff: DIFF, truncated: false }),
    readFile: () => Promise.resolve("context\nwas\n"),
    writeFile: () => Promise.resolve(),
    stagePatch: () => Promise.resolve(true),
    restoreWholeFile: () => undefined,
    viewAtCommit: () => undefined,
    progressText: () => "",
    progressDetail: () => "",
    wrapLines: () => false,
    showInvisibles: () => false,
    inlineUnit: () => "word",
    colors: () => null,
    ...over,
  };
}

async function expandedDiff(over: Partial<FileHistoryActions> = {}): Promise<Any> {
  const view = new FileHistoryView(leaf, actions(over)) as Any;
  view.path = "note.md";
  view.renderShell();
  view.expanded.add(ENTRY.hash);
  const body = view.contentEl.createDiv({ cls: "ngb-filehist-body" });
  await view.renderCommitDiff(body, ENTRY);
  return body;
}

describe("file history, per-hunk restore", () => {
  beforeEach(() => __resetObsidianMock());

  it("puts the control inside the hunk's own header bar, one per hunk", async () => {
    const body = await expandedDiff();
    const bars = __findAllByClass(body, "ngb-hunk-bar");
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(__findAllByClass(bar, "ngb-hunk-btn")).toHaveLength(1);
    }
  });

  it("gives it the same class as the diff pane's hunk buttons", async () => {
    // Not a class of its own. The stylesheet gives `.ngb-hunk-btn` its button
    // chrome, and a second name for the same kind of control is how the two
    // panels came to look different in the first place.
    const body = await expandedDiff();
    const btn = __findByClass(body, "ngb-hunk-btn");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.attrs["aria-label"]).toContain("abcdef12");
  });

  it("carries the hunk's line range beside the control, as the diff pane does", async () => {
    const body = await expandedDiff();
    // The first hunk shows a context line and the line that replaced "was";
    // the second is a one-line replacement, so it names a single line.
    expect(__findAllByClass(body, "ngb-hunk-range").map((e: Any) => e.textContent)).toEqual([
      "3-4",
      "22",
    ]);
  });

  it("no longer builds a table row of its own above the header", async () => {
    const body = await expandedDiff();
    expect(__findAllByClass(body, "ngb-hunk-bar-row")).toHaveLength(0);
    expect(__findAllByClass(body, "ngb-hunk-restore")).toHaveLength(0);
  });

  it("marks each hunk header so the hunks can be separated visually", async () => {
    const body = await expandedDiff();
    expect(__findAllByClass(body, "ngb-hunk-start")).toHaveLength(2);
  });
});
