import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  __notices,
  __openedModals,
  __protocolHandlers,
  __resetObsidianMock,
  __setPlatformAndroid,
} from "./mocks/obsidian";
import NativeGitBridgePlugin, { compareVersions } from "../src/main";
import { RUNNER_MIN_VERSION } from "../src/constants";
import { BridgeClient } from "../src/bridge/BridgeClient";
import { RuntimePaths } from "../src/bridge/runtimePaths";
import { validateRemoteUrl } from "../src/git/remoteUrl";

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
  const trashed: string[] = [];
  return {
    files,
    dirs,
    trashed,
    stat: async (p: string) => {
      if (files.has(p)) return { type: "file" as const };
      if (dirs.has(p) || [...files.keys()].some((f) => f.startsWith(p + "/"))) {
        return { type: "folder" as const };
      }
      return null;
    },
    /** Obsidian's "move to .trash"; a path that is not there throws, as it does in the app. */
    trashLocal: async (p: string) => {
      const isFolder = dirs.has(p) || [...files.keys()].some((f) => f.startsWith(p + "/"));
      if (!files.has(p) && !isFolder) throw new Error("ENOENT " + p);
      trashed.push(p);
      files.delete(p);
      dirs.delete(p);
      for (const f of [...files.keys()]) if (f.startsWith(p + "/")) files.delete(f);
    },
    rmdir: async (p: string, recursive: boolean) => {
      if (!recursive) throw new Error("non-recursive rmdir not used");
      dirs.delete(p);
      for (const f of [...files.keys()]) if (f.startsWith(p + "/")) files.delete(f);
    },
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
      folders: [...dirs].filter((d) => d.startsWith(p + "/") && !d.slice(p.length + 1).includes("/")),
    }),
  };
}

type MemAdapter = ReturnType<typeof memAdapter>;

