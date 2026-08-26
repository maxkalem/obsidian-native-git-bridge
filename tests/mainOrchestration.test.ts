import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  __findByClass,
  __modalActionLabels,
  __modalTitles,
  __notices,
  __openedModals,
  __protocolHandlers,
  __resetObsidianMock,
  __setPlatformAndroid,
  __textOf,
} from "./mocks/obsidian";
import { HistoryView, NGB_HISTORY_VIEW } from "../src/ui/HistoryView";
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

/**
 * A stand-in for Obsidian's Menu that records the titles it is given.
 *
 * Only string titles land in `titles`: the first item of the Git menu is a
 * non-interactive label naming the file, and its title is a DocumentFragment.
 * An assertion about which ACTIONS a menu offers must not have to know that.
 */
function fakeMenu(titles: string[], heads: Any[] = []): Any {
  const menu: Any = {
    addItem: (fn: (i: Any) => void) => {
      const item: Any = {
        setTitle: (t: Any) => {
          if (typeof t === "string") titles.push(t);
          else heads.push(t);
          return item;
        },
        setIcon: () => item,
        setIsLabel: () => item,
        setDisabled: () => item,
        onClick: () => item,
      };
      fn(item);
      return menu;
    },
    addSeparator: () => menu,
  };
  return menu;
}

function makeApp(adapter: MemAdapter): Any {
  let layoutReady: (() => void) | null = null;
  const fileMenuHandlers: Array<(menu: Any, file: Any) => void> = [];
  /** Every pane the plugin opened: { type, state }. */
  const openedViews: Array<{ type: string; state?: Any }> = [];
  /** Test hook: real view instances registered as open panes, by view type. */
  const leaves: Record<string, Any[]> = {};
  let activeFile: Any = null;
  const collectMenu = (path: string): { titles: string[]; head: string } => {
    const titles: string[] = [];
    const heads: Any[] = [];
    const menu = fakeMenu(titles, heads);
    for (const h of fileMenuHandlers) h(menu, { path });
    return { titles, head: heads.length === 0 ? "" : __textOf(heads[0]) };
  };
  return {
    openedViews,
    /** Register a real view instance so `getLeavesOfType` hands it back. */
    registerLeaf: (type: string, view: Any) => {
      (leaves[type] ??= []).push({ view });
    },
    setActiveFile: (path: string) => {
      activeFile = { path };
    },
    appId: "test-app-id",
    vault: {
      configDir: ".obsidian",
      adapter,
      getName: () => "TestVault",
      getAbstractFileByPath: () => null,
      // guardPathLimits walks the vault's own file index before a commit; an
      // empty vault means no long paths, so the guard passes and cmdSync runs.
      // Missing until the first cmdSync orchestration test called it (§10: a
      // stub hides a missing member until something calls it).
      getFiles: () => [] as Any[],
    },
    workspace: {
      onLayoutReady: (cb: () => void) => {
        layoutReady = cb;
      },
      fireLayoutReady: () => layoutReady?.(),
      getLeavesOfType: (t: string) => leaves[t] ?? [],
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
      /**
       * Test hook: simulate a right click / long tap.
       *
       * The menu's first item is a non-interactive label naming the file, and
       * its title is a DocumentFragment rather than a string. Titles are split
       * by type so the action assertions keep asking only about actions.
       */
      collectMenu,
      fireFileMenu: (path: string): string[] => collectMenu(path).titles,
    },
  };
}

// ------------------------------------------------------- fake Termux runner

interface FakeRunner {
  /** URIs the transport opened (one per triggered request). */
  uris: string[];
  /** When set, called with the request id; may write a result file. */
  onTrigger: ((id: string) => void) | null;
  /** Texts copied to the clipboard (the interactive-clone handoff copies one). */
  copied: string[];
}

function okStatusResult(
  id: string,
  runnerVersion = 4,
  /** Extra result fields, for actions that attach their own on top of status. */
  extraData: Record<string, string> = {}
) {
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
      // LAST, so a test can override the fixture's fields, not only add new
      // ones (the sparse-reconcile tests answer with sparse DISABLED).
      ...extraData,
    },
  });
}

// ------------------------------------------------------------- plugin setup

