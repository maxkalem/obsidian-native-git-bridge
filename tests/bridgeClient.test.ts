import { describe, expect, it } from "vitest";
import { BridgeClient, CancelToken, type RuntimeFS } from "../src/bridge/BridgeClient";
import { RuntimePaths } from "../src/bridge/runtimePaths";
import { createRequest } from "../src/bridge/protocol";

function memFS(): RuntimeFS & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    exists: async (p) => files.has(p) || dirs.has(p),
    read: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error("ENOENT " + p);
      return v;
    },
    write: async (p, d) => void files.set(p, d),
    mkdir: async (p) => void dirs.add(p),
    remove: async (p) => void files.delete(p),
    listFiles: async (p) => [...files.keys()].filter((f) => f.startsWith(p + "/")),
  };
}

const paths = new RuntimePaths(".obsidian");

function client(fs: RuntimeFS, nowRef: { t: number }) {
  return new BridgeClient(fs, paths, {
    pollIntervalMs: 1,
    now: () => nowRef.t,
    sleep: async () => {
      nowRef.t += 50;
    },
  });
}

describe("BridgeClient", () => {
  it("submits a request file and receives a result (full round trip)", async () => {
    const fs = memFS();
    const nowRef = { t: 0 };
    const c = client(fs, nowRef);
    const req = createRequest("ping", {}, "tok", 5, new Date("2026-08-03T10:00:00Z"), "aaa111");
    await c.submit(req);
    expect(fs.files.has(paths.requestFile(req.id))).toBe(true);

    // Simulate the Termux runner: write result after a few polls.
    setTimeoutSim(fs, paths.resultFile(req.id), {
      protocolVersion: 1, id: req.id, action: "ping", ok: true, exitCode: 0,
    });
    const outcome = await c.awaitResult(req.id, 5000);
    expect(outcome.kind).toBe("result");
    if (outcome.kind === "result") expect(outcome.result.ok).toBe(true);
    await c.consume(req.id);
    expect(fs.files.has(paths.resultFile(req.id))).toBe(false);
  });

  it("tolerates partially-written results and keeps polling", async () => {
    const fs = memFS();
    const nowRef = { t: 0 };
    const c = client(fs, nowRef);
    fs.files.set(paths.resultFile("r-1T1Z-x"), '{"protocolVersion":1,"id":"r-1T1Z-x"'); // partial
    const p = c.awaitResult("r-1T1Z-x", 400);
    // Complete the file before the deadline.
    fs.files.set(
      paths.resultFile("r-1T1Z-x"),
      JSON.stringify({ protocolVersion: 1, id: "r-1T1Z-x", action: "ping", ok: true, exitCode: 0 })
    );
    const outcome = await p;
    expect(outcome.kind).toBe("result");
  });

  it("times out when no result arrives", async () => {
    const fs = memFS();
    const c = client(fs, { t: 0 });
    const outcome = await c.awaitResult("r-1T1Z-y", 200);
    expect(outcome.kind).toBe("timeout");
  });

  it("honors cancellation", async () => {
    const fs = memFS();
    const c = client(fs, { t: 0 });
    const token = new CancelToken();
    token.cancel();
    const outcome = await c.awaitResult("r-1T1Z-z", 1000, token);
    expect(outcome.kind).toBe("cancelled");
  });

  it("cleans up files older than retention based on id timestamp", async () => {
    const fs = memFS();
    const nowRef = { t: Date.parse("2026-08-05T00:00:00Z") };
    const c = client(fs, nowRef);
    fs.files.set(paths.resultFile("r-20260801T000000Z-old"), "{}");
    fs.files.set(paths.resultFile("r-20260804T230000Z-new"), "{}");
    const removed = await c.cleanupOld();
    expect(removed).toBe(1);
    expect(fs.files.has(paths.resultFile("r-20260804T230000Z-new"))).toBe(true);
  });

  it("counts pending requests", async () => {
    const fs = memFS();
    const c = client(fs, { t: 0 });
    await c.submit(createRequest("status", {}, "tok", 5, new Date(), "p1"));
    await c.submit(createRequest("status", {}, "tok", 5, new Date(), "p2"));
    expect(await c.pendingRequestCount()).toBe(2);
  });
});

function setTimeoutSim(fs: { files: Map<string, string> }, path: string, obj: unknown): void {
  // Written synchronously; poller sees it on its first check after submit.
  fs.files.set(path, JSON.stringify(obj));
}
