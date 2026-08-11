import { beforeEach, describe, expect, it } from "vitest";
import { __findAllByClass, __findByClass, __resetObsidianMock } from "./mocks/obsidian";
import { StatusView, type StatusViewActions, type StatusViewData } from "../src/ui/StatusView";
import { renderFileBadge } from "../src/ui/modals";
import { __fakeEl } from "./mocks/obsidian";

/**
 * A conflict looks the same wherever it is stated.
 *
 * Three surfaces name conflicted files — the status panel, the changed-files
 * window and the "sync stopped" window — and they had drifted into three
 * alphabets: the panel's rows carried a warning glyph, the panel's GROUP header
 * carried a class the stylesheet has no rule for (so it read as an ordinary
 * header above rows that were all marked), and the two windows wrote a bare `!`
 * or `U` flush against the path, where it read as the path's first character.
 *
 * The glyph is the vocabulary; the letters are git's, and they belong in a chip
 * of their own.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

function statusActions(): StatusViewActions {
  const noop = () => undefined;
  return {
    refresh: noop, sync: noop, pull: noop, push: noop, fetch: noop, commit: noop,
    stageAll: noop, unstageAll: noop, openLog: noop, toggleTree: noop, openHistory: noop,
    finishInProgressOp: noop, abortInProgressOp: noop, cancel: noop, openFile: noop,
    openDiff: noop, openConflict: noop, stage: noop, unstage: noop, discard: noop,
    folderAction: noop, groupAction: noop, groupMenu: noop, fileMenu: noop,
    syncState: noop, openOutput: noop,
    // A reader, not an action, and the row renderer calls it unconditionally on
    // mobile: the cast below hides a missing one until the row is drawn, and
    // then it fails as "not a function" in the middle of a render.
    showChangeWords: () => false,
  } as unknown as StatusViewActions;
}

function panel(over: Partial<StatusViewData> = {}): Any {
  const v = new StatusView(leaf, statusActions()) as Any;
  v.setData({
    state: "clean", branch: "main", ahead: 0, behind: 0,
    staged: [], unstaged: [], untracked: [], conflicted: [],
    bridge: "companion app", statusLoaded: true,
    ...over,
  } as StatusViewData);
  return v.contentEl;
}

const CONFLICT = { path: "Private/notes.md", code: "U", index: "U", worktree: "U" };

describe("the status panel's conflict group", () => {
  beforeEach(() => __resetObsidianMock());

  it("marks the header with the same warning glyph its rows carry", () => {
    const c = panel({ state: "conflict", conflicted: [CONFLICT] as Any });
    const header = __findByClass(c, "ngb-sv-group-header");
    expect(header).not.toBeNull();
    expect(__findByClass(header, "ngb-conf-row-icon")).not.toBeNull();
  });

  it("gives the title a class the stylesheet actually colours", () => {
    const c = panel({ state: "conflict", conflicted: [CONFLICT] as Any });
    const title = __findByClass(c, "ngb-sv-group-danger");
    expect(title).not.toBeNull();
    expect(title.textContent).toContain("Conflict");
    // The class it used to carry belongs to the status bar, which has no rule
    // here and is not shown on mobile at all.
    expect(__findAllByClass(c, "ngb-status-conflict")).toHaveLength(0);
  });

  it("leaves an ordinary group unmarked", () => {
    const c = panel({ state: "changed", unstaged: [{ path: "a.md", code: "M" }] as Any });
    expect(__findByClass(c, "ngb-sv-group-danger")).toBeNull();
    const header = __findByClass(c, "ngb-sv-group-header");
    expect(__findByClass(header, "ngb-conf-row-icon")).toBeNull();
  });
});

describe("the change marker in a modal's file list", () => {
  beforeEach(() => __resetObsidianMock());

  it("draws a conflict as the glyph, not as a letter", () => {
    const li = __fakeEl("li");
    const badge = renderFileBadge(li, null);
    expect(badge.hasClass("ngb-badge-conflict")).toBe(true);
    // No text at all: a letter here is what read as the first character of the
    // path that follows.
    expect(badge.textContent).toBe("");
    expect(badge.getAttribute("aria-label")).toBe("Merge conflict");
  });

  it("keeps git's own letter for everything else", () => {
    const li = __fakeEl("li");
    for (const code of ["M", "D", "A", "R", "?"]) {
      const badge = renderFileBadge(li, code);
      expect(badge.textContent).toBe(code);
      expect(badge.hasClass("ngb-badge")).toBe(true);
      expect(badge.hasClass("ngb-badge-conflict")).toBe(false);
    }
  });
});
