import { beforeEach, describe, expect, it } from "vitest";
import {
  __findAllByClass,
  __findByClass,
  __resetObsidianMock,
  __setPlatformAndroid,
  __textOf,
} from "./mocks/obsidian";
import { StatusView, type StatusViewActions, type StatusViewData } from "../src/ui/StatusView";
import { HistoryView, type HistoryViewActions } from "../src/ui/HistoryView";

/**
 * Where each panel puts each control.
 *
 * Two layout regressions shipped before this file existed and neither could
 * have been caught by a type check: a pane that shared the panel stylesheet but
 * built no scrolling region of its own (so its content became unreachable), and
 * controls landing in a region the user could scroll away from. The structure
 * is now asserted directly.
 *
 * What this canNOT tell you: whether anything actually scrolls, fits, or is
 * clipped. That is CSS, the mock has no layout engine, and it stays a
 * device-screenshot question.
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
  } as unknown as StatusViewActions;
}

function statusData(over: Partial<StatusViewData> = {}): StatusViewData {
  return {
    state: "clean", branch: "main", ahead: 0, behind: 0,
    staged: [], unstaged: [], untracked: [], conflicted: [],
    bridge: "companion app",
    ...over,
  };
}

function renderStatus(over: Partial<StatusViewData> = {}): Any {
  const v = new StatusView(leaf, statusActions());
  v.setData(statusData(over));
  return (v as Any).contentEl;
}

function historyActions(): HistoryViewActions {
  return {
    loadPage: async () => [],
    openDiffAtCommit: () => undefined,
    openFile: () => undefined,
    progressText: () => "",
    treeView: () => false,
    toggleTree: () => undefined,
    openStatusPanel: () => undefined,
  };
}

function renderHistory(): Any {
  const v = new HistoryView(leaf, historyActions());
  (v as Any).renderShell();
  return (v as Any).contentEl;
}

beforeEach(() => __resetObsidianMock());

describe("every panel builds all three regions", () => {
  for (const phone of [true, false]) {
    it(`status panel, ${phone ? "phone" : "desktop"}`, () => {
      __setPlatformAndroid(phone);
      const c = renderStatus();
      expect(__findByClass(c, "ngb-sv-head")).not.toBeNull();
      expect(__findByClass(c, "ngb-sv-body")).not.toBeNull();
      expect(__findByClass(c, "ngb-sv-footbar")).not.toBeNull();
    });

    it(`history panel, ${phone ? "phone" : "desktop"}`, () => {
      __setPlatformAndroid(phone);
      const c = renderHistory();
      expect(__findByClass(c, "ngb-sv-head")).not.toBeNull();
      expect(__findByClass(c, "ngb-sv-body")).not.toBeNull();
      expect(__findByClass(c, "ngb-sv-footbar")).not.toBeNull();
    });
  }

  // The regression: a pane that adds `ngb-status-view` inherits its
  // `overflow: hidden`, so without a body of its own nothing scrolls at all.
  it("a panel's scrolling body is never left out", () => {
    for (const phone of [true, false]) {
      __setPlatformAndroid(phone);
      for (const c of [renderStatus(), renderHistory()]) {
        const body = __findByClass(c, "ngb-sv-body");
        expect(body).not.toBeNull();
        expect(body.parent.hasClass("ngb-status-view")).toBe(true);
      }
    }
  });
});

describe("the git controls move to the bottom on a phone only", () => {
  it("phone: toolbar in the bottom bar, state and view controls on top", () => {
    __setPlatformAndroid(true);
    const c = renderStatus();
    const foot = __findByClass(c, "ngb-sv-footbar");
    const head = __findByClass(c, "ngb-sv-head");
    expect(__findByClass(foot, "ngb-sv-toolbar")).not.toBeNull();
    expect(__findByClass(head, "ngb-sv-toolbar")).toBeNull();
    // The branch line and the strip (state + list/tree + history) stay up top.
    expect(__findByClass(head, "ngb-sv-header")).not.toBeNull();
    expect(__findByClass(head, "ngb-sv-strip")).not.toBeNull();
  });

  it("desktop: toolbar stays at the top, where this panel has always had it", () => {
    __setPlatformAndroid(false);
    const c = renderStatus();
    const head = __findByClass(c, "ngb-sv-head");
    expect(__findByClass(head, "ngb-sv-toolbar")).not.toBeNull();
    expect(__findByClass(__findByClass(c, "ngb-sv-footbar"), "ngb-sv-toolbar")).toBeNull();
    // …and it comes FIRST, above the strip and the branch line.
    expect(head.children[0].hasClass("ngb-sv-toolbar")).toBe(true);
  });

  it("the toolbar exists exactly once, wherever it is", () => {
    for (const phone of [true, false]) {
      __setPlatformAndroid(phone);
      expect(__findAllByClass(renderStatus(), "ngb-sv-toolbar")).toHaveLength(1);
    }
  });
});

describe("the history panel mirrors the status panel", () => {
  it("puts refresh in the same region the status panel puts its git controls", () => {
    for (const phone of [true, false]) {
      __setPlatformAndroid(phone);
      const region = phone ? "ngb-sv-footbar" : "ngb-sv-head";
      expect(__findByClass(__findByClass(renderStatus(), region), "ngb-sv-toolbar")).not.toBeNull();
      expect(__findByClass(__findByClass(renderHistory(), region), "ngb-sv-toolbar")).not.toBeNull();
    }
  });

  // The separator rule lives on the branch line (see styles.css), so "the
  // banner is after the header" is also "the banner is below the rule". If a
  // future change moves the banner above the header it lands above the rule,
  // and the rule stops meaning "controls end here".
  it("keeps its single control alone in the bar, so it can be pinned to the corner", () => {
    __setPlatformAndroid(true);
    const foot = __findByClass(renderHistory(), "ngb-sv-footbar");
    const bar = __findByClass(foot, "ngb-sv-toolbar");
    expect(bar.children).toHaveLength(1);
    expect(bar.children[0].getAttribute("aria-label")).toBe("Refresh history");
  });

  it("puts the layout toggle and the other panel's button in the same strip slot", () => {
    __setPlatformAndroid(true);
    for (const c of [renderStatus(), renderHistory()]) {
      const right = __findByClass(__findByClass(c, "ngb-sv-head"), "ngb-sv-strip-right");
      expect(right).not.toBeNull();
      expect(right.children).toHaveLength(2);
    }
  });

  it("each panel offers the way to the other one", () => {
    __setPlatformAndroid(true);
    const labels = (c: Any) =>
      __findAllByClass(c, "ngb-sv-icon").map((b: Any) => b.getAttribute("aria-label"));
    expect(labels(renderStatus())).toContain("Repository history");
    expect(labels(renderHistory())).toContain("Git panel");
  });
});

describe("the merge banner", () => {
  const merging = { mergeInProgress: true } as Partial<StatusViewData>;

  it("is absent when nothing is in progress", () => {
    __setPlatformAndroid(true);
    expect(__findByClass(renderStatus(), "ngb-sv-banner")).toBeNull();
  });

  // It must not be somewhere the user can scroll past: while it is showing,
  // pull, push and sync all refuse.
  //
  // "After the header" is also "below the separator rule": the rule is a
  // border-bottom on the branch line, so that it stays at the height the top
  // region ends at when there is NO banner, instead of jumping every time a
  // merge starts or ends. Moving the banner above the header would put it above
  // the rule and break that meaning.
  it("sits in the fixed head, under the branch line and its separator", () => {
    for (const phone of [true, false]) {
      __setPlatformAndroid(phone);
      const head = __findByClass(renderStatus(merging), "ngb-sv-head");
      const banner = __findByClass(head, "ngb-sv-banner");
      expect(banner).not.toBeNull();
      const idx = head.children.findIndex((x: Any) => x.hasClass("ngb-sv-banner"));
      const headerIdx = head.children.findIndex((x: Any) => x.hasClass("ngb-sv-header"));
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeGreaterThan(headerIdx);
      // …and it is the LAST thing in the head, so the file list starts under it.
      expect(idx).toBe(head.children.length - 1);
    }
  });

  it("shows with zero conflicts, which is the state that had no way out", () => {
    __setPlatformAndroid(true);
    const c = renderStatus({ ...merging, conflicted: [] });
    expect(__findByClass(c, "ngb-sv-banner")).not.toBeNull();
    expect(__textOf(c)).toContain("Commit merge");
    expect(__textOf(c)).toContain("Abort merge");
  });

  it("phone: compact, no icon, shorter words", () => {
    __setPlatformAndroid(true);
    const b = __findByClass(renderStatus(merging), "ngb-sv-banner");
    expect(b.hasClass("ngb-sv-banner-compact")).toBe(true);
    expect(__findByClass(b, "ngb-sv-banner-icon")).toBeNull();
    expect(__textOf(b)).toContain("Merge ready to commit");
  });

  it("desktop: full wording and the icon", () => {
    __setPlatformAndroid(false);
    const b = __findByClass(renderStatus(merging), "ngb-sv-banner");
    expect(b.hasClass("ngb-sv-banner-compact")).toBe(false);
    expect(__findByClass(b, "ngb-sv-banner-icon")).not.toBeNull();
    expect(__textOf(b)).toContain("Merge in progress");
  });

  it("abort is filled red on both platforms and is never disabled", () => {
    for (const phone of [true, false]) {
      __setPlatformAndroid(phone);
      const b = __findByClass(renderStatus(merging), "ngb-sv-banner");
      const abort = __findByClass(b, "ngb-sv-banner-abort");
      expect(abort).not.toBeNull();
      expect(abort.disabled).toBe(false);
    }
  });

  it("finish is disabled while conflicts remain", () => {
    __setPlatformAndroid(true);
    const conflicted = [{ path: "a.md", index: "U", worktree: "U" }] as Any;
    const b = __findByClass(renderStatus({ ...merging, conflicted }), "ngb-sv-banner");
    const buttons = __findByClass(b, "ngb-sv-banner-actions").children;
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
  });
});
