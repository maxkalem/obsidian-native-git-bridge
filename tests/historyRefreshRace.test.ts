import { beforeEach, describe, expect, it } from "vitest";
import { __findAllByClass, __resetObsidianMock } from "./mocks/obsidian";
import { HistoryView, type HistoryViewActions } from "../src/ui/HistoryView";
import type { RepoLogEntry } from "../src/git/historyParsers";

/**
 * Refreshing the repository history while a page is still in flight.
 *
 * `refresh()` clears the list and calls `loadMore`, which returns immediately
 * because `loading` is still true. What happened then was not simply "an empty
 * panel with a spinner": the earlier request eventually landed in the OLD
 * invocation, which pushed its page into the freshly cleared `entries`, drew it
 * into the rebuilt list and advanced `skip` by its length. The user was shown
 * the page from BEFORE the refresh as the result of the refresh, and if the
 * in-flight load had been a later page, `skip` was left describing a first page
 * it was not.
 *
 * The rule this establishes is also the one the branch graph needs: a scope
 * change while a request is in flight must not start a second request. So the
 * fix does not race the two — it discards the stale page and reloads once the
 * runner has answered.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

(globalThis as Any).window = {
  setInterval: (fn: Any, ms: number) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id),
};

function entry(hash: string, subject: string): RepoLogEntry {
  return {
    hash,
    date: "2026-08-05T01:02:03+03:00",
    author: "maxkalem",
    subject,
    files: [],
  } as unknown as RepoLogEntry;
}

const STALE = [entry("aaaaaaa1", "before the refresh")];
const FRESH = [entry("bbbbbbb2", "after the refresh")];

/** A loadPage the test releases by hand, one page at a time. */
function gatedPages() {
  const releases: Array<(p: RepoLogEntry[] | null) => void> = [];
  const calls: number[] = [];
  const loadPage = (skip: number): Promise<RepoLogEntry[] | null> => {
    calls.push(skip);
    return new Promise<RepoLogEntry[] | null>((res) => releases.push(res));
  };
  return { loadPage, releases, calls };
}

function actions(over: Partial<HistoryViewActions> = {}): HistoryViewActions {
  return {
    loadPage: async () => [],
    openDiffAtCommit: () => undefined,
    openFile: () => undefined,
    progressText: () => "",
    treeView: () => false,
    toggleTree: () => undefined,
    openStatusPanel: () => undefined,
    ...over,
  };
}

/** Lets the awaited continuations after a resolve() actually run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("history panel, refresh while a page is in flight", () => {
  beforeEach(() => __resetObsidianMock());

  it("does not start a second request", async () => {
    const g = gatedPages();
    const view = new HistoryView(leaf, actions({ loadPage: g.loadPage })) as Any;
    view.renderShell();
    void view.refresh();
    expect(g.calls).toHaveLength(1);

    void view.refresh();
    await settle();
    // The runner has not answered yet, so nothing new may be asked of it.
    expect(g.calls).toHaveLength(1);

    g.releases[0]?.(STALE);
    await settle();
    // Now the queued refresh runs, and it asks for the FIRST page.
    expect(g.calls).toEqual([0, 0]);
  });

  it("discards the page that belongs to the list the refresh threw away", async () => {
    const g = gatedPages();
    const view = new HistoryView(leaf, actions({ loadPage: g.loadPage })) as Any;
    view.renderShell();
    void view.refresh();
    void view.refresh();
    await settle();

    g.releases[0]?.(STALE);
    await settle();
    expect(view.entries).toEqual([]);
    expect(view.skip).toBe(0);

    g.releases[1]?.(FRESH);
    await settle();
    expect(view.entries.map((e: RepoLogEntry) => e.hash)).toEqual(["bbbbbbb2"]);
    expect(view.skip).toBe(1);
  });

  it("draws only the refreshed commits, and leaves no spinner behind", async () => {
    const g = gatedPages();
    const view = new HistoryView(leaf, actions({ loadPage: g.loadPage })) as Any;
    view.renderShell();
    void view.refresh();
    void view.refresh();
    await settle();
    g.releases[0]?.(STALE);
    await settle();
    g.releases[1]?.(FRESH);
    await settle();

    // The identity, not just the count: before the fix exactly one row was
    // drawn here too — the stale one — so a length assertion passed while the
    // panel showed the wrong commit.
    expect(__findAllByClass(view.contentEl, "ngb-hist-commit")).toHaveLength(1);
    expect(
      __findAllByClass(view.contentEl, "ngb-hist-subject").map((e: Any) => e.textContent)
    ).toEqual(["after the refresh"]);
    expect(view.loading).toBe(false);
    expect(view.waitTicker).toBeNull();
    expect(__findAllByClass(view.contentEl, "ngb-filehist-waiting")).toHaveLength(0);
  });

  it("keeps the wait indicator up while the queued refresh waits its turn", async () => {
    // What the device showed: after the second tap the list was empty and
    // silent for the rest of the request in flight, which reads as a panel
    // that gave up. There must be exactly one indicator throughout, never two.
    const g = gatedPages();
    const view = new HistoryView(leaf, actions({ loadPage: g.loadPage })) as Any;
    view.renderShell();
    void view.refresh();
    expect(__findAllByClass(view.contentEl, "ngb-filehist-waiting")).toHaveLength(1);

    void view.refresh();
    await settle();
    expect(__findAllByClass(view.contentEl, "ngb-filehist-waiting")).toHaveLength(1);

    g.releases[0]?.(STALE);
    await settle();
    expect(__findAllByClass(view.contentEl, "ngb-filehist-waiting")).toHaveLength(1);

    g.releases[1]?.(FRESH);
    await settle();
    expect(__findAllByClass(view.contentEl, "ngb-filehist-waiting")).toHaveLength(0);
  });

  it("a later page still lands normally when no refresh interrupts it", async () => {
    // The guard must not cost the ordinary case: Load more after a first page.
    const g = gatedPages();
    const view = new HistoryView(leaf, actions({ loadPage: g.loadPage })) as Any;
    view.renderShell();
    void view.refresh();
    g.releases[0]?.(STALE);
    await settle();
    expect(view.entries.map((e: RepoLogEntry) => e.hash)).toEqual(["aaaaaaa1"]);

    void view.loadMore();
    g.releases[1]?.(FRESH);
    await settle();
    expect(view.entries.map((e: RepoLogEntry) => e.hash)).toEqual(["aaaaaaa1", "bbbbbbb2"]);
  });
});