function makeApp(adapter: MemAdapter): Any {
  let layoutReady: (() => void) | null = null;
  const fileMenuHandlers: Array<(menu: Any, file: Any) => void> = [];
  /** Every pane the plugin opened: { type, state }. */
  const openedViews: Array<{ type: string; state?: Any }> = [];
  let activeFile: Any = null;
  return {
    openedViews,
    setActiveFile: (path: string) => {
      activeFile = { path };
    },
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
      getLeaf: () => ({
        openFile: async () => undefined,
        setViewState: async (st: Any) => void openedViews.push({ type: st.type, state: st.state }),
      }),
      getActiveFile: () => activeFile,
      on: (name: string, cb: Any) => {
        if (name === "file-menu") fileMenuHandlers.push(cb);
        return {};
      },
      /** Test hook: simulate a right click / long tap; returns the item titles. */
      fireFileMenu: (path: string): string[] => {
        const titles: string[] = [];
        const menu = {
          addItem: (fn: (i: Any) => void) => {
            const item: Any = {
              setTitle: (t: string) => {
                titles.push(t);
                return item;
              },
              setIcon: () => item,
              onClick: () => item,
            };
            fn(item);
            return menu;
          },
        };
        for (const h of fileMenuHandlers) h(menu, { path });
        return titles;
      },
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

function okStatusResult(id: string, runnerVersion = 4) {
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
      sparseList: "/*\n!Private/Hidden/",
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

  it("refuses when the bridge is disabled on this device and shows the setup guide", async () => {
    const h = await loadPlugin();
    await h.plugin.cmdStatus(true);
    // A dead-end notice would leave a fresh install stuck; the guide names the
    // companion app and Termux and offers one-tap actions.
    expect(__openedModals).toContain("ResultModal");
    expect(requestFiles(h.adapter)).toHaveLength(0);
    expect(h.runner.uris).toHaveLength(0);
  });

  it("refuses without a pairing token and shows the setup guide", async () => {
    const h = await loadPlugin();
    await h.plugin.updateDeviceSettings({ enabledOnThisDevice: true, termuxIntegrationEnabled: true });
    await h.plugin.cmdStatus(true);
    expect(__openedModals).toContain("ResultModal");
    expect(requestFiles(h.adapter)).toHaveLength(0);
  });

  it("shows the setup guide once on a fresh unpaired install, not on later starts", async () => {
    const h = await loadPlugin();
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(__openedModals.filter((m) => m === "ResultModal")).toHaveLength(1);
    // Second start (same device store): no repeat.
    __openedModals.length = 0;
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(__openedModals).toHaveLength(0);
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
    expect(h.runner.uris.some((u: string) => u.startsWith("nativegitbridge://setup"))).toBe(true);
    // …but only once per session: a second timeout must not reopen it.
    await h.plugin.cmdStatus(true);
    // The URI carries display-only version params (pv/rv/rmin), never content.
    const setupUris = h.runner.uris.filter((u: string) => u.startsWith("nativegitbridge://setup"));
    expect(setupUris).toHaveLength(1);
    expect(setupUris[0]).toMatch(/[?&]pv=/);
    expect(setupUris[0]).not.toContain("a1b2c3d4"); // never the token
    // Companion answered (app switch happened): drain the probe cleanly.
    (globalThis as Any).document.__goHidden();
    await new Promise((r) => setTimeout(r, 1));
  });

  it("offers the APK download link when the setup URI produces neither ack nor app switch", async () => {
    const h = await loadPlugin();
    h.plugin.companionProbeMs = 5; // nobody will answer
    await h.plugin.openCompanionSetup();
    expect(h.runner.uris.some((u: string) => u.startsWith("nativegitbridge://setup"))).toBe(true);
    // A ResultModal with copy/open actions (a plain confirm cannot offer both).
    expect(__openedModals).toContain("ResultModal");
  });

  it("treats the companion ack as proof of installation (no visibility change needed)", async () => {
    const h = await loadPlugin();
    h.plugin.companionProbeMs = 50;
    const p = h.plugin.openCompanionSetup();
    // The companion bounced obsidian://native-git-bridge-ack back through the
    // protocol handler the plugin registered in onload.
    __protocolHandlers.get("native-git-bridge-ack")!({ src: "setup" });
    await p;
    expect(__openedModals).not.toContain("ResultModal"); // no "not installed?" hint
  });

  it("records Termux availability reported inside the companion ack", async () => {
    const h = await loadPlugin();
    expect(h.plugin.lastAckTermuxInstalled).toBeNull();
    __protocolHandlers.get("native-git-bridge-ack")!({ src: "run", termux: "0" });
    expect(h.plugin.lastAckTermuxInstalled).toBe(false);
    __protocolHandlers.get("native-git-bridge-ack")!({ src: "run", termux: "1" });
    expect(h.plugin.lastAckTermuxInstalled).toBe(true);
  });

  it("falls back to the app-switch signal for pre-ack companions", async () => {
    const h = await loadPlugin();
    h.plugin.companionProbeMs = 50;
    const p = h.plugin.openCompanionSetup();
    (globalThis as Any).document.__goHidden(); // old companion: opens, never acks
    await p;
    expect(__openedModals).not.toContain("ResultModal"); // no "not installed?" hint
  });

  it("does not blame the companion for a timeout it acknowledged (runner-side break)", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ opTimeoutSeconds: 1 });
    h.useFastClient({ advancePerSleepMs: 10_000 });
    // Companion is alive and acks the trigger, but Termux never answers.
    h.runner.onTrigger = () => h.plugin.onCompanionAck("run");
    await h.plugin.cmdStatus(true);
    expect(h.runner.uris.filter((u: string) => u.startsWith("nativegitbridge://setup"))).toHaveLength(0);
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

describe("several vaults on one device (profiles)", () => {
  it("names its profile in every request once it knows it", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ profileId: "p-0011223344556677" });
    h.useFastClient();
    let sent: Any = null;
    h.runner.onTrigger = (id) => {
      sent = JSON.parse(h.adapter.files.get(paths.requestFile(id))!);
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, RUNNER_MIN_VERSION));
    };
    await h.plugin.cmdStatus(true);
    expect(sent.profileId).toBe("p-0011223344556677");
    // Still no repository path anywhere in the request: the runner looks the
    // profile up, it never accepts a directory from the plugin.
    expect(JSON.stringify(sent)).not.toContain("/storage/");
  });

  it("omits the profile field while this vault has not learned its id", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    let sent: Any = null;
    h.runner.onTrigger = (id) => {
      sent = JSON.parse(h.adapter.files.get(paths.requestFile(id))!);
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, RUNNER_MIN_VERSION));
    };
    await h.plugin.cmdStatus(true);
    expect("profileId" in sent).toBe(false);
  });

  it("learns its profile from the first result that carries one", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.runner.onTrigger = (id) => {
      const r = JSON.parse(okStatusResult(id, RUNNER_MIN_VERSION));
      r.profileId = "p-aabbccdd11223344";
      h.adapter.files.set(paths.resultFile(id), JSON.stringify(r));
    };
    await h.plugin.cmdStatus(true);
    expect(h.plugin.deviceSettings.profileId).toBe("p-aabbccdd11223344");
  });

  it("never re-points itself at a different profile", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ profileId: "p-0011223344556677" });
    h.useFastClient();
    h.runner.onTrigger = (id) => {
      const r = JSON.parse(okStatusResult(id, RUNNER_MIN_VERSION));
      r.profileId = "p-ffffffffffffffff";
      h.adapter.files.set(paths.resultFile(id), JSON.stringify(r));
    };
    await h.plugin.cmdStatus(true);
    expect(h.plugin.deviceSettings.profileId).toBe("p-0011223344556677");
  });

  it("imports the profile id together with the token from a pairing file", async () => {
    const h = await loadPlugin();
    h.adapter.files.set(
      `${paths.root}/pairing.json`,
      JSON.stringify({
        token: "b1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6",
        repoPath: "/storage/emulated/0/Work",
        profileId: "p-1234567890abcdef",
      })
    );
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.plugin.deviceSettings.authToken).toBe("b1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6");
    expect(h.plugin.deviceSettings.profileId).toBe("p-1234567890abcdef");
    expect(h.adapter.files.has(`${paths.root}/pairing.json`)).toBe(false);
  });

  it("asks Termux for a profile of its own: claim out, pairing in, no secret sent", async () => {
    const h = await loadPlugin();
    __setPlatformAndroid(true);
    await h.plugin.updateDeviceSettings({ enabledOnThisDevice: true, termuxIntegrationEnabled: true });
    h.plugin.pairingPollMs = 1;
    h.plugin.pairingWaitMs = 200;
    h.runner.onTrigger = () => {
      // What the claim file may contain: no token, no path of ours.
      const claim = JSON.parse(h.adapter.files.get(`${paths.root}/claim.json`)!);
      expect(claim.token).toBeUndefined();
      // Termux answers with a token IT generated.
      h.adapter.files.set(
        `${paths.root}/pairing.json`,
        JSON.stringify({ token: "c1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6", profileId: "p-5566778899aabbcc" })
      );
    };
    await h.plugin.cmdPairThisVault();
    expect(h.runner.uris.some((u) => u.startsWith("nativegitbridge://run?id="))).toBe(true);
    expect(h.plugin.deviceSettings.authToken).toBe("c1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6");
    expect(h.plugin.deviceSettings.profileId).toBe("p-5566778899aabbcc");
    expect(h.adapter.files.has(`${paths.root}/claim.json`)).toBe(false);
  });

  it("leaves the pairing request in place when Termux does not answer", async () => {
    const h = await loadPlugin();
    __setPlatformAndroid(true);
    h.plugin.pairingPollMs = 1;
    h.plugin.pairingWaitMs = 20;
    await h.plugin.cmdPairThisVault();
    expect(h.adapter.files.has(`${paths.root}/claim.json`)).toBe(true);
    expect(h.plugin.deviceSettings.authToken).toBe("");
  });
});

