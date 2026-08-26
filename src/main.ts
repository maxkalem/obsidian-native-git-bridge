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
import { untrackedTargets } from "./git/untrackedTargets";
import {
  hasControlChars,
  validateProtectedPaths,
  validateRepoRelativePath,
} from "./settings/pathValidation";
import { OperationLock, isMarkerStale } from "./ops/OperationLock";
import { OperationLog, redact } from "./ops/OperationLog";
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
import { buildMenuEntries, menuHeader, type MenuAction, type MenuScope } from "./ui/gitMenu";
import {
  looksLikeDubiousOwnership,
  looksLikeObjectCorruption,
  looksLikeStaleLock,
  needsGitIdentity,
  needsTermuxCredentials,
  summarizeGitError,
} from "./git/gitErrors";
import { identitySetupCommand, safeDirectoryCommand } from "./git/termuxCommands";
import { cloneRoute, manualCloneCommand } from "./git/cloneRoute";
import { describeRestore, restoreBlockInFile } from "./git/restoreBlock";
import { ignoreEntryMatches, parseIgnoreEntries, trackedPathsAmong } from "./git/ignoreFile";
import {
  maintenanceReportLines,
  maintenanceVerdict,
  parseCountObjects,
  totalKb,
  type ObjectStats,
} from "./git/objectStats";
import type { DiffHunk } from "./git/hunks";
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
  timeoutSecondsFor,
  LONG_OPERATION_SECONDS,
  COMPANION_SETUP_URI,
  CLAIM_FILE,
  PAIRING_FILE,
  PAIRING_WAIT_MS,
  bootstrapCommand,
  bootstrapCommandLocal,
  RUNNER_MIN_VERSION,
  RUNNER_SHIPPED_VERSION,
  RUNNER_OUTDATED_HINT,
  TERMUX_FDROID_URL,
  TERMUX_SITE_URL,
} from "./constants";
import { TFile } from "obsidian";
import { OperationLogModal } from "./ui/OperationLogModal";
import { buildLogBundle, logBundleName, LOG_NOTE_GLOB } from "./ops/logBundle";
import { lastProgressLine, progressForBundle } from "./ops/progressStream";
import {
  decideRepair,
  decideStaleLock,
  planRepair,
  summarizeFsckMissing,
  type RepairContext,
  type RepairStage,
  type RepairTriageFacts,
} from "./ops/repairJob";
import { checkPathLimits, proposeRename } from "./git/pathLimits";
import {
  NGB_OUTPUT_VIEW,
  RunnerOutputView,
  type RunnerOutputPast,
  type RunnerOutputSnapshot,
} from "./ui/RunnerOutputView";
import {
  conflictColorVars,
  DEFAULT_COLORS,
  diffColorVars,
  sanitizeColorSet,
  type NgbColorSet,
} from "./ui/colors";
import type { InlineDiffUnit } from "./git/inlineDiff";

/** Non-device-specific, shareable UI preferences (safe to sync via data.json). */
interface SharedUiPrefs {
  showStatusBar: boolean;
  showRibbonIcon: boolean;
  /** Wrap long lines in the diff pane instead of scrolling horizontally. */
  wrapDiffLines: boolean;
  /** Wrap long lines in the output panel's console field. Its own toggle, not
   * `wrapDiffLines`: a diff is code read in columns, a console is prose-ish
   * git output, and the user reading one has no reason to re-wrap the other. */
  wrapOutputLines: boolean;
  /** Render whitespace glyphs (· → ␍) in the diff pane. */
  showInvisibles: boolean;
  /**
   * Keep line-picking mode on when a diff pane is pointed at another file.
   *
   * Off by default: the picks are coordinates into the diff that was on
   * screen, so they cannot survive the move, and a mode left on greets the
   * next file with checkboxes nobody asked for.
   */
  keepLineSelection: boolean;
  /**
   * Spell the change out beside a file name in the status panel (`modified`,
   * `conflicted`, `deleted`).
   *
   * On by default, and only ever drawn on mobile, where there is no tooltip to
   * carry it. Cosmetic and about reading rather than about how much work this
   * device does, so it is shared through data.json like the other display
   * toggles.
   */
  showChangeWords: boolean;
  /**
   * Name the file above the Git context menu's entries.
   *
   * On by default: a panel row truncates its name to one line and the file
   * explorer shows no path at all, so without it the menu offers "Discard
   * changes" over a file it never identifies. Off gives the menu back the two
   * or three rows a deep path costs, which on a short screen is the difference
   * between seeing the entries and scrolling for them.
   */
  showMenuHeader: boolean;
  /**
   * Open the output panel by itself once an operation has run for a while.
   *
   * Off by default, and that is the cautious answer rather than the obvious one:
   * a panel that appears on its own takes a slot in the sidebar while the user
   * is reading something else. The state line is tappable either way, so nothing
   * is unreachable without this — it only saves the tap for someone who has
   * decided they always want to watch.
   */
  openOutputForLongOps: boolean;
  /**
   * What a changed line is compared by: whole words, or single characters.
   *
   * Cosmetic and about reading rather than about how much work this device
   * does, so it is shared through data.json like the other display toggles.
   */
  inlineDiffUnit: InlineDiffUnit;
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
  wrapOutputLines: false,
  showInvisibles: false,
  keepLineSelection: false,
  showChangeWords: true,
  showMenuHeader: true,
  openOutputForLongOps: false,
  inlineDiffUnit: "word",
  showConflictMarkers: false,
  treeView: false,
  customColors: false,
  colorsLight: { ...DEFAULT_COLORS.light },
  colorsDark: { ...DEFAULT_COLORS.dark },
};

/**
 * Everything worth keeping about a failed request, for the log entry's detail.
 *
 * It used to be `code: message` and nothing else, so git's own words — the part
 * that says *why* — existed only in the result window, which closes. A log
 * bundle collected an hour later then carried twenty `GIT_FAILED: git pull
 * failed.` lines and no reason for any of them; the runner's own log records
 * outcomes, not output, so it could not fill the gap either.
 *
 * `OperationLog.add` redacts and truncates what it is given, so the size and
 * the credentials are already somebody else's problem. Pure, and exported for
 * the test.
 */
export function failureDetail(result: BridgeResult): string | undefined {
  const err = result.error;
  if (!err) return undefined;
  const parts = [`${err.code}: ${err.message}`];
  // Labelled, because the two streams answer different questions and git puts
  // the reason in either one depending on the command.
  if (err.stdout !== undefined && err.stdout.trim() !== "") parts.push(`stdout:\n${err.stdout.trimEnd()}`);
  if (err.stderr !== undefined && err.stderr.trim() !== "") parts.push(`stderr:\n${err.stderr.trimEnd()}`);
  return parts.join("\n");
}

/**
 * What to say when `abort-merge` comes back failed.
 *
 * Pure, and exported for the test, because the interesting part is the decision
 * rather than the window: only git's own refusal earns the sparse explanation.
 * A SAFETY_BLOCKED or a REPO_MISSING has its own established rendering, and
 * telling someone to reapply sparse rules when the repository is simply gone is
 * worse than saying nothing.
 */
export function abortMergeFailure(result: BridgeResult): { offerReapply: boolean; lines: string[] } {
  const err = result.error;
  if (err?.code !== "GIT_FAILED") return { offerReapply: false, lines: [] };
  return {
    offerReapply: true,
    lines: [
      err.message,
      "The usual cause is a sparse checkout that has drifted from the index: aborting has to put the working tree back, and it cannot restore a file it is not allowed to materialise. Git's own output is below.",
      "Reapplying the sparse rules puts the two back in step, and the abort then normally succeeds on the next try. Nothing is deleted by it and no history is touched.",
    ],
  };
}

const MARKER_KEY = "active-op";
/**
 * Device-local record that a multi-step repair was running: which step, since
 * when. Exists so a restart can OFFER to continue (§4 rule 7 — nothing
 * destructive resumes by itself), and continuing simply reruns the job from
 * the scan: the scan is idempotent, objects already fetched stay fetched, and
 * re-deriving the state is cheaper than trusting a snapshot of it.
 */