function installGlobals(runner: FakeRunner): void {
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
  // The interactive-clone handoff copies a command before opening Termux;
  // node has no clipboard, so record what production code would have copied.
  // defineProperty, not assignment: node 21+ ships `navigator` as a global
  // with only a getter, and a plain assignment throws.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (t: string) => void runner.copied.push(t) } },
  });
  const visListeners = new Set<() => void>();
  (globalThis as Any).document = {
    visibilityState: "visible",
    addEventListener: (ev: string, cb: () => void) => {
      if (ev === "visibilitychange") visListeners.add(cb);
    },
    removeEventListener: (_ev: string, cb: () => void) => {
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
  const runner: FakeRunner = { uris: [], onTrigger: null, copied: [] };
  installGlobals(runner);
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

describe("a result that landed while Obsidian was closed", () => {
  /**
   * The case this recovery exists for is the dangerous one: a pull that
   * finished in Termux after Obsidian was gone can have left the repository in
   * a merge with conflict markers in the files. It used to be logged as one
   * info line and dropped — no error, no status — so the next thing the user
   * saw was a panel with nothing in it, which then read as a clean repository.
   */
  function conflictResult(id: string): string {
    return JSON.stringify({
      protocolVersion: 1,
      id,
      action: "pull",
      ok: false,
      exitCode: 1,
      runnerVersion: 12,
      // A failed action carries fresh status as well as its error payload,
      // which is exactly what makes dropping it a loss.
      data: {
        conflicts: "Notes/a.md\nNotes/b.md",
        branchInfo: "# branch.oid abc123\n# branch.head main\n# branch.ab +1 -2\nu UU N... Notes/a.md",
        mergeInProgress: "true",
      },
      error: { code: "CONFLICT", message: "A merge is already in progress.", stdout: "", stderr: "" },
    });
  }

  async function recoverA(h: Harness, id: string): Promise<void> {
    h.adapter.files.set(paths.resultFile(id), conflictResult(id));
    (h.plugin as Any).store.setValue(
      "active-op",
      JSON.stringify({ id, action: "pull", startedAt: Date.now() })
    );
    await (h.plugin as Any).reconcileAfterRestart();
  }

  it("reports the failure instead of only logging it", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await recoverA(h, "r-20260809T001500Z-recov1");
    expect(__openedModals).toContain("ConflictModal");
  });

  it("absorbs the status it carried, so the panel is not left empty", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await recoverA(h, "r-20260809T001500Z-recov2");
    // An unfinished merge is the state the panel must show; before this, the
    // plugin had no status at all and rendered a clean working tree.
    expect((h.plugin as Any).lastStatus?.mergeInProgress).toBe(true);
  });

  it("still consumes the result file", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await recoverA(h, "r-20260809T001500Z-recov3");
    expect(resultFiles(h.adapter)).toHaveLength(0);
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

  it("answers a refresh in a repo-less vault with the setup window, not an error", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      error: { code: "REPO_MISSING", message: "This vault is not a git repository yet. Clone one or create one." },
    }));
    // The panel's refresh button and the palette Status command pass the flag.
    await h.plugin.cmdStatus(true, true);
    expect(__modalTitles).toContain("Set up the repository");
    expect(__modalTitles).not.toContain("Native Git: status failed");
  });

  it("keeps the error window when a .git exists but the runner cannot use it", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.adapter.dirs.add(".git"); // the repository is there; the profile is what is broken
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      error: { code: "REPO_MISSING", message: "Repository unusable (dubious ownership)." },
    }));
    await h.plugin.cmdStatus(true, true);
    // Offering to create a repository over one that exists would be worse
    // than the honest failure.
    expect(__modalTitles).toContain("Native Git: status failed");
    expect(__modalTitles).not.toContain("Set up the repository");
  });

  it("never pops the setup window from an automatic background refresh", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      error: { code: "REPO_MISSING", message: "This vault is not a git repository yet." },
    }));
    await h.plugin.cmdStatus(true); // no flag: the automatic callers' shape
    expect(__modalTitles).not.toContain("Set up the repository");
  });

  it("catches REPO_MISSING from EVERY operation: a pull in a repo-less vault opens the setup window", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      error: { code: "REPO_MISSING", message: "This vault is not a git repository yet. Clone one or create one." },
    }));
    await (h.plugin as Any).cmdPull();
    expect(__modalTitles).toContain("Set up the repository");
    expect(__modalTitles).not.toContain("Native Git: pull failed");
  });

  it("a pull against a .git the runner cannot use keeps the honest error window", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.adapter.dirs.add(".git");
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      error: { code: "REPO_MISSING", message: "Repository unusable (dubious ownership)." },
    }));
    await (h.plugin as Any).cmdPull();
    expect(__modalTitles).toContain("Native Git: pull failed");
    expect(__modalTitles).not.toContain("Set up the repository");
  });

  // ---- the 0.6.6 buttons: the two Termux fixes stop being sentences --------

  it("a sync refused for a missing identity carries the set-identity button", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      error: {
        code: "GIT_FAILED",
        message:
          "git user.name / user.email are not configured for this repository. Nothing was committed.",
      },
    }));
    await (h.plugin as Any).cmdSync();
    expect(__modalTitles).toContain("Native Git: sync failed");
    expect(__modalActionLabels).toContain("Set the git identity…");
  });

  it("a status failed over dubious ownership carries the safe.directory button", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.adapter.dirs.add(".git"); // the repository exists; git refuses it
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      error: {
        code: "REPO_MISSING",
        message:
          'Git refuses the repository (dubious ownership). In Termux run: git config --global --add safe.directory "/storage/emulated/0/Documents/Kalem"',
      },
    }));
    await h.plugin.cmdStatus(true, true);
    expect(__modalTitles).toContain("Native Git: status failed");
    expect(__modalActionLabels).toContain("Copy the safe.directory fix…");
  });

  it("the identity check reports scopes and never offers the global removal without a local identity", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: true,
      exitCode: 0,
      runnerVersion: 16,
      data: {
        branchInfo: "# branch.head main",
        userNameScopes: "global",
        userEmailScopes: "global",
        credHelperScopes: "global\nlocal",
      },
    }));
    await (h.plugin as Any).cmdCheckIdentity();
    expect(__modalTitles).toContain("Git identity check");
    // The ordering rule is absolute: no local identity, no removal offer —
    // the global one is the only thing letting commits happen.
    expect(__modalActionLabels).toContain("Set the git identity…");
    expect(__modalActionLabels).not.toContain("Remove the global identity…");
    // A global helper shadows the profile's file; the reset is offered.
    expect(__modalActionLabels).toContain("Prefer this repository's credentials…");
  });

  it("the identity check offers the global removal once a local identity exists", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: true,
      exitCode: 0,
      runnerVersion: 16,
      data: {
        branchInfo: "# branch.head main",
        userNameScopes: "global\nlocal",
        userEmailScopes: "global\nlocal",
        credHelperScopes: "local",
      },
    }));
    await (h.plugin as Any).cmdCheckIdentity();
    expect(__modalActionLabels).toContain("Remove the global identity…");
    expect(__modalActionLabels).not.toContain("Set the git identity…");
    expect(__modalActionLabels).not.toContain("Prefer this repository's credentials…");
  });

  it("the stale-lock triage removes a corpse without stopping anything", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    const sent: string[] = [];
    answerWith(h, (req: Any) => {
      sent.push(req.action);
      if (req.action === "repair-triage") {
        return {
          ok: true,
          exitCode: 0,
          runnerVersion: 16,
          data: {
            branchInfo: "# branch.head main",
            lockExists: "true",
            lockAgeSeconds: "9999",
            liveGit: "false",
            liveProcesses: "",
          },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        runnerVersion: 16,
        data: {
          branchInfo: "# branch.head main",
          lockExisted: "true",
          lockRemoved: "true",
          killedProcesses: "",
        },
      };
    });
    await (h.plugin as Any).runStaleLockTriage();
    // A corpse needs no kill and therefore no kill confirmation: the triage
    // proved nothing could be holding the lock, and the removal says so.
    expect(sent).toEqual(["repair-triage", "repair-stale-lock"]);
    expect(__openedModals).not.toContain("ConfirmModal");
    expect(__notices.some((n) => n.includes("nothing was stopped"))).toBe(true);
  });

  it("a fresh lock with a live git advises waiting instead of killing", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    const sent: string[] = [];
    answerWith(h, (req: Any) => {
      sent.push(req.action);
      return {
        ok: true,
        exitCode: 0,
        runnerVersion: 16,
        data: {
          branchInfo: "# branch.head main",
          lockExists: "true",
          lockAgeSeconds: "10",
          liveGit: "true",
          liveProcesses: "123 git",
        },
      };
    });
    await (h.plugin as Any).runStaleLockTriage();
    // A running command is not a corpse: nothing is removed, nothing is
    // killed, and the window says waiting is the safe choice — with the kill
    // still reachable behind its own confirmation.
    expect(sent).toEqual(["repair-triage"]);
    expect(__modalTitles).toContain("A git command seems to be running");
    expect(__modalActionLabels).toContain("Stop Termux & delete anyway…");
  });

  it("the unified repair walks triage, fixes the sparse definition, and lists the rest with buttons", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    (h.plugin as Any).lastRunnerVersion = 16;
    const sent: string[] = [];
    answerWith(h, (req: Any) => {
      sent.push(req.action);
      if (req.action === "repair-triage") {
        return {
          ok: true,
          exitCode: 0,
          runnerVersion: 16,
          data: {
            branchInfo: "# branch.head main",
            lockExists: "false",
            lockAgeSeconds: "",
            liveGit: "false",
            liveProcesses: "",
            userNameScopes: "global",
            userEmailScopes: "global",
            credHelperScopes: "global",
            sparseEnabled: "true",
            sparseCone: "false",
            sparseList: "/*\n!/*/",
            rescueBranches: "ngb-rescue-20260810T235946Z",
            previousGitDirs: "",
          },
        };
      }
      if (req.action === "repair-sparse-definition") {
        return {
          ok: true,
          exitCode: 0,
          runnerVersion: 16,
          data: { branchInfo: "# branch.head main", sparseRepaired: "true", sparseList: "/*" },
        };
      }
      // repair-scan: nothing missing, nothing damaged.
      return {
        ok: true,
        exitCode: 0,
        runnerVersion: 16,
        data: {
          branchInfo: "# branch.head main",
          removedCount: "0",
          removedObjects: "",
          fsckMissing: "",
          fsckRemaining: "",
          aheadCount: "0",
          cacheTreeBroken: "false",
          hasUpstream: "true",
        },
      };
    });
    await (h.plugin as Any).runRepairJob();
    // The safe fix ran by itself; the object steps followed; nothing else
    // became a modal mid-walk (decision 4: seven steps, not seven taps).
    // No lightweight toggle here, so the footprint check does not even run:
    // the full history IS the configured state (the user's rule, 2026-08-26).
    expect(sent).toEqual(["repair-triage", "repair-sparse-definition", "repair-scan"]);
    expect(__modalTitles).toContain("Repository repaired");
    // What remains rides the final window as buttons, ordering rule included:
    // no local identity, so SET is offered and the global removal is not.
    expect(__modalActionLabels).toContain("Set the git identity…");
    expect(__modalActionLabels).not.toContain("Remove the global identity…");
    expect(__modalActionLabels).toContain("Prefer this repository's credentials…");
    expect(__modalActionLabels).toContain("Delete repair backup branch…");
    expect(__modalActionLabels.some((l: string) => l.startsWith("Free up"))).toBe(false);
  });

  it("a clean walk on a LIGHTWEIGHT repository measures the blob bloat and offers exactly that", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    (h.plugin as Any).lastRunnerVersion = 16;
    const sent: string[] = [];
    answerWith(h, (req: Any) => {
      sent.push(req.action);
      if (req.action === "repair-triage") {
        return {
          ok: true,
          exitCode: 0,
          runnerVersion: 16,
          data: {
            branchInfo: "# branch.head main",
            lockExists: "false",
            lockAgeSeconds: "",
            liveGit: "false",
            liveProcesses: "",
            userNameScopes: "local",
            userEmailScopes: "local",
            credHelperScopes: "local",
            sparseEnabled: "false",
            sparseCone: "false",
            sparseList: "",
            rescueBranches: "",
            previousGitDirs: "",
            // The lightweight toggle is ON: the config survived the refetch.
            shallow: "false",
            partialFilter: "blob:none",
          },
        };
      }
      if (req.action === "maintenance-scan") {
        // The device case: a repair refetch stuffed 4.3 GB of blobs back into
        // a repository whose filter says they should not be there.
        return {
          ok: true,
          exitCode: 0,
          runnerVersion: 16,
          data: {
            branchInfo: "# branch.head main",
            partialFilter: "blob:none",
            countObjects: "count: 0\nsize: 0\nin-pack: 14520\npacks: 2\nsize-pack: 4600000\nsize-garbage: 0",
            blobDiskKb: "4500000",
          },
        };
      }
      // repair-scan: nothing missing, nothing damaged.
      return {
        ok: true,
        exitCode: 0,
        runnerVersion: 16,
        data: {
          branchInfo: "# branch.head main",
          partialFilter: "blob:none",
          removedCount: "0",
          removedObjects: "",
          fsckMissing: "",
          fsckRemaining: "",
          aheadCount: "0",
          cacheTreeBroken: "false",
          hasUpstream: "true",
        },
      };
    });
    await (h.plugin as Any).runRepairJob();
    expect(sent).toEqual(["repair-triage", "repair-scan", "maintenance-scan"]);
    expect(__modalTitles).toContain("Repository repaired");
    // One tap, the measured number, no hunting through the settings: the
    // label carries what the FILTER allows shedding, not the raw store size.
    expect(__modalActionLabels.some((l: string) => /^Free up 4\.[0-9] GB…$/.test(l))).toBe(true);
  });

  it("a lightweight repository within its allowance gets no cleanup offer", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    (h.plugin as Any).lastRunnerVersion = 16;
    answerWith(h, (req: Any) => {
      if (req.action === "repair-triage") {
        return {
          ok: true,
          exitCode: 0,
          runnerVersion: 16,
          data: {
            branchInfo: "# branch.head main",
            lockExists: "false",
            lockAgeSeconds: "",
            liveGit: "false",
            liveProcesses: "",
            userNameScopes: "local",
            userEmailScopes: "local",
            credHelperScopes: "local",
            sparseEnabled: "false",
            sparseCone: "false",
            sparseList: "",
            rescueBranches: "",
            previousGitDirs: "",
            shallow: "false",
            partialFilter: "blob:none",
          },
        };
      }
      if (req.action === "maintenance-scan") {
        // 40 MB of blobs is what recent pulls legitimately brought in.
        return {
          ok: true,
          exitCode: 0,
          runnerVersion: 16,
          data: {
            branchInfo: "# branch.head main",
            partialFilter: "blob:none",
            countObjects: "count: 0\nsize: 0\nin-pack: 900\npacks: 1\nsize-pack: 260000\nsize-garbage: 0",
            blobDiskKb: "40960",
          },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        runnerVersion: 16,
        data: {
          branchInfo: "# branch.head main",
          partialFilter: "blob:none",
          removedCount: "0",
          removedObjects: "",
          fsckMissing: "",
          fsckRemaining: "",
          aheadCount: "0",
          cacheTreeBroken: "false",
          hasUpstream: "true",
        },
      };
    });
    await (h.plugin as Any).runRepairJob();
    expect(__modalTitles).toContain("Repository repaired");
    expect(__modalActionLabels.some((l: string) => l.startsWith("Free up"))).toBe(false);
  });

  it("the unified repair stops at ownership: nothing else can run, the fix is the clipboard", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    (h.plugin as Any).lastRunnerVersion = 16;
    h.adapter.dirs.add(".git"); // the repository exists; git refuses it
    const sent: string[] = [];
    answerWith(h, (req: Any) => {
      sent.push(req.action);
      return {
        ok: false,
        exitCode: 1,
        runnerVersion: 16,
        error: {
          code: "REPO_MISSING",
          message:
            'Git refuses the repository (dubious ownership). In Termux run: git config --global --add safe.directory "/x"',
        },
      };
    });
    await (h.plugin as Any).runRepairJob();
    expect(sent).toEqual(["repair-triage"]);
    expect(__modalTitles).toContain("Repository blocked: ownership");
    expect(__modalActionLabels).toContain("Copy the safe.directory fix…");
  });

  it("the previous-git delete offer is suppressed while unmaterialized deletions stand", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.adapter.files.set(
      `${paths.root}/previous-git-20260807T101500Z.json`,
      JSON.stringify({
        dir: "previous-git-20260807T101500Z",
        createdAt: "2026-08-07T10:15:00Z",
        sizeKb: 4404224,
        commits: 36,
        branch: "main",
        lastCommit: "abc1234 2026-08-01 fix typo",
      })
    );
    // The phone's own state (2026-08-11 bundle): a filtered re-clone whose
    // materialize failed lists its unmaterialized files as deletions, and the
    // set-aside previous-git is the one full local copy. The reminder offered
    // to delete it in exactly this state, and the user took the offer.
    (h.plugin as Any).absorbStatusData({
      branchInfo:
        "# branch.head main\n1 .D N... 100644 100644 100644 abc1234 abc1234 Notes/a.md",
      partialFilter: "blob:none",
    });
    await (h.plugin as Any).remindAboutPreviousRepos();
    expect(__modalTitles).not.toContain("A previous repository is still taking up space");
    // Once nothing is listed as deleted the reminder returns.
    (h.plugin as Any).absorbStatusData({
      branchInfo: "# branch.head main",
      partialFilter: "blob:none",
    });
    await (h.plugin as Any).remindAboutPreviousRepos();
    expect(__modalTitles).toContain("A previous repository is still taking up space");
  });

  it("the identity check on a runner without the fields says the runner is too old", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: true,
      exitCode: 0,
      runnerVersion: 15,
      data: { branchInfo: "# branch.head main" },
    }));
    await (h.plugin as Any).cmdCheckIdentity();
    expect(__modalTitles).toContain("Termux runner is too old for this");
    expect(__modalTitles).not.toContain("Git identity check");
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
    // ssh: keys never prompt, so this stays on the companion route (a fresh
    // https clone goes to the Termux terminal since v15 — tested below).
    await (h.plugin as Any).runClone("git@example.com:v.git");
    expect(sent.action).toBe("clone-into-vault");
    expect(sent.timeoutSeconds).toBe(3600);
    // A normal action keeps the ordinary budget.
    await h.plugin.cmdStatus(true);
    expect(sent.timeoutSeconds).toBe(h.plugin.deviceSettings.opTimeoutSeconds);
  });

  it("never sends a URL the rules refuse (no round trip at all)", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    // The prompt is a modal; go through the same validation the prompt uses.
    const bad = [
      "https://user:pw@example.com/v.git",
      "https://ghp_token123@example.com/v.git", // token as username, no colon
      "-oProxyCommand=id",
      "ext::sh -c id",
    ];
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
    await (h.plugin as Any).runClone("git@example.com:v.git");
    // One request, no onCollision argument, no second attempt: the vault's own
    // versions are kept and become ordinary local changes to review.
    expect(sent).toHaveLength(1);
    expect(sent[0].args).toEqual({ url: "git@example.com:v.git" });
    expect(__openedModals).toContain("ResultModal");
  });

  it("hands a fresh https clone to Termux as a PLAIN git command, and finishes on Continue", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    // The command addresses the vault by its Termux path and the credential
    // file by the profile id, so both must be known.
    await h.plugin.updateDeviceSettings({
      repoPathHint: "/storage/emulated/0/Vault",
      profileId: "p-0123456789abcdef",
    });
    await (h.plugin as Any).runClone("https://example.com/v.git", false, "blob:none");
    // Nothing queued and no trigger fired: nothing can expire or be claimed
    // while the user is still typing a token in Termux.
    expect(requestFiles(h.adapter)).toHaveLength(0);
    expect(h.runner.uris).toHaveLength(0);
    expect(__modalTitles).toContain("Clone in Termux, then continue here");
    const copied = h.runner.copied.join("\n");
    expect(copied).toContain("git clone --no-checkout --progress --filter=blob:none");
    expect(copied).toContain('-- "https://example.com/v.git"');
    expect(copied).toContain("creds/p-0123456789abcdef");
    expect(copied).toContain("/storage/emulated/0/Vault/.obsidian/plugins/native-git-bridge/runtime/clone-tmp/repo");
    // Continue: an ordinary companion round trip that finishes locally.
    answerWith(h, () => ({ ok: true, exitCode: 0, data: { cloned: "true", branch: "main" } }));
    await (h.plugin as Any).finishManualClone({ url: "https://example.com/v.git", filter: "blob:none" });
    expect(h.runner.uris).toHaveLength(1);
    expect(__modalTitles).toContain("Repository cloned");
  });

  it("offers the Termux route when a companion-route clone turns out to need credentials", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answerWith(h, () => ({
      ok: false,
      exitCode: 1,
      runnerVersion: 15,
      error: {
        code: "GIT_FAILED",
        message: "git clone failed. Nothing was written into the vault.",
        stderr:
          "fatal: could not read Password for 'https://example.com': terminal prompts disabled",
      },
    }));
    // A re-clone with nothing known about credentials tries the companion
    // first (unknown is not "no"), and the failure names the way out.
    await (h.plugin as Any).runClone("https://example.com/v.git", true);
    expect(h.runner.uris).toHaveLength(1);
    expect(__modalTitles).toContain("The clone needs credentials");
    expect(__modalTitles).not.toContain("Native Git: clone failed");
  });

  it("refuses to build the clone command without the vault's Termux path", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    // No repoPathHint: the command addresses the vault by absolute path, so
    // there is nothing honest to build — a Notice says what to set, nothing
    // is queued and nothing is copied.
    await (h.plugin as Any).runClone("https://example.com/v.git");
    expect(requestFiles(h.adapter)).toHaveLength(0);
    expect(h.runner.copied).toHaveLength(0);
    expect(__notices.join(" ")).toContain("repository path");
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

describe("an unfinished merge survives a status refresh", () => {
  /**
   * Reported from the device: the "merge in progress" banner appeared after a
   * pull failed, and vanished the moment the status was refreshed — while git
   * was still mid-merge and still refusing to pull.
   *
   * Cause: cmdStatus assigned `lastStatus` itself, duplicating absorbStatusData
   * minus the merge and rebase fields, so every refresh dropped them. The same
   * omission cost the commit modal its prefilled MERGE_MSG.
   */
  it("keeps mergeInProgress and mergeMsg across cmdStatus", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.runner.onTrigger = (id: string) => {
      h.adapter.files.set(
        paths.resultFile(id),
        okStatusResult(id, undefined, {
          mergeInProgress: "true",
          mergeMsg: "Merge branch 'origin/main'\n\n# Conflicts:\n#\tNotes/note.md",
        })
      );
    };
    await h.plugin.cmdStatus(true);
    expect((h.plugin as Any).lastStatus.mergeInProgress).toBe(true);
    expect((h.plugin as Any).lastStatus.mergeMsg).toContain("Merge branch");
    // A second refresh must not lose it either.
    await h.plugin.cmdStatus(true);
    expect((h.plugin as Any).lastStatus.mergeInProgress).toBe(true);
  });

  it("clears it once the runner stops reporting a merge", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.runner.onTrigger = (id: string) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, undefined, { mergeInProgress: "true" }));
    };
    await h.plugin.cmdStatus(true);
    expect((h.plugin as Any).lastStatus.mergeInProgress).toBe(true);
    h.runner.onTrigger = (id: string) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, undefined, { mergeInProgress: "false" }));
    };
    await h.plugin.cmdStatus(true);
    expect((h.plugin as Any).lastStatus.mergeInProgress).toBe(false);
  });

  it("a rebase reported by the runner survives a refresh too", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.runner.onTrigger = (id: string) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, undefined, { rebaseInProgress: "true" }));
    };
    await h.plugin.cmdStatus(true);
    expect((h.plugin as Any).lastStatus.rebaseInProgress).toBe(true);
  });
});

