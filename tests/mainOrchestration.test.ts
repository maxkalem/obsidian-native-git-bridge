import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  __notices,
  __openedModals,
  __protocolHandlers,
  __resetObsidianMock,
  __setPlatformAndroid,
} from "./mocks/obsidian";
import NativeGitBridgePlugin from "../src/main";
import { BridgeClient } from "../src/bridge/BridgeClient";
import { RuntimePaths } from "../src/bridge/runtimePaths";

/**
 * Orchestration tests for the plugin entry (src/main.ts): the REAL plugin
 * class is instantiated against an in-memory vault adapter and a fake app,
 * and a fake "Termux runner" is wired through the actual transport seam
 * (window.open receives the companion URI, extracts the request id, and
 * writes the result file — exactly the contract the companion app + runner
 * fulfil in production). Nothing in src/ is modified or special-cased.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const paths = new RuntimePaths(".obsidian");

// ------------------------------------------------------------ fake vault fs

function memAdapter() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    exists: async (p: string) => files.has(p) || dirs.has(p),
    read: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error("ENOENT " + p);
      return v;
    },
    write: async (p: string, d: string) => void files.set(p, d),
    mkdir: async (p: string) => void dirs.add(p),
    remove: async (p: string) => void files.delete(p),
    list: async (p: string) => ({
      files: [...files.keys()].filter((f) => f.startsWith(p + "/")),
      folders: [],
    }),
  };
}

type MemAdapter = ReturnType<typeof memAdapter>;

function makeApp(adapter: MemAdapter): Any {
  let layoutReady: (() => void) | null = null;
  return {
    appId: "test-app-id",
    vault: {
      configDir: ".obsidian",
      adapter,
      getName: () => "TestVault",
      getAbstractFileByPath: () => null,
    },
    workspace: {
      onLayoutReady: (cb: () => void) => {
        layoutReady = cb;
      },
      fireLayoutReady: () => layoutReady?.(),
      getLeavesOfType: () => [],
      getRightLeaf: () => null,
      revealLeaf: () => undefined,
      getLeaf: () => ({ openFile: async () => undefined }),
      getActiveFile: () => null,
      on: () => ({}),
    },
  };
}

// ------------------------------------------------------- fake Termux runner

interface FakeRunner {
  /** URIs the transport opened (one per triggered request). */
  uris: string[];
  /** When set, called with the request id; may write a result file. */
  onTrigger: ((id: string) => void) | null;
}

function okStatusResult(id: string, runnerVersion = 3) {
  return JSON.stringify({
    protocolVersion: 1,
    id,
    action: "status",
    ok: true,
    exitCode: 0,
    runnerVersion,
    data: {
      branchInfo: "# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0",
      sparseEnabled: "true",
      sparseCone: "false",
      sparseList: "/*\n!Private/AgentsMemory/",
      skipWorktreeCount: "3900",
      lastCommit: "0123abc4567890def\t2026-08-01T10:00:00Z\tlast subject",
      remoteUrl: "https://***@example.com/vault.git",
    },
  });
}

// ------------------------------------------------------------- plugin setup

function installGlobals(runner: FakeRunner, adapter: MemAdapter): void {
  (globalThis as Any).window = {
    setInterval: (fn: Any, ms: Any) => setInterval(fn, ms),
    clearInterval: (id: Any) => clearInterval(id),
    setTimeout: (fn: Any, ms: Any) => setTimeout(fn, ms),
    clearTimeout: (id: Any) => clearTimeout(id),
    open: (uri: string) => {
      runner.uris.push(uri);
      const m = /id=([^&]+)/.exec(uri);
      if (m && runner.onTrigger) runner.onTrigger(decodeURIComponent(m[1]!));
      return {}; // truthy: the anchor-click fallback is not needed
    },
  };
  const visListeners = new Set<() => void>();
  (globalThis as Any).document = {
    visibilityState: "visible",
    addEventListener: (ev: string, cb: () => void) => {
      if (ev === "visibilitychange") visListeners.add(cb);
    },
    removeEventListener: (ev: string, cb: () => void) => {
      visListeners.delete(cb);
    },
    /** Test hook: simulate Android bringing another app to the front. */
    __goHidden: () => {
      (globalThis as Any).document.visibilityState = "hidden";
      for (const cb of [...visListeners]) cb();
    },
    createElement: () => ({ href: "", rel: "", click: () => undefined, remove: () => undefined }),
    body: { appendChild: () => undefined },
  };
  void adapter;
}

