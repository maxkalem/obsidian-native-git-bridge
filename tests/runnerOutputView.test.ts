import { beforeEach, describe, expect, it } from "vitest";
import { __findByClass, __findAllByClass, __fire, __resetObsidianMock, __textOf } from "./mocks/obsidian";
import {
  RunnerOutputView,
  type RunnerOutputActions,
  type RunnerOutputSnapshot,
} from "../src/ui/RunnerOutputView";

/**
 * The panel exists because of one user complaint: there was no way to see what
 * was happening.
 *
 * A clone, a sync or an object repair runs for minutes, and everything the plugin
 * showed of that was a number counting seconds — the same number whether git was
 * transferring at full speed, waiting for a lock, or never started at all. The
 * runner writes its stderr to `runtime/progress/<id>.txt` as it goes; this panel
 * reads it, once a second, while it is open.
 *
 * What is asserted here is what the panel promises: it says what is running, it
 * distinguishes silence-because-nothing-started from silence-because-it-is-early,
 * it does not fetch what nobody has opened, and it does not scroll away from
 * whatever the reader is reading.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

function snap(over: Partial<RunnerOutputSnapshot> = {}): RunnerOutputSnapshot {
  return {
    action: "repair-refetch",
    stateText: null,
    requestId: "r-20260810T120000Z-abc123",
    elapsedSeconds: 42,
    timeoutSeconds: 900,
    stream: "repair: scanning the object store for empty files\nrepair: refetching from origin",
    queued: 1,
    companionAcked: true,
    lastVerdict: null,
    runnerLog: "",
    past: [],
    opLog: "",
    ...over,
  };
}

function viewFor(
  over: Partial<RunnerOutputSnapshot> = {},
  hooks: Partial<RunnerOutputActions> = {}
): { view: Any; asked: { runnerLog: boolean; past: boolean; opLog: boolean }[] } {
  const asked: { runnerLog: boolean; past: boolean; opLog: boolean }[] = [];
  const actions: RunnerOutputActions = {
    snapshot: (want) => {
      asked.push(want);
      return Promise.resolve(snap(over));
    },
    cancel: () => undefined,
    openStatusPanel: () => undefined,
    openHistoryPanel: () => undefined,
    wrapLines: () => false,
    toggleWrapLines: async () => undefined,
    ...hooks,
  };
  const view = new RunnerOutputView(leaf, actions) as Any;
  view.renderShell();
  return { view, asked };
}

describe("the output panel", () => {
  beforeEach(() => __resetObsidianMock());

  it("states the action exactly as the other panels do, with the budget in the facts", async () => {
    // One state, one wording: the git panel says `repair-refetch… 42s`, so this
    // headline must too, or the two read as two different operations. The
    // budget still answers "should I keep waiting", from the facts block.
    const { view } = viewFor();
    await view.tick();
    const head = __findByClass(view.contentEl, "ngb-sv-progress-text");
    expect(head.textContent).toBe("repair-refetch… 42s");
    expect(__textOf(view.contentEl)).toContain("Budget");
    expect(__textOf(view.contentEl)).toContain("900s");
  });

  it("is never blank: the shell says it is reading before the first snapshot lands", () => {
    // An empty pane cannot be told apart from a broken one, which is exactly
    // how "the panel shows nothing" was reported from the device.
    const { view } = viewFor();
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain("Reading…");
  });

  it("says why when the snapshot itself fails, instead of staying blank", async () => {
    // Torn reads are absorbed inside the snapshot; whatever reaches the panel
    // is real and has to be visible, or the panel renders as an empty pane
    // with no way to learn why.
    const { view } = viewFor({}, {
      snapshot: () => Promise.reject(new Error("adapter refused")),
    });
    await view.tick();
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain("adapter refused");
  });

  it("shows the runner's own words, not a paraphrase", async () => {
    const { view } = viewFor();
    await view.tick();
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain(
      "repair: refetching from origin"
    );
  });

  it("tells an early silence apart from a request that never started", async () => {
    // Both look like an empty pane, and they are opposite problems: one wants
    // patience, the other wants the companion looked at.
    const early = viewFor({ stream: "", elapsedSeconds: 2 });
    await early.view.tick();
    expect(__textOf(early.view.contentEl)).toContain("Waiting for the runner");
    expect(__findAllByClass(early.view.contentEl, "ngb-out-fact-warn")).toHaveLength(0);

    const stuck = viewFor({ stream: "", elapsedSeconds: 45, companionAcked: false });
    await stuck.view.tick();
    const warned = __findAllByClass(stuck.view.contentEl, "ngb-out-fact-warn");
    expect(warned.length).toBeGreaterThan(0);
    expect(__textOf(stuck.view.contentEl)).toContain("no acknowledgement yet");
  });

  it("says how the last operation ended when nothing is running", async () => {
    // The panel is usually opened just after something went wrong. "Idle" over
    // the output of a failed sync leaves the reader guessing whether it failed
    // or never ran.
    const { view } = viewFor({
      action: null,
      requestId: null,
      elapsedSeconds: 0,
      timeoutSeconds: 0,
      lastVerdict: "sync failed: git pull failed during sync.",
      stream: "sync: fetching from origin",
    });
    await view.tick();
    expect(__findByClass(view.contentEl, "ngb-sv-progress-text").textContent).toBe("Idle");
    expect(__textOf(view.contentEl)).toContain("git pull failed during sync.");
    // And the stream of that operation is still there to read.
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain("fetching from origin");
  });

  it("does not ask for a tab nobody has selected", async () => {
    // `runner.log` is a file read on shared storage. Once a second, for a tab
    // nobody is looking at, on a phone.
    const { view, asked } = viewFor();
    await view.tick();
    expect(asked[0]).toEqual({ runnerLog: false, past: false, opLog: false });
  });

  it("asks for a log the moment its tab is selected, and shows it in the console field", async () => {
    const { view, asked } = viewFor({ runnerLog: "2026-08-10T09:32:36Z DONE action=sync ok=true" });
    await view.tick();
    const tabs = __findAllByClass(view.contentEl, "ngb-out-tab");
    expect(tabs).toHaveLength(4); // [live, past, runner, oplog]
    __fire(tabs[2], "click");
    // The click starts a fresh snapshot; awaiting a tick is how the test waits
    // for it, and it is the same call the panel makes.
    await view.tick();
    expect(asked.some((a) => a.runnerLog)).toBe(true);
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain("DONE action=sync");
    expect(tabs[2].hasClass("ngb-out-tab-on")).toBe(true);
    // Tapping the active tab returns to the live operation.
    __fire(tabs[2], "click");
    await view.tick();
    expect(tabs[2].hasClass("ngb-out-tab-on")).toBe(false);
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain("repair: scanning");
  });

  it("the live view has a visible tab of its own, so switching away is reversible", async () => {
    // It used to be reachable only by tapping the ACTIVE tab a second time —
    // an affordance nobody can discover. A user reading the idle view's newest
    // stream, who switched to another tab, had no visible way back to it.
    const { view } = viewFor({ runnerLog: "runner line" });
    await view.tick();
    const tabs = __findAllByClass(view.contentEl, "ngb-out-tab");
    expect(tabs[0].hasClass("ngb-out-tab-on")).toBe(true); // live is where the panel opens
    __fire(tabs[2], "click");
    await view.tick();
    expect(tabs[0].hasClass("ngb-out-tab-on")).toBe(false);
    __fire(tabs[0], "click"); // the way back is a button, not a secret
    await view.tick();
    expect(tabs[0].hasClass("ngb-out-tab-on")).toBe(true);
    expect(tabs[2].hasClass("ngb-out-tab-on")).toBe(false);
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain("repair: scanning");
  });

  it("shows the plugin's own operation log on its tab", async () => {
    const { view, asked } = viewFor({ opLog: "2026-08-11T00:00:00Z [info] sync: Queued request r-x." });
    await view.tick();
    const tabs = __findAllByClass(view.contentEl, "ngb-out-tab");
    __fire(tabs[3], "click");
    await view.tick();
    expect(asked.some((a) => a.opLog)).toBe(true);
    expect(__textOf(__findByClass(view.contentEl, "ngb-out-stream"))).toContain("Queued request r-x.");
  });

  it("hides the cancel button when there is nothing to cancel", async () => {
    // Not disabled: nothing to cancel is not the same as a control that refuses.
    const running = viewFor();
    await running.view.tick();
    expect(running.view.cancelBtn.hidden).toBe(false);

    const idle = viewFor({ action: null, requestId: null });
    await idle.view.tick();
    expect(idle.view.cancelBtn.hidden).toBe(true);
  });

  it("follows the tail only while the reader is at the bottom", async () => {
    // A pane that jumps to the newest line every second cannot be read; one that
    // never follows makes the newest line the hardest to reach.
    const { view } = viewFor();
    await view.tick();
    // The scroller is the panel BODY: the console field has none of its own,
    // because a scroller inside a scroller puts the wrong one under the finger.
    const box = view.panelBodyEl as Any;

    // Pinned to the bottom: scrollTop is moved to the end for the new content.
    box.scrollHeight = 500;
    box.clientHeight = 100;
    box.scrollTop = 400;
    view.apply(snap({ stream: "line one\nline two\nline three" }));
    expect(box.scrollTop).toBe(box.scrollHeight);

    // Scrolled up to read something: left exactly where it was put.
    box.scrollTop = 120;
    view.apply(snap({ stream: "line one\nline two\nline three\nline four" }));
    expect(box.scrollTop).toBe(120);
  });

  it("wraps long lines on demand, and the toggle sits apart from the tabs", async () => {
    // The tabs choose WHAT the console shows; wrap changes how. The divider is
    // the visual statement of that split, so its absence is a regression too.
    let wrap = false;
    const { view } = viewFor(
      {},
      { wrapLines: () => wrap, toggleWrapLines: async () => void (wrap = !wrap) }
    );
    await view.tick();
    expect(__findByClass(view.contentEl, "ngb-out-tab-sep")).not.toBeNull();
    expect(view.streamBox.hasClass("ngb-out-wrap")).toBe(false);
    __fire(view.wrapBtn, "click");
    await new Promise((r) => setTimeout(r, 0)); // the click awaits the saved pref
    expect(view.streamBox.hasClass("ngb-out-wrap")).toBe(true);
    expect(view.wrapBtn.hasClass("ngb-sv-icon-active")).toBe(true);
    __fire(view.wrapBtn, "click");
    await new Promise((r) => setTimeout(r, 0));
    expect(view.streamBox.hasClass("ngb-out-wrap")).toBe(false);
  });

  it("labels an earlier stream from the stream itself", async () => {
    // The runner opens every stream with "<action> started", so nothing has to
    // be remembered about a request that finished in another session.
    const { view } = viewFor({
      past: [{ id: "r-20260810T093000Z-old", action: "sync", text: "sync started\nsync: fetching" }],
    });
    await view.tick();
    const tabs = __findAllByClass(view.contentEl, "ngb-out-tab");
    __fire(tabs[1], "click");
    await view.tick();
    expect(__textOf(view.contentEl)).toContain("sync · r-20260810T093000Z-old");
  });
});
