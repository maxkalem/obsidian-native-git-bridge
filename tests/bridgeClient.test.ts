import { describe, expect, it } from "vitest";
import { BridgeClient, CancelToken, idTimestampMs, type RuntimeFS } from "../src/bridge/BridgeClient";
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

// ------------------------------------------------------- recovery paths

describe("BridgeClient recovery paths", () => {
  it("keeps polling past a result file with a mismatched id (never consumes a stranger's result)", async () => {
    const fs = memFS();
    const c = client(fs, { t: 0 });
    fs.files.set(
      paths.resultFile("r-1T1Z-mine"),
      JSON.stringify({ protocolVersion: 1, id: "r-1T1Z-OTHER", action: "ping", ok: true, exitCode: 0 })
    );
    const outcome = await c.awaitResult("r-1T1Z-mine", 300);
    expect(outcome.kind).toBe("timeout");
  });

  it("honors cancellation raised mid-poll, not only upfront", async () => {
    const fs = memFS();
    const token = new CancelToken();
    let polls = 0;
    const c = new BridgeClient(fs, paths, {
      pollIntervalMs: 1,
      now: () => 0, // deadline never reached; only cancellation can end the loop
      sleep: async () => {
        polls++;
        if (polls === 3) token.cancel();
      },
    });
    const outcome = await c.awaitResult("r-1T1Z-mid", 10_000, token);
    expect(outcome.kind).toBe("cancelled");
    expect(polls).toBe(3);
  });

  it("sweeps queued requests, results, cancel flags and done archives — but never files with unparsable ids", async () => {
    const fs = memFS();
    const nowRef = { t: Date.parse("2026-08-05T00:00:00Z") };
    const c = client(fs, nowRef);
    // A request that never reached Termux must not linger (nor execute later).
    fs.files.set(paths.requestFile("r-20260801T000000Z-old"), "{}");
    fs.files.set(paths.resultFile("r-20260801T000000Z-old"), "{}");
    fs.files.set(paths.cancelFile("r-20260801T000000Z-old"), "");
    fs.files.set(`${paths.doneDir}/r-20260801T000000Z-old.json`, "{}");
    // A FRESH queued request must survive the sweep.
    fs.files.set(paths.requestFile("r-20260804T235900Z-new"), "{}");
    // A name the retention logic cannot date must never be deleted.
    fs.files.set(`${paths.resultsDir}/not-a-request-id.json`, "{}");
    fs.files.set(`${paths.doneDir}/invalid-1754300000.json`, "{}");
    const removed = await c.cleanupOld();
    expect(removed).toBe(4);
    expect(fs.files.has(paths.requestFile("r-20260804T235900Z-new"))).toBe(true);
    expect(fs.files.has(`${paths.resultsDir}/not-a-request-id.json`)).toBe(true);
    expect(fs.files.has(`${paths.doneDir}/invalid-1754300000.json`)).toBe(true);
  });

  it("sweeps stale progress streams, which nothing else would ever remove", async () => {
    // They deliberately outlive their request so a bundle shared afterwards can
    // carry them, so this is the only thing standing between the runtime folder
    // and one file per operation forever.
    const fs = memFS();
    const nowRef = { t: Date.parse("2026-08-05T00:00:00Z") };
    const c = client(fs, nowRef);
    fs.files.set(paths.progressFile("r-20260801T000000Z-old"), "fetching");
    fs.files.set(paths.progressFile("r-20260804T235900Z-new"), "fetching");
    const removed = await c.cleanupOld();
    expect(removed).toBe(1);
    expect(fs.files.has(paths.progressFile("r-20260804T235900Z-new"))).toBe(true);
  });

  it("reads the stream of a request in flight, and answers null when there is none", async () => {
    const fs = memFS();
    const c = client(fs, { t: 0 });
    // An older runner writes no stream, and a request rejected before it began
    // never gets one. Neither is a failure: the operation works without it.
    expect(await c.readProgress("r-20260805T100000Z-none")).toBeNull();
    fs.files.set(paths.progressFile("r-20260805T100000Z-live"), "sync: fetching from origin\n");
    expect(await c.readProgress("r-20260805T100000Z-live")).toContain("fetching from origin");
    // Present but empty is also nothing to show.
    fs.files.set(paths.progressFile("r-20260805T100000Z-blank"), "");
    expect(await c.readProgress("r-20260805T100000Z-blank")).toBeNull();
  });

  it("readProgress swallows a torn read rather than failing the operation", async () => {
    // The runner appends while this reads. A half-read is worth nothing and
    // worth no complaint either — the next poll is 400 ms away.
    const fs = memFS();
    const failing: RuntimeFS = { ...fs, read: async () => Promise.reject(new Error("EIO")) };
    fs.files.set(paths.progressFile("r-20260805T100000Z-torn"), "x");
    const c = client(failing, { t: 0 });
    await expect(c.readProgress("r-20260805T100000Z-torn")).resolves.toBeNull();
  });

  it("cleanupOld survives an unreadable directory and an fs.remove failure", async () => {
    const fs = memFS();
    const nowRef = { t: Date.parse("2026-08-05T00:00:00Z") };
    const failing: RuntimeFS = {
      ...fs,
      listFiles: async (p) => {
        if (p === paths.cancelDir) throw new Error("EACCES");
        return fs.listFiles(p);
      },
      remove: async (p) => {
        if (p.includes("stubborn")) throw new Error("EBUSY");
        return fs.remove(p);
      },
    };
    fs.files.set(paths.resultFile("r-20260801T000000Z-stubborn"), "{}");
    fs.files.set(paths.resultFile("r-20260801T000000Z-normal"), "{}");
    const c = new BridgeClient(failing, paths, { now: () => nowRef.t });
    const removed = await c.cleanupOld();
    expect(removed).toBe(1); // the stubborn file failed silently, the normal one went
    expect(fs.files.has(paths.resultFile("r-20260801T000000Z-stubborn"))).toBe(true);
  });

  it("lists orphaned results after a crash and skips corrupt ones", async () => {
    const fs = memFS();
    const c = client(fs, { t: 0 });
    await c.ensureRuntimeDirs(); // the results dir must exist to be scanned
    fs.files.set(
      paths.resultFile("r-20260804T100000Z-ok1"),
      JSON.stringify({ protocolVersion: 1, id: "r-20260804T100000Z-ok1", action: "sync", ok: true, exitCode: 0 })
    );
    fs.files.set(paths.resultFile("r-20260804T100001Z-bad"), "{ this is not json");
    fs.files.set(paths.resultFile("r-20260804T100002Z-shp"), '{"not":"a result shape"}');
    const orphans = await c.listOrphanResults();
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.id).toBe("r-20260804T100000Z-ok1");
  });

  it("returns no orphans when the results directory does not exist yet", async () => {
    const fs = memFS();
    const c = client(fs, { t: 0 });
    expect(await c.listOrphanResults()).toEqual([]);
    expect(await c.pendingRequestCount()).toBe(0);
  });

  it("consume is best-effort: an fs error removing one file does not abort the other", async () => {
    const fs = memFS();
    const failing: RuntimeFS = {
      ...fs,
      remove: async (p) => {
        if (p === paths.resultFile("r-1T1Z-c")) throw new Error("EBUSY");
        return fs.remove(p);
      },
    };
    fs.files.set(paths.resultFile("r-1T1Z-c"), "{}");
    fs.files.set(paths.cancelFile("r-1T1Z-c"), "");
    const c = new BridgeClient(failing, paths, {});
    await expect(c.consume("r-1T1Z-c")).resolves.toBeUndefined();
    expect(fs.files.has(paths.cancelFile("r-1T1Z-c"))).toBe(false);
  });

  it("submit creates the full runtime directory tree first", async () => {
    const fs = memFS();
    const made: string[] = [];
    const tracking: RuntimeFS = { ...fs, mkdir: async (p) => void made.push(p) };
    const c = new BridgeClient(tracking, paths, {});
    await c.submit(createRequest("ping", {}, "tok", 5, new Date("2026-08-03T10:00:00Z"), "dirs01"));
    for (const dir of paths.all()) expect(made).toContain(dir);
  });
});

describe("idTimestampMs", () => {
  it("extracts the embedded UTC timestamp", () => {
    expect(idTimestampMs("r-20260803T101500Z-ab12cd.json")).toBe(Date.parse("2026-08-03T10:15:00Z"));
  });
  it("pads a short (minutes-only) time field", () => {
    expect(idTimestampMs("r-20260803T1015Z-x")).toBe(Date.parse("2026-08-03T10:15:00Z"));
  });
  it("returns null for anything unparsable — retention must skip those files", () => {
    expect(idTimestampMs("not-a-request-id.json")).toBeNull();
    expect(idTimestampMs("invalid-1754300000.json")).toBeNull();
    expect(idTimestampMs("r-notadateTnotZ-x")).toBeNull();
    expect(idTimestampMs("")).toBeNull();
  });
  it("returns null for an impossible calendar date", () => {
    expect(idTimestampMs("r-20261399T000000Z-x")).toBeNull();
  });
});

function setTimeoutSim(fs: { files: Map<string, string> }, path: string, obj: unknown): void {
  // Written synchronously; poller sees it on its first check after submit.
  fs.files.set(path, JSON.stringify(obj));
}
