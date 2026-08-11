import { beforeEach, describe, expect, it } from "vitest";
import {
  __findAllByClass,
  __findByClass,
  __fire,
  __resetObsidianMock,
  __textOf,
} from "./mocks/obsidian";
import { StatusView, type StatusViewActions, type StatusViewData } from "../src/ui/StatusView";

/**
 * A panel that appears while an operation is already running.
 *
 * The plugin pushes state into the panel; that push returns early when no panel
 * exists yet. So a panel restored by the workspace at startup, or opened by hand
 * a moment later, was built with no running action — and the per-second progress
 * update deliberately does NOT re-render, because a re-render restarts the
 * toolbar animations. The refresh icon therefore stayed still for the whole
 * operation while the progress line ticked beside it.
 *
 * The panel now asks for the state when it opens, which closes the case
 * whatever the order of events was.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

(globalThis as Any).window = {
  setInterval: (fn: Any, ms: Any) => setInterval(fn, ms),
  clearInterval: (id: Any) => clearInterval(id),
};

function actions(over: Partial<StatusViewActions> = {}): StatusViewActions {
  const noop = () => undefined;
  return {
    refresh: noop, sync: noop, pull: noop, push: noop, fetch: noop, commit: noop,
    stageAll: noop, unstageAll: noop, openLog: noop, toggleTree: noop, openHistory: noop,
    finishInProgressOp: noop, abortInProgressOp: noop, cancel: noop, openFile: noop,
    openDiff: noop, openConflict: noop, stage: noop, unstage: noop, discard: noop,
    folderAction: noop, groupAction: noop, groupMenu: noop, fileMenu: noop,
    syncState: noop, openOutput: noop,
    ...over,
  } as unknown as StatusViewActions;
}

const RUNNING: StatusViewData = {
  state: "syncing",
  branch: "main",
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
  progress: "status… 3s",
  runningAction: "status",
} as unknown as StatusViewData;

describe("a panel opened during an operation", () => {
  beforeEach(() => __resetObsidianMock());

  it("opens the output panel when the state line is tapped", async () => {
    // That line is what the user watches during a long operation, and watching
    // was all they could do with it: `sync… 240s` states a number and nothing
    // about what git is doing. It is the obvious thing to tap.
    let opened = 0;
    const view = new StatusView({} as Any, actions({ openOutput: () => (opened += 1) })) as Any;
    view.setData(RUNNING);
    const line = __findByClass(view.contentEl, "ngb-sv-progress-text");
    expect(line).not.toBeNull();
    expect(line.hasClass("ngb-sv-progress-tap")).toBe(true);
    expect(__fire(line, "click")).toBe(true);
    expect(opened).toBe(1);
  });

  it("draws the runner's words on a reserved second line, and keeps the line when they stop", () => {
    // The state line must stay `action… Ns` — the runner's step goes UNDER it,
    // smaller and muted, and the line exists even while empty so the repository
    // state below never jumps when the first progress line arrives.
    const view = new StatusView({} as Any, actions()) as Any;
    view.setData(RUNNING);
    const detail = __findByClass(view.contentEl, "ngb-sv-progress-detail");
    expect(detail).not.toBeNull();
    expect(detail.textContent).toBe("");
    view.updateProgressText("sync… 5s", "sync: reapplying the sparse checkout");
    expect(__findByClass(view.contentEl, "ngb-sv-progress-text").textContent).toBe("sync… 5s");
    expect(__findByClass(view.contentEl, "ngb-sv-progress-detail").textContent).toBe(
      "sync: reapplying the sparse checkout"
    );
    // Idle empties the line but must not remove it: reserved means reserved.
    view.updateProgressText(null, null);
    const after = __findByClass(view.contentEl, "ngb-sv-progress-detail");
    expect(after).not.toBeNull();
    expect(after.textContent).toBe("");
  });

  it("opens the output panel from the detail line too", () => {
    // The two lines are one control: whatever the finger lands on answers.
    let opened = 0;
    const view = new StatusView({} as Any, actions({ openOutput: () => (opened += 1) })) as Any;
    view.setData(RUNNING);
    const detail = __findByClass(view.contentEl, "ngb-sv-progress-detail");
    expect(detail.hasClass("ngb-sv-progress-tap")).toBe(true);
    expect(__fire(detail, "click")).toBe(true);
    expect(opened).toBe(1);
  });

  it("asks the plugin for the current state as it opens", async () => {
    let asked = 0;
    const view = new StatusView({} as Any, actions({ syncState: () => (asked += 1) })) as Any;
    await view.onOpen();
    expect(asked).toBe(1);
  });

  it("animates the action's own button once that state arrives", async () => {
    // What the device showed: the progress line ticking with a still icon.
    const view = new StatusView({} as Any, actions({ syncState: () => view.setData(RUNNING) })) as Any;
    await view.onOpen();
    const spinning = __findAllByClass(view.contentEl, "ngb-anim-spin");
    expect(spinning.length).toBeGreaterThan(0);
    // The rotation is reserved for refresh, so it is the refresh button that
    // carries it and not, say, the pull button's sweep.
    expect(spinning.some((e: Any) => e.attrs["aria-label"] === "Refresh status")).toBe(true);
  });

  it("never claims a clean tree it has not read", async () => {
    // What the device showed on startup, while the repository sat in an
    // unfinished merge with six conflicts: "Clean", "Working tree clean.",
    // "↑0 ↓0". The push builds an empty summary when it has none, and empty
    // read as clean. A user can commit or push on that.
    const notRead = {
      statusLoaded: false,
      state: "unknown",
      branch: "master",
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    } as unknown as StatusViewData;
    const view = new StatusView({} as Any, actions({ syncState: () => view.setData(notRead) })) as Any;
    await view.onOpen();
    const text = __textOf(view.contentEl);
    expect(text).not.toContain("Working tree clean");
    expect(text).toContain("No status read yet");
    // And it does not state an ahead/behind count nobody checked.
    expect(text).not.toContain("↑0");
  });

  it("still says it is working while an operation runs without a status", async () => {
    // The honest middle state: nothing read yet, but something IS happening.
    const running = {
      statusLoaded: false,
      state: "syncing",
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      progress: "pull… 2s",
    } as unknown as StatusViewData;
    const view = new StatusView({} as Any, actions({ syncState: () => view.setData(running) })) as Any;
    await view.onOpen();
    expect(__textOf(view.contentEl)).toContain("Working…");
    expect(__textOf(view.contentEl)).not.toContain("Working tree clean");
  });

  it("leaves the buttons still when nothing is running", async () => {
    const idle = { ...RUNNING, progress: undefined, runningAction: undefined } as StatusViewData;
    const view = new StatusView({} as Any, actions({ syncState: () => view.setData(idle) })) as Any;
    await view.onOpen();
    expect(__findAllByClass(view.contentEl, "ngb-anim-spin")).toHaveLength(0);
  });
});
