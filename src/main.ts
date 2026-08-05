import { Menu, Notice, Plugin, Platform, type WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_TIMEOUT_SECONDS,
  EMPTY_TREE_HASH,
  SPARSE_SAFETY_WARNING,
  STORAGE_PREFIX,
} from "./constants";
import type {
  BridgeAction,
  BridgeResult,
  GitStatusSummary,
  OperationMarker,
  SparseStateSummary,
} from "./types";
import { ACTION_MIN_RUNNER, MUTATING_ACTIONS } from "./types";
import {
  DeviceLocalSettingsStore,
  type DeviceLocalSettings,
  type KeyValueBackend,
} from "./settings/DeviceLocalSettingsStore";
import { NativeGitBridgeSettingTab } from "./settings/SettingsTab";
import { BridgeClient, CancelToken, type RuntimeFS } from "./bridge/BridgeClient";
import { RuntimePaths } from "./bridge/runtimePaths";
import { createRequest } from "./bridge/protocol";
import { CompanionIntentTransport, type TriggerTransport } from "./bridge/transport";
import {
  groupUntrackedChildren,
  parseLastCommit,
  parseSparseState,
  parseStatusPorcelainV2,
  sparseExclusionPaths,
} from "./git/parsers";
import { evaluateSparseSafety } from "./git/sparseSafety";
import {
  hasControlChars,
  validateProtectedPaths,
  validateRepoRelativePath,
} from "./settings/pathValidation";
import { OperationLock, isMarkerStale } from "./ops/OperationLock";
import { OperationLog } from "./ops/OperationLog";
import { StatusBarController } from "./ui/StatusBarController";
import {
  ChangedFilesModal,
  ConfirmModal,
  ResultModal,
  type ResultModalAction,
  SparseSafetyModal,
  StatusModal,
} from "./ui/modals";
import { DiagnosticsModal, type DiagnosticsReport } from "./ui/DiagnosticsModal";
import { CommitMessageModal, ConflictModal } from "./ui/gitModals";
import { parsePairingFile } from "./settings/pairing";
import {
  bytesToTextIfNotBinary,
  decodeBase64ToBytes,
  parseFileLog,
  parseRepoLog,
  type FileLogEntry,
  type RepoLogEntry,
  type RepoLogFile,
} from "./git/historyParsers";
import { DiffModal, FileHistoryModal, TextPreviewModal } from "./ui/historyViews";
import { NGB_STATUS_VIEW, StatusView, summaryToViewData, type Group } from "./ui/StatusView";
import { HistoryView, NGB_HISTORY_VIEW } from "./ui/HistoryView";
import { DiffView, NGB_DIFF_VIEW, type DiffViewState } from "./ui/DiffView";
import { ConflictView, NGB_CONFLICT_VIEW } from "./ui/ConflictView";
import { runSelfCheck } from "./bridge/selfCheck";
import { registerIcons } from "./ui/icons";
import {
  COMPANION_DOWNLOAD_APK_URI,
  COMPANION_GET_TERMUX_URI,
  COMPANION_OPEN_TERMUX_URI,
  COMPANION_RELEASES_URL,
  COMPANION_SETUP_URI,
  PAIRING_FILE,
  bootstrapCommand,
  RUNNER_MIN_VERSION,
  RUNNER_OUTDATED_HINT,
  TERMUX_FDROID_URL,
  TERMUX_SITE_URL,
} from "./constants";
import { TFile } from "obsidian";
import { OperationLogModal } from "./ui/OperationLogModal";

/** Non-device-specific, shareable UI preferences (safe to sync via data.json). */
interface SharedUiPrefs {
  showStatusBar: boolean;
  showRibbonIcon: boolean;
  /** Wrap long lines in the diff pane instead of scrolling horizontally. */
  wrapDiffLines: boolean;
  /** Render whitespace glyphs (· → ␍) in the diff pane. */
  showInvisibles: boolean;
  /** Render file lists as a folder tree (status + history panels). */
  treeView: boolean;
}
const DEFAULT_SHARED_PREFS: SharedUiPrefs = {
  showStatusBar: true,
  showRibbonIcon: true,
  wrapDiffLines: false,
  showInvisibles: false,
  treeView: false,
};

const MARKER_KEY = "active-op";
const LAST_SYNC_KEY = "last-sync";

export default class NativeGitBridgePlugin extends Plugin {
  store!: DeviceLocalSettingsStore;
  deviceSettings!: DeviceLocalSettings;
  sharedPrefs: SharedUiPrefs = { ...DEFAULT_SHARED_PREFS };
  log!: OperationLog;
  client!: BridgeClient;
  lock!: OperationLock;
  statusBar: StatusBarController | null = null;

  private activeCancel: CancelToken | null = null;
  private progressText: string | null = null;
  private runningAction: string | null = null;
  /** Target path of the running action, when it is per-path (stage/unstage/discard file). */
  private runningPath: string | null = null;
  private lastStatus: { status: GitStatusSummary; sparse: SparseStateSummary; lastCommit?: { hash: string; date: string; subject: string }; fetchedAt: string } | null = null;

  async onload(): Promise<void> {
    // ---- device-local settings (never synced through the vault) ----
    this.store = new DeviceLocalSettingsStore(getLocalStorageBackend(), this.resolveScopeId());
    this.deviceSettings = this.store.read();
    this.lastRunnerVersion = Number(this.store.getValue("last-runner-version") ?? 0) || 0;
    this.lastCompanionVersion = this.store.getValue("last-companion-version") ?? "";
    this.log = new OperationLog(this.store);

    // ---- shared, non-device-specific UI prefs only ----
    const data = (await this.loadData()) as Partial<SharedUiPrefs> | null;
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS, ...(data ?? {}) };

    registerIcons();
    const paths = new RuntimePaths(this.app.vault.configDir);
    this.client = new BridgeClient(this.makeRuntimeFS(), paths);
    this.lock = new OperationLock((marker) => this.persistMarker(marker));

    if (this.sharedPrefs.showStatusBar) {
      this.statusBar = new StatusBarController(this.addStatusBarItem(), () => this.openStatusModal());
    }
    if (this.sharedPrefs.showRibbonIcon) {
      this.addRibbonIcon("git-branch", "Native Git: status panel", () => {
        void this.openStatusPanel();
        void this.cmdStatus(true);
      });
    }

    this.registerView(
      NGB_STATUS_VIEW,
      (leaf: WorkspaceLeaf) =>
        new StatusView(leaf, {
          refresh: () => void this.cmdStatus(true),
          sync: () => void this.cmdSync(),
          pull: () => void this.cmdPull(),
          push: () => void this.cmdPush(),
          fetch: () => void this.cmdFetch(),
          commit: () => void this.cmdCommit(),
          stageAll: () => void this.cmdStageAll(),
          unstageAll: () => void this.cmdUnstageAll(),
          openLog: () => new OperationLogModal(this.app, this.log).open(),
          toggleTree: () => void this.setSharedPref({ treeView: !this.sharedPrefs.treeView }),
          folderAction: (group, folderPath, kind) => this.folderAction(group, folderPath, kind),
          openHistory: () => void this.openHistoryPanel(),
          cancel: () => void this.cmdCancel(),
          openFile: (p) => this.openVaultFile(p),
          openDiff: (p, group) => void this.openStatusDiff(p, group),
          openConflict: (p, pos) => void this.openConflict(p, pos),
          stage: (p) => void this.cmdStageFile(p),
          unstage: (p) => void this.cmdUnstageFile(p),
          discard: (p) => this.cmdDiscardFile(p),
          fileMenu: (menu, p) => this.buildGitMenu(menu, p),
        })
    );

    this.registerView(
      NGB_HISTORY_VIEW,
      (leaf: WorkspaceLeaf) =>
        new HistoryView(leaf, {
          loadPage: (skip, limit) => this.loadRepoLogPage(skip, limit),
          openDiffAtCommit: (file, entry) => void this.openCommitDiff(file, entry),
          openFile: (p) => this.openVaultFile(p),
          treeView: () => this.sharedPrefs.treeView,
          toggleTree: () => void this.setSharedPref({ treeView: !this.sharedPrefs.treeView }),
        })
    );

    this.registerView(
      NGB_DIFF_VIEW,
      (leaf: WorkspaceLeaf) =>
        new DiffView(leaf, {
          loadDiff: (path, from, to) => this.loadDiffText(path, from, to),
          wrapLines: () => this.sharedPrefs.wrapDiffLines,
          showInvisibles: () => this.sharedPrefs.showInvisibles,
        })
    );

    this.registerView(
      NGB_CONFLICT_VIEW,
      (leaf: WorkspaceLeaf) =>
        new ConflictView(leaf, {
          readFile: (p) => this.readVaultTextFile(p),
          writeFile: async (p, content) => {
            await this.app.vault.adapter.write(p, content);
          },
          stageFile: (p) => this.cmdStageFile(p),
        })
    );

    this.addSettingTab(new NativeGitBridgeSettingTab(this.app, this));
    this.registerCommands();
    this.registerFileMenu();

