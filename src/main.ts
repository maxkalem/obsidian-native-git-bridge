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
import { createRequest, isValidProfileId, randomSuffix } from "./bridge/protocol";
import { CompanionIntentTransport, type TriggerTransport } from "./bridge/transport";
import {
  groupUntrackedChildren,
  parseLastCommit,
  parseSparseState,
  parseStatusPorcelainV2,
  sparseExclusionPaths,
} from "./git/parsers";
import { evaluateSparseSafety, type SparseRepairPlan } from "./git/sparseSafety";
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
  SparseSafetyModal,
  StatusModal,
  TextPreviewModal,
  type ResultModalAction,
  type SparseSafetyFixes,
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
import { NGB_STATUS_VIEW, StatusView, summaryToViewData, type Group } from "./ui/StatusView";
import { buildMenuEntries, type MenuAction, type MenuScope } from "./ui/gitMenu";
import { HistoryView, NGB_HISTORY_VIEW } from "./ui/HistoryView";
import { DiffView, NGB_DIFF_VIEW, type DiffLoadResult, type DiffViewState } from "./ui/DiffView";
import { overrideWarning } from "./git/diffBudget";
import { ConflictView, NGB_CONFLICT_VIEW } from "./ui/ConflictView";
import { FileHistoryView, NGB_FILE_HISTORY_VIEW } from "./ui/FileHistoryView";
import { runSelfCheck } from "./bridge/selfCheck";
import { isValidBranchName, redactRemoteUrl, validateRemoteUrl } from "./git/remoteUrl";
import {
  describePreviousRepo,
  formatSize,
  parsePreviousRepo,
  reposToRemindAbout,
  PREVIOUS_GIT_PREFIX,
  type PreviousRepo,
} from "./git/previousRepos";
import { registerIcons } from "./ui/icons";
import {
  COMPANION_DOWNLOAD_APK_URI,
  COMPANION_GET_TERMUX_URI,
  COMPANION_OPEN_TERMUX_URI,
  COMPANION_RELEASES_URL,
  ACTION_TIMEOUT_SECONDS,
  COMPANION_SETUP_URI,
  CLAIM_FILE,
  PAIRING_FILE,
  PAIRING_WAIT_MS,
  bootstrapCommand,
  bootstrapCommandLocal,
  RUNNER_MIN_VERSION,
  RUNNER_OUTDATED_HINT,
  TERMUX_FDROID_URL,
  TERMUX_SITE_URL,
} from "./constants";
import { TFile } from "obsidian";
import { OperationLogModal } from "./ui/OperationLogModal";
import {
  conflictColorVars,
  DEFAULT_COLORS,
  diffColorVars,
  sanitizeColorSet,
  type NgbColorSet,
} from "./ui/colors";

