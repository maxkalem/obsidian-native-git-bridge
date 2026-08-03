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

  it("detects the runtime-dir mismatch (no runner.log here at all)", async () => {
    const r = await runSelfCheck(
      fsWith({ [`${paths.requestsDir}/r-20260804T100000Z-a.json`]: "{}" }),
      paths,
      true
    );
    expect(r.ok).toBe(false);
    expect(r.runnerLogExists).toBe(false);
    expect(r.verdict).toContain("DIFFERENT folder");
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
