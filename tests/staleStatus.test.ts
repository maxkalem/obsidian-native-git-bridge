import { beforeEach, describe, expect, it } from "vitest";
import { __resetObsidianMock, __textOf } from "./mocks/obsidian";
import { StatusView, type StatusViewActions, type StatusViewData } from "../src/ui/StatusView";

/**
 * A status nobody has read since the repository moved.
 *
 * `statusLoaded: false` was introduced for the case where nothing had ever been
 * read: the panel refused to render four empty lists as a clean tree. The other
 * way of not knowing was left out — an operation that FAILED, timed out or was
 * cancelled without bringing fresh status back. The panel kept rendering the
 * summary it already had, which after a failed sync announced a clean tree over
 * the very files that had stopped it.
 *
 * Both cases are the same claim: this is what the repository looked like when
 * somebody last looked, and nobody has looked since.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

(globalThis as Any).window = {
  setInterval: (fn: Any, ms: Any) => setInterval(fn, ms),
  clearInterval: (id: Any) => clearInterval(id),
};

const leaf = {} as Any;

function actions(): StatusViewActions {
  const noop = () => undefined;
  return {
    refresh: noop, sync: noop, pull: noop, push: noop, fetch: noop, commit: noop,
    stageAll: noop, unstageAll: noop, openLog: noop, toggleTree: noop, openHistory: noop,
    finishInProgressOp: noop, abortInProgressOp: noop, cancel: noop, openFile: noop,
    openDiff: noop, openConflict: noop, stage: noop, unstage: noop, discard: noop,
    folderAction: noop, groupAction: noop, groupMenu: noop, fileMenu: noop,
    syncState: noop, openOutput: noop, showChangeWords: () => true,
  } as unknown as StatusViewActions;
}

function panel(over: Partial<StatusViewData>): Any {
  const v = new StatusView(leaf, actions()) as Any;
  v.setData({
    state: "clean", branch: "main", ahead: 0, behind: 0,
    staged: [], unstaged: [], untracked: [], conflicted: [],
    bridge: "companion app",
    ...over,
  } as StatusViewData);
  return v.contentEl;
}

describe("a status that was read", () => {
  beforeEach(() => __resetObsidianMock());

  it("says the tree is clean, and how far ahead or behind it is", () => {
    const t = __textOf(panel({ statusLoaded: true, ahead: 2, behind: 3 }));
    expect(t).toContain("Clean");
    expect(t).toMatch(/↑\s*2/);
    expect(t).toMatch(/↓\s*3/);
  });
});

describe("a status nobody has read since the repository moved", () => {
  beforeEach(() => __resetObsidianMock());

  it("never calls it clean", () => {
    // The exact shape of a failed sync: the last summary said clean, and then
    // an operation failed without saying what the repository looks like now.
    const t = __textOf(panel({ statusLoaded: false }));
    expect(t).not.toContain("Clean");
    expect(t).not.toContain("Working tree clean");
  });

  it("prints no ahead/behind counts, which are two more facts nobody checked", () => {
    const t = __textOf(panel({ statusLoaded: false, ahead: 2, behind: 3 }));
    expect(t).not.toMatch(/↑\s*2/);
    expect(t).not.toMatch(/↓\s*3/);
  });

  it("says so in words rather than showing an empty panel", () => {
    const t = __textOf(panel({ statusLoaded: false }));
    expect(t.toLowerCase()).toContain("not checked");
  });
});