describe("one surface per question (no legacy modals)", () => {
  /**
   * History and diffs used to have two UIs: panes (diff2html, display
   * preferences, per-block restore) from the context menu, and plainer modals
   * from the command palette. Every entry point now opens the pane.
   */
  it("'Show diff for current file' opens the diff PANE", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.app.setActiveFile("Notes/a.md");
    await h.plugin.cmdDiffCurrentFile();
    expect(h.app.openedViews.map((v: Any) => v.type)).toContain("native-git-bridge-diff");
    expect(h.app.openedViews[0].state).toMatchObject({ path: "Notes/a.md", from: "HEAD", to: "WORKTREE" });
    expect(__openedModals).not.toContain("DiffModal");
  });

  it("the history / view-at-commit / restore commands all open the file history PANEL", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.app.setActiveFile("Notes/a.md");
    h.plugin.cmdFileHistory();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.app.openedViews.map((v: Any) => v.type)).toEqual(["native-git-bridge-file-history"]);
    expect(h.app.openedViews[0].state).toMatchObject({ path: "Notes/a.md" });
  });

  it("says so instead of opening anything when there is no active file", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.plugin.cmdFileHistory();
    await h.plugin.cmdDiffCurrentFile();
    expect(h.app.openedViews).toHaveLength(0);
    expect(__notices.join(" ")).toContain("No active file");
  });
});

