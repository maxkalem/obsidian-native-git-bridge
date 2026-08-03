import { Notice, Plugin, Platform } from "obsidian";
import {
  DEFAULT_TIMEOUT_SECONDS,
  PLUGIN_ID,
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
import { MUTATING_ACTIONS } from "./types";
import {
  DeviceLocalSettingsStore,
  type DeviceLocalSettings,
  type KeyValueBackend,
} from "./settings/DeviceLocalSettingsStore";
import { NativeGitBridgeSettingTab } from "./settings/SettingsTab";
import { BridgeClient, CancelToken, type RuntimeFS } from "./bridge/BridgeClient";
import { RuntimePaths } from "./bridge/runtimePaths";
import { createRequest } from "./bridge/protocol";
import {
  CompanionIntentTransport,
  WidgetManualTransport,
  type TriggerTransport,
} from "./bridge/transport";
import {
  parseLastCommit,
  parseSparseState,
  parseStatusPorcelainV2,
} from "./git/parsers";
import { evaluateSparseSafety } from "./git/sparseSafety";
import { OperationLock, isMarkerStale } from "./ops/OperationLock";
import { OperationLog } from "./ops/OperationLog";
import { StatusBarController } from "./ui/StatusBarController";
import {
  ChangedFilesModal,
  ConfirmModal,
  ResultModal,
  SparseSafetyModal,
  StatusModal,
} from "./ui/modals";
import { DiagnosticsModal, type DiagnosticsReport } from "./ui/DiagnosticsModal";
import { CommitMessageModal, ConflictModal } from "./ui/gitModals";
import { TFile } from "obsidian";
import { OperationLogModal } from "./ui/OperationLogModal";

/** Non-device-specific, shareable UI preferences (safe to sync via data.json). */
interface SharedUiPrefs {
  showStatusBar: boolean;
  showRibbonIcon: boolean;
}
const DEFAULT_SHARED_PREFS: SharedUiPrefs = { showStatusBar: true, showRibbonIcon: true };

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
  private lastStatus: { status: GitStatusSummary; sparse: SparseStateSummary; lastCommit?: { hash: string; date: string; subject: string }; fetchedAt: string } | null = null;

  async onload(): Promise<void> {
    // ---- device-local settings (never synced through the vault) ----
    this.store = new DeviceLocalSettingsStore(getLocalStorageBackend(), this.resolveScopeId());
    this.deviceSettings = this.store.read();
    this.log = new OperationLog(this.store);

    // ---- shared, non-device-specific UI prefs only ----
    const data = (await this.loadData()) as Partial<SharedUiPrefs> | null;
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS, ...(data ?? {}) };

    const paths = new RuntimePaths(this.app.vault.configDir);
    this.client = new BridgeClient(this.makeRuntimeFS(), paths);
    this.lock = new OperationLock((marker) => this.persistMarker(marker));

    if (this.sharedPrefs.showStatusBar) {
      this.statusBar = new StatusBarController(this.addStatusBarItem(), () => this.openStatusModal());
    }
    if (this.sharedPrefs.showRibbonIcon) {
      this.addRibbonIcon("git-branch", "Native Git: Status", () => void this.cmdStatus());
    }

    this.addSettingTab(new NativeGitBridgeSettingTab(this.app, this));
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      void this.startupChecks();
    });
    this.registerAutomaticActions();
  }

  private lastAutoSyncMs = 0;

  private registerAutomaticActions(): void {
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
        { protectedPaths: s.protectedPaths, message: "vault sync on close (native git bridge)" },
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
    await this.reconcileAfterRestart();
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

  private warnIfObsidianGitEnabledOnAndroid(): void {
    if (!Platform.isAndroidApp) return;
    const plugins = (this.app as unknown as {
      plugins?: { enabledPlugins?: Set<string> };
    }).plugins;
    if (plugins?.enabledPlugins?.has("obsidian-git")) {
      this.log.add("warn", "compat", "obsidian-git enabled on Android alongside Native Git Bridge.");
      new ResultModal(
        this.app,
        "Plugin compatibility warning",
        [
          "The 'Git' (obsidian-git) plugin is enabled on this Android device.",
          "Its mobile backend (isomorphic-git) does not understand native sparse-checkout / skip-worktree index data and may stage protected paths as deletions.",
          "Recommendation: disable obsidian-git on this device (Settings → Community plugins). Native Git Bridge will not disable it automatically.",
        ],
        { isError: true }
      ).open();
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
        `Operation ${marker.id} from the previous session has no result yet; it may still run when you tap the widget. Its result will be cleaned up automatically.`
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
      { id: "show-changed-files", name: "Native Git: Show changed files", cb: () => void this.cmdShowChangedFiles() },
      { id: "verify-sparse-safety", name: "Native Git: Verify sparse checkout safety", cb: () => void this.cmdVerifySparseSafety() },
      { id: "reapply-sparse", name: "Native Git: Reapply sparse checkout", cb: () => void this.cmdReapplySparse() },
      { id: "diagnostics", name: "Native Git: Run diagnostics", cb: () => void this.cmdDiagnostics() },
      { id: "open-operation-log", name: "Native Git: Open operation log", cb: () => new OperationLogModal(this.app, this.log).open() },
      { id: "cancel-operation", name: "Native Git: Cancel current operation when possible", cb: () => void this.cmdCancel() },
    ];
    for (const c of cmds) this.addCommand({ id: c.id, name: c.name, callback: c.cb });
  }

  // ------------------------------------------------------------ operations

  /** Guard + queue + trigger + await one bridge operation. */
  private async runOperation(
    action: BridgeAction,
    args: Record<string, unknown> = {}
  ): Promise<BridgeResult | null> {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice) {
      new Notice("Native Git Bridge is disabled on this device (see settings).");
      return null;
    }
    if (!s.termuxIntegrationEnabled) {
      new Notice("Termux integration is disabled on this device (see settings).");
      return null;
    }
    if (!s.authToken) {
      new Notice("No pairing token set. Run the Termux installer, then paste the token in settings.");
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
    this.log.add("info", action, `Queued request ${req.id}.`);

    try {
      await this.client.submit(req);
      const transport = this.makeTransport();
      const outcome = transport.trigger(req.id);
      if (outcome.kind === "manual" && outcome.instruction) {
        this.statusBar?.set("waiting-tap");
        new Notice(outcome.instruction, 10000);
      }
      const waited = await this.client.awaitResult(req.id, req.timeoutSeconds * 1000, cancel);
      if (waited.kind === "timeout") {
        this.log.add("warn", action, `Request ${req.id} timed out after ${req.timeoutSeconds}s (request left queued).`);
        new ResultModal(this.app, `Native Git: ${action} timed out`, [
          `No result arrived within ${req.timeoutSeconds}s.`,
          s.integrationType === "widget-manual"
            ? "Did you tap the GitBridge shortcut in the Termux widget? The request stays queued and will run at the next tap."
            : "Check that the companion app and Termux are set up correctly (see diagnostics).",
        ]).open();
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
      this.activeCancel = null;
      if (mutating) this.lock.release(req.id);
      this.refreshStatusBarIdle();
    }
  }

  private makeTransport(): TriggerTransport {
    if (this.deviceSettings.integrationType === "companion-intent") {
      return new CompanionIntentTransport(this.deviceSettings.companionUriTemplate, (uri) => {
        // Primary path; some WebViews return null without dispatching, so fall
        // back to a synthetic anchor click, which Obsidian routes to Android.
        let opened: Window | null = null;
        try {
          opened = window.open(uri);
        } catch {
          opened = null;
        }
        if (!opened) {
          const a = document.createElement("a");
          a.href = uri;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      });
    }
    return new WidgetManualTransport();
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
    const sparse = parseSparseState({
      sparseEnabled: d.sparseEnabled ?? "",
      sparseCone: d.sparseCone ?? "",
      sparseList: d.sparseList ?? "",
      lsFilesV: d.lsFilesV ?? "",
    });
    const lastCommit = parseLastCommit(d.lastCommit ?? "");
    this.lastStatus = { status, sparse, lastCommit, fetchedAt: new Date().toLocaleString() };
    this.applyStatusToStatusBar(status);
    if (!silent) this.openStatusModal();
  }

  private openStatusModal(): void {
    new StatusModal(this.app, {
      status: this.lastStatus?.status,
      sparse: this.lastStatus?.sparse,
      lastCommit: this.lastStatus?.lastCommit,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? undefined,
      bridgeAvailable: this.deviceSettings.termuxIntegrationEnabled
        ? `enabled (${this.deviceSettings.integrationType})`
        : "disabled",
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
    const protectedPaths = this.deviceSettings.protectedPaths;
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
        new ResultModal(
          this.app,
          result.ok ? "Sparse checkout reapplied" : "Sparse reapply failed",
          result.ok
            ? ["Sparse checkout rules were reapplied.", `Patterns now active: ${(result.data?.sparseList ?? "").split("\n").filter(Boolean).length}`]
            : [result.error?.message ?? "Unknown error."],
          { stdout: result.error?.stdout ?? result.data?.reapplyOutput, stderr: result.error?.stderr, isError: !result.ok }
        ).open();
      }
    ).open();
  }

  // ---------------------------------------------------- phase 3 git commands

  /** Parse the status fields every mutating action returns and refresh UI. */
  private absorbStatusData(d: Record<string, string>): void {
    if (!d.branchInfo) return;
    const status = parseStatusPorcelainV2(d.branchInfo);
    const sparse = parseSparseState({
      sparseEnabled: d.sparseEnabled ?? "",
      sparseCone: d.sparseCone ?? "",
      sparseList: d.sparseList ?? "",
      lsFilesV: d.lsFilesV ?? "",
    });
    this.lastStatus = {
      status,
      sparse,
      lastCommit: parseLastCommit(d.lastCommit ?? ""),
      fetchedAt: new Date().toLocaleString(),
    };
    this.applyStatusToStatusBar(status);
  }

  /** Shared error rendering for mutating operations. Never a bare "failed". */
  private renderMutationError(title: string, result: BridgeResult): void {
    const err = result.error;
    const d = result.data ?? {};
    if (err?.code === "SAFETY_BLOCKED") {
      const report = evaluateSparseSafety(
        d.statusProtected ?? err.stdout ?? "",
        d.stagedProtected ?? err.stderr ?? "",
        this.deviceSettings.protectedPaths
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
    new Notice(`Fetched. Ahead ${st?.ahead ?? "?"}, behind ${st?.behind ?? "?"}.`);
  }

  async cmdPull(silent = false): Promise<void> {
    const result = await this.runOperation("pull", {
      protectedPaths: this.deviceSettings.protectedPaths,
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: pull failed", result);
    this.absorbStatusData(result.data ?? {});
    if (!silent) {
      new ResultModal(this.app, "Native Git: pull", ["Pull completed."], {
        stdout: result.data?.pullOutput,
      }).open();
    }
  }

  async cmdCommit(): Promise<void> {
    new CommitMessageModal(
      this.app,
      { title: "Commit changes", placeholder: "Commit message…", submitLabel: "Commit" },
      async (message) => {
        if (message === null) return;
        const result = await this.runOperation("commit", {
          protectedPaths: this.deviceSettings.protectedPaths,
          message,
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: commit failed", result);
        this.absorbStatusData(result.data ?? {});
        const committed = result.data?.committed === "true";
        new ResultModal(
          this.app,
          "Native Git: commit",
          [
            committed
              ? `Committed ${result.data?.newHead?.slice(0, 8) ?? ""}.`
              : "Nothing to commit (no staged changes after safety filtering).",
          ],
          { stdout: result.data?.commitOutput }
        ).open();
      }
    ).open();
  }

  async cmdPush(): Promise<void> {
    const result = await this.runOperation("push", {
      protectedPaths: this.deviceSettings.protectedPaths,
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: push failed", result);
    this.absorbStatusData(result.data ?? {});
    new ResultModal(this.app, "Native Git: push", ["Push completed."], {
      stdout: result.data?.pushOutput,
    }).open();
  }

  async cmdSync(message?: string, silent = false): Promise<void> {
    const result = await this.runOperation("sync", {
      protectedPaths: this.deviceSettings.protectedPaths,
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
    if (silent) new Notice("Native Git: sync completed.");
    else new ResultModal(this.app, "Native Git: sync completed", lines, { stdout: result.data?.pullOutput }).open();
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
        new Notice("Merge aborted; repository restored.");
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
    report.pluginSide["Integration type"] = s.integrationType;
    report.pluginSide["Pairing token set"] = s.authToken ? "yes" : "no";
    report.pluginSide["Protected paths"] = s.protectedPaths.join(", ") || "(none)";
    report.pluginSide["Device-local storage"] = this.store.isVolatile ? "VOLATILE (in-memory fallback)" : "persistent";
    report.pluginSide["Pending requests"] = String(await this.client.pendingRequestCount());
    report.pluginSide["Active operation"] = this.lock.active ? `${this.lock.active.action} (${this.lock.active.id})` : "none";

    if (this.store.isVolatile) report.problems.push("Device-local storage is unavailable; settings will not persist.");
    if (!s.authToken) report.problems.push("No pairing token configured.");
    if (s.protectedPaths.length === 0) report.problems.push("No protected sparse paths configured.");
    if (Platform.isAndroidApp) {
      const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
      if (plugins?.enabledPlugins?.has("obsidian-git")) {
        report.problems.push("obsidian-git is enabled on Android: incompatible with a native sparse-checkout index.");
      }
    }

    // Runner-side diagnostics (skipped silently if bridge not configured).
    if (s.enabledOnThisDevice && s.termuxIntegrationEnabled && s.authToken) {
      const result = await this.runOperation("diagnostics");
      if (result?.ok && result.data) {
        report.runnerSide = {};
        for (const [k, v] of Object.entries(result.data)) report.runnerSide[k] = v;
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

function getLocalStorageBackend(): KeyValueBackend | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValueBackend }).localStorage;
    if (!ls) return null;
    const probe = "__ngb_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
