import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetObsidianMock } from "./mocks/obsidian";
import { FileHistoryView, type FileHistoryActions } from "../src/ui/FileHistoryView";
import type { FileLogEntry } from "../src/git/historyParsers";

/**
 * The file-history panel's "the runner is working" indicator is driven by a
 * 500 ms interval, and whoever starts one has to stop it when the answer
 * arrives. `loadMore` does. `renderCommitDiff` did not, so expanding a commit
 * left an interval calling `setText` on a span that `body.empty()` had already
 * detached, until the panel closed or another wait replaced it.
 *
 * `registerInterval` bounds the damage to the panel's lifetime and
 * `renderWaiting` clears the previous timer before starting its own, so this
 * was never a growing leak. It is still a timer running for nothing. The two
 * other panes that do the same thing (`DiffView`, `HistoryView`) stop theirs on
 * the same line as the await, and all three qualify the stop with the ticker id
 * so an answer cannot take down an indicator a later wait is using
 * (`tests/diffViewWaitTicker.test.ts` covers the diff pane's half of that).
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

function expandedView(over: Partial<FileHistoryActions> = {}): Any {
  const view = new FileHistoryView(leaf, actions(over)) as Any;
  view.path = "note.md";
  view.renderShell();
  view.expanded.add(ENTRY.hash);
  return view;
}

describe("file history, the wait ticker", () => {
  beforeEach(() => {
    __resetObsidianMock();
    started.length = 0;
    cleared.length = 0;
  });

  afterEach(() => {
    // Whatever the assertions concluded, no interval outlives the test.
    for (const id of started) clearInterval(id);
  });

  it("stops the ticker it started once the diff has arrived", async () => {
    let release: (v: { diff: string; truncated: boolean }) => void = () => undefined;
    const pending = new Promise<{ diff: string; truncated: boolean }>((res) => {
      release = res;
    });
    const view = expandedView({ loadCommitDiff: () => pending });
    const body = view.contentEl.createDiv({ cls: "ngb-filehist-body" });

    const done = view.renderCommitDiff(body, ENTRY);
    // While the request is in flight the indicator is ticking; without this the
    // test would also pass on a panel that never started one.
    expect(view.waitTicker).not.toBeNull();
    const id = view.waitTicker as number;

    release({ diff: DIFF, truncated: false });
    await done;

    expect(view.waitTicker).toBeNull();
    expect(cleared).toContain(id);
  });

  it("does not stop a ticker that a later wait owns", async () => {
    // Nothing serialises renderCommitDiff: expanding two commits sends two
    // requests. `renderWaiting` gives the panel ONE ticker, so the second
    // expansion takes it over — and then whichever diff arrives first must not
    // clear the indicator the other one is still using.
    const gates = new Map<string, (v: { diff: string; truncated: boolean }) => void>();
    const view = expandedView({
      loadCommitDiff: (e: Any) =>
        new Promise<{ diff: string; truncated: boolean }>((res) => gates.set(e.hash, res)),
    });
    const second: FileLogEntry = { ...ENTRY, hash: "99887766554433" } as FileLogEntry;
    view.expanded.add(second.hash);

    const bodyA = view.contentEl.createDiv({ cls: "ngb-filehist-body" });
    const bodyB = view.contentEl.createDiv({ cls: "ngb-filehist-body" });
    const doneA = view.renderCommitDiff(bodyA, ENTRY);
    const doneB = view.renderCommitDiff(bodyB, second);
    const tickerB = view.waitTicker as number;
    expect(tickerB).not.toBeNull();

    gates.get(ENTRY.hash)?.({ diff: DIFF, truncated: false });
    await doneA;
    expect(view.waitTicker).toBe(tickerB);

    gates.get(second.hash)?.({ diff: DIFF, truncated: false });
    await doneB;
    expect(view.waitTicker).toBeNull();
  });

  it("starts no ticker at all for a diff that is already cached", async () => {
    const view = expandedView();
    const body = view.contentEl.createDiv({ cls: "ngb-filehist-body" });
    await view.renderCommitDiff(body, ENTRY);
    started.length = 0;

    await view.renderCommitDiff(body, ENTRY);
    expect(started).toEqual([]);
    expect(view.waitTicker).toBeNull();
  });
});