describe("repository bootstrap", () => {
  /** Answer the next request with this result body (built from the request). */
  function answerWith(h: Harness, build: (req: Any) => Any): void {
    h.runner.onTrigger = (id) => {
      const req = JSON.parse(h.adapter.files.get(paths.requestFile(id))!);
      h.adapter.files.set(
        paths.resultFile(id),
        JSON.stringify({
          protocolVersion: 1,
          id,
          action: req.action,
          runnerVersion: RUNNER_MIN_VERSION,
          ...build(req),
        })
      );
    };
  }

  it("tells Termux the vault still needs a repository when it pairs", async () => {
    const h = await loadPlugin();
    __setPlatformAndroid(true);
    h.plugin.pairingPollMs = 1;
    h.plugin.pairingWaitMs = 10;
    await h.plugin.cmdPairThisVault();
    const claim = JSON.parse(h.adapter.files.get(`${paths.root}/claim.json`)!);
    expect(claim.bootstrap).toBe(true);
  });

  it("does not ask for bootstrap when the vault already has a .git", async () => {
    const h = await loadPlugin();
    __setPlatformAndroid(true);
    h.adapter.dirs.add(".git");
    h.plugin.pairingPollMs = 1;
    h.plugin.pairingWaitMs = 10;
    await h.plugin.cmdPairThisVault();
    const claim = JSON.parse(h.adapter.files.get(`${paths.root}/claim.json`)!);
    expect(claim.bootstrap).toBe(false);
  });

  it("gives a clone the network's budget, not the ordinary one", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient({ advancePerSleepMs: 100000 });
    let sent: Any = null;
    answerWith(h, (req) => {
      sent = req;
      return { ok: true, exitCode: 0, data: { cloned: "true", branch: "main" } };
    });
    await (h.plugin as Any).runClone("https://example.com/v.git");
    expect(sent.action).toBe("clone-into-vault");
    expect(sent.timeoutSeconds).toBe(900);
    // A normal action keeps the ordinary budget.
    await h.plugin.cmdStatus(true);
    expect(sent.timeoutSeconds).toBe(h.plugin.deviceSettings.opTimeoutSeconds);
  });

  it("never sends a URL the rules refuse (no round trip at all)", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    // The prompt is a modal; go through the same validation the prompt uses.
    const bad = ["https://user:pw@example.com/v.git", "-oProxyCommand=id", "ext::sh -c id"];
    for (const url of bad) {
      expect(validateRemoteUrl(url).ok, url).toBe(false);
    }
    expect(h.runner.uris).toHaveLength(0);
  });

  it("clones in ONE call and never asks a blind keep-mine-or-theirs question", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    const sent: Any[] = [];
    answerWith(h, (req) => {
      sent.push(req);
      return {
        ok: true,
        exitCode: 0,
        data: { cloned: "true", branch: "main", collisions: "Notes/a.md\n.obsidian/app.json\n" },
      };
    });
    await (h.plugin as Any).runClone("https://example.com/v.git");
    // One request, no onCollision argument, no second attempt: the vault's own
    // versions are kept and become ordinary local changes to review.
    expect(sent).toHaveLength(1);
    expect(sent[0].args).toEqual({ url: "https://example.com/v.git" });
    expect(__openedModals).toContain("ResultModal");
  });

  it("reports an init that created the repository but could not commit", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      data: { initialised: "true", branch: "main", committed: "false" },
      error: {
        code: "GIT_FAILED",
        message: "The repository was created (main). The first commit was not made: git user.name…",
      },
    }));
    const result = await (h.plugin as Any).runOperation("init-repo", { branch: "main", initialCommit: true });
    expect(result.ok).toBe(false);
    expect(result.data.initialised).toBe("true");
  });
});