interface Harness {
  plugin: NativeGitBridgePlugin;
  adapter: MemAdapter;
  app: Any;
  runner: FakeRunner;
  /** Swap in a fast-polling client over the same adapter (no real 400ms sleeps). */
  useFastClient(opts?: { advancePerSleepMs?: number }): void;
}

async function loadPlugin(): Promise<Harness> {
  const adapter = memAdapter();
  const app = makeApp(adapter);
  const runner: FakeRunner = { uris: [], onTrigger: null };
  installGlobals(runner, adapter);
  const plugin = new (NativeGitBridgePlugin as Any)(app, {
    id: "native-git-bridge",
    name: "Native Git Bridge",
    version: "0.4.0",
  }) as NativeGitBridgePlugin;
  // Skip status bar & ribbon: they are cosmetic and DOM-heavy.
  (plugin as Any).__setData({ showStatusBar: false, showRibbonIcon: false });
  await plugin.onload();
  const fs = {
    exists: adapter.exists,
    read: adapter.read,
    write: adapter.write,
    mkdir: adapter.mkdir,
    remove: adapter.remove,
    listFiles: async (p: string) => (await adapter.list(p)).files,
  };
  return {
    plugin,
    adapter,
    app,
    runner,
    useFastClient(opts) {
      let now = 0;
      const advance = opts?.advancePerSleepMs ?? 5;
      plugin.client = new BridgeClient(fs, paths, {
        pollIntervalMs: 1,
        now: () => now,
        sleep: async () => {
          now += advance;
          await new Promise((r) => setImmediate(r));
        },
      });
    },
  };
}

async function enableBridge(h: Harness): Promise<void> {
  await h.plugin.updateDeviceSettings({
    enabledOnThisDevice: true,
    termuxIntegrationEnabled: true,
    authToken: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6",
  });
}

function requestFiles(adapter: MemAdapter): string[] {
  return [...adapter.files.keys()].filter((f) => f.startsWith(paths.requestsDir + "/"));
}
function resultFiles(adapter: MemAdapter): string[] {
  return [...adapter.files.keys()].filter((f) => f.startsWith(paths.resultsDir + "/"));
}
function cancelFiles(adapter: MemAdapter): string[] {
  return [...adapter.files.keys()].filter((f) => f.startsWith(paths.cancelDir + "/"));
}

// ------------------------------------------------------------------- tests

beforeAll(() => {
  // getLocalStorageBackend() probes globalThis.localStorage; absent in node,
  // so the store runs on its volatile in-memory fallback — deterministic.
});

beforeEach(() => {
  __resetObsidianMock();
});

describe("runOperation guards", () => {
  it("refuses on non-Android platforms even when fully configured (nothing to bridge to)", async () => {
    const h = await loadPlugin();
    await enableBridge(h); // fully paired and enabled…
    __setPlatformAndroid(false); // …but this is a desktop
    await h.plugin.cmdStatus(true);
    expect(__notices.join(" ")).toContain("Android only");
    expect(requestFiles(h.adapter)).toHaveLength(0);
    expect(h.runner.uris).toHaveLength(0);
  });

  it("refuses when the bridge is disabled on this device and queues nothing", async () => {
    const h = await loadPlugin();
    await h.plugin.cmdStatus(true);
    expect(__notices.join(" ")).toContain("disabled on this device");
    expect(requestFiles(h.adapter)).toHaveLength(0);
    expect(h.runner.uris).toHaveLength(0);
  });

  it("refuses without a pairing token", async () => {
    const h = await loadPlugin();
    await h.plugin.updateDeviceSettings({ enabledOnThisDevice: true, termuxIntegrationEnabled: true });
    await h.plugin.cmdStatus(true);
    expect(__notices.join(" ")).toContain("pairing token");
    expect(requestFiles(h.adapter)).toHaveLength(0);
  });

  it("refuses a mutating op while another mutating op holds the lock", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    expect(h.plugin.lock.tryAcquire("r-20260804T100000Z-busy", "sync")).toBe(true);
    await h.plugin.cmdPull(true); // pull is mutating
    expect(__notices.join(" ")).toContain("Another operation is running");
    expect(requestFiles(h.adapter)).toHaveLength(0);
    h.plugin.lock.release("r-20260804T100000Z-busy");
  });

  it("refuses a read-only op while a MUTATING op is in flight (but not vice versa)", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    expect(h.plugin.lock.tryAcquire("r-20260804T100001Z-busy", "sync")).toBe(true);
    await h.plugin.cmdStatus(true); // status is read-only
    expect(__notices.join(" ")).toContain("operation is running");
    expect(requestFiles(h.adapter)).toHaveLength(0);
    h.plugin.lock.release("r-20260804T100001Z-busy");
  });
});

