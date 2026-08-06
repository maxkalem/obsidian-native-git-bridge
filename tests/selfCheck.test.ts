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
    expect(r.verdict).toContain("still queued");
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