describe("a repository set aside by a re-clone", () => {
  const manifest = (dir: string, sizeKb = 188416) =>
    JSON.stringify({
      dir,
      createdAt: "2026-08-07T10:15:00Z",
      sizeKb,
      commits: 1240,
      branch: "main",
      lastCommit: "abc1234 2026-08-01 fix typo",
    });

  it("is found from its manifest, without walking the directory", async () => {
    const h = await loadPlugin();
    h.adapter.files.set(`${paths.root}/previous-git-20260807T101500Z.json`, manifest("previous-git-20260807T101500Z"));
    // A large tree that must never be read to answer the question.
    for (let i = 0; i < 50; i++) {
      h.adapter.files.set(`${paths.root}/previous-git-20260807T101500Z/objects/pack/p${i}.pack`, "x");
    }
    const repos = await h.plugin.listPreviousRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ dir: "previous-git-20260807T101500Z", commits: 1240 });
  });

  it("reminds once, then stays quiet for the rest of the day", async () => {
    const h = await loadPlugin();
    h.adapter.files.set(`${paths.root}/previous-git-20260807T101500Z.json`, manifest("previous-git-20260807T101500Z"));
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 5));
    const first = __openedModals.filter((m) => m === "ResultModal").length;
    expect(first).toBeGreaterThan(0);
    expect(h.plugin.deviceSettings.previousRepoRemindedAt).toBeGreaterThan(0);
    __openedModals.length = 0;
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 5));
    expect(__openedModals).toHaveLength(0);
  });

  it("says nothing at all when nothing was set aside", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 5));
    expect(h.plugin.deviceSettings.previousRepoRemindedAt).toBe(0);
  });

  it("never mentions one the user has dismissed", async () => {
    const h = await loadPlugin();
    await h.plugin.updateDeviceSettings({ previousRepoDismissed: ["previous-git-20260807T101500Z"] });
    h.adapter.files.set(`${paths.root}/previous-git-20260807T101500Z.json`, manifest("previous-git-20260807T101500Z"));
    h.app.workspace.fireLayoutReady();
    await new Promise((r) => setTimeout(r, 5));
    expect(h.plugin.deviceSettings.previousRepoRemindedAt).toBe(0);
  });
});

describe("sparse safety: moving the listed files to the trash", () => {
  it("moves EVERY listed file, not just the first one", async () => {
    const h = await loadPlugin();
    h.adapter.files.set("Private/Hidden/a.md", "a");
    h.adapter.files.set("Private/Hidden/b.md", "b");
    h.adapter.files.set("Private/Hidden/c.md", "c");
    const res = await (h.plugin as Any).trashAll([
      "Private/Hidden/a.md",
      "Private/Hidden/b.md",
      "Private/Hidden/c.md",
    ]);
    expect(res.moved).toBe(3);
    expect(res.failed).toEqual([]);
    expect(h.adapter.trashed).toHaveLength(3);
  });

  it("expands a collapsed 'dir/' entry into the files inside it", async () => {
    // git status reports a fully untracked directory as ONE line ending in
    // "/", which is what made the old loop delete a single entry.
    const h = await loadPlugin();
    h.adapter.dirs.add("Private/Hidden/New Notes");
    h.adapter.files.set("Private/Hidden/New Notes/one.md", "1");
    h.adapter.files.set("Private/Hidden/New Notes/two.md", "2");
    const res = await (h.plugin as Any).trashAll(["Private/Hidden/New Notes/"]);
    expect(res.failed).toEqual([]);
    expect(h.adapter.trashed).toContain("Private/Hidden/New Notes/one.md");
    expect(h.adapter.trashed).toContain("Private/Hidden/New Notes/two.md");
    // The files go first, the emptied folder last.
    expect(h.adapter.trashed[h.adapter.trashed.length - 1]).toBe("Private/Hidden/New Notes");
    expect([...h.adapter.files.keys()].some((f) => f.startsWith("Private/Hidden/New Notes"))).toBe(false);
  });

  it("reports what it could not move instead of counting it as done", async () => {
    const h = await loadPlugin();
    h.adapter.files.set("Private/Hidden/a.md", "a");
    const res = await (h.plugin as Any).trashAll(["Private/Hidden/a.md", "Private/Hidden/gone.md"]);
    expect(res.moved).toBe(1);
    // The missing one is not on disk afterwards either, so it is not a failure.
    expect(res.failed).toEqual([]);
  });

  it("never trashes the same path twice", async () => {
    const h = await loadPlugin();
    h.adapter.dirs.add("Private/Hidden/New");
    h.adapter.files.set("Private/Hidden/New/one.md", "1");
    const res = await (h.plugin as Any).trashAll([
      "Private/Hidden/New/",
      "Private/Hidden/New",
      "Private/Hidden/New/one.md",
    ]);
    expect(res.failed).toEqual([]);
    expect(h.adapter.trashed.filter((p: string) => p === "Private/Hidden/New/one.md")).toHaveLength(1);
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

describe("protected paths derived from sparse", () => {
  it("absorbs sparse exclusions from a status round trip into the effective protected set", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.runner.onTrigger = (id) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id)); // sparseList: /* + !Private/Hidden/
    };
    expect(h.plugin.effectiveProtectedPaths()).toEqual([]);
    await h.plugin.cmdStatus(true);
    expect(h.plugin.effectiveProtectedPaths()).toEqual(["Private/Hidden"]);
    // The derived set survives a reload (persisted device-locally, protection
    // must hold before the first fresh status).
    expect(h.plugin.deviceSettings.derivedProtectedPaths).toEqual(["Private/Hidden"]);
    // Manual paths merge in on top, deduplicated.
    await h.plugin.updateDeviceSettings({ protectedPaths: ["Manual/Pin", "Private/Hidden"] });
    expect(h.plugin.effectiveProtectedPaths()).toEqual(["Manual/Pin", "Private/Hidden"]);
    // Turning auto-protect off leaves only manual pins.
    await h.plugin.updateDeviceSettings({ autoProtectSparse: false });
    expect(h.plugin.effectiveProtectedPaths()).toEqual(["Manual/Pin", "Private/Hidden"]);
    await h.plugin.updateDeviceSettings({ protectedPaths: ["Manual/Pin"] });
    expect(h.plugin.effectiveProtectedPaths()).toEqual(["Manual/Pin"]);
  });
});