describe("sparse safety: clearing an index entry that has no file on disk", () => {
  /**
   * The state a real device got stuck in: a note staged inside a directory
   * that was sparse-excluded afterwards. The file is gone from disk, the index
   * entry is not, and the safety gate blocks every commit, push and sync.
   *
   * The repair is one runner round trip, and its request has to carry
   * `protectedPaths`: the runner checks every path against that list and
   * refuses the request outright when it is empty, because "which paths are
   * protected" IS the permission model for the only write it will ever perform
   * on a protected path. Omitting it made the repair fail every single time,
   * and the e2e suite could not catch it because it writes its own request JSON.
   */
  it("sends protectedPaths with the request, or the runner refuses it", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    await h.plugin.updateDeviceSettings({ protectedPaths: ["Private/Mem"] });
    const seen: Any[] = [];
    h.runner.onTrigger = (id: string) => {
      seen.push(JSON.parse(h.adapter.files.get(paths.requestFile(id)) as string));
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id));
    };
    await (h.plugin as Any).runSparseRepair({
      trash: [],
      resolveToHead: [],
      unstage: ["Private/Mem/handoff.md"],
      blocked: [],
    });
    const req = seen.find((r) => r.action === "unstage-protected");
    expect(req).toBeDefined();
    expect(req.args.paths).toEqual(["Private/Mem/handoff.md"]);
    expect(req.args.protectedPaths).toEqual(["Private/Mem"]);
  });

  it("says nothing happened rather than announcing zero", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    await h.plugin.updateDeviceSettings({ protectedPaths: ["Private/Mem"] });
    // The runner is idempotent: a path already cleared answers ok with 0.
    h.runner.onTrigger = (id: string) => {
      h.adapter.files.set(
        paths.resultFile(id),
        okStatusResult(id, undefined, { unstagedProtectedCount: "0" })
      );
    };
    __notices.length = 0;
    await (h.plugin as Any).runSparseRepair({
      trash: [],
      resolveToHead: [],
      unstage: ["Private/Mem/handoff.md"],
      blocked: [],
    });
    expect(__notices.join(" ")).not.toMatch(/0 index entr/);
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

  /**
   * The menu names its target before it offers to act on it. A panel row
   * truncates the name to one line and the file explorer shows no path at all,
   * so this was the only surface offering "Discard changes" and "Delete" over a
   * file it never identified.
   */
  it("names the file above the entries, path and name apart", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    const head = h.app.workspace.collectMenu("Notes/Deep/a.md").head;
    expect(head).toContain("Notes/Deep");
    expect(head).toContain("a.md");
  });

  it("shows only the name for a file at the repository root", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    // Nothing to state: an empty directory line would be a blank row above the
    // name, which reads as a rendering fault rather than as "no directory".
    expect(h.app.workspace.collectMenu("a.md").head.trim()).toBe("a.md");
  });

  it("drops the header when the preference is off, and keeps every entry", async () => {
    // A deep path costs two or three rows of a short screen, so it is a
    // preference — but turning the label off must not disturb the actions,
    // which is the whole point of it being a label.
    const h = await loadPlugin();
    await enableBridge(h);
    const withHeader = h.app.workspace.collectMenu("Notes/Deep/a.md");
    await h.plugin.setSharedPref({ showMenuHeader: false });
    const without = h.app.workspace.collectMenu("Notes/Deep/a.md");

    expect(withHeader.head).not.toBe("");
    expect(without.head).toBe("");
    expect(without.titles).toEqual(withHeader.titles);
  });

  it("the status panel row menu offers exactly the same entries as the explorer", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    // The panel calls buildGitMenu directly (same seam the explorer uses), so
    // the two lists cannot drift apart.
    const explorer = h.app.workspace.fireFileMenu("Notes/a.md");
    const titles: string[] = [];
    const menu = fakeMenu(titles);
    h.plugin.buildGitMenu(menu, "Notes/a.md");
    expect(titles).toEqual(explorer);
    expect(titles.length).toBeGreaterThan(0);
  });

  it("the panel menu also honours the per-group toggles", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    await h.plugin.updateDeviceSettings({ menuGitignore: false, menuSparse: false, menuExclude: false });
    const titles: string[] = [];
    const menu = fakeMenu(titles);
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
    const menu = fakeMenu(titles);
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

/**
 * The teardown at the end of `runOperation` has to reach every surface that
 * shows the plugin's state line, not only the status panel. The history
 * panels' copy is written by the per-second tick, and the ticker is already
 * cleared inside `finally`, so without a final push their line froze at the
 * last rendered second — "diff-file… 4s", forever, after opening a diff from
 * the repository history (seen on the device in 0.6.3).
 */
describe("teardown reaches the panels that show the state line", () => {
  const historyView = (h: Harness): Any => {
    const view = new HistoryView({} as Any, {
      loadPage: async () => [],
      openDiffAtCommit: () => undefined,
      openFile: () => undefined,
      progressText: () => (h.plugin as Any).progressText ?? "",
      progressDetail: () => (h.plugin as Any).progressDetail ?? "",
      treeView: () => false,
      toggleTree: () => undefined,
      openStatusPanel: () => undefined,
      openOutput: () => undefined,
      rowsPerGroup: () => 30,
    }) as Any;
    view.renderShell();
    h.app.registerLeaf(NGB_HISTORY_VIEW, view);
    return view;
  };
  const stateLine = (view: Any): string =>
    __findByClass(view.contentEl, "ngb-sv-progress-text").textContent ?? "";

  it("releases the history panel's state line when the last request finishes", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    let capturedId = "";
    h.runner.onTrigger = (id) => {
      capturedId = id;
    };
    const view = historyView(h);
    const op = (h.plugin as Any).runOperation("status", {}) as Promise<Any>;
    for (let i = 0; i < 200 && capturedId === ""; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(capturedId).not.toBe("");
    // A tick paints the running state into the panel's copy…
    view.updatePluginProgress();
    expect(stateLine(view)).toMatch(/^status… /);
    // …the runner answers and the operation tears down…
    h.adapter.files.set(paths.resultFile(capturedId), okStatusResult(capturedId));
    await op;
    // …and the line is released rather than frozen at the last tick.
    expect(stateLine(view)).toBe("Idle");
  });
});

/**
 * Every route that changes an ignore rule must leave the panel agreeing with
 * git. The exclude actions return only the exclude list (see protocol.md), so
 * the plugin follows them with a status request of its own; .gitignore is
 * written by the plugin itself, so the same applies. Without this, a rule
 * "added" was still on screen after a refresh the user had no reason to run.
 */
describe("an ignore-rule change refreshes the panel", () => {
  const answering = (h: Harness) => {
    h.runner.onTrigger = (id) => {
      const req = JSON.parse(h.adapter.files.get(paths.requestFile(id))!) as Any;
      if (req.action === "exclude-add" || req.action === "exclude-remove") {
        h.adapter.files.set(
          paths.resultFile(id),
          JSON.stringify({
            protocolVersion: 1,
            id,
            action: req.action,
            ok: true,
            exitCode: 0,
            runnerVersion: 4,
            data: { excludeList: "/Notes/x.md" },
          })
        );
      } else {
        h.adapter.files.set(paths.resultFile(id), okStatusResult(id));
      }
    };
  };
  const sentActions = (h: Harness): string[] =>
    requestFiles(h.adapter)
      .sort()
      .map((f) => (JSON.parse(h.adapter.files.get(f)!) as Any).action as string);

  it("an exclude change is followed by the plugin's own status request", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answering(h);
    await h.plugin.cmdExcludeChange("Notes/x.md", true);
    // Order-insensitive: two ids minted in the same millisecond sort by their
    // random suffix, and the claim is "both were sent", not which file sorts first.
    expect(sentActions(h).sort()).toEqual(["exclude-add", "status"]);
  });

  it("a .gitignore add refreshes too, and one edit costs one status", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answering(h);
    await h.plugin.gitignoreAdd("/Notes/x.md");
    expect(h.adapter.files.get(".gitignore")).toContain("/Notes/x.md");
    expect(sentActions(h)).toEqual(["status"]);
  });

  it("says so when the rule targets a TRACKED path, which no ignore rule hides", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answering(h);
    (h.plugin as Any).lastStatus = {
      status: {
        ahead: 0,
        behind: 0,
        detached: false,
        staged: [],
        unstaged: [{ path: ".obsidian/workspace-mobile.json", index: ".", worktree: "M" }],
        untracked: [],
        conflicted: [],
      },
      sparse: { enabled: false, coneMode: undefined, patterns: [], skipWorktreeCount: 0 },
      fetchedAt: "now",
    };
    await h.plugin.gitignoreAdd("/.obsidian/workspace-mobile.json");
    expect(__notices.some((n) => n.includes("tracked by git"))).toBe(true);
  });

  it("stays quiet about an untracked path: that rule works as it reads", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answering(h);
    await h.plugin.gitignoreAdd("/Notes/new-untracked.md");
    expect(__notices.some((n) => n.includes("tracked by git"))).toBe(false);
  });
});

