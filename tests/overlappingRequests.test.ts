import { beforeEach, describe, expect, it } from "vitest";
import { __resetObsidianMock } from "./mocks/obsidian";

/**
 * Two read-only requests overlapping.
 *
 * Seen on the device: refresh the panel, then open a file's diff while the
 * status is still in flight.
 *
 *     21:09:36  status     queued
 *     21:09:44  diff-file  queued      <- status still running
 *     21:09:48  status     finished
 *     21:09:54  diff-file  finished
 *
 * The overlap itself is by design and is safe — only a mutation takes the lock,
 * and the runner drains its queue one request at a time. What was not designed
 * for was the teardown. The display has ONE slot for the action, the path, the
 * progress line and the cancel token, and `finally` emptied all four
 * unconditionally, so the first answer to arrive left the panel idle over live
 * work and pointed Cancel at nothing.
 *
 * This is the ownership rule the three wait tickers were given in 0.6.3, one
 * level up: clear only what is still yours, and hand the slots to whatever is
 * still in flight rather than to nobody.
 *
 * The plugin's real `runOperation` needs a whole bridge to exercise, so what is
 * asserted here is the rule itself, against the same data structure.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface Slot {
  id: string;
  action: string;
  path: string | null;
  cancel: { id: string };
  startedAt: number;
}

/** The bookkeeping from `runOperation`, lifted out so the rule can be tested. */
class Slots {
  inFlight = new Map<string, Slot>();
  runningId: string | null = null;
  action: string | null = null;
  path: string | null = null;
  cancel: { id: string } | null = null;

  start(id: string, action: string, path: string | null, startedAt: number): void {
    this.inFlight.set(id, { id, action, path, cancel: { id }, startedAt });
    this.runningId = id;
    this.action = action;
    this.path = path;
    this.cancel = { id };
  }

  finish(id: string): void {
    this.inFlight.delete(id);
    if (this.runningId !== id) return;
    const next = [...this.inFlight.values()].pop();
    if (next === undefined) {
      this.runningId = null;
      this.action = null;
      this.path = null;
      this.cancel = null;
      return;
    }
    this.runningId = next.id;
    this.action = next.action;
    this.path = next.path;
    this.cancel = next.cancel;
  }
}

describe("two requests in flight at once", () => {
  beforeEach(() => __resetObsidianMock());

  it("does not go idle when the first of two answers", () => {
    const s = new Slots();
    s.start("r-status", "status", null, 0);
    s.start("r-diff", "diff-file", "Notes/a.md", 8000);

    s.finish("r-status");

    expect(s.runningId).toBe("r-diff");
    expect(s.action).toBe("diff-file");
    expect(s.path).toBe("Notes/a.md");
  });

  it("keeps the surviving request's cancel token", () => {
    // The sharpest half: Cancel used to become a no-op for the request that was
    // still running, because the finished one had nulled the token.
    const s = new Slots();
    s.start("r-status", "status", null, 0);
    s.start("r-diff", "diff-file", null, 8000);

    s.finish("r-status");

    expect(s.cancel).not.toBeNull();
    expect(s.cancel?.id).toBe("r-diff");
  });

  it("empties the slots only when nothing is left", () => {
    const s = new Slots();
    s.start("r-status", "status", null, 0);
    s.start("r-diff", "diff-file", null, 8000);
    s.finish("r-status");
    s.finish("r-diff");

    expect(s.runningId).toBeNull();
    expect(s.action).toBeNull();
    expect(s.cancel).toBeNull();
    expect(s.inFlight.size).toBe(0);
  });

  it("lets the owner leave first without disturbing the older one", () => {
    // The reverse order. The older request is still running, so the display
    // falls back to it rather than to nothing.
    const s = new Slots();
    s.start("r-status", "status", null, 0);
    s.start("r-diff", "diff-file", null, 8000);

    s.finish("r-diff");

    expect(s.runningId).toBe("r-status");
    expect(s.action).toBe("status");
  });

  it("a request that never owned the display cannot empty it", () => {
    const s = new Slots();
    s.start("r-a", "status", null, 0);
    s.start("r-b", "diff-file", null, 1000);
    s.start("r-c", "file-log", null, 2000);
    // The middle one answers: it owns nothing, so nothing moves.
    s.finish("r-b");
    expect(s.runningId).toBe("r-c");
    expect(s.action).toBe("file-log");
  });
});