describe("version advice across the three parts", () => {
  it("stays silent when everything matches", async () => {
    const h = await loadPlugin();
    // manifest version in the harness is 0.4.0; make the companion match and
    // the runner the expected one.
    h.plugin.onCompanionAck("run", "1", "0.4.0");
    h.plugin.lastRunnerVersion = RUNNER_MIN_VERSION;
    expect(h.plugin.versionAdvice()).toEqual([]);
  });

  it("tells the user to update the PLUGIN when the companion is newer", async () => {
    const h = await loadPlugin();
    h.plugin.onCompanionAck("run", "1", "9.9.9");
    const advice = h.plugin.versionAdvice();
    expect(advice.map((a) => a.part)).toContain("plugin");
    expect(advice.find((a) => a.part === "plugin")!.text).toMatch(/OLDER than the companion/);
  });

  it("tells the user to update the COMPANION when it is older", async () => {
    const h = await loadPlugin();
    h.plugin.onCompanionAck("run", "1", "0.1.0");
    const advice = h.plugin.versionAdvice();
    expect(advice.map((a) => a.part)).toContain("companion");
  });

  it("tells the user to re-run the Termux installer for a mismatched runner", async () => {
    const h = await loadPlugin();
    h.plugin.lastRunnerVersion = 3; // older than RUNNER_MIN_VERSION
    const runner = h.plugin.versionAdvice().find((a) => a.part === "runner");
    expect(runner!.text).toMatch(/Re-run the install command in Termux/);
    // A newer-than-expected runner points at the plugin instead.
    h.plugin.lastRunnerVersion = 99;
    expect(h.plugin.versionAdvice().find((a) => a.part === "runner")!.text).toMatch(/NEWER/);
  });

  it("says nothing about the runner before one has ever answered", async () => {
    const h = await loadPlugin();
    expect(h.plugin.lastRunnerVersion).toBe(0);
    expect(h.plugin.versionAdvice().some((a) => a.part === "runner")).toBe(false);
  });
});