describe("runOperation round trip through the transport seam", () => {
  it("submits, triggers the companion URI, polls, consumes, releases", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    // The fake runner answers synchronously when the companion URI arrives.
    h.runner.onTrigger = (id) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id));
    };
    await h.plugin.cmdStatus(false);
    // URI carried ONLY the encoded request id, from the default template.
    expect(h.runner.uris).toHaveLength(1);
    expect(h.runner.uris[0]).toMatch(/^nativegitbridge:\/\/run\?id=r-[0-9TZ]+-[a-z0-9]+$/);
    expect(h.runner.uris[0]).not.toContain("a1b2c3d4"); // never the token
    // Result consumed; nothing left behind; lock free; status modal shown.
    expect(resultFiles(h.adapter)).toHaveLength(0);
    expect(h.plugin.lock.active).toBeNull();
    expect(__openedModals).toContain("StatusModal");
  });

  it("warns exactly once when the runner is older than RUNNER_MIN_VERSION", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.runner.onTrigger = (id) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, 1)); // outdated runner
    };
    await h.plugin.cmdStatus(true);
    const first = __openedModals.filter((m) => m === "ResultModal").length;
    expect(first).toBe(1); // the "Termux runner is outdated" modal
    await h.plugin.cmdStatus(true);
    const second = __openedModals.filter((m) => m === "ResultModal").length;
    expect(second).toBe(1); // warned once per session, not per operation
  });

  it("on timeout writes the cancel flag (no late execution) and runs the local self-check", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ opTimeoutSeconds: 1 });
    h.useFastClient({ advancePerSleepMs: 10_000 }); // one sleep blows the deadline
    h.runner.onTrigger = null; // nobody answers
    await h.plugin.cmdStatus(true);
    // The request file stays for the runner to archive, but the cancel flag
    // guarantees it can never EXECUTE at some arbitrary later trigger.
    expect(requestFiles(h.adapter)).toHaveLength(1);
    expect(cancelFiles(h.adapter)).toHaveLength(1);
    // …and the local bridge check surfaced (it needs no Termux round trip).
    expect(__openedModals).toContain("ResultModal");
    expect(h.plugin.lock.active).toBeNull();
    // The companion setup checklist was opened to show which link is broken…
    expect(h.runner.uris).toContain("nativegitbridge://setup");
    // …but only once per session: a second timeout must not reopen it.
    await h.plugin.cmdStatus(true);
    expect(h.runner.uris.filter((u) => u === "nativegitbridge://setup")).toHaveLength(1);
    // Companion answered (app switch happened): drain the probe cleanly.
    (globalThis as Any).document.__goHidden();
    await new Promise((r) => setTimeout(r, 1));
  });

  it("offers the APK download link when the setup URI produces neither ack nor app switch", async () => {
    const h = await loadPlugin();
    h.plugin.companionProbeMs = 5; // nobody will answer
    await h.plugin.openCompanionSetup();
    expect(h.runner.uris).toContain("nativegitbridge://setup");
    expect(__openedModals).toContain("ConfirmModal");
  });

  it("treats the companion ack as proof of installation (no visibility change needed)", async () => {
    const h = await loadPlugin();
    h.plugin.companionProbeMs = 50;
    const p = h.plugin.openCompanionSetup();
    // The companion bounced obsidian://native-git-bridge-ack back through the
    // protocol handler the plugin registered in onload.
    __protocolHandlers.get("native-git-bridge-ack")!({ src: "setup" });
    await p;
    expect(__openedModals).not.toContain("ConfirmModal");
  });

  it("falls back to the app-switch signal for pre-ack companions", async () => {
    const h = await loadPlugin();
    h.plugin.companionProbeMs = 50;
    const p = h.plugin.openCompanionSetup();
    (globalThis as Any).document.__goHidden(); // old companion: opens, never acks
    await p;
    expect(__openedModals).not.toContain("ConfirmModal");
  });

  it("does not blame the companion for a timeout it acknowledged (runner-side break)", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ opTimeoutSeconds: 1 });
    h.useFastClient({ advancePerSleepMs: 10_000 });
    // Companion is alive and acks the trigger, but Termux never answers.
    h.runner.onTrigger = () => h.plugin.onCompanionAck("run");
    await h.plugin.cmdStatus(true);
    expect(h.runner.uris.filter((u) => u === "nativegitbridge://setup")).toHaveLength(0);
    expect(__openedModals).toContain("ResultModal"); // the local self-check still surfaced
  });

  it("cancellation writes the cancel flag for the runner and notifies", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient(); // now advances 5ms per sleep: deadline far away
    h.runner.onTrigger = null;
    const op = h.plugin.cmdStatus(true);
    await new Promise((r) => setImmediate(r)); // let the poll loop start
    await h.plugin.cmdCancel();
    await op;
    expect(cancelFiles(h.adapter)).toHaveLength(1);
    expect(__notices.join(" ")).toContain("cancelled");
    expect(h.plugin.lock.active).toBeNull();
  });
});