const REPAIR_JOB_KEY = "repair-job";
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
  /**
   * Every request currently in flight, oldest first (insertion order).
   *
   * Two read-only requests may overlap on purpose: only a mutation takes the
   * lock, and the runner drains its queue one at a time regardless. The
   * display, though, has one slot for the action, the path, the progress line
   * and the cancel token — so a teardown needs to know what else is running
   * before it empties them.
   */
  private inFlight = new Map<
    string,
    {
      id: string;
      action: string;
      path: string | null;
      cancel: CancelToken;
      startedAt: number;
      /** The budget this request was given, so a wait can be read against it. */
      timeoutSeconds: number;
    }
  >();
  /**
   * How the last finished operation ended, for the output panel.
   *
   * Kept because that panel is usually opened AFTER something went wrong, and a
   * panel that says only "Idle" over the output of a failed sync leaves the
   * reader to guess whether the sync failed or never ran.
   */
  private lastVerdict: string | null = null;
  /** Which request the display slots below currently belong to. */
  private runningId: string | null = null;
  /**
   * The panel is showing a status nobody has read since the repository last
   * moved: an operation failed, timed out or was cancelled without bringing
   * fresh status back. Cleared the moment any status is absorbed.
   */
  private statusStale = false;
  private progressText: string | null = null;
  /** Human-readable step name while the multi-step repair runs, else null. */
  private repairJobStep: string | null = null;
  /**
   * What the runner said it is doing (newest progress-stream line), kept apart
   * from `progressText` so the state line stays short and stable while this
   * one changes with every step. The panels draw it on a reserved second line.
   */
  private progressDetail: string | null = null;
  /**
   * The newest line the runner has streamed for the request in flight, and the
   * id it belongs to. Kept as a field because the ticker that renders it is
   * synchronous and reading a file is not: the read is started from one tick
   * and shown by the next.
   */
  private liveProgress: { id: string; line: string } | null = null;
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
    /** Repository footprint (runner v14): what the settings toggles reflect. */
    shallow?: boolean;
    partialFilter?: string;
    /**
     * Whether TERMUX-SIDE credentials exist that a re-clone could use: the
     * profile's credential file or a global helper in Termux's own gitconfig
     * (runner v15). Credentials are never reused from inside the vault, so a
     * vault-local helper does not count. Undefined on older runners —
     * unknown, not "no".
     */
    credsConfigured?: boolean;
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
          // The panel's refresh button is a user asking; a vault with no
          // repository answers with the setup window (create / clone) rather
          // than a bare REPO_MISSING error.
          refresh: () => void this.cmdStatus(true, true),
          sync: () => void this.cmdSync(),
          pull: () => void this.cmdPull(),
          push: () => void this.cmdPush(),
          fetch: () => void this.cmdFetch(),
          commit: () => void this.cmdCommit(),
          stageAll: () => void this.cmdStageAll(),
          unstageAll: () => void this.cmdUnstageAll(),
          openLog: () => this.openOperationLog(),
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
          discard: (p, group) => this.discardPath(p, group),
          syncState: () => this.pushStatusToView(),
          openOutput: () => void this.openOutputPanel(),
          showChangeWords: () => this.sharedPrefs.showChangeWords,
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
          progressDetail: () => this.progressDetail ?? "",
          openOutput: () => void this.openOutputPanel(),
          treeView: () => this.sharedPrefs.treeView,
          toggleTree: () => void this.setSharedPref({ treeView: !this.sharedPrefs.treeView }),
          openStatusPanel: () => void this.openStatusPanel(),
          rowsPerGroup: () => this.deviceSettings.rowsPerGroup,
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
          inlineUnit: () => this.sharedPrefs.inlineDiffUnit,
          keepLineSelection: () => this.sharedPrefs.keepLineSelection,
          colors: () => this.diffColorVars(),
          progressText: () => this.progressText ?? "",
          restoreBlock: (path, hunk, commitish) => this.restoreBlockFromCommit(path, hunk, commitish),
          openFileAt: (path, commitish) => {
            if (commitish === "WORKTREE") this.openVaultFile(path);
            else void this.showFileAtCommit(path, commitish);
          },
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
          viewAtCommit: (e) => void this.showFileAtCommit(e.pathAtCommit, e.hash, e.date),
          progressText: () => this.progressText ?? "",
          progressDetail: () => this.progressDetail ?? "",
          wrapLines: () => this.sharedPrefs.wrapDiffLines,
          showInvisibles: () => this.sharedPrefs.showInvisibles,
          inlineUnit: () => this.sharedPrefs.inlineDiffUnit,
          colors: () => this.diffColorVars(),
        })
    );

    this.registerView(
      NGB_OUTPUT_VIEW,
      (leaf: WorkspaceLeaf) =>
        new RunnerOutputView(leaf, {
          snapshot: (want) => this.outputSnapshot(want),
          cancel: () => void this.cmdCancel(),
          openStatusPanel: () => void this.openStatusPanel(),
          openHistoryPanel: () => void this.openHistoryPanel(),
          wrapLines: () => this.sharedPrefs.wrapOutputLines,
          toggleWrapLines: () =>
            this.setSharedPref({ wrapOutputLines: !this.sharedPrefs.wrapOutputLines }),
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
          wrapLines: () => this.sharedPrefs.wrapDiffLines,
          inlineUnit: () => this.sharedPrefs.inlineDiffUnit,
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
      // The entry is only honest when the runner can serve it; 0 (never heard
      // from a runner) also stays silent rather than offering a refusal.
      untrack: this.lastRunnerVersion >= 14,
    });
    // What the menu is about, above what it can do. A panel row truncates its
    // name to fit one line and the file explorer shows no path at all, so this
    // was the only surface offering "Discard changes" without naming the file.
    const head = this.sharedPrefs.showMenuHeader ? menuHeader(scope) : null;
    if (head !== null) {
      menu.addItem((i) => {
        const frag = createFragment((f) => {
          const box = f.createDiv({ cls: "ngb-menu-head" });
          if (head.dir !== "") box.createDiv({ cls: "ngb-menu-head-dir", text: head.dir });
          box.createDiv({ cls: "ngb-menu-head-name", text: head.name });
        });
        i.setTitle(frag).setIsLabel(true);
      });
      menu.addSeparator();
    }
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
      case "untrack":
        this.offerUntrack(path);
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
    this.offerInterruptedRepair();
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
    const onOpen = this.deviceSettings.onOpenAction;
    if (this.deviceSettings.enabledOnThisDevice && onOpen !== "nothing") {
      if (this.autoActionAllowed()) {
        this.log.add("info", "auto", `Auto ${onOpen} on open.`);
        if (onOpen === "sync") void this.cmdSync(undefined, true);
        else void this.cmdPull(true);
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
    // NEVER offer to delete the set-aside repository while this one cannot
    // stand on its own. A filtered re-clone whose materialize failed (no
    // credentials for the promisor fetches) lists its unmaterialized files as
    // deletions — and on the real phone the reminder offered to delete the one
    // full local copy while exactly that state stood, and the user took the
    // offer (2026-08-11 bundle; the user's decision for 0.6.6: suppress the
    // offer, keep the swap). An ordinary deletion also matches this test; the
    // cost is a reminder delayed for a day, in a state where deleting the
    // backup would be reckless anyway.
    if (
      this.footprintState()?.partial === true &&
      (this.lastStatus?.status.unstaged.some((e) => e.worktree === "D") ?? false)
    ) {
      return;
    }
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
        this.askCloneKind(verdict.url, replaceExisting);
      }
    ).open();
  }

  /**
   * Full or lightweight, decided while it is still cheap: a lightweight clone
   * downloads a fraction up front, where converting later means enabling the
   * filter and shedding what a full clone already brought. The ✕ cancels; two
   * labelled buttons because these are two answers to one question, not an
   * action and its decline.
   */
  private askCloneKind(url: string, replaceExisting: boolean): void {
    new ResultModal(
      this.app,
      "How much should this device hold?",
      [
        "Full clone: the whole history and all file content. Everything works offline.",
        "Lightweight (partial clone, blob:none): file content is fetched when something needs it, and content that a sparse checkout hides is never downloaded at all. Old file versions and 'Show again' need the network. Best for devices with little space.",
      ],
      {
        actions: [
          { label: "Full clone", cta: true, onClick: () => void this.runClone(url, replaceExisting) },
          {
            label: "Lightweight (partial clone)",
            onClick: () => void this.runClone(url, replaceExisting, "blob:none"),
          },
        ],
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
      "Remote saved; histories are unrelated",
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

  private async runClone(url: string, replaceExisting = false, filter?: string): Promise<void> {
    const args: Record<string, unknown> = { url };
    if (replaceExisting) args.replaceExisting = true;
    if (filter !== undefined) args.filter = filter;
    // Credentials only ever exist in Termux, so a clone that is KNOWN to have
    // nothing saved (a fresh https clone; a re-clone whose status reports no
    // helper) is handed to the terminal up front instead of failing the round
    // trip first. Everything else goes through the companion as before, and
    // the failure handler below still offers the terminal when git turns out
    // to have wanted credentials after all.
    const route = cloneRoute({
      url,
      replaceExisting,
      credsConfigured: this.lastStatus?.credsConfigured ?? null,
    });
    if (route === "termux") return this.runCloneViaTermux(args);
    const result = await this.runOperation("clone-into-vault", args);
    if (!result) return;
    if (!result.ok) {
      if (needsTermuxCredentials(result.error?.stderr, result.error?.stdout)) {
        return this.offerCloneViaTermux(args, result);
      }
      return this.renderMutationError("Native Git: clone failed", result);
    }
    this.reportCloneOutcome(result);
  }

  /**
   * The manual route: the DOWNLOAD half is a plain `git clone` command the
   * user pastes into Termux — git's own prompts and git's own progress meter,
   * because the first design (an interactive runner run) hid both behind the
   * progress redirection and read as a hang the moment the credential prompt
   * was answered. What the user types is saved per repository by the
   * clone-time credential helper, in Termux. The FINISH half stays the
   * runner's collision-safe clone-into-vault: pressing Continue queues it,
   * and a v15 runner adopts the repository already downloaded in
   * `runtime/clone-tmp/` instead of downloading again. Nothing is queued
   * until Continue, so nothing can expire or be claimed while the user is
   * still typing a token.
   */
  private runCloneViaTermux(args: Record<string, unknown>): void {
    if (this.lastRunnerVersion > 0 && this.lastRunnerVersion < 15) {
      new ResultModal(
        this.app,
        "Termux runner is too old for this",
        [
          `Finishing a clone downloaded in Termux needs runner v15; this device answers with v${this.lastRunnerVersion}.`,
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
      return;
    }
    const cmd = manualCloneCommand({
      url: String(args.url),
      vaultPath: this.deviceSettings.repoPathHint,
      configDir: this.app.vault.configDir,
      profileId: this.deviceSettings.profileId,
      filter: typeof args.filter === "string" ? args.filter : undefined,
      depth: typeof args.depth === "number" ? args.depth : undefined,
    });
    if (cmd === null) {
      new Notice(
        "Set the repository path in settings first — the clone command addresses the vault by its absolute path in Termux."
      );
      return;
    }
    void navigator.clipboard.writeText(cmd);
    new Notice("Clone command copied - long-press in Termux to paste, then Enter.");
    new ResultModal(
      this.app,
      "Clone in Termux, then continue here",
      [
        // Two short lines; the command itself sits collapsed below. A device
        // screenshot showed the earlier five-line version plus the inline
        // command filling the whole screen.
        "1. The command is copied. In Termux: paste, Enter, answer git's username/token prompts (saved and reused). Keep Termux visible until the download finishes.",
        "2. Come back and press Continue — the repository is moved into the vault, nothing is downloaded twice, your notes are kept.",
      ],
      {
        collapsed: { label: "The copied command", text: cmd },
        actions: [
          {
            label: "Copy command & open Termux",
            keepOpen: true,
            onClick: () => {
              void navigator.clipboard.writeText(cmd);
              this.openTermux();
            },
          },
          {
            label: "Continue — finish the clone",
            cta: true,
            onClick: () => void this.finishManualClone(args),
          },
        ],
      }
    ).open();
  }

  /**
   * The finish half: an ordinary clone-into-vault round trip. A v15 runner
   * finds the pre-downloaded repository and completes locally; a Continue
   * pressed too early (download still running, or never started) comes back
   * as an ordinary failure whose message says what to do.
   */
  private async finishManualClone(args: Record<string, unknown>): Promise<void> {
    const result = await this.runOperation("clone-into-vault", args);
    if (!result) return;
    if (!result.ok) {
      if (needsTermuxCredentials(result.error?.stderr, result.error?.stdout)) {
        return this.offerCloneViaTermux(args, result);
      }
      return this.renderMutationError("Native Git: clone failed", result);
    }
    this.reportCloneOutcome(result);
  }

  /**
   * A companion-route clone failed because git wanted credentials it had no
   * way to ask for. The answer is the interactive route, offered rather than
   * taken: re-running the clone is a decision, not a retry.
   */
  private offerCloneViaTermux(args: Record<string, unknown>, result: BridgeResult): void {
    new ResultModal(
      this.app,
      "The clone needs credentials",
      [
        "The remote asked for credentials and none are saved for this repository. Credentials live only in Termux, and git can only ask for them at a terminal.",
        "Download the repository in Termux instead: the button opens the instructions — a plain git clone command to paste, with git's own prompts and progress — and the clone is finished here afterwards without a second download.",
        ...summarizeGitError(result.error?.stderr, result.error?.stdout, 3),
      ],
      {
        isError: true,
        actions: [
          {
            label: "Clone via Termux",
            cta: true,
            onClick: () => void this.runCloneViaTermux(args),
          },
        ],
      }
    ).open();
  }

  /** Render a finished clone's result window (shared by both routes). */
  private reportCloneOutcome(result: BridgeResult): void {
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
      const r = outcome.result;
      this.log.add(
        "info",
        marker.action,
        `Recovered result for operation ${marker.id} finished while Obsidian was closed (ok=${r.ok}).`
      );
      await this.client.consume(marker.id);
      // A recovered result used to be logged and dropped, which is the worst
      // possible handling of the one case it exists for: a pull that finished
      // in Termux after Obsidian was gone can have left the repository in a
      // merge with conflict markers in the files. The user got one info line in
      // a log they had no reason to open, no error, and a panel with no status
      // at all — so the next thing they saw was a repository that looked clean.
      //
      // Treated exactly like a live result now: the fresh status the runner
      // attaches to failures is absorbed, and a failure is reported through the
      // same path, which is what puts the conflict window back on screen.
      this.absorbStatusData(r.data ?? {});
      if (!r.ok) {
        this.renderMutationError(`Native Git: ${marker.action} finished while Obsidian was closed`, r);
      }
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

  /**
   * A repair the last session never finished. Offered, not resumed: nothing
   * that touches the object store restarts by itself (§4 rule 7). Continuing
   * reruns the job from the scan — the scan is idempotent, and whatever an
   * earlier step already fetched stays fetched.
   */
  private offerInterruptedRepair(): void {
    const raw = this.store.getValue(REPAIR_JOB_KEY);
    if (!raw) return;
    this.store.removeValue(REPAIR_JOB_KEY);
    let step = "";
    try {
      step = String((JSON.parse(raw) as { step?: unknown }).step ?? "");
    } catch {
      /* an unreadable record still deserves the offer */
    }
    new ResultModal(
      this.app,
      "A repair was interrupted",
      [
        step !== ""
          ? `Obsidian closed while a repository repair was running (${step}).`
          : "Obsidian closed while a repository repair was running.",
        "Nothing was lost: the repair runs as short steps and picks its work back up from a fresh scan.",
      ],
      {
        actions: [
          {
            label: "Continue the repair",
            cta: true,
            onClick: () => void this.cmdRepairObjects(true),
          },
        ],
      }
    ).open();
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
      { id: "status", name: "Status", cb: () => void this.cmdStatus(false, true) },
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
      { id: "open-operation-log", name: "Open operation log", cb: () => this.openOperationLog() },
      { id: "open-status-panel", name: "Open status panel", cb: () => void this.openStatusPanel() },
      { id: "open-history-panel", name: "Open history panel", cb: () => void this.openHistoryPanel() },
      { id: "open-output-panel", name: "Show what Termux is doing (output panel)", cb: () => void this.openOutputPanel() },
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
      { id: "maintenance-cleanup", name: "Clean up repository storage (.git/objects)", cb: () => void this.cmdMaintenance() },
      { id: "drop-rescue-backup", name: "Delete repair backup branch (ngb-rescue)", cb: () => this.cmdRescueCleanup() },
      { id: "check-git-identity", name: "Check git identity (scopes only, no values)", cb: () => void this.cmdCheckIdentity() },
      // The unified repair (0.6.6): one command walks every known problem in
      // sequence. The routes that start from an error window stay where they
      // are — a window that caught a specific failure is the shortest path to
      // its fix — but this is the one place to start from nothing.
      { id: "repair-repository", name: "Repair the repository (walk every problem)", cb: () => void this.cmdRepairObjects() },
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
    args: Record<string, unknown> = {},
    /**
     * True only for a step the repair job itself sends. Everything else is
     * refused while the job runs: the queue is created by one user action and
     * blocks all other requests until it finishes — the lock's own semantics,
     * held across the gaps between steps.
     */
    fromRepairJob = false
  ): Promise<BridgeResult | null> {
    const s = this.deviceSettings;
    if (this.repairJobStep !== null && !fromRepairJob) {
      new Notice(`A repair is running (${this.repairJobStep}). Wait for it to finish.`);
      return null;
    }
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
      timeoutSecondsFor(action, s.opTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS),
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
    this.statusBar?.set("syncing");
    this.log.add("info", action, `Queued request ${req.id}.`);
    // Progress is rendered at the BOTTOM of the status panel (a top notice would
    // cover the editor on mobile). The panel is opened if it is not visible yet.
    void this.openStatusPanel(false);
    const startedAt = Date.now();
    // Per-path actions carry their target so the status panel can animate the
    // acted row only, instead of every control sharing the action name.
    const path = typeof args["path"] === "string" ? args["path"] : null;
    // Every request in flight is remembered, not just the latest: the display
    // slots below are single, and a teardown has to know whether anything else
    // is still running before it empties them.
    this.inFlight.set(req.id, {
      id: req.id,
      action,
      path,
      cancel,
      startedAt,
      timeoutSeconds: req.timeoutSeconds,
    });
    this.runningId = req.id;
    this.activeCancel = cancel;
    this.runningAction = action;
    this.runningPath = path;
    this.progressText = `${action}… 0s`;
    this.progressDetail = null;
    this.liveProgress = null;
    // ONE push, not two. There used to be another immediately after
    // `statusBar.set("syncing")`, four lines up, which re-rendered the whole
    // panel for a state the push below re-renders anyway. On a device with a
    // large untracked folder open that doubled the freeze before the spinner
    // appeared: the user measured two seconds expanded against none collapsed,
    // and expanding the same folder took under one.
    this.pushStatusToView();
    const ticker = window.setInterval(() => {
      // Only while this request owns the display. Two overlapping reads used to
      // give the panel two tickers writing different actions into one line.
      if (this.runningId !== req.id) return;
      const secs = Math.round((Date.now() - startedAt) / 1000);
      // What the runner is doing, when it has said. Everything the plugin knew
      // before was how long it had been waiting, which for a fetch of a large
      // vault is the one fact the user already had.
      const live = this.liveProgress?.id === req.id ? this.liveProgress.line : "";
      // Two slots, not one composed string: the state stays `action… Ns` on
      // every surface, and what the runner said goes to the reserved detail
      // line so the state line cannot grow sideways mid-operation.
      this.progressText = `${action}… ${secs}s`;
      this.progressDetail = live !== "" ? live : null;
      // Long enough that the user is now wondering rather than waiting. Once
      // per request, and only when asked for: an unrequested panel takes a
      // sidebar slot away from whatever is being read.
      if (secs === LONG_OPERATION_SECONDS && this.sharedPrefs.openOutputForLongOps) {
        void this.openOutputPanel();
      }
      // Text-only update: a full re-render would restart the toolbar animations.
      this.updateProgressInView(this.progressText, this.progressDetail);
      // Started here, shown by the next tick. Deliberately not awaited: the
      // ticker must keep its second, and a slow read on shared storage must
      // never be able to hold it up.
      void this.refreshLiveProgress(req.id);
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
        // Nothing came back, and a mutation may well have happened anyway — the
        // runner finishes what it started. The panel must stop presenting the
        // state it had before.
        if (mutating) this.statusStale = true;
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
          // Do NOT call this a Termux fault. The companion took the trigger and
          // the runner is one-shot: it finishes what it started whether or not
          // anybody is still waiting, and a result that lands later is picked up
          // on the next launch. What is actually known is that the budget ran
          // out, and on a slow device with a short budget that is the whole
          // story — the earlier wording sent the user hunting a break that was
          // not there.
          this.log.add(
            "warn",
            action,
            `Companion acknowledged the trigger and the runner did not answer within ${req.timeoutSeconds}s. It may still be working; a result that lands later is picked up.`
          );
        } else if (!this.companionSetupAutoOpened) {
          this.companionSetupAutoOpened = true;
          void this.openCompanionSetup(); // fire-and-forget: the probe must not delay the caller
        }
        this.lastVerdict = `${action} timed out after ${req.timeoutSeconds}s (it may still be running in Termux)`;
        return null;
      }
      if (waited.kind === "cancelled") {
        await this.client.requestCancel(req.id);
        if (mutating) this.statusStale = true;
        this.lastVerdict = `${action} cancelled`;
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
        failureDetail(result)
      );
      this.lastVerdict = result.ok
        ? `${action} finished`
        : `${action} failed: ${result.error?.message ?? `exit ${result.exitCode}`}`;
      // The one failure whose answer is a window, not a message: the runner
      // says there is no repository here, and the vault agrees (no .git).
      // Every operation lands in this seam — pull, push, sync, commit, a
      // diff, a history page — so the catch lives here once, opens the
      // repository setup window (Create / Clone), and hands the caller null:
      // already handled, nothing further to render. `status` is the
      // exception, because it is also sent automatically in the background;
      // its user-initiated paths make the same offer through the flag in
      // cmdStatus, and a background refresh must never pop a window. A vault
      // that HAS a .git the runner cannot use keeps its ordinary error
      // window — offering to create a repository over one that exists would
      // be worse than the honest failure.
      if (
        !result.ok &&
        result.error?.code === "REPO_MISSING" &&
        action !== "status" &&
        !(await this.vaultHasRepository())
      ) {
        this.log.add("info", action, "No repository in this vault; opening the repository setup window.");
        await this.cmdSetupRepository();
        return null;
      }
      return result;
    } catch (e) {
      this.log.add("error", action, `Bridge error: ${String(e)}`);
      new ResultModal(this.app, `Native Git: ${action} failed`, [String(e)], { isError: true }).open();
      return null;
    } finally {
      window.clearInterval(ticker);
      this.inFlight.delete(req.id);
      if (mutating) this.lock.release(req.id);
      // The display slots are single, and two READ-ONLY requests are allowed to
      // overlap by design: only a mutation takes the lock, and the runner
      // drains its queue one request at a time anyway. What was not allowed for
      // was the teardown — it cleared the slots unconditionally, so the first
      // answer to arrive wiped the progress line AND the cancel token of a
      // request that was still running, leaving the panel idle over live work
      // and the Cancel button pointing at nothing.
      //
      // Same ownership rule the three wait tickers were given in 0.6.3, one
      // level up: clear only what is still yours, and hand the slots to
      // whatever is still in flight rather than to nobody.
      if (this.runningId === req.id) this.adoptNewestInFlight();
      // The history panels' copy of the state line is written only by the
      // per-second tick, and the ticker is already cleared by now, so without
      // a final push their line froze at the last rendered second after the
      // request finished ("diff-file… 4s", forever). `pushStatusToView` below
      // reaches the status panel only; this call is what reaches the rest.
      this.updateProgressInView(this.progressText, this.progressDetail);
      this.refreshStatusBarIdle();
      this.pushStatusToView();
    }
  }

  /**
   * Point the single display slots at the newest request still running, or
   * empty them when nothing is.
   *
   * "Newest" because that is the one the user just asked for and is watching;
   * an older request that is still going keeps running either way.
   */
  private adoptNewestInFlight(): void {
    const next = [...this.inFlight.values()].pop();
    if (next === undefined) {
      this.progressText = null;
      this.progressDetail = null;
      this.liveProgress = null;
      this.runningAction = null;
      this.runningPath = null;
      this.activeCancel = null;
      this.runningId = null;
      return;
    }
    // The line belongs to a request, not to the panel: adopting another one must
    // not leave the previous operation's step under the new one's name.
    if (this.liveProgress?.id !== next.id) this.liveProgress = null;
    this.runningId = next.id;
    this.runningAction = next.action;
    this.runningPath = next.path;
    this.activeCancel = next.cancel;
    this.progressText = `${next.action}… ${Math.round((Date.now() - next.startedAt) / 1000)}s`;
    this.progressDetail = this.liveProgress?.id === next.id ? this.liveProgress.line : null;
  }

  /**
   * Take the newest line out of the runner's progress stream for one request.
   *
   * Silent about everything: no such file (an older runner, or a request that
   * never started), an unreadable one, a stream with nothing in it yet. This
   * decorates a status line — an operation that works without it must not be
   * made to look broken because a decoration failed.
   */
  private async refreshLiveProgress(id: string): Promise<void> {
    try {
      const raw = await this.client.readProgress(id);
      if (raw === null) return;
      const line = lastProgressLine(raw);
      // Only if it is still the request being watched: the read is async, and by
      // now the panel may have moved on to another one.
      if (line !== null && this.runningId === id) this.liveProgress = { id, line };
    } catch {
      /* decoration only */
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

  /**
   * Bring Termux to the foreground — the ONE place every "open Termux"
   * goes through. When the companion has reported Termux missing, opening
   * it is impossible, so route to getting it instead: the companion opens
   * Termux's page inside F-Droid (one Install tap) and falls back to the
   * official site when F-Droid is not installed either; without a companion
   * ack the site is the only reliable target. When the report is "installed"
   * or nothing has answered yet, send open-termux — a current companion
   * applies the same F-Droid-then-site fallback on its side.
   */
  openTermux(): void {
    if (this.lastAckTermuxInstalled === false) {
      this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL);
      return;
    }
    this.openExternalUri(COMPANION_OPEN_TERMUX_URI);
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

  async cmdStatus(silent = false, offerSetupWhenMissing = false): Promise<void> {
    const result = await this.runOperation("status");
    if (!result) return;
    if (!result.ok) {
      // A refresh pressed in a vault that simply has no repository yet is not
      // a fault to report, it is a question to answer: the runner says
      // REPO_MISSING, the vault agrees (no .git), and the actionable window is
      // the repository setup with its Create / Clone buttons. Only for a
      // USER-initiated status (the panel's refresh button, the palette
      // command): an automatic background refresh must never pop a modal.
      // A vault that HAS a .git the runner cannot use keeps the error window —
      // offering to create a repository over one that exists would be worse.
      if (
        offerSetupWhenMissing &&
        result.error?.code === "REPO_MISSING" &&
        !(await this.vaultHasRepository())
      ) {
        await this.cmdSetupRepository();
        return;
      }
      this.renderStatusFailure(result);
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

    // Conflicted protected paths go through the same action, in the same
    // request when both kinds are present: the runner picks the call that fits
    // each entry. This is the exit from the loop the user was in — sync
    // blocked, repair unable to touch the one path blocking it, sync blocked.
    const allPaths = [...plan.unstage, ...plan.resolveToHead];
    if (allPaths.length > 0) {
      // protectedPaths is NOT optional here: the runner checks each path
      // against it and refuses the request outright when the list is empty,
      // because "which paths are protected" is the whole permission model for
      // this action. Omitting it made the repair fail every single time.
      const result = await this.runOperation("unstage-protected", {
        paths: allPaths,
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
      const r = Number(result.data?.resolvedProtectedCount ?? 0);
      if (r > 0) {
        done.push(
          `${r} conflicted path${r === 1 ? "" : "s"} restored to the committed version, so the merge can be finished.`
        );
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
        if (plan.resolveToHead.length > 0) {
          body.push(
            `Restore to the committed version (${plan.resolveToHead.length}) — conflicted inside a protected folder:`,
            ...plan.resolveToHead.slice(0, 8),
            plan.resolveToHead.length > 8 ? `…and ${plan.resolveToHead.length - 8} more` : "",
            "These are files this device is not allowed to edit, so the committed version is the one to keep. Restoring it clears the conflict and lets the merge be finished; nothing on disk is touched."
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

  /**
   * Add/remove a line in .git/info/exclude (device-local ignore, via the runner).
   *
   * `standalone = false` is for the bulk route only: it suppresses the
   * per-path tracked warning and the per-path status refresh, both of which
   * the bulk confirmation does ONCE after its loop.
   */
  async cmdExcludeChange(path: string, add: boolean, standalone = true): Promise<void> {
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
    if (standalone && add) this.warnIfRuleTargetsTracked([path]);
    if (standalone) await this.refreshAfterRuleChange(result.data);
  }

  /**
   * Bring the panel in step after an ignore-rule change (.gitignore, sparse,
   * .git/info/exclude). A result that carried fresh status fields is absorbed
   * for free — since runner v16 that includes exclude-add/remove; one that
   * did not (an older runner's exclude change, and .gitignore, which the
   * plugin writes itself) costs one status round trip. That cost is
   * deliberate: every route that changes a rule must leave the panel
   * agreeing with git, or the rule looks like it did nothing.
   */
  private async refreshAfterRuleChange(data?: Record<string, string>): Promise<void> {
    if (data?.branchInfo) {
      this.absorbStatusData(data);
      return;
    }
    await this.cmdStatus(true);
  }

  /**
   * Say when an ignore rule cannot do what it looks like it does. Rules in
   * .gitignore and .git/info/exclude affect UNTRACKED files only; on a tracked
   * path the file keeps appearing in the panel and in every commit until it is
   * untracked, and without this notice the refresh after the rule reads as a
   * refresh that failed. Untracking from the plugin needs a runner action and
   * is scheduled with the next runner version, so the notice states the fact
   * and promises nothing.
   */
  private warnIfRuleTargetsTracked(paths: string[]): void {
    const st = this.lastStatus?.status;
    if (!st) return;
    const tracked = trackedPathsAmong(st, paths);
    if (tracked.length === 0) return;
    const subject =
      tracked.length === 1
        ? `'${tracked[0]}' is tracked by git`
        : `${tracked.length} of these paths are tracked by git`;
    const explanation = `${subject}: ignore rules only affect untracked files, so the changes will keep appearing until the file is untracked.`;
    // With a v14 runner the plugin can fix what it just explained; a single
    // tracked file gets the offer, and an older runner gets the bare fact.
    if (tracked.length === 1 && this.lastRunnerVersion >= 14) {
      this.offerUntrack(tracked[0]!, explanation);
      return;
    }
    new Notice(explanation);
  }

  /** The untrack confirmation, shared by the notice-upgrade and the menu entry. */
  private offerUntrack(path: string, lead?: string): void {
    new ConfirmModal(
      this.app,
      {
        title: "Stop tracking this file?",
        body: [
          ...(lead === undefined ? [] : [lead]),
          `'${path}' stays on disk; a deletion enters the index for you to commit.`,
          "Once that commit reaches your other devices, their pull deletes their copy — or reports a conflict if it has local changes. The panel shows and resolves both.",
          "Without an ignore rule for the path, the next sync or commit stages the file right back.",
        ],
        confirmLabel: "Stop tracking",
        icon: "eye-off",
        danger: true,
      },
      async (ok) => {
        if (ok) await this.cmdUntrackFile(path);
      }
    ).open();
  }

  /** Stop tracking one file, keeping it on disk (`git rm --cached` semantics, runner v14). */
  async cmdUntrackFile(path: string): Promise<void> {
    const result = await this.runOperation("untrack-file", {
      path,
      protectedPaths: this.effectiveProtectedPaths(),
    });
    if (!result) return;
    if (!result.ok) {
      this.renderMutationError("Native Git: could not stop tracking the file", result);
      return;
    }
    this.absorbStatusData(result.data ?? {});
    new Notice(`No longer tracked (still on disk): ${path}. Commit the staged deletion to finish.`);
    // The ignore-rule half. Without one the next `git add -A` re-stages the
    // file, and the user just asked for the opposite; said, not done for them.
    if (!this.isGitignored(path) && !this.isExcluded(path)) {
      new Notice(`No ignore rule covers ${path} yet: the next sync or commit will track it again unless one is added.`);
    }
  }

  /**
   * Clean up `.git/objects`: scan, confirm with the real numbers, prune, then
   * repack. The object database only ever grows on its own — every repair
   * refetch ADDS a full pack and an interrupted download leaves a
   * multi-gigabyte temporary file — and this is the designed exit (a real
   * device reached 20 GB over a ~4 GB history). The decisions live here; the
   * runner steps are dumb primitives, the same split the repair uses.
   */
  async cmdMaintenance(): Promise<void> {
    const scan = await this.runOperation("maintenance-scan", {});
    if (!scan) return;
    if (!scan.ok) {
      new ResultModal(this.app, "Native Git: storage scan failed", [scan.error?.message ?? "Unknown error."], {
        stdout: scan.error?.stdout,
        stderr: scan.error?.stderr,
        isError: true,
      }).open();
      return;
    }
    this.absorbStatusData(scan.data ?? {});
    const before = parseCountObjects(scan.data?.countObjects ?? "");
    const rescue = (scan.data?.rescueBranches ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    new ConfirmModal(
      this.app,
      {
        title: `Free up ${formatSize(totalKb(before))}?`,
        body: maintenanceReportLines(before, rescue),
        confirmLabel: "Clean up now",
        icon: "eraser",
      },
      async (ok) => {
        if (ok) await this.runMaintenanceSteps(before);
      }
    ).open();
  }

  private async runMaintenanceSteps(before: ObjectStats): Promise<void> {
    const prune = await this.runOperation("maintenance-prune", { expire: "2.weeks.ago" });
    if (!prune) return;
    if (!prune.ok) {
      this.renderMutationError("Native Git: storage cleanup failed", prune);
      return;
    }
    this.absorbStatusData(prune.data ?? {});
    const repack = await this.runOperation("maintenance-repack", {});
    if (!repack) return;
    if (!repack.ok) {
      this.renderMutationError("Native Git: repack failed", repack);
      return;
    }
    this.absorbStatusData(repack.data ?? {});
    const after = parseCountObjects(repack.data?.countObjects ?? "");
    const verdict = maintenanceVerdict(before, after);
    // Into the operation log as well as the modal: every bundle this feature
    // was debugged from carried four ok=true lines and no sizes, and the
    // numbers are the whole point of the operation.
    this.log.add(
      "info",
      "maintenance",
      `${verdict} (repack filter: ${repack.data?.repackFilter ?? "unknown"})`
    );
    new ResultModal(this.app, "Repository storage cleaned", [verdict]).open();
  }

  // ------------------------------------------------ repository footprint (v14)

  /** What the settings toggles reflect; null until a status has been heard. */
  footprintState(): { shallow: boolean; partial: boolean } | null {
    if (!this.lastStatus) return null;
    return {
      shallow: this.lastStatus.shallow === true,
      partial: this.lastStatus.partialFilter !== undefined,
    };
  }

  /** Runner v14 is what serves every footprint action. */
  footprintAvailable(): boolean {
    return this.lastRunnerVersion >= 14;
  }

  /**
   * The footprint state, read on demand. The settings toggles used to be dead
   * until some OTHER action happened to fetch a status — on a fresh launch
   * that read as buttons that do not press. Now the toggle itself asks: one
   * silent status round trip when nothing has been heard yet this session,
   * and the command proceeds from what the repository actually is. Null means
   * handled — a repo-less vault got the setup window (the same offer every
   * operation makes), a failure got its error window — and the caller stops.
   */
  private async ensureFootprintState(): Promise<{ shallow: boolean; partial: boolean } | null> {
    const known = this.footprintState();
    if (known !== null) return known;
    const result = await this.runOperation("status");
    if (!result) return null;
    if (!result.ok) {
      if (result.error?.code === "REPO_MISSING" && !(await this.vaultHasRepository())) {
        await this.cmdSetupRepository();
        return null;
      }
      this.renderStatusFailure(result);
      return null;
    }
    this.absorbStatusData(result.data ?? {});
    return this.footprintState();
  }

  /**
   * All four footprint changes share one shape: confirm with the consequences
   * stated, run the action, and let the ABSORBED status decide what the toggle
   * shows — a change the runner refused changes nothing on screen.
   */
  private footprintChange(
    title: string,
    body: string[],
    confirmLabel: string,
    /** SHORT failure-window title of its own: reusing the question ran past
     * the modal's one line, and a truncated title states less than a plain one. */
    errTitle: string,
    action: BridgeAction,
    args: Record<string, unknown>,
    danger: boolean,
    after?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        { title, body, confirmLabel, icon: "hard-drive", danger },
        async (ok) => {
          if (!ok) {
            resolve();
            return;
          }
          const result = await this.runOperation(action, args);
          if (result) {
            if (result.ok) {
              this.absorbStatusData(result.data ?? {});
              after?.();
            } else {
              this.renderMutationError(errTitle, result);
            }
          }
          resolve();
        }
      ).open();
    });
  }

  async cmdShallowEnable(): Promise<void> {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (fp.shallow) {
      new Notice("History is already shallow on this device; the toggle now shows it.");
      return;
    }
    const depth = this.deviceSettings.shallowDepth;
    await this.footprintChange(
      "Limit history on this device?",
      [
        `Only the newest ${depth} commits stay on this device; older history leaves it. The remote and your other devices keep everything.`,
        "The history panels here reach only what stays, and restoring a file from an older commit is not possible on this device.",
        "This also clears git's local undo journal (the reflog) on this device: with it kept, the old commits stay pinned and the cut would free nothing for 90 days.",
        "Disk space returns after the next Clean up repository storage.",
      ],
      `Keep ${depth} commits`,
      "Native Git: shallow failed",
      "repo-shallow",
      { depth },
      true,
      () => new Notice(`History limited to the newest ${depth} commits on this device. Run Clean up repository storage to free the space.`)
    );
  }

  async cmdUnshallow(): Promise<void> {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (!fp.shallow) {
      new Notice("The full history is already on this device; the toggle now shows it.");
      return;
    }
    await this.footprintChange(
      "Download the full history back?",
      ["One large download over the network; the budget is generous, and the output panel shows progress."],
      "Download full history",
      "Native Git: unshallow failed",
      "repo-unshallow",
      {},
      false,
      () => new Notice("Full history restored on this device.")
    );
  }

  async cmdPartialEnable(): Promise<void> {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (fp.partial) {
      new Notice("Partial clone is already enabled on this device; the toggle now shows it.");
      return;
    }
    await this.footprintChange(
      "Enable partial clone on this device?",
      [
        "The repository is marked as a partial clone (blob:none): file content is fetched when something needs it, and the content of files your sparse checkout hides is never downloaded at all.",
        "'Show again (remove sparse exclusion)' will need the NETWORK from now on: materialising hidden files fetches their content from the remote.",
        "Old versions of files open on demand the same way, so file history needs the network for content this device has not fetched yet.",
        "Applies to this device only. Run Clean up repository storage afterwards to shed content that is already downloaded.",
      ],
      "Enable partial clone",
      "Native Git: partial clone failed",
      "repo-partial-enable",
      {},
      true,
      () => new Notice("Partial clone enabled on this device. Run Clean up repository storage to shed already-downloaded content.")
    );
  }

  async cmdPartialDisable(): Promise<void> {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (!fp.partial) {
      new Notice("Partial clone is already off on this device; the toggle now shows it.");
      return;
    }
    await this.footprintChange(
      "Disable partial clone?",
      [
        "Everything the filter skipped is fetched from the remote first — one large download — and the repository is unmarked only once nothing is missing.",
      ],
      "Disable partial clone",
      "Native Git: partial clone stays",
      "repo-partial-disable",
      {},
      false,
      () => new Notice("Partial clone disabled; all content is local again.")
    );
  }

  /**
   * The one-time offer: sparse is hiding files, the runner can serve partial
   * clone, and the device is still downloading content it will never show.
   * Fires once per device; the settings toggle stays available either way.
   */
  private maybeOfferPartialForSparse(): void {
    if (this.deviceSettings.partialOfferShown) return;
    const st = this.lastStatus;
    if (!st || !st.sparse.enabled || st.partialFilter !== undefined) return;
    if (this.lastRunnerVersion < 14) return;
    this.deviceSettings = this.store.write({ partialOfferShown: true });
    void this.cmdPartialEnable();
  }

  async refreshExcludeList(): Promise<string[] | null> {
    const result = await this.runOperation("exclude-list");
    if (!result?.ok) return null;
    this.absorbExcludeList(result.data?.excludeList);
    return this.excludeLines;
  }

  private absorbExcludeList(raw: string | undefined): void {
    if (raw === undefined) return;
    this.excludeLines = parseIgnoreEntries(raw);
  }

  isExcluded(path: string): boolean {
    return ignoreEntryMatches(this.excludeLines, path);
  }

  // .gitignore is a plain tracked file in the vault: edited directly, no Termux.



  async loadGitignore(): Promise<string[]> {
    try {
      const raw = await this.app.vault.adapter.read(".gitignore");
      this.gitignoreLines = raw.split(/\r?\n/);
    } catch {
      this.gitignoreLines = [];
    }
    return parseIgnoreEntries(this.gitignoreLines.join("\n"));
  }

  isGitignored(path: string): boolean {
    return ignoreEntryMatches(parseIgnoreEntries(this.gitignoreLines.join("\n")), path);
  }

  /** `standalone = false`: bulk route; it warns and refreshes once itself. */
  async gitignoreAdd(entry: string, standalone = true): Promise<void> {
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
    if (standalone) {
      // The menu writes the anchored form (`/path`); the settings tab may hand
      // over any pattern, which simply matches no tracked path and warns nothing.
      this.warnIfRuleTargetsTracked([entry.trim().replace(/^\//, "").replace(/\/$/, "")]);
      // .gitignore changes what `status` reports, and the plugin edited it
      // behind git's back, so only a fresh status can bring the panel in step.
      await this.refreshAfterRuleChange();
    }
  }

  async gitignoreRemove(entry: string, standalone = true): Promise<void> {
    await this.loadGitignore();
    const before = this.gitignoreLines.length;
    this.gitignoreLines = this.gitignoreLines.filter((l) => l.trim() !== entry.trim());
    if (this.gitignoreLines.length === before) return;
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new Notice(`Removed from .gitignore: ${entry.trim()}`);
    if (standalone) await this.refreshAfterRuleChange();
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

  /**
   * Collect everything that describes a failure into one file and hand it to
   * Android's own share sheet.
   *
   * Three sources, because the answer is rarely in only one of them: the ring
   * buffer, the `detail` on each entry (git's stderr), and the runner's own log
   * in `runtime/`, which records what the Termux side did including the parts
   * that never reach a result file.
   *
   * The file is written into `runtime/`, which is excluded from git by the
   * installer, so a bundle can never become a change in the repository it is
   * describing. Nothing here is deleted afterwards: it is small, it is
   * excluded, and a report the user cannot find again is worse.
   *
   * `navigator.share` is the only route out of the WebView that needs no new
   * Android permission and no companion release. It is not guaranteed to exist
   * there, so the fallback names the exact path and offers to copy the whole
   * thing to the clipboard, which is what the log button already did.
   */
  /**
   * Everything the output panel draws, read in one pass.
   *
   * One method rather than a set of getters the panel could call: three of these
   * fields come off shared storage, the panel refreshes once a second, and
   * gathering them separately would let the elapsed counter disagree with the
   * stream printed beside it.
   *
   * The two collapsed sections are only read when they are open. `runner.log` is
   * a file read on shared storage every second otherwise, for a section nobody
   * is looking at.
   */
  async outputSnapshot(want: {
    runnerLog: boolean;
    past: boolean;
    opLog: boolean;
  }): Promise<RunnerOutputSnapshot> {
    const paths = new RuntimePaths(this.app.vault.configDir);
    const current = [...this.inFlight.values()].pop() ?? null;
    let stream = "";
    if (current !== null) {
      const raw = await this.client.readProgress(current.id);
      if (raw !== null) stream = progressForBundle(raw, 32 * 1024);
    } else {
      // Nothing running: keep showing the newest stream there is, because the
      // panel is usually opened just after something finished badly.
      const recent = await this.collectProgressStreams(paths, 1);
      stream = recent[0]?.text ?? "";
    }
    let queued = 0;
    try {
      queued = await this.client.pendingRequestCount();
    } catch {
      queued = 0;
    }
    let runnerLog = "";
    if (want.runnerLog) {
      try {
        const p = `${paths.root}/runner.log`;
        if (await this.app.vault.adapter.exists(p)) {
          const text = await this.app.vault.adapter.read(p);
          const tail = text.slice(-8 * 1024);
          const nl = tail.indexOf("\n");
          runnerLog = redact(nl >= 0 && text.length > 8 * 1024 ? tail.slice(nl + 1) : tail).trimEnd();
        }
      } catch {
        runnerLog = "";
      }
    }
    let opLog = "";
    if (want.opLog) {
      // Already redacted and truncated on the way in; formatting is all that is
      // left. Newest last, like every other console in this panel.
      opLog = this.log
        .list()
        .map(
          (e) =>
            `${e.ts} [${e.level}] ${e.action}: ${e.message}` +
            (e.detail !== undefined ? `\n    ${e.detail.split("\n").join("\n    ")}` : "")
        )
        .join("\n");
    }
    let past: RunnerOutputPast[] = [];
    if (want.past) {
      const all = await this.collectProgressStreams(paths, 6);
      past = all
        .filter((s) => s.id !== current?.id)
        .slice(0, 5)
        // The action is the stream's own first line — the runner opens every one
        // with "<action> started" — so nothing has to be remembered for it.
        .map((s) => ({ id: s.id, action: streamAction(s.text) ?? "operation", text: s.text }));
    }
    return {
      action: current?.action ?? null,
      stateText: this.progressText,
      requestId: current?.id ?? null,
      elapsedSeconds: current === null ? 0 : Math.round((Date.now() - current.startedAt) / 1000),
      timeoutSeconds: current?.timeoutSeconds ?? 0,
      stream,
      queued,
      companionAcked: current !== null && this.lastCompanionAckMs >= current.startedAt,
      lastVerdict: this.lastVerdict,
      runnerLog,
      past,
      opLog,
    };
  }

  /** Open (or reveal) the live output panel. */
  async openOutputPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(NGB_OUTPUT_VIEW);
    if (existing.length > 0) {
      const leaf = existing[0]!;
      await this.app.workspace.revealLeaf(leaf);
      // Obsidian defers sidebar views: a restored leaf answers to the type
      // while holding no real view yet, and `instanceof` is how that shows up.
      // Ask for the real one before deciding anything about it.
      await (leaf as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
      const view = leaf.view;
      if (view instanceof RunnerOutputView) {
        // Whoever opens the panel is asking about NOW: land on the live tab,
        // not on whichever log was selected an hour ago.
        view.showLive();
        await view.tick();
        return;
      }
      // A leaf of the right type that still is not this view is a leftover — a
      // workspace restored from a session where the type was not registered
      // renders as an empty black pane with the right title. Say so in the log
      // (the shared bundle carries it) and rebuild the leaf instead of
      // revealing the husk again.
      this.log.add(
        "warn",
        "output-panel",
        `The output leaf held ${view ? view.getViewType() : "no view"}; recreating it.`
      );
      leaf.detach();
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_OUTPUT_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
    await (leaf as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
  }

  /**
   * The progress streams worth putting in a bundle: the newest few, whole.
   *
   * Newest first because a report is almost always about what just happened,
   * and capped because these files exist to be watched, not archived — five of
   * them at 8 KB each is a bundle that still opens on a phone and still fits in
   * a message. Request ids begin with a sortable timestamp, so ordering them is
   * a string comparison and needs no file stats.
   */
  private async collectProgressStreams(
    paths: RuntimePaths,
    limit = 5
  ): Promise<{ id: string; text: string }[]> {
    const adapter = this.app.vault.adapter;
    let files: string[];
    try {
      if (!(await adapter.exists(paths.progressDir))) return [];
      files = (await adapter.list(paths.progressDir)).files.filter((f) => f.endsWith(".txt"));
    } catch {
      return [];
    }
    files.sort().reverse();
    const out: { id: string; text: string }[] = [];
    for (const f of files.slice(0, limit)) {
      try {
        const raw = await adapter.read(f);
        const name = f.slice(f.lastIndexOf("/") + 1);
        out.push({ id: name.replace(/\.txt$/, ""), text: progressForBundle(raw) });
      } catch {
        /* one unreadable stream must not lose the others */
      }
    }
    return out;
  }

  /** The one place the log window is built, so the share button cannot go missing from one of them. */
  openOperationLog(): void {
    new OperationLogModal(this.app, this.log, () => void this.cmdShareOperationLog()).open();
  }

  async cmdShareOperationLog(): Promise<void> {
    const paths = new RuntimePaths(this.app.vault.configDir);
    const root = paths.root;
    const adapter = this.app.vault.adapter;
    const runnerLogPath = `${root}/runner.log`;
    let runnerLog: string | null = null;
    try {
      if (await adapter.exists(runnerLogPath)) runnerLog = await adapter.read(runnerLogPath);
    } catch {
      runnerLog = null;
    }
    const progress = await this.collectProgressStreams(paths);
    const s = this.deviceSettings;
    const now = new Date().toISOString();
    const text = buildLogBundle({
      now,
      facts: {
        "Plugin version": this.manifest.version,
        "Runner version": this.lastRunnerVersion > 0 ? String(this.lastRunnerVersion) : "(unknown)",
        "Runner minimum": String(RUNNER_MIN_VERSION),
        Platform: Platform.isAndroidApp ? "Android app" : Platform.isMobile ? "mobile" : "desktop",
        "Obsidian requires": this.manifest.minAppVersion,
        "Profile for this vault": s.profileId || "(none yet)",
        "Protected paths (effective)": this.effectiveProtectedPaths().join(", ") || "(none)",
        "Termux integration": String(s.termuxIntegrationEnabled),
      },
      entries: this.log.list(),
      runnerLog,
      progress,
    });
    const name = logBundleName(now);
    const filePath = `${root}/${name}`;
    try {
      await adapter.write(filePath, text);
    } catch (e) {
      new ResultModal(this.app, "Could not write the log bundle", [
        `Writing ${filePath} failed: ${String(e)}`,
      ], { isError: true }).open();
      return;
    }
    const nav = navigator as Navigator & {
      share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      canShare?: (d: { files?: File[] }) => boolean;
    };
    if (typeof nav.share === "function") {
      try {
        const file = new File([text], name, { type: "text/plain" });
        if (nav.canShare === undefined || nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: "Native Git Bridge log" });
          return;
        }
      } catch {
        // A share the user dismissed and a share the platform refused look the
        // same from here, so both fall through to the window below rather than
        // being reported as a failure.
      }
    }
    new ResultModal(
      this.app,
      "Log bundle written",
      [
        `Saved to ${filePath} inside the vault.`,
        "That folder is excluded from git, so the file will not show up as a change.",
        "Android's share sheet is not reachable from inside Obsidian, and the companion cannot reach the file either: it holds one permission, to run Termux, and reading shared storage is not it. So either copy the whole bundle below, or put a copy where Obsidian's own Share can see it.",
      ],
      {
        stdout: text,
        actions: [
          {
            label: "Save as a note to share",
            cta: true,
            onClick: () => void this.saveLogBundleAsNote(text, name),
          },
        ],
      }
    ).open();
  }

  /**
   * Second copy of the bundle, as a note in the vault root.
   *
   * Obsidian's own note menu has Share on mobile, and that is a share sheet the
   * plugin does not have to build, ask a permission for, or teach the companion
   * about. The cost is honest and stated: a note in the vault is an untracked
   * file in the repository, unlike the copy in `runtime/`.
   *
   * It is a separate button rather than the default for exactly that reason.
   */
  private async saveLogBundleAsNote(text: string, bundleName: string): Promise<void> {
    const notePath = `${bundleName.replace(/\.txt$/, "")}.md`;
    // It cannot live in `runtime/`, which is the folder that is already
    // excluded from git: Obsidian does not index anything under its config
    // directory, so such a file has no note menu and therefore no Share. The
    // copy Obsidian can share has to be an ordinary file in the vault.
    //
    // Which would make it an untracked change — so the pattern goes into
    // `.git/info/exclude` first. That file is per clone and never committed, so
    // this stays a decision about THIS device, and one entry covers every
    // bundle ever written. The runner's exclude-add is idempotent.
    const excluded = await this.runOperation("exclude-add", { path: LOG_NOTE_GLOB });
    try {
      await this.app.vault.adapter.write(notePath, ["```", text, "```", ""].join("\n"));
    } catch (e) {
      new Notice(`Could not write ${notePath}: ${String(e)}`);
      return;
    }
    if (excluded?.ok) this.excludeLines = (excluded.data?.excludeList ?? "").split("\n").filter(Boolean);
    this.openVaultFile(notePath);
    new Notice(
      excluded?.ok
        ? `Saved as ${notePath}. ${LOG_NOTE_GLOB} is excluded from git on this device, so it is not a change.`
        : `Saved as ${notePath} — git was not told to ignore it, so it shows as untracked.`
    );
    this.offerFileMenu(notePath);
  }

  /**
   * Open the note's own file menu, so Share is one tap away instead of a hunt
   * through the pane header.
   *
   * EXPERIMENT, and it may not survive. Obsidian exposes no share API at all —
   * the word does not occur in its typings — and the only automatic route would
   * be `app.commands.executeCommandById`, which is not public, whose id is
   * undocumented and mobile-only, and which would break silently for everyone
   * the day it changed. This plugin already refused that class of bet once, for
   * Version History Diff's internals (`docs/limitations.md`).
   *
   * What is used here is entirely public: `Workspace.trigger` and
   * `Menu.showAtPosition`, with `file-menu`, the same documented event this
   * plugin already handles. Whether Obsidian's own mobile Share is added
   * THROUGH that event or hard-coded past it is the open question, and there is
   * no public way to read a Menu's items back, so the plugin cannot tell either.
   * If Share does not appear, this comes out.
   */
  private offerFileMenu(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const menu = new Menu();
    this.app.workspace.trigger("file-menu", menu, file, "more-options");
    // Top-centre: a menu anchored to a corner on a phone opens off the edge,
    // and there is no element here to anchor to — the button that opened it
    // belongs to a window that is closing.
    const win = this.app.workspace.containerEl.win;
    menu.showAtPosition({ x: Math.round(win.innerWidth / 2), y: 96 });
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
    if (typeof d.rescueBranches === "string") this.offerRescueCleanup(d.rescueBranches);
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
      shallow: d.shallow === "true",
      partialFilter: d.partialFilter?.trim() ? d.partialFilter.trim() : undefined,
      // Tri-state on purpose: a runner older than v15 does not report the
      // field, and "unknown" must not read as "no credentials" — that would
      // send every re-clone on an old runner to the Termux terminal.
      credsConfigured: d.credsConfigured === undefined ? undefined : d.credsConfigured === "true",
    };
    this.statusStale = false;
    this.maybeOfferPartialForSparse();
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
    // Derived from what git itself reports; disabled sparse derives an empty
    // set, because after a re-clone the sparse configuration is simply gone.
    const candidates = sparse.enabled ? sparseExclusionPaths(sparse.patterns) : [];
    const validated = validateProtectedPaths(candidates);
    const derived = validated.ok ? validated.normalized : [];
    const prev = this.deviceSettings.derivedProtectedPaths;
    const missing = prev.filter((p) => !derived.includes(p));
    if (missing.length > 0) {
      // Paths this device protects are no longer sparse-hidden — a re-clone,
      // or rules changed outside the plugin. Neither silent answer is right:
      // dropping the protection unguards what the gate exists for, keeping it
      // SAFETY_BLOCKs sync over paths that are now plainly visible. So the
      // protection STAYS until the user decides, and the window asks which
      // way — hide-and-protect again, or release. Once per set per session.
      this.offerSparseReconcile(missing, derived);
      return;
    }
    if (derived.length === prev.length && derived.every((p, i) => p === prev[i])) return;
    this.deviceSettings = this.store.write({ derivedProtectedPaths: derived });
    this.log.add(
      "info",
      "sparse",
      `Derived protected paths refreshed from sparse exclusions: ${derived.join(", ") || "(none)"}.`
    );
  }

  /** Sets of no-longer-hidden protected paths already asked about this session. */
  private sparseReconcileOffered = new Set<string>();
  private offerSparseReconcile(missing: string[], remaining: string[]): void {
    const sig = missing.join("\n");
    if (this.sparseReconcileOffered.has(sig)) return;
    this.sparseReconcileOffered.add(sig);
    const plural = missing.length === 1 ? "path" : "paths";
    new ResultModal(
      this.app,
      "Protected paths are no longer hidden",
      [
        `${missing.length} ${plural} this device protects ${missing.length === 1 ? "is" : "are"} no longer excluded by the repository's sparse checkout — after a re-clone, or after the rules were changed outside the plugin:`,
        ...missing,
        "Hide & protect again puts the sparse exclusion back (this device only; the files leave the working tree, nothing leaves the repository). Release accepts the new state: the paths stay visible and lose the protection. Until you choose, the protection stays on.",
      ],
      {
        actions: [
          {
            label: "Hide & protect again",
            cta: true,
            onClick: () => void this.reapplySparseExclusions(missing),
          },
          {
            label: "Release protection",
            onClick: () => {
              this.deviceSettings = this.store.write({ derivedProtectedPaths: remaining });
              this.log.add("info", "sparse", `Protection released for: ${missing.join(", ")}.`);
              new Notice(`No longer protected: ${missing.join(", ")}.`);
              this.pushStatusToView();
            },
          },
        ],
      }
    ).open();
  }

  /**
   * Re-hide the given paths one by one; each add refreshes the derived set.
   * skipConfirm: the reconcile window the user just answered WAS the
   * confirmation, and one question per path would ask it three more times.
   */
  private async reapplySparseExclusions(paths: string[]): Promise<void> {
    for (const p of paths) {
      await this.cmdSparseExclude(p, true, true);
    }
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

  /**
   * The status-failed window, shared by every path that asks for one (the
   * status command and the footprint toggles both used to build their own).
   * The dubious-ownership offer rides here because a refused repository
   * announces itself first through a failed status — the most common
   * first-run failure on shared storage — and this window used to carry
   * nothing but Copy details.
   */
  private renderStatusFailure(result: BridgeResult): void {
    const err = result.error;
    const ownership = looksLikeDubiousOwnership(
      `${err?.message ?? ""}\n${err?.stderr ?? ""}`,
      err?.stdout
    );
    this.statusBar?.set("error");
    new ResultModal(this.app, "Native Git: status failed", [err?.message ?? "Unknown error."], {
      stdout: err?.stdout,
      stderr: err?.stderr,
      isError: true,
      actions: ownership
        ? [
            {
              label: "Copy the safe.directory fix…",
              cta: true,
              keepOpen: true,
              onClick: () => this.cmdFixSafeDirectory(),
            },
          ]
        : undefined,
    }).open();
  }

  /** Shared error rendering for mutating operations. Never a bare "failed". */
  private renderMutationError(title: string, result: BridgeResult): void {
    const err = result.error;
    const d = result.data ?? {};
    // A failure with no status attached leaves the panel describing a
    // repository from before the operation. Say so rather than keep asserting
    // it; the next refresh clears it.
    if (!d.branchInfo) {
      this.statusStale = true;
      this.pushStatusToView();
    }
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
    // git's own reason in the BODY, not only behind the fold. "git pull failed
    // during sync." names the step and not the cause, and on a repository this
    // size the cause is followed by two hundred lines of progress, so the one
    // sentence that mattered ("Please commit your changes or stash them before
    // you merge") could only be found by expanding stderr and scrolling back.
    const reason = summarizeGitError(err?.stderr, err?.stdout);
    // A damaged object database announces itself through whatever operation
    // happened to walk into it, so the message never mentions the real cause.
    // Name it, and offer the repair instead of leaving the user to find out
    // that `git fsck` exists.
    const corrupt = looksLikeObjectCorruption(err?.stderr, err?.stdout);
    // A stale index.lock announces itself the same way through any operation:
    // "Unable to create … index.lock: File exists". The message alone leaves
    // the user hunting a phantom git process, so every window carrying it
    // also carries the way out.
    const staleLock = !corrupt && looksLikeStaleLock(err?.stderr, err?.stdout);
    // A missing identity and a refused repository announce themselves the
    // same way — through whatever operation ran into them — and both used to
    // reach the user as a sentence containing a command to retype in Termux.
    // Each now carries its button. The message is included in the probe: the
    // runner's own refusals put the reason there, not in stderr.
    const identity =
      !corrupt && !staleLock &&
      needsGitIdentity(`${err?.message ?? ""}\n${err?.stderr ?? ""}`, err?.stdout);
    const ownership =
      !corrupt && !staleLock && !identity &&
      looksLikeDubiousOwnership(`${err?.message ?? ""}\n${err?.stderr ?? ""}`, err?.stdout);
    const lines = [err?.message ?? "Unknown error.", ...reason];
    if (corrupt) {
      lines.push(
        "",
        "This is not about the operation you ran: the repository's object database is damaged. " +
          "An empty object file is what git leaves when it was stopped mid-write — Android does " +
          "that to Termux in the background, and a cancelled operation can do it too.",
        "The repair removes only files that are EMPTY, which cannot contain anything, and then " +
          "fetches to bring the real objects back from the remote. Nothing that holds data is touched."
      );
    }
    if (staleLock) {
      lines.push(
        "",
        "A leftover lock file is blocking git: a process the system killed mid-write leaves " +
          ".git/index.lock behind, and every operation fails on it until the file is removed. " +
          "The button below stops Termux's processes (so nothing can be holding the lock) and deletes it."
      );
    }
    if (identity) {
      lines.push(
        "",
        "git has no name and email to sign this repository's commits with — a re-clone brings a " +
          "fresh .git, and the local identity dies with the old one. The button copies the command " +
          "that sets a LOCAL identity at the Termux terminal; what you type there never reaches the plugin."
      );
    }
    if (ownership) {
      lines.push(
        "",
        "git refuses to touch this repository because its files belong to another uid — the normal " +
          "state of Android shared storage. The one-line fix tells git to trust exactly this " +
          "directory; the button copies it and opens Termux."
      );
    }
    new ResultModal(this.app, title, lines, {
      stdout: err?.stdout,
      stderr: err?.stderr,
      isError: true,
      actions: corrupt
        ? [{ label: "Repair the repository", cta: true, onClick: () => void this.cmdRepairObjects() }]
        : staleLock
          ? [{ label: "Delete the stale lock…", cta: true, onClick: () => this.cmdRepairStaleLock() }]
          : identity
            ? [{ label: "Set the git identity…", cta: true, keepOpen: true, onClick: () => this.cmdSetGitIdentity() }]
            : ownership
              ? [{ label: "Copy the safe.directory fix…", cta: true, keepOpen: true, onClick: () => this.cmdFixSafeDirectory() }]
              : undefined,
    }).open();
  }

  /**
   * Remove a stale `.git/index.lock`. On a v16 runner the reading is split
   * from the killing: `repair-triage` says whether the lock exists, how old
   * it is and what is alive, and the plan follows the user's distinction — a
   * live git plus a fresh lock is a RUNNING command (wait), a lock with no
   * process behind it is a corpse (simply removed, nothing killed), and
   * anything else asks before stopping Termux. A v15 runner keeps the old
   * confirm-then-kill flow, which was the only tool it has.
   */
  cmdRepairStaleLock(): void {
    if (this.lastRunnerVersion >= 16) {
      void this.runStaleLockTriage();
      return;
    }
    this.confirmStaleLockKill([]);
  }

  private async runStaleLockTriage(): Promise<void> {
    const t = await this.runOperation("repair-triage", {});
    if (!t) return;
    if (!t.ok) return this.renderMutationError("Native Git: triage failed", t);
    this.absorbStatusData(t.data ?? {});
    const d = t.data ?? {};
    const procs = (d.liveProcesses ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const plan = decideStaleLock({
      lockExists: d.lockExists === "true",
      lockAgeSeconds:
        d.lockAgeSeconds === undefined || d.lockAgeSeconds === ""
          ? null
          : Number(d.lockAgeSeconds),
      liveGit: d.liveGit === "true",
      liveProcesses: procs,
    });
    if (plan.kind === "no-lock") {
      new Notice("No lock file is there — it may have been released already.");
      return;
    }
    if (plan.kind === "corpse") {
      const result = await this.runOperation("repair-stale-lock", { skipKill: true });
      if (!result) return;
      if (!result.ok) return this.renderMutationError("Native Git: unlock failed", result);
      this.absorbStatusData(result.data ?? {});
      new Notice(
        result.data?.lockRemoved === "true"
          ? "Stale lock removed — nothing was holding it, so nothing was stopped. Run the operation again."
          : "No lock file was there — it may have been released already. Run the operation again."
      );
      return;
    }
    if (plan.kind === "running") {
      new ResultModal(
        this.app,
        "A git command seems to be running",
        [
          `The lock was written ${d.lockAgeSeconds ?? "?"} seconds ago and a live git process exists — that reads as a command still working, not a leftover. Waiting is the safe choice: interrupting a write is how object files end up empty.`,
          `Running now:\n${procs.join("\n")}`,
        ],
        {
          isError: true,
          actions: [
            {
              label: "Stop Termux & delete anyway…",
              onClick: () => this.confirmStaleLockKill(procs),
            },
          ],
        }
      ).open();
      return;
    }
    this.confirmStaleLockKill(procs);
  }

  /**
   * The kill half, always behind this confirmation (§4 rule 7): it stops
   * every Termux process — an open terminal session included — and the
   * window has to say so, every time.
   */
  private confirmStaleLockKill(procs: string[]): void {
    new ConfirmModal(
      this.app,
      {
        title: "Delete the stale git lock?",
        body: [
          ".git/index.lock guards the repository while one git process writes. A process Android killed leaves it behind, and every operation then fails with 'another git process seems to be running'.",
          "To make the removal safe, EVERY Termux process is stopped first — including a terminal session, if one is open — and the runner arrives in a fresh Termux started by the trigger. Only then is the lock file deleted.",
          procs.length > 0
            ? `What stops now: ${procs.join(", ")}.`
            : "Do not run this while a download you started in Termux is still visibly working.",
        ],
        confirmLabel: "Stop Termux & delete the lock",
        icon: "lock-open",
        danger: true,
      },
      async (ok) => {
        if (!ok) return;
        const result = await this.runOperation("repair-stale-lock", {});
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: unlock failed", result);
        this.absorbStatusData(result.data ?? {});
        const killed = (result.data?.killedProcesses ?? "")
          .split("\n")
          .filter((s) => s.trim() !== "").length;
        new Notice(
          result.data?.lockRemoved === "true"
            ? `Stale lock removed${killed > 0 ? ` (${killed} process${killed === 1 ? "" : "es"} stopped)` : ""}. Run the operation again.`
            : "No lock file was there — it may have been released already. Run the operation again."
        );
      }
    ).open();
  }

  /**
   * One shape for every "copy this command and run it in Termux" window:
   * copy, notice, a two-line body with the command collapsed under the fold,
   * and a re-copy button that also brings Termux forward. The command builders
   * refuse an unknown repository path, and the Notice says what to set.
   */
  private openTermuxCommandModal(opts: {
    command: string | null;
    title: string;
    body: string[];
  }): void {
    if (opts.command === null) {
      new Notice(
        "Set the repository path in settings first — the command addresses the vault by its absolute path in Termux."
      );
      return;
    }
    const cmd = opts.command;
    void navigator.clipboard.writeText(cmd);
    new Notice("Command copied - long-press in Termux to paste, then Enter.");
    new ResultModal(this.app, opts.title, opts.body, {
      collapsed: { label: "The copied command", text: cmd },
      actions: [
        {
          label: "Copy command & open Termux",
          cta: true,
          keepOpen: true,
          onClick: () => {
            void navigator.clipboard.writeText(cmd);
            this.openTermux();
          },
        },
      ],
    }).open();
  }

  /**
   * The identity fix as a button. The values are TYPED at the terminal and
   * stay in Termux (the user's rule: neither the plugin nor the runner may
   * learn the git name or email); the command ends by listing the two key
   * NAMES back, so git itself confirms visibly that both now exist.
   */
  cmdSetGitIdentity(): void {
    this.openTermuxCommandModal({
      command: identitySetupCommand(this.deviceSettings.repoPathHint),
      title: "Set the git identity in Termux",
      body: [
        "1. The command is copied. In Termux: paste, Enter, then type the name and the email git should sign this repository's commits with. git answers with the two keys it now has — the values stay in Termux.",
        "2. Come back and run the operation again. The identity is LOCAL to this repository, so a global one is no longer needed for it.",
      ],
    });
  }

  /**
   * The `safe.directory` fix as a button. A repository git refuses cannot be
   * repaired through an ordinary action — the runner rejects the profile
   * before the dispatcher — so this stays a clipboard command by the user's
   * decision (0.6.6 spec): the safer path over a new dispatch state in the
   * runner's gating.
   */
  cmdFixSafeDirectory(): void {
    this.openTermuxCommandModal({
      command: safeDirectoryCommand(this.deviceSettings.repoPathHint),
      title: "Allow git to use this repository",
      body: [
        "1. The command is copied. In Termux: paste, Enter. It tells git to trust exactly this directory — the files on shared storage belong to another uid, which is why git refuses them.",
        "2. Come back and run the operation again.",
      ],
    });
  }

  /**
   * Presence and scope, never a value: which scopes hold user.name,
   * user.email and credential.helper, read from the status fields a v16
   * runner reports, with the two one-tap exits where they apply. The ordering
   * rule is absolute: the global identity is never offered for removal while
   * this repository has no local one.
   */
  async cmdCheckIdentity(): Promise<void> {
    const result = await this.runOperation("status", {});
    if (!result) return;
    if (!result.ok) return this.renderStatusFailure(result);
    this.absorbStatusData(result.data ?? {});
    const d = result.data ?? {};
    if (d.userNameScopes === undefined && d.userEmailScopes === undefined) {
      new ResultModal(
        this.app,
        "Termux runner is too old for this",
        [
          `The identity check needs runner v16; this device answers with v${this.lastRunnerVersion}.`,
          RUNNER_OUTDATED_HINT,
        ],
        { isError: true }
      ).open();
      return;
    }
    const scopesOf = (v?: string) =>
      (v ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    const nameScopes = scopesOf(d.userNameScopes);
    const emailScopes = scopesOf(d.userEmailScopes);
    const helperScopes = scopesOf(d.credHelperScopes);
    const hasLocal = nameScopes.includes("local") && emailScopes.includes("local");
    const hasGlobal = nameScopes.includes("global") || emailScopes.includes("global");
    const hasAny = nameScopes.length > 0 && emailScopes.length > 0;
    const globalHelper = helperScopes.includes("global") || helperScopes.includes("system");
    const lines = [
      hasAny
        ? "git has an identity to commit with. Where each key is set (values are never read):"
        : "git has NO identity to commit with — the next commit or sync will fail. Where each key is set:",
      `user.name: ${nameScopes.join(", ") || "not set in any scope"}`,
      `user.email: ${emailScopes.join(", ") || "not set in any scope"}`,
      `credential.helper: ${helperScopes.join(", ") || "not set in any scope"}`,
    ];
    if (!hasLocal) {
      lines.push(
        "",
        hasGlobal
          ? "This repository has no LOCAL identity, so commits fall back to the global one — silently, and again after every re-clone. Set a local identity first; only then is removing the global one safe."
          : "This repository has no LOCAL identity. Set one with the button below; the values are typed in Termux and stay there."
      );
    } else if (hasGlobal) {
      lines.push(
        "",
        "A global identity also exists. Any repository on this device WITHOUT a local identity commits under it; now that this repository carries its own, the global one can be removed."
      );
    }
    if (globalHelper) {
      lines.push(
        "",
        "A global credential helper exists, and helpers are asked global-first: it answers BEFORE this repository's own credential file. The reset makes the local file authoritative; the global configuration is not touched."
      );
    }
    const actions: { label: string; cta?: boolean; keepOpen?: boolean; onClick: () => void }[] = [];
    if (!hasLocal) {
      actions.push({
        label: "Set the git identity…",
        cta: true,
        keepOpen: true,
        onClick: () => this.cmdSetGitIdentity(),
      });
    } else if (hasGlobal) {
      actions.push({
        label: "Remove the global identity…",
        onClick: () => this.cmdDropGlobalIdentity(),
      });
    }
    if (globalHelper) {
      actions.push({
        label: "Prefer this repository's credentials…",
        onClick: () => this.cmdResetCredHelper(),
      });
    }
    new ResultModal(this.app, "Git identity check", lines, {
      actions: actions.length > 0 ? actions : undefined,
    }).open();
  }

  /**
   * Value-free removal (`--unset-all` reads nothing). Reached only from the
   * identity check, which offers it only while a local identity exists; the
   * runner enforces the same rule again, defense in depth.
   */
  private cmdDropGlobalIdentity(): void {
    new ConfirmModal(
      this.app,
      {
        title: "Remove the global git identity?",
        body: [
          "Removes user.name and user.email from Termux's global git configuration. The values are not read or shown anywhere.",
          "This repository keeps its own local identity. Any OTHER repository on this device without a local identity will refuse to commit until it gets one — that is the point: no more commits signed by accident.",
        ],
        confirmLabel: "Remove global identity",
        danger: true,
      },
      async (ok) => {
        if (!ok) return;
        const result = await this.runOperation("identity-drop-global", {});
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: identity removal failed", result);
        this.absorbStatusData(result.data ?? {});
        new Notice("Global git identity removed.");
      }
    ).open();
  }

  /** The empty-value reset that stops a global helper answering first. */
  private cmdResetCredHelper(): void {
    new ConfirmModal(
      this.app,
      {
        title: "Prefer this repository's credentials?",
        body: [
          "A global credential helper currently answers before this repository's own credential file, so operations here can use another account's saved credentials.",
          "This writes two lines into the repository's LOCAL git config: an empty helper that stops the inherited list, then the profile's own credential file. The global configuration is not touched, and no credential is read or shown.",
          "If the profile's file is empty, the next network operation asks for credentials once, in Termux, and saves them there.",
        ],
        confirmLabel: "Make the local file win",
      },
      async (ok) => {
        if (!ok) return;
        const result = await this.runOperation("cred-helper-local-reset", {});
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: credential reset failed", result);
        this.absorbStatusData(result.data ?? {});
        new Notice("This repository's own credential file now answers first.");
      }
    ).open();
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

  /**
   * The last moment a too-long filename can still be fixed is before it is
   * committed: it commits and pushes cleanly from here, and then every OTHER
   * clone fails to check it out — "Filename too long" on Windows' 260-character
   * paths, the 255-byte segment limit everywhere else. Resolves true when the
   * operation may proceed. The rename goes through Obsidian's own rename so
   * links keep working; folders it will not rename automatically, it names.
   */
  private guardPathLimits(): Promise<boolean> {
    // Obsidian's own file index, not the last git status: the status is as old
    // as its last refresh, and the note the user created five seconds before
    // pressing Sync — the exact case this guard exists for — is not in it. The
    // index is in memory, current, and covers tracked long names too, which
    // are just as broken for every other clone.
    const candidates = this.app.vault.getFiles().map((f) => f.path);
    const issues = checkPathLimits(candidates);
    if (issues.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      // The buttons close the window, and closing fires onDismiss too; this
      // keeps the decline path from outracing a decision already made.
      let handled = false;
      const shown = issues.slice(0, 8);
      const lines = [
        `${issues.length === 1 ? "One path is" : `${issues.length} paths are`} too long for other machines: the commit would succeed here and every other clone would fail to check it out ("Filename too long").`,
        ...shown.map(
          (i) =>
            `• ${i.path}` +
            (i.needsFolderRename ? " — a FOLDER name is the problem; rename it in Obsidian first" : "")
        ),
        ...(issues.length > shown.length ? [`…and ${issues.length - shown.length} more.`] : []),
      ];
      const renamable = issues.filter((i) => !i.needsFolderRename);
      new ResultModal(this.app, "Filenames too long for other machines", lines, {
        isError: true,
        actions: [
          ...(renamable.length > 0
            ? [
                {
                  label: `Shorten ${renamable.length === 1 ? "the name" : `${renamable.length} names`} automatically`,
                  cta: true,
                  onClick: () => {
                    handled = true;
                    void (async () => {
                      const taken = new Set(candidates);
                      let renamed = 0;
                      for (const i of renamable) {
                        const to = proposeRename(i.path, taken);
                        const f = this.app.vault.getAbstractFileByPath(i.path);
                        if (to === null || f === null) continue;
                        try {
                          // fileManager, not adapter: this is the rename that
                          // updates every link pointing at the note.
                          await this.app.fileManager.renameFile(f, to);
                          taken.add(to);
                          renamed += 1;
                          this.log.add("info", "path-limits", `Renamed for other machines: ${i.path} → ${to}`);
                        } catch (e) {
                          this.log.add("error", "path-limits", `Could not rename ${i.path}: ${String(e)}`);
                        }
                      }
                      this.notify(`Native Git: shortened ${renamed} filename${renamed === 1 ? "" : "s"}.`);
                      resolve(renamed === issues.length);
                    })();
                  },
                },
              ]
            : []),
          {
            label: "Commit anyway",
            onClick: () => {
              handled = true;
              resolve(true);
            },
          },
        ],
        onDismiss: () => {
          if (!handled) resolve(false);
        },
      }).open();
    });
  }

  async cmdCommit(): Promise<void> {
    if (!(await this.guardPathLimits())) return;
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
    if (!(await this.guardPathLimits())) return;
    // A sync that completes a manual merge resolution commits with git's own
    // prepared merge message automatically — no modal, as requested.
    const mergeMsg = this.lastStatus?.mergeInProgress ? this.lastStatus.mergeMsg : undefined;
    const result = await this.runOperation("sync", {
      protectedPaths: this.effectiveProtectedPaths(),
      message: message ?? mergeMsg ?? "",
    });
    if (!result) return;
    if (!result.ok) {
      // "Sync failed" must not be read as "nothing happened". Since runner v13
      // sync may commit BEFORE the merge — only when the merge would otherwise
      // be refused — and that commit stands whatever the merge then does.
      if ((result.data?.steps ?? "").includes("committed-before-merge")) {
        this.log.add(
          "info",
          "sync",
          "Local changes were committed before the merge; that commit is kept whatever happened next."
        );
      }
      return this.renderMutationError("Native Git: sync failed", result);
    }
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

  /**
   * Clear away object files that are empty, then refetch.
   *
   * Confirmed rather than silent, because it touches `.git` — but the thing it
   * removes is by construction empty, so there is nothing to set aside and
   * nothing to lose. Anything corrupt that is NOT empty is reported and left
   * alone: it may still hold recoverable data, and that is a decision for a
   * person at a terminal.
   */
  /**
   * One implementation of "put this block back", for both surfaces that offer
   * it: the file-history panel's hunks and a diff opened from the commit
   * history. The steps are shared in `restoreBlockInFile`; what differs here is
   * only which vault this is and how the outcome is announced.
   */
  async restoreBlockFromCommit(path: string, hunk: DiffHunk, commitish: string): Promise<void> {
    const outcome = await restoreBlockInFile(path, hunk, {
      readFile: (p) => this.readVaultTextFile(p),
      writeFile: async (p, content) => {
        await this.app.vault.adapter.write(p, content);
      },
      stagePatch: (patch) => this.applyHunkPatch(patch, "index", false),
    });
    new Notice(describeRestore(outcome, commitish.replace(/\^+$/, "").slice(0, 8)));
    if (outcome.kind === "restored") void this.cmdStatus(true);
  }

  async cmdRepairObjects(skipConfirm = false): Promise<void> {
    const start = () => void this.runRepairJob();
    if (skipConfirm) {
      start();
      return;
    }
    new ConfirmModal(
      this.app,
      {
        title: "Repair the repository?",
        body: [
          "One repair walks every known problem in order: a leftover lock, the git identity and credential scopes, the sparse definition, then the object database — short steps, so a repair Android interrupts loses one step and not the whole run.",
          "Safe fixes happen by themselves and are narrated in the output panel; anything irreversible, expensive or needing Termux is asked about or listed at the end with its exact fix.",
          "Nothing that holds data is deleted. Objects that are damaged but not empty are reported instead, because they may still be recoverable.",
          "Your files, your commits and your remote are untouched by the repair itself; if a step needs anything more it asks before doing it.",
        ],
        confirmLabel: "Repair",
      },
      async (confirmed) => {
        if (confirmed) start();
      }
    ).open();
  }

  /**
   * Steps 1–5 and 7 of the unified repair (v16): triage once, fix what is
   * safe to fix, and carry everything that needs the user into the final
   * window as a note plus a button. Returns null when the repair must stop —
   * a refused repository (nothing else can run), a running git command (the
   * choice is to wait), or a failed step. The object-database steps follow in
   * the caller; they have their own decision table.
   */
  private async runRepairPreSteps(): Promise<{
    summary: string[];
    actions: { label: string; cta?: boolean; keepOpen?: boolean; onClick: () => void }[];
  } | null> {
    const summary: string[] = [];
    const actions: { label: string; cta?: boolean; keepOpen?: boolean; onClick: () => void }[] = [];
    const triage = await this.repairStep("repair-triage", {}, "repair 1/7: triage");
    if (triage === null) return null;
    if (!triage.ok) {
      const err = triage.error;
      // Step 1, ownership: a repository git refuses answers the triage itself
      // with REPO_MISSING, and nothing else can run until it is fixed. The
      // fix is the clipboard command — the user's decision (0.6.6 spec).
      if (looksLikeDubiousOwnership(`${err?.message ?? ""}\n${err?.stderr ?? ""}`, err?.stdout)) {
        new ResultModal(
          this.app,
          "Repository blocked: ownership",
          [
            "git refuses this repository because its files belong to another uid — the normal state of Android shared storage — and every other repair step is blocked behind it.",
            "The one-line fix tells git to trust exactly this directory. Run it in Termux, then start the repair again.",
          ],
          {
            isError: true,
            actions: [
              {
                label: "Copy the safe.directory fix…",
                cta: true,
                keepOpen: true,
                onClick: () => this.cmdFixSafeDirectory(),
              },
            ],
          }
        ).open();
        return null;
      }
      this.renderMutationError("Native Git: repair could not start", triage);
      return null;
    }
    const d = triage.data ?? {};
    const list = (v?: string) =>
      (v ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    const nameScopes = list(d.userNameScopes);
    const emailScopes = list(d.userEmailScopes);
    const helperScopes = list(d.credHelperScopes);
    const sparsePatterns = list(d.sparseList);
    const procs = list(d.liveProcesses);
    const facts: RepairTriageFacts = {
      lock: {
        lockExists: d.lockExists === "true",
        lockAgeSeconds:
          d.lockAgeSeconds === undefined || d.lockAgeSeconds === ""
            ? null
            : Number(d.lockAgeSeconds),
        liveGit: d.liveGit === "true",
        liveProcesses: procs,
      },
      identity: {
        local: nameScopes.includes("local") && emailScopes.includes("local"),
        global: nameScopes.includes("global") || emailScopes.includes("global"),
        any: nameScopes.length > 0 && emailScopes.length > 0,
      },
      globalCredHelper: helperScopes.includes("global") || helperScopes.includes("system"),
      sparse: {
        enabled: d.sparseEnabled === "true",
        cone: d.sparseCone === "true",
        hasBase: sparsePatterns.includes("/*"),
        hasEmptyingDefault: sparsePatterns.includes("!/*/"),
      },
      rescueBranches: list(d.rescueBranches),
      previousGitDirs: list(d.previousGitDirs),
    };
    for (const item of planRepair(facts)) {
      if (item.step === "lock" && item.act === "remove-corpse") {
        const r = await this.repairStep(
          "repair-stale-lock",
          { skipKill: true },
          "repair 2/7: stale lock"
        );
        if (r === null || !r.ok) {
          if (r !== null) this.renderMutationError("Native Git: unlock failed", r);
          return null;
        }
        summary.push("Removed a leftover index.lock — nothing was holding it, nothing was stopped.");
        continue;
      }
      if (item.step === "lock" && item.act === "wait-running") {
        new ResultModal(
          this.app,
          "A git command seems to be running",
          [
            `The lock was written ${d.lockAgeSeconds ?? "?"} seconds ago and a live git process exists — that reads as a command still working. The repair stops here: waiting is the safe choice, and interrupting a write is how object files end up empty.`,
            `Running now:\n${procs.join("\n")}`,
            "Run the repair again once it finishes.",
          ],
          { isError: true }
        ).open();
        return null;
      }
      if (item.step === "lock" && item.act === "ask-kill") {
        summary.push(
          "A leftover index.lock is there and live processes exist; deleting it stops every Termux process first, so it stays behind its own button."
        );
        actions.push({
          label: "Delete the stale lock…",
          keepOpen: true,
          onClick: () => this.confirmStaleLockKill(procs),
        });
        continue;
      }
      if (item.step === "identity" && item.act === "offer-set") {
        summary.push(
          facts.identity.any
            ? "This repository has no LOCAL git identity: commits fall back to the global one, silently, and again after every re-clone."
            : "git has NO identity to commit with — the next commit or sync will fail."
        );
        actions.push({
          label: "Set the git identity…",
          keepOpen: true,
          onClick: () => this.cmdSetGitIdentity(),
        });
        continue;
      }
      if (item.step === "identity" && item.act === "offer-drop-global") {
        summary.push(
          "A global git identity exists beside this repository's local one; any repository without a local identity commits under it."
        );
        actions.push({
          label: "Remove the global identity…",
          keepOpen: true,
          onClick: () => this.cmdDropGlobalIdentity(),
        });
        continue;
      }
      if (item.step === "cred-helper") {
        summary.push(
          "A global credential helper answers before this repository's own credential file."
        );
        actions.push({
          label: "Prefer this repository's credentials…",
          keepOpen: true,
          onClick: () => this.cmdResetCredHelper(),
        });
        continue;
      }
      if (item.step === "sparse" && item.act === "repair-definition") {
        const r = await this.repairStep(
          "repair-sparse-definition",
          {},
          "repair 3/7: sparse definition"
        );
        if (r === null || !r.ok) {
          if (r !== null) this.renderMutationError("Native Git: sparse repair failed", r);
          return null;
        }
        summary.push(
          "Repaired the sparse definition: the include-everything base is back and git's emptying default is gone. Re-add any exclusions through the reconcile window if it asks."
        );
        continue;
      }
      if (item.step === "sparse" && item.act === "cone-needs-decision") {
        summary.push(
          "This repository uses cone-mode sparse checkout; per-path protection needs pattern (non-cone) mode, and switching modes is a decision, not a repair. In Termux: git sparse-checkout init --no-cone (then re-add exclusions here)."
        );
        continue;
      }
      if (item.step === "leftovers" && item.act === "rescue-branches") {
        summary.push(
          `Repair backup branch${facts.rescueBranches.length === 1 ? "" : "es"} still there: ${facts.rescueBranches.join(", ")} — holding disk until deleted.`
        );
        actions.push({
          label: "Delete repair backup branch…",
          keepOpen: true,
          onClick: () => this.cmdRescueCleanup(),
        });
        continue;
      }
      if (item.step === "leftovers" && item.act === "previous-git") {
        summary.push(
          `A previous repository is still set aside (${facts.previousGitDirs.join(", ")}); the daily reminder offers to delete it once you are sure nothing is lost.`
        );
        continue;
      }
    }
    return { summary, actions };
  }

  /** One repair step: request, log, absorb. Returns null when the job must stop. */
  private async repairStep(
    action: BridgeAction,
    args: Record<string, unknown>,
    stepLabel: string
  ): Promise<BridgeResult | null> {
    this.repairJobStep = stepLabel;
    this.store.setValue(REPAIR_JOB_KEY, JSON.stringify({ step: stepLabel, startedAt: Date.now() }));
    const result = await this.runOperation(action, args, true);
    if (result === null) return null;
    const d = result.data ?? {};
    // Into the log, not only onto the screen: a shared bundle once recorded four
    // repairs as four bare "ok=true" lines, and the number that explained them
    // was never written down.
    this.log.add(
      result.ok ? "info" : "error",
      action,
      `${stepLabel} finished ok=${result.ok}.`,
      [
        d.removedCount !== undefined ? `removed: ${d.removedCount}` : "",
        (d.recoveredBy ?? "") !== "" ? `recovered by: ${d.recoveredBy}` : "",
        d.recoveredCount !== undefined ? `recovered: ${d.recoveredCount}` : "",
        (d.fsckMissing ?? "").trim() !== ""
          ? `still missing:\n${(d.fsckMissing ?? "").trim()}`
          : "still missing: nothing",
      ]
        .filter((l) => l !== "")
        .join("\n")
    );
    this.absorbStatusData(d);
    return result;
  }

  /**
   * Every repair ending that leaves work behind carries this button: the user
   * fixes what the window named (a lock, an identity, a Termux command) and
   * runs the walk again from where they stand, instead of hunting the palette
   * (asked for from the device, 2026-08-25). Skips the opening confirmation —
   * the window they are looking at IS the state that confirmation describes.
   */
  private repairRunAgainAction(): { label: string; onClick: () => void } {
    return { label: "Run the repair again", onClick: () => void this.cmdRepairObjects(true) };
  }

  /**
   * The repair as a queue of short requests, sequenced here and decided by
   * `decideRepair` (pure, tested against the log bundle that motivated it).
   * While the job runs every other request is refused, across the gaps between
   * steps too; a restart mid-job is offered a continue, never resumed silently.
   */
  private async runRepairJob(): Promise<void> {
    if (this.repairJobStep !== null) {
      new Notice("A repair is already running.");
      return;
    }
    try {
      // Steps 1–5 and 7 need the v16 triage; an older runner keeps the
      // object-database repair it always had, and nothing new is demanded
      // of it. Zero means never heard — proceed and let the round trip say.
      let summary: string[] = [];
      let finalActions: { label: string; cta?: boolean; keepOpen?: boolean; onClick: () => void }[] = [];
      if (this.lastRunnerVersion >= 16) {
        // Decision 6 of the 0.6.6 spec: the walk narrates into the output
        // panel, opened under the existing long-operations preference.
        if (this.sharedPrefs.openOutputForLongOps) void this.openOutputPanel();
        const pre = await this.runRepairPreSteps();
        if (pre === null) return;
        summary = pre.summary;
        finalActions = pre.actions;
      }
      // Step 6: remove empties, learn what is missing and whose it is.
      const scan = await this.repairStep("repair-scan", {}, "repair 4/7: object scan");
      if (scan === null || !scan.ok) {
        if (scan !== null) this.renderMutationError("Native Git: repair could not scan", scan);
        return;
      }
      const sd = scan.data ?? {};
      const removed = Number(sd.removedCount ?? "0");
      const ctx: RepairContext = {
        ahead: Number(sd.aheadCount ?? "0"),
        cacheTreeBroken: sd.cacheTreeBroken === "true",
        hasUpstream: sd.hasUpstream === "true",
      };
      const removedLine =
        removed === 0
          ? "No empty object files were found; nothing needed removing."
          : `Removed ${removed} empty object file${removed === 1 ? "" : "s"}.`;

      let stage: RepairStage = "scan";
      let findings = {
        fsckMissing: (sd.fsckMissing ?? "").trim(),
        fsckRemaining: (sd.fsckRemaining ?? "").trim(),
      };
      let recoveredBy = "";

      for (;;) {
        const decision = decideRepair(stage, findings, ctx);
        if (decision.kind === "fetch-missing") {
          const fetch = await this.repairStep(
            "repair-fetch-missing",
            { oids: decision.oids },
            "repair 5/7: fetch missing objects"
          );
          if (fetch === null || !fetch.ok) {
            if (fetch !== null) this.renderMutationError("Native Git: repair could not fetch", fetch);
            return;
          }
          const fd = fetch.data ?? {};
          findings = {
            fsckMissing: (fd.fsckMissing ?? "").trim(),
            fsckRemaining: (fd.fsckRemaining ?? "").trim(),
          };
          // The runner (v16, truthful since the device day this lied on) sends
          // recoveredBy only when the asked-for objects actually materialised;
          // an older runner sends "targeted" unconditionally and is taken at
          // its word — the field is informative, not load-bearing.
          recoveredBy = (fd.recoveredBy ?? "").trim();
          stage = "fetch-missing";
          continue;
        }
        if (decision.kind === "ask-refetch") {
          const proceed = await this.confirmRefetch(summarizeFsckMissing(findings.fsckMissing));
          if (!proceed) {
            new ResultModal(
              this.app,
              "Repository still incomplete",
              [
                ...(summary.length > 0 ? [...summary, ""] : []),
                removedLine,
                (recoveredBy === ""
                  ? "The targeted fetch recovered nothing — this remote does not hand out single objects."
                  : "The targeted fetch did not bring everything back.") +
                  " The remaining step downloads the whole history again; run the repair again when you are ready for that.",
                summarizeFsckMissing(findings.fsckMissing),
              ],
              {
                isError: true,
                stderr: findings.fsckRemaining,
                actions: [...finalActions, this.repairRunAgainAction()],
              }
            ).open();
            return;
          }
          const re = await this.repairStep("repair-refetch", {}, "repair 6/7: refetch history");
          if (re === null || !re.ok) {
            if (re !== null) this.renderMutationError("Native Git: repair could not refetch", re);
            return;
          }
          const rd = re.data ?? {};
          findings = {
            fsckMissing: (rd.fsckMissing ?? "").trim(),
            fsckRemaining: (rd.fsckRemaining ?? "").trim(),
          };
          recoveredBy = (rd.recoveredBy ?? "").trim() || recoveredBy;
          stage = "refetch";
          continue;
        }

        // Terminal decisions.
        const howLine =
          recoveredBy === "targeted"
            ? "Asked the remote for the missing objects themselves, so nothing else was downloaded."
            : recoveredBy === "recovery copy"
              ? "This git has no --refetch, so the history was downloaded into a temporary copy and the missing objects taken from it."
              : recoveredBy === "refetch"
                ? "Refetched the whole history from the remote, so anything it still has is back."
                : "";
        // The FINAL window carries the whole walk: what the pre-steps found
        // (with a button per remaining fix) and how the object story ended.
        const lines = [
          ...(summary.length > 0 ? [...summary, ""] : []),
          removedLine,
          ...(howLine !== "" ? [howLine] : []),
        ];
        if (decision.kind === "clean") {
          lines.push("", "The object store is complete: git can read everything it references.");
          // Step 7/7 (footprint), only when the walk ends whole, and only when
          // the lightweight toggle says the store is SUPPOSED to be small: a
          // repair refetch stuffs the packs with every blob the filter had
          // shed, while the toggle (which mirrors the repository's config,
          // untouched by a refetch) still reads lightweight. Measure what the
          // filter allows shedding and offer exactly that, one tap, real
          // number (decision 4). Toggles off mean the full history is the
          // configured state — nothing to check and nothing to ask (the
          // user's rule, 2026-08-26). The shallow toggle needs no check of
          // its own: it mirrors `.git/shallow`, so either the cut survived
          // (nothing exceeded) or the toggle itself now shows the loss. Never
          // offered on an incomplete store: pruning while objects are missing
          // can destroy the loose files a recovery would want. The 100 MB
          // floor is the lazy-fetch allowance — a healthy lightweight store
          // legitimately holds the blobs recent pulls brought in.
          const fp7 = this.footprintState();
          if (fp7?.partial === true && (this.lastRunnerVersion >= 14 || this.lastRunnerVersion === 0)) {
            const meas = await this.repairStep("maintenance-scan", {}, "repair 7/7: footprint check");
            if (meas !== null && meas.ok) {
              const d7 = meas.data ?? {};
              const before = parseCountObjects(d7.countObjects ?? "");
              const blobKb = Number(d7.blobDiskKb ?? "0");
              if (blobKb >= 100 * 1024) {
                lines.push(
                  "",
                  `This repository is set to stay lightweight, but its packs hold ${formatSize(blobKb)} of file content the filter allows shedding${
                    recoveredBy === "refetch" || recoveredBy === "recovery copy"
                      ? " — the refetch brought back what had been shed"
                      : ""
                  }. The cleanup takes it back.`
                );
                finalActions = [
                  ...finalActions,
                  {
                    label: `Free up ${formatSize(blobKb)}…`,
                    onClick: () => void this.runMaintenanceSteps(before),
                  },
                ];
              }
            }
          }
          new ResultModal(this.app, "Repository repaired", lines, {
            stdout: sd.removedObjects,
            actions: finalActions.length > 0 ? finalActions : undefined,
          }).open();
          return;
        }
        if (decision.kind === "damaged") {
          lines.push(
            "",
            "Nothing is missing any more. What git still reports is damaged content in objects that are NOT empty, and those are left alone on purpose: they may hold recoverable data, and recovering them means working in Termux — `git cat-file`, or restoring that object from another clone.",
            findings.fsckRemaining
          );
          new ResultModal(this.app, "Damaged objects left alone", lines, {
            stderr: findings.fsckRemaining,
            isError: true,
            actions: [...finalActions, this.repairRunAgainAction()],
          }).open();
          return;
        }
        if (decision.kind === "offer-reset") {
          // The bundle's own case: the missing objects were never on the remote —
          // they belong to unpushed commits or to the index — so no download can
          // help, and a re-clone would discard the local commits. Never advise
          // cloning while local-only work exists.
          lines.push(
            "",
            `The remote does not have these objects, and this branch carries local-only state (${
              ctx.ahead > 0 ? `${ctx.ahead} unpushed commit${ctx.ahead === 1 ? "" : "s"}` : "a damaged index"
            }), so the damage is inside what was never pushed. Downloading cannot fix it and cloning again would throw the local commits away.`,
            "Rebuilding the branch on the remote state keeps every file on disk exactly as it is: the content of the local commits becomes ordinary uncommitted changes, the next sync commits it once, and a backup branch keeps the old history reachable.",
            summarizeFsckMissing(findings.fsckMissing)
          );
          new ResultModal(this.app, "Repository still incomplete", lines, {
            stderr: findings.fsckRemaining,
            isError: true,
            actions: [
              {
                label: "Rebuild on the remote state",
                cta: true,
                onClick: () => void this.cmdRepairResetUpstream(ctx.ahead),
              },
              ...finalActions,
              this.repairRunAgainAction(),
            ],
          }).open();
          return;
        }
        // missing-remote
        lines.push(
          "",
          "The remote does not have these objects either, so nothing can bring them back: the history that referenced them is gone on both sides. Cloning the vault again is the way out — your notes on disk are not affected by it.",
          summarizeFsckMissing(findings.fsckMissing)
        );
        new ResultModal(this.app, "Repository still incomplete", lines, {
          stderr: findings.fsckRemaining,
          isError: true,
          actions: [...finalActions, this.repairRunAgainAction()],
        }).open();
        return;
      }
    } finally {
      this.repairJobStep = null;
      this.store.removeValue(REPAIR_JOB_KEY);
    }
  }

  /**
   * Delete the `ngb-rescue-*` branch a rebuild left behind, after an explicit
   * confirmation. The old success window said to do this in Termux, which
   * breaks the rule that the user never touches Termux beyond installing the
   * runner and entering credentials; the runner action it calls accepts
   * nothing but the rescue-branch name shape, so it cannot delete anything
   * else.
   */
  /**
   * A rescue branch that outlived its window. The delete offer used to exist
   * only in the rebuild's success window, which is shown exactly once —
   * whoever closed it had no way back. Status now reports the branches, and
   * this reminds once a day (device-local, like the previous-git reminder)
   * until they are gone.
   */
  /** ngb-rescue branches as of the last status; what the palette command offers. */
  private lastRescueBranches: string[] = [];

  private offerRescueCleanup(raw: string): void {
    const refs = raw.split("\n").filter((r) => /^ngb-rescue-/.test(r.trim()));
    this.lastRescueBranches = refs;
    if (refs.length === 0) return;
    const today = new Date().toDateString();
    if (this.store.getValue("rescue-reminded") === today) return;
    this.store.setValue("rescue-reminded", today);
    this.showRescueCleanup(refs);
  }

  /**
   * On demand from the palette too, not only once a day: the daily gate left a
   * user with a branch they WANTED gone (its shed blobs were spamming every
   * prune with "not our ref") and no button until tomorrow.
   */
  cmdRescueCleanup(): void {
    if (this.lastRescueBranches.length === 0) {
      new Notice("No ngb-rescue backup branch is known. Run Status once if one should be here.");
      return;
    }
    this.showRescueCleanup(this.lastRescueBranches);
  }

  private showRescueCleanup(refs: string[]): void {
    new ResultModal(
      this.app,
      "A repair backup branch is still here",
      [
        `${refs.length === 1 ? `The branch '${refs[0]}' keeps` : `${refs.length} ngb-rescue branches keep`} the history a rebuild abandoned. Once you have checked nothing is lost, delete ${refs.length === 1 ? "it" : "them"} — until then the repair check keeps naming the old objects.`,
      ],
      {
        actions: refs.slice(0, 3).map((r) => ({
          label: `Delete ${r}`,
          onClick: () => void this.cmdDropRescueBackup(r),
        })),
      }
    ).open();
  }

  async cmdDropRescueBackup(ref: string): Promise<void> {
    new ConfirmModal(
      this.app,
      {
        title: "Delete the backup branch?",
        body: [
          `'${ref}' points at the history that was abandoned by the rebuild. Deleting it makes those commits unreachable — check first that everything you need is in your files or already synced.`,
          "Your files and the rebuilt branch are not touched by this.",
        ],
        confirmLabel: "Delete",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("repair-drop-backup", { ref });
        if (!result) return;
        this.absorbStatusData(result.data ?? {});
        if (!result.ok) {
          this.renderMutationError("Native Git: could not delete the backup branch", result);
          return;
        }
        this.log.add("info", "repair-drop-backup", `Deleted backup branch ${ref}.`);
        this.notify(`Backup branch ${ref} deleted.`);
      }
    ).open();
  }

  /** The full-history download always asks first: gigabytes on a phone. */
  private confirmRefetch(missing: string): Promise<boolean> {
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: "Download the whole history?",
          body: [
            "The targeted fetch did not bring these objects back, so the remaining route downloads the repository's entire history again. On a large vault that is the full size of the repository, over this device's current connection.",
            "Nothing local is overwritten by it: the download only ADDS objects.",
            missing,
          ],
          confirmLabel: "Download",
        },
        async (confirmed) => resolve(confirmed)
      ).open();
    });
  }

  /**
   * The exit for damage inside local-only history: rebuild the branch on the
   * remote state. Files on disk are untouched; staged state and the local
   * commit HISTORY collapse into ordinary uncommitted changes, which is why
   * this confirms first and names the backup branch after.
   */
  async cmdRepairResetUpstream(ahead: number): Promise<void> {
    new ConfirmModal(
      this.app,
      {
        title: "Rebuild on the remote state?",
        body: [
          `This moves the branch to what the remote has and rebuilds the index from it. Every file on disk stays exactly as it is — nothing is deleted or reverted — and everything the ${
            ahead > 0 ? `${ahead} local commit${ahead === 1 ? "" : "s"}` : "local history"
          } contained shows up as uncommitted changes, for the next sync to commit once.`,
          "The old history stays reachable under a backup branch, so nothing becomes unrecoverable. The local commit messages are what is lost: the separate commits become one.",
          "Anything currently staged is unstaged by the rebuild.",
        ],
        confirmLabel: "Rebuild",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("repair-reset-upstream");
        if (!result) return;
        this.absorbStatusData(result.data ?? {});
        if (!result.ok) {
          this.renderMutationError("Native Git: could not rebuild on the remote state", result);
          return;
        }
        const d = result.data ?? {};
        const backup = (d.backupRef ?? "").trim();
        this.log.add(
          "info",
          "repair-reset-upstream",
          `Branch rebuilt on the remote state; backup branch ${backup || "?"}.`
        );
        new ResultModal(
          this.app,
          "Branch rebuilt on the remote state",
          [
            "Your files are untouched; what the local commits contained is now uncommitted changes. Run Sync to commit and push it as one commit.",
            `The old history is kept under the branch '${backup}'. Once you have checked nothing is lost, delete it with the button below — the repair check keeps naming its objects until it is gone.`,
          ],
          {
            actions:
              backup !== ""
                ? [
                    {
                      label: "Delete the backup branch",
                      onClick: () => void this.cmdDropRescueBackup(backup),
                    },
                  ]
                : undefined,
          }
        ).open();
      }
    ).open();
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
        if (!result.ok) return this.reportAbortMergeFailure(result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Merge aborted; repository restored.");
      }
    ).open();
  }

  /**
   * `git merge --abort` is `git reset --merge`: it has to put the working tree
   * back, and it cannot do that while the sparse state is out of step with the
   * index — entries under an excluded path with no file on disk. It then fails
   * with a bare "git merge --abort failed", which names neither the cause nor
   * the way out, and the repository is left mid-merge with every pull refusing.
   *
   * Observed on the device: two aborts failed, `sparse-checkout reapply`
   * succeeded, and the next abort went through on the first try.
   *
   * The reapply is OFFERED, never run for the user. It rewrites which files are
   * materialised in the working tree, and this plugin does not repair
   * destructively on its own.
   */
  private reportAbortMergeFailure(result: BridgeResult): void {
    const plan = abortMergeFailure(result);
    if (!plan.offerReapply) {
      return this.renderMutationError("Native Git: abort merge failed", result);
    }
    this.statusBar?.set("error");
    new ResultModal(this.app, "Native Git: abort merge failed", plan.lines, {
      stdout: result.error?.stdout,
      stderr: result.error?.stderr,
      isError: true,
      actions: [
        { label: "Reapply sparse rules", cta: true, onClick: () => void this.cmdReapplySparse() },
      ],
    }).open();
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

  /**
   * `date` is optional because the diff pane reaches this with a commit-ish and
   * nothing else: it offers the file itself when there is no diff to show, and
   * at that point it has a `HEAD`, a hash or a `hash^`, not a log entry.
   */
  private async showFileAtCommit(path: string, hash: string, date?: string): Promise<void> {
    const result = await this.runOperation("show-file-at-commit", { path, commit: hash });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: show file failed", result);
    const bytes = decodeBase64ToBytes(result.data?.contentBase64 ?? "");
    const text = bytesToTextIfNotBinary(bytes);
    const when = date === undefined ? "" : ` · ${date.slice(0, 16).replace("T", " ")}`;
    const meta = `${path} @ ${hash.slice(0, 8)}${when} · ${bytes.length} bytes`;
    if (text === null) {
      new ResultModal(this.app, "Binary file", [
        `${path} at ${hash.slice(0, 8)} is binary (${bytes.length} bytes); preview is not available.`,
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
  private updateProgressInView(text: string | null, detail: string | null = null): void {
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW)) {
      const view = leaf.view;
      if (view instanceof StatusView) view.updateProgressText(text, detail);
    }
    // The history panels show the same state line (they read it back through
    // `progressText()`/`progressDetail()`), so the same tick has to reach them
    // or their copy freezes at whatever second it was rendered on.
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof HistoryView) view.updatePluginProgress();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof FileHistoryView) view.updatePluginProgress();
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
      progressDetail: this.progressDetail ?? undefined,
      runningAction: this.runningAction ?? undefined,
      runningPath: this.runningPath ?? undefined,
      treeView: this.sharedPrefs.treeView,
      rowsPerGroup: this.deviceSettings.rowsPerGroup,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? undefined,
      fetchedAt: this.lastStatus?.fetchedAt,
      bridge: this.deviceSettings.termuxIntegrationEnabled ? "companion app" : "disabled",
    };
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof StatusView) {
        // `statusStale` is the same honesty as the branch below, for the other
        // way of not knowing: an operation FAILED, or timed out, or was
        // cancelled, and brought no fresh status back. The repository moved
        // under the panel and nobody has looked since. Rendering the last
        // summary then states a repository that may no longer exist — after a
        // failed sync it announced a clean tree over files that had just
        // stopped it.
        if (this.lastStatus)
          view.setData({
            ...summaryToViewData(this.lastStatus.status, extra, state),
            statusLoaded: !this.statusStale,
          });
        else
          view.setData({
            // No status has been read, so the empty lists below are "not
            // asked", not "nothing there", and the panel is told which. It used
            // to render this as Clean with a working tree clean line and ↑0 ↓0,
            // which on a device sitting in an unfinished merge was a clean bill
            // of health for a repository with six conflicts in it.
            statusLoaded: false,
            state: this.progressText ? "syncing" : "unknown",
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
    // Anything in [RUNNER_MIN_VERSION, RUNNER_SHIPPED_VERSION] is a correct
    // installation. Comparing against the floor instead branded every
    // up-to-date runner "newer than expected" — 0.6.3 shipped runner v13 with
    // a floor of 12, so every correctly installed device saw a red warning.
    if (this.lastRunnerVersion > 0 && this.lastRunnerVersion < RUNNER_MIN_VERSION) {
      out.push({
        part: "runner",
        text: `The Termux runner (v${this.lastRunnerVersion}) is older than this plugin needs (v${RUNNER_MIN_VERSION}). Re-run the install command in Termux — updating the plugin never updates the runner.`,
      });
    } else if (this.lastRunnerVersion > RUNNER_SHIPPED_VERSION) {
      out.push({
        part: "runner",
        text: `The Termux runner (v${this.lastRunnerVersion}) is NEWER than this plugin knows (it ships v${RUNNER_SHIPPED_VERSION}). Update the plugin from the latest release.`,
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
    this.openTermux();
  }

  /** Open the latest release page (companion APK + plugin files live there). */
  openLatestRelease(): void {
    this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_RELEASES_URL);
  }

  /** Copy the install command, then bring Termux to the front (via the companion). */
  copyCommandAndOpenTermux(): void {
    void navigator.clipboard.writeText(this.installCommand());
    new Notice("Install command copied - long-press in Termux to paste, then Enter.");
    this.openTermux();
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
    // The facts behind the verdict — folder, profile, queue, pairing — are
    // evidence, not instructions. They belong under the fold: when something is
    // wrong they are the next thing to read, and when nothing is wrong they are
    // six lines of noise between the answer and the way out of the window.
    const facts = [
      `Runtime folder (as the plugin sees it): ${paths.root}`,
      `Profile for this vault: ${report.profileId || "none yet"}${
        report.markerProfileId && report.markerProfileId !== report.profileId
          ? ` (the runner wrote ${report.markerProfileId} here)`
          : ""
      }`,
      `Runner has written into THIS vault's runtime folder: ${report.runnerLogExists ? "yes" : "NO"}`,
      `Queued requests: ${report.queuedRequests.length}${report.queuedRequests.length ? " (" + report.queuedRequests.join(", ") + ")" : ""}`,
      `Pairing file waiting: ${report.pairingFilePresent ? "yes" : "no"}`,
    ];
    if (!report.ok) lines.push("", ...facts);
    for (const a of this.versionAdvice()) lines.push("", a.text);
    this.log.add(report.ok ? "info" : "warn", "self-check", report.verdict);

    // One-tap fixes instead of prose. Which buttons appear depends on what the
    // plugin actually knows: the companion reports whether Termux is installed
    // in every ack; no ack ever means the companion itself is the suspect.
    //
    // NONE of them when the bridge is fine. A button reads as a thing to do,
    // and "Copy command & open Termux" under a verdict that says nothing is
    // wrong sends the user to reinstall a runner that is working. The only
    // exception is a runner the log shows to be outdated, which is a real
    // fault wearing a healthy folder.
    const actions: ResultModalAction[] = [];
    if (Platform.isAndroidApp && (!report.ok || outdated || this.versionAdvice().length > 0)) {
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
          onClick: () => this.openTermux(),
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
    // The cause is the title. It used to open with "Bridge check" and bury the
    // one sentence that matters six lines down, under prose the reader had to
    // finish before learning whether anything was wrong at all.
    new ResultModal(this.app, report.headline, lines, {
      stdout: report.ok
        ? [...facts, "", report.runnerLogTail].join("\n").trimEnd() || undefined
        : report.runnerLogTail || undefined,
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
    this.discardPath(folderPath, group);
  }

  /**
   * Group-header buttons. "Stage" in the tracked-changes group must not sweep
   * in untracked files, so it stages the repository root in `update` mode; the
   * untracked group uses a plain add.
   *
   * Discard has to branch on the group, which it did not: it always ran the
   * repository-wide discard, and that command keeps untracked files by design.
   * So the Untracked group's own "delete the new files" entry ran an operation
   * that deletes none of them, under a confirmation that said as much.
   */
  groupAction(group: Group, kind: "stage" | "unstage" | "discard"): void {
    if (kind === "unstage") {
      void this.cmdUnstageAll();
      return;
    }
    if (kind === "discard") {
      if (group === "untracked") {
        this.confirmDeleteUntracked("Every new file in the repository.", this.untrackedUnder(null));
      } else {
        this.cmdDiscardAll();
      }
      return;
    }
    // Stage exactly the group, which is not what this did. "Untracked" ran
    // `stage-all` (`git add -A`), so tapping + on the new files also staged
    // every tracked modification in the Changes group beside it. The new files
    // are few entries even when they hold thousands of files, because git
    // collapses an untracked directory, so one request per entry is cheap.
    if (group === "untracked") {
      void this.stageEntries(this.untrackedUnder(null));
      return;
    }
    // `git add -u .`: tracked modifications only, which is what this group
    // holds. Staging exactly this group needs stage-file to accept a list of
    // paths in one request, which is a runner change; until then the group's
    // + is repo-wide over tracked changes.
    void this.cmdStageFile(".", "update");
  }

  /** Stage a handful of paths, one request each, stopping at the first failure. */
  private async stageEntries(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      this.notify("Nothing to stage: no new files.");
      return;
    }
    for (const p of paths) {
      const result = await this.runOperation("stage-file", {
        path: p.endsWith("/") ? p.slice(0, -1) : p,
        mode: "all",
        protectedPaths: this.effectiveProtectedPaths(),
      });
      if (!result) return;
      if (!result.ok) return this.renderMutationError("Native Git: stage failed", result);
      this.absorbStatusData(result.data ?? {});
    }
    this.notify(`Staged ${paths.length} new entr${paths.length === 1 ? "y" : "ies"}.`);
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
        // One warning and one refresh after the loop, not one per path.
        for (const p of paths) await this.gitignoreAdd(`/${p}`, false);
        this.notify(`Added ${paths.length} paths to .gitignore.`);
        this.warnIfRuleTargetsTracked(paths);
        await this.refreshAfterRuleChange();
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
          // standalone=false: the warning and the status refresh happen once
          // below, not once per path on top of every exclude round trip.
          else await this.cmdExcludeChange(p, true, false);
        }
        this.notify(`Applied to ${paths.length} paths.`);
        // Sparse hides tracked files too (skip-worktree), so only the exclude
        // kind can silently target something a rule cannot hide.
        if (kind === "exclude") this.warnIfRuleTargetsTracked(paths);
        await this.cmdStatus(true);
      }
    ).open();
  }

  /**
   * The one route that deletes untracked content, whatever the scope.
   *
   * There used to be three, and they disagreed. A folder row in tree layout
   * moved its files to Obsidian's trash; the same row in list layout went
   * through the runner and unlinked them; a single file row unlinked; and the
   * group menu entry called the repository-wide discard, which keeps untracked
   * files, so it deleted nothing at all while saying it would. Reversibility is
   * not something a user should have to infer from which layout they picked.
   *
   * `targets` are untracked entries as git reported them, so a whole untracked
   * directory travels as one entry and its contents are not enumerated here.
   */
  private confirmDeleteUntracked(scopeLine: string, targets: string[]): void {
    if (targets.length === 0) {
      this.notify("Nothing to delete: no new files in that scope.");
      return;
    }
    const permanent = this.deviceSettings.deleteUntrackedPermanently;
    const many = targets.length !== 1;
    const count = `${targets.length} untracked entr${many ? "ies" : "y"}`;
    new ConfirmModal(
      this.app,
      {
        title: permanent ? "Delete new files?" : "Move new files to trash?",
        body: [
          scopeLine,
          permanent
            ? `${count} will be deleted from disk. Nothing Git has recorded is touched, and this cannot be undone: a file Git never saw is in no history.`
            : `${count} will move to Obsidian's trash (.trash in the vault), so this is reversible from there.`,
          ...targets.slice(0, 8),
          many && targets.length > 8 ? `…and ${targets.length - 8} more` : "",
        ].filter((l) => l !== ""),
        confirmLabel: permanent ? "Delete from disk" : "Move to trash",
        icon: "trash",
        danger: true,
      },
      async (confirmed) => {
        if (!confirmed) return;
        if (permanent) {
          // The runner deletes the untracked files under each entry; it never
          // does a blind recursive remove. One request per entry, and an entry
          // is a whole untracked directory, so this is not one per file.
          for (const t of targets) {
            const result = await this.runOperation("discard-file", {
              path: t.endsWith("/") ? t.slice(0, -1) : t,
              protectedPaths: this.effectiveProtectedPaths(),
            });
            if (!result) return;
            if (!result.ok) return this.renderMutationError("Native Git: delete failed", result);
            this.absorbStatusData(result.data ?? {});
          }
          this.notify(`Deleted ${count}.`);
          return;
        }
        let moved = 0;
        for (const t of targets) {
          const p = t.endsWith("/") ? t.slice(0, -1) : t;
          try {
            await this.app.vault.adapter.trashLocal(p);
            moved += 1;
          } catch (e) {
            this.log.add("error", "discard-file", `Trash failed for ${p}: ${String(e)}`);
          }
        }
        this.notify(
          moved === targets.length
            ? `Moved ${count} to the trash.`
            : `Moved ${moved} of ${targets.length} untracked entries to the trash; the rest are in the operation log.`
        );
        await this.cmdStatus(true);
      }
    ).open();
  }

  /**
   * The single decision behind every "discard" control in the panel and its
   * menus, at file and folder scope: untracked content is deleted (reversibly
   * unless the device says otherwise), tracked content goes back to what is
   * committed. One place decides, so a row button, a context-menu entry and a
   * folder row can no longer disagree the way they did.
   */
  discardPath(path: string, group: Group): void {
    if (group === "untracked") {
      this.confirmDeleteUntracked(`Path: ${path}`, this.untrackedUnder(path));
      return;
    }
    this.cmdDiscardFile(path);
  }

  /** Untracked entries git reported at or under `path`; `null` for all of them. */
  private untrackedUnder(path: string | null): string[] {
    const st = this.lastStatus?.status;
    if (!st) return [];
    return untrackedTargets(st.untracked, path);
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

/**
 * The action a progress stream belongs to, taken from the stream itself.
 *
 * Every one opens with `<action> started`, written by the runner, so the output
 * panel can label an earlier operation without the plugin having to remember
 * anything about requests that finished hours ago — or in another session.
 */
export function streamAction(text: string): string | null {
  const first = text.split("\n", 1)[0]?.trim() ?? "";
  const word = first.split(/\s+/, 1)[0];
  // A line that does not look like a request id or an action name is not one:
  // a stream trimmed from the front (the bundle does that) can start mid-word.
  if (word === undefined || word === "" || !/^[a-z][a-z-]*$/.test(word)) return null;
  return word;
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