describe("outdated runner", () => {
  it("refuses v4-only actions up front with a fix button, spending no round trip", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.plugin.lastRunnerVersion = 3; // pre-config-management runner
    // "un-hide" takes no confirmation, so this reaches the guard directly.
    await h.plugin.cmdSparseExclude("Notes/Sub", false);
    expect(__openedModals).toContain("ResultModal");
    expect(requestFiles(h.adapter)).toHaveLength(0); // never queued
    expect(h.runner.uris).toHaveLength(0); // never triggered
  });

  it("still allows the ordinary actions an old runner does support", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.plugin.lastRunnerVersion = 3;
    h.useFastClient();
    h.runner.onTrigger = (id) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, 3));
    };
    await h.plugin.cmdStatus(true);
    expect(h.runner.uris.some((u: string) => u.includes("run?id="))).toBe(true);
  });
});

describe("compareVersions", () => {
  it("orders dotted numeric versions and tolerates junk", () => {
    expect(compareVersions("0.5.2", "0.5.2")).toBe(0);
    expect(compareVersions("0.5.1", "0.5.2")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("junk", "0.0.0")).toBe(0); // never invents a mismatch
  });
});

describe("file context menu", () => {
  it("works for folders and shows exactly one of Add/Remove per group, by state", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.runner.onTrigger = (id) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id));
    };
    await h.plugin.cmdStatus(true); // derives the Private/Hidden sparse exclusion
    // A FOLDER that is currently sparse-hidden:
    const titles = h.app.workspace.fireFileMenu("Private/Hidden");
    expect(titles).toContain("Git: Show again (remove sparse exclusion)");
    expect(titles).not.toContain("Git: Hide on this device (sparse)");
    // Not in .gitignore / exclude -> only the Add variants:
    expect(titles).toContain("Git: Add to .gitignore");
    expect(titles).not.toContain("Git: Remove from .gitignore");
    expect(titles).toContain("Git: Add to .git exclude");
    expect(titles).not.toContain("Git: Remove from .git exclude");
  });

  it("per-group toggles remove their entries from the menu", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ menuGitignore: false, menuSparse: false, menuExclude: false });
    const titles = h.app.workspace.fireFileMenu("Notes/a.md");
    expect(titles.filter((t: string) => t.includes("gitignore"))).toHaveLength(0);
    expect(titles.filter((t: string) => t.toLowerCase().includes("sparse"))).toHaveLength(0);
    expect(titles.filter((t: string) => t.includes("exclude"))).toHaveLength(0);
  });

  it("adds nothing on non-Android platforms", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    __setPlatformAndroid(false);
    expect(h.app.workspace.fireFileMenu("Notes/a.md")).toHaveLength(0);
  });

  it("the status panel row menu offers exactly the same entries as the explorer", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    // The panel calls buildGitMenu directly (same seam the explorer uses), so
    // the two lists cannot drift apart.
    const explorer = h.app.workspace.fireFileMenu("Notes/a.md");
    const titles: string[] = [];
    const menu: Any = {
      addItem: (fn: (i: Any) => void) => {
        const item: Any = {
          setTitle: (t: string) => {
            titles.push(t);
            return item;
          },
          setIcon: () => item,
          onClick: () => item,
        };
        fn(item);
        return menu;
      },
    };
    h.plugin.buildGitMenu(menu, "Notes/a.md");
    expect(titles).toEqual(explorer);
    expect(titles.length).toBeGreaterThan(0);
  });

  it("the panel menu also honours the per-group toggles", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ menuGitignore: false, menuSparse: false, menuExclude: false });
    const titles: string[] = [];
    const menu: Any = {
      addItem: (fn: (i: Any) => void) => {
        const item: Any = {
          setTitle: (t: string) => {
            titles.push(t);
            return item;
          },
          setIcon: () => item,
          onClick: () => item,
        };
        fn(item);
        return menu;
      },
    };
    h.plugin.buildGitMenu(menu, "Notes/a.md");
    // The three config families disappear; the state and "open" entries stay.
    expect(titles.some((t) => t.includes(".gitignore"))).toBe(false);
    expect(titles.some((t) => t.includes("sparse"))).toBe(false);
    expect(titles.some((t) => t.includes("exclude"))).toBe(false);
    expect(titles.some((t) => t.startsWith("Git: Stage"))).toBe(true);
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
    // The protected set is the EFFECTIVE one: manual + derived-from-sparse.
    expect(req.args.protectedPaths).toEqual(h.plugin.effectiveProtectedPaths());
  });

  it("respects the minimum auto-sync gap", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await (h.plugin as Any).queueSyncAndForget();
    await (h.plugin as Any).queueSyncAndForget(); // immediately again
    expect(requestFiles(h.adapter)).toHaveLength(1); // second one suppressed
  });
});