/**
 * `untrack-file` (runner v14): the missing half of the tracked-file notice.
 * The runner side is proven in e2e phase 17; what is asserted here is the
 * plugin's own flow — status absorbed from the result, the user told what to
 * do next, and the ignore-rule gap named rather than silently left open.
 */
describe("untrack-file flow", () => {
  it("absorbs the result's status and names the missing ignore rule", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    let sentAction = "";
    h.runner.onTrigger = (id) => {
      sentAction = (JSON.parse(h.adapter.files.get(paths.requestFile(id))!) as Any).action as string;
      h.adapter.files.set(
        paths.resultFile(id),
        okStatusResult(id, 14, { untrackedPath: ".obsidian/workspace-mobile.json" })
      );
    };
    await h.plugin.cmdUntrackFile(".obsidian/workspace-mobile.json");
    expect(sentAction).toBe("untrack-file");
    expect(__notices.some((n) => n.includes("No longer tracked"))).toBe(true);
    expect(__notices.some((n) => n.includes("No ignore rule covers"))).toBe(true);
  });

  it("does not nag about the rule when one already covers the path", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    h.adapter.files.set(".gitignore", "/.obsidian/workspace-mobile.json\n");
    await (h.plugin as Any).loadGitignore();
    h.runner.onTrigger = (id) => {
      h.adapter.files.set(
        paths.resultFile(id),
        okStatusResult(id, 14, { untrackedPath: ".obsidian/workspace-mobile.json" })
      );
    };
    await h.plugin.cmdUntrackFile(".obsidian/workspace-mobile.json");
    expect(__notices.some((n) => n.includes("No longer tracked"))).toBe(true);
    expect(__notices.some((n) => n.includes("No ignore rule covers"))).toBe(false);
  });
});

