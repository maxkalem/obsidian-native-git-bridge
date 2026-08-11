import { describe, expect, it } from "vitest";
import { runSelfCheck } from "../src/bridge/selfCheck";
import { RuntimePaths } from "../src/bridge/runtimePaths";
import type { RuntimeFS } from "../src/bridge/BridgeClient";

const paths = new RuntimePaths(".obsidian");

function fsWith(files: Record<string, string>): RuntimeFS {
  const dirs = new Set<string>();
  for (const f of Object.keys(files)) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    exists: async (p) => p in files || dirs.has(p),
    read: async (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p]!;
    },
    write: async () => {},
    mkdir: async () => {},
    remove: async () => {},
    listFiles: async (p) => Object.keys(files).filter((f) => f.startsWith(p + "/")),
  };
}

describe("runSelfCheck", () => {
  it("reports a healthy bridge", async () => {
    const r = await runSelfCheck(
      fsWith({ [`${paths.root}/runner.log`]: "2026-08-04 RUN no pending requests\n" }),
      paths,
      false
    );
    expect(r.ok).toBe(true);
    expect(r.runnerLogExists).toBe(true);
    expect(r.queuedRequests).toEqual([]);
  });

  /**
   * A timeout with a healthy folder and an empty queue is not a fault, and the
   * window has to say so in its first line. It used to open with "Runtime
   * folder looks healthy" and then offer 'Copy command & open Termux' — a
   * verdict that nothing is wrong, under a button that says reinstall the
   * runner. The user reads buttons as instructions.
   */
  it("names the timeout as the cause when nothing is stuck", async () => {
    const r = await runSelfCheck(
      fsWith({ [`${paths.root}/runner.log`]: "2026-08-09 RUN done\n" }),
      paths,
      true
    );
    expect(r.ok).toBe(true);
    expect(r.headline).toBe("Timed out — nothing is broken");
    expect(r.verdict).toContain("Operation timeout");
  });

  /**
   * A queued request under a short timeout is the ordinary case, not evidence
   * of a broken trigger. The verdict used to open with "the runner was not
   * triggered (companion permission / allow-external-apps)", which sent the
   * user to check permissions that were fine.
   */
  it("blames the timeout before the trigger when a request is still queued", async () => {
    const r = await runSelfCheck(
      fsWith({
        [`${paths.root}/runner.log`]: "x",
        [`${paths.root}/requests/r-1.json`]: "{}",
      }),
      paths,
      true
    );
    expect(r.headline).toBe("Still in the queue");
    const timeoutAt = r.verdict.indexOf("Operation timeout");
    const triggerAt = r.verdict.indexOf("trigger is not");
    expect(timeoutAt).toBeGreaterThan(-1);
    expect(triggerAt).toBeGreaterThan(timeoutAt);
  });

  it("gives every verdict a headline of its own", async () => {
    // The title is the cause, so two different causes may never share a title.
    const cases = await Promise.all([
      runSelfCheck(fsWith({}), paths, false),
      runSelfCheck(fsWith({ [`${paths.root}/requests/r-1.json`]: "{}" }), paths, false),
      runSelfCheck(fsWith({ [`${paths.root}/runner.log`]: "x" }), paths, false),
      runSelfCheck(fsWith({ [`${paths.root}/runner.log`]: "x" }), paths, true),
      runSelfCheck(
        fsWith({ [`${paths.root}/runner.log`]: "x", [`${paths.root}/requests/r-1.json`]: "{}" }),
        paths,
        true
      ),
    ]);
    const heads = cases.map((c) => c.headline);
    expect(new Set(heads).size).toBe(heads.length);
    for (const h of heads) {
      expect(h.length).toBeGreaterThan(0);
      // A modal header on a phone truncates past roughly thirty characters, and
      // a truncated title states less than a generic one would: the first
      // attempt showed "The plugin stopped waiting; the run.." on the device.
      expect(h.length).toBeLessThanOrEqual(30);
      expect(h.endsWith(".")).toBe(false);
    }
  });

  it("detects that no profile points at this vault (no runner.log here at all)", async () => {
    const r = await runSelfCheck(
      fsWith({ [`${paths.requestsDir}/r-20260804T100000Z-a.json`]: "{}" }),
      paths,
      true
    );
    expect(r.ok).toBe(false);
    expect(r.runnerLogExists).toBe(false);
    expect(r.verdict).toContain("no profile points at THIS vault");
    expect(r.verdict).toContain("Pair this vault");
  });

  it("reports a pairing request that Termux has not answered yet", async () => {
    const r = await runSelfCheck(
      fsWith({ [`${paths.root}/claim.json`]: '{"createdAt":"2026-08-05T10:00:00Z"}' }),
      paths,
      false
    );
    expect(r.claimPending).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain("waiting to be paired");
  });

  it("reads the profile marker the runner left behind", async () => {
    const r = await runSelfCheck(
      fsWith({
        [`${paths.root}/runner.log`]: "RUN\n",
        [`${paths.root}/profile.json`]: '{"profileId":"p-0011223344556677","repoDir":"/x"}',
      }),
      paths,
      false,
      "p-0011223344556677"
    );
    expect(r.markerProfileId).toBe("p-0011223344556677");
    expect(r.ok).toBe(true);
  });

  it("flags a vault whose runtime folder is served by a different profile", async () => {
    const r = await runSelfCheck(
      fsWith({
        [`${paths.root}/runner.log`]: "RUN\n",
        [`${paths.root}/profile.json`]: '{"profileId":"p-aaaaaaaabbbbbbbb","repoDir":"/x"}',
      }),
      paths,
      false,
      "p-0011223344556677"
    );
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain("p-aaaaaaaabbbbbbbb");
  });

  it("detects a stuck queue when the runner has written before", async () => {
    const r = await runSelfCheck(
      fsWith({
        [`${paths.root}/runner.log`]: "old entry\n",
        [`${paths.requestsDir}/r-20260804T100000Z-a.json`]: "{}",
      }),
      paths,
      true
    );
    expect(r.ok).toBe(false);
    expect(r.queuedRequests).toEqual(["r-20260804T100000Z-a.json"]);
    expect(r.headline).toBe("Still in the queue");
  });

  it("handles a missing runtime folder", async () => {
    const r = await runSelfCheck(fsWith({}), paths, false);
    expect(r.runtimeDirExists).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("truncates a long runner.log to a tail", async () => {
    const big = "x".repeat(10000) + "TAIL_MARKER";
    const r = await runSelfCheck(fsWith({ [`${paths.root}/runner.log`]: big }), paths, false);
    expect(r.runnerLogTail.length).toBeLessThanOrEqual(4000);
    expect(r.runnerLogTail).toContain("TAIL_MARKER");
  });
});