    this.app.workspace.onLayoutReady(() => {
      void this.startupChecks();
    });
    this.registerAutomaticActions();
  }

  /**
   * Right-click / long-tap entries on files and folders: stage/unstage,
   * .gitignore, sparse hide/show, .git/info/exclude. All decisions come from
   * in-memory caches (last status, .gitignore, exclude list) because menu
   * building is synchronous — no Termux round trip here.
   */
  private registerFileMenu(): void {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        this.buildGitMenu(menu, file.path);
      })
    );
  }

  /**
   * The Git entries for one file or folder. Shared by the file explorer's
   * file-menu and the long-press / right-click menu on rows in the status
   * panel, so the two can never drift apart.
   */
  buildGitMenu(menu: Menu, path: string): void {
    {
        if (!Platform.isAndroidApp) return;
        if (!this.deviceSettings.enabledOnThisDevice) return;
        const v = validateRepoRelativePath(path);
        if (!v.ok) return;
        const p = v.normalized;

        const st = this.lastStatus?.status;
        const staged = st?.staged.some((e) => e.path === p || e.path.startsWith(p + "/")) ?? false;
        const unstaged =
          (st?.unstaged.some((e) => e.path === p || e.path.startsWith(p + "/")) ?? false) ||
          (st?.untracked.some((u) => u === p || u.startsWith(p + "/")) ?? false);
        const conflicted = st?.conflicted.some((e) => e.path === p) ?? false;

        // Conflict entries first: they are the only sensible actions while a
        // file is unmerged, and the tap-on-binary-conflict path lands here.
        if (conflicted) {
          menu.addItem((i) =>
            i
              .setTitle("Git: Resolve — keep local version (yours)")
              .setIcon("check")
              .onClick(() => this.cmdResolveConflict(p, "ours"))
          );
          menu.addItem((i) =>
            i
              .setTitle("Git: Resolve — keep remote version")
              .setIcon("check-check")
              .onClick(() => this.cmdResolveConflict(p, "theirs"))
          );
          menu.addItem((i) =>
            i
              .setTitle("Open in default app")
              .setIcon("external-link")
              .onClick(() => this.openWithDefaultApp(p))
          );
        }

        if (unstaged || !st) {
          menu.addItem((i) =>
            i.setTitle("Git: Stage").setIcon("plus-circle").onClick(() => void this.cmdStageFile(p))
          );
        }
        if (staged) {
          menu.addItem((i) =>
            i.setTitle("Git: Unstage").setIcon("minus-circle").onClick(() => void this.cmdUnstageFile(p))
          );
        }

        if (this.deviceSettings.menuGitignore) {
          if (this.isGitignored(p)) {
            menu.addItem((i) =>
              i.setTitle("Git: Remove from .gitignore").setIcon("eye").onClick(() => void this.gitignoreRemove(`/${p}`))
            );
          } else {
            menu.addItem((i) =>
              i.setTitle("Git: Add to .gitignore").setIcon("eye-off").onClick(() => void this.gitignoreAdd(`/${p}`))
            );
          }
        }

        if (!this.deviceSettings.menuSparse) {
          /* sparse entries hidden by settings */
        } else if (this.isSparseExcluded(p)) {
          menu.addItem((i) =>
            i
              .setTitle("Git: Show again (remove sparse exclusion)")
              .setIcon("eye")
              .onClick(() => void this.cmdSparseExclude(p, false))
          );
        } else {
          menu.addItem((i) =>
            i
              .setTitle("Git: Hide on this device (sparse)")
              .setIcon("eye-off")
              .onClick(() => void this.cmdSparseExclude(p, true))
          );
        }

        if (!this.deviceSettings.menuExclude) {
          /* exclude entries hidden by settings */
        } else if (this.isExcluded(p)) {
          menu.addItem((i) =>
            i
              .setTitle("Git: Remove from .git exclude")
              .setIcon("eye")
              .onClick(() => void this.cmdExcludeChange(p, false))
          );
        } else {
          menu.addItem((i) =>
            i
              .setTitle("Git: Add to .git exclude (local ignore)")
              .setIcon("eye-off")
              .onClick(() => void this.cmdExcludeChange(p, true))
          );
        }
    }
  }

  private lastAutoSyncMs = 0;

  private statusPollId: number | null = null;

  /**
   * (Re)start the status auto-refresh timer (Settings → "Auto-refresh
   * status"). Fires only while the status panel exists, Obsidian is visible
   * and nothing is in flight — every refresh is a Termux round trip.
   */
  restartStatusPoll(): void {
    if (this.statusPollId !== null) {
      window.clearInterval(this.statusPollId);
      this.statusPollId = null;
    }
    const secs = Math.floor(this.deviceSettings.statusRefreshSeconds);
    if (!Number.isFinite(secs) || secs <= 0) return;
    this.statusPollId = window.setInterval(() => {
      void this.maybeAutoStatus();
    }, secs * 1000);
    this.registerInterval(this.statusPollId);
  }

  private async maybeAutoStatus(): Promise<void> {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (document.visibilityState === "hidden") return;
    if (this.lock.active || this.runningAction !== null) return;
    if (this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW).length === 0) return;
    await this.cmdStatus(true);
  }

  private registerAutomaticActions(): void {
    this.restartStatusPoll();
    const s = this.deviceSettings;
    if (s.periodicSyncMinutes > 0) {
      this.registerInterval(
        window.setInterval(() => {
          void this.maybeAutoSync("periodic");
        }, s.periodicSyncMinutes * 60_000)
      );
    }
    if (s.autoSyncOnClose) {
      // Fire-and-forget during the close/background transition: the request is
      // queued and the transport triggered, but we do not poll for a result.
      const onHide = () => {
        if (document.visibilityState === "hidden") void this.queueSyncAndForget();
      };
      this.registerDomEvent(document, "visibilitychange", onHide);
    }
  }

  private async maybeAutoSync(reason: string): Promise<void> {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (this.lock.active) return;
    const minGap = s.minAutoSyncIntervalMinutes * 60_000;
    if (Date.now() - this.lastAutoSyncMs < minGap) return;
    if (!this.autoActionAllowed()) return;
    this.lastAutoSyncMs = Date.now();
    this.log.add("info", "auto", `Automatic sync (${reason}).`);
    await this.cmdSync(undefined, true);
  }

  /** Queue a sync request without waiting (used only on close/background). */
  private async queueSyncAndForget(): Promise<void> {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (this.lock.active) return;
    const minGap = s.minAutoSyncIntervalMinutes * 60_000;
    if (Date.now() - this.lastAutoSyncMs < minGap) return;
    this.lastAutoSyncMs = Date.now();
    try {
      const req = createRequest(
        "sync",
        { protectedPaths: this.effectiveProtectedPaths(), message: "vault sync on close (native git bridge)" },
        s.authToken,
        s.opTimeoutSeconds
      );
      await this.client.submit(req);
      this.makeTransport().trigger(req.id);
      this.log.add("info", "auto", `Sync-on-close request ${req.id} queued (fire and forget).`);
    } catch (e) {
      this.log.add("warn", "auto", `Sync-on-close queueing failed: ${String(e)}`);
    }
  }

  onunload(): void {
    // Stop any in-flight polling; a dispatched Termux command may still finish
    // and write its result file, which is reconciled on next startup. No
    // listener, server or background service remains.
    this.activeCancel?.cancel();
  }

  // --------------------------------------------------------------- messaging

  /**
   * Route a short informational message according to the device setting.
   * Failures never go through here — they always surface as a modal.
   *
   * Note: an Obsidian plugin cannot raise native Android toasts; the choices are
   * an in-app notice, the status panel, or the log only.
   */
  private notify(message: string): void {
    const mode = this.deviceSettings.notificationMode;
    this.log.add("info", "notify", message);
    if (mode === "notice") new Notice(message);
    else if (mode === "status-only") {
      this.progressText = message;
      this.updateProgressInView(message);
      window.setTimeout(() => {
        if (this.progressText === message) {
          this.progressText = null;
          this.updateProgressInView(null);
        }
      }, 4000);
    }
    // "log-only": nothing else to do.
  }

  /** Result window for a SUCCESSFUL operation: shown only when enabled. */
  private reportSuccess(title: string, lines: string[], stdout?: string): void {
    if (this.deviceSettings.showSuccessModals) {
      new ResultModal(this.app, title, lines, { stdout }).open();
    } else {
      this.notify(`${title}: ${lines[0] ?? "done"}`);
      if (stdout) this.log.add("info", "result", title, stdout);
    }
  }

  // ------------------------------------------------------------------ setup

  private resolveScopeId(): string {
    const appId = (this.app as unknown as { appId?: string }).appId;
    if (typeof appId === "string" && appId.length > 0) return appId;
    // Fallback: persist a random UUID under a vault-name-scoped global key.
    const backend = getLocalStorageBackend();
    const fallbackKey = `${STORAGE_PREFIX}:__scope:${this.app.vault.getName()}`;
    try {
      const existing = backend?.getItem(fallbackKey);
      if (existing) return existing;
      const fresh = `v-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      backend?.setItem(fallbackKey, fresh);
      return fresh;
    } catch {
      return `volatile-${this.app.vault.getName()}`;
    }
  }

  private makeRuntimeFS(): RuntimeFS {
    const adapter = this.app.vault.adapter;
    return {
      exists: (p) => adapter.exists(p),
      read: (p) => adapter.read(p),
      write: (p, d) => adapter.write(p, d),
      mkdir: (p) => adapter.mkdir(p),
      remove: (p) => adapter.remove(p),
      listFiles: async (p) => (await adapter.list(p)).files,
    };
  }

  private async startupChecks(): Promise<void> {
    this.refreshStatusBarIdle();
    this.warnIfObsidianGitEnabledOnAndroid();
    await this.tryImportPairing();
    await this.reconcileAfterRestart();
    await this.loadGitignore(); // warm the cache so the file menu decides synchronously
    // Fresh install: nothing works yet and nothing explains why. Show the
    // guide once (device-local flag), and only on Android, where the bridge
    // can actually exist.
    if (
      Platform.isAndroidApp &&
      !this.deviceSettings.authToken &&
      !this.store.getValue("setup-guide-shown")
    ) {
      this.store.setValue("setup-guide-shown", "1");
      this.openSetupGuide("First run: this device is not set up yet.");
    }
    if (this.deviceSettings.enabledOnThisDevice && this.deviceSettings.autoPullOnOpen) {
      if (this.autoActionAllowed()) {
        this.log.add("info", "auto", "Auto pull on open.");
        void this.cmdPull(true);
      }
    }
  }

  /** Best-effort gates for automatic actions (Wi-Fi / battery), default permissive. */
  private autoActionAllowed(): boolean {
    const s = this.deviceSettings;
    try {
      if (s.wifiOnly) {
        const conn = (navigator as unknown as { connection?: { type?: string } }).connection;
        if (conn?.type && conn.type !== "wifi") return false;
      }
    } catch {
      /* API unavailable: do not block */
    }
    return true;
  }

  /**
   * obsidian-git is truly active only if it is in the enabled plugin list AND
   * not switched off via its own device-local, non-synced toggle
   * (app.loadLocalStorage("obsidian-git:pluginDisabled") === "true"). Keeping
   * it "enabled" in community-plugins.json (which syncs through the vault)
   * while device-disabled is a perfectly valid setup and must not be flagged.
   */
  private isObsidianGitActiveOnDevice(): boolean {
    const plugins = (this.app as unknown as {
      plugins?: { enabledPlugins?: Set<string> };
    }).plugins;
    if (!plugins?.enabledPlugins?.has("obsidian-git")) return false;
    let disabled: string | null = null;
    try {
      const load = (this.app as unknown as {
        loadLocalStorage?: (key: string) => string | null;
      }).loadLocalStorage;
      if (typeof load === "function") disabled = load.call(this.app, "obsidian-git:pluginDisabled");
    } catch {
      /* fall through */
    }
    if (disabled === null || disabled === undefined) {
      try {
        disabled = window.localStorage.getItem("obsidian-git:pluginDisabled");
      } catch {
        /* unavailable */
      }
    }
    return disabled !== "true";
  }

  private warnIfObsidianGitEnabledOnAndroid(): void {
    if (!Platform.isAndroidApp) return;
    if (this.deviceSettings.suppressObsidianGitWarning) return;
    if (!this.isObsidianGitActiveOnDevice()) return;
    this.log.add("warn", "compat", "obsidian-git ACTIVE on this Android device alongside Native Git Bridge.");
    new ConfirmModal(
      this.app,
      {
        title: "Plugin compatibility warning",
        body: [
          "The 'Git' (obsidian-git) plugin is ACTIVE on this Android device.",
          "Its mobile backend (isomorphic-git) does not understand native sparse-checkout / skip-worktree index data and may stage protected paths as deletions.",
          "Recommended fix that keeps sync intact: open obsidian-git settings and enable its own 'Disable on this device' toggle (it is not synced), instead of disabling the plugin globally.",
          "Native Git Bridge will never disable another plugin automatically.",
        ],
        confirmLabel: "Don't warn again on this device",
        icon: "bell-off",
      },
      async (dontWarnAgain) => {
        if (dontWarnAgain) await this.updateDeviceSettings({ suppressObsidianGitWarning: true });
      }
    ).open();
  }

  /**
   * Import the token dropped by the Termux installer (runtime/pairing.json),
   * then delete the file. Overwriting an existing, different token requires
   * explicit confirmation.
   */
  private async tryImportPairing(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/runtime/${PAIRING_FILE}`;
    try {
      if (!(await adapter.exists(path))) return;
      const pairing = parsePairingFile(await adapter.read(path));
      if (!pairing) {
        this.log.add("warn", "pairing", "pairing.json present but invalid; ignoring.");
        return;
      }
      const apply = async () => {
        await this.updateDeviceSettings({
          authToken: pairing.token,
          repoPathHint: pairing.repoPath ?? this.deviceSettings.repoPathHint,
          termuxIntegrationEnabled: true,
        });
        try {
          await adapter.remove(path);
        } catch {
          /* best effort */
        }
        this.log.add("info", "pairing", "Pairing token imported from Termux installer.");
        this.notify("Native Git Bridge: paired with the Termux runner.");
      };
      const current = this.deviceSettings.authToken;
      if (current === "" || current === pairing.token) {
        await apply();
      } else {
        new ConfirmModal(
          this.app,
          {
            title: "Replace pairing token?",
            body: [
              "A new pairing file from the Termux installer was found, but this device already has a different token.",
              "Replace it only if you re-ran the installer on purpose.",
            ],
            confirmLabel: "Replace token",
            danger: true,
          },
          async (confirmed) => {
            if (confirmed) await apply();
          }
        ).open();
      }
    } catch (e) {
      this.log.add("warn", "pairing", `Pairing import failed: ${String(e)}`);
    }
  }

  private async reconcileAfterRestart(): Promise<void> {
    const raw = this.store.getValue(MARKER_KEY);
    if (!raw) {
      await this.client.cleanupOld();
      return;
    }
    let marker: OperationMarker | null = null;
    try {
      marker = JSON.parse(raw) as OperationMarker;
    } catch {
      /* ignore */
    }
    this.store.removeValue(MARKER_KEY);
    if (!marker) return;
    // Was a result produced while we were gone?
    const outcome = await this.client.awaitResult(marker.id, 1, undefined);
    if (outcome.kind === "result") {
      this.log.add(
        "info",
        marker.action,
        `Recovered result for operation ${marker.id} finished while Obsidian was closed (ok=${outcome.result.ok}).`
      );
      await this.client.consume(marker.id);
    } else if (isMarkerStale(marker)) {
      this.log.add("warn", marker.action, `Cleared stale operation lock ${marker.id} from a previous session.`);
    } else {
      this.log.add(
        "warn",
        marker.action,
        `Operation ${marker.id} from the previous session has no result yet; it may still be running in Termux. Its result will be cleaned up automatically.`
      );
    }
    await this.client.cleanupOld();
  }

  private persistMarker(marker: OperationMarker | null): void {
    if (marker) this.store.setValue(MARKER_KEY, JSON.stringify(marker));
    else this.store.removeValue(MARKER_KEY);
  }

  // -------------------------------------------------------------- settings

  async updateDeviceSettings(patch: Partial<DeviceLocalSettings>): Promise<void> {
    this.deviceSettings = this.store.write(patch);
    this.refreshStatusBarIdle();
  }

  async resetDeviceSettings(): Promise<void> {
    this.store.reset();
    this.deviceSettings = this.store.read();
    this.refreshStatusBarIdle();
    new Notice("Native Git Bridge: device-local settings reset.");
  }

  private refreshStatusBarIdle(): void {
    if (!this.statusBar) return;
    if (!this.deviceSettings.enabledOnThisDevice) this.statusBar.set("disabled");
    else if (this.lock.active) this.statusBar.set("syncing");
    else if (this.lastStatus) this.applyStatusToStatusBar(this.lastStatus.status);
    else this.statusBar.set("clean");
  }

  private applyStatusToStatusBar(s: GitStatusSummary): void {
    if (!this.statusBar) return;
    if (s.conflicted.length > 0) this.statusBar.set("conflict", `(${s.conflicted.length})`);
    else if (s.staged.length + s.unstaged.length + s.untracked.length > 0)
      this.statusBar.set("changed", `(${s.staged.length + s.unstaged.length + s.untracked.length})`);
    else this.statusBar.set("clean", s.ahead > 0 ? `↑${s.ahead}` : undefined);
  }

  // -------------------------------------------------------------- commands

  private registerCommands(): void {
    const cmds: { id: string; name: string; cb: () => void }[] = [
      { id: "status", name: "Native Git: Status", cb: () => void this.cmdStatus() },
      { id: "pull", name: "Native Git: Pull", cb: () => void this.cmdPull() },
      { id: "push", name: "Native Git: Push", cb: () => void this.cmdPush() },
      { id: "commit", name: "Native Git: Commit", cb: () => void this.cmdCommit() },
      { id: "sync", name: "Native Git: Sync", cb: () => void this.cmdSync() },
      { id: "fetch", name: "Native Git: Fetch", cb: () => void this.cmdFetch() },
      { id: "stage-all", name: "Native Git: Stage all changes", cb: () => void this.cmdStageAll() },
      { id: "unstage-all", name: "Native Git: Unstage all changes", cb: () => void this.cmdUnstageAll() },
      { id: "show-history-current-file", name: "Native Git: Show history for current file", cb: () => this.cmdFileHistory() },
      { id: "show-diff-current-file", name: "Native Git: Show diff for current file", cb: () => void this.cmdDiffCurrentFile() },
      { id: "show-file-at-commit", name: "Native Git: Show selected file at commit", cb: () => this.cmdFileHistory() },
      { id: "restore-file-from-commit", name: "Native Git: Restore selected file from commit", cb: () => this.cmdFileHistory() },
      { id: "show-changed-files", name: "Native Git: Show changed files", cb: () => void this.cmdShowChangedFiles() },
      { id: "verify-sparse-safety", name: "Native Git: Verify sparse checkout safety", cb: () => void this.cmdVerifySparseSafety() },
      { id: "reapply-sparse", name: "Native Git: Reapply sparse checkout", cb: () => void this.cmdReapplySparse() },
      { id: "diagnostics", name: "Native Git: Run diagnostics", cb: () => void this.cmdDiagnostics() },
      { id: "open-operation-log", name: "Native Git: Open operation log", cb: () => new OperationLogModal(this.app, this.log).open() },
      { id: "open-status-panel", name: "Native Git: Open status panel", cb: () => void this.openStatusPanel() },
      { id: "open-history-panel", name: "Native Git: Open history panel", cb: () => void this.openHistoryPanel() },
      { id: "bridge-self-check", name: "Native Git: Check bridge (no Termux round trip)", cb: () => void this.cmdSelfCheck() },
      { id: "open-companion-setup", name: "Native Git: Open companion app setup", cb: () => void this.openCompanionSetup() },
      { id: "setup-guide", name: "Native Git: Setup guide (Termux, companion, pairing)", cb: () => this.openSetupGuide("Setup guide.") },
      { id: "cancel-operation", name: "Native Git: Cancel current operation when possible", cb: () => void this.cmdCancel() },
    ];
    for (const c of cmds) this.addCommand({ id: c.id, name: c.name, callback: c.cb });

    // The companion bounces this back for every URI it handles — the
    // deterministic "companion installed and reachable" signal.
    this.registerObsidianProtocolHandler("native-git-bridge-ack", (params) => {
      const p = params as Record<string, string> | undefined;
      this.onCompanionAck(p?.src, p?.termux, p?.cv);
    });
  }

  // ------------------------------------------------------------ operations

  /** Guard + queue + trigger + await one bridge operation. */
  private async runOperation(
    action: BridgeAction,
    args: Record<string, unknown> = {}
  ): Promise<BridgeResult | null> {
    const s = this.deviceSettings;
    if (!Platform.isAndroidApp) {
      // The whole transport (companion app -> Termux RUN_COMMAND) exists only
      // on Android; anywhere else a request could only ever time out.
      new Notice(
        "Native Git Bridge works on Android only (it delegates git to Termux). " +
          "On desktop, use git directly or the obsidian-git plugin."
      );
      return null;
    }
    // Not configured yet: show the actionable setup guide instead of a dead-end
    // notice. A fresh install has no token, and the old message ("run the
    // installer, then paste the token") never mentioned that the companion app
    // and Termux come first.
    if (!s.enabledOnThisDevice) {
      this.openSetupGuide("Native Git Bridge is not enabled on this device yet.");
      return null;
    }
    if (!s.termuxIntegrationEnabled) {
      this.openSetupGuide("Termux integration is switched off on this device.");
      return null;
    }
    if (!s.authToken) {
      this.openSetupGuide("This device is not paired with a Termux runner yet.");
      return null;
    }
    // Actions introduced with a newer runner would come back as a bare
    // BAD_REQUEST ("action not allowed") from an old one, which reads like a
    // plugin bug. Name the real cause before spending a round trip.
    const needsRunner = ACTION_MIN_RUNNER.get(action);
    if (
      this.lastRunnerVersion > 0 &&
      needsRunner !== undefined &&
      this.lastRunnerVersion < needsRunner
    ) {
      new ResultModal(
        this.app,
        "Termux runner is too old for this action",
        [
          `'${action}' needs runner v${needsRunner}; this device answers with v${this.lastRunnerVersion}.`,
          RUNNER_OUTDATED_HINT,
        ],
        {
          isError: true,
          actions: [
            {
              label: "Copy command & open Termux",
              cta: true,
              keepOpen: true,
              onClick: () => this.copyCommandAndOpenTermux(),
            },
          ],
        }
      ).open();
      return null;
    }

    const req = createRequest(action, args, s.authToken, s.opTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
    const mutating = MUTATING_ACTIONS.has(action);
    if (mutating && !this.lock.tryAcquire(req.id, action)) {
      new Notice(`Another operation is running (${this.lock.active?.action}). Try again later.`);
      return null;
    }
    // Read-only ops run without the lock but still refuse to overlap a mutation.
    if (!mutating && this.lock.active && MUTATING_ACTIONS.has(this.lock.active.action)) {
      new Notice(`A ${this.lock.active.action} operation is running; try again when it finishes.`);
      return null;
    }

    const cancel = new CancelToken();
    this.activeCancel = cancel;
    this.statusBar?.set("syncing");
    this.pushStatusToView();
    this.log.add("info", action, `Queued request ${req.id}.`);
    // Progress is rendered at the BOTTOM of the status panel (a top notice would
    // cover the editor on mobile). The panel is opened if it is not visible yet.
    void this.openStatusPanel(false);
    const startedAt = Date.now();
    this.runningAction = action;
    // Per-path actions carry their target so the status panel can animate the
    // acted row only, instead of every control sharing the action name.
    this.runningPath = typeof args["path"] === "string" ? (args["path"] as string) : null;
    this.progressText = `${action}… 0s`;
    this.pushStatusToView();
    const ticker = window.setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      this.progressText = `${action}… ${secs}s`;
      // Text-only update: a full re-render would restart the toolbar animations.
      this.updateProgressInView(this.progressText);
    }, 1000);

    try {
      await this.client.submit(req);
      const ackBaseline = this.lastCompanionAckMs;
      this.makeTransport().trigger(req.id);
      const waited = await this.client.awaitResult(req.id, req.timeoutSeconds * 1000, cancel);
      if (waited.kind === "timeout") {
        // Write the cancel flag so an operation the user stopped waiting for
        // can never execute at some arbitrary later trigger (the runner skips
        // and archives cancelled requests; one already mid-flight in Termux is
        // unaffected and its orphan result is reconciled/swept later).
        await this.client.requestCancel(req.id);
        this.log.add(
          "warn",
          action,
          `Request ${req.id} timed out after ${req.timeoutSeconds}s (cancel flag written to prevent late execution).`
        );
        // Diagnose locally right away: a Termux round trip would time out too.
        await this.cmdSelfCheck(true);
        // A timeout usually means the trigger never reached the runner
        // (companion missing, permission not granted, allow-external-apps off).
        // If the companion ACKED this very trigger, it is installed and
        // reachable — the break is further down (Termux / runner / paths), so
        // opening its checklist would point at the wrong suspect. Otherwise
        // open the checklist — once per session, not on every retry.
        if (this.lastCompanionAckMs > ackBaseline) {
          this.log.add(
            "warn",
            action,
            "Companion acknowledged the trigger but no result arrived: the problem is on the Termux/runner side (see the bridge check)."
          );
        } else if (!this.companionSetupAutoOpened) {
          this.companionSetupAutoOpened = true;
          void this.openCompanionSetup(); // fire-and-forget: the probe must not delay the caller
        }
        return null;
      }
      if (waited.kind === "cancelled") {
        await this.client.requestCancel(req.id);
        this.log.add("warn", action, `Request ${req.id} cancelled by user.`);
        new Notice(`Native Git: ${action} cancelled.`);
        return null;
      }
      const result = waited.result;
      await this.client.consume(req.id);
      this.checkRunnerVersion(result);
      this.log.add(
        result.ok ? "info" : "error",
        action,
        `Request ${req.id} finished ok=${result.ok} exit=${result.exitCode}.`,
        result.error ? `${result.error.code}: ${result.error.message}` : undefined
      );
      return result;
    } catch (e) {
      this.log.add("error", action, `Bridge error: ${String(e)}`);
      new ResultModal(this.app, `Native Git: ${action} failed`, [String(e)], { isError: true }).open();
      return null;
    } finally {
      window.clearInterval(ticker);
      this.progressText = null;
      this.runningAction = null;
      this.runningPath = null;
      this.activeCancel = null;
      if (mutating) this.lock.release(req.id);
      this.refreshStatusBarIdle();
      this.pushStatusToView();
    }
  }

  /**
   * Warn once per session when the Termux-side runner predates this plugin
   * build. Updating main.js in the vault does not touch the runner script, so a
   * stale runner is a genuinely common failure mode (it shows up as
   * RUNNER_INTERNAL / serialization errors).
   */
  private runnerVersionWarned = false;
  private companionSetupAutoOpened = false;
  /** Last runner version reported by a result (0 = never heard from). */
  lastRunnerVersion = 0;
  private checkRunnerVersion(result: BridgeResult): void {
    const version = typeof result.runnerVersion === "number" ? result.runnerVersion : 1;
    // Remembered device-locally so settings/diagnostics can show it without a
    // round trip, and so the companion can be told which runner answers here.
    if (typeof result.runnerVersion === "number" && result.runnerVersion !== this.lastRunnerVersion) {
      this.lastRunnerVersion = result.runnerVersion;
      this.store.setValue("last-runner-version", String(result.runnerVersion));
    }
    if (version >= RUNNER_MIN_VERSION || this.runnerVersionWarned) return;
    this.runnerVersionWarned = true;
    this.log.add("warn", "compat", `Runner version ${version} < required ${RUNNER_MIN_VERSION}.`);
    new ResultModal(
      this.app,
      "Termux runner is outdated",
      [
        `Runner version: ${version} — this plugin needs ${RUNNER_MIN_VERSION}.`,
        RUNNER_OUTDATED_HINT,
      ],
      { isError: true }
    ).open();
  }

  private makeTransport(): TriggerTransport {
    return new CompanionIntentTransport(this.deviceSettings.companionUriTemplate, (uri) =>
      this.openExternalUri(uri)
    );
  }

  /**
   * Open an https URL the most reliable way available.
   *
   * Obsidian routes https to a Chrome Custom Tab, whose download session is
   * ephemeral — APK downloads started there frequently never reach Downloads.
   * The companion, being a real app, can fire a plain ACTION_VIEW that lands
   * in the default browser, where downloads behave normally. So: if a
   * companion has answered at least once, ask IT to open the URL; otherwise
   * fall back to Obsidian's own handling.
   *
   * `companionUri` must be a fixed companion host (the URL itself lives in the
   * companion), which keeps the "URI carries intent, never payload" property.
   */
  private openUrlPreferCompanion(companionUri: string, directUrl: string): void {
    if (this.lastCompanionAckMs > 0) this.openExternalUri(companionUri);
    else this.openExternalUri(directUrl);
  }

  private openExternalUri(uri: string): void {
    // Primary path; some WebViews return null without dispatching, so fall
    // back to a synthetic anchor click, which Obsidian routes to Android.
    let opened: Window | null = null;
    try {
      opened = window.open(uri);
    } catch {
      opened = null;
    }
    if (!opened) {
      const a = activeDocument.body.createEl("a", { href: uri, attr: { rel: "noopener" } });
      a.click();
      a.remove();
    }
  }

  /** Probe window used by the missing-companion detection; tests shrink it. */
  companionProbeMs = 4000;
  /** Time of the last obsidian://native-git-bridge-ack from the companion. */
  private lastCompanionAckMs = 0;
  /** What the companion reported about Termux (null until the first ack). */
  lastAckTermuxInstalled: boolean | null = null;
  /** Companion version from its ack ("" until one arrives). */
  lastCompanionVersion = "";
  private ackWaiters: Array<() => void> = [];

  /**
   * The companion (>= 0.4.0) bounces obsidian://native-git-bridge-ack back for
   * every URI it receives, giving a DETERMINISTIC "companion is installed and
   * reachable" signal — and, since 0.4.1, whether Termux itself is installed
   * (the WebView cannot query other packages; the companion can). Registered
   * in onload.
   */
  onCompanionAck(src?: string, termux?: string, companionVersion?: string): void {
    this.lastCompanionAckMs = Date.now();
    if (termux === "1") this.lastAckTermuxInstalled = true;
    else if (termux === "0") this.lastAckTermuxInstalled = false;
    if (companionVersion && /^[0-9.]{1,16}$/.test(companionVersion)) {
      this.lastCompanionVersion = companionVersion;
      this.store.setValue("last-companion-version", companionVersion);
    }
    this.log.add(
      "info",
      "companion",
      `Companion acknowledged (${src ?? "unknown"}; Termux installed: ${termux === "1" ? "yes" : termux === "0" ? "NO" : "unknown"}).`
    );
    for (const w of this.ackWaiters.splice(0)) w();
  }

  private awaitCompanionAck(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        const i = this.ackWaiters.indexOf(waiter);
        if (i >= 0) this.ackWaiters.splice(i, 1);
        resolve(false);
      }, timeoutMs);
      const waiter = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
      this.ackWaiters.push(waiter);
    });
  }

  /**
   * Secondary signal: the WebView losing visibility when another activity
   * comes to the front. Kept alongside the ack because a pre-0.4.0 companion
   * never acks — visibility is the only evidence it opened. Noisy by nature
   * (Obsidian goes background for many reasons), which is why the ack, when
   * available, decides first.
   */
  private awaitAppSwitch(): Promise<boolean> {
    return new Promise((resolve) => {
      if (document.visibilityState === "hidden") return resolve(true);
      const onChange = () => {
        cleanup();
        resolve(true);
      };
      const timer = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, this.companionProbeMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", onChange);
      };
      document.addEventListener("visibilitychange", onChange);
    });
  }

  /** True when the companion showed any sign of life within the probe window. */
  private async probeCompanion(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let misses = 0;
      const done = (alive: boolean) => {
        if (alive) resolve(true);
        else if (++misses === 2) resolve(false);
      };
      void this.awaitCompanionAck(this.companionProbeMs).then(done);
      void this.awaitAppSwitch().then(done);
    });
  }

  /**
   * Open the companion app's setup checklist. When nothing opens (no handler
   * for the scheme), the companion is not installed — explain and hand the
   * user the APK download link.
   */
  async openCompanionSetup(): Promise<void> {
    if (!Platform.isAndroidApp) {
      new Notice("The companion app exists only on Android.");
      return;
    }
    this.log.add("info", "companion", "Opening companion setup checklist.");
    // Version metadata for display only: the companion has no access to the
    // vault, so it cannot learn the plugin/runner versions any other way.
    // Numbers only — no paths, no token, nothing the companion acts upon.
    const q = `?pv=${encodeURIComponent(this.manifest.version)}&rv=${this.lastRunnerVersion}&rmin=${RUNNER_MIN_VERSION}`;
    this.openExternalUri(COMPANION_SETUP_URI + q);
    if (await this.probeCompanion()) return;
    this.log.add("warn", "companion", "Setup URI opened nothing - companion app likely not installed.");
    new ResultModal(
      this.app,
      "Companion app not installed?",
      [
        "Nothing opened, which usually means the Git Bridge Companion app is not installed on this device.",
        "The companion is the only supported trigger: it holds the Android permission to run the Termux runner. Without it, requests just time out.",
        "Copy the link below and paste it into your browser (Chrome/Firefox). That is the reliable route here: with no companion installed, Obsidian can only open its built-in browser tab, whose downloads are often discarded when the tab closes — so the APK never reaches Downloads.",
        `Latest release (companion APK): ${COMPANION_RELEASES_URL}`,
        "After installing, grant the 'Run commands in Termux environment' permission in the companion, then try again.",
      ],
      {
        actions: [
          {
            label: "Copy download link",
            cta: true,
            keepOpen: true,
            onClick: () => {
              void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
              new Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
            },
          },
          {
            label: "Try opening in browser",
            keepOpen: true,
            onClick: () => this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_RELEASES_URL),
          },
        ],
      }
    ).open();
  }

  // ------------------------------------------------------------- command impls

  async cmdStatus(silent = false): Promise<void> {
    const result = await this.runOperation("status");
    if (!result) return;
    if (!result.ok) {
      this.statusBar?.set("error");
      new ResultModal(
        this.app,
        "Native Git: status failed",
        [result.error?.message ?? "Unknown error."],
        { stdout: result.error?.stdout, stderr: result.error?.stderr, isError: true }
      ).open();
      return;
    }
    const d = result.data ?? {};
    const status = parseStatusPorcelainV2(d.branchInfo ?? "");
    if (d.untrackedChildren !== undefined)
      status.untrackedChildren = groupUntrackedChildren(d.untrackedChildren, status.untracked);
    const sparse = parseSparseState({
      sparseEnabled: d.sparseEnabled ?? "",
      sparseCone: d.sparseCone ?? "",
      sparseList: d.sparseList ?? "",
      skipWorktreeCount: d.skipWorktreeCount,
      lsFilesV: d.lsFilesV,
    });
    const lastCommit = parseLastCommit(d.lastCommit ?? "");
    this.absorbSparsePatterns(sparse);
    this.lastStatus = { status, sparse, lastCommit, fetchedAt: new Date().toLocaleString() };
    this.applyStatusToStatusBar(status);
    this.pushStatusToView();
    if (!silent) this.openStatusModal();
  }

  private openStatusModal(): void {
    new StatusModal(this.app, {
      status: this.lastStatus?.status,
      sparse: this.lastStatus?.sparse,
      lastCommit: this.lastStatus?.lastCommit,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? undefined,
      bridgeAvailable: this.deviceSettings.termuxIntegrationEnabled ? "enabled (companion app)" : "disabled",
      activeOperation: this.lock.active ? this.lock.active.action : undefined,
      fetchedAt: this.lastStatus?.fetchedAt,
    }).open();
  }

  async cmdShowChangedFiles(): Promise<void> {
    if (!this.lastStatus) {
      await this.cmdStatus(true);
    }
    if (this.lastStatus) {
      new ChangedFilesModal(this.app, this.lastStatus.status, this.lastStatus.fetchedAt).open();
    }
  }

  async cmdVerifySparseSafety(): Promise<void> {
    const protectedPaths = this.effectiveProtectedPaths();
    if (protectedPaths.length === 0) {
      new Notice("No protected sparse paths configured (see settings).");
      return;
    }
    const result = await this.runOperation("verify-sparse-safety", { protectedPaths });
    if (!result) return;
    if (!result.ok) {
      new ResultModal(
        this.app,
        "Sparse safety check could not run",
        [result.error?.message ?? "Unknown error."],
        { stdout: result.error?.stdout, stderr: result.error?.stderr, isError: true }
      ).open();
      return;
    }
    const d = result.data ?? {};
    const report = evaluateSparseSafety(d.statusProtected ?? "", d.stagedProtected ?? "", protectedPaths);
    if (!report.safe) this.statusBar?.set("error");
    new SparseSafetyModal(this.app, report, SPARSE_SAFETY_WARNING).open();
  }

  // -------------------- repo config management (sparse / gitignore / exclude)

  /** In-memory caches so the file context menu can decide add-vs-remove synchronously. */
  private gitignoreLines: string[] = [];
  private excludeLines: string[] = [];

  /** Hide (exclude=true) or materialize a path via non-cone sparse patterns. */
  async cmdSparseExclude(path: string, exclude: boolean): Promise<void> {
    const go = async () => {
      const result = await this.runOperation(exclude ? "sparse-exclude-add" : "sparse-exclude-remove", { path });
      if (!result) return;
      if (!result.ok) {
        new ResultModal(this.app, "Sparse change failed", [result.error?.message ?? "Unknown error."], {
          stdout: result.error?.stdout,
          stderr: result.error?.stderr,
          isError: true,
        }).open();
        return;
      }
      this.absorbStatusData(result.data ?? {});
      new Notice(exclude ? `Hidden via sparse checkout: ${path}` : `Materialized again: ${path}`);
    };
    if (exclude) {
      new ConfirmModal(
        this.app,
        {
          title: "Hide via sparse checkout?",
          body: [
            `'${path}' will be removed from THIS device's working tree (git sparse-checkout exclusion).`,
            "Nothing is deleted from the repository or other devices, and the path automatically joins the protected set, so it can never be committed as a deletion from here.",
          ],
          confirmLabel: "Hide on this device",
        },
        async (ok) => {
          if (ok) await go();
        }
      ).open();
    } else {
      await go();
    }
  }

  /** Add/remove a line in .git/info/exclude (device-local ignore, via the runner). */
  async cmdExcludeChange(path: string, add: boolean): Promise<void> {
    const result = await this.runOperation(add ? "exclude-add" : "exclude-remove", { path });
    if (!result) return;
    if (!result.ok) {
      new ResultModal(this.app, "Exclude change failed", [result.error?.message ?? "Unknown error."], {
        stdout: result.error?.stdout,
        stderr: result.error?.stderr,
        isError: true,
      }).open();
      return;
    }
    this.absorbExcludeList(result.data?.excludeList);
    new Notice(add ? `Added to .git/info/exclude: /${path}` : `Removed from exclude: ${path}`);
  }

  async refreshExcludeList(): Promise<string[] | null> {
    const result = await this.runOperation("exclude-list");
    if (!result?.ok) return null;
    this.absorbExcludeList(result.data?.excludeList);
    return this.excludeLines;
  }

  private absorbExcludeList(raw: string | undefined): void {
    if (raw === undefined) return;
    this.excludeLines = raw.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  }

  isExcluded(path: string): boolean {
    return [`/${path}`, path, `/${path}/`, `${path}/`].some((v) => this.excludeLines.includes(v));
  }

  // .gitignore is a plain tracked file in the vault: edited directly, no Termux.



  async loadGitignore(): Promise<string[]> {
    try {
      const raw = await this.app.vault.adapter.read(".gitignore");
      this.gitignoreLines = raw.split(/\r?\n/);
    } catch {
      this.gitignoreLines = [];
    }
    return this.gitignoreLines.filter((l) => l.trim() !== "");
  }

  isGitignored(path: string): boolean {
    const variants = [`/${path}`, path, `/${path}/`, `${path}/`];
    return this.gitignoreLines.some((l) => variants.includes(l.trim()));
  }

  async gitignoreAdd(entry: string): Promise<void> {
    if (entry.trim() === "" || hasControlChars(entry)) {
      new Notice("Invalid .gitignore entry.");
      return;
    }
    await this.loadGitignore();
    if (this.gitignoreLines.some((l) => l.trim() === entry.trim())) return;
    while (this.gitignoreLines.length > 0 && this.gitignoreLines[this.gitignoreLines.length - 1] === "") {
      this.gitignoreLines.pop();
    }
    this.gitignoreLines.push(entry.trim());
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new Notice(`Added to .gitignore: ${entry.trim()}`);
  }

  async gitignoreRemove(entry: string): Promise<void> {
    await this.loadGitignore();
    const before = this.gitignoreLines.length;
    this.gitignoreLines = this.gitignoreLines.filter((l) => l.trim() !== entry.trim());
    if (this.gitignoreLines.length === before) return;
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new Notice(`Removed from .gitignore: ${entry.trim()}`);
  }

  isSparseExcluded(path: string): boolean {
    return this.deviceSettings.derivedProtectedPaths.includes(path);
  }

  lastKnownSparse(): SparseStateSummary | null {
    return this.lastStatus?.sparse ?? null;
  }

  currentExcludeLines(): string[] {
    return [...this.excludeLines];
  }

  async cmdReapplySparse(): Promise<void> {
    new ConfirmModal(
      this.app,
      {
        title: "Reapply sparse checkout?",
        body: [
          "This runs 'git sparse-checkout reapply' in Termux to re-hide paths excluded by your sparse rules.",
          "It does not delete data from the repository; it only updates which files are materialized in the working tree.",
        ],
        confirmLabel: "Reapply sparse checkout",
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("sparse-reapply");
        if (!result) return;
        if (result.ok) {
          this.reportSuccess(
            "Sparse checkout reapplied",
            [
              "Sparse checkout rules were reapplied.",
              `Patterns now active: ${(result.data?.sparseList ?? "").split("\n").filter(Boolean).length}`,
            ],
            result.data?.reapplyOutput
          );
        } else {
          new ResultModal(
            this.app,
            "Sparse reapply failed",
            [result.error?.message ?? "Unknown error."],
            { stdout: result.error?.stdout, stderr: result.error?.stderr, isError: true }
          ).open();
        }
      }
    ).open();
  }

  // ---------------------------------------------------- phase 3 git commands

  /** Merge and persist shareable UI preferences (data.json; cosmetic only). */
  async setSharedPref(patch: Partial<SharedUiPrefs>): Promise<void> {
    this.sharedPrefs = { ...this.sharedPrefs, ...patch };
    await this.saveData(this.sharedPrefs);
    // Re-render open diff panes (from their cached diff — no Termux round
    // trip) so wrap/invisibles toggles apply immediately; refresh the panels
    // so a tree/list toggle applies too.
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW)) {
      const view = leaf.view;
      if (view instanceof DiffView) view.refreshDisplay();
    }
    this.pushStatusToView();
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof HistoryView) view.rerender();
    }
  }

  /** Parse the status fields every mutating action returns and refresh UI. */
  private absorbStatusData(d: Record<string, string>): void {
    if (!d.branchInfo) return;
    const status = parseStatusPorcelainV2(d.branchInfo);
    // v5+ runners enumerate the files git status collapses into "dir/" lines;
    // on older runners the field is simply absent and folders stay opaque.
    if (d.untrackedChildren !== undefined)
      status.untrackedChildren = groupUntrackedChildren(d.untrackedChildren, status.untracked);
    const sparse = parseSparseState({
      sparseEnabled: d.sparseEnabled ?? "",
      sparseCone: d.sparseCone ?? "",
      sparseList: d.sparseList ?? "",
      skipWorktreeCount: d.skipWorktreeCount,
      lsFilesV: d.lsFilesV,
    });
    this.absorbSparsePatterns(sparse);
    this.lastStatus = {
      status,
      sparse,
      lastCommit: parseLastCommit(d.lastCommit ?? ""),
      fetchedAt: new Date().toLocaleString(),
    };
    this.applyStatusToStatusBar(status);
    this.pushStatusToView();
  }

  /**
   * Refresh the DERIVED protected paths from the repository's own sparse
   * exclusions, so the safety gate follows the repo configuration instead of
   * a hardcoded list. Persisted device-locally: protection must hold from the
   * very first operation after a restart, before any fresh status arrives.
   */
  private absorbSparsePatterns(sparse: SparseStateSummary): void {
    if (!sparse.enabled) return;
    const candidates = sparseExclusionPaths(sparse.patterns);
    const validated = validateProtectedPaths(candidates);
    const derived = validated.ok ? validated.normalized : [];
    const prev = this.deviceSettings.derivedProtectedPaths;
    if (derived.length === prev.length && derived.every((p, i) => p === prev[i])) return;
    this.deviceSettings = this.store.write({ derivedProtectedPaths: derived });
    this.log.add(
      "info",
      "sparse",
      `Derived protected paths refreshed from sparse exclusions: ${derived.join(", ") || "(none)"}.`
    );
  }

  /**
   * The protected set actually enforced: manual paths plus (unless disabled)
   * the exclusions git itself reports. Every operation argument goes through
   * here — never through deviceSettings.protectedPaths directly.
   */
  effectiveProtectedPaths(): string[] {
    const s = this.deviceSettings;
    const merged = [...s.protectedPaths];
    if (s.autoProtectSparse) {
      for (const p of s.derivedProtectedPaths) if (!merged.includes(p)) merged.push(p);
    }
    return merged;
  }

  /** Shared error rendering for mutating operations. Never a bare "failed". */
  private renderMutationError(title: string, result: BridgeResult): void {
    const err = result.error;
    const d = result.data ?? {};
    // A FAILED operation still changed what the user should see (a rejected
    // pull leaves dirty files, a conflict leaves markers): v6 runners attach
    // fresh status fields to error results, absorb them before rendering.
    if (d.branchInfo) this.absorbStatusData(d);
    if (err?.code === "SAFETY_BLOCKED") {
      const report = evaluateSparseSafety(
        d.statusProtected ?? err.stdout ?? "",
        d.stagedProtected ?? err.stderr ?? "",
        this.effectiveProtectedPaths()
      );
      this.statusBar?.set("error");
      new SparseSafetyModal(this.app, report, SPARSE_SAFETY_WARNING).open();
      return;
    }
    if (err?.code === "CONFLICT") {
      const conflicts = (d.conflicts ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "");
      this.statusBar?.set("conflict", `(${conflicts.length})`);
      new ConflictModal(this.app, conflicts, {
        openFile: (path) => this.openVaultFile(path),
        abortMerge: () => this.cmdAbortMerge(),
      }).open();
      return;
    }
    this.statusBar?.set("error");
    new ResultModal(this.app, title, [err?.message ?? "Unknown error."], {
      stdout: err?.stdout,
      stderr: err?.stderr,
      isError: true,
    }).open();
  }

  private openVaultFile(path: string): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
    else new Notice(`Cannot open ${path} (not found in vault).`);
  }

  async cmdFetch(): Promise<void> {
    const result = await this.runOperation("fetch");
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: fetch failed", result);
    this.absorbStatusData(result.data ?? {});
    const st = this.lastStatus?.status;
    this.notify(`Fetched. Ahead ${st?.ahead ?? "?"}, behind ${st?.behind ?? "?"}.`);
  }

  async cmdPull(silent = false): Promise<void> {
    const result = await this.runOperation("pull", {
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: pull failed", result);
    this.absorbStatusData(result.data ?? {});
    if (!silent) {
      this.reportSuccess("Native Git: pull", ["Pull completed."], result.data?.pullOutput);
    }
  }

  async cmdCommit(): Promise<void> {
    new CommitMessageModal(
      this.app,
      { title: "Commit changes", placeholder: "Commit message…", submitLabel: "Commit" },
      async (message) => {
        if (message === null) return;
        const result = await this.runOperation("commit", {
          protectedPaths: this.effectiveProtectedPaths(),
          message,
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: commit failed", result);
        this.absorbStatusData(result.data ?? {});
        const committed = result.data?.committed === "true";
        this.reportSuccess(
          "Native Git: commit",
          [
            committed
              ? `Committed ${result.data?.newHead?.slice(0, 8) ?? ""}.`
              : "Nothing to commit (no staged changes after safety filtering).",
          ],
          result.data?.commitOutput
        );
      }
    ).open();
  }

  async cmdPush(): Promise<void> {
    const result = await this.runOperation("push", {
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: push failed", result);
    this.absorbStatusData(result.data ?? {});
    this.reportSuccess("Native Git: push", ["Push completed."], result.data?.pushOutput);
  }

  async cmdSync(message?: string, silent = false): Promise<void> {
    const result = await this.runOperation("sync", {
      protectedPaths: this.effectiveProtectedPaths(),
      message: message ?? "",
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: sync failed", result);
    this.absorbStatusData(result.data ?? {});
    this.store.setValue(LAST_SYNC_KEY, new Date().toLocaleString());
    const lines = [
      `Steps: ${(result.data?.steps ?? "").split(",").join(" → ")}`,
      `Committed: ${result.data?.committed ?? "false"} · Pushed: ${result.data?.pushed ?? "false"}`,
    ];
    this.log.add("info", "sync", "Sync completed successfully.");
    if (silent) this.notify("Native Git: sync completed.");
    else this.reportSuccess("Native Git: sync completed", lines, result.data?.pullOutput);
  }

  async cmdAbortMerge(): Promise<void> {
    new ConfirmModal(
      this.app,
      {
        title: "Abort merge?",
        body: [
          "This runs 'git merge --abort' and returns the repository to its state before the pull.",
          "Conflict resolutions you already made in the affected files will be discarded.",
        ],
        confirmLabel: "Abort merge",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("abort-merge");
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: abort merge failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Merge aborted; repository restored.");
      }
    ).open();
  }

  // ---------------------------------------------------- phase 4: history/diff

  private activeFilePath(): string | null {
    const f = this.app.workspace.getActiveFile();
    if (!f) {
      new Notice("No active file.");
      return null;
    }
    return f.path;
  }

  /** Entry point for history / view-at-commit / restore commands. */
  cmdFileHistory(): void {
    const path = this.activeFilePath();
    if (path === null) return;
    new FileHistoryModal(this.app, path, {
      loadPage: async (skip, limit) => {
        const result = await this.runOperation("file-log", { path, skip, limit });
        if (!result) return null;
        if (!result.ok) {
          this.renderMutationError("Native Git: history failed", result);
          return null;
        }
        return parseFileLog(result.data?.log ?? "", path);
      },
      viewAt: (e) => void this.showFileAtCommit(e),
      diffVsCurrent: (e) => void this.showDiff(path, e.hash, "WORKTREE", `${e.hash.slice(0, 8)} → working tree`),
      diffVsPrevious: (e, prev) =>
        void this.showDiff(path, prev.hash, e.hash, `${prev.hash.slice(0, 8)} → ${e.hash.slice(0, 8)}`),
      restore: (e) => this.confirmRestore(path, e),
    }).open();
  }

  private async showFileAtCommit(e: FileLogEntry): Promise<void> {
    const result = await this.runOperation("show-file-at-commit", {
      path: e.pathAtCommit,
      commit: e.hash,
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: show file failed", result);
    const bytes = decodeBase64ToBytes(result.data?.contentBase64 ?? "");
    const text = bytesToTextIfNotBinary(bytes);
    const meta = `${e.pathAtCommit} @ ${e.hash.slice(0, 8)} · ${e.date.slice(0, 16).replace("T", " ")} · ${bytes.length} bytes`;
    if (text === null) {
      new ResultModal(this.app, "Binary file", [
        `${e.pathAtCommit} at ${e.hash.slice(0, 8)} is binary (${bytes.length} bytes); preview is not available.`,
        "Restore is still possible from the history list.",
      ]).open();
      return;
    }
    new TextPreviewModal(this.app, "File at commit", meta, text).open();
  }

  private async showDiff(path: string, from: string, to: string, label: string): Promise<void> {
    const result = await this.runOperation("diff-file", { path, from, to });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: diff failed", result);
    new DiffModal(
      this.app,
      "Diff",
      `${path} · ${label}`,
      result.data?.diff ?? "",
      result.data?.truncated === "true"
    ).open();
  }

  async cmdDiffCurrentFile(): Promise<void> {
    const path = this.activeFilePath();
    if (path === null) return;
    await this.showDiff(path, "HEAD", "WORKTREE", "HEAD → working tree");
  }

  private confirmRestore(currentPath: string, e: FileLogEntry): void {
    const renamed = e.pathAtCommit !== currentPath;
    new ConfirmModal(
      this.app,
      {
        title: "Restore file version?",
        body: [
          `File: ${e.pathAtCommit}`,
          `Version: ${e.hash.slice(0, 8)} (${e.date.slice(0, 16).replace("T", " ")}) — ${e.subject}`,
          renamed
            ? `Note: the file had a different name at that commit. The historical content will be written into the CURRENT file (${currentPath}); nothing is created at the old path.`
            : "The current working-tree content of this file will be overwritten. The version stays in Git history, but uncommitted edits to this file are lost.",
        ],
        confirmLabel: "Restore this version",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        if (renamed) {
          // Rename-safe restore: fetch the blob and write it into the current
          // file through the vault, after explicit confirmation above.
          const result = await this.runOperation("show-file-at-commit", {
            path: e.pathAtCommit,
            commit: e.hash,
          });
          if (!result) return;
          if (!result.ok) return this.renderMutationError("Native Git: restore failed", result);
          const bytes = decodeBase64ToBytes(result.data?.contentBase64 ?? "");
          await this.app.vault.adapter.writeBinary(
            currentPath,
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
          );
          this.log.add("info", "restore-file", `Restored ${currentPath} from ${e.hash} (historical name ${e.pathAtCommit}).`);
          this.notify("File content restored from the selected version.");
          return;
        }
        const result = await this.runOperation("restore-file", {
          path: currentPath,
          commit: e.hash,
          protectedPaths: this.effectiveProtectedPaths(),
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: restore failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify(`Restored ${currentPath} from ${e.hash.slice(0, 8)}.`);
      }
    ).open();
  }

  // ------------------------------------------------- status panel & selfcheck

  async openStatusPanel(reveal = true): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW);
    if (existing.length > 0) {
      if (reveal) this.app.workspace.revealLeaf(existing[0]!);
      this.pushStatusToView();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_STATUS_VIEW, active: reveal });
    if (reveal) this.app.workspace.revealLeaf(leaf);
    this.pushStatusToView();
  }

  // ------------------------------------------------- repository history & diff panes

  /** Open (or reveal and refresh) the repository-wide history panel. */
  async openHistoryPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]!);
      const view = existing[0]!.view;
      if (view instanceof HistoryView) await view.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_HISTORY_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async loadRepoLogPage(skip: number, limit: number): Promise<RepoLogEntry[] | null> {
    const result = await this.runOperation("repo-log", { skip, limit });
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: history failed", result);
      return null;
    }
    return parseRepoLog(result.data?.log ?? "");
  }

  /** The diff a commit introduced for one file, in an Obsidian pane. */
  private async openCommitDiff(file: RepoLogFile, entry: RepoLogEntry): Promise<void> {
    const short = entry.hash.slice(0, 8);
    await this.openDiffPane({
      path: file.path,
      from: `${entry.hash}^`,
      to: entry.hash,
      label: `${short}^ → ${short}`,
    });
  }

  /**
   * Tap on a changed file in the status panel. A STAGED row shows what would
   * be committed (HEAD → index); an unstaged row shows what is NOT staged yet
   * (index → worktree) — so a file staged and then edited again shows two
   * genuinely different diffs.
   */
  private async openStatusDiff(path: string, group: Group): Promise<void> {
    if (group === "staged") {
      await this.openDiffPane({ path, from: "HEAD", to: "INDEX", label: "HEAD → staged" });
      return;
    }
    await this.openDiffPane({ path, from: "INDEX", to: "WORKTREE", label: "staged → working tree" });
  }

  private async openDiffPane(state: DiffViewState): Promise<void> {
    // Reuse an existing diff pane instead of stacking a new tab per tap.
    const existing = this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW);
    const leaf = existing.length > 0 ? existing[0]! : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: NGB_DIFF_VIEW,
      active: true,
      state: state as unknown as Record<string, unknown>,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  // ------------------------------------------------- conflict resolution

  /** Vault file as text, or null when it looks binary (NUL byte probe). */
  private async readVaultTextFile(path: string): Promise<string | null> {
    try {
      const buf = await this.app.vault.adapter.readBinary(path);
      return bytesToTextIfNotBinary(new Uint8Array(buf));
    } catch {
      return null;
    }
  }

  /**
   * Tap on a conflicted file: text files get the per-block resolution pane;
   * anything else gets the Git context menu (keep ours / keep theirs / open
   * in the default app) anchored where the user tapped.
   */
  async openConflict(path: string, pos: { x: number; y: number }): Promise<void> {
    const text = await this.readVaultTextFile(path);
    if (text !== null) {
      const existing = this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW);
      const leaf = existing.length > 0 ? existing[0]! : this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: NGB_CONFLICT_VIEW, active: true, state: { path } });
      this.app.workspace.revealLeaf(leaf);
      return;
    }
    const menu = new Menu();
    this.buildGitMenu(menu, path);
    menu.showAtPosition(pos);
  }

  /** Whole-file resolution via the runner, after explicit confirmation. */
  cmdResolveConflict(path: string, side: "ours" | "theirs"): void {
    new ConfirmModal(
      this.app,
      {
        title: side === "ours" ? "Keep the LOCAL version (yours)?" : "Keep the REMOTE version?",
        body: [
          `File: ${path}`,
          side === "ours"
            ? "The incoming remote changes to this file are discarded; your local version is kept and the file is marked resolved."
            : "Your local changes to this file are discarded; the incoming remote version is kept and the file is marked resolved.",
          "This cannot be undone for the losing side's uncommitted content.",
        ],
        confirmLabel: side === "ours" ? "Keep local" : "Keep remote",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("resolve-conflict", {
          path,
          side,
          protectedPaths: this.effectiveProtectedPaths(),
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: resolve failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify(`Resolved ${path} (kept the ${side === "ours" ? "local" : "remote"} version).`);
      }
    ).open();
  }

  /**
   * Open a file with the system's default app. `openWithDefaultApp` is not in
   * the public typings on mobile, so this degrades to a notice when absent
   * (documented in docs/submission.md alongside the other private-API uses).
   */
  private openWithDefaultApp(path: string): void {
    const anyApp = this.app as unknown as { openWithDefaultApp?: (p: string) => void };
    if (typeof anyApp.openWithDefaultApp === "function") anyApp.openWithDefaultApp(path);
    else new Notice("Opening with the default app is not available in this Obsidian version.");
  }

  /**
   * Unified diff text for the diff pane. A root commit has no parent: when
   * "<hash>^" fails, the diff is retried against git's canonical empty tree,
   * so the first commit renders as all-additions instead of an error.
   */
  private async loadDiffText(
    path: string,
    from: string,
    to: string
  ): Promise<{ diff: string; truncated: boolean } | null> {
    let result = await this.runOperation("diff-file", { path, from, to });
    if (result && !result.ok && from.endsWith("^")) {
      result = await this.runOperation("diff-file", { path, from: EMPTY_TREE_HASH, to });
    }
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: diff failed", result);
      return null;
    }
    return { diff: result.data?.diff ?? "", truncated: result.data?.truncated === "true" };
  }

  /** Tick the elapsed-time label without rebuilding the panel. */
  private updateProgressInView(text: string | null): void {
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW)) {
      const view = leaf.view;
      if (view instanceof StatusView) view.updateProgressText(text);
    }
  }

  /** Mirror current state into the sidebar panel (works on mobile). */
  private pushStatusToView(): void {
    const leaves = this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW);
    if (leaves.length === 0) return;
    const state = this.statusBar?.current ?? (this.lock.active ? "syncing" : "clean");
    const extra = {
      sparse: this.lastStatus?.sparse,
      activeOperation: this.lock.active ? this.lock.active.action : undefined,
      progress: this.progressText ?? undefined,
      runningAction: this.runningAction ?? undefined,
      runningPath: this.runningPath ?? undefined,
      treeView: this.sharedPrefs.treeView,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? undefined,
      fetchedAt: this.lastStatus?.fetchedAt,
      bridge: this.deviceSettings.termuxIntegrationEnabled ? "companion app" : "disabled",
    };
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof StatusView) {
        if (this.lastStatus) view.setData(summaryToViewData(this.lastStatus.status, extra, state));
        else
          view.setData({
            state,
            ahead: 0,
            behind: 0,
            staged: [],
            unstaged: [],
            untracked: [],
            conflicted: [],
            ...extra,
          });
      }
    }
  }

  /** Local bridge diagnosis that works even when nothing comes back from Termux. */
  /**
   * The setup guide: three parts in order, each with a one-tap action. Shown
   * whenever an operation is attempted before the bridge is usable — on a
   * fresh install that is the FIRST thing the user sees, so it must name the
   * companion app and Termux, not just the missing token.
   */
  openSetupGuide(reason: string): void {
    const s = this.deviceSettings;
    if (!Platform.isAndroidApp) {
      new Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const lines = [
      reason,
      "",
      "Three parts are needed, in this order:",
      "1. Termux (runs the real git) — the F-Droid build.",
      "2. Git Bridge Companion app (the only way Obsidian can trigger Termux).",
      "3. One command pasted into Termux — it installs the runner and pairs this plugin automatically (no token typing).",
      "",
      `Termux: ${TERMUX_SITE_URL} (direct: ${TERMUX_FDROID_URL})`,
      `Companion APK: ${COMPANION_RELEASES_URL}`,
      "",
      "Current state on this device:",
      `Enabled here: ${s.enabledOnThisDevice ? "yes" : "NO (turn it on in settings)"}`,
      `Termux integration: ${s.termuxIntegrationEnabled ? "on" : "OFF (turn it on in settings)"}`,
      `Paired with a runner: ${s.authToken ? "yes" : "NO (step 3 pairs it automatically)"}`,
      `Companion seen so far: ${this.lastCompanionAckMs > 0 ? "yes" : "not yet"}`,
      `Termux installed: ${this.lastAckTermuxInstalled === null ? "unknown (the companion reports this)" : this.lastAckTermuxInstalled ? "yes" : "NO"}`,
    ];
    const actions: ResultModalAction[] = [
      {
        label: "Get Termux",
        keepOpen: true,
        onClick: () => this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL),
      },
      {
        label: "Copy release link",
        keepOpen: true,
        onClick: () => {
          void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
          new Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
        },
      },
      {
        label: "Open companion setup",
        keepOpen: true,
        onClick: () => void this.openCompanionSetup(),
      },
      {
        label: "Copy command & open Termux",
        cta: true,
        keepOpen: true,
        onClick: () => this.copyCommandAndOpenTermux(),
      },
    ];
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled) {
      actions.unshift({
        label: "Enable on this device",
        keepOpen: true,
        onClick: () => {
          void this.updateDeviceSettings({ enabledOnThisDevice: true, termuxIntegrationEnabled: true }).then(() =>
            new Notice("Enabled. Now do steps 1-3 if you have not yet.")
          );
        },
      });
    }
    this.log.add("info", "setup", `Setup guide shown: ${reason}`);
    new ResultModal(this.app, "Set up Native Git Bridge", lines, { actions }).open();
  }

  /**
   * Version advice for the three independently updated parts. Until Obsidian
   * itself offers the update (this plugin is not in the community catalogue
   * yet), a mismatch can only be reported — never auto-fixed.
   */
  versionAdvice(): Array<{ text: string; part: "plugin" | "companion" | "runner" }> {
    const out: Array<{ text: string; part: "plugin" | "companion" | "runner" }> = [];
    const plugin = this.manifest.version;
    const companion = this.lastCompanionVersion;
    if (companion !== "") {
      const cmp = compareVersions(plugin, companion);
      if (cmp < 0) {
        out.push({
          part: "plugin",
          text: `The plugin (${plugin}) is OLDER than the companion app (${companion}). Update the plugin: download main.js, manifest.json and styles.css from the latest release into .obsidian/plugins/native-git-bridge/, then reload the plugin.`,
        });
      } else if (cmp > 0) {
        out.push({
          part: "companion",
          text: `The companion app (${companion}) is OLDER than the plugin (${plugin}). Install the newest APK from the latest release (it updates over the current one).`,
        });
      }
    }
    if (this.lastRunnerVersion > 0 && this.lastRunnerVersion !== RUNNER_MIN_VERSION) {
      out.push({
        part: "runner",
        text:
          this.lastRunnerVersion < RUNNER_MIN_VERSION
            ? `The Termux runner (v${this.lastRunnerVersion}) is older than this plugin needs (v${RUNNER_MIN_VERSION}). Re-run the install command in Termux — updating the plugin never updates the runner.`
            : `The Termux runner (v${this.lastRunnerVersion}) is NEWER than this plugin expects (v${RUNNER_MIN_VERSION}). Update the plugin from the latest release.`,
      });
    }
    return out;
  }

  /** The one-line Termux install command (same one settings shows). */
  installCommand(): string {
    return bootstrapCommand(this.manifest.version, this.deviceSettings.repoPathHint);
  }

  /** Open the latest release page (companion APK + plugin files live there). */
  openLatestRelease(): void {
    this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_RELEASES_URL);
  }

  /** Copy the install command, then bring Termux to the front (via the companion). */
  copyCommandAndOpenTermux(): void {
    void navigator.clipboard.writeText(this.installCommand());
    new Notice("Install command copied - long-press in Termux to paste, then Enter.");
    this.openExternalUri(COMPANION_OPEN_TERMUX_URI);
  }

  async cmdSelfCheck(timedOut = false): Promise<void> {
    registerIcons();
    const paths = new RuntimePaths(this.app.vault.configDir);
    const report = await runSelfCheck(this.makeRuntimeFS(), paths, timedOut);
    const outdated = /ERROR building result for [^(]*$/m.test(report.runnerLogTail);
    const lines = [report.verdict];
    if (outdated) {
      lines.push("", "The Termux runner is OUTDATED. Fix: the button below copies the install command and opens Termux - paste and run it there.");
    }
    lines.push(
      "",
      `Runtime folder (as the plugin sees it): ${paths.root}`,
      `Runner has written here: ${report.runnerLogExists ? "yes" : "NO"}`,
      `Queued requests: ${report.queuedRequests.length}${report.queuedRequests.length ? " (" + report.queuedRequests.join(", ") + ")" : ""}`,
      `Pairing file waiting: ${report.pairingFilePresent ? "yes" : "no"}`
    );
    for (const a of this.versionAdvice()) lines.push("", a.text);
    this.log.add(report.ok ? "info" : "warn", "self-check", report.verdict);

    // One-tap fixes instead of prose. Which buttons appear depends on what the
    // plugin actually knows: the companion reports whether Termux is installed
    // in every ack; no ack ever means the companion itself is the suspect.
    const actions: ResultModalAction[] = [];
    if (Platform.isAndroidApp) {
      actions.push({
        label: "Copy command & open Termux",
        cta: true,
        onClick: () => this.copyCommandAndOpenTermux(),
      });
      // Termux present but the runner never answered: it is most often simply
      // closed/force-stopped (Android then blocks its background service).
      if (this.lastAckTermuxInstalled !== false) {
        actions.push({
          label: "Open Termux",
          keepOpen: true,
          onClick: () => this.openExternalUri(COMPANION_OPEN_TERMUX_URI),
        });
      }
      if (this.lastAckTermuxInstalled === false) {
        // The companion reported Termux missing. Let it open F-Droid (or the
        // page in the real browser) — an in-app Custom Tab download tends to
        // vanish. The plain link stays as a copyable fallback below.
        actions.push({
          label: "Get Termux",
          keepOpen: true,
          onClick: () => this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL),
        });
        lines.push(
          "",
          `Termux is NOT installed on this device. Official site: ${TERMUX_SITE_URL}`,
          `Direct F-Droid page: ${TERMUX_FDROID_URL} — do not use the Play Store build, it is deprecated.`
        );
      }
      if (this.lastCompanionAckMs === 0) {
        // No companion has answered: it cannot fetch its own update, so hand
        // the user a link they can paste into a real browser.
        actions.push({
          label: "Copy release link",
          keepOpen: true,
          onClick: () => {
            void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
            new Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
          },
        });
      } else {
        // Companion is alive: let IT open the download in the real default
        // browser (an in-app Custom Tab download is often discarded).
        actions.push({
          label: "Update companion app",
          keepOpen: true,
          onClick: () => this.openExternalUri(COMPANION_DOWNLOAD_APK_URI),
        });
      }
    }
    new ResultModal(this.app, "Bridge check", lines, {
      stdout: report.runnerLogTail || undefined,
      isError: !report.ok,
      actions,
    }).open();
  }

  // ------------------------------------------------- per-file staging actions

  async cmdStageAll(): Promise<void> {
    const result = await this.runOperation("stage-all", {
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: stage all failed", result);
    this.absorbStatusData(result.data ?? {});
    this.notify("Staged all permitted changes (protected paths excluded).");
  }

  async cmdUnstageAll(): Promise<void> {
    const result = await this.runOperation("unstage-all", {
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: unstage all failed", result);
    this.absorbStatusData(result.data ?? {});
    this.notify("Unstaged all changes.");
  }

  async cmdStageFile(path: string, mode: "all" | "update" = "all"): Promise<void> {
    const result = await this.runOperation("stage-file", {
      path,
      mode,
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: stage failed", result);
    this.absorbStatusData(result.data ?? {});
  }

  /**
   * Tree-layout folder actions, scoped to the GROUP the folder row lives in:
   * stage in "Changes" stages tracked changes only (`git add -u`), stage in
   * "Untracked" stages the new files (`git add`), unstage touches only what
   * was staged (`git restore --staged`), discard in "Untracked" moves the new
   * files to Obsidian's trash (reversible), elsewhere it is the confirmed
   * git discard. One request per folder — never one per file.
   */
  folderAction(group: Group, folderPath: string, kind: "stage" | "unstage" | "discard"): void {
    if (kind === "stage") {
      void this.cmdStageFile(folderPath, group === "unstaged" ? "update" : "all");
      return;
    }
    if (kind === "unstage") {
      void this.cmdUnstageFile(folderPath);
      return;
    }
    if (group === "untracked") {
      this.confirmTrashUntrackedFolder(folderPath);
      return;
    }
    this.cmdDiscardFile(folderPath);
  }

  /** Move every untracked entry under a folder to Obsidian's trash, confirmed. */
  private confirmTrashUntrackedFolder(folderPath: string): void {
    const st = this.lastStatus?.status;
    if (!st) return;
    const prefix = `${folderPath}/`;
    // Untracked entries under the folder as git reported them: whole
    // untracked directories move as one, plus individual files.
    const targets = st.untracked.filter((u) => u.startsWith(prefix) || u === prefix);
    if (targets.length === 0) return;
    new ConfirmModal(
      this.app,
      {
        title: "Move new files to trash?",
        body: [
          `Folder: ${folderPath}`,
          `${targets.length} untracked entr${targets.length === 1 ? "y" : "ies"} will move to Obsidian's trash (.trash in the vault) — this is reversible from there.`,
        ],
        confirmLabel: "Move to trash",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        for (const t of targets) {
          const p = t.endsWith("/") ? t.slice(0, -1) : t;
          try {
            await this.app.vault.adapter.trashLocal(p);
          } catch (e) {
            this.log.add("error", "discard-file", `Trash failed for ${p}: ${String(e)}`);
          }
        }
        this.notify(`Moved ${targets.length} untracked entr${targets.length === 1 ? "y" : "ies"} to the trash.`);
        await this.cmdStatus(true);
      }
    ).open();
  }

  async cmdUnstageFile(path: string): Promise<void> {
    const result = await this.runOperation("unstage-file", {
      path,
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: unstage failed", result);
    this.absorbStatusData(result.data ?? {});
  }

  cmdDiscardFile(path: string): void {
    new ConfirmModal(
      this.app,
      {
        title: "Discard changes?",
        body: [
          `File: ${path}`,
          "Tracked files are reset to the last commit; untracked files are deleted.",
          "This cannot be undone — the changes are not in Git history.",
        ],
        confirmLabel: "Discard changes",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("discard-file", {
          path,
          protectedPaths: this.effectiveProtectedPaths(),
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: discard failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify(`Discarded changes in ${path}.`);
      }
    ).open();
  }

  async cmdDiagnostics(): Promise<void> {
    const report: DiagnosticsReport = { pluginSide: {}, problems: [] };
    const s = this.deviceSettings;
    report.pluginSide["Plugin version"] = this.manifest.version;
    report.pluginSide["Platform"] = Platform.isAndroidApp ? "Android app" : Platform.isMobile ? "mobile" : "desktop";
    report.pluginSide["Enabled on this device"] = String(s.enabledOnThisDevice);
    report.pluginSide["Termux integration"] = String(s.termuxIntegrationEnabled);
    report.pluginSide["Pairing token set"] = s.authToken ? "yes" : "no";
    report.pluginSide["Protected paths (manual)"] = s.protectedPaths.join(", ") || "(none)";
    report.pluginSide["Protected paths (derived from sparse)"] =
      (s.autoProtectSparse ? s.derivedProtectedPaths.join(", ") : "(auto-protect off)") || "(none)";
    report.pluginSide["Protected paths (effective)"] = this.effectiveProtectedPaths().join(", ") || "(none)";
    report.pluginSide["Device-local storage"] = this.store.isVolatile ? "VOLATILE (in-memory fallback)" : "persistent";
    report.pluginSide["Pending requests"] = String(await this.client.pendingRequestCount());
    report.pluginSide["Active operation"] = this.lock.active ? `${this.lock.active.action} (${this.lock.active.id})` : "none";

    if (!Platform.isAndroidApp)
      report.problems.push(
        "Not an Android device: the bridge (companion app + Termux) exists only on Android, so all operations are disabled here."
      );
    if (this.store.isVolatile) report.problems.push("Device-local storage is unavailable; settings will not persist.");
    if (!s.authToken) report.problems.push("No pairing token configured.");
    if (this.effectiveProtectedPaths().length === 0)
      report.problems.push(
        "No protected sparse paths (neither manual nor derived from sparse exclusions). " +
          "Fine for full checkouts; risky if this repo uses sparse checkout."
      );
    if (Platform.isAndroidApp) {
      if (this.isObsidianGitActiveOnDevice()) {
        report.problems.push(
          "obsidian-git is ACTIVE on this device (not device-disabled): incompatible with a native sparse-checkout index. " +
            "Use its 'Disable on this device' toggle."
        );
      }
    }

    // Runner-side diagnostics (skipped silently if bridge not configured).
    if (s.enabledOnThisDevice && s.termuxIntegrationEnabled && s.authToken) {
      const result = await this.runOperation("diagnostics");
      if (result?.ok && result.data) {
        report.runnerSide = {};
        for (const [k, v] of Object.entries(result.data)) report.runnerSide[k] = v;
        const rv = Number(result.data.runnerVersion ?? result.runnerVersion ?? 1);
        if (!Number.isNaN(rv) && rv < RUNNER_MIN_VERSION) {
          report.problems.push(
            `Termux runner is version ${rv}, this plugin needs ${RUNNER_MIN_VERSION}. ${RUNNER_OUTDATED_HINT}`
          );
        }
        if (result.data.sparseEnabled?.trim() !== "true") {
          report.problems.push("core.sparseCheckout is not 'true' in the repository.");
        }
      } else if (result && !result.ok) {
        report.problems.push(`Runner diagnostics failed: ${result.error?.message ?? "unknown error"}`);
      }
    }

    new DiagnosticsModal(this.app, report).open();
  }

  async cmdCancel(): Promise<void> {
    if (!this.activeCancel) {
      new Notice("No operation is currently awaiting a result.");
      return;
    }
    this.activeCancel.cancel();
  }
}

/**
 * Compare dotted numeric versions ("0.5.2"). Returns <0 if a is older, 0 if
 * equal, >0 if newer. Non-numeric parts count as 0, so a malformed value can
 * never make the plugin claim a mismatch it cannot justify.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

function getLocalStorageBackend(): KeyValueBackend | null {
  try {
    // activeWindow is Obsidian's current-window global (popout-safe); absent
    // outside a browser context (tests), where the volatile fallback applies.
    const ls: KeyValueBackend | undefined =
      typeof activeWindow !== "undefined" ? activeWindow.localStorage : undefined;
    if (!ls) return null;
    const probe = "__ngb_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