/**
 * Repository footprint (runner v14). The settings toggles show the
 * repository's ACTUAL state, reported with every status; the runner side is
 * proven in e2e phase 18. Asserted here: the state round trip, and the
 * one-time partial-clone offer for sparse users — once per device, never on a
 * runner that cannot serve it.
 */
describe("repository footprint (runner v14)", () => {
  const answeringStatus = (h: Harness, runnerVersion: number, extra: Record<string, string> = {}) => {
    h.runner.onTrigger = (id) => {
      h.adapter.files.set(paths.resultFile(id), okStatusResult(id, runnerVersion, extra));
    };
  };
  const confirmModals = () => __openedModals.filter((m) => m === "ConfirmModal").length;

  it("reflects shallow and partial state from the status result", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answeringStatus(h, 14, { shallow: "true", partialFilter: "blob:none" });
    expect(h.plugin.footprintState()).toBeNull();
    await h.plugin.cmdStatus(true);
    expect(h.plugin.footprintState()).toEqual({ shallow: true, partial: true });
    expect(h.plugin.footprintAvailable()).toBe(true);
  });

  it("asks protect-or-release when protected paths vanish from the sparse list", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    await h.plugin.updateDeviceSettings({
      derivedProtectedPaths: ["Private/Hidden", "Projects/Archive"],
    });
    // A re-cloned repository: sparse simply disabled, list empty.
    answeringStatus(h, 15, { sparseEnabled: "false", sparseList: "", skipWorktreeCount: "0" });
    await h.plugin.cmdStatus(true);
    expect(__modalTitles).toContain("Protected paths are no longer hidden");
    // The protection STAYS until the user decides.
    expect(h.plugin.deviceSettings.derivedProtectedPaths).toEqual(["Private/Hidden", "Projects/Archive"]);
    // …and the same set is not asked about twice in one session.
    __modalTitles.length = 0;
    await h.plugin.cmdStatus(true);
    expect(__modalTitles).not.toContain("Protected paths are no longer hidden");
  });

  it("keeps quiet while the sparse list still carries every protected path", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    // The fixture's sparse list is /* + !Private/Hidden/ — derive from it once…
    answeringStatus(h, 15, {});
    await h.plugin.cmdStatus(true);
    const derived = h.plugin.deviceSettings.derivedProtectedPaths;
    expect(derived.length).toBeGreaterThan(0);
    // …and an identical second status changes nothing and asks nothing.
    await h.plugin.cmdStatus(true);
    expect(__modalTitles).not.toContain("Protected paths are no longer hidden");
    expect(h.plugin.deviceSettings.derivedProtectedPaths).toEqual(derived);
  });

  it("a footprint toggle pressed before any status fetches one itself, then asks", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    // partialFilter present keeps the one-time sparse offer out of the count.
    answeringStatus(h, 14, { partialFilter: "blob:none" });
    expect(h.plugin.footprintState()).toBeNull(); // nothing heard yet — the old code disabled the toggle here
    // Not awaited: the confirmation window the flow ends in only resolves when
    // a human answers it, and the mock's modals never do.
    void h.plugin.cmdShallowEnable();
    for (let i = 0; i < 200 && confirmModals() === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    // One status round trip, then the ordinary confirmation.
    expect(h.plugin.footprintState()).toEqual({ shallow: false, partial: true });
    expect(confirmModals()).toBe(1);
  });

  it("a toggle asking for the state the repository is already in just says so", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answeringStatus(h, 14, { shallow: "true", partialFilter: "blob:none" });
    await h.plugin.cmdShallowEnable();
    expect(confirmModals()).toBe(0);
    expect(__notices.join(" ")).toContain("already shallow");
  });

  it("offers partial clone ONCE when sparse is on and the runner can serve it", async () => {
    // okStatusResult's fixture repository has sparse enabled and no filter,
    // which is exactly the state the offer exists for.
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answeringStatus(h, 14);
    await h.plugin.cmdStatus(true);
    const afterFirst = confirmModals();
    expect(afterFirst).toBeGreaterThan(0);
    await h.plugin.cmdStatus(true);
    expect(confirmModals()).toBe(afterFirst); // once per device, not per status
  });

  it("stays silent on a runner older than v14, and once partial is already on", async () => {
    const h = await loadPlugin();
    await enableBridge(h);
    h.useFastClient();
    answeringStatus(h, 13);
    await h.plugin.cmdStatus(true);
    expect(confirmModals()).toBe(0);

    const h2 = await loadPlugin();
    await enableBridge(h2);
    h2.useFastClient();
    answeringStatus(h2, 14, { partialFilter: "blob:none" });
    await h2.plugin.cmdStatus(true);
    expect(__openedModals.filter((m) => m === "ConfirmModal").length).toBe(0);
  });
});

