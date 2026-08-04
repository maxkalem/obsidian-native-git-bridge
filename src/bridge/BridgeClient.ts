import { POLL_INTERVAL_MS, RESULT_RETENTION_MS } from "../constants";
import type { BridgeRequest, BridgeResult } from "../types";
import { parseResult, serializeRequest } from "./protocol";
import type { RuntimePaths } from "./runtimePaths";

/** Filesystem abstraction over Vault.adapter, injectable for tests. */
export interface RuntimeFS {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** List a folder; returns vault-relative file paths (no folders). */
  listFiles(path: string): Promise<string[]>;
}

export class CancelToken {
  cancelled = false;
  cancel(): void {
    this.cancelled = true;
  }
}

export type AwaitOutcome =
  | { kind: "result"; result: BridgeResult }
  | { kind: "timeout" }
  | { kind: "cancelled" };

export class BridgeClient {
  constructor(
    private fs: RuntimeFS,
    private paths: RuntimePaths,
    private opts: {
      pollIntervalMs?: number;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private sleep(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    // window.setTimeout, not the bare global: Obsidian popout windows have
    // their own timer scope.
    return new Promise((r) => activeWindow.setTimeout(r, ms));
  }

  async ensureRuntimeDirs(): Promise<void> {
    for (const dir of this.paths.all()) {
      if (!(await this.fs.exists(dir))) await this.fs.mkdir(dir);
    }
  }

  /** Write the request file. Never composes shell strings; the runner reads JSON. */
  async submit(req: BridgeRequest): Promise<void> {
    await this.ensureRuntimeDirs();
    await this.fs.write(this.paths.requestFile(req.id), serializeRequest(req));
  }

  /**
   * Poll for the result until timeout or cancellation. Polling happens only
   * while an operation is in flight; nothing runs otherwise.
   */
  async awaitResult(id: string, timeoutMs: number, cancel?: CancelToken): Promise<AwaitOutcome> {
    const deadline = this.now() + timeoutMs;
    const interval = this.opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    const file = this.paths.resultFile(id);
    for (;;) {
      if (cancel?.cancelled) return { kind: "cancelled" };
      if (await this.fs.exists(file)) {
        const text = await this.fs.read(file);
        const result = parseResult(text);
        // null => partial/corrupt write; retry next tick.
        if (result && result.id === id) return { kind: "result", result };
      }
      if (this.now() >= deadline) return { kind: "timeout" };
      await this.sleep(interval);
    }
  }

  /** Signal cancellation: the runner skips not-yet-started requests. */
  async requestCancel(id: string): Promise<void> {
    await this.ensureRuntimeDirs();
    await this.fs.write(this.paths.cancelFile(id), "");
  }

  /** Remove a consumed result and its cancel flag. */
  async consume(id: string): Promise<void> {
    for (const f of [this.paths.resultFile(id), this.paths.cancelFile(id)]) {
      try {
        if (await this.fs.exists(f)) await this.fs.remove(f);
      } catch {
        /* best effort */
      }
    }
  }

  /** How many requests are queued and not processed yet (shown in diagnostics). */
  async pendingRequestCount(): Promise<number> {
    if (!(await this.fs.exists(this.paths.requestsDir))) return 0;
    return (await this.fs.listFiles(this.paths.requestsDir)).filter((f) => f.endsWith(".json")).length;
  }

  /**
   * Delete files older than the retention window, and orphaned results from a
   * previous session (recovery after Obsidian was killed mid-operation).
   * Age is derived from the timestamp embedded in the request id.
   */
  async cleanupOld(): Promise<number> {
    let removed = 0;
    const cutoff = this.now() - RESULT_RETENTION_MS;
    // requestsDir is swept too: a request that never reached Termux (companion
    // missing, transport broken) must not linger forever — and must certainly
    // not execute days later when a trigger finally succeeds.
    for (const dir of [
      this.paths.requestsDir,
      this.paths.resultsDir,
      this.paths.cancelDir,
      this.paths.doneDir,
    ]) {
      let files: string[];
      try {
        files = await this.fs.listFiles(dir);
      } catch {
        continue; // directory missing or unreadable
      }
      for (const f of files) {
        const ts = idTimestampMs(basename(f));
        if (ts !== null && ts < cutoff) {
          try {
            await this.fs.remove(f);
            removed++;
          } catch {
            /* best effort */
          }
        }
      }
    }
    return removed;
  }

  /** Collect results present on disk whose ids we did not consume (crash recovery). */
  async listOrphanResults(): Promise<BridgeResult[]> {
    if (!(await this.fs.exists(this.paths.resultsDir))) return [];
    const out: BridgeResult[] = [];
    for (const f of await this.fs.listFiles(this.paths.resultsDir)) {
      try {
        const r = parseResult(await this.fs.read(f));
        if (r) out.push(r);
      } catch {
        /* skip unreadable */
      }
    }
    return out;
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Extract the epoch ms from ids like r-20260803T101500Z-ab12cd (returns null if unparsable). */
export function idTimestampMs(fileName: string): number | null {
  const m = /^r-(\d{8})T(\d{4,6})Z?/.exec(fileName);
  if (!m) return null;
  const d = m[1]!;
  const t = (m[2]! + "00").slice(0, 6);
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