describe("startup reconciliation", () => {
  it("consumes a result that arrived while Obsidian was closed", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    const id = "r-20260804T090000Z-ghost1";
    h.plugin.store.setValue(
      "active-op",
      JSON.stringify({ id, action: "sync", startedAt: Date.now() - 60_000 })
    );
    h.adapter.files.set(paths.resultFile(id), okStatusResult(id));
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(resultFiles(h.adapter)).toHaveLength(0); // consumed, not leaked
    expect(h.plugin.store.getValue("active-op")).toBeNull(); // marker cleared
    const msgs = h.plugin.log.list().map((e) => e.message).join(" | ");
    expect(msgs).toContain("Recovered result");
  });

  it("clears a stale marker with no result (crash long ago)", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    const id = "r-20260804T000000Z-stale1";
    h.plugin.store.setValue(
      "active-op",
      JSON.stringify({ id, action: "push", startedAt: Date.now() - 3 * 60 * 60 * 1000 })
    );
    h.useFastClient(); // the 1ms "is a result present?" probe must not sleep 400ms for real
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.plugin.store.getValue("active-op")).toBeNull();
    const msgs = h.plugin.log.list().map((e) => e.message).join(" | ");
    expect(msgs).toContain("stale operation lock");
  });

  it("imports the installer's one-shot pairing.json and deletes it", async () => {
    const h = await loadPlugin();
    const pairingPath = `.obsidian/plugins/native-git-bridge/runtime/pairing.json`;
    h.adapter.files.set(
      pairingPath,
      JSON.stringify({ token: "f0e1d2c3b4a5968778695a4b3c2d1e0f", repoPath: "/storage/emulated/0/V" })
    );
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.plugin.deviceSettings.authToken).toBe("f0e1d2c3b4a5968778695a4b3c2d1e0f");
    expect(h.plugin.deviceSettings.termuxIntegrationEnabled).toBe(true);
    expect(h.adapter.files.has(pairingPath)).toBe(false); // one-shot: deleted
  });

  it("asks before replacing an EXISTING different token (no silent overwrite)", async () => {
    const h = await loadPlugin();
    await enableBridge(h); // token already set
    const pairingPath = `.obsidian/plugins/native-git-bridge/runtime/pairing.json`;
    h.adapter.files.set(pairingPath, JSON.stringify({ token: "ffffffffffffffffffffffffffffffff" }));
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.plugin.deviceSettings.authToken).toBe("a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6"); // unchanged
    expect(__openedModals).toContain("ConfirmModal");
  });
});

describe("sync on close (fire and forget)", () => {
  it("queues the request and triggers the transport without polling", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.runner.onTrigger = null; // nobody will ever answer — must not matter
    await (h.plugin as Any).queueSyncAndForget();
    expect(requestFiles(h.adapter)).toHaveLength(1);
    expect(h.runner.uris).toHaveLength(1);
    const req = JSON.parse([...h.adapter.files.values()].find((v) => v.includes('"sync"'))!);
    expect(req.action).toBe("sync");
    expect(req.args.protectedPaths).toEqual(["Private/AgentsMemory", "Projects/Backus"]);
  });

  it("respects the minimum auto-sync gap", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await (h.plugin as Any).queueSyncAndForget();
    await (h.plugin as Any).queueSyncAndForget(); // immediately again
    expect(requestFiles(h.adapter)).toHaveLength(1); // second one suppressed
  });
});