/**
 * Version advice compares the runner against the RANGE a correct installation
 * can be in, [RUNNER_MIN_VERSION, RUNNER_SHIPPED_VERSION]. It used to compare
 * against the floor alone, so 0.6.3 (floor 12, shipping v13) told every
 * correctly installed device its runner was "NEWER than this plugin expects" —
 * the user met the same message the moment they installed v14.
 */
describe("runner version advice", () => {
  const adviceFor = async (runnerVersion: number) => {
    const h = await loadPlugin();
    (h.plugin as Any).lastRunnerVersion = runnerVersion;
    return h.plugin.versionAdvice().filter((a) => a.part === "runner");
  };

  it("says nothing for any runner the plugin actually ships or accepts", async () => {
    expect(await adviceFor(12)).toEqual([]);
    expect(await adviceFor(13)).toEqual([]);
    expect(await adviceFor(14)).toEqual([]);
    expect(await adviceFor(15)).toEqual([]);
  });

  it("flags a runner below the floor as outdated, with the reinstall route", async () => {
    const advice = await adviceFor(11);
    expect(advice).toHaveLength(1);
    expect(advice[0]!.text).toContain("older than this plugin needs");
  });

  it("flags a runner above the shipped version as the plugin being behind", async () => {
    const advice = await adviceFor(17);
    expect(advice).toHaveLength(1);
    expect(advice[0]!.text).toContain("NEWER than this plugin knows");
  });

  it("stays silent before the first result: 0 means never heard, not broken", async () => {
    expect(await adviceFor(0)).toEqual([]);
  });
});
