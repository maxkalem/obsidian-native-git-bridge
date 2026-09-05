import { describe, expect, it } from "vitest";
import { localWorkPending } from "../src/ops/autoSyncGate";

const clean = { ahead: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };

describe("localWorkPending", () => {
  it("declines the tick when nothing was edited and the last status is clean and pushed", () => {
    expect(localWorkPending({ editsSinceSync: false, status: clean })).toBe(false);
  });

  it("runs when Obsidian saw an edit since the last sync, whatever the old status says", () => {
    expect(localWorkPending({ editsSinceSync: true, status: clean })).toBe(true);
  });

  it("runs when the branch is ahead of its upstream: a commit the remote never got", () => {
    expect(localWorkPending({ editsSinceSync: false, status: { ...clean, ahead: 2 } })).toBe(true);
  });

  it("runs on any uncommitted change the last status recorded", () => {
    expect(localWorkPending({ editsSinceSync: false, status: { ...clean, staged: 1 } })).toBe(true);
    expect(localWorkPending({ editsSinceSync: false, status: { ...clean, unstaged: 1 } })).toBe(true);
    expect(localWorkPending({ editsSinceSync: false, status: { ...clean, untracked: 1 } })).toBe(true);
    expect(localWorkPending({ editsSinceSync: false, status: { ...clean, conflicted: 1 } })).toBe(true);
  });

  it("treats no status at all as unknown, not as nothing to send", () => {
    expect(localWorkPending({ editsSinceSync: false, status: null })).toBe(true);
  });

  it("does not run for changes the remote is ahead by: behind is a pull, not a sync", () => {
    // `behind` is deliberately not part of the evidence: the periodic sync
    // exists to get local work out, and pulling is the on-open action.
    expect(localWorkPending({ editsSinceSync: false, status: clean })).toBe(false);
  });
});
