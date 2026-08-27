import { beforeEach, describe, expect, it } from "vitest";
import { __findByClass, __fire, __mockDoc, __resetObsidianMock, __textOf } from "./mocks/obsidian";
import { HistoryView, type HistoryViewActions } from "../src/ui/HistoryView";
import type { RepoLogEntry, RepoLogFile } from "../src/git/historyParsers";

/**
 * The "moved from" hint on a rename row in the repository history.
 *
 * It printed `origPath` in full. In a vault whose renames move files between
 * deep directories that is a hundred characters in a row that has to stay one
 * line tall, and the CSS could not save it: `text-overflow: ellipsis` does
 * nothing on a box that is allowed to wrap, so the path wrapped over six lines
 * and pushed everything below it down the panel.
 *
 * The status panel already had the answer — `displayName`, one line, ellipsis —
 * and the two panels had simply drifted. This asserts they agree, and that the
 * full path is still reachable rather than thrown away.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

(globalThis as Any).window = {
  setInterval: (fn: Any, ms: number) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id),
  setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id),
};

const OLD_PATH = "Projects/Water Sort Cafe/_references/researches/Sorting Balls and Water.pdf";
const NEW_PATH = "_references/researches/Sorting Balls and Water.pdf";

const FILE: RepoLogFile = { code: "R", path: NEW_PATH, origPath: OLD_PATH };

const ENTRY = {
  hash: "abcdef1234567890",
  date: "2026-08-05T01:02:03+03:00",
  author: "maxkalem",
  subject: "move the references",
  files: [FILE],
} as unknown as RepoLogEntry;

function actions(over: Partial<HistoryViewActions> = {}): HistoryViewActions {
  return {
    loadPage: async () => [],
    openDiffAtCommit: () => undefined,
    openFile: () => undefined,
    fileMenu: () => undefined,
    progressText: () => "",
    progressDetail: () => "",
    treeView: () => false,
    toggleTree: () => undefined,
    openStatusPanel: () => undefined,
    openOutput: () => undefined,
    rowsPerGroup: () => 30,
    ...over,
  };
}

function renderedRow(): Any {
  const view = new HistoryView(leaf, actions()) as Any;
  view.renderShell();
  const body = view.contentEl.createDiv();
  view.renderFile(body, FILE, ENTRY, 0);
  return __findByClass(body, "ngb-hist-rename");
}

describe("history panel, the rename hint", () => {
  beforeEach(() => __resetObsidianMock());

  it("shows the name it came from, not the path", () => {
    const hint = renderedRow();
    expect(hint).not.toBeNull();
    expect(hint.textContent).toBe("← Sorting Balls and Water.pdf");
    // The regression this replaces, spelled out so it cannot come back quietly.
    expect(hint.textContent).not.toContain("Projects/");
  });

  it("keeps the whole path reachable", () => {
    const hint = renderedRow();
    expect(hint.getAttribute("aria-label")).toBe(`moved from ${OLD_PATH}`);
    expect(hint.hasClass("ngb-reveal-target")).toBe(true);

    __fire(hint, "click");
    // Three lines now — where it was, an arrow, where it is now — so the
    // whole path is in the subtree rather than in one text node.
    expect(__textOf(__findByClass(__mockDoc.body, "ngb-reveal-pop"))).toContain(OLD_PATH);
  });

  it("does not open the commit's diff when the path is revealed", () => {
    // The row's own click opens the diff. Reading a path is not navigation.
    let opened = 0;
    const view = new HistoryView(leaf, actions({ openDiffAtCommit: () => (opened += 1) })) as Any;
    view.renderShell();
    const body = view.contentEl.createDiv();
    view.renderFile(body, FILE, ENTRY, 0);
    const hint = __findByClass(body, "ngb-hist-rename");

    let stopped = false;
    __fire(hint, "click", { stopPropagation: () => (stopped = true) });
    expect(stopped).toBe(true);
    expect(opened).toBe(0);
  });

  it("renders no hint at all when nothing moved", () => {
    const plain: RepoLogFile = { code: "M", path: NEW_PATH };
    const view = new HistoryView(leaf, actions()) as Any;
    view.renderShell();
    const body = view.contentEl.createDiv();
    view.renderFile(body, plain, ENTRY, 0);
    expect(__findByClass(body, "ngb-hist-rename")).toBeNull();
  });

  it("right click / long press on a file row opens the file-at-commit menu (item 10)", () => {
    // The row used to offer exactly two things (go-to-file, tap = diff) while
    // the file-history panel offered restore and view-at-commit for the same
    // file at the same commit.
    let menuFile: RepoLogFile | null = null;
    let menuEntry: RepoLogEntry | null = null;
    const view = new HistoryView(
      leaf,
      actions({
        fileMenu: (f, e) => {
          menuFile = f;
          menuEntry = e;
        },
      })
    ) as Any;
    view.renderShell();
    const body = view.contentEl.createDiv();
    view.renderFile(body, FILE, ENTRY, 0);
    const row = __findByClass(body, "ngb-sv-file");
    expect(__fire(row, "contextmenu")).toBe(true);
    expect(menuFile).toBe(FILE);
    expect(menuEntry).toBe(ENTRY);
  });
});