describe("companion update advice", () => {
  it("does not call a companion outdated just because it answered", async () => {
    const h = await loadPlugin();
    // Harness manifest is 0.4.0; an ack with the SAME version is a healthy pair.
    h.plugin.onCompanionAck("run", "1", "0.4.0");
    expect(h.plugin.companionOutdated()).toBe(false);
    expect(h.plugin.versionAdvice().map((a) => a.part)).not.toContain("companion");
  });

  it("flags a companion that reported an older version", async () => {
    const h = await loadPlugin();
    h.plugin.onCompanionAck("run", "1", "0.3.0");
    expect(h.plugin.companionOutdated()).toBe(true);
  });

  it("says nothing while no companion version is known", async () => {
    const h = await loadPlugin();
    expect(h.plugin.companionOutdated()).toBe(false);
  });

  it("treats a NEWER companion as a plugin problem, not a companion one", async () => {
    const h = await loadPlugin();
    h.plugin.onCompanionAck("run", "1", "9.9.9");
    expect(h.plugin.companionOutdated()).toBe(false);
    expect(h.plugin.versionAdvice().map((a) => a.part)).toContain("plugin");
  });
});

describe("panel context menus reflect the row's own group", () => {
  const collect = () => {
    const titles: string[] = [];
    const menu: Any = {
      addItem: (fn: (i: Any) => void) => {
        const item: Any = {
          setTitle: (t: string) => {
            titles.push(t);
            return item;
          },
          setIcon: () => item,
          onClick: () => item,
        };
        fn(item);
        return menu;
      },
    };
    return { titles, menu };
  };

  /** A file that is staged AND edited again afterwards (the "MM" case). */
  const stagedAndModified = (h: Harness) => {
    (h.plugin as Any).lastStatus = {
      status: {
        ahead: 0,
        behind: 0,
        detached: false,
        staged: [{ path: "Notes/a.md", index: "M", worktree: "." }],
        unstaged: [{ path: "Notes/a.md", index: ".", worktree: "M" }],
        untracked: [],
        conflicted: [],
      },
      sparse: { enabled: false, coneMode: undefined, patterns: [], skipWorktreeCount: 0 },
      fetchedAt: "now",
    };
  };

  it("a staged row offers Unstage only, even when the file has newer edits", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    stagedAndModified(h);
    const { titles, menu } = collect();
    h.plugin.buildGitMenu(menu, "Notes/a.md", "staged");
    expect(titles.some((t) => t.startsWith("Git: Unstage"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Git: Stage"))).toBe(false);
  });

  it("an unstaged row offers Stage only for the same file", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    stagedAndModified(h);
    const { titles, menu } = collect();
    h.plugin.buildGitMenu(menu, "Notes/a.md", "unstaged");
    expect(titles.some((t) => t.startsWith("Git: Stage"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Git: Unstage"))).toBe(false);
  });

  it("without a group it infers ONE state, worktree changes first", async () => {
    // The file explorer has no row context. Precedence is conflicted >
    // unstaged > untracked > staged, so the entry offered is the one that
    // acts on what is not yet staged.
    const h = await loadPlugin();
    await enableBridge(h);
    stagedAndModified(h);
    const { titles, menu } = collect();
    h.plugin.buildGitMenu(menu, "Notes/a.md");
    expect(titles.some((t) => t.startsWith("Git: Stage"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Git: Unstage"))).toBe(false);
  });

  it("the group menu offers bulk entries only while the toggles allow them", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    stagedAndModified(h);
    const on = collect();
    h.plugin.buildGroupMenu(on.menu, "staged");
    expect(on.titles.some((t) => t.includes(".gitignore"))).toBe(true);
    expect(on.titles.some((t) => t.includes("sparse"))).toBe(true);
    await h.plugin.updateDeviceSettings({ menuGitignore: false, menuSparse: false, menuExclude: false });
    const off = collect();
    h.plugin.buildGroupMenu(off.menu, "staged");
    expect(off.titles).toEqual(["Git: Unstage in group (1)"]);
  });
});
