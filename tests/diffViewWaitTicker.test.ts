import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetObsidianMock } from "./mocks/obsidian";
import { DiffView, type DiffViewActions, type DiffLoadResult } from "../src/ui/DiffView";

/**
 * The diff pane's "the runner is working" indicator is one 500 ms interval per
 * pane, and the pane is reused for every diff the user opens. Nothing
 * serialises the loads: pointing the pane at a second file while the first is
 * still in flight sends a second request, and `renderWaiting` hands the single
 * ticker to whichever started last.
 *
 * `loadAndRender` therefore has to stop only the ticker its own wait started.
 * It used to stop unconditionally, and one line before the `loadSeq` guard, so
 * the older answer took down the indicator the newer load was using: the
 * spinner kept turning (the animation is CSS) and the elapsed line froze until
 * the second diff landed. The two history panels were given the ownership rule
 * in 0.6.3; this pane was not.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

const started: number[] = [];
const cleared: number[] = [];

(globalThis as Any).window = {
  setInterval: (fn: Any, ms: number) => {
    const id = setInterval(fn, ms) as unknown as number;
    started.push(id);
    return id;
  },
  clearInterval: (id: number) => {
    cleared.push(id);
    clearInterval(id);
  },
};

const DIFF = `+++ b/note.md
@@ -3,2 +3,2 @@
 context
-was
+is
`;

function result(): DiffLoadResult {
  return {
    diff: DIFF,
    truncated: false,
    hunksShown: 1,
    hunksTotal: 1,
    totalBytes: DIFF.length,
    limitBytes: 100 * 1024,
  };
}

function actions(over: Partial<DiffViewActions> = {}): DiffViewActions {
  return {
    loadDiff: () => Promise.resolve(result()),
    confirmLargerDiff: () => Promise.resolve(null),
    wrapLines: () => false,
    showInvisibles: () => false,
    inlineUnit: () => "word",
    keepLineSelection: () => false,
    colors: () => null,
    progressText: () => "",
    openFileAt: () => undefined,
    restoreBlock: () => Promise.resolve(),
    applyPatch: () => Promise.resolve(true),
    confirmDiscard: () => Promise.resolve(true),
    ...over,
  };
}

function viewFor(over: Partial<DiffViewActions> = {}): Any {
  const view = new DiffView(leaf, actions(over)) as Any;
  view.state = { path: "note.md", from: "HEAD", to: "WORKTREE", label: "HEAD → working tree" };
  return view;
}

describe("diff pane, the wait ticker", () => {
  beforeEach(() => {
    __resetObsidianMock();
    started.length = 0;
    cleared.length = 0;
  });

  afterEach(() => {
    for (const id of started) clearInterval(id);
  });

  it("stops the ticker it started once the diff has arrived", async () => {
    let release: (v: DiffLoadResult) => void = () => undefined;
    const pending = new Promise<DiffLoadResult>((res) => {
      release = res;
    });
    const view = viewFor({ loadDiff: () => pending });

    const done = view.loadAndRender();
    // Without this the test would also pass on a pane that never started one.
    expect(view.waitTicker).not.toBeNull();
    const id = view.waitTicker as number;

    release(result());
    await done;

    expect(view.waitTicker).toBeNull();
    expect(cleared).toContain(id);
  });

  it("does not stop a ticker that a later load owns", async () => {
    const gates: Array<(v: DiffLoadResult) => void> = [];
    const view = viewFor({
      loadDiff: () => new Promise<DiffLoadResult>((res) => gates.push(res)),
    });

    const doneA = view.loadAndRender();
    const tickerA = view.waitTicker as number;
    // Pointing the pane at another diff while the first is in flight: the
    // second wait takes the ticker over.
    view.state = { path: "other.md", from: "HEAD", to: "WORKTREE", label: "HEAD → working tree" };
    const doneB = view.loadAndRender();
    const tickerB = view.waitTicker as number;
    expect(tickerB).not.toBe(tickerA);

    // The superseded load answers first. It must leave the indicator alone.
    gates[0]?.(result());
    await doneA;
    expect(view.waitTicker).toBe(tickerB);
    expect(cleared).not.toContain(tickerB);

    gates[1]?.(result());
    await doneB;
    expect(view.waitTicker).toBeNull();
  });
});