/** Non-device-specific, shareable UI preferences (safe to sync via data.json). */
interface SharedUiPrefs {
  showStatusBar: boolean;
  showRibbonIcon: boolean;
  /** Wrap long lines in the diff pane instead of scrolling horizontally. */
  wrapDiffLines: boolean;
  /** Render whitespace glyphs (· → ␍) in the diff pane. */
  showInvisibles: boolean;
  /** Conflict pane: show raw <<<<<<< markers with separate action rows. */
  showConflictMarkers: boolean;
  /** Render file lists as a folder tree (status + history panels). */
  treeView: boolean;
  /**
   * Use the colours below instead of the theme's own. Off by default: the
   * pickers only appear (and the variables are only written) once it is on.
   */
  customColors: boolean;
  /** Custom colours per theme; only read while customColors is on. */
  colorsLight: NgbColorSet;
  colorsDark: NgbColorSet;
}
const DEFAULT_SHARED_PREFS: SharedUiPrefs = {
  showStatusBar: true,
  showRibbonIcon: true,
  wrapDiffLines: false,
  showInvisibles: false,
  showConflictMarkers: false,
  treeView: false,
  customColors: false,
  colorsLight: { ...DEFAULT_COLORS.light },
  colorsDark: { ...DEFAULT_COLORS.dark },
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
  private lastStatus: {
    status: GitStatusSummary;
    sparse: SparseStateSummary;
    lastCommit?: { hash: string; date: string; subject: string };
    fetchedAt: string;
    /** git's prepared MERGE_MSG while a merge is being resolved. */
    mergeMsg?: string;
    mergeInProgress?: boolean;
    /** An unfinished rebase (started in Termux; nothing here starts one). */
    rebaseInProgress?: boolean;
  } | null = null;

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
    // Colours end up in a style attribute, so whatever data.json holds is
    // merged over the defaults and anything that is not a hex value is dropped.
    this.sharedPrefs.colorsLight = sanitizeColorSet(this.sharedPrefs.colorsLight, "light");
    this.sharedPrefs.colorsDark = sanitizeColorSet(this.sharedPrefs.colorsDark, "dark");

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
          finishInProgressOp: (kind) =>
            kind === "merge" ? void this.cmdCommit() : void this.cmdContinueRebase(),
          abortInProgressOp: (kind) =>
            kind === "merge" ? void this.cmdAbortMerge() : void this.cmdAbortRebase(),
          cancel: () => void this.cmdCancel(),
          openFile: (p) => this.openVaultFile(p),
          openDiff: (p, group) => void this.openStatusDiff(p, group),
          openConflict: (p, pos) => void this.openConflict(p, pos),
          stage: (p) => void this.cmdStageFile(p),
          unstage: (p) => void this.cmdUnstageFile(p),
          discard: (p) => this.cmdDiscardFile(p),
          fileMenu: (p, group, pos) => {
            const menu = new Menu();
            this.buildGitMenu(menu, p, group);
            menu.showAtPosition(pos);
          },
          groupAction: (group, kind) => this.groupAction(group, kind),
          groupMenu: (group, pos) => {
            const menu = new Menu();
            this.buildGroupMenu(menu, group);
            menu.showAtPosition(pos);
          },
        })
    );

    this.registerView(
      NGB_HISTORY_VIEW,
      (leaf: WorkspaceLeaf) =>
        new HistoryView(leaf, {
          loadPage: (skip, limit) => this.loadRepoLogPage(skip, limit),
          openDiffAtCommit: (file, entry) => void this.openCommitDiff(file, entry),
          openFile: (p) => this.openVaultFile(p),
          progressText: () => this.progressText ?? "",
          treeView: () => this.sharedPrefs.treeView,
          toggleTree: () => void this.setSharedPref({ treeView: !this.sharedPrefs.treeView }),
          openStatusPanel: () => void this.openStatusPanel(),
        })
    );

    this.registerView(
      NGB_DIFF_VIEW,
      (leaf: WorkspaceLeaf) =>
        new DiffView(leaf, {
          loadDiff: (path, from, to, limitKb) => this.loadDiffText(path, from, to, limitKb),
          applyPatch: (patch, target, reverse) => this.applyHunkPatch(patch, target, reverse),
          confirmDiscard: (lines) =>
            new Promise<boolean>((resolve) => {
              new ConfirmModal(
                this.app,
                {
                  title: lines === 1 ? "Discard this line?" : `Discard ${lines} lines?`,
                  body: [
                    "The change is removed from the file itself. Unlike staging, this is not a move between the index and the working tree, and there is no opposite action that brings it back.",
                    "Obsidian's own version history may still have the text; git will not.",
                  ],
                  confirmLabel: "Discard",
                  danger: true,
                },
                (ok) => resolve(ok)
              ).open();
            }),
          confirmLargerDiff: (notice) =>
            new Promise<number | null>((resolve) => {
              new ConfirmModal(
                this.app,
                {
                  title: "Show the whole diff?",
                  body: overrideWarning(notice),
                  confirmLabel: notice.overrideLabel ?? "Show it",
                  icon: "file-diff",
                },
                (ok) => resolve(ok ? notice.overrideKb : null)
              ).open();
            }),
          wrapLines: () => this.sharedPrefs.wrapDiffLines,
          showInvisibles: () => this.sharedPrefs.showInvisibles,
          colors: () => this.diffColorVars(),
          progressText: () => this.progressText ?? "",
        })
    );

    this.registerView(
      NGB_FILE_HISTORY_VIEW,
      (leaf: WorkspaceLeaf) =>
        new FileHistoryView(leaf, {
          loadPage: (path, skip, limit) => this.loadFileLogPage(path, skip, limit),
          loadCommitDiff: (e) =>
            this.loadDiffText(e.pathAtCommit, `${e.hash}^`, e.hash),
          readFile: (p) => this.readVaultTextFile(p),
          writeFile: async (p, text) => {
            await this.app.vault.adapter.write(p, text);
          },
          stagePatch: (patch) => this.applyHunkPatch(patch, "index", false),
          restoreWholeFile: (p, e) => this.confirmRestore(p, e),
          viewAtCommit: (e) => void this.showFileAtCommit(e),
          progressText: () => this.progressText ?? "",
          wrapLines: () => this.sharedPrefs.wrapDiffLines,
          showInvisibles: () => this.sharedPrefs.showInvisibles,
          colors: () => this.diffColorVars(),
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
          markersVisible: () => this.sharedPrefs.showConflictMarkers,
          showInvisibles: () => this.sharedPrefs.showInvisibles,
          colors: () => this.conflictColorVars(),
        })
    );

    // A theme switch changes which colour set applies; the open panes have the
    // other theme's values written into their style attribute until told.
    this.registerEvent(this.app.workspace.on("css-change", () => this.refreshDiffPanes()));

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
  buildGitMenu(menu: Menu, path: string, known?: Group, kind: "file" | "folder" = "file"): void {
    if (!Platform.isAndroidApp) return;
    if (!this.deviceSettings.enabledOnThisDevice) return;
    const v = validateRepoRelativePath(path);
    if (!v.ok) return;
    const p = v.normalized;
    // The panel knows which state a row represents; the file explorer does not
    // and falls back to inference from the last status it saw.
    const group = known ?? this.inferGroup(p);
    const scope: MenuScope =
      kind === "folder"
        ? { kind: "folder", path: p, group, count: this.pathsUnder(p, group).length }
        : { kind: "file", path: p, group };
    this.addMenuEntries(menu, scope);
  }

  /** Which panel group a path belongs to, from the last status the panel saw. */
  private inferGroup(p: string): Group {
    const st = this.lastStatus?.status;
    const under = (path: string) => path === p || path.startsWith(p + "/");
    if (st?.conflicted.some((e) => under(e.path))) return "conflicted";
    if (st?.unstaged.some((e) => under(e.path))) return "unstaged";
    if (st?.untracked.some(under)) return "untracked";
    if (st?.staged.some((e) => under(e.path))) return "staged";
    // Nothing known yet: treat it as stageable, which is what the file
    // explorer entry has always been for.
    return "unstaged";
  }

  /** Paths of a group at or under `base` (empty base = the whole group). */
  private pathsUnder(base: string, group: Group): string[] {
    return this.groupPaths(group).filter(
      (f) => base === "" || f === base || f.startsWith(base + "/")
    );
  }

  /** Turn the shared menu description into real Obsidian menu items. */
  private addMenuEntries(menu: Menu, scope: MenuScope): void {
    const single = scope.kind === "file";
    const path = scope.kind === "group" ? "" : scope.path;
    const targets = () => (single ? [path] : this.pathsUnder(path, scope.group));
    const entries = buildMenuEntries(scope, {
      menuGitignore: this.deviceSettings.menuGitignore,
      menuSparse: this.deviceSettings.menuSparse,
      menuExclude: this.deviceSettings.menuExclude,
      ignored: single && this.isGitignored(path),
      sparseExcluded: single && this.isSparseExcluded(path),
      excluded: single && this.isExcluded(path),
    });
    for (const e of entries) {
      menu.addItem((i) => {
        i.setTitle(e.title).setIcon(e.icon);
        i.onClick(() => this.runMenuAction(e.action, scope, targets));
      });
    }
  }

  private runMenuAction(action: MenuAction, scope: MenuScope, targets: () => string[]): void {
    const path = scope.kind === "group" ? "." : scope.path;
    const group = scope.group;
    switch (action) {
      case "stage":
        if (scope.kind === "group") this.groupAction(group, "stage");
        else void this.cmdStageFile(path, group === "unstaged" ? "update" : "all");
        return;
      case "unstage":
        if (scope.kind === "group") void this.cmdUnstageAll();
        else void this.cmdUnstageFile(path);
        return;
      case "discard":
        if (scope.kind === "group") this.groupAction(group, "discard");
        else this.folderAction(group, path, "discard");
        return;
      case "resolve-local":
      case "resolve-remote": {
        const side = action === "resolve-local" ? "ours" : "theirs";
        if (scope.kind === "file") this.cmdResolveConflict(path, side);
        else this.confirmResolveMany(targets(), side);
        return;
      }
      case "open-diff":
        void this.openStatusDiff(path, group);
        return;
      case "open-conflict":
        void this.openConflict(path, { x: 0, y: 0 });
        return;
      case "open-history":
        void this.openFileHistoryPanel(path);
        return;
      case "open-external":
        this.openWithDefaultApp(path);
        return;
      case "copy-path":
        void navigator.clipboard.writeText(path);
        new Notice("Path copied.");
        return;
      case "abort-merge":
        void this.cmdAbortMerge();
        return;
      case "gitignore-add":
        if (scope.kind === "file") void this.gitignoreAdd(`/${path}`);
        else this.confirmBulkIgnore(targets());
        return;
      case "gitignore-remove":
        void this.gitignoreRemove(`/${path}`);
        return;
      case "sparse-add":
        if (scope.kind === "file") void this.cmdSparseExclude(path, true);
        else this.confirmBulkPerPath(targets(), "sparse");
        return;
      case "sparse-remove":
        void this.cmdSparseExclude(path, false);
        return;
      case "exclude-add":
        if (scope.kind === "file") void this.cmdExcludeChange(path, true);
        else this.confirmBulkPerPath(targets(), "exclude");
        return;
      case "exclude-remove":
        void this.cmdExcludeChange(path, false);
        return;
    }
  }

  /** Resolve several conflicted files the same way, after one confirmation. */
  private confirmResolveMany(paths: string[], side: "ours" | "theirs"): void {
    if (paths.length === 0) return;
    new ConfirmModal(
      this.app,
      {
        title:
          side === "ours"
            ? "Keep the LOCAL version of these files?"
            : "Keep the REMOTE version of these files?",
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `…and ${paths.length - 10} more` : "",
          side === "ours"
            ? "The incoming remote changes to these files are discarded."
            : "Your local changes to these files are discarded.",
          `This runs one Termux round trip per file (${paths.length} in total).`,
        ].filter((l) => l !== ""),
        confirmLabel: side === "ours" ? "Keep local" : "Keep remote",
        danger: true,
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) {
          const result = await this.runOperation("resolve-conflict", {
            path: p,
            side,
            protectedPaths: this.effectiveProtectedPaths(),
          });
          if (!result?.ok) break;
          this.absorbStatusData(result.data ?? {});
        }
        await this.cmdStatus(true);
      }
    ).open();
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
    // Disk that nobody asked for, in a folder nobody opens: worth one line a day.
    void this.remindAboutPreviousRepos();
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
          profileId: pairing.profileId ?? this.deviceSettings.profileId,
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

  /**
   * A result names the profile that answered. The first one teaches this vault
   * its own id; after that the id travels in every request and the runner
   * rejects anything that names a different profile. A mismatch is never
   * silently adopted — that would be the plugin re-pointing itself at another
   * vault's repository.
   */
  private async learnProfileId(result: BridgeResult): Promise<void> {
    const id = typeof result.profileId === "string" ? result.profileId : "";
    if (!isValidProfileId(id)) return;
    const current = this.deviceSettings.profileId;
    if (current === id) return;
    if (current === "") {
      await this.updateDeviceSettings({ profileId: id });
      this.log.add("info", "pairing", `This vault is served by profile ${id}.`);
      return;
    }
    this.log.add(
      "warn",
      "pairing",
      `A result came back from profile ${id}, but this vault is paired with ${current}. Keeping ${current}; re-run the installer if the vault was re-paired.`
    );
  }

  /**
   * Ask Termux to pair THIS vault, without re-running the installer.
   *
   * The trigger the companion sends is fixed and carries no vault identity, so
   * the request goes the other way: the plugin drops a claim file into its own
   * runtime folder and triggers a runner run. The runner, when it has nothing
   * else to do, finds the claim, verifies the folder really is a repository of
   * its own, generates the token IN TERMUX and answers with a pairing file.
   * Nothing secret leaves Termux, and nothing the claim contains is trusted.
   *
   * Poll interval and budget are fields so tests can shrink them.
   */
  pairingPollMs = 500;
  pairingWaitMs = PAIRING_WAIT_MS;

  async cmdPairThisVault(): Promise<void> {
    if (!Platform.isAndroidApp) {
      new Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const adapter = this.app.vault.adapter;
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const claimPath = `${root}/${CLAIM_FILE}`;
    const pairingPath = `${root}/${PAIRING_FILE}`;
    // A vault that is not a repository yet has to say so: the runner pairs a
    // directory without a repository ONLY when it was asked to, and the
    // resulting profile can then answer nothing but "create one" / "clone one".
    const needsRepo = !(await this.vaultHasRepository());
    try {
      await this.client.ensureRuntimeDirs();
      await adapter.write(
        claimPath,
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            vault: this.app.vault.getName(),
            bootstrap: needsRepo,
          },
          null,
          2
        )
      );
    } catch (e) {
      new ResultModal(this.app, "Pairing failed", [`The pairing request could not be written: ${String(e)}`], {
        isError: true,
      }).open();
      return;
    }
    this.log.add("info", "pairing", "Pairing request written; asking Termux to pick it up.");
    // A synthetic id: there is no request file, the runner is simply woken up.
    this.makeTransport().trigger(`r-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-pair`);
    new Notice("Asked Termux to pair this vault…");

    const deadline = Date.now() + this.pairingWaitMs;
    for (;;) {
      await new Promise((r) => window.setTimeout(r, this.pairingPollMs));
      if (await adapter.exists(pairingPath)) {
        await this.tryImportPairing();
        if (this.deviceSettings.authToken) {
          try {
            if (await adapter.exists(claimPath)) await adapter.remove(claimPath);
          } catch {
            /* best effort */
          }
          new ResultModal(this.app, "This vault is paired", [
            `Profile: ${this.deviceSettings.profileId || "(unnamed)"}`,
            "Termux answered with a token of its own for this vault. Other vaults keep their own profiles and tokens.",
          ]).open();
          return;
        }
      }
      if (Date.now() >= deadline) break;
    }
    new ResultModal(
      this.app,
      "No answer from Termux yet",
      [
        "The pairing request is written and stays there; the runner picks it up on its next run.",
        "If nothing happens: Termux must be installed and the runner already set up once (the install command below does that), and the companion app needs its RUN_COMMAND permission.",
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
  }

  /**
   * Repositories set aside by a re-clone, read from the manifests the runner
   * writes next to them. No Termux round trip and no walking of a large
   * directory: the manifest is a few hundred bytes.
   */
  async listPreviousRepos(): Promise<PreviousRepo[]> {
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const out: PreviousRepo[] = [];
    try {
      const listing = await this.app.vault.adapter.list(root);
      for (const f of listing.files) {
        const name = f.slice(f.lastIndexOf("/") + 1);
        if (!name.startsWith(PREVIOUS_GIT_PREFIX) || !name.endsWith(".json")) continue;
        const parsed = parsePreviousRepo(await this.app.vault.adapter.read(f));
        if (parsed) out.push(parsed);
      }
    } catch {
      /* no runtime folder yet, or unreadable */
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Once a day, if a re-clone left a repository behind, say so.
   *
   * It is invisible (inside a dot-folder inside the config directory) and it
   * can be hundreds of megabytes on a vault of a few thousand files. Nobody
   * goes looking for it; the plugin that created it should be the one to
   * mention it — once a day, never twice in a session, and never again about a
   * copy the user has decided to keep.
   */
  private async remindAboutPreviousRepos(): Promise<void> {
    const repos = await this.listPreviousRepos();
    if (repos.length === 0) return;
    const s = this.deviceSettings;
    const due = reposToRemindAbout(repos, {
      lastRemindedAt: s.previousRepoRemindedAt,
      dismissed: s.previousRepoDismissed,
    });
    if (due.length === 0) return;
    await this.updateDeviceSettings({ previousRepoRemindedAt: Date.now() });
    this.showPreviousRepoModal(due, "A previous repository is still taking up space");
  }

  /** The reminder and the settings entry share one window. */
  showPreviousRepoModal(repos: PreviousRepo[], title: string): void {
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const total = repos.reduce((n, r) => n + r.sizeKb, 0);
    const lines = [
      repos.length === 1
        ? "Re-cloning this vault put the repository it replaced aside instead of deleting it, because it may hold commits that exist nowhere else."
        : `Re-cloning this vault put ${repos.length} earlier repositories aside instead of deleting them.`,
      "",
      ...repos.map((r) => `${r.dir} — ${describePreviousRepo(r)}${r.lastCommit ? `, last: ${r.lastCommit}` : ""}`),
      "",
      `Total: ${formatSize(total)}, in ${root}/`,
      "",
      "Keeping it costs only disk. Deleting it is final: any commit that exists only there goes with it. To look inside first, in Termux:",
      `git -C <vault> remote add previous <vault>/${root}/${repos[0]?.dir ?? ""}`,
      "git -C <vault> fetch previous     # then browse previous/<branch>",
    ];
    const actions: ResultModalAction[] = [
      {
        label: repos.length === 1 ? "Delete it" : "Delete all of them",
        onClick: () => this.confirmDeletePreviousRepos(repos),
      },
      {
        label: "Keep, remind me tomorrow",
        cta: true,
        onClick: () => undefined,
      },
      {
        label: "Keep, stop reminding",
        onClick: () => {
          void this.updateDeviceSettings({
            previousRepoDismissed: [
              ...this.deviceSettings.previousRepoDismissed,
              ...repos.map((r) => r.dir),
            ],
          });
          this.notify("The old repository stays; no more reminders about it.");
        },
      },
    ];
    new ResultModal(this.app, title, lines, { actions }).open();
  }

  private confirmDeletePreviousRepos(repos: PreviousRepo[]): void {
    const total = repos.reduce((n, r) => n + r.sizeKb, 0);
    const commits = repos.reduce((n, r) => n + r.commits, 0);
    new ConfirmModal(
      this.app,
      {
        title: "Delete the old repository?",
        body: [
          `${repos.length === 1 ? "One repository" : `${repos.length} repositories`}, ${formatSize(total)}, ${commits} commit${commits === 1 ? "" : "s"} in total.`,
          "Only the history goes: your notes are the files in the vault and are not touched.",
          "This cannot be undone from here. Any commit that exists only in this copy — anything never pushed — is gone with it.",
        ],
        confirmLabel: "Delete permanently",
        icon: "trash",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const root = new RuntimePaths(this.app.vault.configDir).root;
        const failed: string[] = [];
        for (const r of repos) {
          try {
            // rmdir(recursive) rather than the trash: this IS the copy that was
            // kept for safety, and moving it to the trash would only move the
            // disk usage somewhere the user looks at even less often.
            await this.app.vault.adapter.rmdir(`${root}/${r.dir}`, true);
            await this.app.vault.adapter.remove(`${root}/${r.dir}.json`);
          } catch (e) {
            failed.push(r.dir);
            this.log.add("error", "clone", `Could not delete ${r.dir}: ${String(e)}`);
          }
        }
        if (failed.length > 0) {
          new ResultModal(
            this.app,
            "Some copies could not be deleted",
            [...failed, `Delete them by hand in Termux: rm -rf <vault>/${root}/previous-git-*`],
            { isError: true }
          ).open();
          return;
        }
        this.notify(`Freed ${formatSize(total)}.`);
      }
    ).open();
  }

  /**
   * Does this vault hold a repository? Answered from the vault itself, without
   * a Termux round trip: `.git` is either a directory (normal) or a file (a
   * worktree link). Used to decide which bootstrap steps make sense.
   */
  async vaultHasRepository(): Promise<boolean> {
    try {
      return await this.app.vault.adapter.exists(".git");
    } catch {
      return false;
    }
  }

  /**
   * "Set up the repository for this vault": the missing beginning of the
   * story, in the same shape as the setup guide — a short list of steps, one
   * action each, decided from what this vault actually is right now.
   */
  async cmdSetupRepository(): Promise<void> {
    if (!Platform.isAndroidApp) {
      new Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const s = this.deviceSettings;
    const hasRepo = await this.vaultHasRepository();
    const paired = s.authToken !== "";
    const lines: string[] = [];
    const actions: ResultModalAction[] = [];

    lines.push(
      hasRepo
        ? "This vault is a git repository."
        : "This vault is NOT a git repository yet.",
      `Paired with Termux: ${paired ? `yes (${s.profileId || "profile unknown"})` : "no"}`,
      ""
    );

    if (!paired) {
      lines.push(
        "Termux has to know this vault before it can do anything here. Pairing works even before the repository exists.",
        "1. Pair this vault (Termux generates the token and answers).",
        "2. Then come back here to create or clone the repository."
      );
      actions.push({
        label: "Pair this vault",
        cta: true,
        keepOpen: true,
        onClick: () => void this.cmdPairThisVault(),
      });
      new ResultModal(this.app, "Set up the repository", lines, { actions }).open();
      return;
    }

    if (!hasRepo) {
      lines.push(
        "Two ways to give it one:",
        "• Start fresh — create an empty repository here and, if you want, commit what the vault already contains. You can add a remote afterwards.",
        "• Clone an existing one — the vault keeps the files it already has; anything that exists on both sides is reported and you decide, nothing is overwritten silently.",
        "",
        "Credentials never come through the plugin. Set them up once in Termux (a credential helper, an SSH key, or `gh auth login`) — see docs/setup.md."
      );
      actions.push(
        { label: "Create a repository here", cta: true, keepOpen: true, onClick: () => this.promptInitRepo() },
        { label: "Clone from a remote", keepOpen: true, onClick: () => this.promptClone() }
      );
    } else {
      // Only what the last status actually reported: claiming "no remote"
      // when the plugin simply has not asked yet would be a lie.
      lines.push(
        `Remote, as of the last status: ${this.lastRemoteUrl || "not seen yet — run Status to find out"}`,
        "",
        "Fetch, pull and push need one. Set it if the repository has none, or change it if it moved or was set up with the wrong account."
      );
      actions.push({
        label: this.lastRemoteUrl ? "Change the remote" : "Add a remote",
        cta: true,
        keepOpen: true,
        onClick: () => this.promptSetRemote(),
      });
      actions.push({
        label: "Re-clone from a remote",
        keepOpen: true,
        onClick: () => this.promptClone(true),
      });
    }
    new ResultModal(this.app, "Set up the repository", lines, { actions }).open();
  }

  /**
   * Shared precondition for the two direct commands: Android, and paired with
   * Termux. Pairing is checked because neither command can do anything without
   * a runner, and the guided setup is the only place that can fix that.
   */
  private async setupPrecondition(): Promise<boolean> {
    if (!Platform.isAndroidApp) {
      new Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return false;
    }
    if (this.deviceSettings.authToken === "") {
      new ResultModal(
        this.app,
        "Not paired with Termux yet",
        [
          "Termux has to know this vault before it can create or clone anything here.",
          "Pairing works even before the repository exists.",
        ],
        {
          actions: [
            { label: "Pair this vault", cta: true, keepOpen: true, onClick: () => void this.cmdPairThisVault() },
          ],
        }
      ).open();
      return false;
    }
    return true;
  }

  /**
   * "Create a new repository in this vault", straight from the palette.
   * Refuses when the vault already is a repository rather than offering to
   * replace it: re-initialising over an existing history is not a thing this
   * plugin does silently, and "Clone" is the command that handles replacement.
   */
  async cmdCreateRepository(): Promise<void> {
    if (!(await this.setupPrecondition())) return;
    if (await this.vaultHasRepository()) {
      new ResultModal(
        this.app,
        "This vault is already a repository",
        [
          "Nothing was changed. Creating a second repository over an existing one would hide its history rather than remove it.",
          "To point it somewhere else, set the remote; to start from a remote instead, use 'Clone an existing remote into this vault'.",
        ],
        {
          actions: [
            { label: "Set the remote", cta: true, keepOpen: true, onClick: () => this.promptSetRemote() },
            { label: "Clone instead", keepOpen: true, onClick: () => this.promptClone(true) },
          ],
        }
      ).open();
      return;
    }
    this.promptInitRepo();
  }

  /**
   * "Clone an existing remote into this vault", straight from the palette.
   * A vault that already has a repository goes through the replace
   * confirmation, which is the same path the setup modal uses.
   */
  async cmdCloneRepository(): Promise<void> {
    if (!(await this.setupPrecondition())) return;
    this.promptClone(await this.vaultHasRepository());
  }

  /** Remote URL of the repository as of the last status (already redacted by the runner). */
  lastRemoteUrl = "";

  private promptInitRepo(): void {
    new CommitMessageModal(
      this.app,
      {
        title: "Create a repository in this vault",
        placeholder: "main",
        submitLabel: "Create repository",
        initial: "main",
      },
      (branch) => {
        if (branch === null) return;
        if (!isValidBranchName(branch)) {
          new ResultModal(this.app, "Invalid branch name", [
            `'${branch}' is not a branch name this plugin will send.`,
            "Letters, digits, dot, dash, underscore and slash; no '..', no leading dash.",
          ], { isError: true }).open();
          return;
        }
        new ConfirmModal(
          this.app,
          {
            title: "Commit what is here?",
            body: [
              `A new repository on branch '${branch}' will be created in this vault.`,
              "Confirm to also make a first commit containing every file the vault currently holds (the plugin's runtime folder is excluded automatically).",
              "Decline to create the repository empty and commit later, after reviewing what is in it.",
            ],
            confirmLabel: "Create and commit everything",
            icon: "check",
          },
          async (commitAll) => {
            const result = await this.runOperation("init-repo", {
              branch,
              initialCommit: commitAll,
              message: "Initial commit (native git bridge)",
            });
            if (!result) return;
            if (!result.ok) return this.renderMutationError("Native Git: init failed", result);
            this.absorbStatusData(result.data ?? {});
            new ResultModal(this.app, "Repository created", [
              `Branch: ${result.data?.branch ?? branch}`,
              result.data?.committed === "true"
                ? "The vault's files are in the first commit."
                : "Nothing is committed yet.",
              "Next: add a remote, then push.",
            ], {
              actions: [
                { label: "Add a remote", cta: true, keepOpen: true, onClick: () => this.promptSetRemote() },
              ],
            }).open();
          }
        ).open();
      }
    ).open();
  }

  private promptSetRemote(): void {
    new CommitMessageModal(
      this.app,
      {
        title: "Remote for this vault",
        placeholder: "https://github.com/you/vault.git",
        submitLabel: "Save remote",
        initial: "",
      },
      async (raw) => {
        if (raw === null) return;
        const verdict = validateRemoteUrl(raw);
        if (!verdict.ok) {
          new ResultModal(this.app, "That URL cannot be used", [verdict.reason ?? "Invalid URL."], {
            isError: true,
          }).open();
          return;
        }
        const result = await this.runOperation("set-remote", { url: verdict.url });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: set remote failed", result);
        this.absorbStatusData(result.data ?? {});
        this.afterRemoteSet(verdict.url, result.data ?? {});
      }
    ).open();
  }

  private promptClone(replaceExisting = false): void {
    if (replaceExisting) {
      new ConfirmModal(
        this.app,
        {
          title: "Replace this vault's repository?",
          body: [
            "The repository will be cloned again from a remote you give next.",
            "Your notes are not touched: files that exist on both sides keep your version and show up as local changes, files that exist only here stay untracked.",
            "The repository that is here now is NOT deleted — it is set aside in the plugin's runtime folder, with its history intact, and you decide later what to do with it.",
            "Nothing happens until the clone succeeds: a clone that fails leaves everything exactly as it is.",
          ],
          confirmLabel: "Choose the remote",
          icon: "download",
        },
        (confirmed) => {
          if (confirmed) this.askCloneUrl(true);
        }
      ).open();
      return;
    }
    this.askCloneUrl(false);
  }

  private askCloneUrl(replaceExisting: boolean): void {
    new CommitMessageModal(
      this.app,
      {
        title: "Clone into this vault",
        placeholder: "https://github.com/you/vault.git",
        submitLabel: "Clone",
        initial: "",
      },
      (raw) => {
        if (raw === null) return;
        const verdict = validateRemoteUrl(raw);
        if (!verdict.ok) {
          new ResultModal(this.app, "That URL cannot be used", [verdict.reason ?? "Invalid URL."], {
            isError: true,
          }).open();
          return;
        }
        void this.runClone(verdict.url, replaceExisting);
      }
    ).open();
  }

  /**
   * Clone into a vault that already holds files.
   *
   * Nothing the vault already has is written over: the repository's tree goes
   * into the index, everything the vault does not have is written out of it,
   * and the files that exist on both sides stay as they are and appear in the
   * panel as ordinary local changes. So the decision the user faces is not a
   * blind "keep mine or take theirs" before they can see anything — it is the
   * per-file one they already know, with a diff, after the fact.
   */
  /**
   * Setting a remote is where the two ways of attaching a repository either
   * converge or part company, so this is the moment to say which one happened.
   *
   * A vault whose repository was created here has a history of its own. If the
   * remote also has one, the two are unrelated and git will refuse to merge
   * them later, with a message that arrives far too late to be useful. If the
   * local repository has no commits yet, the remote's history can simply be
   * taken over, which lands in exactly the state cloning would have produced.
   */
  private afterRemoteSet(url: string, d: Record<string, string>): void {
    const shown = redactRemoteUrl(url);
    const remoteBranches = (d.remoteBranches ?? "").split("\n").filter((b) => b.trim() !== "");
    const localCommits = d.localCommits === "true";
    if (d.remoteReachable !== "true") {
      new ResultModal(this.app, "Remote saved", [
        `Origin is now ${shown}.`,
        "It could not be reached just now, so there is nothing more to say about it yet — usually credentials that are not set up in Termux, or no connection. Run Fetch once they are.",
      ]).open();
      return;
    }
    if (remoteBranches.length === 0) {
      new ResultModal(this.app, "Remote saved", [
        `Origin is now ${shown}.`,
        "The remote is empty, so this vault's history will be the first thing in it. Commit, then push.",
      ]).open();
      return;
    }
    if (!localCommits) {
      new ResultModal(
        this.app,
        "Remote saved — it already has content",
        [
          `Origin is now ${shown}, and it already contains: ${remoteBranches.join(", ")}.`,
          "This vault has no commits yet, so it can simply take that history over. Your existing files are kept: the ones that also exist in the repository become ordinary local changes, and the rest of the repository is checked out around them — the same result cloning would have given.",
        ],
        {
          actions: [
            {
              label: "Get the repository's content",
              cta: true,
              onClick: () => void this.runAdoptRemote(),
            },
          ],
        }
      ).open();
      return;
    }
    new ResultModal(
      this.app,
      "Remote saved — but the two histories are unrelated",
      [
        `Origin is now ${shown}, and it already contains: ${remoteBranches.join(", ")}.`,
        "This vault also has commits of its own, made here. Git treats the two as unrelated histories: pull will refuse to merge them, and push will be rejected. Nothing is broken — but they cannot simply be joined.",
        "",
        "The clean way out: open a NEW empty vault and clone the repository into it, then move your notes across.",
        "The deliberate way: in Termux, either `git pull --allow-unrelated-histories` (keeps both, expect conflicts) or reset onto the remote branch (throws your local commits away). This plugin does neither for you.",
      ],
      { isError: true }
    ).open();
  }

  /** Take an already configured remote's history into a repository with none. */
  private async runAdoptRemote(): Promise<void> {
    const result = await this.runOperation("adopt-remote", {});
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: could not take the remote's content", result);
    this.absorbStatusData(result.data ?? {});
    const collisions = (result.data?.collisions ?? "").split("\n").filter((l) => l.trim() !== "");
    const lines = [`Branch: ${result.data?.branch ?? "(unknown)"}`];
    if (collisions.length === 0) {
      lines.push("The repository's files are in the vault. Nothing you already had was touched.");
    } else {
      lines.push(
        `${collisions.length} file${collisions.length === 1 ? "" : "s"} existed here as well; your versions were kept and now show in the panel as local changes:`,
        ...collisions.slice(0, 10),
        collisions.length > 10 ? `…and ${collisions.length - 10} more` : ""
      );
    }
    new ResultModal(this.app, "Repository content taken over", lines.filter((l) => l !== "")).open();
  }

  private async runClone(url: string, replaceExisting = false): Promise<void> {
    const args: Record<string, unknown> = { url };
    if (replaceExisting) args.replaceExisting = true;
    const result = await this.runOperation("clone-into-vault", args);
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: clone failed", result);
    this.absorbStatusData(result.data ?? {});
    const collisions = (result.data?.collisions ?? "").split("\n").filter((l) => l.trim() !== "");
    const lines = [`Branch: ${result.data?.branch || "(unborn)"}`];
    if (result.data?.empty === "true") {
      lines.push("The remote is empty; the vault is linked to it and ready for a first commit.");
    } else if (collisions.length === 0) {
      lines.push("The repository's files are in the vault. Nothing you already had was touched.");
    } else {
      lines.push(
        `The repository's files are in the vault, and ${collisions.length} of them also existed here.`,
        "Your versions were kept — they now show in the panel as local changes:",
        ...collisions.slice(0, 10),
        collisions.length > 10 ? `…and ${collisions.length - 10} more` : "",
        "",
        "Open each one to see the difference, then commit to keep yours or discard to take the repository's version. Files that exist only here were left alone and are simply untracked."
      );
    }
    if (result.data?.previousGit) {
      lines.push(
        "",
        `The repository that was here is not deleted — it is set aside as ${result.data.previousGit} in the plugin's runtime folder. The plugin will remind you about the disk it uses; delete it once you are sure nothing in it is needed.`
      );
    }
    if (result.data?.configDirTracked === "true" && result.data?.empty !== "true") {
      lines.push(
        "",
        `This repository also tracks ${this.app.vault.configDir}/. Restart Obsidian now: it read the old configuration when it started and can overwrite parts of it from memory until you do. Plugins that arrived with the clone appear only after the restart.`
      );
    }
    new ResultModal(this.app, "Repository cloned", lines.filter((l) => l !== "")).open();
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
    // A half-finished merge or rebase with every conflict already resolved is
    // still a repository that refuses to pull. It reads as "conflict" here so
    // the indicator cannot go green on a state nothing else will work from.
    if (this.lastStatus?.mergeInProgress || this.lastStatus?.rebaseInProgress) {
      this.statusBar.set(
        "conflict",
        s.conflicted.length > 0 ? `(${s.conflicted.length})` : undefined
      );
    } else if (s.conflicted.length > 0) this.statusBar.set("conflict", `(${s.conflicted.length})`);
    else if (s.staged.length + s.unstaged.length + s.untracked.length > 0)
      this.statusBar.set("changed", `(${s.staged.length + s.unstaged.length + s.untracked.length})`);
    else this.statusBar.set("clean", s.ahead > 0 ? `↑${s.ahead}` : undefined);
  }

  // -------------------------------------------------------------- commands

  private registerCommands(): void {
    const cmds: { id: string; name: string; cb: () => void }[] = [
      // Obsidian already prefixes every entry with the plugin name, so a
      // "Native Git: " here produced "Native Git Bridge: Native Git: Fetch".
      // Ids stay untouched: they are what user hotkeys are bound to.
      { id: "status", name: "Status", cb: () => void this.cmdStatus() },
      { id: "pull", name: "Pull", cb: () => void this.cmdPull() },
      { id: "push", name: "Push", cb: () => void this.cmdPush() },
      { id: "commit", name: "Commit", cb: () => void this.cmdCommit() },
      { id: "sync", name: "Sync", cb: () => void this.cmdSync() },
      { id: "fetch", name: "Fetch", cb: () => void this.cmdFetch() },
      { id: "stage-all", name: "Stage all changes", cb: () => void this.cmdStageAll() },
      { id: "unstage-all", name: "Unstage all changes", cb: () => void this.cmdUnstageAll() },
      { id: "discard-all", name: "Discard all local changes (keep staged)", cb: () => this.cmdDiscardAll() },
      { id: "reset-all", name: "Reset everything to HEAD (staged and local changes)", cb: () => this.cmdResetAll() },
      { id: "show-history-current-file", name: "Show history for current file", cb: () => this.cmdFileHistory() },
      { id: "show-diff-current-file", name: "Show diff for current file", cb: () => void this.cmdDiffCurrentFile() },
      { id: "show-file-at-commit", name: "Show current file at a commit", cb: () => this.cmdFileHistory() },
      { id: "restore-file-from-commit", name: "Restore current file from a commit", cb: () => this.cmdFileHistory() },
      { id: "show-changed-files", name: "Show changed files", cb: () => void this.cmdShowChangedFiles() },
      { id: "verify-sparse-safety", name: "Verify sparse checkout safety", cb: () => void this.cmdVerifySparseSafety() },
      { id: "reapply-sparse", name: "Reapply sparse checkout", cb: () => void this.cmdReapplySparse() },
      { id: "diagnostics", name: "Run diagnostics", cb: () => void this.cmdDiagnostics() },
      { id: "open-operation-log", name: "Open operation log", cb: () => new OperationLogModal(this.app, this.log).open() },
      { id: "open-status-panel", name: "Open status panel", cb: () => void this.openStatusPanel() },
      { id: "open-history-panel", name: "Open history panel", cb: () => void this.openHistoryPanel() },
      { id: "open-file-history-panel", name: "Open history panel for the current file", cb: () => {
        const p = this.activeFilePath();
        if (p !== null) void this.openFileHistoryPanel(p);
      } },
      { id: "bridge-self-check", name: "Check bridge (no Termux round trip)", cb: () => void this.cmdSelfCheck() },
      { id: "open-companion-setup", name: "Open companion app setup", cb: () => void this.openCompanionSetup() },
      { id: "setup-guide", name: "Setup guide (Termux, companion, pairing)", cb: () => this.openSetupGuide("Setup guide.") },
      { id: "pair-this-vault", name: "Pair this vault with Termux", cb: () => void this.cmdPairThisVault() },
      { id: "setup-repository", name: "Set up the repository for this vault", cb: () => void this.cmdSetupRepository() },
      // The two halves of "set up" as their own commands. They were only ever
      // reachable as buttons inside the setup modal, so the palette offered a
      // single "Set up" and no way to say which of the two very different
      // things you meant. Both still route through the same prompts, and both
      // refuse for the same reasons the modal would.
      { id: "create-repository", name: "Create a new repository in this vault", cb: () => void this.cmdCreateRepository() },
      { id: "clone-repository", name: "Clone an existing remote into this vault", cb: () => void this.cmdCloneRepository() },
      { id: "cancel-operation", name: "Cancel current operation when possible", cb: () => void this.cmdCancel() },
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

    const req = createRequest(
      action,
      args,
      s.authToken,
      ACTION_TIMEOUT_SECONDS[action] ?? s.opTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      new Date(),
      randomSuffix(),
      s.profileId
    );
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
    this.runningPath = typeof args["path"] === "string" ? args["path"] : null;
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
      await this.learnProfileId(result);
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
    // ONE path into lastStatus. This used to parse and assign the fields here,
    // duplicating absorbStatusData minus the merge/rebase ones — so a refresh
    // silently dropped them. The visible symptom: a failed pull (which goes
    // through absorbStatusData) raised the "merge in progress" banner, and the
    // very next status refresh made it disappear again while git was still
    // mid-merge and still refusing to pull. The same omission also cost the
    // commit modal its prefilled MERGE_MSG after any refresh.
    this.absorbStatusData(result.data ?? {});
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
    new SparseSafetyModal(this.app, report, SPARSE_SAFETY_WARNING, this.sparseSafetyFixes()).open();
  }

  /**
   * Move every listed path to Obsidian's trash, expanding folders into their
   * files first.
   *
   * Two reasons this is not a plain loop over `trashLocal`. git's porcelain
   * output collapses a fully untracked directory into a single `dir/` entry,
   * so one "file" in the list can be a folder holding many; and a path with
   * the trailing slash git prints is not a path the adapter recognises. The
   * old loop therefore trashed the first entry and quietly logged failures for
   * the rest, which looked like "only one file was deleted".
   */
  private async trashAll(
    paths: string[]
  ): Promise<{ moved: number; failed: string[]; absent: number }> {
    const adapter = this.app.vault.adapter;
    let moved = 0;
    // Paths that were not on disk to begin with. Counted separately because
    // they are neither a success nor a failure, and calling them either is what
    // produced "Moved 0 files to the trash" for a repair that could not
    // possibly have moved anything.
    let absent = 0;
    const failed: string[] = [];
    const expand = async (raw: string): Promise<string[]> => {
      const p = raw.replace(/\/+$/, "");
      if (p === "") return [];
      let isFolder = false;
      try {
        const st = await adapter.stat(p);
        isFolder = st?.type === "folder";
      } catch {
        isFolder = false;
      }
      if (!isFolder) return [p];
      // Files first, then the (now empty) folder, so nothing is left behind
      // and no child is trashed twice.
      const out: string[] = [];
      try {
        const listing = await adapter.list(p);
        for (const f of listing.files) out.push(f);
        for (const d of listing.folders) out.push(...(await expand(d)));
      } catch (e) {
        this.log.add("warn", "sparse", `Could not list ${p}: ${String(e)}`);
      }
      out.push(p);
      return out;
    };
    const targets: string[] = [];
    for (const raw of paths) {
      for (const t of await expand(raw)) if (!targets.includes(t)) targets.push(t);
    }
    for (const t of targets) {
      try {
        await adapter.trashLocal(t);
        moved++;
      } catch (e) {
        // A folder that is already gone (its files were trashed with it) is
        // not a failure; anything still on disk is.
        let stillThere = true;
        try {
          stillThere = await adapter.exists(t);
        } catch {
          stillThere = true;
        }
        if (stillThere) {
          failed.push(t);
          this.log.add("error", "sparse", `Trash failed for ${t}: ${String(e)}`);
        } else {
          absent++;
          this.log.add("info", "sparse", `Nothing to trash at ${t}: it is not on disk.`);
        }
      }
    }
    return { moved, failed, absent };
  }

  /**
   * Carry out a sparse repair plan and say exactly what happened.
   *
   * The order matters. The index entries go first: `git rm --cached` needs
   * nothing from the worktree, while trashing a file that is still in the index
   * turns a staged addition into a staged addition of a missing file — the
   * precise state this repair exists to clear.
   *
   * Every branch reports. The old code counted a trash failure as "not a
   * failure" whenever the file turned out not to exist, so a plan that could do
   * nothing at all announced "Moved 0 files to the trash" and left the user to
   * re-run the same dead end.
   */
  private async runSparseRepair(plan: SparseRepairPlan): Promise<void> {
    const done: string[] = [];
    const problems: string[] = [];

    if (plan.unstage.length > 0) {
      // protectedPaths is NOT optional here: the runner checks each path
      // against it and refuses the request outright when the list is empty,
      // because "which paths are protected" is the whole permission model for
      // this action. Omitting it made the repair fail every single time.
      const result = await this.runOperation("unstage-protected", {
        paths: plan.unstage,
        protectedPaths: this.effectiveProtectedPaths(),
      });
      if (!result) return;
      if (!result.ok) {
        this.renderMutationError("Native Git: could not clear the index entries", result);
        return;
      }
      const n = Number(result.data?.unstagedProtectedCount ?? plan.unstage.length);
      this.absorbStatusData(result.data ?? {});
      // The runner is idempotent and answers 0 when the entries were already
      // gone. Saying "0 index entries removed" would be the same empty
      // reassurance as the "Moved 0 files to the trash" this replaced.
      if (n > 0) {
        done.push(`${n} index entr${n === 1 ? "y" : "ies"} removed (nothing was deleted from disk).`);
      }
    }

    if (plan.trash.length > 0) {
      const { moved, failed, absent } = await this.trashAll(plan.trash);
      if (moved > 0) done.push(`${moved} file${moved === 1 ? "" : "s"} moved to the trash.`);
      // Sparse checkout sets skip-worktree, so git reports a staged addition as
      // a plain "A" and never mentions that the file is gone. Being told so
      // plainly here beats a count of zero that looks like a failure.
      if (absent > 0) {
        done.push(
          `${absent} listed path${absent === 1 ? " was" : "s were"} not on disk (sparse checkout had already removed ${absent === 1 ? "it" : "them"}); the index entr${absent === 1 ? "y" : "ies"} above ${absent === 1 ? "was" : "were"} the real blocker.`
        );
      }
      if (failed.length > 0) {
        this.log.add(
          "error",
          "sparse",
          `${failed.length} path(s) could not be moved to the trash: ${failed.join(", ")}`
        );
        problems.push(
          `${failed.length} could not be moved:`,
          ...failed.slice(0, 12),
          failed.length > 12 ? `…and ${failed.length - 12} more` : ""
        );
      }
    }

    if (problems.length > 0) {
      new ResultModal(
        this.app,
        "Partly repaired",
        [...done, ...problems.filter((l) => l !== ""), "The safety check below shows what is left."],
        { isError: true }
      ).open();
    } else if (done.length > 0) {
      this.notify(done.join(" "));
    }
  }

  /**
   * The two recoveries the safety modal offers. Both are explicit, confirmed
   * and reversible in the sense that matters: deleting goes to Obsidian's
   * trash rather than to `rm`, unstaging only removes index entries that HEAD
   * does not contain, and unprotecting only edits sparse config. Git history is
   * never touched here.
   */
  private sparseSafetyFixes(): SparseSafetyFixes {
    return {
      repair: (plan) => {
        const body: string[] = [];
        if (plan.trash.length > 0) {
          body.push(
            `Move to Obsidian's trash (${plan.trash.length}):`,
            ...plan.trash.slice(0, 8),
            plan.trash.length > 8 ? `…and ${plan.trash.length - 8} more` : ""
          );
        }
        if (plan.unstage.length > 0) {
          body.push(
            `Remove from the index only (${plan.unstage.length}) — staged additions with no file on disk:`,
            ...plan.unstage.slice(0, 8),
            plan.unstage.length > 8 ? `…and ${plan.unstage.length - 8} more` : ""
          );
        }
        body.push(
          "Trashed files go to .trash in the vault and can be restored from there. Index entries are removed with 'git rm --cached', which only undoes a staged addition — nothing in the last commit is touched, and no file is deleted by it."
        );
        new ConfirmModal(
          this.app,
          {
            title: "Clear these out of the way?",
            body: body.filter((l) => l !== ""),
            confirmLabel: "Clear them",
            icon: "trash",
            danger: true,
          },
          async (confirmed) => {
            if (!confirmed) return;
            await this.runSparseRepair(plan);
            // Re-run the check rather than just refreshing: the point of the
            // fix is that the blocked state is GONE, and only the runner can
            // say so. The verdict modal reopens with the new answer.
            await this.cmdVerifySparseSafety();
          }
        ).open();
      },
      unprotect: (dirs) => {
        new ConfirmModal(
          this.app,
          {
            title: "Stop protecting these directories?",
            body: [
              dirs.join(", "),
              "Their sparse exclusion is removed, so git checks them out again and their contents become ordinary tracked files that this device will commit and push.",
              "Protection is derived from the sparse rules, so they also disappear from the protected set.",
            ],
            confirmLabel: "Remove exclusion",
            icon: "eye",
            danger: true,
          },
          async (confirmed) => {
            if (!confirmed) return;
            // exclude=false takes the no-extra-confirmation path; this modal
            // already asked, and asking twice per directory is noise.
            for (const d of dirs) await this.cmdSparseExclude(d, false);
            await this.cmdStatus(true);
          }
        ).open();
      },
    };
  }

  // -------------------- repo config management (sparse / gitignore / exclude)

  /** In-memory caches so the file context menu can decide add-vs-remove synchronously. */
  private gitignoreLines: string[] = [];
  private excludeLines: string[] = [];

  /** Hide (exclude=true) or materialize a path via non-cone sparse patterns. */
  async cmdSparseExclude(path: string, exclude: boolean, skipConfirm = false): Promise<void> {
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
    if (exclude && !skipConfirm) {
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

  /**
   * True when Obsidian is currently drawing a dark theme. `theme-dark` on the
   * body is how Obsidian itself marks it; absent means light.
   */
  private isDarkTheme(): boolean {
    try {
      return activeDocument.body.classList.contains("theme-dark");
    } catch {
      return true;
    }
  }

  /** The colour set in force, or null while custom colours are switched off. */
  private activeColorSet(): NgbColorSet | null {
    if (!this.sharedPrefs.customColors) return null;
    return this.isDarkTheme() ? this.sharedPrefs.colorsDark : this.sharedPrefs.colorsLight;
  }

  diffColorVars(): Record<string, string> | null {
    const set = this.activeColorSet();
    return set ? diffColorVars(set) : null;
  }

  conflictColorVars(): Record<string, string> | null {
    const set = this.activeColorSet();
    return set ? conflictColorVars(set) : null;
  }

  /** Re-apply display preferences (and colours) to every open diff/conflict pane. */
  refreshDiffPanes(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW)) {
      const view = leaf.view;
      if (view instanceof DiffView) view.refreshDisplay();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof FileHistoryView) view.rerender();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW)) {
      const view = leaf.view;
      if (view instanceof ConflictView) void view.reload();
    }
  }

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
    // The file-history panel renders diffs with the same renderer, so the same
    // preferences (wrap, invisibles, colours) have to reach it.
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof FileHistoryView) view.rerender();
    }
    this.pushStatusToView();
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof HistoryView) view.rerender();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW)) {
      const view = leaf.view;
      if (view instanceof ConflictView) void view.reload();
    }
  }

  /** Parse the status fields every mutating action returns and refresh UI. */
  private absorbStatusData(d: Record<string, string>): void {
    if (typeof d.remoteUrl === "string") this.lastRemoteUrl = d.remoteUrl;
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
      mergeInProgress: d.mergeInProgress === "true",
      mergeMsg: d.mergeMsg?.trim() ? d.mergeMsg : undefined,
      // Absent on runners older than this one, which is exactly "no rebase":
      // an old runner cannot report a state it does not look for, and treating
      // the missing field as `true` would put a banner on every panel.
      rebaseInProgress: d.rebaseInProgress === "true",
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
      new SparseSafetyModal(this.app, report, SPARSE_SAFETY_WARNING, this.sparseSafetyFixes()).open();
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
    // Committing a resolved merge: prefill git's own prepared message
    // ("Merge branch … # Conflicts: …") so the history reads like any merge.
    const mergeMsg = this.lastStatus?.mergeInProgress ? this.lastStatus.mergeMsg : undefined;
    new CommitMessageModal(
      this.app,
      {
        title: mergeMsg ? "Commit merge" : "Commit changes",
        placeholder: "Commit message…",
        submitLabel: "Commit",
        initial: mergeMsg,
      },
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
    // A sync that completes a manual merge resolution commits with git's own
    // prepared merge message automatically — no modal, as requested.
    const mergeMsg = this.lastStatus?.mergeInProgress ? this.lastStatus.mergeMsg : undefined;
    const result = await this.runOperation("sync", {
      protectedPaths: this.effectiveProtectedPaths(),
      message: message ?? mergeMsg ?? "",
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

  /**
   * The two exits from an unfinished rebase. Nothing in this plugin starts a
   * rebase; one can only be here because it was started in Termux. Before the
   * panel banner existed, that state was invisible and inescapable from inside
   * Obsidian, exactly like the unfinished merge it sits next to.
   */
  async cmdAbortRebase(): Promise<void> {
    new ConfirmModal(
      this.app,
      {
        title: "Abort rebase?",
        body: [
          "This runs 'git rebase --abort' and returns the branch to where it was before the rebase started.",
          "Conflict resolutions you already made during the rebase will be discarded.",
        ],
        confirmLabel: "Abort rebase",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("abort-rebase");
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: abort rebase failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Rebase aborted; branch restored.");
      }
    ).open();
  }

  async cmdContinueRebase(): Promise<void> {
    const result = await this.runOperation("continue-rebase");
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: continue rebase failed", result);
    this.absorbStatusData(result.data ?? {});
    // A rebase replays commits one at a time and can stop again on the next
    // one, so "continued" is the honest word; the refreshed banner says whether
    // anything is still in progress.
    this.notify("Rebase continued.");
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

  /**
   * History / view-at-commit / restore for the active file. All three commands
   * open the same PANEL the context menu and the status panel open: one file
   * history surface, with the diff, the whole-file restore, the per-block
   * restore and the display preferences that every other diff has. The modal
   * this used to open rendered its own, plainer diff and was the last place in
   * the plugin where the same question got a different-looking answer.
   */
  cmdFileHistory(): void {
    const path = this.activeFilePath();
    if (path === null) return;
    void this.openFileHistoryPanel(path);
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

  async cmdDiffCurrentFile(): Promise<void> {
    const path = this.activeFilePath();
    if (path === null) return;
    await this.openDiffPane({ path, from: "HEAD", to: "WORKTREE", label: "HEAD → working tree" });
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
      if (reveal) await this.app.workspace.revealLeaf(existing[0]!);
      this.pushStatusToView();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_STATUS_VIEW, active: reveal });
    if (reveal) await this.app.workspace.revealLeaf(leaf);
    this.pushStatusToView();
  }

  // ------------------------------------------------- repository history & diff panes

  /** Open (or reveal and refresh) the repository-wide history panel. */
  async openHistoryPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]!);
      const view = existing[0]!.view;
      if (view instanceof HistoryView) await view.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_HISTORY_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Open (or retarget) the history panel of ONE file. */
  async openFileHistoryPanel(path: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW);
    const leaf = existing.length > 0 ? existing[0]! : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: NGB_FILE_HISTORY_VIEW, active: true, state: { path } });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async loadFileLogPage(
    path: string,
    skip: number,
    limit: number
  ): Promise<FileLogEntry[] | null> {
    const result = await this.runOperation("file-log", { path, skip, limit });
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: history failed", result);
      return null;
    }
    return parseFileLog(result.data?.log ?? "", path);
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
    await this.app.workspace.revealLeaf(leaf);
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
      await this.app.workspace.revealLeaf(leaf);
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
        // A resolution pane still open for this file is now stale — close it.
        for (const leaf of this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW)) {
          const view = leaf.view;
          if (view instanceof ConflictView && view.filePath === path) leaf.detach();
        }
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
    to: string,
    /**
     * Budget for THIS request, in KB. Omitted means the device-local setting.
     * The pane passes a larger value only after the user accepted the warning
     * for one diff; the setting itself is never touched.
     */
    limitKb?: number
  ): Promise<DiffLoadResult | null> {
    const maxBytes = (limitKb ?? this.deviceSettings.diffLimitKb) * 1024;
    let result = await this.runOperation("diff-file", { path, from, to, maxBytes });
    if (result && !result.ok && from.endsWith("^")) {
      result = await this.runOperation("diff-file", {
        path,
        from: EMPTY_TREE_HASH,
        to,
        maxBytes,
      });
    }
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: diff failed", result);
      return null;
    }
    const d = result.data ?? {};
    const num = (k: string): number => {
      const n = Number(d[k]);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      diff: d.diff ?? "",
      truncated: d.truncated === "true",
      hunksShown: num("hunksShown"),
      hunksTotal: num("hunksTotal"),
      totalBytes: num("diffBytesTotal"),
      limitBytes: num("diffBytesLimit") || maxBytes,
    };
  }

  /**
   * Send one hunk patch to the runner.
   *
   * The patch is built by `hunkPatch.ts` from the diff the pane is showing, and
   * the runner checks independently that it names exactly one path, that the
   * path is valid, and that it is not protected: the patch is what git acts on,
   * so the patch is what has to be verified.
   */
  private async applyHunkPatch(
    patch: string,
    target: "index" | "worktree",
    reverse: boolean
  ): Promise<boolean> {
    const result = await this.runOperation("apply-patch", {
      patch,
      target,
      reverse,
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return false;
    if (!result.ok) {
      this.renderMutationError("Native Git: could not apply the hunk", result);
      return false;
    }
    this.absorbStatusData(result.data ?? {});
    return true;
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
    // An unfinished merge or rebase outranks whatever the status bar last said.
    // The status bar's "conflict" was set from a pull RESULT and then stuck:
    // the panel showed "Conflict" long after the conflicted files were
    // resolved, and showed nothing special once they were, even though the
    // repository was still mid-merge and refusing every pull.
    const inProgress = this.lastStatus?.rebaseInProgress || this.lastStatus?.mergeInProgress;
    const state = inProgress
      ? "conflict"
      : (this.statusBar?.current ?? (this.lock.active ? "syncing" : "clean"));
    const extra = {
      sparse: this.lastStatus?.sparse,
      mergeInProgress: this.lastStatus?.mergeInProgress,
      rebaseInProgress: this.lastStatus?.rebaseInProgress,
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
      `Profile for this vault: ${s.profileId || "none yet"}`,
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
    // The same install without a network, when the vault path is known: the
    // scripts already ship inside this plugin's folder.
    if (this.installCommandLocal() !== null) {
      actions.push({
        label: "Copy offline command",
        keepOpen: true,
        onClick: () => this.copyLocalCommandAndOpenTermux(),
      });
    }
    // A second vault on a device where Termux is already set up needs no
    // command at all: it can ask the existing runner for a profile of its own.
    if (!s.authToken) {
      actions.splice(actions.length - 1, 0, {
        label: "Pair this vault",
        keepOpen: true,
        onClick: () => void this.cmdPairThisVault(),
      });
    } else {
      // Paired, so the remaining question is whether this vault has anything
      // to sync yet: a repository and a remote.
      actions.splice(actions.length - 1, 0, {
        label: "Set up repository",
        keepOpen: true,
        onClick: () => void this.cmdSetupRepository(),
      });
    }
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
   * Version advice for the three independently updated parts. Obsidian can
   * only ever offer the plugin half of it, and the plugin is currently
   * delisted from the community catalogue pending the next release, so a
   * mismatch here can only be reported, never auto-fixed. The runner and the
   * companion live outside Obsidian and would need a manual step even if the
   * catalogue listing were live.
   */
  /**
   * True only when the companion actually reported a version older than this
   * plugin. "It answered at all" is not evidence of being outdated, and the
   * bridge check used to offer an update on that basis alone, which on a
   * matched pair reads like something is wrong when nothing is.
   */
  companionOutdated(): boolean {
    const companion = this.lastCompanionVersion;
    if (companion === "") return false;
    return compareVersions(this.manifest.version, companion) > 0;
  }

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

  /**
   * The same install taken from the copy inside this vault instead of from a
   * release. Only meaningful once the repository path is known, because Termux
   * addresses the vault by its own absolute path.
   */
  installCommandLocal(): string | null {
    const p = this.deviceSettings.repoPathHint.trim().replace(/\/+$/, "");
    if (p === "" || !p.startsWith("/")) return null;
    return bootstrapCommandLocal(p, this.app.vault.configDir);
  }

  /** Copy the offline install command, then bring Termux to the front. */
  copyLocalCommandAndOpenTermux(): void {
    const cmd = this.installCommandLocal();
    if (cmd === null) {
      new Notice("Set the repository path in settings first — Termux needs the vault's absolute path.");
      return;
    }
    void navigator.clipboard.writeText(cmd);
    new Notice("Offline install command copied - long-press in Termux to paste, then Enter.");
    this.openExternalUri(COMPANION_OPEN_TERMUX_URI);
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
    const report = await runSelfCheck(this.makeRuntimeFS(), paths, timedOut, this.deviceSettings.profileId);
    const outdated = /ERROR building result for [^(]*$/m.test(report.runnerLogTail);
    const lines = [report.verdict];
    if (outdated) {
      lines.push("", "The Termux runner is OUTDATED. Fix: the button below copies the install command and opens Termux - paste and run it there.");
    }
    lines.push(
      "",
      `Runtime folder (as the plugin sees it): ${paths.root}`,
      `Profile for this vault: ${report.profileId || "none yet"}${
        report.markerProfileId && report.markerProfileId !== report.profileId
          ? ` (the runner wrote ${report.markerProfileId} here)`
          : ""
      }`,
      `Runner has written into THIS vault's runtime folder: ${report.runnerLogExists ? "yes" : "NO"}`,
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
      } else if (this.companionOutdated()) {
        // The companion answered AND reported an older version: let IT open
        // the download in the real default browser (an in-app Custom Tab
        // download is often discarded). A matching companion gets no button.
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

  /**
   * Group-header buttons. "Stage" in the tracked-changes group must not sweep
   * in untracked files, so it stages the repository root in `update` mode; the
   * untracked group uses a plain add. Discard maps to the repository-wide
   * discard command, which keeps staged content and untracked files.
   */
  groupAction(group: Group, kind: "stage" | "unstage" | "discard"): void {
    if (kind === "unstage") {
      void this.cmdUnstageAll();
      return;
    }
    if (kind === "discard") {
      this.cmdDiscardAll();
      return;
    }
    if (group === "unstaged") void this.cmdStageFile(".", "update");
    else void this.cmdStageAll();
  }

  /**
   * The group's own context menu: the bulk versions of the per-file entries,
   * gated by the same three settings toggles. Every bulk entry states how many
   * paths it will touch before doing anything.
   */
  buildGroupMenu(menu: Menu, group: Group): void {
    if (!Platform.isAndroidApp) return;
    if (!this.deviceSettings.enabledOnThisDevice) return;
    this.addMenuEntries(menu, { kind: "group", group, count: this.groupPaths(group).length });
  }


  /** Paths currently listed in a panel group (as the panel last saw them). */
  private groupPaths(group: Group): string[] {
    const st = this.lastStatus?.status;
    if (!st) return [];
    const raw =
      group === "staged"
        ? st.staged.map((e) => e.path)
        : group === "unstaged"
          ? st.unstaged.map((e) => e.path)
          : group === "conflicted"
            ? st.conflicted.map((e) => e.path)
            : st.untracked;
    return [...new Set(raw.map((p) => (p.endsWith("/") ? p.slice(0, -1) : p)))];
  }

  /** .gitignore is a tracked vault file, so a bulk add is ONE write. */
  private confirmBulkIgnore(paths: string[]): void {
    new ConfirmModal(
      this.app,
      {
        title: `Add ${paths.length} paths to .gitignore?`,
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `…and ${paths.length - 10} more` : "",
          ".gitignore is a tracked file, so this change reaches every device and every collaborator once committed.",
        ].filter((l) => l !== ""),
        confirmLabel: "Add to .gitignore",
        icon: "eye-off",
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) await this.gitignoreAdd(`/${p}`);
        this.notify(`Added ${paths.length} paths to .gitignore.`);
      }
    ).open();
  }

  /**
   * Sparse exclusions and .git/info/exclude are runner actions, so a bulk
   * apply is one round trip per path. The count is stated up front because on
   * a large group this is slow, and every round trip wakes Termux.
   */
  private confirmBulkPerPath(paths: string[], kind: "sparse" | "exclude"): void {
    const label = kind === "sparse" ? "sparse exclusions" : ".git/info/exclude";
    new ConfirmModal(
      this.app,
      {
        title: `Add ${paths.length} paths to ${label}?`,
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `…and ${paths.length - 10} more` : "",
          `This runs one Termux round trip per path (${paths.length} in total) and cannot be cancelled halfway without leaving part of the list applied.`,
          kind === "sparse"
            ? "Hidden paths are removed from THIS device's working tree and automatically join the protected set."
            : "The exclude file is device-local and never synced.",
        ].filter((l) => l !== ""),
        confirmLabel: `Apply to ${paths.length} paths`,
        icon: "eye-off",
        danger: kind === "sparse",
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) {
          if (kind === "sparse") await this.cmdSparseExclude(p, true, true);
          else await this.cmdExcludeChange(p, true);
        }
        this.notify(`Applied to ${paths.length} paths.`);
        await this.cmdStatus(true);
      }
    ).open();
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

  /**
   * Discard every unstaged change at once (the Changes group as a whole).
   * Staged work and untracked files survive: dropping those is `git clean`
   * territory and needs its own explicit action, not a side effect here.
   */
  cmdDiscardAll(): void {
    const st = this.lastStatus?.status;
    const n = st?.unstaged.length ?? 0;
    new ConfirmModal(
      this.app,
      {
        title: "Discard all local changes?",
        body: [
          n > 0
            ? `${n} file${n === 1 ? "" : "s"} with unstaged changes will go back to the staged version (or to HEAD when nothing is staged for them).`
            : "All unstaged changes will go back to the staged version (or to HEAD).",
          "Staged changes and untracked files are kept. Protected sparse paths are excluded.",
          "This cannot be undone: the discarded edits are not in Git history.",
        ],
        confirmLabel: "Discard local changes",
        icon: "undo-2",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("discard-all", {
          protectedPaths: this.effectiveProtectedPaths(),
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: discard failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Discarded all unstaged changes.");
      }
    ).open();
  }

  /**
   * The effect of `git reset --hard`, expressed as a pathspec restore so the
   * protected sparse paths can be excluded. HEAD is not moved and untracked
   * files are not deleted, both of which a literal --hard would do.
   */
  cmdResetAll(): void {
    const st = this.lastStatus?.status;
    const n = (st?.staged.length ?? 0) + (st?.unstaged.length ?? 0);
    new ConfirmModal(
      this.app,
      {
        title: "Reset everything to HEAD?",
        body: [
          n > 0
            ? `${n} staged and unstaged change${n === 1 ? "" : "s"} will be thrown away; the working tree and the index go back to the last commit.`
            : "The working tree and the index go back to the last commit.",
          "Untracked files are kept, and protected sparse paths are excluded. The branch itself is not moved: commits are untouched.",
          "This cannot be undone: nothing being discarded here is in Git history.",
        ],
        confirmLabel: "Reset to HEAD",
        icon: "rotate-ccw",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("reset-all", {
          protectedPaths: this.effectiveProtectedPaths(),
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: reset failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Reset the working tree and index to HEAD.");
      }
    ).open();
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
    report.pluginSide["Profile for this vault"] = s.profileId || "(none yet)";
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
