import { beforeEach, describe, expect, it } from "vitest";
import {
  __findAllByClass,
  __findByClass,
  __resetObsidianMock,
  __setPlatformAndroid,
  __textOf,
} from "./mocks/obsidian";
import {
  StatusView,
  DEFAULT_ROWS_PER_GROUP,
  GROUP_PAGES_CEILING,
  type StatusViewActions,
  type StatusViewData,
} from "../src/ui/StatusView";
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

// The panels schedule their wait indicator with window.setInterval; the node
// test environment has no window.
(globalThis as Any).window = {
  setInterval: (fn: Any, ms: Any) => setInterval(fn, ms),
  clearInterval: (id: Any) => clearInterval(id),
};

function statusActions(): StatusViewActions {
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

function historyActions(over: Partial<HistoryViewActions> = {}): HistoryViewActions {
  return {
    loadPage: async () => [],
    openDiffAtCommit: () => undefined,
    fileMenu: () => undefined,
    openFile: () => undefined,
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

function renderHistory(): Any {
  const v = new HistoryView(leaf, historyActions());
  (v as Any).renderShell();
  return (v as Any).contentEl;
}

beforeEach(() => __resetObsidianMock());

/** The untracked group starts collapsed, so a test about its rows must open it. */
function renderUntrackedExpanded(over: Partial<StatusViewData>): Any {
  const v = new StatusView(leaf, statusActions()) as Any;
  v.collapsed.untracked = false;
  v.setData(statusData(over));
  return v.contentEl;
}

describe("group header counts agree with the rows under them", () => {
  it("counts the files behind a collapsed untracked directory, not the entry", () => {
    // The header read "1" while the folder row under it read "2.4k": git prints
    // one `dir/` entry and the panel lists its contents from untrackedChildren.
    // Asserted through a RENDER, not on the pure function alone: the function
    // was right and the call site still passed items.length.
    const c = renderStatus({
      state: "dirty",
      untracked: ["Private/!inbox/1/"],
      untrackedChildren: {
        "Private/!inbox/1/": Array.from({ length: 2415 }, (_, i) => `Private/!inbox/1/f${i}.md`),
      },
    });
    const badges = __findAllByClass(c, "ngb-sv-count").map((e: Any) => e.textContent);
    expect(badges).toContain("2.4k");
    expect(badges).not.toContain("1");
  });

  it("draws one page of a huge untracked directory and offers the rest", () => {
    // 2415 rows at about a dozen DOM nodes each were redrawn on every render,
    // which is what delayed the spinner by two seconds on the device while the
    // header count stayed instant. The count is unaffected: it comes from the
    // data, not from the rows.
    const c = renderUntrackedExpanded({
      state: "dirty",
      untracked: ["Private/!inbox/1/"],
      untrackedChildren: {
        "Private/!inbox/1/": Array.from({ length: 2415 }, (_, i) => `Private/!inbox/1/f${i}.md`),
      },
    });
    // The budget counts ROWS, and the folder row is one of them.
    expect(__findAllByClass(c, "ngb-sv-file")).toHaveLength(DEFAULT_ROWS_PER_GROUP);
    const more = __findAllByClass(c, "ngb-sv-more-children");
    expect(more).toHaveLength(1);
    expect(more[0].textContent).toBe(`${DEFAULT_ROWS_PER_GROUP}/2415 rows • Tap for more`);
    expect(__findAllByClass(c, "ngb-sv-count").map((e: Any) => e.textContent)).toContain("2.4k");
  });

  it("does not offer more when the group fits in the budget", () => {
    const c = renderUntrackedExpanded({
      state: "dirty",
      untracked: ["small/"],
      untrackedChildren: { "small/": ["small/a.md", "small/b.md"] },
    });
    expect(__findAllByClass(c, "ngb-sv-more-children")).toHaveLength(0);
    expect(__findAllByClass(c, "ngb-sv-file")).toHaveLength(3);
  });

  it("offers the rest in TREE layout too, not only in the list", () => {
    // The control used to be rendered after the list loop, and the tree branch
    // returned before reaching it. On the device, in tree layout, the panel
    // simply stopped at the budget with nothing saying why.
    const c = renderUntrackedExpanded({
      state: "dirty",
      treeView: true,
      untracked: ["big/"],
      untrackedChildren: { "big/": Array.from({ length: 500 }, (_, i) => `big/f${i}.md`) },
    });
    const more = __findAllByClass(c, "ngb-sv-more-children");
    expect(more).toHaveLength(1);
    // Inside the folder it belongs to, indented with its files, not parked at
    // the end of the group where it would name nothing.
    expect(more[0].hasClass("ngb-ind-1")).toBe(true);
    expect(more[0].hasClass("ngb-sv-file")).toBe(true);
    // The whole folder, not the cap's own number: an earlier version expanded
    // only as many children as the ceiling allowed and then reported that.
    expect(more[0].textContent).toBe(`${DEFAULT_ROWS_PER_GROUP}/500 files • Tap for more`);
  });

  it("gives each tree folder its own budget and its own control", () => {
    // A single control at the end of the group cannot say WHICH folders were
    // cut short. Two truncated folders, two controls.
    const c = renderStatus({
      state: "dirty",
      treeView: true,
      rowsPerGroup: 5,
      unstaged: [
        ...Array.from({ length: 20 }, (_, i) => ({ path: `a/f${i}.md`, index: " ", worktree: "M" })),
        ...Array.from({ length: 20 }, (_, i) => ({ path: `b/f${i}.md`, index: " ", worktree: "M" })),
      ] as Any,
    });
    expect(__findAllByClass(c, "ngb-sv-more-children")).toHaveLength(2);
    // Five files drawn in each folder, plus the two folder rows and the two
    // controls: the folders do not share one page between them.
    expect(__findAllByClass(c, "ngb-code-M")).toHaveLength(10);
  });

  it("stops a group of very many folders at the cost ceiling", () => {
    // The per-folder rule alone is not a budget: without a ceiling this would
    // draw a page in each of a hundred folders. When the ceiling bites, the
    // group-level row is what explains it.
    const c = renderStatus({
      state: "dirty",
      treeView: true,
      rowsPerGroup: 2,
      unstaged: Array.from({ length: 100 }, (_, i) => ({
        path: `d${i}/f.md`,
        index: " ",
        worktree: "M",
      })) as Any,
    });
    // 2 rows per page, ten pages: twenty rows and no more.
    expect(__findAllByClass(c, "ngb-sv-file")).toHaveLength(2 * GROUP_PAGES_CEILING);
    const more = __findAllByClass(c, "ngb-sv-more-children");
    expect(more.some((e: Any) => e.textContent.endsWith("rows • Tap for more"))).toBe(true);
  });

  it("budgets every group separately, so one long group cannot starve another", () => {
    // Four long groups at once is the case the per-group budget exists for:
    // a conflicted merge, a staged set, the changes beside it and the new
    // files. A single shared budget would have drawn the first group only.
    const files = (n: number, p: string) =>
      Array.from({ length: n }, (_, i) => ({ path: `${p}/f${i}.md`, index: "M", worktree: "M" }));
    const c = renderStatus({
      state: "dirty",
      staged: files(50, "s") as Any,
      unstaged: files(50, "u") as Any,
      conflicted: files(50, "c") as Any,
      rowsPerGroup: 5,
    });
    // Three groups (untracked is empty and collapsed), five rows each.
    expect(__findAllByClass(c, "ngb-sv-file")).toHaveLength(15);
    expect(__findAllByClass(c, "ngb-sv-more-children")).toHaveLength(3);
  });
});

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

describe("nothing animates for work that is not happening", () => {
  /**
   * Reported from the device: opening the history panel while the runner is busy
   * shows a notice that the refresh cannot run, and something keeps spinning.
   *
   * Two separate faults were behind it. The refresh button decided its animation
   * inside `renderShell`, from a flag `loadMore` sets afterwards, so it never
   * span at all however long the runner took. And each load registered another
   * interval for the in-list indicator, which `registerInterval` keeps alive
   * until the panel closes, leaving one timer per refresh ticking into a node
   * that had already been removed.
   */
  const busyRunner = () => ({ loadPage: async () => null }); // the lock refuses

  it("the refresh button spins while the load is in flight", async () => {
    __setPlatformAndroid(true);
    let release: (v: unknown) => void = () => undefined;
    const v = new HistoryView(
      leaf,
      historyActions({ loadPage: () => new Promise((r) => (release = r as never)) })
    );
    const pending = v.onOpen();
    const btn = __findByClass((v as Any).contentEl, "ngb-sv-toolbar").children[0];
    expect(btn.hasClass("ngb-anim-spin")).toBe(true);
    release([]);
    await pending;
    expect(btn.hasClass("ngb-anim-spin")).toBe(false);
  });

  it("stops spinning when the operation is refused", async () => {
    __setPlatformAndroid(true);
    const v = new HistoryView(leaf, historyActions(busyRunner()));
    await v.onOpen();
    const c = (v as Any).contentEl;
    expect(__findAllByClass(c, "ngb-anim-spin")).toHaveLength(0);
    expect(__findAllByClass(c, "ngb-filehist-waiting")).toHaveLength(0);
  });

  it("says Idle again rather than Loading history", async () => {
    __setPlatformAndroid(true);
    const v = new HistoryView(leaf, historyActions(busyRunner()));
    await v.onOpen();
    const strip = __findByClass((v as Any).contentEl, "ngb-sv-strip");
    expect(__textOf(strip)).toContain("Idle");
    expect(__textOf(strip)).not.toContain("Loading history");
  });

  it("leaves one wait timer at most, however many refreshes have run", async () => {
    __setPlatformAndroid(true);
    const v = new HistoryView(leaf, historyActions(busyRunner()));
    await v.onOpen();
    for (let i = 0; i < 4; i++) await v.refresh();
    expect((v as Any).waitTicker).toBeNull();
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
