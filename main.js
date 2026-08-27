/*
Obsidian Native Git Bridge - bundled output.
*/
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  abortMergeFailure: () => abortMergeFailure,
  compareVersions: () => compareVersions,
  default: () => NativeGitBridgePlugin,
  failureDetail: () => failureDetail,
  streamAction: () => streamAction
});
module.exports = __toCommonJS(main_exports);
var import_obsidian15 = require("obsidian");

// src/constants.ts
var PLUGIN_ID = "native-git-bridge";
var PROTOCOL_VERSION = 1;
var RUNNER_MIN_VERSION = 12;
var RUNNER_SHIPPED_VERSION = 17;
var COMPANION_MIN_VERSION = "0.4.1";
var EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var DEFAULT_PROTECTED_PATHS = [];
var RUNTIME_DIR_NAME = "runtime";
var REQUESTS_DIR = "requests";
var RESULTS_DIR = "results";
var CANCEL_DIR = "cancel";
var DONE_DIR = "done";
var PROGRESS_DIR = "progress";
var POLL_INTERVAL_MS = 400;
var DEFAULT_TIMEOUT_SECONDS = 90;
var ACTION_TIMEOUT_SECONDS = {
  // 3600, raised from 900 at the user's instruction: a full clone of a real
  // vault outlives fifteen minutes on a phone connection, and the interactive
  // credential route adds the time a person takes to paste the command and
  // answer git's prompts. The runner's own NGB_CLONE_TIMEOUT matches.
  "clone-into-vault": 3600,
  "adopt-remote": 900,
  // The repair steps. Each ends with `git fsck --connectivity-only`, which is
  // minutes on a vault of real size, so none of them fits the ordinary 90 s.
  // The two fetch steps get the clone-sized budget: the refetch downloads the
  // whole history, and the targeted fetch is cheap on the wire but still pays
  // for the fsck that verifies it.
  "repair-scan": 600,
  "repair-fetch-missing": 900,
  "repair-refetch": 900,
  "repair-reset-upstream": 300,
  // Storage maintenance. The repack rewrites every reachable object into one
  // pack, which on a multi-gigabyte object database is tens of minutes of CPU
  // on a phone — the longest budget in the file, and honestly so. Prune is
  // I/O-bound and cheap next to it; the scan is one count-objects.
  "maintenance-scan": 300,
  "maintenance-prune": 600,
  "maintenance-repack": 3600,
  // Footprint changes. Shallowing transfers almost nothing (the history is
  // already here); unshallow and partial-disable download history or content
  // wholesale; partial-enable may shed and prefetch, both long on a real vault.
  "repo-shallow": 900,
  "repo-unshallow": 1800,
  "repo-partial-enable": 1800,
  "repo-partial-disable": 1800
};
var NETWORK_ACTIONS = /* @__PURE__ */ new Set(["fetch", "pull", "push", "sync"]);
var MIN_NETWORK_TIMEOUT_SECONDS = 120;
function timeoutSecondsFor(action, settingSeconds) {
  const fixed = ACTION_TIMEOUT_SECONDS[action];
  if (fixed !== void 0) return fixed;
  const base = Number.isFinite(settingSeconds) && settingSeconds > 0 ? Math.floor(settingSeconds) : DEFAULT_TIMEOUT_SECONDS;
  return NETWORK_ACTIONS.has(action) ? Math.max(base, MIN_NETWORK_TIMEOUT_SECONDS) : base;
}
var RESULT_RETENTION_MS = 24 * 60 * 60 * 1e3;
var STALE_LOCK_MS = 30 * 60 * 1e3;
var DISPLAY_OUTPUT_LIMIT = 100 * 1024;
var LOG_MAX_ENTRIES = 200;
var LONG_OPERATION_SECONDS = 30;
var SPARSE_SAFETY_WARNING = "Sparse checkout safety check failed. The excluded directories appear as Git changes. No commit or push was performed.";
var STORAGE_PREFIX = "ngb:v1";
var REPO_URL = "https://github.com/maxkalem/obsidian-native-git-bridge";
function bootstrapCommand(pluginVersion, repoPathHint) {
  const base = /^\d+\.\d+\.\d+$/.test(pluginVersion) ? `${REPO_URL}/releases/download/${pluginVersion}` : `${REPO_URL}/releases/latest/download`;
  const cmd = `curl -fsSL ${base}/bootstrap.sh | NGB_VERSION=${pluginVersion} bash -s --`;
  return repoPathHint ? `${cmd} "${repoPathHint}"` : cmd;
}
function bootstrapCommandLocal(vaultPath, configDir) {
  const base = `${vaultPath}/${configDir}/plugins/${PLUGIN_ID}/termux`;
  return `bash "${base}/bootstrap.sh" "${vaultPath}"`;
}
var PAIRING_FILE = "pairing.json";
var CLAIM_FILE = "claim.json";
var PROFILE_MARKER_FILE = "profile.json";
var PAIRING_WAIT_MS = 2e4;
var COMPANION_SETUP_URI = "nativegitbridge://setup";
var COMPANION_RELEASES_URL = "https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest";
var COMPANION_OPEN_TERMUX_URI = "nativegitbridge://open-termux";
var COMPANION_DOWNLOAD_APK_URI = "nativegitbridge://download-apk";
function releaseTagUrl(version) {
  return `https://github.com/maxkalem/obsidian-native-git-bridge/releases/tag/${version}`;
}
var TERMUX_SITE_URL = "https://termux.dev";
var TERMUX_FDROID_URL = "https://f-droid.org/packages/com.termux/";
var COMPANION_GET_TERMUX_URI = "nativegitbridge://get-termux";
var RUNNER_OUTDATED_HINT = "The Termux runner script is outdated. Updating the plugin does not update it \u2014 re-run the install command in Termux (Settings -> Native Git Bridge -> Copy command & open Termux, or the 'Set up Termux' button in the companion app).";

// src/types.ts
var ACTION_MIN_RUNNER = /* @__PURE__ */ new Map([
  ["sparse-exclude-add", 4],
  ["sparse-exclude-remove", 4],
  ["exclude-add", 4],
  ["exclude-remove", 4],
  ["exclude-list", 4],
  ["repo-log", 5],
  ["resolve-conflict", 6],
  ["discard-all", 8],
  ["reset-all", 8],
  ["init-repo", 11],
  ["set-remote", 11],
  ["clone-into-vault", 11],
  ["adopt-remote", 11],
  ["abort-rebase", 11],
  ["continue-rebase", 11],
  ["unstage-protected", 11],
  ["apply-patch", 12],
  ["repair-scan", 13],
  ["repair-fetch-missing", 13],
  ["repair-refetch", 13],
  ["repair-reset-upstream", 13],
  ["repair-drop-backup", 13],
  ["untrack-file", 14],
  ["maintenance-scan", 14],
  ["maintenance-prune", 14],
  ["maintenance-repack", 14],
  ["repo-shallow", 14],
  ["repo-unshallow", 14],
  ["repo-partial-enable", 14],
  ["repo-partial-disable", 14],
  ["repair-stale-lock", 15],
  ["repair-sparse-definition", 16],
  ["identity-drop-global", 16],
  ["cred-helper-local-reset", 16],
  ["repair-triage", 16]
]);
var MUTATING_ACTIONS = /* @__PURE__ */ new Set([
  "sparse-reapply",
  "pull",
  "commit",
  "push",
  "sync",
  "restore-file",
  "abort-merge",
  "repair-scan",
  "repair-fetch-missing",
  "repair-refetch",
  "repair-reset-upstream",
  "repair-drop-backup",
  "stage-file",
  "unstage-file",
  "discard-file",
  "stage-all",
  "unstage-all",
  "resolve-conflict",
  "discard-all",
  "reset-all",
  "init-repo",
  "set-remote",
  "clone-into-vault",
  "adopt-remote",
  "abort-rebase",
  "continue-rebase",
  "unstage-protected",
  "apply-patch",
  "untrack-file",
  "maintenance-prune",
  "maintenance-repack",
  "repo-shallow",
  "repo-unshallow",
  "repo-partial-enable",
  "repo-partial-disable",
  "repair-stale-lock",
  "repair-sparse-definition",
  "identity-drop-global",
  "cred-helper-local-reset"
]);

// src/settings/DeviceLocalSettingsStore.ts
var ROWS_PER_GROUP_CHOICES = [10, 20, 30, 50, 100, 250, 1e3];
var DEFAULT_ROWS_PER_GROUP_SETTING = 30;
var DIFF_LIMIT_CHOICES_KB = [50, 100, 200, 500, 1024];
var DEFAULT_DIFF_LIMIT_KB = 100;
var DIFF_LIMIT_ABSOLUTE_MAX_KB = 4096;
var CURRENT_SCHEMA_VERSION = 1;
var DEFAULT_DEVICE_SETTINGS = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  enabledOnThisDevice: false,
  termuxIntegrationEnabled: false,
  repoPathHint: "",
  authToken: "",
  profileId: "",
  protectedPaths: [...DEFAULT_PROTECTED_PATHS],
  derivedProtectedPaths: [],
  autoProtectSparse: true,
  opTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  onOpenAction: "nothing",
  autoSyncOnClose: false,
  periodicSyncMinutes: 0,
  minAutoSyncIntervalMinutes: 15,
  wifiOnly: false,
  skipOnLowBattery: false,
  companionUriTemplate: "nativegitbridge://run?id={id}",
  showSuccessModals: false,
  notificationMode: "notice",
  suppressObsidianGitWarning: false,
  menuGitignore: true,
  menuSparse: true,
  menuExclude: true,
  deleteUntrackedPermanently: false,
  rowsPerGroup: DEFAULT_ROWS_PER_GROUP_SETTING,
  recentCommitMessagesMax: 10,
  statusRefreshSeconds: 0,
  diffLimitKb: DEFAULT_DIFF_LIMIT_KB,
  previousRepoRemindedAt: 0,
  previousRepoDismissed: [],
  shallowDepth: 100,
  partialOfferShown: false
};
var DeviceLocalSettingsStore = class {
  constructor(backend, scopeId) {
    this.backend = backend;
    this.scopeId = scopeId;
    this.memory = /* @__PURE__ */ new Map();
    this.volatile = false;
    if (!backend) this.volatile = true;
  }
  get isVolatile() {
    return this.volatile;
  }
  key(suffix2 = "settings") {
    return `${STORAGE_PREFIX}:${this.scopeId}:${suffix2}`;
  }
  rawGet(key) {
    if (!this.volatile && this.backend) {
      try {
        return this.backend.getItem(key);
      } catch {
        this.volatile = true;
      }
    }
    return this.memory.get(key) ?? null;
  }
  rawSet(key, value) {
    if (!this.volatile && this.backend) {
      try {
        this.backend.setItem(key, value);
        return;
      } catch {
        this.volatile = true;
      }
    }
    this.memory.set(key, value);
  }
  rawRemove(key) {
    if (!this.volatile && this.backend) {
      try {
        this.backend.removeItem(key);
      } catch {
        this.volatile = true;
      }
    }
    this.memory.delete(key);
  }
  /** Read settings, merging defaults and migrating older schemas. */
  read() {
    const raw = this.rawGet(this.key());
    if (raw === null) return freshDefaults();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.rawSet(this.key("corrupt"), raw);
      return freshDefaults();
    }
    return this.migrate(parsed);
  }
  /** Shallow-merge a patch and persist; returns the new settings. */
  write(patch) {
    const next = { ...this.read(), ...patch, schemaVersion: CURRENT_SCHEMA_VERSION };
    this.rawSet(this.key(), JSON.stringify(next));
    return next;
  }
  reset() {
    this.rawRemove(this.key());
  }
  /** Migration entry point; extend per schema bump. */
  migrate(parsed) {
    const obj = typeof parsed === "object" && parsed !== null ? parsed : {};
    const merged = {
      ...freshDefaults(),
      ...pickKnown(obj),
      schemaVersion: CURRENT_SCHEMA_VERSION
    };
    if (!Array.isArray(merged.protectedPaths) || merged.protectedPaths.some((p) => typeof p !== "string")) {
      merged.protectedPaths = [...DEFAULT_PROTECTED_PATHS];
    }
    if (!Array.isArray(merged.derivedProtectedPaths) || merged.derivedProtectedPaths.some((p) => typeof p !== "string")) {
      merged.derivedProtectedPaths = [];
    }
    if (!Array.isArray(merged.previousRepoDismissed) || merged.previousRepoDismissed.some((p) => typeof p !== "string")) {
      merged.previousRepoDismissed = [];
    }
    return merged;
  }
  /** Generic scoped value access for auxiliary device-local state (log, operation markers). */
  getValue(suffix2) {
    return this.rawGet(this.key(suffix2));
  }
  setValue(suffix2, value) {
    this.rawSet(this.key(suffix2), value);
  }
  removeValue(suffix2) {
    this.rawRemove(this.key(suffix2));
  }
};
function freshDefaults() {
  return { ...DEFAULT_DEVICE_SETTINGS, protectedPaths: [...DEFAULT_DEVICE_SETTINGS.protectedPaths] };
}
function pickKnown(obj) {
  const out = {};
  for (const k of Object.keys(DEFAULT_DEVICE_SETTINGS)) {
    const defVal = DEFAULT_DEVICE_SETTINGS[k];
    if (k in obj && typeof obj[k] === typeof defVal && Array.isArray(obj[k]) === Array.isArray(defVal)) {
      out[k] = obj[k];
    }
  }
  return out;
}

// src/settings/SettingsTab.ts
var import_obsidian3 = require("obsidian");

// src/settings/pathValidation.ts
function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 31 || c === 127) return true;
  }
  return false;
}
function validateRepoRelativePath(input) {
  if (typeof input !== "string") return { ok: false, reason: "Not a string." };
  let p = input.trim();
  if (p === "") return { ok: false, reason: "Empty path." };
  if (hasControlChars(p)) return { ok: false, reason: "Control characters are not allowed." };
  p = p.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) return { ok: false, reason: "Absolute (drive) paths are not allowed." };
  if (p.startsWith("/")) return { ok: false, reason: "Absolute paths are not allowed." };
  if (p.startsWith("~")) return { ok: false, reason: "Home-relative paths are not allowed." };
  if (p.startsWith(":")) return { ok: false, reason: "Paths must not start with ':' (git pathspec magic)." };
  p = p.replace(/\/{2,}/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/\/+$/, "");
  if (p === "" || p === ".") return { ok: false, reason: "Path resolves to the repository root." };
  const segments = p.split("/");
  if (segments.some((s) => s === "..")) return { ok: false, reason: "Path traversal ('..') is not allowed." };
  if (segments.some((s) => s === "")) return { ok: false, reason: "Empty path segment." };
  if (segments.some((s) => s.toLowerCase() === ".git"))
    return { ok: false, reason: "Paths inside .git are not allowed." };
  return { ok: true, normalized: p };
}
function validateProtectedPaths(inputs) {
  const out = [];
  for (const raw of inputs) {
    const r = validateRepoRelativePath(raw);
    if (!r.ok) return { ok: false, reason: r.reason, offending: raw };
    if (!out.includes(r.normalized)) out.push(r.normalized);
  }
  return { ok: true, normalized: out };
}
function isValidRequestId(s) {
  return /^r-[0-9A-Za-z.TZ:-]{1,64}$/.test(s) && !s.includes("..");
}

// src/ui/modals.ts
var import_obsidian2 = require("obsidian");

// src/ui/copyable.ts
var import_obsidian = require("obsidian");
function addCopyButton(parent, getText, label2 = "Copy", noticeText = "Copied to clipboard.") {
  const btn = parent.createEl("button", { cls: "ngb-copy-btn" });
  const iconEl = btn.createSpan();
  (0, import_obsidian.setIcon)(iconEl, "copy");
  btn.createSpan({ text: ` ${label2}` });
  btn.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(getText());
        new import_obsidian.Notice(noticeText);
      } catch {
        new import_obsidian.Notice("Could not access the clipboard.");
      }
    })();
  });
  return btn;
}

// src/git/parsers.ts
function unquoteGitPath(raw) {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  const bytes = [];
  const enc = new TextEncoder();
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c !== "\\") {
      for (const b of enc.encode(c)) bytes.push(b);
      i++;
      continue;
    }
    const n = inner[i + 1];
    if (n === void 0) break;
    const simple = {
      a: 7,
      b: 8,
      f: 12,
      n: 10,
      r: 13,
      t: 9,
      v: 11,
      "\\": 92,
      '"': 34
    };
    if (simple[n] !== void 0) {
      bytes.push(simple[n]);
      i += 2;
      continue;
    }
    if (n >= "0" && n <= "7") {
      let oct = "";
      let j = i + 1;
      while (j < inner.length && oct.length < 3) {
        const d = inner[j];
        if (d < "0" || d > "7") break;
        oct += d;
        j++;
      }
      bytes.push(parseInt(oct, 8) & 255);
      i = j;
      continue;
    }
    for (const b of enc.encode(n)) bytes.push(b);
    i += 2;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}
function parseStatusPorcelainV2(text) {
  const s = {
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: []
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    if (line.startsWith("# branch.oid ")) {
      const v = line.slice("# branch.oid ".length);
      if (v !== "(initial)") s.oid = v;
    } else if (line.startsWith("# branch.head ")) {
      const v = line.slice("# branch.head ".length);
      if (v === "(detached)") s.detached = true;
      else s.branch = v;
    } else if (line.startsWith("# branch.upstream ")) {
      s.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        s.ahead = parseInt(m[1], 10);
        s.behind = parseInt(m[2], 10);
      }
    } else if (line.startsWith("1 ")) {
      const parts = splitN(line, " ", 8);
      if (parts.length === 9) {
        const xy = parts[1];
        pushEntry(s, {
          path: unquoteGitPath(parts[8]),
          index: xy[0] ?? ".",
          worktree: xy[1] ?? "."
        });
      }
    } else if (line.startsWith("2 ")) {
      const parts = splitN(line, " ", 9);
      if (parts.length === 10) {
        const xy = parts[1];
        const [p, orig] = parts[9].split("	");
        pushEntry(s, {
          path: unquoteGitPath(p ?? ""),
          origPath: orig !== void 0 ? unquoteGitPath(orig) : void 0,
          index: xy[0] ?? ".",
          worktree: xy[1] ?? "."
        });
      }
    } else if (line.startsWith("u ")) {
      const parts = splitN(line, " ", 10);
      if (parts.length === 11) {
        const xy = parts[1];
        s.conflicted.push({
          path: unquoteGitPath(parts[10]),
          index: xy[0] ?? ".",
          worktree: xy[1] ?? "."
        });
      }
    } else if (line.startsWith("? ")) {
      s.untracked.push(unquoteGitPath(line.slice(2)));
    }
  }
  return s;
}
function groupUntrackedChildren(childrenText, untracked) {
  const dirs = untracked.filter((u) => u.endsWith("/"));
  const out = {};
  if (dirs.length === 0) return out;
  for (const rawLine of childrenText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    const dir = dirs.find((d) => line.startsWith(d));
    if (dir === void 0) continue;
    if (line === dir) continue;
    (out[dir] ??= []).push(line);
  }
  return out;
}
function pushEntry(s, e) {
  if (e.index !== ".") s.staged.push(e);
  if (e.worktree !== ".") s.unstaged.push(e);
}
function splitN(line, sep, n) {
  const out = [];
  let rest = line;
  for (let k = 0; k < n; k++) {
    const idx = rest.indexOf(sep);
    if (idx < 0) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  out.push(rest);
  return out;
}
function parseStatusPorcelainV1(text) {
  const entries = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let rest = line.slice(3);
    let orig;
    if (x === "R" || x === "C") {
      const arrow = rest.indexOf(" -> ");
      if (arrow >= 0) {
        orig = unquoteGitPath(rest.slice(0, arrow));
        rest = rest.slice(arrow + 4);
      }
    }
    entries.push({
      path: unquoteGitPath(rest),
      origPath: orig,
      index: x === " " ? "." : x,
      worktree: y === " " ? "." : y
    });
  }
  return entries;
}
function parseNameStatus(text) {
  const entries = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    const parts = line.split("	");
    const code = parts[0] ?? "";
    const kind = code[0] ?? "?";
    if ((kind === "R" || kind === "C") && parts.length >= 3) {
      entries.push({
        path: unquoteGitPath(parts[2]),
        origPath: unquoteGitPath(parts[1]),
        index: kind,
        worktree: "."
      });
    } else if (parts.length >= 2) {
      entries.push({ path: unquoteGitPath(parts[1]), index: kind, worktree: "." });
    }
  }
  return entries;
}
function countSkipWorktree(text) {
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("S ")) n++;
  }
  return n;
}
function sparseExclusionPaths(patterns) {
  const out = [];
  for (const raw of patterns) {
    let p = raw.trim();
    if (!p.startsWith("!")) continue;
    p = p.slice(1).trim();
    if (p.startsWith("/")) p = p.slice(1);
    p = p.replace(/\/+$/, "");
    if (p === "" || /[*?[\]]/.test(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
function parseSparseState(fields) {
  const enabled = fields.sparseEnabled.trim() === "true";
  const coneRaw = fields.sparseCone.trim();
  return {
    enabled,
    coneMode: coneRaw === "" ? void 0 : coneRaw === "true",
    patterns: fields.sparseList.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
    skipWorktreeCount: resolveSkipCount(fields.skipWorktreeCount, fields.lsFilesV)
  };
}
function resolveSkipCount(count, lsFilesV) {
  if (count !== void 0 && count.trim() !== "") {
    const n = parseInt(count.trim(), 10);
    if (!Number.isNaN(n)) return n;
  }
  return countSkipWorktree(lsFilesV ?? "");
}
function parseLastCommit(text) {
  const line = text.split("\n")[0]?.trim();
  if (!line) return void 0;
  const [hash, date, ...subj] = line.split("	");
  if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) return void 0;
  return { hash, date: date ?? "", subject: subj.join("	") };
}

// src/git/sparseSafety.ts
var STATUS_LABEL = {
  D: "deleted",
  M: "modified",
  A: "added",
  R: "renamed",
  C: "copied",
  T: "type-changed",
  U: "unmerged",
  "?": "untracked"
};
function label(code) {
  return STATUS_LABEL[code] ?? `changed (${code})`;
}
function worktreeLabel(index, worktree) {
  if (index === worktree) return label(index);
  if (index !== "." && worktree === "D") return `${label(index)} to the index, missing from the worktree`;
  if (index !== "." && worktree !== ".") return `${label(index)} (index), ${label(worktree)} (worktree)`;
  return label(index !== "." ? index : worktree);
}
function evaluateSparseSafety(statusProtectedRaw, stagedProtectedRaw, protectedPaths, now = /* @__PURE__ */ new Date()) {
  const violations = [];
  for (const e of parseStatusPorcelainV1(statusProtectedRaw)) {
    violations.push({
      path: e.path,
      status: worktreeLabel(e.index, e.worktree),
      source: "worktree",
      index: e.index,
      worktree: e.worktree
    });
  }
  for (const e of parseNameStatus(stagedProtectedRaw)) {
    violations.push({ path: e.path, status: label(e.index), source: "staged", index: e.index });
  }
  return {
    safe: violations.length === 0,
    violations,
    protectedPaths: [...protectedPaths],
    checkedAt: now.toISOString()
  };
}
function planSparseRepair(report) {
  const byPath = /* @__PURE__ */ new Map();
  for (const v of report.violations) {
    const list = byPath.get(v.path);
    if (list) list.push(v);
    else byPath.set(v.path, [v]);
  }
  const plan = { trash: [], unstage: [], blocked: [], resolveToHead: [] };
  for (const [path, vs] of byPath) {
    const untracked = vs.some((v) => v.index === "?" || v.worktree === "?");
    const indexCodes = vs.map((v) => v.index).filter((c) => c !== void 0);
    const worktreeOnly = vs.some(
      (v) => v.source === "worktree" && v.index === "." && v.worktree !== "." && v.worktree !== "?"
    );
    const unmerged = vs.some(
      (v) => v.index === "U" || v.worktree === "U" || v.index === "A" && v.worktree === "A" || v.index === "D" && v.worktree === "D"
    );
    const tracked = indexCodes.some((c) => c !== "?" && c !== "." && c !== "A") || !untracked && worktreeOnly;
    if (unmerged) {
      plan.resolveToHead.push(path);
      continue;
    }
    if (tracked) {
      plan.blocked.push({
        path,
        reason: "tracked in the last commit \u2014 removing it here would create the staged deletion this check blocks"
      });
      continue;
    }
    const inIndex = indexCodes.includes("A");
    const wt = vs.find((v) => v.source === "worktree");
    const onDisk = untracked || wt !== void 0 && wt.worktree !== "D";
    if (onDisk) plan.trash.push(path);
    if (inIndex) plan.unstage.push(path);
    if (!onDisk && !inIndex) {
      plan.blocked.push({ path, reason: "not on disk and not in the index \u2014 resolve it in Termux" });
    }
  }
  return plan;
}

// src/ui/modals.ts
function placeModalAction(modal, opts) {
  const b = modal.modalEl.createEl("button", {
    cls: `ngb-modal-action ${opts.danger ? "mod-warning" : "mod-cta"}`
  });
  const ic = b.createSpan({ cls: "ngb-modal-action-icon" });
  (0, import_obsidian2.setIcon)(ic, opts.icon);
  b.createSpan({ text: opts.label });
  b.setAttribute("aria-label", opts.label);
  b.addEventListener("click", opts.onClick);
  if (import_obsidian2.Platform.isMobile && opts.hasInput === true) {
    modal.modalEl.addClass("ngb-modal-keyboard-safe");
  }
  const wrap = modal.contentEl.createDiv({ cls: "ngb-buttons ngb-modal-action-bottom" });
  wrap.appendChild(b);
  return b;
}
function outputSection(el, label2, text) {
  if (!text || text.trim() === "") return;
  const details = el.createEl("details", { cls: "ngb-details" });
  details.createEl("summary", { text: label2 });
  const box = details.createDiv({ cls: "ngb-output" });
  const shown = text.length > DISPLAY_OUTPUT_LIMIT ? text.slice(0, DISPLAY_OUTPUT_LIMIT) + "\n\u2026 (truncated; full output in runner.log)" : text;
  box.createEl("pre", { text: shown });
}
function renderFileBadge(parent, badge) {
  if (badge === null) {
    const warn = parent.createSpan({ cls: "ngb-badge ngb-badge-conflict" });
    (0, import_obsidian2.setIcon)(warn, "alert-triangle");
    warn.setAttribute("aria-label", "Merge conflict");
    return warn;
  }
  return parent.createSpan({ cls: "ngb-badge", text: badge });
}
function linkifyInto(parent, text) {
  const re = /https?:\/\/[^\s)"']+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parent.appendText(text.slice(last, i));
    parent.createEl("a", { href: m[0], text: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) parent.appendText(text.slice(last));
}
var ResultModal = class extends import_obsidian2.Modal {
  constructor(app, title, lines, opts = {}) {
    super(app);
    this.title = title;
    this.lines = lines;
    this.opts = opts;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    const sec = c.createDiv({ cls: "ngb-section" });
    for (const line of this.lines) {
      const div = sec.createDiv({ cls: this.opts.isError ? "ngb-status-error" : "" });
      linkifyInto(div, line);
    }
    if (this.opts.collapsed) outputSection(c, this.opts.collapsed.label, this.opts.collapsed.text);
    if (this.opts.actions && this.opts.actions.length > 0) {
      const fixes = c.createDiv({ cls: "ngb-buttons ngb-action-buttons" });
      for (const a of this.opts.actions) {
        const b = fixes.createEl("button", { text: a.label, cls: a.cta ? "mod-cta" : "" });
        b.addEventListener("click", () => {
          a.onClick();
          if (!a.keepOpen) this.close();
        });
      }
    }
    outputSection(c, "stdout", this.opts.stdout);
    outputSection(c, "stderr", this.opts.stderr);
    const btns = c.createDiv({ cls: "ngb-buttons" });
    addCopyButton(btns, () => this.fullText(), "Copy details", "Details copied.");
  }
  fullText() {
    const parts = [this.title, ...this.lines];
    if (this.opts.collapsed) parts.push("", `--- ${this.opts.collapsed.label} ---`, this.opts.collapsed.text);
    if (this.opts.stdout) parts.push("", "--- stdout ---", this.opts.stdout);
    if (this.opts.stderr) parts.push("", "--- stderr ---", this.opts.stderr);
    return parts.join("\n");
  }
  onClose() {
    this.contentEl.empty();
    this.opts.onDismiss?.();
  }
};
var ConfirmModal = class extends import_obsidian2.Modal {
  constructor(app, opts, onDecision) {
    super(app);
    this.opts = opts;
    this.onDecision = onDecision;
    this.decided = false;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.opts.title);
    const c = this.contentEl;
    for (const line of this.opts.body) linkifyInto(c.createEl("p"), line);
    placeModalAction(this, {
      label: this.opts.confirmLabel,
      icon: this.opts.icon ?? "check",
      danger: this.opts.danger,
      onClick: () => {
        this.decided = true;
        this.close();
        void this.onDecision(true);
      }
    });
  }
  onClose() {
    if (!this.decided) void this.onDecision(false);
    this.contentEl.empty();
  }
};
var ChangedFilesModal = class extends import_obsidian2.Modal {
  constructor(app, status, fetchedAt) {
    super(app);
    this.status = status;
    this.fetchedAt = fetchedAt;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git: changed files");
    const c = this.contentEl;
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Branch ${this.status.branch ?? "(detached)"} \xB7 \u2191${this.status.ahead} \u2193${this.status.behind} \xB7 as of ${this.fetchedAt}`
    });
    const groups = [
      ["Conflicted", this.status.conflicted.map((e) => ({ path: e.path, badge: null }))],
      ["Staged", this.status.staged.map((e) => ({ path: e.path, badge: e.index }))],
      ["Unstaged", this.status.unstaged.map((e) => ({ path: e.path, badge: e.worktree }))],
      ["Untracked", this.status.untracked.map((p) => ({ path: p, badge: "?" }))]
    ];
    let any = false;
    for (const [name, items] of groups) {
      if (items.length === 0) continue;
      any = true;
      const sec = c.createDiv({ cls: "ngb-section" });
      sec.createEl("h3", { text: `${name} (${items.length})` });
      const ul = sec.createEl("ul", { cls: "ngb-file-list" });
      for (const it of items) {
        const li = ul.createEl("li");
        renderFileBadge(li, it.badge);
        li.createSpan({ cls: "ngb-badge-path", text: it.path });
      }
    }
    if (!any) c.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SparseSafetyModal = class extends import_obsidian2.Modal {
  constructor(app, report, warningText, fixes) {
    super(app);
    this.report = report;
    this.warningText = warningText;
    this.fixes = fixes;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Sparse checkout safety check");
    const c = this.contentEl;
    if (this.report.safe) {
      c.createEl("p", {
        cls: "ngb-ok",
        text: "Safe: no protected sparse path appears as a Git change."
      });
    } else {
      c.createDiv({ cls: "ngb-warning", text: this.warningText });
      const ul = c.createEl("ul", { cls: "ngb-file-list" });
      for (const v of this.report.violations) {
        ul.createEl("li", { text: `${v.path} \u2014 ${v.status} (${v.source})` });
      }
      c.createEl("p", {
        cls: "ngb-settings-note",
        text: "Nothing is repaired automatically. The two fixes below are the usual ones; 'Run diagnostics' inspects the sparse state, and anything else is resolved in Termux."
      });
      this.renderFixes(c);
    }
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Protected paths: ${this.report.protectedPaths.join(", ")} \xB7 checked ${this.report.checkedAt}`
    });
  }
  /**
   * The two recoveries that actually apply here, side by side. Both stay on
   * one row on a phone: equal flex widths, small type, labels truncated
   * rather than wrapped, and the detail spelled out underneath instead of in
   * the button.
   */
  renderFixes(c) {
    if (!this.fixes) return;
    const plan = planSparseRepair(this.report);
    const allPaths = [...new Set(this.report.violations.map((v) => v.path))];
    const dirs = this.report.protectedPaths.filter(
      (p) => allPaths.some((f) => f === p || f.startsWith(`${p}/`))
    );
    const repairable = plan.trash.length + plan.unstage.length;
    if (repairable === 0 && dirs.length === 0) {
      if (plan.blocked.length > 0) this.renderBlockedNote(c, plan);
      return;
    }
    const row = c.createDiv({ cls: "ngb-fix-row" });
    if (repairable > 0) {
      const label2 = this.repairLabel(plan);
      const b = row.createEl("button", { cls: "ngb-fix-btn mod-warning", text: label2 });
      b.setAttribute(
        "aria-label",
        `Clear ${repairable} blocking path${repairable === 1 ? "" : "s"} out of the way`
      );
      b.addEventListener("click", () => {
        this.close();
        this.fixes?.repair(plan);
      });
    }
    if (dirs.length > 0) {
      const b = row.createEl("button", { cls: "ngb-fix-btn", text: "Unprotect path" });
      b.setAttribute("aria-label", `Remove ${dirs.join(", ")} from the sparse exclusions`);
      b.addEventListener("click", () => {
        this.close();
        this.fixes?.unprotect(dirs);
      });
    }
    const notes = [];
    if (plan.trash.length > 0) {
      notes.push(
        `${plan.trash.length} file${plan.trash.length === 1 ? "" : "s"} go to Obsidian's trash (reversible; git history untouched).`
      );
    }
    if (plan.unstage.length > 0) {
      notes.push(
        `${plan.unstage.length} entr${plan.unstage.length === 1 ? "y is" : "ies are"} removed from the index only \u2014 those are staged additions with no file on disk, which deleting alone cannot clear. Nothing committed is touched.`
      );
    }
    if (dirs.length > 0) {
      notes.push(
        `Unprotect: removes ${dirs.join(", ")} from the sparse exclusions, so it is checked out and committed like any other directory.`
      );
    }
    c.createDiv({ cls: "ngb-settings-note", text: notes.join(" ") });
    if (plan.blocked.length > 0) this.renderBlockedNote(c, plan);
  }
  /** Button text names what will actually happen, not a fixed verb. */
  repairLabel(plan) {
    if (plan.trash.length === 0) return "Remove from index";
    if (plan.unstage.length === 0) return "Delete files locally";
    return "Delete and unstage";
  }
  /**
   * The paths the plugin will not repair, and why. Listed rather than dropped:
   * silently offering a button that covers three of five paths is how "the
   * check still blocks after the fix" happens.
   */
  renderBlockedNote(c, plan) {
    const d = c.createDiv({ cls: "ngb-settings-note" });
    d.createDiv({
      text: `${plan.blocked.length} path${plan.blocked.length === 1 ? "" : "s"} cannot be repaired from here:`
    });
    const ul = d.createEl("ul", { cls: "ngb-file-list" });
    for (const b of plan.blocked.slice(0, 12)) ul.createEl("li", { text: `${b.path} \u2014 ${b.reason}` });
    if (plan.blocked.length > 12) {
      ul.createEl("li", { text: `\u2026and ${plan.blocked.length - 12} more` });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var StatusModal = class extends import_obsidian2.Modal {
  constructor(app, data) {
    super(app);
    this.data = data;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git: status");
    const c = this.contentEl;
    const kv = c.createDiv({ cls: "ngb-kv" });
    const row = (k, v) => {
      kv.createDiv({ cls: "k", text: k });
      kv.createDiv({ text: v });
    };
    const s = this.data.status;
    if (s) {
      row("Branch", s.detached ? "(detached)" : s.branch ?? "?");
      row("Upstream", s.upstream ?? "\u2014");
      row("Ahead / behind", `${s.ahead} / ${s.behind}`);
      row("Staged", String(s.staged.length));
      row("Unstaged", String(s.unstaged.length));
      row("Untracked", String(s.untracked.length));
      row("Conflicted", String(s.conflicted.length));
    } else {
      row("Status", "not fetched yet");
    }
    if (this.data.lastCommit) {
      row(
        "Last commit",
        `${this.data.lastCommit.hash.slice(0, 8)} \xB7 ${this.data.lastCommit.subject}`
      );
    }
    const sp = this.data.sparse;
    if (sp) {
      row("Sparse checkout", sp.enabled ? "enabled" : "disabled");
      row("Sparse mode", sp.coneMode === void 0 ? "\u2014" : sp.coneMode ? "cone" : "non-cone");
      row("Sparse patterns", String(sp.patterns.length));
      row("Skip-worktree entries", String(sp.skipWorktreeCount));
    }
    row("Bridge", this.data.bridgeAvailable);
    row("Active operation", this.data.activeOperation ?? "none");
    row("Last successful sync", this.data.lastSyncAt ?? "never");
    if (this.data.fetchedAt) row("Fetched", this.data.fetchedAt);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TextPreviewModal = class extends import_obsidian2.Modal {
  constructor(app, title, meta, text) {
    super(app);
    this.title = title;
    this.meta = meta;
    this.text = text;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    c.createDiv({ cls: "ngb-settings-note", text: this.meta });
    const box = c.createDiv({ cls: "ngb-diff-view ngb-diff-wrap ngb-preview-view" });
    const tbody = box.createDiv({ cls: "d2h-code-wrapper" }).createEl("table", { cls: "d2h-diff-table" }).createEl("tbody", { cls: "d2h-diff-tbody" });
    const body = this.text.endsWith("\n") ? this.text.slice(0, -1) : this.text;
    const lines = body === "" ? [] : body.split("\n");
    lines.forEach((line, i) => {
      const tr = tbody.createEl("tr");
      const gutter = tr.createEl("td", { cls: "d2h-code-linenumber d2h-cntx" });
      gutter.createDiv({ cls: "line-num1", text: String(i + 1) });
      const code = tr.createEl("td", { cls: "d2h-cntx" }).createDiv({ cls: "d2h-code-line" });
      code.createSpan({ cls: "d2h-code-line-ctn", text: line.replace(/\r$/, "") });
    });
    box.style.setProperty("--ngb-diff-gutter-w", `${String(lines.length).length + 2}ch`);
    if (lines.length === 0) {
      box.createEl("p", { cls: "ngb-settings-note", text: "This version of the file is empty." });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/colors.ts
var DEFAULT_COLORS = {
  dark: {
    diffAddBg: "#1e4620",
    diffAddHl: "#2f8f2f",
    diffDelBg: "#4a1f22",
    diffDelHl: "#AA1414",
    conflictLocalBg: "#14361f",
    conflictRemoteBg: "#12283f"
  },
  light: {
    diffAddBg: "#d7f5d7",
    diffAddHl: "#7fd07f",
    diffDelBg: "#ffd9dc",
    diffDelHl: "#AA1414",
    conflictLocalBg: "#e6f7ec",
    conflictRemoteBg: "#e3eefb"
  }
};
var DIFF_COLOR_VARS = [
  "--ngb-diff-ins-bg",
  "--ngb-diff-ins-hl",
  "--ngb-diff-del-bg",
  "--ngb-diff-del-hl"
];
var CONFLICT_COLOR_VARS = [
  "--ngb-conf-ours-bg",
  "--ngb-conf-theirs-bg",
  "--ngb-diff-del-hl",
  "--ngb-diff-ins-hl"
];
function diffColorVars(set) {
  return {
    "--ngb-diff-ins-bg": set.diffAddBg,
    "--ngb-diff-ins-hl": set.diffAddHl,
    "--ngb-diff-del-bg": set.diffDelBg,
    "--ngb-diff-del-hl": set.diffDelHl
  };
}
function conflictColorVars(set) {
  return {
    "--ngb-conf-ours-bg": set.conflictLocalBg,
    "--ngb-conf-theirs-bg": set.conflictRemoteBg,
    "--ngb-diff-del-hl": set.diffDelHl,
    "--ngb-diff-ins-hl": set.diffAddHl
  };
}
var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function sanitizeColorSet(raw, mode) {
  const base = DEFAULT_COLORS[mode];
  const out = { ...base };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw;
  for (const k of Object.keys(base)) {
    const v = r[k];
    if (typeof v === "string" && HEX.test(v)) out[k] = v;
  }
  return out;
}

// src/git/previousRepos.ts
var PREVIOUS_GIT_PREFIX = "previous-git-";
var DIR_RE = /^previous-git-\d{8}T\d{6}Z$/;
function isPreviousRepoDir(name) {
  return DIR_RE.test(name);
}
function parsePreviousRepo(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  if (typeof r.dir !== "string" || !isPreviousRepoDir(r.dir)) return null;
  const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const str = (v) => typeof v === "string" ? v : "";
  return {
    dir: r.dir,
    createdAt: str(r.createdAt),
    sizeKb: num(r.sizeKb),
    commits: num(r.commits),
    branch: str(r.branch),
    lastCommit: str(r.lastCommit)
  };
}
function formatSize(sizeKb) {
  if (sizeKb <= 0) return "unknown size";
  if (sizeKb < 1024) return `${sizeKb} KB`;
  const mb = sizeKb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
function describePreviousRepo(r, now = /* @__PURE__ */ new Date()) {
  const parts = [formatSize(r.sizeKb)];
  if (r.commits > 0) parts.push(`${r.commits} commit${r.commits === 1 ? "" : "s"}`);
  if (r.branch) parts.push(r.branch);
  const days = daysSince(r.createdAt, now);
  if (days !== null) parts.push(days === 0 ? "set aside today" : `set aside ${days} day${days === 1 ? "" : "s"} ago`);
  return parts.join(" \xB7 ");
}
function daysSince(iso, now = /* @__PURE__ */ new Date()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 864e5));
}
var REMIND_INTERVAL_MS = 24 * 60 * 60 * 1e3;
function reposToRemindAbout(repos, state, now = Date.now()) {
  if (now - state.lastRemindedAt < REMIND_INTERVAL_MS) return [];
  return repos.filter((r) => !state.dismissed.includes(r.dir));
}

// src/git/commitMessage.ts
var DEFAULT_COMMIT_TEMPLATE = "Update {{date}}";
var DEFAULT_COMMIT_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";
function formatCommitDate(fmt, d) {
  const p2 = (n) => String(n).padStart(2, "0");
  return fmt.replace(/YYYY/g, String(d.getFullYear())).replace(/YY/g, p2(d.getFullYear() % 100)).replace(/MM/g, p2(d.getMonth() + 1)).replace(/DD/g, p2(d.getDate())).replace(/HH/g, p2(d.getHours())).replace(/mm/g, p2(d.getMinutes())).replace(/ss/g, p2(d.getSeconds()));
}
function renderCommitTemplate(template, fmt, now = /* @__PURE__ */ new Date()) {
  return template.split("{{date}}").join(formatCommitDate(fmt, now));
}
function pushRecentMessage(recents, msg, max) {
  const m = msg.trim();
  const capped = Math.max(0, max);
  if (m === "") return recents.slice(0, capped);
  return [m, ...recents.filter((r) => r !== m)].slice(0, capped);
}

// src/settings/SettingsTab.ts
var NativeGitBridgeSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // ------------------------------------------------ collapsible rule managers
    /**
     * Which sections the user has expanded. Add/remove actions re-render the
     * whole tab (display()), which would otherwise collapse every <details>
     * back to its default state — remembering titles here keeps them open.
     */
    this.openSections = /* @__PURE__ */ new Set();
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.deviceSettings;
    if (!import_obsidian3.Platform.isAndroidApp) {
      containerEl.createDiv({
        cls: "ngb-warning",
        text: "Native Git Bridge works on Android only: it delegates every Git operation to the real git binary inside Termux, triggered through a companion app. There is nothing to configure on this device \u2014 on desktop, use git directly or the obsidian-git plugin. Settings appear when you open this tab on your Android device (they are stored per device and never synced through the vault)."
      });
      return;
    }
    const advice = this.plugin.versionAdvice();
    const stale = (part) => advice.some((a) => a.part === part);
    const badge = (text, part) => ver.createSpan({
      cls: stale(part) ? "ngb-version-badge ngb-version-stale" : "ngb-version-badge",
      text
    });
    const ver = containerEl.createDiv({ cls: "ngb-version-row" });
    badge(`Plugin ${this.plugin.manifest.version}`, "plugin");
    const rv = this.plugin.lastRunnerVersion;
    badge(
      rv === 0 ? `Runner: unknown` : rv < RUNNER_MIN_VERSION ? `Runner v${rv} (needs v${RUNNER_MIN_VERSION})` : `Runner v${rv}`,
      "runner"
    );
    badge(
      this.plugin.lastCompanionVersion !== "" ? `Companion ${this.plugin.lastCompanionVersion}` : "Companion: not seen yet",
      "companion"
    );
    for (const a of advice) {
      const box = containerEl.createDiv({ cls: "ngb-warning" });
      box.createDiv({ text: a.text });
      const btns = box.createDiv({ cls: "ngb-add-row" });
      const button = (text, cta, onClick) => {
        const b = btns.createEl("button", { text, cls: cta ? "mod-cta" : void 0 });
        b.addEventListener("click", onClick);
      };
      if (a.part === "runner") {
        button("Copy command & open Termux", true, () => this.plugin.copyCommandAndOpenTermux());
        if (a.kind === "newer-half") {
          button("Open latest release", false, () => this.plugin.openLatestRelease());
        }
      } else if (a.part === "companion") {
        button("Update companion app", true, () => this.plugin.openLatestRelease());
        if (a.kind === "update-available" && this.plugin.stayOnCompanionAvailable()) {
          button("Stay on this companion\u2026", false, () => this.plugin.cmdStayOnCompanion());
        }
      } else {
        button("Open latest release", true, () => this.plugin.openLatestRelease());
        if (a.kind === "newer-half") {
          button("Copy link to the matching APK", false, () => this.plugin.copyMatchingApkLink());
        }
      }
    }
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "All settings below are stored on this device only (never synced through the vault), so each device can be enabled and configured independently."
    });
    if (this.plugin.store.isVolatile) {
      containerEl.createDiv({
        cls: "ngb-warning",
        text: "Device-local storage is unavailable; settings will not survive an app restart. Check available storage / WebView state."
      });
    }
    new import_obsidian3.Setting(containerEl).setName("Setup (one line in Termux)").setHeading();
    const cmd = this.plugin.installCommand();
    const cmdBox = containerEl.createDiv({ cls: "ngb-cmd" });
    cmdBox.setText(cmd);
    cmdBox.setAttribute("aria-label", "Install command");
    new import_obsidian3.Setting(containerEl).setName("Install command").setDesc(
      "Install Termux (F-Droid) and the Git Bridge Companion app, then paste this single command into Termux. It finds your vault automatically, installs git/jq/openssh, links storage, enables the companion trigger, verifies the repo and pairs with this plugin \u2014 no manual token copying. The Companion app has a 'Set up Termux' button that copies this command and opens Termux for you."
    ).addButton(
      (b) => (
        // Copying alone left the user to find Termux themselves; the plugin
        // method copies, notices, and brings Termux forward (or the way to
        // GET it when the companion reports it missing).
        b.setButtonText("Copy command & open Termux").setCta().onClick(
          () => this.plugin.copyCommandAndOpenTermux()
        )
      )
    );
    const localCmd = this.plugin.installCommandLocal();
    if (localCmd !== null) {
      const localBox = containerEl.createDiv({ cls: "ngb-cmd" });
      localBox.setText(localCmd);
      localBox.setAttribute("aria-label", "Offline install command");
      new import_obsidian3.Setting(containerEl).setName("Install without a network").setDesc(
        "The Termux scripts ship inside this plugin's folder, so the vault on this device already carries them. This command installs and updates the runner from there \u2014 no GitHub, no downloads. Useful on a bad connection, and when the runner is behind after the plugin arrived through vault sync."
      ).addButton(
        (b) => b.setButtonText("Copy offline command & open Termux").onClick(
          () => this.plugin.copyLocalCommandAndOpenTermux()
        )
      );
    }
    new import_obsidian3.Setting(containerEl).setName("Setup guide").setDesc(
      "The three parts in order (Termux, companion app, one pasted command) with the current state of this device and one-tap actions."
    ).addButton(
      (b) => b.setButtonText("Open setup guide").setCta().onClick(() => this.plugin.openSetupGuide("Setup guide."))
    );
    new import_obsidian3.Setting(containerEl).setName("Companion app checklist").setDesc(
      "Opens the Git Bridge Companion setup screen: Termux detected, 'Run commands in Termux' permission, and a live round-trip test. Open it whenever operations time out."
    ).addButton(
      (b) => b.setButtonText("Open companion setup").onClick(() => void this.plugin.openCompanionSetup())
    );
    new import_obsidian3.Setting(containerEl).setName("Enable on this device").setDesc("Master switch. Off by default on every new device.").addToggle(
      (t) => t.setValue(s.enabledOnThisDevice).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ enabledOnThisDevice: v });
          this.refreshTab();
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Termux integration").setDesc("Allow this plugin to queue requests for the Termux runner.").addToggle(
      (t) => t.setValue(s.termuxIntegrationEnabled).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ termuxIntegrationEnabled: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Pairing token").setDesc(
      "Paste the token printed by the Termux installer. It authenticates requests between this plugin and the runner. Stored locally; never logged."
    ).addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("token from installer").setValue(s.authToken).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ authToken: v.trim() });
        })();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Profile for this vault").setDesc(
      s.profileId ? `Termux serves this vault as ${s.profileId}. Every vault on the device has its own profile and its own token; one runner drains them all.` : "This vault has no Termux profile yet. Pairing asks the runner for one; it generates the token in Termux and answers with it."
    ).addButton(
      (b) => b.setButtonText(s.profileId ? "Pair again" : "Pair this vault").onClick(() => void this.plugin.cmdPairThisVault())
    );
    new import_obsidian3.Setting(containerEl).setName("Repository for this vault").setDesc(
      "Create a repository here, clone an existing one into this vault, or change the remote. Everything that needs a password stays in Termux; this only does the parts that carry no secret."
    ).addButton(
      (b) => b.setButtonText("Set up repository").onClick(() => void this.plugin.cmdSetupRepository())
    );
    this.renderPreviousReposSetting(containerEl);
    new import_obsidian3.Setting(containerEl).setName("Repository path (informational)").setDesc("The repo path as seen from Termux, e.g. /storage/emulated/0/Documents/Vault. The runner config is authoritative.").addText(
      (t) => t.setValue(s.repoPathHint).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ repoPathHint: v.trim() });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Repository rules").setHeading();
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "Sparse exclusions, .gitignore and .git/info/exclude, managed per item. Each section is collapsed because these lists can get long."
    });
    this.renderProtectedPathsSection(containerEl, s);
    this.renderSparseSection(containerEl);
    this.renderGitignoreSection(containerEl);
    this.renderExcludeSection(containerEl);
    new import_obsidian3.Setting(containerEl).setName("File context menu").setHeading();
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "Which Git entries appear on right click / long tap of a file or folder. Stage/Unstage is always shown while the bridge is enabled."
    });
    new import_obsidian3.Setting(containerEl).setName("Show .gitignore commands").setDesc("Add to / remove from .gitignore (shared, synced through git).").addToggle(
      (t) => t.setValue(s.menuGitignore).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ menuGitignore: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show sparse commands").setDesc("Hide on this device / show again (sparse checkout exclusions).").addToggle(
      (t) => t.setValue(s.menuSparse).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ menuSparse: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show .git exclude commands").setDesc("Add to / remove from .git/info/exclude (this clone only, never synced).").addToggle(
      (t) => t.setValue(s.menuExclude).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ menuExclude: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Rows shown per group").setDesc(
      "How many rows the status panel draws in each group before it offers the rest. Every group can be long at once, and a folder of a few thousand new files arrives as one Git entry that expands into a row each. The group's count always states the true total. Device-local: what it costs is render time here."
    ).addDropdown((d) => {
      for (const n of ROWS_PER_GROUP_CHOICES) d.addOption(String(n), String(n));
      d.setValue(String(s.rowsPerGroup)).onChange((v) => {
        void (async () => {
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) return;
          await this.plugin.updateDeviceSettings({ rowsPerGroup: n });
        })();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Delete new files permanently").setDesc(
      "Off: deleting untracked files moves them to Obsidian's trash (.trash in the vault), which is the only way back for a file Git never recorded. On: they are deleted from disk. Device-local, because what it decides is whether .trash grows on this device."
    ).addToggle(
      (t) => t.setValue(s.deleteUntrackedPermanently).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ deleteUntrackedPermanently: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Commit messages").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Message templates").setDesc(
      "One per line; offered as one-tap choices in the commit window. {{date}} becomes the current date and time in this device's timezone, using the format below. Shared across devices (stored in data.json)."
    ).addTextArea((t) => {
      t.setValue(this.plugin.sharedPrefs.commitTemplates.join("\n")).onChange((v) => {
        void (async () => {
          const list = v.split("\n").map((x) => x.trim()).filter((x) => x !== "");
          await this.plugin.setSharedPref({ commitTemplates: list });
        })();
      });
      t.inputEl.rows = 3;
    });
    new import_obsidian3.Setting(containerEl).setName("Automatic commit message").setDesc(
      "What Sync commits with when you did not type a message. A merge in progress always uses git's own prepared merge message instead. Shared across devices."
    ).addText(
      (t) => t.setValue(this.plugin.sharedPrefs.autoCommitTemplate).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({
            autoCommitTemplate: v.trim() === "" ? DEFAULT_COMMIT_TEMPLATE : v
          });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("{{date}} format").setDesc(
      "Tokens: YYYY, YY, MM, DD, HH, mm, ss (the same spelling obsidian-git uses). Local time on each device. Shared across devices."
    ).addText(
      (t) => t.setValue(this.plugin.sharedPrefs.commitDateFormat).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({
            commitDateFormat: v.trim() === "" ? DEFAULT_COMMIT_DATE_FORMAT : v
          });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Recently typed messages to remember").setDesc(
      "The commit window offers this many of your recent messages beside the templates. 0 turns the list off. The list is typing history and stays on this device."
    ).addText(
      (t) => t.setValue(String(s.recentCommitMessagesMax)).onChange((v) => {
        void (async () => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= 0 && n <= 50) {
            await this.plugin.updateDeviceSettings({ recentCommitMessagesMax: n });
          }
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Notifications").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Show a result window on success").setDesc(
      "Off: successful operations only update the status panel (and the log). Failures, conflicts and safety blocks are always shown as a window."
    ).addToggle(
      (t) => t.setValue(s.showSuccessModals).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ showSuccessModals: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Short messages").setDesc(
      "Where brief informational messages go. Note: a plugin cannot raise native Android toasts, so the choices are Obsidian's own notice, the status panel, or the log only."
    ).addDropdown(
      (d) => d.addOption("notice", "Obsidian notice (toast)").addOption("status-only", "Status panel only").addOption("log-only", "Operation log only").setValue(s.notificationMode).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({
            notificationMode: v
          });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Name the file above the Git menu").setDesc(
      "Show the folder and the file name at the top of the Git context menu, above the entries. On by default: a panel row truncates the name and the file explorer shows no path at all, so without it the menu can offer 'Discard changes' over a file it never identifies. A deep path costs two or three rows. Cosmetic and shared across devices (stored in data.json)."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.showMenuHeader).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ showMenuHeader: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Spell the change out in the status panel").setDesc(
      "Show 'modified', 'conflicted' or 'deleted' beside a file name. On by default. Mobile only \u2014 on desktop the tooltip carries it \u2014 and the change letter at the end of the row states it either way, so turning this off gives long names more room. Cosmetic and shared across devices (stored in data.json)."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.showChangeWords).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ showChangeWords: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Open the output panel for long operations").setDesc(
      "Show what Termux is saying, by itself, once an operation has run for 30 seconds. Off by default: a panel that appears on its own takes a slot in the sidebar while you are reading something else. Either way, tapping the state line in the Git panel (the one that counts the seconds) opens it. Cosmetic and shared across devices."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.openOutputForLongOps).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ openOutputForLongOps: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Wrap long lines").setDesc(
      "Wrap lines in the diff and conflict panes instead of scrolling horizontally. In the conflict pane the line numbers and the Keep buttons stay pinned to the left edge while the text scrolls, so no control can end up out of reach. Cosmetic and shared across devices (stored in data.json)."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.wrapDiffLines).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ wrapDiffLines: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show invisible characters in diffs").setDesc(
      "Render whitespace as glyphs in the diff pane: \xB7 space, \u2192 tab, \u240D CR. Makes leading/trailing whitespace visible. Note: copying from the diff then copies the glyphs, not the original whitespace."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.showInvisibles).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ showInvisibles: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Compare changed lines by").setDesc(
      "What gets highlighted inside a line that changed, in the diff pane, the file history and the conflict pane. Words suit prose: 'brown' becoming 'red' is one word replaced. Characters suit paths, identifiers and numbers, where one letter is the whole edit."
    ).addDropdown(
      (d) => d.addOption("word", "Words").addOption("char", "Characters").setValue(this.plugin.sharedPrefs.inlineDiffUnit).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ inlineDiffUnit: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Keep line selection when opening another file").setDesc(
      "The diff pane is reused for every diff. Off: opening another file leaves line-selection mode, so a diff never arrives already in it. On: the mode stays. The ticked lines are dropped either way \u2014 they point at lines of the diff that was on screen."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.keepLineSelection).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ keepLineSelection: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show raw conflict markers").setDesc(
      "In the conflict pane: show the file's <<<<<<< / ======= / >>>>>>> lines as they really are, with the side labels and Keep buttons on separate rows. Off: the markers stay hidden under those rows."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.showConflictMarkers).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ showConflictMarkers: v });
        })();
      })
    );
    this.renderColorSection(containerEl);
    new import_obsidian3.Setting(containerEl).setName("Diff size limit").setDesc(
      "How much of one diff the pane builds at a time. The runner keeps whole hunks within the limit and never a partial one, and the pane says how many it left out, with a one-tap way to fetch the rest for that diff alone. Every diff line costs about a dozen elements to draw, so this is a per-phone decision and stays device-local."
    ).addDropdown((d) => {
      for (const kb of DIFF_LIMIT_CHOICES_KB) {
        d.addOption(String(kb), kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`);
      }
      d.setValue(String(s.diffLimitKb)).onChange((v) => {
        void (async () => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n <= 0) return;
          await this.plugin.updateDeviceSettings({ diffLimitKb: n });
        })();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Auto-refresh status (seconds)").setDesc(
      "While the status panel is open, run a status this often to pick up outside changes. 0 disables it. Each refresh wakes Termux \u2014 consider battery before choosing a small interval. Device-local."
    ).addText((t) => {
      t.inputEl.inputMode = "numeric";
      t.setPlaceholder("0").setValue(String(s.statusRefreshSeconds)).onChange((v) => {
        void (async () => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 0) return;
          await this.plugin.updateDeviceSettings({ statusRefreshSeconds: n });
          this.plugin.restartStatusPoll();
        })();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Repository footprint (this device)").setHeading();
    const fp = this.plugin.footprintState();
    const fpNote = !this.plugin.footprintAvailable() ? "Needs runner v14 on this device. Update the runner in Termux, then run Status once." : fp === null ? "The repository's state has not been read yet this session \u2014 a toggle checks it first, then asks to confirm." : "";
    if (fpNote !== "") {
      containerEl.createEl("p", { text: fpNote, cls: "setting-item-description" });
    }
    new import_obsidian3.Setting(containerEl).setName("Shallow history").setDesc(
      "Keep only the newest commits on this device; the remote and your other devices keep everything. The history panels here reach only what stays, and enabling this also clears this device's reflog \u2014 without that the old commits stay pinned and nothing is freed. Turning it off downloads the full history back. Space returns after Clean up repository storage."
    ).addToggle((t) => {
      t.setValue(fp?.shallow ?? false).setDisabled(!this.plugin.footprintAvailable()).onChange((v) => {
        void (async () => {
          if (v) await this.plugin.cmdShallowEnable();
          else await this.plugin.cmdUnshallow();
          this.refreshTab();
        })();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Shallow depth").setDesc("How many newest commits stay when shallow history is enabled. Takes effect on the next enable.").addText((t) => {
      t.inputEl.inputMode = "numeric";
      t.setPlaceholder("100").setValue(String(s.shallowDepth)).onChange((v) => {
        void (async () => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 1 || n > 1e5) return;
          await this.plugin.updateDeviceSettings({ shallowDepth: n });
        })();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Partial clone (blob:none)").setDesc(
      "Fetch file content on demand instead of holding all of it. With sparse checkout the hidden files' content is never downloaded at all \u2014 but 'Show again' and old file versions then need the network. Turning it off downloads everything back first. Run Clean up repository storage after enabling to shed content that is already downloaded."
    ).addToggle((t) => {
      t.setValue(fp?.partial ?? false).setDisabled(!this.plugin.footprintAvailable()).onChange((v) => {
        void (async () => {
          if (v) await this.plugin.cmdPartialEnable();
          else await this.plugin.cmdPartialDisable();
          this.refreshTab();
        })();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Automatic actions").setHeading();
    new import_obsidian3.Setting(containerEl).setName("When Obsidian opens").setDesc(
      "Pull brings work in and changes nothing you have not seen. Sync also commits and pushes, so on every launch it publishes whatever is lying around \u2014 including the workspace file Obsidian rewrites just by being opened. Nothing is the default."
    ).addDropdown(
      (d) => d.addOption("nothing", "Nothing").addOption("pull", "Pull").addOption("sync", "Sync (commit and push too)").setValue(s.onOpenAction).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({
            onOpenAction: v
          });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Sync when Obsidian closes / goes to background").setDesc("Queues a sync request during the close transition; Termux may finish it after Obsidian is gone.").addToggle(
      (t) => t.setValue(s.autoSyncOnClose).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ autoSyncOnClose: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Periodic sync while Obsidian is open (minutes, 0 = off)").addText(
      (t) => t.setValue(String(s.periodicSyncMinutes)).onChange((v) => {
        void (async () => {
          const n = Math.max(0, Math.floor(Number(v) || 0));
          await this.plugin.updateDeviceSettings({ periodicSyncMinutes: n });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Minimum interval between automatic syncs (minutes)").addText(
      (t) => t.setValue(String(s.minAutoSyncIntervalMinutes)).onChange((v) => {
        void (async () => {
          const n = Math.max(1, Math.floor(Number(v) || 15));
          await this.plugin.updateDeviceSettings({ minAutoSyncIntervalMinutes: n });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Only sync on Wi-Fi (best effort)").setDesc("Uses the WebView network API when available; skipped silently when the API is missing.").addToggle(
      (t) => t.setValue(s.wifiOnly).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ wifiOnly: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Skip automatic sync when battery is low (best effort)").addToggle(
      (t) => t.setValue(s.skipOnLowBattery).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ skipOnLowBattery: v });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Advanced").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Operation log").setDesc(
      "Recent bridge operations (URLs redacted). Lives here since the panel strip slot went to the tree/list toggle; also available as the 'Open operation log' command."
    ).addButton(
      (b) => b.setButtonText("Open").onClick(() => this.plugin.openOperationLog())
    );
    new import_obsidian3.Setting(containerEl).setName("Operation timeout (seconds)").setDesc(
      `How long to wait for the runner before giving up. Default ${DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds}. Fetch, pull, push and sync never get less than ${MIN_NETWORK_TIMEOUT_SECONDS}s whatever is set here, and cloning has its own much larger budget: those wait for a network, not for git. Giving up does not stop the runner \u2014 it finishes what it started, and a result that lands later is picked up \u2014 so a short value buys nothing but alarming windows.`
    ).addText(
      (t) => t.setValue(String(s.opTimeoutSeconds)).onChange((v) => {
        void (async () => {
          const n = Math.min(3600, Math.max(10, Math.floor(Number(v) || DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds)));
          await this.plugin.updateDeviceSettings({ opTimeoutSeconds: n });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Companion intent URI template").setDesc('Advanced. "{id}" is replaced by the request id; change it only if the companion app uses a custom scheme.').addText(
      (t) => t.setValue(s.companionUriTemplate).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ companionUriTemplate: v.trim() });
        })();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Reset device-local settings").setDesc("Restores all settings on this device to defaults. The vault and repository are not touched.").addButton(
      (b) => b.setButtonText("Reset").setDestructive().onClick(() => {
        new ConfirmModal(
          this.app,
          {
            title: "Reset device-local settings?",
            body: [
              "This resets Native Git Bridge settings on this device only.",
              "The repository, the vault, and other devices are not affected."
            ],
            confirmLabel: "Reset settings",
            danger: true
          },
          async (confirmed) => {
            if (!confirmed) return;
            await this.plugin.resetDeviceSettings();
            this.refreshTab();
          }
        ).open();
      })
    );
  }
  /**
   * Re-render the whole tab. `update()` is the 1.13+ entry point; `display()`
   * remains as the fallback for older builds (and is what this tab implements).
   */
  refreshTab() {
    const anyThis = this;
    if (typeof anyThis.update === "function") anyThis.update();
    else this.display();
  }
  /** Collapsible <details> block with a title; open state survives re-renders. */
  detailsSection(containerEl, title, hint) {
    const det = containerEl.createEl("details", { cls: "ngb-details" });
    if (this.openSections.has(title)) det.setAttribute("open", "");
    det.addEventListener("toggle", () => {
      if (det.hasAttribute("open")) this.openSections.add(title);
      else this.openSections.delete(title);
    });
    const sum = det.createEl("summary");
    sum.createSpan({ text: title });
    const hintEl = sum.createSpan({ cls: "ngb-details-hint", text: hint });
    return { body: det.createDiv({ cls: "ngb-details-body" }), hintEl };
  }
  /** One removable row: monospace text + a Remove button. */
  /**
   * `onRemove` and `addRow`'s `onAdd` may be async: removing a path writes
   * device-local settings and then re-renders. Same reasoning as
   * ConfirmModal.onDecision: the contract admits the promise, and the single
   * `void` lives at the call below rather than at every caller.
   */
  entryRow(listEl, text, onRemove) {
    const row = listEl.createDiv({ cls: "ngb-entry-row" });
    row.createSpan({ cls: "ngb-entry-text", text });
    if (onRemove) {
      const btn = row.createEl("button", { text: "Remove" });
      btn.addEventListener("click", () => void onRemove());
    }
  }
  /** Input + Add button; `onAdd` receives the trimmed value. May be async. */
  addRow(body, placeholder, label2, onAdd) {
    const row = body.createDiv({ cls: "ngb-add-row" });
    const input = row.createEl("input", { type: "text", placeholder });
    const btn = row.createEl("button", { text: label2 });
    btn.addEventListener("click", () => {
      const v = input.value.trim();
      if (v !== "") void onAdd(v);
      input.value = "";
    });
  }
  // Every section refreshes ONLY its own list in place. Re-rendering the whole
  // tab (display()) on each add/remove resets the scroll position and makes
  // the collapsibles flicker — the view visibly "jumps".
  /**
   * Colours for the diff and conflict panes.
   *
   * One toggle guards the whole thing: while it is off the panes use the
   * theme's own values and there is nothing to configure, so nothing is shown.
   * Switching it on reveals the pickers — light and dark separately, because
   * one set of hex values cannot be legible in both.
   */
  /**
   * Only shown when there is something to show: a repository set aside by a
   * re-clone. It is invisible otherwise, and a permanent empty row would just
   * be a question nobody has.
   */
  renderPreviousReposSetting(containerEl) {
    const setting = new import_obsidian3.Setting(containerEl).setName("Previous repository copies").setDesc("Checking\u2026");
    setting.settingEl.hide();
    void (async () => {
      const repos = await this.plugin.listPreviousRepos();
      if (repos.length === 0) return;
      const total = repos.reduce((n, r) => n + r.sizeKb, 0);
      setting.setDesc(
        `${repos.length === 1 ? "One earlier repository was" : `${repos.length} earlier repositories were`} set aside by a re-clone and still use ${formatSize(total)}. Their history is intact; deleting is final.`
      );
      setting.addButton(
        (b) => b.setButtonText("Review").onClick(() => this.plugin.showPreviousRepoModal(repos, "Previous repository copies"))
      );
      setting.settingEl.show();
    })();
  }
  renderColorSection(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Custom colours in the diff and conflict panes").setDesc(
      "Off: the panes follow your theme. On: the colours below are used. Cosmetic and shared across devices (stored in data.json)."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.customColors).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ customColors: v });
          this.refreshTab();
        })();
      })
    );
    if (!this.plugin.sharedPrefs.customColors) return;
    const fields = [
      { key: "diffAddBg", name: "Added line background", desc: "Diff pane" },
      { key: "diffAddHl", name: "Added characters", desc: "Diff pane, intra-line highlight" },
      { key: "diffDelBg", name: "Deleted line background", desc: "Diff pane" },
      { key: "diffDelHl", name: "Deleted characters", desc: "Diff pane, intra-line highlight" },
      { key: "conflictLocalBg", name: "LOCAL side background", desc: "Conflict pane (yours)" },
      { key: "conflictRemoteBg", name: "REMOTE side background", desc: "Conflict pane (theirs)" }
    ];
    for (const mode of ["dark", "light"]) {
      const { body } = this.detailsSection(
        containerEl,
        mode === "dark" ? "Colours (dark theme)" : "Colours (light theme)",
        ""
      );
      const prefKey = mode === "dark" ? "colorsDark" : "colorsLight";
      for (const f of fields) {
        new import_obsidian3.Setting(body).setName(f.name).setDesc(f.desc).addColorPicker(
          (cp) => cp.setValue(this.plugin.sharedPrefs[prefKey][f.key]).onChange((v) => {
            void (async () => {
              await this.plugin.setSharedPref({
                [prefKey]: { ...this.plugin.sharedPrefs[prefKey], [f.key]: v }
              });
            })();
          })
        );
      }
      new import_obsidian3.Setting(body).setName("Reset to the defaults").setDesc("Restores the values this plugin ships with for this theme.").addButton(
        (b) => b.setButtonText("Reset").onClick(() => {
          void (async () => {
            await this.plugin.setSharedPref({ [prefKey]: { ...DEFAULT_COLORS[mode] } });
            this.refreshTab();
          })();
        })
      );
    }
  }
  renderProtectedPathsSection(containerEl, s) {
    const { body, hintEl } = this.detailsSection(containerEl, "Protected paths", "");
    new import_obsidian3.Setting(body).setName("Auto-protect sparse exclusions").setDesc("Paths hidden by the repository's own sparse rules join the protected set automatically (read from git on every status).").addToggle(
      (t) => t.setValue(s.autoProtectSparse).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ autoProtectSparse: v });
          refresh();
        })();
      })
    );
    const derivedNote = body.createEl("p", { cls: "ngb-settings-note" });
    const list = body.createDiv();
    const invalidNote = body.createDiv({ cls: "ngb-invalid" });
    const refresh = () => {
      const cur = this.plugin.deviceSettings;
      hintEl.setText(`${this.plugin.effectiveProtectedPaths().length} effective`);
      derivedNote.setText(
        !cur.autoProtectSparse ? "Auto-protect is off: only the manual paths below are protected." : cur.derivedProtectedPaths.length ? `Derived from sparse checkout: ${cur.derivedProtectedPaths.join(", ")}` : "Derived from sparse checkout: none yet (run Status once to read them from git)."
      );
      list.empty();
      for (const p of cur.protectedPaths) {
        this.entryRow(list, p, async () => {
          await this.plugin.updateDeviceSettings({
            protectedPaths: this.plugin.deviceSettings.protectedPaths.filter((x) => x !== p)
          });
          refresh();
        });
      }
    };
    refresh();
    this.addRow(body, "Folder/Subfolder", "Add manual path", async (v) => {
      const res = validateProtectedPaths([...this.plugin.deviceSettings.protectedPaths, v]);
      if (!res.ok) {
        invalidNote.setText(`Rejected "${res.offending}": ${res.reason}`);
        return;
      }
      invalidNote.setText("");
      await this.plugin.updateDeviceSettings({ protectedPaths: res.normalized });
      refresh();
    });
  }
  renderSparseSection(containerEl) {
    const { body, hintEl } = this.detailsSection(containerEl, "Sparse checkout exclusions", "");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text: "Paths hidden from THIS device's working tree (non-cone sparse checkout, applied by git in Termux). Hiding never deletes anything from the repository; removing an exclusion materializes the files again."
    });
    const stateNote = body.createDiv({ cls: "ngb-invalid" });
    const list = body.createDiv();
    const refresh = () => {
      const sparse = this.plugin.lastKnownSparse();
      const excls = this.plugin.deviceSettings.derivedProtectedPaths;
      hintEl.setText(sparse ? `${excls.length} hidden` : "run Status to load");
      stateNote.setText(sparse && sparse.enabled === false ? "Sparse checkout is not enabled in this repository." : "");
      list.empty();
      for (const p of excls) {
        this.entryRow(list, p, () => void this.plugin.cmdSparseExclude(p, false).then(refresh));
      }
    };
    refresh();
    this.addRow(
      body,
      "Folder/Subfolder",
      "Hide path",
      (v) => void this.plugin.cmdSparseExclude(v, true).then(refresh)
    );
  }
  renderGitignoreSection(containerEl) {
    const { body, hintEl } = this.detailsSection(containerEl, ".gitignore", "shared, synced through git");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text: ".gitignore is a tracked file: entries apply to ALL devices once the change is committed and synced."
    });
    const list = body.createDiv();
    const refresh = () => {
      void this.plugin.loadGitignore().then((entries) => {
        hintEl.setText(`${entries.length} entries \xB7 shared, synced through git`);
        list.empty();
        for (const e of entries) {
          this.entryRow(list, e, () => void this.plugin.gitignoreRemove(e).then(refresh));
        }
      });
    };
    refresh();
    this.addRow(
      body,
      "pattern, e.g. /Scratch/ or *.tmp",
      "Add entry",
      (v) => void this.plugin.gitignoreAdd(v).then(refresh)
    );
  }
  renderExcludeSection(containerEl) {
    const { body, hintEl } = this.detailsSection(containerEl, ".git/info/exclude", "this clone only, never synced");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text: "Local ignore rules stored inside .git \u2014 they never reach the remote or other devices. Managed through the Termux runner; press Load to read the current file."
    });
    const list = body.createDiv();
    const refresh = () => {
      const entries = this.plugin.currentExcludeLines();
      hintEl.setText(`${entries.length} entries \xB7 this clone only`);
      list.empty();
      for (const e of entries) {
        const path = e.replace(/^\//, "").replace(/\/$/, "");
        this.entryRow(list, e, () => void this.plugin.cmdExcludeChange(path, false).then(refresh));
      }
    };
    refresh();
    new import_obsidian3.Setting(body).addButton(
      (b) => b.setButtonText("Load from Termux").onClick(() => void this.plugin.refreshExcludeList().then(refresh))
    );
    this.addRow(
      body,
      "Folder/Subfolder",
      "Add to exclude",
      (v) => void this.plugin.cmdExcludeChange(v, true).then(refresh)
    );
  }
};

// src/bridge/protocol.ts
function makeRequestId(now, rand) {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `r-${ts}-${rand}`;
}
function randomSuffix(len = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  const c = typeof activeWindow !== "undefined" ? activeWindow.crypto : void 0;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (const b of arr) s += alphabet[b % alphabet.length];
  return s;
}
function createRequest(action, args, token, timeoutSeconds, now = /* @__PURE__ */ new Date(), rand = randomSuffix(), profileId = "") {
  const id = makeRequestId(now, rand);
  if (!isValidRequestId(id)) throw new Error(`Generated invalid request id: ${id}`);
  const req = {
    protocolVersion: PROTOCOL_VERSION,
    id,
    token,
    action,
    createdAt: now.toISOString(),
    timeoutSeconds,
    args
  };
  if (isValidProfileId(profileId)) req.profileId = profileId;
  return req;
}
function isValidProfileId(id) {
  return /^p-[0-9a-f]{8,32}$/.test(id);
}
function serializeRequest(req) {
  return JSON.stringify(req, null, 2);
}
function parseResult(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isResultShape(obj)) return null;
  return obj;
}
function isResultShape(o) {
  if (typeof o !== "object" || o === null) return false;
  const r = o;
  return typeof r.protocolVersion === "number" && typeof r.id === "string" && typeof r.action === "string" && typeof r.ok === "boolean" && typeof r.exitCode === "number";
}

// src/bridge/BridgeClient.ts
var CancelToken = class {
  constructor() {
    this.cancelled = false;
  }
  cancel() {
    this.cancelled = true;
  }
};
var BridgeClient = class {
  constructor(fs, paths, opts = {}) {
    this.fs = fs;
    this.paths = paths;
    this.opts = opts;
  }
  now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }
  sleep(ms) {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise((r) => window.setTimeout(r, ms));
  }
  async ensureRuntimeDirs() {
    for (const dir of this.paths.all()) {
      if (!await this.fs.exists(dir)) await this.fs.mkdir(dir);
    }
  }
  /** Write the request file. Never composes shell strings; the runner reads JSON. */
  async submit(req) {
    await this.ensureRuntimeDirs();
    await this.fs.write(this.paths.requestFile(req.id), serializeRequest(req));
  }
  /**
   * Poll for the result until timeout or cancellation. Polling happens only
   * while an operation is in flight; nothing runs otherwise.
   */
  async awaitResult(id, timeoutMs, cancel) {
    const deadline = this.now() + timeoutMs;
    const interval = this.opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    const file = this.paths.resultFile(id);
    for (; ; ) {
      if (cancel?.cancelled) return { kind: "cancelled" };
      if (await this.fs.exists(file)) {
        const text = await this.fs.read(file);
        const result = parseResult(text);
        if (result && result.id === id) return { kind: "result", result };
      }
      if (this.now() >= deadline) return { kind: "timeout" };
      await this.sleep(interval);
    }
  }
  /**
   * What the runner has said so far about a request that is still running.
   *
   * Missing file means an older runner (it wrote no stream) or a request that
   * was rejected before it began — both answer null, and neither is an error:
   * this is decoration on top of an operation that works without it.
   */
  async readProgress(id) {
    const file = this.paths.progressFile(id);
    try {
      if (!await this.fs.exists(file)) return null;
      const raw = await this.fs.read(file);
      return raw.length > 0 ? raw : null;
    } catch {
      return null;
    }
  }
  /** Signal cancellation: the runner skips not-yet-started requests. */
  async requestCancel(id) {
    await this.ensureRuntimeDirs();
    await this.fs.write(this.paths.cancelFile(id), "");
  }
  /** Remove a consumed result and its cancel flag. */
  async consume(id) {
    for (const f of [this.paths.resultFile(id), this.paths.cancelFile(id)]) {
      try {
        if (await this.fs.exists(f)) await this.fs.remove(f);
      } catch {
      }
    }
  }
  /** How many requests are queued and not processed yet (shown in diagnostics). */
  async pendingRequestCount() {
    if (!await this.fs.exists(this.paths.requestsDir)) return 0;
    return (await this.fs.listFiles(this.paths.requestsDir)).filter((f) => f.endsWith(".json")).length;
  }
  /**
   * Delete files older than the retention window, and orphaned results from a
   * previous session (recovery after Obsidian was killed mid-operation).
   * Age is derived from the timestamp embedded in the request id.
   */
  async cleanupOld() {
    let removed = 0;
    const cutoff = this.now() - RESULT_RETENTION_MS;
    for (const dir of [
      this.paths.requestsDir,
      this.paths.resultsDir,
      this.paths.cancelDir,
      this.paths.doneDir,
      // Progress streams deliberately outlive their request, so that a log
      // bundle shared afterwards can carry them. Nothing else would ever
      // remove them; the runner sweeps its side on the same 24 h rule.
      this.paths.progressDir
    ]) {
      let files;
      try {
        files = await this.fs.listFiles(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        const ts = idTimestampMs(basename(f));
        if (ts !== null && ts < cutoff) {
          try {
            await this.fs.remove(f);
            removed++;
          } catch {
          }
        }
      }
    }
    return removed;
  }
  /** Collect results present on disk whose ids we did not consume (crash recovery). */
  async listOrphanResults() {
    if (!await this.fs.exists(this.paths.resultsDir)) return [];
    const out = [];
    for (const f of await this.fs.listFiles(this.paths.resultsDir)) {
      try {
        const r = parseResult(await this.fs.read(f));
        if (r) out.push(r);
      } catch {
      }
    }
    return out;
  }
};
function basename(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}
function idTimestampMs(fileName) {
  const m = /^r-(\d{8})T(\d{4,6})Z?/.exec(fileName);
  if (!m) return null;
  const d = m[1];
  const t = (m[2] + "00").slice(0, 6);
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// src/bridge/runtimePaths.ts
var RuntimePaths = class {
  constructor(configDir) {
    this.root = `${configDir}/plugins/${PLUGIN_ID}/${RUNTIME_DIR_NAME}`;
  }
  get requestsDir() {
    return `${this.root}/${REQUESTS_DIR}`;
  }
  get resultsDir() {
    return `${this.root}/${RESULTS_DIR}`;
  }
  get cancelDir() {
    return `${this.root}/${CANCEL_DIR}`;
  }
  get doneDir() {
    return `${this.root}/${DONE_DIR}`;
  }
  get progressDir() {
    return `${this.root}/${PROGRESS_DIR}`;
  }
  requestFile(id) {
    return `${this.requestsDir}/${id}.json`;
  }
  /** The runner appends git's stderr here while the request runs. */
  progressFile(id) {
    return `${this.progressDir}/${id}.txt`;
  }
  resultFile(id) {
    return `${this.resultsDir}/${id}.json`;
  }
  cancelFile(id) {
    return `${this.cancelDir}/${id}`;
  }
  all() {
    return [
      this.root,
      this.requestsDir,
      this.resultsDir,
      this.cancelDir,
      this.doneDir,
      this.progressDir
    ];
  }
};

// src/bridge/transport.ts
var CompanionIntentTransport = class {
  constructor(uriTemplate, openUri) {
    this.uriTemplate = uriTemplate;
    this.openUri = openUri;
  }
  trigger(requestId) {
    const safeId = encodeURIComponent(requestId);
    this.openUri(this.uriTemplate.replace("{id}", safeId));
    return { kind: "intent" };
  }
};

// src/git/untrackedTargets.ts
function untrackedTargets(untracked, scope) {
  if (scope === null || scope === "" || scope === ".") return [...untracked];
  const bare = scope.endsWith("/") ? scope.slice(0, -1) : scope;
  if (bare === "") return [...untracked];
  const under = `${bare}/`;
  const at = untracked.filter((u) => u === bare || u === under || u.startsWith(under));
  if (at.length > 0) return at;
  if (untracked.some((u) => u.endsWith("/") && bare.startsWith(u))) return [bare];
  return [];
}

// src/ops/OperationLock.ts
var OperationLock = class {
  constructor(onChange) {
    this.onChange = onChange;
    this.current = null;
  }
  get active() {
    return this.current;
  }
  tryAcquire(id, action, now = Date.now()) {
    if (this.current !== null) return false;
    this.current = { id, action, startedAt: now };
    this.onChange?.(this.current);
    return true;
  }
  release(id) {
    if (this.current === null || this.current.id !== id) return false;
    this.current = null;
    this.onChange?.(null);
    return true;
  }
  /** Force-clear a stale lock (e.g. restored marker older than the threshold). */
  clearStale(now = Date.now(), maxAgeMs = STALE_LOCK_MS) {
    if (this.current !== null && now - this.current.startedAt > maxAgeMs) {
      this.current = null;
      this.onChange?.(null);
      return true;
    }
    return false;
  }
  /** Restore a persisted marker after restart (before reconciliation). */
  restore(marker) {
    this.current = marker;
  }
};
function isMarkerStale(marker, now = Date.now(), maxAgeMs = STALE_LOCK_MS) {
  return now - marker.startedAt > maxAgeMs;
}

// src/ops/OperationLog.ts
var _OperationLog = class _OperationLog {
  constructor(store) {
    this.store = store;
    this.entries = [];
    const raw = store.getValue(_OperationLog.KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed.slice(-LOG_MAX_ENTRIES);
        }
      } catch {
      }
    }
  }
  add(level, action, message, detail) {
    this.entries.push({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      action,
      message: redact(message),
      detail: detail !== void 0 ? redact(truncate(detail, 8 * 1024)) : void 0
    });
    if (this.entries.length > LOG_MAX_ENTRIES) {
      this.entries = this.entries.slice(-LOG_MAX_ENTRIES);
    }
    this.persist();
  }
  list() {
    return this.entries;
  }
  clear() {
    this.entries = [];
    this.persist();
  }
  persist() {
    this.store.setValue(_OperationLog.KEY, JSON.stringify(this.entries));
  }
};
_OperationLog.KEY = "oplog";
var OperationLog = _OperationLog;
function redact(s) {
  return s.replace(
    /(\w+:\/\/)([^/\s@]+)@/g,
    (m, scheme, userinfo) => userinfo === "git" ? m : `${scheme}***@`
  ).replace(/\b(gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]{8,}/g, "$1***").replace(/\b(Bearer|token)\s+[A-Za-z0-9._-]{8,}/gi, "$1 ***");
}
function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + `
\u2026 (${s.length - max} more bytes truncated)` : s;
}

// src/ui/StatusBarController.ts
var STATE_META = {
  disabled: { cls: "ngb-status-clean", label: "git: off" },
  clean: { cls: "ngb-status-clean", label: "git: clean" },
  changed: { cls: "ngb-status-changed", label: "git: changes" },
  syncing: { cls: "ngb-status-syncing", label: "git: working\u2026" },
  conflict: { cls: "ngb-status-conflict", label: "git: conflict" },
  error: { cls: "ngb-status-error", label: "git: error" }
};
var StatusBarController = class {
  constructor(el, onClick) {
    this.el = el;
    this.state = "disabled";
    el.addClass("ngb-status-bar-item");
    el.addEventListener("click", onClick);
    this.set("disabled");
  }
  set(state, detail) {
    const meta = STATE_META[state];
    for (const m of Object.values(STATE_META)) this.el.removeClass(m.cls);
    this.el.addClass(meta.cls);
    this.el.setText(detail ? `${meta.label} ${detail}` : meta.label);
    this.state = state;
  }
  get current() {
    return this.state;
  }
};

// src/ui/DiagnosticsModal.ts
var import_obsidian4 = require("obsidian");
var DiagnosticsModal = class extends import_obsidian4.Modal {
  constructor(app, report) {
    super(app);
    this.report = report;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: diagnostics");
    const c = this.contentEl;
    if (this.report.problems.length > 0) {
      const warn = c.createDiv({ cls: "ngb-warning" });
      warn.createEl("strong", { text: "Problems found:" });
      const ul = warn.createEl("ul", { cls: "ngb-file-list" });
      for (const p of this.report.problems) ul.createEl("li", { text: p });
    } else {
      c.createEl("p", { cls: "ngb-ok", text: "No problems detected." });
    }
    const renderKv = (title, data) => {
      const sec = c.createDiv({ cls: "ngb-section" });
      sec.createEl("h3", { text: title });
      const kv = sec.createDiv({ cls: "ngb-kv" });
      for (const [k, v] of Object.entries(data)) {
        kv.createDiv({ cls: "k", text: k });
        kv.createDiv({ cls: "ngb-mono", text: v });
      }
    };
    renderKv("Plugin (this device)", this.report.pluginSide);
    if (this.report.runnerSide) renderKv("Termux runner", this.report.runnerSide);
    else
      c.createEl("p", {
        cls: "ngb-settings-note",
        text: "Runner-side diagnostics unavailable (no response from Termux \u2014 run the GitBridge shortcut or check the integration settings)."
      });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/gitModals.ts
var import_obsidian5 = require("obsidian");
var CommitMessageModal = class extends import_obsidian5.Modal {
  constructor(app, opts, onDone) {
    super(app);
    this.opts = opts;
    this.onDone = onDone;
    this.resolved = false;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.opts.title);
    const c = this.contentEl;
    const ta = c.createEl("textarea", { cls: "ngb-mono ngb-textarea-full" });
    ta.rows = 3;
    ta.placeholder = this.opts.placeholder;
    ta.value = this.opts.initial ?? "";
    if (this.opts.suggestions !== void 0 && this.opts.suggestions.length > 0) {
      const box = c.createDiv({ cls: "ngb-msg-suggestions" });
      for (const s of this.opts.suggestions) {
        const chip = box.createEl("button", { cls: "ngb-msg-chip", text: s });
        chip.addEventListener("click", () => {
          ta.value = s;
          ta.focus();
        });
      }
    }
    const note = c.createDiv({ cls: "ngb-invalid" });
    const doSubmit = () => {
      const msg = ta.value.trim();
      if (msg.length === 0) {
        note.setText("Commit message must not be empty.");
        return;
      }
      if (msg.length > 1e3) {
        note.setText("Commit message is longer than 1000 characters.");
        return;
      }
      this.resolved = true;
      this.close();
      void this.onDone(msg);
    };
    placeModalAction(this, {
      label: this.opts.submitLabel,
      icon: "check",
      hasInput: true,
      onClick: doSubmit
    });
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doSubmit();
    });
    window.setTimeout(() => ta.focus(), 10);
  }
  onClose() {
    if (!this.resolved) void this.onDone(null);
    this.contentEl.empty();
  }
};
var ConflictModal = class extends import_obsidian5.Modal {
  constructor(app, conflicts, actions) {
    super(app);
    this.conflicts = conflicts;
    this.actions = actions;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Merge conflicts \u2014 sync stopped");
    const c = this.contentEl;
    c.createDiv({
      cls: "ngb-warning",
      text: "Pulling produced merge conflicts. Nothing was pushed. Resolve the conflict markers in the files below (then run Sync again), or abort the merge to return to the previous state."
    });
    const ul = c.createEl("ul", { cls: "ngb-file-list" });
    for (const f of this.conflicts) {
      const li = ul.createEl("li");
      renderFileBadge(li, null);
      const link = li.createEl("a", { cls: "ngb-badge-path", text: f });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.close();
        this.actions.openFile(f);
      });
    }
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const abort = btns.createEl("button", { text: "Abort merge\u2026", cls: "mod-warning" });
    abort.addEventListener("click", () => {
      this.close();
      void this.actions.abortMerge();
    });
    const close = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    close.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/settings/pairing.ts
var TOKEN_RE = /^[A-Za-z0-9]{16,128}$/;
var PROFILE_RE = /^p-[0-9a-f]{8,32}$/;
function parsePairingFile(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const r = obj;
  if (typeof r.token !== "string" || !TOKEN_RE.test(r.token)) return null;
  const out = { token: r.token };
  if (typeof r.repoPath === "string" && r.repoPath.length < 4096) out.repoPath = r.repoPath;
  if (typeof r.profileId === "string" && PROFILE_RE.test(r.profileId)) out.profileId = r.profileId;
  if (typeof r.createdAt === "string") out.createdAt = r.createdAt;
  return out;
}

// src/git/historyParsers.ts
function describeFileChange(e) {
  const counts = e.added !== void 0 && e.deleted !== void 0 ? `+${e.added} \u2212${e.deleted}` : "";
  switch (e.code) {
    case "A":
      return counts === "" ? "added" : `added, ${counts}`;
    case "D":
      return "deleted";
    case "R":
      return e.origPath ? `renamed from ${e.origPath}` : "renamed";
    case "C":
      return e.origPath ? `copied from ${e.origPath}` : "copied";
    case "T":
      return "type changed";
    case "M":
    default:
      return counts === "" ? e.code ? `changed (${e.code})` : "changed" : counts;
  }
}
var RS = String.fromCharCode(30);
var FS = String.fromCharCode(31);
function parseFileLog(raw, currentPath) {
  const out = [];
  let lastKnownPath = currentPath;
  for (const record of raw.split(RS)) {
    if (record.trim() === "") continue;
    const lines = record.split("\n");
    const header = lines[0] ?? "";
    const [hash, date, author, ...subj] = header.split(FS);
    if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    let pathAtCommit;
    let code;
    let origPath;
    let added;
    let deleted;
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("	");
      if (line.startsWith(":")) {
        const status = (parts[0] ?? "").split(" ").pop() ?? "";
        code = status[0];
        if ((code === "R" || code === "C") && parts.length >= 3) {
          origPath = unquoteGitPath(parts[1]);
          pathAtCommit = unquoteGitPath(parts[2]);
        } else if (parts.length >= 2) {
          pathAtCommit = unquoteGitPath(parts[1]);
        }
        continue;
      }
      if (/^(\d+|-)\t(\d+|-)\t/.test(line)) {
        const a = parts[0] ?? "";
        const d = parts[1] ?? "";
        if (a !== "-" && d !== "-") {
          added = Number(a);
          deleted = Number(d);
        }
        if (pathAtCommit === void 0 && parts.length >= 3) {
          const p = parts[2];
          const arrow = p.indexOf(" => ");
          pathAtCommit = unquoteGitPath(arrow >= 0 ? p.slice(arrow + 4) : p);
        }
        continue;
      }
      if (code === void 0) {
        const c = parts[0] ?? "";
        code = c[0];
        if ((c.startsWith("R") || c.startsWith("C")) && parts.length >= 3) {
          origPath = unquoteGitPath(parts[1]);
          pathAtCommit = unquoteGitPath(parts[2]);
        } else if (parts.length >= 2) {
          pathAtCommit = unquoteGitPath(parts[1]);
        }
      }
    }
    if (pathAtCommit === void 0) pathAtCommit = lastKnownPath;
    lastKnownPath = pathAtCommit;
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      pathAtCommit,
      code,
      origPath,
      added,
      deleted
    });
  }
  return out;
}
function parseRepoLog(raw) {
  const out = [];
  for (const record of raw.split(RS)) {
    if (record.trim() === "") continue;
    const lines = record.split("\n");
    const header = lines[0] ?? "";
    const [hash, date, author, ...subj] = header.split(FS);
    if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    const files = [];
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("	");
      const code = parts[0] ?? "";
      if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
        files.push({
          code: code[0],
          path: unquoteGitPath(parts[2]),
          origPath: unquoteGitPath(parts[1])
        });
      } else if (parts.length >= 2 && code !== "") {
        files.push({ code: code[0], path: unquoteGitPath(parts[1]) });
      }
    }
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      files
    });
  }
  return out;
}
function decodeBase64ToBytes(b64) {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToTextIfNotBinary(bytes) {
  const probe = bytes.subarray(0, Math.min(bytes.length, 8e3));
  for (const b of probe) if (b === 0) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// src/ui/StatusView.ts
var import_obsidian8 = require("obsidian");

// src/ui/pathTree.ts
function compressChains(nodes) {
  return nodes.map((n) => {
    let node = n;
    while (node.items.length === 0 && node.children.length === 1) {
      const only = node.children[0];
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    return { ...node, children: compressChains(node.children) };
  });
}
function buildPathTree(items, getPath) {
  const top = /* @__PURE__ */ new Map();
  const rootItems = [];
  const nodeFor = (segments) => {
    let map = top;
    let node;
    let path = "";
    for (const seg of segments) {
      path = path === "" ? seg : `${path}/${seg}`;
      let next = map.get(seg);
      if (!next) {
        next = { name: seg, path, children: /* @__PURE__ */ new Map(), items: [] };
        map.set(seg, next);
      }
      node = next;
      map = next.children;
    }
    return node;
  };
  for (const it of items) {
    const raw = getPath(it);
    const p = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const segs = p.split("/");
    if (segs.length <= 1) {
      rootItems.push(it);
      continue;
    }
    nodeFor(segs.slice(0, -1)).items.push(it);
  }
  const freeze = (n) => {
    const children = [...n.children.values()].map(freeze).sort((a, b) => a.name.localeCompare(b.name));
    const count = n.items.length + children.reduce((s, c) => s + c.count, 0);
    return { name: n.name, path: n.path, children, items: n.items, count };
  };
  return {
    rootItems,
    folders: compressChains(
      [...top.values()].map(freeze).sort((a, b) => a.name.localeCompare(b.name))
    )
  };
}

// src/ui/revealOnTap.ts
var TRASH_DIR = ".trash";
function describeMove(from, to) {
  const dir = (p) => {
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i) : "";
  };
  const name = (p) => {
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(i + 1) : p;
  };
  if (to === TRASH_DIR || to.startsWith(`${TRASH_DIR}/`)) {
    return [from, "\u2193 deleted, into Obsidian's trash", to];
  }
  const sameDir = dir(from) === dir(to);
  if (sameDir) {
    const head = dir(from) === "" ? [] : [`${dir(from)}/`];
    return [...head, name(from), "\u2193", name(to)];
  }
  return [from, "\u2193", to];
}
function revealOnTap(el, text, opts = {}) {
  const align = opts.align ?? "right";
  el.addClass("ngb-reveal-target");
  let pop = null;
  let timer = null;
  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const hide = () => {
    clearTimer();
    pop?.remove();
    pop = null;
  };
  const show = () => {
    clearTimer();
    if (pop !== null) return;
    pop = el.doc.body.createDiv({ cls: "ngb-reveal-pop" });
    for (const line of Array.isArray(text) ? text : [text]) {
      pop.createDiv({
        cls: line.startsWith("\u2193") ? "ngb-reveal-arrow" : "ngb-reveal-line",
        text: line
      });
    }
    const r = el.getBoundingClientRect();
    pop.style.top = `${Math.max(4, r.top - 4)}px`;
    if (align === "right") {
      pop.style.right = `${Math.max(4, el.win.innerWidth - r.right)}px`;
    } else {
      const w = pop.getBoundingClientRect().width;
      const maxLeft = Math.max(4, el.win.innerWidth - w - 4);
      pop.style.left = `${Math.min(Math.max(4, r.left), maxLeft)}px`;
    }
  };
  const arm = () => {
    clearTimer();
    timer = window.setTimeout(hide, 3e3);
  };
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    show();
    arm();
  });
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    show();
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
    el.addEventListener(ev, () => {
      if (pop !== null) arm();
    });
  }
  return el;
}

// src/ui/countBadge.ts
function formatCount(count) {
  const n = Math.max(0, Math.floor(count));
  if (n > 99999) return { text: "99k+", small: true, clamped: true };
  if (n >= 1e4) return { text: `${Math.floor(n / 1e3)}k`, small: true, clamped: true };
  if (n >= 1e3) {
    const whole = Math.floor(n / 1e3);
    const tenth = Math.floor(n % 1e3 / 100);
    return { text: `${whole}.${tenth}k`, small: true, clamped: true };
  }
  return { text: String(n), small: n > 99, clamped: n > 99 };
}
function renderCountBadge(parent, count, describe) {
  const fmt = formatCount(count);
  const el = parent.createSpan({
    cls: `ngb-sv-count${fmt.small ? " ngb-sv-count-sm" : ""}`,
    text: fmt.text
  });
  el.setAttribute("aria-label", describe(count));
  if (!fmt.clamped) return el;
  return revealOnTap(el, describe(count), { align: "right" });
}

// src/ui/contextMenu.ts
function attachContextMenu(el, open) {
  const anchor = (ev) => {
    if (typeof MouseEvent !== "undefined" && ev instanceof MouseEvent && ev.clientX) {
      return { x: ev.clientX, y: ev.clientY };
    }
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  };
  el.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    open(anchor(ev));
  });
  let longPress = null;
  const clearLongPress = () => {
    if (longPress !== null) {
      window.clearTimeout(longPress);
      longPress = null;
    }
  };
  el.addEventListener(
    "touchstart",
    (ev) => {
      clearLongPress();
      longPress = window.setTimeout(() => {
        longPress = null;
        open(anchor(ev));
      }, 500);
    },
    { passive: true }
  );
  for (const e of ["touchend", "touchmove", "touchcancel"]) {
    el.addEventListener(e, clearLongPress, { passive: true });
  }
}

// src/ui/icons.ts
var import_obsidian6 = require("obsidian");
var NGB_ICON_PUSH = "ngb-push";
var NGB_ICON_PULL = "ngb-pull";
var NGB_ICON_FETCH = "ngb-fetch";
var NGB_ICON_STAGE_ALL = "ngb-stage-all";
var NGB_ICON_UNSTAGE_ALL = "ngb-unstage-all";
var NGB_ICON_SYNC = "ngb-sync";
var SCALE = 100 / 24;
function scaled(path, strokeWidth = 2) {
  return `<g transform="scale(${SCALE})" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</g>`;
}
var CLOUD = "M17.5 15a4.5 4.5 0 0 0-.9-8.9A6 6 0 0 0 5.2 8.4A3.8 3.8 0 0 0 6 15";
function registerIcons() {
  (0, import_obsidian6.addIcon)(NGB_ICON_PULL, scaled(`<path d="${CLOUD}"/><path d="M12 11v8M8.5 15.5 12 19l3.5-3.5"/>`));
  (0, import_obsidian6.addIcon)(NGB_ICON_PUSH, scaled(`<path d="${CLOUD}"/><path d="M12 19v-8M8.5 14.5 12 11l3.5 3.5"/>`));
  (0, import_obsidian6.addIcon)(
    NGB_ICON_FETCH,
    scaled(
      `<path d="${CLOUD}"/><path d="M10.4 13.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.8-1.8 3"/><path d="M12.1 19.6h.01"/>`
    )
  );
  (0, import_obsidian6.addIcon)(
    NGB_ICON_STAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M17 10v8M13 14h8"/>')
  );
  (0, import_obsidian6.addIcon)(
    NGB_ICON_UNSTAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M13 14h8"/>')
  );
  (0, import_obsidian6.addIcon)(
    NGB_ICON_SYNC,
    scaled('<path d="M8 3v14M4 13l4 4 4-4M16 21V7M12 11l4-4 4 4"/>')
  );
}

// src/ui/animatedIcons.ts
var import_obsidian7 = require("obsidian");
function applySweepIcon(button, iconName, direction) {
  button.empty();
  const wrap = button.createSpan({ cls: "ngb-sweep" });
  const base = wrap.createSpan({ cls: "ngb-sweep-base" });
  (0, import_obsidian7.setIcon)(base, iconName);
  const lit = wrap.createSpan({ cls: `ngb-sweep-lit ngb-sweep-${direction}` });
  (0, import_obsidian7.setIcon)(lit, iconName);
}

// src/git/inProgressOp.ts
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
function describeInProgressOp(s) {
  const kind = s.rebaseInProgress ? "rebase" : s.mergeInProgress ? "merge" : null;
  if (kind === null) return null;
  const n = Math.max(0, s.conflictCount);
  const clean = n === 0;
  const noun2 = kind === "merge" ? "Merge" : "Rebase";
  const undoes = kind === "merge" ? "Aborting puts the branch back where it was before the pull." : "Aborting puts the branch back where it was before the rebase started.";
  const title = clean ? `${noun2} in progress \u2014 everything is resolved` : `${noun2} in progress \u2014 ${plural(n, "file is", "files are")} still conflicted`;
  const detail = clean ? kind === "merge" ? `Nothing is left to resolve. Commit the merge to finish it. ${undoes}` : `Nothing is left to resolve. Continue to replay the remaining commits. ${undoes}` : kind === "merge" ? `Resolve the conflicted files listed below, then commit the merge. ${undoes}` : `Resolve the conflicted files listed below, then continue. ${undoes}`;
  const shortTitle = clean ? kind === "merge" ? "Merge ready to commit" : "Rebase ready to continue" : `${noun2}: ${plural(n, "conflict", "conflicts")} left`;
  const shortDetail = clean ? kind === "merge" ? "Commit to finish, or abort to undo the pull." : "Continue to replay the rest, or abort." : kind === "merge" ? "Resolve them below, then commit." : "Resolve them below, then continue.";
  return {
    kind,
    title,
    detail,
    shortTitle,
    shortDetail,
    // Disabled rather than hidden, so the button stays where the user looks for
    // it and the count above explains why it is greyed. Enabled, it would send a
    // commit git refuses, or a `rebase --continue` that opens an editor the
    // runner has no terminal for.
    finish: {
      label: kind === "merge" ? "Commit merge" : "Continue rebase",
      enabled: clean
    },
    abort: { label: kind === "merge" ? "Abort merge" : "Abort rebase", enabled: true }
  };
}

// src/ui/StatusView.ts
var NGB_STATUS_VIEW = "native-git-bridge-status";
function actionSlots(scope, group, hasItems = true) {
  const none = { icon: null };
  if (!hasItems) return [none, none, none];
  const where = scope === "group" ? "" : " in this folder";
  switch (group) {
    case "staged":
      return [
        none,
        { icon: "minus", tooltip: `Unstage everything staged${where || ""}`, action: "unstage" },
        none
        // files offer discard here; staged content does not
      ];
    case "unstaged":
      return [
        none,
        { icon: "plus", tooltip: `Stage the changed (tracked) files${where}`, action: "stage" },
        { icon: "undo-2", tooltip: `Discard the changes${where}`, action: "discard", warn: true }
      ];
    case "untracked":
      return [
        none,
        { icon: "plus", tooltip: `Stage the new files${where}`, action: "stage" },
        // `trash`, not `undo-2`: there is nothing to revert to. The icon says
        // which of the two things a control does, at every scope — revert to
        // what is committed, or delete something git never had. The wording
        // stays neutral about the trash because a device setting decides
        // whether the deletion is reversible; the confirmation says which.
        { icon: "trash", tooltip: `Delete the new files${where}`, action: "discard", warn: true }
      ];
    default:
      return [none, none, none];
  }
}
function groupFileCount(items, children) {
  let n = 0;
  for (const it of items) {
    const kids = it.path.endsWith("/") ? children?.[it.path] : void 0;
    n += kids !== void 0 && kids.length > 0 ? kids.length : 1;
  }
  return n;
}
var DEFAULT_ROWS_PER_GROUP = 30;
var GROUP_PAGES_CEILING = 10;
var CHANGE_LABEL = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "conflicted",
  "?": "untracked"
};
var StatusView = class extends import_obsidian8.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.data = null;
    this.progressEl = null;
    this.progressDetailEl = null;
    this.cancelBtn = null;
    this.collapsed = {
      conflicted: false,
      staged: false,
      unstaged: false,
      untracked: true
    };
    /**
     * Untracked folder rows the user collapsed. Folders start EXPANDED: the
     * whole point of listing their children is that a freshly created folder
     * must show the notes inside it as actionable rows.
     */
    this.collapsedDirs = /* @__PURE__ */ new Set();
    /**
     * Rows the user asked to see beyond the budget, per group. Absent means the
     * plain budget. Not persisted: it is a rendering allowance for this session,
     * not a preference.
     */
    this.groupLimits = /* @__PURE__ */ new Map();
    /** Rows drawn in the group being rendered right now; reset per group. */
    this.drawn = 0;
    /**
     * Files the user asked to see inside one tree folder, keyed "<group>:<path>"
     * like `collapsedDirs`. Tree layout budgets per folder so the "more" control
     * sits under the folder it belongs to; the group ceiling above is what keeps
     * the total bounded.
     */
    this.folderLimits = /* @__PURE__ */ new Map();
    /**
     * The scrolling half of the panel. The toolbar, the operation strip and the
     * branch line stay put while this scrolls, so the controls are reachable
     * without scrolling back up through a long file list.
     */
    this.bodyEl = null;
    /**
     * Scroll offset carried across re-renders. `render()` rebuilds the whole
     * panel on every status refresh, and with auto-refresh on a timer that threw
     * the user back to the top of the list mid-scroll.
     */
    this.savedScroll = 0;
  }
  getViewType() {
    return NGB_STATUS_VIEW;
  }
  getDisplayText() {
    return "Native Git";
  }
  getIcon() {
    return "git-branch";
  }
  setData(data) {
    this.data = data;
    this.render();
  }
  /**
   * Update only the elapsed-time text. A full re-render would recreate the
   * toolbar buttons every tick and restart their CSS animations from the first
   * frame, which made the activity animation look erratic.
   */
  updateProgressText(text, detail) {
    if (this.data) {
      this.data.progress = text ?? void 0;
      this.data.progressDetail = detail ?? void 0;
    }
    if (this.progressEl && this.cancelBtn) {
      this.applyStripState(text, this.data?.activeOperation ?? null, detail ?? null);
      return;
    }
    this.render();
  }
  /** Toggle the reserved cancel slot and the label without rebuilding the row. */
  applyStripState(progress, activeOperation, detail) {
    const running = progress !== null && progress !== "";
    if (this.cancelBtn) {
      this.cancelBtn.toggleClass("ngb-slot-inactive", !running);
      this.cancelBtn.setAttribute("aria-disabled", running ? "false" : "true");
    }
    if (this.progressEl) {
      this.progressEl.toggleClass("ngb-sv-progress-idle", !running);
      this.progressEl.setText(
        running ? progress : activeOperation ? `${activeOperation} pending\u2026` : "Idle"
      );
    }
    if (this.progressDetailEl) {
      this.progressDetailEl.setText(running && detail !== null ? detail : "");
    }
  }
  async onOpen() {
    this.render();
    this.actions.syncState();
  }
  onPaneMenu(menu) {
    menu.addItem(
      (item) => item.setTitle("Native Git: operation log").setIcon("file-clock").onClick(() => this.actions.openLog())
    );
    menu.addItem(
      (item) => item.setTitle("Refresh status").setIcon("refresh-cw").onClick(() => this.actions.refresh())
    );
  }
  render() {
    const c = this.contentEl;
    this.savedScroll = this.bodyEl?.scrollTop ?? this.savedScroll;
    c.empty();
    c.addClass("ngb-status-view");
    const d = this.data;
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    const footBar = c.createDiv({ cls: "ngb-sv-footbar" });
    this.bodyEl = body;
    const mobile = import_obsidian8.Platform.isPhone;
    const bar = (mobile ? footBar : headEl).createDiv({ cls: "ngb-sv-toolbar" });
    const running = d?.runningAction;
    const iconBtn = (icon, tooltip, cb, actionName, anim = "pulse") => {
      const b = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
      b.setAttribute("aria-label", tooltip);
      const active = Boolean(actionName) && running === actionName;
      if (active && (anim === "sweep-down" || anim === "sweep-up")) {
        applySweepIcon(b, icon, anim === "sweep-down" ? "down" : "up");
        b.addClass("ngb-sv-icon-active");
      } else {
        (0, import_obsidian8.setIcon)(b, icon);
        if (active) {
          b.addClass(`ngb-anim-${anim}`);
          b.addClass("ngb-sv-icon-active");
        }
      }
      b.addEventListener("click", cb);
    };
    iconBtn(NGB_ICON_SYNC, "Sync", this.actions.sync, "sync", "pulse");
    iconBtn("check", "Commit", this.actions.commit, "commit", "pulse");
    iconBtn(NGB_ICON_STAGE_ALL, "Stage all", this.actions.stageAll, "stage-all", "pulse");
    iconBtn(NGB_ICON_UNSTAGE_ALL, "Unstage all", this.actions.unstageAll, "unstage-all", "pulse");
    iconBtn(NGB_ICON_FETCH, "Fetch", this.actions.fetch, "fetch", "sweep-down");
    iconBtn(NGB_ICON_PULL, "Pull", this.actions.pull, "pull", "sweep-down");
    iconBtn(NGB_ICON_PUSH, "Push", this.actions.push, "push", "sweep-up");
    iconBtn("refresh-cw", "Refresh status", this.actions.refresh, "status", "spin");
    const strip = headEl.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    const cancel = stripLeft.createEl("button", {
      cls: "clickable-icon ngb-sv-icon ngb-sv-icon-warn ngb-sv-cancel-slot"
    });
    cancel.setAttribute("aria-label", "Cancel current operation");
    (0, import_obsidian8.setIcon)(cancel, "x");
    cancel.addEventListener("click", () => this.actions.cancel());
    this.cancelBtn = cancel;
    this.progressEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    this.progressEl.addClass("ngb-sv-progress-tap");
    this.progressEl.setAttribute("aria-label", "Show what Termux is doing");
    this.progressEl.addEventListener("click", () => this.actions.openOutput());
    const stripRight = strip.createDiv({ cls: "ngb-sv-strip-right" });
    const treeBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    const treeOn = d?.treeView === true;
    treeBtn.setAttribute("aria-label", treeOn ? "Tree layout (tap for list)" : "List layout (tap for tree)");
    (0, import_obsidian8.setIcon)(treeBtn, treeOn ? "folder-tree" : "list");
    treeBtn.addEventListener("click", this.actions.toggleTree);
    const histBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    histBtn.setAttribute("aria-label", "Repository history");
    (0, import_obsidian8.setIcon)(histBtn, "history");
    histBtn.addEventListener("click", this.actions.openHistory);
    const detailEl = headEl.createDiv({ cls: "ngb-sv-progress-detail ngb-sv-progress-tap" });
    detailEl.setAttribute("aria-label", "Show what Termux is doing");
    detailEl.addEventListener("click", () => this.actions.openOutput());
    this.progressDetailEl = detailEl;
    this.applyStripState(d?.progress ?? null, d?.activeOperation ?? null, d?.progressDetail ?? null);
    const head = headEl.createDiv({ cls: "ngb-sv-header" });
    const loaded = d != null && d.statusLoaded !== false;
    const working = d?.state === "syncing";
    head.createSpan({
      cls: `ngb-sv-dot ngb-sv-${loaded ? d.state : working ? "syncing" : "unknown"}`
    });
    head.createSpan({
      cls: "ngb-sv-state",
      text: loaded ? stateLabel(d.state) : working ? stateLabel("syncing") : "not checked yet"
    });
    if (loaded) {
      head.createSpan({
        cls: "ngb-settings-note",
        text: ` ${d.branch ?? "\u2014"} \u2191${d.ahead} \u2193${d.behind}`
      });
    }
    if (d) this.renderInProgressBanner(headEl, d, mobile);
    if (!d) {
      body.createEl("p", { cls: "ngb-settings-note", text: "Press refresh to query native Git." });
      return;
    }
    const stageable = d.unstaged.length + d.untracked.length > 0;
    this.renderGroup(body, "conflicted", "Conflicts", d.conflicted.map((e) => entry(e, "U")), true);
    this.renderGroup(
      body,
      "staged",
      "Staged changes",
      d.staged.map((e) => entry(e, e.index)),
      false,
      stageable
    );
    this.renderGroup(body, "unstaged", "Changes", d.unstaged.map((e) => entry(e, e.worktree)), false);
    this.renderGroup(
      body,
      "untracked",
      "Untracked",
      d.untracked.map((p) => ({ path: p, code: "?" })),
      false
    );
    if (d.conflicted.length + d.staged.length + d.unstaged.length + d.untracked.length === 0) {
      if (d.statusLoaded === false) {
        body.createEl("p", {
          cls: "ngb-settings-note",
          text: "No status read yet \u2014 refresh to see the repository."
        });
      } else {
        body.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
      }
    }
    const foot = body.createDiv({ cls: "ngb-sv-footer" });
    const kv = foot.createDiv({ cls: "ngb-sv-kv" });
    const row = (k, v) => {
      const line = kv.createDiv({ cls: "ngb-sv-kv-row" });
      line.createSpan({ cls: "ngb-sv-kv-key", text: k });
      line.createSpan({ cls: "ngb-sv-kv-val", text: v });
    };
    if (d.sparse) {
      row("Sparse", d.sparse.enabled ? `on (${d.sparse.patterns.length} rules)` : "off");
      row("Hidden files", String(d.sparse.skipWorktreeCount));
    }
    row("Bridge", d.bridge);
    row("Last sync", d.lastSyncAt ?? "never");
    if (d.fetchedAt) row("Updated", d.fetchedAt);
    if (this.savedScroll > 0) body.scrollTop = this.savedScroll;
  }
  /**
   * The way out of an unfinished merge or rebase. Renders nothing at all when
   * neither is running, which is the normal case.
   */
  renderInProgressBanner(parent, d, mobile) {
    const b = describeInProgressOp({
      mergeInProgress: d.mergeInProgress,
      rebaseInProgress: d.rebaseInProgress,
      conflictCount: d.conflicted.length
    });
    if (!b) return;
    const wrap = parent.createDiv({ cls: mobile ? "ngb-sv-banner ngb-sv-banner-compact" : "ngb-sv-banner" });
    const head = wrap.createDiv({ cls: "ngb-sv-banner-title" });
    if (!mobile) {
      const icon = head.createSpan({ cls: "ngb-sv-banner-icon" });
      (0, import_obsidian8.setIcon)(icon, "git-merge");
    }
    head.createSpan({ text: mobile ? b.shortTitle : b.title });
    wrap.createDiv({ cls: "ngb-sv-banner-detail", text: mobile ? b.shortDetail : b.detail });
    const row = wrap.createDiv({ cls: "ngb-sv-banner-actions" });
    const finish = row.createEl("button", { cls: "mod-cta", text: b.finish.label });
    finish.disabled = !b.finish.enabled;
    finish.addEventListener("click", () => this.actions.finishInProgressOp(b.kind));
    const abort = row.createEl("button", { cls: "ngb-sv-banner-abort", text: b.abort.label });
    abort.addEventListener("click", () => this.actions.abortInProgressOp(b.kind));
  }
  renderGroup(parent, group, title, items, danger, showWhenEmpty = false) {
    if (items.length === 0 && !showWhenEmpty) return;
    const wrap = parent.createDiv({ cls: "ngb-sv-group" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    (0, import_obsidian8.setIcon)(chevron, this.collapsed[group] ? "chevron-right" : "chevron-down");
    if (danger) {
      const warn = header.createSpan({ cls: "ngb-conf-row-icon" });
      (0, import_obsidian8.setIcon)(warn, "alert-triangle");
      warn.setAttribute("aria-label", "Merge conflicts");
    }
    header.createSpan({
      cls: danger ? "ngb-sv-group-title ngb-sv-group-danger" : "ngb-sv-group-title",
      text: title
    });
    const gslot = this.slotFactory(header.createDiv({ cls: "ngb-sv-file-actions" }));
    for (const s of actionSlots("group", group, items.length > 0)) {
      gslot(s.icon, s.tooltip, s.action ? () => this.actions.groupAction(group, s.action) : void 0, s.warn);
    }
    const total = groupFileCount(items, this.data?.untrackedChildren);
    renderCountBadge(header, total, (n) => `${n} files in ${title.toLowerCase()}`);
    header.addEventListener("click", () => {
      this.collapsed[group] = !this.collapsed[group];
      this.render();
    });
    attachContextMenu(header, (pos) => this.actions.groupMenu(group, pos));
    if (this.collapsed[group]) return;
    const list = wrap.createDiv({ cls: "ngb-sv-list" });
    if (items.length === 0) {
      list.createDiv({ cls: "ngb-sv-empty", text: "Nothing staged yet." });
      return;
    }
    this.drawn = 0;
    if (this.data?.treeView) {
      this.renderTreeItems(list, group, items);
    } else {
      for (const it of items) {
        if (!this.hasRowBudget(group)) break;
        this.renderRow(list, group, it, 0);
        const children = group === "untracked" ? this.data?.untrackedChildren?.[it.path] : void 0;
        if (children && children.length > 0 && !this.collapsedDirs.has(it.path)) {
          for (const c of children) {
            if (!this.hasRowBudget(group)) break;
            this.renderRow(list, group, { path: c, code: "?" }, 1);
          }
        }
      }
    }
    this.renderRowOverflow(list, group, items);
  }
  /** One page: the device's row budget. */
  page() {
    const n = this.data?.rowsPerGroup ?? DEFAULT_ROWS_PER_GROUP;
    return n > 0 ? n : DEFAULT_ROWS_PER_GROUP;
  }
  /**
   * How many rows this group may draw in total.
   *
   * List layout: one page, because there is no structure to hang a partial
   * listing on and the group-level row is the whole answer. Tree layout: the
   * cost ceiling, since the per-folder budget already limits each folder and
   * this only stops a group with a very large number of folders.
   */
  rowLimit(group) {
    const base = this.page() * (this.data?.treeView ? GROUP_PAGES_CEILING : 1);
    return this.groupLimits.get(group) ?? base;
  }
  /** Files drawn inside one tree folder before it offers the rest. */
  folderLimit(key) {
    return this.folderLimits.get(key) ?? this.page();
  }
  /**
   * The files directly inside one tree folder, up to that folder's page, and
   * the control that adds the next page.
   *
   * The control is a row of the file list, indented with the files it belongs
   * to, because that is where the user is looking when a folder stops short.
   * `depth` is the folder's own depth; `-1` means the group's root, whose files
   * sit at depth 0.
   */
  renderFolderItems(list, group, key, items, depth) {
    const limit = this.folderLimit(key);
    let shown = 0;
    for (const it of items) {
      if (shown >= limit) break;
      if (!this.hasRowBudget(group)) return;
      this.renderRow(list, group, it, depth + 1);
      shown += 1;
    }
    if (shown >= items.length) return;
    const rest = items.length - shown;
    const row = list.createDiv({
      cls: `ngb-sv-file ngb-sv-more-children ngb-ind-${Math.min(Math.max(depth + 1, 1), 6)}`
    });
    row.setText(`${shown}/${items.length} files \u2022 Tap for more`);
    row.setAttribute(
      "aria-label",
      `Showing ${shown} of ${items.length} files here; tap to show ${Math.min(rest, this.page())} more`
    );
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.folderLimits.set(key, shown + this.page());
      this.render();
    });
  }
  hasRowBudget(group) {
    return this.drawn < this.rowLimit(group);
  }
  /**
   * The "N of M shown" row, at the end of the group in BOTH layouts. Tree
   * layout flattens files into a path tree, so there is no "after this folder"
   * to hang it under; the same place in both is what keeps the two layouts
   * answering alike.
   */
  renderRowOverflow(list, group, items) {
    if (this.data?.treeView && this.drawn < this.rowLimit(group)) return;
    const total = groupFileCount(items, this.data?.untrackedChildren);
    const shown = this.drawn;
    if (shown >= total) return;
    const page = this.data?.rowsPerGroup ?? DEFAULT_ROWS_PER_GROUP;
    const rest = total - shown;
    const row = list.createDiv({ cls: "ngb-sv-empty ngb-sv-more-children" });
    row.setText(`${shown}/${total} rows \u2022 Tap for more`);
    row.setAttribute(
      "aria-label",
      `Showing ${shown} rows of ${total} files in this group; tap to show ${Math.min(rest, page)} more`
    );
    row.setAttribute("aria-label", `Show more rows in this group`);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.groupLimits.set(group, shown + page);
      this.render();
    });
  }
  /**
   * One action column, used by folder rows AND group headers so both mirror
   * the file rows slot for slot ([open] [stage/unstage] [discard] plus the
   * count column). `null` renders an invisible placeholder that keeps the
   * column width without being focusable or clickable.
   */
  slotFactory(acts) {
    return (icon, tooltip, cb, warn = false) => {
      const b = acts.createEl("button", {
        cls: `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}${icon === null ? " ngb-slot-inactive" : ""}`
      });
      if (icon === null) {
        (0, import_obsidian8.setIcon)(b, "circle");
        b.setAttribute("aria-hidden", "true");
        b.tabIndex = -1;
        return;
      }
      b.setAttribute("aria-label", tooltip ?? "");
      (0, import_obsidian8.setIcon)(b, icon);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        cb?.();
      });
    };
  }
  /** Tree layout: group items nested under collapsible folder rows. */
  renderTreeItems(list, group, items) {
    let expanded = items;
    if (group === "untracked") {
      expanded = [];
      for (const it of items) {
        const children = this.data?.untrackedChildren?.[it.path];
        if (it.path.endsWith("/") && children && children.length > 0) {
          for (const c of children) expanded.push({ path: c, code: "?" });
        } else {
          expanded.push(it);
        }
      }
    }
    const tree = buildPathTree(expanded, (i) => i.path);
    this.renderFolderItems(list, group, `${group}:`, tree.rootItems, -1);
    for (const f of tree.folders) {
      if (!this.hasRowBudget(group)) return;
      this.renderFolderNode(list, group, f, 0);
    }
  }
  renderFolderNode(list, group, node, depth) {
    this.drawn += 1;
    const rowEl = list.createDiv({ cls: `ngb-sv-file ngb-ind-${Math.min(depth, 6)}` });
    const key = `${group}:${node.path}`;
    const collapsed = this.collapsedDirs.has(key);
    const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
    const chev = main.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
    (0, import_obsidian8.setIcon)(chev, collapsed ? "chevron-right" : "chevron-down");
    main.createSpan({ cls: "ngb-sv-file-name ngb-sv-folder-name", text: `${node.name}/` });
    main.addEventListener("click", () => {
      if (collapsed) this.collapsedDirs.delete(key);
      else this.collapsedDirs.add(key);
      this.render();
    });
    const busy = this.data?.runningAction;
    const hit = isRowAffected(this.data?.runningPath, `${node.path}/`);
    if (hit && (busy === "stage-file" || busy === "unstage-file" || busy === "discard-file")) {
      rowEl.addClass("ngb-sv-file-busy");
    }
    attachContextMenu(rowEl, (pos) => this.actions.fileMenu(node.path, group, pos));
    const slot = this.slotFactory(rowEl.createDiv({ cls: "ngb-sv-file-actions" }));
    for (const s of actionSlots("folder", group)) {
      slot(
        s.icon,
        s.tooltip,
        s.action ? () => this.actions.folderAction(group, node.path, s.action) : void 0,
        s.warn
      );
    }
    renderCountBadge(rowEl, node.count, (n) => `${n} files in ${node.path}/`);
    if (collapsed) return;
    this.renderFolderItems(list, group, key, node.items, depth);
    for (const ch of node.children) {
      if (!this.hasRowBudget(group)) return;
      this.renderFolderNode(list, group, ch, depth + 1);
    }
  }
  renderRow(list, group, it, depth) {
    this.drawn += 1;
    {
      const rowEl = list.createDiv({
        cls: depth === 0 ? "ngb-sv-file" : `ngb-sv-file ngb-ind-${Math.min(depth, 6)}`
      });
      const children = group === "untracked" && depth === 0 ? this.data?.untrackedChildren?.[it.path] : void 0;
      if (children && children.length > 0) {
        const chev = rowEl.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
        (0, import_obsidian8.setIcon)(chev, this.collapsedDirs.has(it.path) ? "chevron-right" : "chevron-down");
        chev.setAttribute("aria-label", this.collapsedDirs.has(it.path) ? "Expand folder" : "Collapse folder");
        chev.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.collapsedDirs.has(it.path)) this.collapsedDirs.delete(it.path);
          else this.collapsedDirs.add(it.path);
          this.render();
        });
      }
      const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
      const kind = CHANGE_LABEL[it.code] ?? it.code;
      if (group === "conflicted") {
        const warn = main.createSpan({ cls: "ngb-conf-row-icon" });
        (0, import_obsidian8.setIcon)(warn, "alert-triangle");
        warn.setAttribute("aria-label", "Merge conflict");
      }
      const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName(it.path) });
      name.setAttribute("aria-label", `${it.path} - ${kind}`);
      if (it.origPath !== void 0 && it.origPath !== it.path) {
        const from = main.createSpan({ cls: "ngb-sv-file-from", text: `\u2190 ${displayName(it.origPath)}` });
        from.setAttribute("aria-label", `moved from ${it.origPath}`);
        revealOnTap(from, describeMove(it.origPath, it.path), { align: "left" });
      }
      const isDir = it.path.endsWith("/");
      if (group === "conflicted") {
        main.addEventListener("click", (ev) => {
          const r = rowEl.getBoundingClientRect();
          this.actions.openConflict(it.path, { x: ev.clientX || r.left, y: ev.clientY || r.bottom });
        });
      } else if (group === "untracked" || isDir) {
        main.addEventListener("click", () => this.actions.openFile(it.path));
      } else {
        main.addEventListener("click", () => this.actions.openDiff(it.path, group));
      }
      attachContextMenu(rowEl, (pos) => this.actions.fileMenu(it.path, group, pos));
      if (import_obsidian8.Platform.isMobile && this.actions.showChangeWords()) {
        main.createSpan({ cls: "ngb-sv-file-kind", text: kind });
      }
      const acts = rowEl.createDiv({ cls: "ngb-sv-file-actions" });
      const act = (icon, tooltip, cb, warn = false, spinning = false) => {
        const b = acts.createEl("button", {
          cls: `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}${spinning ? " ngb-anim-pulse ngb-sv-icon-active" : ""}`
        });
        b.setAttribute("aria-label", tooltip);
        (0, import_obsidian8.setIcon)(b, icon);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          cb();
        });
      };
      const busy = this.data?.runningAction;
      const hit = isRowAffected(this.data?.runningPath, it.path);
      const rowBusy = hit && (busy === "stage-file" || busy === "unstage-file" || busy === "discard-file");
      if (rowBusy) rowEl.addClass("ngb-sv-file-busy");
      if (!it.path.endsWith("/")) {
        act("go-to-file", "Open file", () => this.actions.openFile(it.path));
      }
      if (group === "staged") {
        act("minus", "Unstage", () => this.actions.unstage(it.path), false, busy === "unstage-file" && hit);
      } else {
        act("plus", "Stage", () => this.actions.stage(it.path), false, busy === "stage-file" && hit);
      }
      if (group === "untracked") {
        act("trash", "Delete new file", () => this.actions.discard(it.path, group), true, busy === "discard-file" && hit);
      } else {
        act("undo-2", "Discard changes", () => this.actions.discard(it.path, group), true, busy === "discard-file" && hit);
      }
      const codeEl = rowEl.createSpan({
        cls: `ngb-sv-file-code ngb-code-${it.code}`,
        text: it.code
      });
      codeEl.setAttribute("aria-label", kind);
    }
  }
};
function entry(e, code) {
  return { path: e.path, code: code === "." ? "M" : code, origPath: e.origPath };
}
function isRowAffected(actionPath, rowPath) {
  if (!actionPath) return false;
  const a = actionPath.endsWith("/") ? actionPath.slice(0, -1) : actionPath;
  const r = rowPath.endsWith("/") ? rowPath.slice(0, -1) : rowPath;
  if (a === "") return false;
  return r === a || r.startsWith(a + "/");
}
function displayName(path) {
  const isDir = path.endsWith("/");
  const trimmed = isDir ? path.slice(0, -1) : path;
  const i = trimmed.lastIndexOf("/");
  const base = i >= 0 ? trimmed.slice(i + 1) : trimmed;
  const label2 = base === "" ? trimmed || path : base;
  return isDir ? `${label2}/` : label2;
}
function stateLabel(state) {
  switch (state) {
    case "clean":
      return "Clean";
    case "changed":
      return "Local changes";
    case "syncing":
      return "Working\u2026";
    case "waiting":
      return "Waiting for Termux";
    case "conflict":
      return "Conflict";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled on this device";
    default:
      return state;
  }
}
function summaryToViewData(s, extra, state) {
  return {
    state,
    branch: s.detached ? "(detached)" : s.branch,
    ahead: s.ahead,
    behind: s.behind,
    staged: s.staged,
    unstaged: s.unstaged,
    untracked: s.untracked,
    untrackedChildren: s.untrackedChildren,
    conflicted: s.conflicted,
    ...extra
  };
}

// src/ui/gitMenu.ts
function menuHeader(scope) {
  if (scope.kind === "group") return null;
  const isDir = scope.kind === "folder";
  const trimmed = scope.path.endsWith("/") ? scope.path.slice(0, -1) : scope.path;
  const cut = trimmed.lastIndexOf("/");
  const base = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  const name = scope.kind === "file-at-commit" ? `${base} @ ${scope.hash.slice(0, 8)}` : base;
  return {
    dir: cut >= 0 ? trimmed.slice(0, cut) : "",
    name: isDir ? `${name}/` : name
  };
}
function suffix(scope) {
  return scope.kind === "folder" || scope.kind === "group" ? ` (${scope.count})` : "";
}
function noun(scope) {
  if (scope.kind === "folder") return " in folder";
  return scope.kind === "group" ? " in group" : "";
}
function buildMenuEntries(scope, f) {
  if (scope.kind === "file-at-commit") {
    const out2 = [
      { action: "open-diff-at-commit", title: "Open this commit's diff", icon: "file-diff" }
    ];
    if (scope.code !== "D") {
      out2.push({ action: "show-at-commit", title: "Show the file as of this commit", icon: "eye" });
      out2.push({
        action: "restore-from-commit",
        title: "Restore the file from this commit",
        icon: "rotate-ccw",
        danger: true
      });
      out2.push({ action: "open-history", title: "Open file history", icon: "history" });
      if (f.remoteMappable === true) {
        out2.push({ action: "open-remote", title: "Open on the remote (browser)", icon: "globe" });
      }
    }
    out2.push({ action: "copy-path", title: "Copy path", icon: "copy" });
    return out2;
  }
  const out = [];
  const single2 = scope.kind === "file";
  const bulk = !single2;
  const n = suffix(scope);
  const where = noun(scope);
  const empty = scope.kind !== "file" && scope.count === 0;
  if (!empty) {
    if (scope.group === "staged") {
      out.push({ action: "unstage", title: `Git: Unstage${where}${n}`, icon: "minus-circle" });
    } else if (scope.group === "unstaged" || scope.group === "untracked") {
      out.push({ action: "stage", title: `Git: Stage${where}${n}`, icon: "plus-circle" });
      out.push({
        action: "discard",
        title: scope.group === "untracked" ? `Git: Delete new file${single2 ? "" : "s"}${where}${n}` : `Git: Discard changes${where}${n}`,
        // `trash` for content git never had, `undo-2` for a revert to the
        // committed version. The same pairing the panel's buttons use.
        icon: scope.group === "untracked" ? "trash" : "undo-2",
        danger: true
      });
    }
  }
  if (scope.group === "conflicted" && !empty) {
    out.push({ action: "resolve-local", title: `Git: Keep local version${where}${n}`, icon: "check", danger: true });
    out.push({ action: "resolve-remote", title: `Git: Keep remote version${where}${n}`, icon: "check-check", danger: true });
    if (scope.kind === "group") {
      out.push({ action: "abort-merge", title: "Git: Abort merge", icon: "x-circle", danger: true });
    }
  }
  if (single2) {
    if (scope.group === "conflicted") {
      out.push({ action: "open-conflict", title: "Open conflict view", icon: "alert-triangle" });
    } else {
      out.push({ action: "open-diff", title: "Open diff", icon: "file-diff" });
    }
    out.push({ action: "open-history", title: "Open file history", icon: "history" });
    out.push({ action: "open-external", title: "Open in default app", icon: "external-link" });
  }
  if (scope.kind !== "group") {
    out.push({ action: "copy-path", title: "Copy path", icon: "copy" });
  }
  if (f.menuGitignore && !empty) {
    if (single2 && f.ignored) {
      out.push({ action: "gitignore-remove", title: "Git: Remove from .gitignore", icon: "eye" });
    } else {
      out.push({ action: "gitignore-add", title: `Git: Add to .gitignore${where}${n}`, icon: "eye-off" });
    }
  }
  if (f.menuSparse && !empty) {
    if (single2 && f.sparseExcluded) {
      out.push({ action: "sparse-remove", title: "Git: Show again (remove sparse exclusion)", icon: "eye" });
    } else {
      out.push({
        action: "sparse-add",
        title: `Git: Hide on this device (sparse)${where}${n}`,
        icon: "eye-off",
        danger: bulk
      });
    }
  }
  if (f.menuExclude && !empty) {
    if (single2 && f.excluded) {
      out.push({ action: "exclude-remove", title: "Git: Remove from .git exclude", icon: "eye" });
    } else {
      out.push({ action: "exclude-add", title: `Git: Add to .git exclude${where}${n}`, icon: "eye-off" });
    }
  }
  if (f.untrack && single2 && (scope.group === "staged" || scope.group === "unstaged")) {
    out.push({ action: "untrack", title: "Git: Stop tracking (keep the file)", icon: "eye-off", danger: true });
  }
  return out;
}

// src/git/gitErrors.ts
function looksLikeObjectCorruption(stderr, stdout) {
  const s = `${stderr ?? ""}
${stdout ?? ""}`;
  return /object file .* is empty/i.test(s) || /unable to read (tree|sha1 file|object)/i.test(s) || /loose object .* is corrupt/i.test(s) || /(^|\n)error: (garbage|inflate)/i.test(s);
}
function needsTermuxCredentials(stderr, stdout) {
  const s = `${stderr ?? ""}
${stdout ?? ""}`;
  return /terminal prompts disabled/i.test(s) || /could not read (Username|Password)/i.test(s) || /Authentication failed for/i.test(s) || /Host key verification failed/i.test(s);
}
function looksLikeStaleLock(stderr, stdout) {
  const s = `${stderr ?? ""}
${stdout ?? ""}`;
  return /Unable to create '.*\.lock': File exists/i.test(s) || /Another git process seems to be running/i.test(s);
}
function needsGitIdentity(stderr, stdout) {
  const s = `${stderr ?? ""}
${stdout ?? ""}`;
  return /user\.(name|email)[^\n]*not configured/i.test(s) || /Please tell me who you are/i.test(s) || /unable to auto-detect email address/i.test(s);
}
function looksLikeDubiousOwnership(stderr, stdout) {
  const s = `${stderr ?? ""}
${stdout ?? ""}`;
  return /dubious ownership/i.test(s) || /safe\.directory/i.test(s);
}
var PROGRESS = new RegExp(
  "^(" + [
    "Updating index flags",
    "Updating files",
    "Counting objects",
    "Compressing objects",
    "Receiving objects",
    "Resolving deltas",
    "Unpacking objects",
    "Filtering content",
    "Checking out files",
    "remote: (Counting|Compressing|Enumerating|Resolving|Total)"
  ].join("|") + ")"
);
function isNoise(line) {
  const t = line.trim();
  if (t === "") return true;
  if (PROGRESS.test(t)) return true;
  if (/^\d{1,3}% \(\d+\/\d+\)$/.test(t)) return true;
  return false;
}
function summarizeGitError(stderr, stdout, limit = 6) {
  const source = [stderr ?? "", stdout ?? ""].join("\n");
  const lines = source.split(/[\r\n]+/).map((l) => l.replace(/\s+$/, "")).filter((l) => !isNoise(l));
  const out = [];
  for (const l of lines) {
    if (!out.includes(l)) out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}

// src/git/termuxCommands.ts
function termuxRepoPath(repoPathHint) {
  const repo = repoPathHint.trim().replace(/\/+$/, "");
  if (repo === "" || !repo.startsWith("/")) return null;
  return repo;
}
function identitySetupCommand(repoPathHint) {
  const repo = termuxRepoPath(repoPathHint);
  if (repo === null) return null;
  return `cd "${repo}" && read -p "user.name: " n && git config --local user.name "$n" && read -p "user.email: " e && git config --local user.email "$e" && git --no-pager config --local --name-only --get-regexp '^user\\.'`;
}
function safeDirectoryCommand(repoPathHint) {
  const repo = termuxRepoPath(repoPathHint);
  if (repo === null) return null;
  return `git config --global --add safe.directory "${repo}"`;
}

// src/git/cloneRoute.ts
function manualCloneCommand(opts) {
  const vault = opts.vaultPath.trim().replace(/\/+$/, "");
  if (vault === "" || !vault.startsWith("/") || opts.profileId === "") return null;
  const dir = `${vault}/${opts.configDir}/plugins/native-git-bridge/runtime/clone-tmp/repo`;
  const extras = (opts.filter !== void 0 ? ` --filter=${opts.filter}` : "") + (opts.depth !== void 0 ? ` --depth ${opts.depth}` : "");
  const helper = `-c credential.helper= -c credential.helper="store --file=$HOME/.config/native-git-bridge/creds/${opts.profileId}"`;
  return `rm -rf "${dir}" && git clone --no-checkout --progress${extras} ${helper} -- "${opts.url}" "${dir}"`;
}
function cloneRoute(opts) {
  if (!opts.url.startsWith("https://")) return "companion";
  if (!opts.replaceExisting) return "termux";
  if (opts.credsConfigured === false) return "termux";
  return "companion";
}

// src/git/hunks.ts
function parseHunks(diff) {
  const out = [];
  let cur = null;
  for (const rawLine of diff.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("@@")) {
      cur = { header: line, before: [], after: [] };
      out.push(cur);
      continue;
    }
    if (cur === null) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const body = line.slice(1);
    if (line.startsWith("+")) cur.after.push(body);
    else if (line.startsWith("-")) cur.before.push(body);
    else if (line.startsWith(" ")) {
      cur.before.push(body);
      cur.after.push(body);
    }
  }
  return out;
}
function restoreHunk(currentText, hunk) {
  const lines = currentText.split("\n");
  const already = indexOfBlock(lines, hunk.after);
  if (already >= 0) return { ok: true, text: currentText, changed: false };
  const at = indexOfBlock(lines, hunk.before);
  if (at < 0) return { ok: false, reason: "not-found" };
  const next = [...lines.slice(0, at), ...hunk.after, ...lines.slice(at + hunk.before.length)];
  return { ok: true, text: next.join("\n"), changed: true };
}
function indexOfBlock(lines, block) {
  if (block.length === 0) return -1;
  for (let i = 0; i + block.length <= lines.length; i++) {
    let hit = true;
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

// src/git/hunkPatch.ts
function buildHunkPatch(req) {
  const { path, hunk, selected } = req;
  const body = [];
  let oldCount = 0;
  let newCount = 0;
  let changes = 0;
  hunk.lines.forEach((line, i) => {
    const picked = selected === void 0 || selected.has(i);
    if (line.kind === "context") {
      body.push(` ${line.text}`);
      oldCount++;
      newCount++;
      return;
    }
    if (line.kind === "delete") {
      if (picked) {
        body.push(`-${line.text}`);
        oldCount++;
        changes++;
      } else {
        body.push(` ${line.text}`);
        oldCount++;
        newCount++;
      }
      return;
    }
    if (picked) {
      body.push(`+${line.text}`);
      newCount++;
      changes++;
    }
  });
  if (changes === 0) return null;
  const oldStart = hunk.lines.find((l) => l.oldNumber !== null)?.oldNumber ?? 1;
  const newStart = hunk.lines.find((l) => l.newNumber !== null)?.newNumber ?? 1;
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`,
    ...body,
    ""
  ].join("\n");
}
function range(start, count) {
  const s = count === 0 ? 0 : start;
  return count === 1 ? `${s}` : `${s},${count}`;
}
function selectableLines(hunk) {
  const out = [];
  hunk.lines.forEach((l, i) => {
    if (l.kind !== "context") out.push(i);
  });
  return out;
}
function selectionHasChanges(hunk, selected) {
  return hunk.lines.some((l, i) => l.kind !== "context" && selected.has(i));
}
function buildWholeFilePatch(path, before, after) {
  if (before === after) return null;
  const oldLines = splitKeepingShape(before);
  const newLines = splitKeepingShape(after);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${range(1, oldLines.length)} +${range(1, newLines.length)} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
    ""
  ].join("\n");
}
function splitKeepingShape(text) {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function needsNoNewlineMarker(text) {
  return text !== "" && !text.endsWith("\n");
}

// src/git/restoreBlock.ts
async function restoreBlockInFile(path, hunk, io) {
  const current = await io.readFile(path);
  if (current === null) return { kind: "unreadable" };
  const out = restoreHunk(current, hunk);
  if (!out.ok) return { kind: "stale" };
  if (!out.changed) return { kind: "unchanged" };
  const patch = needsNoNewlineMarker(current) || needsNoNewlineMarker(out.text) ? null : buildWholeFilePatch(path, current, out.text);
  await io.writeFile(path, out.text);
  if (patch === null) {
    return { kind: "restored", staged: false, reason: "no-newline" };
  }
  return await io.stagePatch(patch) ? { kind: "restored", staged: true } : { kind: "restored", staged: false, reason: "stage-failed" };
}
function describeRestore(outcome, shortHash) {
  switch (outcome.kind) {
    case "unreadable":
      return "This file cannot be edited here (binary or unreadable).";
    case "stale":
      return "That block no longer matches the current file, so it was not touched. Restore the whole file version instead.";
    case "unchanged":
      return "This block already matches that commit.";
    case "restored":
      if (outcome.staged) return `Restored one block from ${shortHash} and staged it.`;
      return outcome.reason === "no-newline" ? `Restored one block from ${shortHash}. Stage it from the git panel.` : `Restored one block from ${shortHash}, but staging it failed.`;
  }
}

// src/git/ignoreFile.ts
function parseIgnoreEntries(raw) {
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
}
function ignoreEntryMatches(entries, path) {
  const variants = [`/${path}`, path, `/${path}/`, `${path}/`];
  return entries.some((e) => variants.includes(e));
}
function trackedPathsAmong(status, paths) {
  const tracked = /* @__PURE__ */ new Set();
  for (const e of [...status.staged, ...status.unstaged, ...status.conflicted]) {
    tracked.add(e.path);
    if (e.origPath !== void 0) tracked.add(e.origPath);
  }
  return paths.filter((p) => tracked.has(p));
}

// src/git/objectStats.ts
var FIELD_KEYS = {
  count: "looseCount",
  size: "looseKb",
  "in-pack": "inPackCount",
  packs: "packCount",
  "size-pack": "packKb",
  garbage: "garbageCount",
  "size-garbage": "garbageKb"
};
function parseCountObjects(raw) {
  const stats = {
    looseCount: 0,
    looseKb: 0,
    inPackCount: 0,
    packCount: 0,
    packKb: 0,
    garbageCount: 0,
    garbageKb: 0
  };
  for (const line of raw.split("\n")) {
    const m = /^([a-z-]+):\s*(\d+)\s*$/.exec(line.trim());
    if (!m) continue;
    const key = FIELD_KEYS[m[1]];
    if (key !== void 0) stats[key] = parseInt(m[2], 10);
  }
  return stats;
}
function totalKb(s) {
  return s.looseKb + s.packKb + s.garbageKb;
}
function maintenanceReportLines(s, rescueBranches) {
  const lines = [
    `Object database: ${formatSize(totalKb(s))} (${s.packCount} pack${s.packCount === 1 ? "" : "s"} ${formatSize(
      s.packKb
    )}, loose objects ${formatSize(s.looseKb)}).`,
    `Leftover temporary files: ${s.garbageCount === 0 ? "none" : `${s.garbageCount}, ${formatSize(s.garbageKb)}`}.`,
    "Cleanup removes stale temporary files and unreachable loose objects older than two weeks, then repacks everything reachable into one pack. Nothing any branch, tag, reflog or the index can reach is touched.",
    "The repack is the long step and needs free space roughly the size of the repacked history while it runs."
  ];
  if (rescueBranches.length > 0) {
    lines.push(
      `Rescue branch${rescueBranches.length === 1 ? "" : "es"} ${rescueBranches.join(
        ", "
      )} still keeps its objects reachable, so the space it holds is not freed until the backup is deleted.`
    );
  }
  return lines;
}
function maintenanceVerdict(before, after) {
  const freedKb = totalKb(before) - totalKb(after);
  if (freedKb <= 0) return `Nothing to free: the object database stays at ${formatSize(totalKb(after))}.`;
  return `Freed ${formatSize(freedKb)}: ${formatSize(totalKb(before))} down to ${formatSize(totalKb(after))} (${after.packCount} pack${after.packCount === 1 ? "" : "s"} now).`;
}

// src/ui/HistoryView.ts
var import_obsidian9 = require("obsidian");
var NGB_HISTORY_VIEW = "native-git-bridge-history";
var NGB_HISTORY_ICON = "history";
var HistoryView = class extends import_obsidian9.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.entries = [];
    this.skip = 0;
    this.pageSize = 30;
    this.exhausted = false;
    this.loading = false;
    this.expanded = /* @__PURE__ */ new Set();
    /** Collapsed folder nodes in tree layout, keyed "<hash>:<folderPath>". */
    this.collapsedDirs = /* @__PURE__ */ new Set();
    /**
     * Rows the user asked to see past the budget, per commit hash. Not persisted:
     * it is an allowance for this session, like the status panel's.
     */
    this.extraRows = /* @__PURE__ */ new Map();
    this.listEl = null;
    this.moreBtn = null;
    /** The scrolling middle of the panel; the head and the bottom bar do not move. */
    this.bodyEl = null;
    /** Scroll offset carried across shell rebuilds (layout toggle, re-render). */
    this.savedScroll = 0;
    /** State line in the strip, mirroring the status panel's. */
    this.progressEl = null;
    this.progressDetailEl = null;
    /**
     * The refresh button, kept so its animation can follow `loading`.
     *
     * It used to be decided once, inside `renderShell`, from a flag that
     * `loadMore` sets afterwards — so the button never span at all, no matter how
     * long the runner took.
     */
    this.refreshBtn = null;
    /**
     * Interval behind the in-list wait indicator. One per load, cleared when the
     * load ends: `registerInterval` ties an interval to the VIEW's lifetime, so
     * without this every refresh left another timer ticking into a detached node
     * until the panel was closed.
     */
    this.waitTicker = null;
    /**
     * Bumped by every `refresh()`. A load carries the epoch it started under, so
     * a page that arrives after a refresh can tell that it belongs to a list
     * which no longer exists and drop itself.
     */
    this.loadEpoch = 0;
    /**
     * A refresh asked for while a request was in flight, to be run when that
     * request answers. Two requests are never in flight at once: the panel has
     * one operation lock behind it, and a scope change in the branch graph has
     * to obey the same rule.
     */
    this.refreshQueued = false;
    /** The in-list wait indicator while one is showing; see `startWaiting`. */
    this.waitingEl = null;
  }
  getViewType() {
    return NGB_HISTORY_VIEW;
  }
  getDisplayText() {
    return "Native Git history";
  }
  getIcon() {
    return NGB_HISTORY_ICON;
  }
  async onOpen() {
    this.renderShell();
    await this.refresh();
  }
  /** Reload from the first page (also wired to external refreshes). */
  async refresh() {
    this.loadEpoch += 1;
    this.entries = [];
    this.skip = 0;
    this.exhausted = false;
    this.waitingEl = null;
    this.renderShell();
    this.savedScroll = 0;
    if (this.loading) {
      this.refreshQueued = true;
      this.startWaiting();
      return;
    }
    await this.loadMore();
  }
  /** Redraw from the already-loaded commits (layout toggles; no round trip). */
  rerender() {
    this.renderShell();
    for (const e of this.entries) this.renderCommit(e);
    if (this.moreBtn && this.entries.length > 0 && !this.exhausted) this.moreBtn.show();
    this.restoreScroll();
  }
  renderShell() {
    const c = this.contentEl;
    this.savedScroll = this.bodyEl?.scrollTop ?? this.savedScroll;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view");
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    const footBar = c.createDiv({ cls: "ngb-sv-footbar" });
    this.bodyEl = body;
    const mobile = import_obsidian9.Platform.isPhone;
    const bar = (mobile ? footBar : headEl).createDiv({ cls: "ngb-sv-toolbar" });
    const refreshBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    refreshBtn.setAttribute("aria-label", "Refresh history");
    (0, import_obsidian9.setIcon)(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => void this.refresh());
    this.refreshBtn = refreshBtn;
    const strip = headEl.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    this.progressEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    this.progressEl.addClass("ngb-sv-progress-tap");
    this.progressEl.setAttribute("aria-label", "Show what Termux is doing");
    this.progressEl.addEventListener("click", () => this.actions.openOutput());
    const stripRight = strip.createDiv({ cls: "ngb-sv-strip-right" });
    const treeBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    const treeOn = this.actions.treeView();
    treeBtn.setAttribute("aria-label", treeOn ? "Tree layout (tap for list)" : "List layout (tap for tree)");
    (0, import_obsidian9.setIcon)(treeBtn, treeOn ? "folder-tree" : "list");
    treeBtn.addEventListener("click", () => this.actions.toggleTree());
    const statusBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    statusBtn.setAttribute("aria-label", "Git panel");
    (0, import_obsidian9.setIcon)(statusBtn, "git-branch");
    statusBtn.addEventListener("click", () => this.actions.openStatusPanel());
    this.progressDetailEl = headEl.createDiv({ cls: "ngb-sv-progress-detail ngb-sv-progress-tap" });
    this.progressDetailEl.setAttribute("aria-label", "Show what Termux is doing");
    this.progressDetailEl.addEventListener("click", () => this.actions.openOutput());
    this.applyLoadingState();
    this.listEl = body.createDiv({ cls: "ngb-hist-list" });
    const btns = body.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }
  /**
   * The strip's state line and the refresh animation, both driven by `loading`.
   *
   * Called whenever `loading` changes rather than only at render time. An
   * indicator that keeps moving after the work stopped is worse than no
   * indicator: it says the runner is busy when it is not. The same rule applies
   * to a refused operation, where the animation must never start.
   *
   * "Idle" is the word the status panel uses, so the two panels do not describe
   * the same condition differently.
   */
  applyLoadingState() {
    if (this.refreshBtn) {
      this.refreshBtn.toggleClass("ngb-anim-spin", this.loading);
      this.refreshBtn.toggleClass("ngb-sv-icon-active", this.loading);
    }
    if (!this.progressEl) return;
    const p = this.actions.progressText();
    const running = this.loading || p !== "";
    this.progressEl.toggleClass("ngb-sv-progress-idle", !running);
    this.progressEl.setText(this.loading ? "Loading history\u2026" : p !== "" ? p : "Idle");
    if (this.progressDetailEl) {
      this.progressDetailEl.setText(p !== "" ? this.actions.progressDetail() : "");
    }
  }
  /**
   * The plugin's per-second tick. The state line reads `progressText()` only
   * when something re-renders it, so without this call the copy shown here
   * froze at whatever second the panel last drew itself.
   */
  updatePluginProgress() {
    this.applyLoadingState();
  }
  /**
   * Put the list back where it was. Called AFTER the commits are re-added:
   * setting scrollTop on a container that is still empty is a no-op, which is
   * how the layout toggle used to jump back to the newest commit.
   */
  restoreScroll() {
    if (this.bodyEl && this.savedScroll > 0) this.bodyEl.scrollTop = this.savedScroll;
  }
  async loadMore() {
    if (this.loading) return;
    const epoch = this.loadEpoch;
    this.loading = true;
    this.applyLoadingState();
    if (this.moreBtn) {
      this.moreBtn.disabled = true;
      this.moreBtn.setText("Loading\u2026");
    }
    const ticker = this.skip === 0 ? this.startWaiting() : null;
    const page = await this.actions.loadPage(this.skip, this.pageSize);
    this.loading = false;
    if (epoch !== this.loadEpoch) {
      if (this.refreshQueued) {
        this.refreshQueued = false;
        await this.loadMore();
      } else {
        this.stopWaiting(ticker);
        this.applyLoadingState();
      }
      return;
    }
    this.stopWaiting(ticker);
    this.applyLoadingState();
    if (this.moreBtn) {
      this.moreBtn.disabled = false;
      this.moreBtn.setText("Load more");
      this.moreBtn.show();
    }
    if (page === null) return;
    if (this.skip === 0 && page.length === 0) {
      this.listEl?.createEl("p", {
        cls: "ngb-settings-note",
        text: "No commits yet (or the repository is not reachable)."
      });
      this.moreBtn?.hide();
      return;
    }
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn?.hide();
    }
    this.entries.push(...page);
    this.skip += page.length;
    for (const e of page) this.renderCommit(e);
  }
  /**
   * The in-list wait indicator. One per panel, reused rather than duplicated:
   * a refresh that has to wait for a request in flight puts it there, and the
   * load that follows finds it already showing instead of adding a second.
   *
   * `refresh()` clears the field, because `renderShell` throws the element away
   * with the rest of the list.
   */
  startWaiting() {
    if (!this.listEl) return null;
    if (this.waitingEl === null) {
      this.waitingEl = this.listEl.createDiv({ cls: "ngb-filehist-waiting" });
    }
    return this.renderWaiting(this.waitingEl, "Loading history");
  }
  /** Takes the indicator down, unless a later wait has taken it over. */
  stopWaiting(id) {
    if (id !== null && id !== this.waitTicker) return;
    this.waitingEl?.remove();
    this.waitingEl = null;
    this.stopWaitTicker(id);
  }
  /** "The runner is working" indicator, identical in all four panels. */
  renderWaiting(el, what) {
    el.empty();
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    (0, import_obsidian9.setIcon)(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? `${what}\u2026` : p);
    };
    tick();
    this.stopWaitTicker();
    this.waitTicker = this.registerInterval(window.setInterval(tick, 500));
    return this.waitTicker;
  }
  /**
   * With an id, stops only while that wait still owns the ticker. A request
   * that finishes must not clear the indicator a later one is using: that is
   * how the panel came to show a spinner with a frozen progress line.
   */
  stopWaitTicker(id) {
    if (this.waitTicker === null) return;
    if (id !== void 0 && id !== null && id !== this.waitTicker) return;
    window.clearInterval(this.waitTicker);
    this.waitTicker = null;
  }
  renderCommit(e) {
    if (!this.listEl) return;
    const wrap = this.listEl.createDiv({ cls: "ngb-hist-commit" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header ngb-hist-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    const open = this.expanded.has(e.hash);
    (0, import_obsidian9.setIcon)(chevron, open ? "chevron-down" : "chevron-right");
    const titles = header.createDiv({ cls: "ngb-hist-titles" });
    titles.createDiv({ cls: "ngb-hist-subject", text: e.subject || "(no subject)" });
    titles.createDiv({
      cls: "ngb-settings-note ngb-hist-meta",
      text: `${e.hash.slice(0, 8)} \xB7 ${e.date.slice(0, 16).replace("T", " ")} \xB7 ${e.author}`
    });
    renderCountBadge(header, e.files.length, (n) => `${n} files changed in ${e.hash.slice(0, 8)}`);
    const body = wrap.createDiv({ cls: "ngb-sv-list" });
    const renderBody = () => {
      body.empty();
      if (!this.expanded.has(e.hash)) return;
      const budget = this.fileBudget(e.hash);
      let drawn = 0;
      const room = () => drawn < budget;
      const draw = (f, depth) => {
        if (!room()) return;
        drawn += 1;
        this.renderFile(body, f, e, depth);
      };
      if (this.actions.treeView()) {
        const tree = buildPathTree(e.files, (f) => f.path);
        for (const f of tree.rootItems) draw(f, 0);
        for (const n of tree.folders) drawn = this.renderFolderNode(body, n, e, 0, renderBody, drawn, budget);
      } else {
        for (const f of e.files) draw(f, 0);
      }
      if (e.files.length > drawn) this.renderMore(body, e, drawn, renderBody);
    };
    header.addEventListener("click", () => {
      if (this.expanded.has(e.hash)) this.expanded.delete(e.hash);
      else this.expanded.add(e.hash);
      (0, import_obsidian9.setIcon)(chevron, this.expanded.has(e.hash) ? "chevron-down" : "chevron-right");
      renderBody();
    });
    renderBody();
  }
  /** Collapsible folder row inside a commit's file tree. */
  /** Rows this commit may draw: the budget, plus anything the user asked for. */
  fileBudget(hash) {
    const page = Math.max(1, Math.floor(this.actions.rowsPerGroup()));
    return page + (this.extraRows.get(hash) ?? 0);
  }
  /**
   * "N of M shown", at the end of the commit's list.
   *
   * Placed where the list stops rather than in the header: the header already
   * carries the real total, and a control that explains a truncation belongs
   * where the truncation is visible.
   */
  renderMore(body, e, shown, rerenderBody) {
    const row = body.createDiv({ cls: "ngb-sv-file ngb-sv-more-children" });
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    main.createSpan({
      cls: "ngb-settings-note",
      text: `${shown} of ${e.files.length} shown \u2014 tap for more`
    });
    row.addEventListener("click", () => {
      const page = Math.max(1, Math.floor(this.actions.rowsPerGroup()));
      this.extraRows.set(e.hash, (this.extraRows.get(e.hash) ?? 0) + page);
      rerenderBody();
    });
  }
  renderFolderNode(body, node, e, depth, rerenderBody, drawn, budget) {
    const row = body.createDiv({ cls: `ngb-sv-file ngb-ind-${Math.min(depth, 6)}` });
    const key = `${e.hash}:${node.path}`;
    const collapsed = this.collapsedDirs.has(key);
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    const chev = main.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
    (0, import_obsidian9.setIcon)(chev, collapsed ? "chevron-right" : "chevron-down");
    main.createSpan({ cls: "ngb-sv-file-name ngb-sv-folder-name", text: `${node.name}/` });
    main.addEventListener("click", () => {
      if (collapsed) this.collapsedDirs.delete(key);
      else this.collapsedDirs.add(key);
      rerenderBody();
    });
    const acts = row.createDiv({ cls: "ngb-sv-file-actions" });
    const spacer = acts.createEl("button", { cls: "clickable-icon ngb-sv-icon ngb-slot-inactive" });
    (0, import_obsidian9.setIcon)(spacer, "circle");
    spacer.setAttribute("aria-hidden", "true");
    spacer.tabIndex = -1;
    renderCountBadge(row, node.count, (n) => `${n} files in ${node.path}/`);
    if (collapsed) return drawn;
    for (const f of node.items) {
      if (drawn >= budget) return drawn;
      drawn += 1;
      this.renderFile(body, f, e, depth + 1);
    }
    for (const ch of node.children) {
      if (drawn >= budget) return drawn;
      drawn = this.renderFolderNode(body, ch, e, depth + 1, rerenderBody, drawn, budget);
    }
    return drawn;
  }
  renderFile(body, f, e, depth) {
    const row = body.createDiv({
      cls: depth === 0 ? "ngb-sv-file" : `ngb-sv-file ngb-ind-${Math.min(depth, 6)}`
    });
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName2(f.path) });
    name.setAttribute("aria-label", `${f.path} @ ${e.hash.slice(0, 8)}`);
    if (f.origPath) {
      const from = main.createSpan({
        cls: "ngb-settings-note ngb-hist-rename",
        text: `\u2190 ${displayName2(f.origPath)}`
      });
      from.setAttribute("aria-label", `moved from ${f.origPath}`);
      revealOnTap(from, describeMove(f.origPath, f.path), { align: "left" });
    }
    main.addEventListener("click", () => this.actions.openDiffAtCommit(f, e));
    attachContextMenu(row, (pos) => this.actions.fileMenu(f, e, pos));
    const acts = row.createDiv({ cls: "ngb-sv-file-actions" });
    const openBtn = acts.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    openBtn.setAttribute("aria-label", "Open file (current version)");
    (0, import_obsidian9.setIcon)(openBtn, "go-to-file");
    openBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.actions.openFile(f.path);
    });
    const codeEl = row.createSpan({ cls: `ngb-sv-file-code ngb-code-${f.code}`, text: f.code });
    codeEl.setAttribute("aria-label", f.code);
  }
  /** Number of loaded commits (used by tests and diagnostics). */
  get loadedCount() {
    return this.entries.length;
  }
  get isExhausted() {
    return this.exhausted;
  }
};
function displayName2(path) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

// src/ui/DiffView.ts
var import_obsidian10 = require("obsidian");

// src/git/inlineDiff.ts
var INLINE_DIFF_TOKEN_LIMIT = 400;
var INLINE_DIFF_CHAR_LIMIT = 300;
function tokenizeLine(line) {
  return line.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}
function inlineDiff(before, after, unit = "word") {
  if (before === after) {
    return { before: single(before, "same"), after: single(after, "same") };
  }
  const a = tokenizeLine(before);
  const b = tokenizeLine(after);
  if (a.length > INLINE_DIFF_TOKEN_LIMIT || b.length > INLINE_DIFF_TOKEN_LIMIT) {
    return { before: single(before, "remove"), after: single(after, "add") };
  }
  const beforeRuns = new RunBuilder();
  const afterRuns = new RunBuilder();
  const emit = (g) => {
    if (g.removed === g.added) {
      beforeRuns.push("same", g.removed);
      afterRuns.push("same", g.added);
      return;
    }
    if (g.removed !== "") beforeRuns.push("remove", g.removed);
    if (g.added !== "") afterRuns.push("add", g.added);
  };
  for (const g of diffGroups(a, b)) {
    if (unit === "char" && refinable(g)) {
      for (const fine of diffGroups(characters(g.removed), characters(g.added))) emit(fine);
    } else {
      emit(g);
    }
  }
  return { before: beforeRuns.done(), after: afterRuns.done() };
}
function diffGroups(a, b) {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      lcs[i2][j2] = a[i2] === b[j2] ? lcs[i2 + 1][j2 + 1] + 1 : Math.max(lcs[i2 + 1][j2], lcs[i2][j2 + 1]);
    }
  }
  const out = [];
  let shared = "";
  let removed = "";
  let added = "";
  const flushChange = () => {
    if (removed === "" && added === "") return;
    out.push({ removed, added });
    removed = added = "";
  };
  const flushShared = () => {
    if (shared === "") return;
    out.push({ removed: shared, added: shared });
    shared = "";
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flushChange();
      shared += a[i];
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      flushShared();
      removed += a[i];
      i++;
    } else {
      flushShared();
      added += b[j];
      j++;
    }
  }
  flushShared();
  for (; i < n; i++) removed += a[i];
  for (; j < m; j++) added += b[j];
  flushChange();
  return out;
}
function refinable(g) {
  if (g.removed === "" || g.added === "") return false;
  return g.removed.length <= INLINE_DIFF_CHAR_LIMIT && g.added.length <= INLINE_DIFF_CHAR_LIMIT;
}
function characters(text) {
  return Array.from(text);
}
function pairLineBlocks(before, after, unit = "word") {
  const out = {
    before: new Array(before.length).fill(null),
    after: new Array(after.length).fill(null)
  };
  for (let k = 0; k < Math.min(before.length, after.length); k++) {
    const r = inlineDiff(before[k], after[k], unit);
    if (!worthHighlighting(r.before)) continue;
    out.before[k] = r.before;
    out.after[k] = r.after;
  }
  return out;
}
function single(text, kind) {
  return text === "" ? [] : [{ text, kind }];
}
var RunBuilder = class {
  constructor() {
    this.runs = [];
  }
  push(kind, text) {
    const last = this.runs[this.runs.length - 1];
    if (last && last.kind === kind) last.text += text;
    else this.runs.push({ kind, text });
  }
  done() {
    return this.runs;
  }
};
function worthHighlighting(runs) {
  return runs.some((r) => r.kind === "same" && r.text.trim() !== "");
}

// src/git/unifiedDiff.ts
var HUNK_RE = /^@@+ -(\d+)(?:,\d+)?(?: -\d+(?:,\d+)?)* \+(\d+)(?:,\d+)? @@/;
function parseUnifiedDiff(diff, unit = "word") {
  const files = [];
  let file = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  const insideHunk = () => hunk !== null && oldLeft + newLeft > 0;
  const ensureFile = () => {
    if (!file) {
      file = { path: "", hunks: [] };
      files.push(file);
    }
    return file;
  };
  const body = diff.endsWith("\n") ? diff.slice(0, -1) : diff;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      file = { path: "", hunks: [] };
      files.push(file);
      hunk = null;
      oldLeft = newLeft = 0;
      continue;
    }
    const m = HUNK_RE.exec(line);
    if (m) {
      hunk = { header: line, lines: [] };
      ensureFile().hunks.push(hunk);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      const counts = hunkCounts(line);
      oldLeft = counts.old;
      newLeft = counts.new;
      continue;
    }
    if (!insideHunk() && line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      ensureFile().path = p === "/dev/null" ? "" : p.replace(/^[abciwo]\//, "");
      continue;
    }
    if (hunk === null) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "insert", text: line.slice(1), oldNumber: null, newNumber: newNo++ });
      if (newLeft > 0) newLeft--;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "delete", text: line.slice(1), oldNumber: oldNo++, newNumber: null });
      if (oldLeft > 0) oldLeft--;
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({
        kind: "context",
        text: line.slice(1),
        oldNumber: oldNo++,
        newNumber: newNo++
      });
      if (oldLeft > 0) oldLeft--;
      if (newLeft > 0) newLeft--;
    }
  }
  for (const f of files) for (const h of f.hunks) pairChangedLines(h.lines, unit);
  return files;
}
function hunkLineRange(hunk) {
  for (const side of ["new", "old"]) {
    const nums = hunk.lines.map((l) => side === "new" ? l.newNumber : l.oldNumber).filter((n) => n !== null);
    if (nums.length > 0) return { side, from: Math.min(...nums), to: Math.max(...nums) };
  }
  return null;
}
function hunkCounts(header) {
  const m = /@@+ -(\d+)(?:,(\d+))?(?: -\d+(?:,\d+)?)* \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!m) return { old: 0, new: 0 };
  return {
    old: m[2] === void 0 ? 1 : Number(m[2]),
    new: m[4] === void 0 ? 1 : Number(m[4])
  };
}
function pairChangedLines(lines, unit) {
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "delete") {
      i++;
      continue;
    }
    let d = i;
    while (d < lines.length && lines[d].kind === "delete") d++;
    let a = d;
    while (a < lines.length && lines[a].kind === "insert") a++;
    const dels = lines.slice(i, d);
    const adds = lines.slice(d, a);
    const runs = pairLineBlocks(
      dels.map((l) => l.text),
      adds.map((l) => l.text),
      unit
    );
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const del = dels[k];
      const ins = adds[k];
      del.paired = true;
      ins.paired = true;
      const b = runs.before[k];
      const af = runs.after[k];
      if (b !== null && b !== void 0 && af !== null && af !== void 0) {
        del.runs = b;
        ins.runs = af;
      }
    }
    i = a > i ? a : i + 1;
  }
}

// src/ui/diffDom.ts
var NBSP = "\xA0";
function renderUnifiedDiff(parent, diff, opts = {}) {
  const wrapper = parent.createDiv({ cls: "d2h-wrapper" });
  let hunkIndex = 0;
  for (const file of parseUnifiedDiff(diff, opts.unit)) {
    const fileWrap = wrapper.createDiv({ cls: "d2h-file-wrapper" });
    const table = fileWrap.createDiv({ cls: "d2h-file-diff" }).createDiv({ cls: "d2h-code-wrapper" }).createEl("table", { cls: "d2h-diff-table" });
    const tbody = table.createEl("tbody", { cls: "d2h-diff-tbody" });
    for (const hunk of file.hunks) {
      renderHunkHeader(tbody, hunk.header, hunk, hunkIndex, opts);
      const pickable = new Set(selectableLines(hunk));
      const last = hunk.lines.length - 1;
      hunk.lines.forEach((line, i) => {
        const tr = renderLine(tbody, line, hunkIndex, i, pickable.has(i) ? opts : {});
        if (i === last) tr.addClass("ngb-hunk-end");
      });
      hunkIndex++;
    }
  }
  return wrapper;
}
function renderHunkHeader(tbody, header, hunk, hunkIndex, opts) {
  const tr = tbody.createEl("tr", { cls: "ngb-hunk-start" });
  const cell = tr.createEl("td", { cls: "d2h-info" });
  cell.setAttribute("colspan", "2");
  cell.createDiv({ cls: "d2h-code-line", text: header });
  const bar = cell.createDiv({ cls: "ngb-hunk-bar" });
  if (opts.hunkBar) opts.hunkBar(bar, hunk, hunkIndex);
  else renderHunkRange(bar, hunk);
}
function renderHunkRange(bar, hunk) {
  const range2 = hunkLineRange(hunk);
  if (range2 === null) return;
  const text = range2.from === range2.to ? `${range2.from}` : `${range2.from}-${range2.to}`;
  const el = bar.createSpan({ cls: "ngb-hunk-range", text });
  el.setAttribute(
    "aria-label",
    range2.side === "new" ? `Lines ${text} of the file` : `Lines ${text} of the previous version`
  );
}
function renderLine(tbody, line, hunkIndex, lineIndex, opts) {
  const kindCls = line.kind === "insert" ? "d2h-ins" : line.kind === "delete" ? "d2h-del" : "d2h-cntx";
  const cls = line.paired === true ? `${kindCls} d2h-change` : kindCls;
  const tr = tbody.createEl("tr");
  const gutter = tr.createEl("td", { cls: `d2h-code-linenumber ${cls}` });
  const num1 = gutter.createDiv({
    cls: "line-num1",
    text: line.oldNumber === null ? "" : String(line.oldNumber)
  });
  const num2 = gutter.createDiv({
    cls: "line-num2",
    text: line.newNumber === null ? "" : String(line.newNumber)
  });
  if (opts.lineCheckbox) {
    const slot = line.oldNumber === null ? num1 : line.newNumber === null ? num2 : null;
    if (slot !== null) {
      const box = slot.createEl("input", { cls: "ngb-line-pick" });
      box.type = "checkbox";
      opts.lineCheckbox(box, hunkIndex, lineIndex);
    }
  }
  gutter.createSpan({
    cls: "d2h-code-line-prefix",
    text: line.kind === "insert" ? "+" : line.kind === "delete" ? "-" : NBSP
  });
  const code = tr.createEl("td", { cls }).createDiv({ cls: "d2h-code-line" });
  const ctn = code.createSpan({ cls: "d2h-code-line-ctn" });
  if (line.runs === void 0) ctn.setText(line.text);
  else renderInlineRuns(ctn, line.runs, line.kind === "insert" ? "after" : "before");
  return tr;
}
function renderInlineRuns(ctn, runs, side) {
  const mark = side === "after" ? "add" : "remove";
  for (const run of runs) {
    if (run.kind === "same") ctn.appendText(run.text);
    else if (run.kind === mark) ctn.createEl(side === "after" ? "ins" : "del", { text: run.text });
  }
}

// src/git/diffBudget.ts
var DOM_NODES_PER_LINE = 12;
var KB = 1024;
function describeDiffBudget(f) {
  if (f.hunksTotal === 0 || f.hunksShown >= f.hunksTotal) return null;
  const bytesPerLine = f.linesShown > 0 ? Math.max(1, f.limitBytes / f.linesShown) : 40;
  const estimatedLines = Math.round(f.totalBytes / bytesPerLine);
  const wantKb = Math.ceil(f.totalBytes / KB);
  const cappedByTransport = wantKb > DIFF_LIMIT_ABSOLUTE_MAX_KB;
  const overrideKb = Math.min(wantKb, DIFF_LIMIT_ABSOLUTE_MAX_KB);
  const shown = f.hunksShown === 0 ? `None of the ${f.hunksTotal} hunks fit in ${fmtKb(f.limitBytes)}` : `Showing ${f.hunksShown} of ${f.hunksTotal} hunks (${fmtKb(f.limitBytes)} limit)`;
  return {
    text: `${shown}. The whole diff is ${fmtKb(f.totalBytes)}.`,
    overrideLabel: cappedByTransport ? `Show as much as possible (${DIFF_LIMIT_ABSOLUTE_MAX_KB / KB} MB)` : "Show the whole diff",
    overrideKb,
    estimatedLines,
    cappedByTransport
  };
}
function overrideWarning(n) {
  const nodes = n.estimatedLines * DOM_NODES_PER_LINE;
  const lines = [
    `This diff is about ${n.estimatedLines.toLocaleString()} lines, which the panel renders as roughly ${approx(nodes)} elements.`,
    "Building it can take a few seconds and the pane may scroll roughly afterwards. The limit in settings is unchanged; this applies to this diff only."
  ];
  if (n.cappedByTransport) {
    lines.push(
      `The diff is larger than one request can carry, so even this shows only the first ${DIFF_LIMIT_ABSOLUTE_MAX_KB / KB} MB of it.`
    );
  }
  return lines;
}
function fmtKb(bytes) {
  if (bytes >= KB * KB) return `${(bytes / (KB * KB)).toFixed(1)} MB`;
  return `${Math.round(bytes / KB)} KB`;
}
function approx(n) {
  if (n < 1e3) return String(n);
  const rounded = n < 1e4 ? Math.round(n / 100) * 100 : Math.round(n / 1e3) * 1e3;
  return rounded.toLocaleString();
}

// src/git/hunkActions.ts
var STAGE = {
  action: "stage",
  label: "Stage hunk",
  selectedLabel: "Stage selected",
  target: "index",
  reverse: false,
  destructive: false
};
var UNSTAGE = {
  action: "unstage",
  label: "Unstage hunk",
  selectedLabel: "Unstage selected",
  target: "index",
  reverse: true,
  destructive: false
};
var DISCARD = {
  action: "discard",
  label: "Discard hunk",
  selectedLabel: "Discard selected",
  target: "worktree",
  reverse: true,
  destructive: true
};
function hunkActionsFor(from, to) {
  if (to === "INDEX") return [UNSTAGE];
  if (from === "INDEX" && to === "WORKTREE") return [STAGE, DISCARD];
  return [];
}
function supportsLineSelection(from, to) {
  return hunkActionsFor(from, to).length > 0;
}

// src/ui/DiffView.ts
var NGB_DIFF_VIEW = "native-git-bridge-diff";
function markInvisibles(root, selector = ".d2h-code-line-ctn") {
  for (const ctn of Array.from(root.querySelectorAll(selector))) {
    if (ctn.querySelector(".ngb-ws-glyph")) continue;
    const walker = ctn.ownerDocument.createTreeWalker(ctn, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) textNodes.push(n);
    for (const node of textNodes) {
      const text = node.nodeValue ?? "";
      if (!/[ \t\r]/.test(text)) continue;
      const frag = ctn.ownerDocument.createDocumentFragment();
      for (const part of text.split(/([ \t\r]+)/)) {
        if (part === "") continue;
        if (/^[ \t\r]+$/.test(part)) {
          const span = ctn.createSpan({
            cls: "ngb-ws-glyph",
            text: part.replace(/ /g, "\xB7").replace(/\t/g, "\u2192").replace(/\r/g, "\u240D")
          });
          frag.appendChild(span);
        } else {
          frag.appendChild(ctn.ownerDocument.createTextNode(part));
        }
      }
      node.replaceWith(frag);
    }
  }
}
function gutterWidthCh(root) {
  let digits = 1;
  for (const el of Array.from(root.querySelectorAll(".line-num1, .line-num2"))) {
    const t = (el.textContent ?? "").trim();
    if (t.length > digits) digits = t.length;
  }
  return 2 * digits + 5;
}
function sizeGutter(box) {
  const host = box.closest(".ngb-diff-view") ?? box;
  host.style.setProperty("--ngb-diff-gutter-w", `${gutterWidthCh(box)}ch`);
}
var DiffView = class extends import_obsidian10.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.state = null;
    /** Guards against a stale fetch rendering over a newer one. */
    this.loadSeq = 0;
    /** Interval behind the wait indicator; one per loaded diff. */
    this.waitTicker = null;
    /** Last fetched diff, cached so display toggles re-render without a Termux round trip. */
    this.lastResult = null;
    /**
     * Budget the user accepted for THIS diff, in KB. Reset whenever the pane is
     * pointed at a different diff, so an override never leaks to the next one.
     */
    this.overrideKb = null;
    /** Line-picking mode: off by default, reset whenever the diff is reloaded. */
    this.picking = false;
    /** Picked lines, as "<hunkIndex>:<lineIndex>" — the coordinate buildHunkPatch takes. */
    this.picked = /* @__PURE__ */ new Set();
    /**
     * The same hunks parsed the other way, for restoring a block from a commit.
     * Rebuilt with every render, from the diff text the pane is showing.
     */
    this.restorableHunks = [];
    this.navigation = true;
  }
  getViewType() {
    return NGB_DIFF_VIEW;
  }
  getDisplayText() {
    if (!this.state) return "Diff";
    const base = this.state.path.split("/").pop() ?? this.state.path;
    return `Diff: ${base}`;
  }
  getIcon() {
    return "file-diff";
  }
  getState() {
    return { ...this.state ?? {} };
  }
  async setState(state, result) {
    const s = state;
    if (s && typeof s.path === "string" && typeof s.from === "string" && typeof s.to === "string") {
      const changed = this.state === null || this.state.path !== s.path || this.state.from !== s.from || this.state.to !== s.to;
      this.state = {
        path: s.path,
        from: s.from,
        to: s.to,
        label: typeof s.label === "string" ? s.label : `${s.from} \u2192 ${s.to}`
      };
      if (changed) {
        this.overrideKb = null;
        if (!this.actions.keepLineSelection()) this.picking = false;
        this.picked.clear();
      }
      await this.loadAndRender();
    }
    return super.setState(state, result);
  }
  async loadAndRender() {
    const st = this.state;
    if (!st) return;
    const seq = ++this.loadSeq;
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-diff-view");
    const head = c.createDiv({ cls: "ngb-pane-path", text: `${st.path} \xB7 ${st.label}` });
    head.setAttribute("aria-label", `${st.path} \xB7 ${st.label}`);
    const box = c.createDiv({ cls: "ngb-diff-pane-body" });
    const ticker = this.renderWaiting(box.createDiv({ cls: "ngb-filehist-waiting" }));
    const res = await this.actions.loadDiff(st.path, st.from, st.to, this.overrideKb ?? void 0);
    this.stopWaitTicker(ticker);
    if (seq !== this.loadSeq) return;
    this.lastResult = res;
    this.renderBody(box, res);
  }
  /**
   * "The runner is working" indicator, identical to the file-history panel's.
   * Returns the ticker id so the wait that started it can stop it and nothing
   * else can.
   */
  renderWaiting(el) {
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    (0, import_obsidian10.setIcon)(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? "Loading diff\u2026" : p);
    };
    tick();
    this.stopWaitTicker();
    this.waitTicker = this.registerInterval(window.setInterval(tick, 500));
    return this.waitTicker;
  }
  /**
   * With an id, stops only while that wait still owns the ticker. Same rule as
   * the two history panels: a request that finishes must not take down the
   * indicator a later one is using.
   */
  stopWaitTicker(id) {
    if (this.waitTicker === null) return;
    if (id !== void 0 && id !== null && id !== this.waitTicker) return;
    window.clearInterval(this.waitTicker);
    this.waitTicker = null;
  }
  renderBody(box, res) {
    this.contentEl.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    box.empty();
    if (res === null) {
      box.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      box.createEl("p", { cls: "ngb-ok", text: "No differences." });
      const st = this.state;
      if (st) {
        const target = st.to === "WORKTREE" ? "WORKTREE" : st.to;
        const btns = box.createDiv({ cls: "ngb-buttons ngb-buttons-top" });
        const b = btns.createEl("button", {
          text: target === "WORKTREE" ? "Open the file" : "Show the file at this commit"
        });
        b.addEventListener("click", () => this.actions.openFileAt(st.path, target));
      }
      return;
    }
    this.restorableHunks = parseHunks(res.diff);
    const plans = hunkActionsFor(this.state?.from ?? "", this.state?.to ?? "");
    renderUnifiedDiff(box, res.diff, {
      unit: this.actions.inlineUnit(),
      hunkBar: (bar, hunk, i) => this.renderHunkBar(bar, hunk, i, plans),
      lineCheckbox: this.picking ? (b, hunkIndex, lineIndex) => {
        const key = `${hunkIndex}:${lineIndex}`;
        b.checked = this.picked.has(key);
        b.addEventListener("change", () => {
          if (b.checked) this.picked.add(key);
          else this.picked.delete(key);
          this.refreshHunkBars();
        });
      } : void 0
    });
    sizeGutter(box);
    this.renderBudgetNotice(box, res);
    this.applyDisplayPrefs();
  }
  /**
   * One hunk's controls: its actions, which lines of the file it is, and the
   * toggle that switches the pane between whole-hunk and picked-lines.
   *
   * The toggle sits beside the actions rather than in the pane header because it
   * changes what those very buttons do, and a control that changes another
   * control belongs next to it. It used to be pushed to the far end with
   * `margin-left: auto`, which worked only in the wrapped layout: without
   * wrapping the table is as wide as the longest line of code, so "the far end"
   * was somewhere off the right of the horizontal scroller and the toggle could
   * not be reached at all. Every control now sits at the start of the row, in
   * the order it is used.
   */
  renderHunkBar(bar, hunk, hunkIndex, plans) {
    const selected = this.selectionFor(hunk, hunkIndex);
    const empty = this.picking && !selectionHasChanges(hunk, selected);
    for (const plan of plans) {
      const btn = bar.createEl("button", {
        cls: plan.destructive ? "ngb-hunk-btn mod-warning" : "ngb-hunk-btn",
        text: this.picking ? plan.selectedLabel : plan.label
      });
      btn.disabled = empty;
      btn.addEventListener("click", () => {
        void this.runHunkAction(plan, hunk, hunkIndex);
      });
    }
    const st = this.state;
    const restorable = this.restorableHunks[hunkIndex];
    if (plans.length === 0 && st && restorable && st.to !== "WORKTREE" && st.to !== "INDEX") {
      const b = bar.createEl("button", { cls: "ngb-hunk-btn" });
      (0, import_obsidian10.setIcon)(b.createSpan({ cls: "ngb-hunk-btn-icon" }), "rotate-ccw");
      b.createSpan({ text: "Restore this block" });
      b.setAttribute("aria-label", `Restore this block from ${st.to.slice(0, 8)}`);
      b.addEventListener("click", () => {
        void this.actions.restoreBlock(st.path, restorable, st.to);
      });
    }
    renderHunkRange(bar, hunk);
    if (!supportsLineSelection(this.state?.from ?? "", this.state?.to ?? "")) return;
    const toggle = bar.createEl("button", { cls: "ngb-hunk-btn ngb-hunk-pick-toggle" });
    const toggleLabel = this.picking ? "Select hunk" : "Select lines";
    toggle.setAttribute("aria-label", toggleLabel);
    (0, import_obsidian10.setIcon)(toggle.createSpan({ cls: "ngb-hunk-btn-icon" }), this.picking ? "square" : "list-checks");
    if (!import_obsidian10.Platform.isPhone) toggle.createSpan({ text: toggleLabel });
    toggle.addEventListener("click", () => {
      this.picking = !this.picking;
      this.picked.clear();
      const box = this.contentEl.querySelector(".ngb-diff-pane-body");
      if (box) this.renderBody(box, this.lastResult);
    });
  }
  /** Which lines of this hunk are picked. Whole hunk when not in picking mode. */
  selectionFor(hunk, hunkIndex) {
    if (!this.picking) return new Set(selectableLines(hunk));
    const out = /* @__PURE__ */ new Set();
    for (const i of selectableLines(hunk)) {
      if (this.picked.has(`${hunkIndex}:${i}`)) out.add(i);
    }
    return out;
  }
  /** Relabel and re-enable the bars after a checkbox changed, without rebuilding the diff. */
  refreshHunkBars() {
    const box = this.contentEl.querySelector(".ngb-diff-pane-body");
    if (!box || !this.lastResult) return;
    const hunks = parseUnifiedDiff(this.lastResult.diff).flatMap((f) => f.hunks);
    const bars = Array.from(box.querySelectorAll(".ngb-hunk-bar"));
    bars.forEach((bar, i) => {
      const hunk = hunks[i];
      if (!hunk) return;
      const empty = !selectionHasChanges(hunk, this.selectionFor(hunk, i));
      const actions = Array.from(bar.querySelectorAll(".ngb-hunk-btn")).filter(
        (b) => !b.hasClass("ngb-hunk-pick-toggle")
      );
      for (const b of actions) b.disabled = empty;
    });
  }
  /**
   * Build the patch for one hunk and send it. Reloads afterwards, because the
   * diff the pane is showing is exactly what the action changed.
   */
  async runHunkAction(plan, hunk, hunkIndex) {
    const st = this.state;
    if (!st) return;
    const selected = this.selectionFor(hunk, hunkIndex);
    const patch = buildHunkPatch({
      path: st.path,
      hunk,
      selected: this.picking ? selected : void 0
    });
    if (patch === null) return;
    if (plan.destructive && !await this.actions.confirmDiscard(selected.size)) return;
    if (!await this.actions.applyPatch(patch, plan.target, plan.reverse)) return;
    this.picked.clear();
    await this.loadAndRender();
  }
  /**
   * What the budget left out, and the one-tap way to get it.
   *
   * Placed after the diff rather than before it: the user came to read the
   * change, and a diff that fits says nothing here at all.
   */
  renderBudgetNotice(box, res) {
    const notice = describeDiffBudget({
      hunksShown: res.hunksShown,
      hunksTotal: res.hunksTotal,
      totalBytes: res.totalBytes,
      limitBytes: res.limitBytes,
      linesShown: box.querySelectorAll(".d2h-code-line-ctn").length
    });
    if (!notice) return;
    const wrap = box.createDiv({ cls: "ngb-warning ngb-diff-budget" });
    wrap.createDiv({ text: notice.text });
    if (notice.overrideLabel === null) return;
    const btn = wrap.createEl("button", { text: notice.overrideLabel });
    btn.addEventListener("click", () => {
      void (async () => {
        const kb = await this.actions.confirmLargerDiff(notice);
        if (kb === null) return;
        this.overrideKb = kb;
        await this.loadAndRender();
      })();
    });
  }
  /**
   * Apply the display preferences to whatever is currently rendered. Kept
   * separate from rendering and idempotent, because the pane is REUSED for
   * every diff: a single "apply once, right after building the DOM" step
   * silently lost the glyphs whenever a later render, a re-attach or a
   * layout change replaced or re-measured that DOM.
   */
  applyDisplayPrefs() {
    this.contentEl.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    const box = this.contentEl.querySelector(".ngb-diff-pane-body");
    if (!box) return;
    const wanted = this.actions.showInvisibles();
    const present = box.querySelector(".ngb-ws-glyph") !== null;
    if (wanted && !present) markInvisibles(box);
    else if (!wanted && present) this.renderBody(box, this.lastResult);
    else sizeGutter(box);
    this.applyColors();
  }
  /**
   * Custom colours (shared preference, off by default) are written as inline
   * CSS variables on the pane, which is the only way to beat the stylesheet's
   * own defaults on the same element. Turning the toggle off removes them, so
   * the theme takes over again with no reload.
   */
  applyColors() {
    const c = this.actions.colors();
    for (const name of DIFF_COLOR_VARS) {
      if (c && c[name]) this.contentEl.style.setProperty(name, c[name]);
      else this.contentEl.style.removeProperty(name);
    }
  }
  /** Re-render from the cached diff when a display preference changed. */
  refreshDisplay() {
    const box = this.contentEl.querySelector(".ngb-diff-pane-body");
    if (box) this.renderBody(box, this.lastResult);
    else this.applyDisplayPrefs();
  }
  /**
   * Obsidian calls this whenever the pane's size changes, including the first
   * time a reused pane becomes visible at its real width. Re-applying here is
   * what keeps wrapped lines inside the pane instead of measuring against the
   * width some earlier diff happened to be rendered at.
   */
  onResize() {
    this.applyDisplayPrefs();
  }
  async onOpen() {
    if (!this.state) {
      this.contentEl.createEl("p", { cls: "ngb-settings-note", text: "No diff selected." });
      return;
    }
    this.applyDisplayPrefs();
  }
};

// src/ui/ConflictView.ts
var import_obsidian11 = require("obsidian");

// src/git/conflictParser.ts
function markerLabel(line, marker) {
  if (line.startsWith(marker)) return line.slice(marker.length).trim();
  if (line.startsWith("-" + marker)) return line.slice(marker.length + 1).trim();
  return null;
}
var isDivider = (l) => l === "=======" || l === "-=======";
function parseConflictFile(content) {
  const lines = content.split("\n");
  const segments = [];
  let plain = [];
  let conflictCount = 0;
  let i = 0;
  const flushPlain = () => {
    if (plain.length > 0) {
      segments.push({ kind: "text", lines: plain });
      plain = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const oursLabel = markerLabel(line, "<<<<<<<");
    if (oursLabel !== null) {
      const block = tryParseBlock(lines, i);
      if (block !== null) {
        flushPlain();
        segments.push({
          kind: "conflict",
          index: segments.length,
          oursLabel,
          theirsLabel: block.theirsLabel,
          ours: block.ours,
          theirs: block.theirs,
          base: block.base
        });
        conflictCount++;
        i = block.end + 1;
        continue;
      }
    }
    plain.push(line);
    i++;
  }
  flushPlain();
  return { segments, conflictCount };
}
function tryParseBlock(lines, start) {
  const ours = [];
  const base = [];
  const theirs = [];
  let mode = "ours";
  let sawBase = false;
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j];
    const closeLabel = markerLabel(l, ">>>>>>>");
    if (mode === "ours" && markerLabel(l, "|||||||") !== null) {
      mode = "base";
      sawBase = true;
    } else if ((mode === "ours" || mode === "base") && isDivider(l)) {
      mode = "theirs";
    } else if (mode === "theirs" && closeLabel !== null) {
      return { ours, theirs, base: sawBase ? base : void 0, theirsLabel: closeLabel, end: j };
    } else if (markerLabel(l, "<<<<<<<") !== null) {
      return null;
    } else {
      (mode === "ours" ? ours : mode === "base" ? base : theirs).push(l);
    }
  }
  return null;
}
function resolveBlock(parsed, blockIndex, side) {
  const out = [];
  for (const seg of parsed.segments) {
    if (seg.kind === "text") {
      out.push(...seg.lines);
    } else if (seg.index === blockIndex) {
      out.push(...side === "ours" ? seg.ours : seg.theirs);
    } else {
      out.push(`-<<<<<<< ${seg.oursLabel}`);
      out.push(...seg.ours);
      if (seg.base !== void 0) {
        out.push("-||||||| (base)");
        out.push(...seg.base);
      }
      out.push("-=======");
      out.push(...seg.theirs);
      out.push(`->>>>>>> ${seg.theirsLabel}`);
    }
  }
  return out.join("\n");
}

// src/ui/ConflictView.ts
var NGB_CONFLICT_VIEW = "native-git-bridge-conflict";
var ConflictView = class extends import_obsidian11.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.path = null;
    /** Content as last read; guards against clobbering outside edits. */
    this.originalText = null;
    this.parsed = null;
    this.loadSeq = 0;
    this.navigation = true;
  }
  /** Path this pane is resolving (whole-file resolution closes matching panes). */
  get filePath() {
    return this.path;
  }
  getViewType() {
    return NGB_CONFLICT_VIEW;
  }
  getDisplayText() {
    const base = this.path?.split("/").pop();
    return base ? `Conflict: ${base}` : "Conflict";
  }
  getIcon() {
    return "alert-triangle";
  }
  getState() {
    return { path: this.path };
  }
  async setState(state, result) {
    const s = state;
    if (s && typeof s.path === "string") {
      this.path = s.path;
      await this.reload();
    }
    return super.setState(state, result);
  }
  /**
   * Custom colours (shared preference, off by default) as inline CSS
   * variables — the only way to beat the stylesheet's defaults on the same
   * element. Removing them hands the pane back to the theme, no reload needed.
   */
  applyColors() {
    const c = this.actions.colors();
    for (const name of CONFLICT_COLOR_VARS) {
      if (c && c[name]) this.contentEl.style.setProperty(name, c[name]);
      else this.contentEl.style.removeProperty(name);
    }
  }
  async reload() {
    const path = this.path;
    if (path === null) return;
    const seq = ++this.loadSeq;
    const text = await this.actions.readFile(path);
    if (seq !== this.loadSeq) return;
    this.originalText = text;
    this.parsed = text === null ? null : parseConflictFile(text);
    this.render();
  }
  render() {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-conflict-view");
    c.toggleClass("ngb-conf-nowrap", !this.actions.wrapLines());
    this.applyColors();
    const path = this.path;
    if (path === null) {
      c.createEl("p", { cls: "ngb-settings-note", text: "No file selected." });
      return;
    }
    const head = c.createDiv({ cls: "ngb-pane-path", text: path });
    head.setAttribute("aria-label", path);
    if (this.originalText === null || this.parsed === null) {
      c.createEl("p", {
        cls: "ngb-warning",
        text: "This file cannot be shown here (binary or unreadable). Use the file's context menu: keep ours / keep theirs / open in the default app."
      });
      return;
    }
    if (this.parsed.conflictCount === 0) {
      c.createEl("p", { cls: "ngb-ok", text: "No conflict markers left in this file." });
      const btns = c.createDiv({ cls: "ngb-buttons" });
      const stage = btns.createEl("button", { text: "Mark resolved (stage this file)", cls: "mod-cta" });
      stage.addEventListener("click", () => {
        void (async () => {
          stage.disabled = true;
          const waiting = btns.createSpan({ cls: "ngb-conf-waiting" });
          waiting.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
          (0, import_obsidian11.setIcon)(waiting.children[0], "refresh-cw");
          waiting.createSpan({ cls: "ngb-settings-note", text: "Staging\u2026" });
          try {
            await this.actions.stageFile(path);
          } finally {
            waiting.remove();
            stage.disabled = false;
          }
          new import_obsidian11.Notice("Marked resolved.");
          this.leaf.detach();
        })();
      });
      return;
    }
    c.createEl("p", {
      cls: "ngb-settings-note",
      text: `${this.parsed.conflictCount} conflict${this.parsed.conflictCount === 1 ? "" : "s"} \u2014 pick a side per block. Other lines stay untouched.`
    });
    const list = c.createDiv({ cls: "ngb-conf-list" });
    const rows = list.createDiv({ cls: "ngb-conf-rows" });
    const rawMarkers = this.actions.markersVisible();
    let lineNo = 1;
    const row = (num, text, cls, runs) => {
      const r = rows.createDiv({ cls: `ngb-conf-row ${cls}` });
      r.createSpan({ cls: "ngb-conf-num", text: num === null ? "" : String(num) });
      const body = r.createSpan({ cls: "ngb-conf-text" });
      if (runs === void 0 || runs === null) body.setText(text === "" ? " " : text);
      else renderInlineRuns(body, runs, cls.includes("ngb-conf-theirs") ? "after" : "before");
      return r;
    };
    const chromeRow = (num, chip, sideCls, btnLabel, onKeep) => {
      const r = rows.createDiv({ cls: `ngb-conf-row ngb-conf-marker ${sideCls}` });
      r.createSpan({
        cls: `ngb-conf-num${num === null ? " ngb-conf-num-chrome" : ""}`,
        text: num === null ? "\u25B8" : String(num)
      });
      const body = r.createDiv({ cls: "ngb-conf-marker-body" });
      body.createSpan({ cls: "ngb-conf-side-chip", text: chip });
      const b = body.createEl("button", { text: btnLabel, cls: "ngb-conf-keep" });
      b.addEventListener("click", onKeep);
    };
    for (const seg of this.parsed.segments) {
      if (seg.kind === "text") {
        for (const l of seg.lines) row(lineNo++, l, "");
        continue;
      }
      const idx = seg.index;
      const remote = shortRefLabel(seg.theirsLabel);
      const oursChip = `Local (${seg.oursLabel || "HEAD"})`;
      const theirsChip = `Remote${remote ? ` (${remote})` : ""}`;
      const keepOursLabel = "Keep Local";
      const keepTheirsLabel = "Keep Remote";
      const keepOurs = () => void this.applyResolution(idx, "ours");
      const keepTheirs = () => void this.applyResolution(idx, "theirs");
      const marks = pairLineBlocks(seg.ours, seg.theirs, this.actions.inlineUnit());
      if (rawMarkers) {
        row(lineNo++, `<<<<<<< ${seg.oursLabel}`.trimEnd(), "ngb-conf-raw ngb-conf-ours ngb-conf-block-start");
        chromeRow(null, oursChip, "ngb-conf-ours-head", keepOursLabel, keepOurs);
      } else {
        chromeRow(lineNo++, oursChip, "ngb-conf-ours-head ngb-conf-block-start", keepOursLabel, keepOurs);
      }
      seg.ours.forEach((l, k) => row(lineNo++, l, "ngb-conf-ours", marks.before[k]));
      if (seg.base !== void 0) {
        row(lineNo++, rawMarkers ? "|||||||" : "\u2026\u2026\u2026 common ancestor:", "ngb-conf-base ngb-conf-raw");
        for (const l of seg.base) row(lineNo++, l, "ngb-conf-base");
      }
      row(lineNo++, rawMarkers ? "=======" : "\u2014\u2014\u2014", "ngb-conf-divider ngb-conf-raw");
      seg.theirs.forEach((l, k) => row(lineNo++, l, "ngb-conf-theirs", marks.after[k]));
      if (rawMarkers) {
        row(lineNo++, `>>>>>>> ${seg.theirsLabel}`.trimEnd(), "ngb-conf-raw ngb-conf-theirs");
        chromeRow(null, theirsChip, "ngb-conf-theirs-head", keepTheirsLabel, keepTheirs);
      } else {
        chromeRow(lineNo++, theirsChip, "ngb-conf-theirs-head", keepTheirsLabel, keepTheirs);
      }
    }
    if (this.actions.showInvisibles()) markInvisibles(list, ".ngb-conf-text");
  }
  async applyResolution(blockIndex, side) {
    const path = this.path;
    if (path === null || this.parsed === null || this.originalText === null) return;
    const current = await this.actions.readFile(path);
    if (current !== this.originalText) {
      new import_obsidian11.Notice("The file changed on disk \u2014 reloading instead of overwriting.");
      await this.reload();
      return;
    }
    const next = resolveBlock(this.parsed, blockIndex, side);
    await this.actions.writeFile(path, next);
    await this.reload();
  }
};
function shortRefLabel(label2) {
  const l = label2.trim();
  if (/^[0-9a-f]{12,40}$/i.test(l)) return `${l.slice(0, 8)}\u2026`;
  return l.length > 24 ? `${l.slice(0, 24)}\u2026` : l;
}

// src/ui/FileHistoryView.ts
var import_obsidian12 = require("obsidian");
var NGB_FILE_HISTORY_VIEW = "native-git-bridge-file-history";
var FileHistoryView = class extends import_obsidian12.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.path = null;
    this.entries = [];
    this.skip = 0;
    this.pageSize = 30;
    this.exhausted = false;
    this.loading = false;
    /** Interval behind the in-list wait indicator; one per load. */
    this.waitTicker = null;
    this.progressDetailEl = null;
    this.expanded = /* @__PURE__ */ new Set();
    this.listEl = null;
    this.moreBtn = null;
    /**
     * Diffs already fetched, by commit hash. Without it a theme switch or a
     * colour tweak re-ran `diff-file` in Termux for every expanded commit —
     * rerender() promises "no round trip" and now keeps that promise.
     */
    this.diffCache = /* @__PURE__ */ new Map();
    this.navigation = true;
  }
  getViewType() {
    return NGB_FILE_HISTORY_VIEW;
  }
  getDisplayText() {
    const base = this.path?.split("/").pop();
    return base ? `History: ${base}` : "File history";
  }
  getIcon() {
    return "file-clock";
  }
  getState() {
    return { path: this.path };
  }
  async setState(state, result) {
    const s = state;
    if (s && typeof s.path === "string") {
      this.path = s.path;
      this.entries = [];
      this.diffCache.clear();
      this.skip = 0;
      this.exhausted = false;
      this.expanded.clear();
      this.renderShell();
      await this.loadMore();
    }
    return super.setState(state, result);
  }
  async onOpen() {
    this.renderShell();
    if (this.path !== null && this.entries.length === 0) await this.loadMore();
  }
  /**
   * Redraw the loaded commits from memory — no Termux round trip. Used when a
   * display preference (wrap, invisibles, colours) or the theme changes, so
   * this panel follows them exactly like the diff pane does.
   */
  rerender() {
    if (this.path === null) return;
    const entries = this.entries;
    this.renderShell();
    for (const e of entries) this.renderCommit(e);
    if (!this.exhausted) this.moreBtn?.show();
  }
  renderShell() {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view", "ngb-filehist-view");
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    const head = headEl.createDiv({ cls: "ngb-filehist-path ngb-mono" });
    head.setText(this.path ?? "");
    head.setAttribute("aria-label", this.path ?? "");
    this.progressDetailEl = headEl.createDiv({ cls: "ngb-sv-progress-detail" });
    this.updatePluginProgress();
    this.listEl = body.createDiv({ cls: "ngb-hist-list" });
    const btns = body.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }
  async loadMore() {
    const path = this.path;
    if (path === null || this.loading || this.exhausted) return;
    this.loading = true;
    const waiting = this.listEl?.createDiv({ cls: "ngb-filehist-waiting" });
    const ticker = waiting ? this.renderWaiting(waiting, "Loading history") : null;
    const page = await this.actions.loadPage(path, this.skip, this.pageSize);
    waiting?.remove();
    this.stopWaitTicker(ticker);
    this.loading = false;
    if (page === null) return;
    if (this.skip === 0 && page.length === 0) {
      this.listEl?.createEl("p", {
        cls: "ngb-settings-note",
        text: "No commits touch this file yet."
      });
      return;
    }
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn?.hide();
    } else {
      this.moreBtn?.show();
    }
    this.entries.push(...page);
    this.skip += page.length;
    for (const e of page) this.renderCommit(e);
  }
  /**
   * The panel's own "the runner is working" indicator, repeated in place.
   *
   * Returns the timer it started, which the caller hands back to
   * `stopWaitTicker`. There is one ticker for the whole panel but two things
   * that wait — a page of history, and each expanded commit's diff — and
   * nothing serialises them, so the indicator can change owner while a request
   * is out.
   */
  renderWaiting(el, what) {
    el.empty();
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    (0, import_obsidian12.setIcon)(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? `${what}\u2026` : p);
    };
    tick();
    this.stopWaitTicker();
    this.waitTicker = this.registerInterval(window.setInterval(tick, 500));
    return this.waitTicker;
  }
  /**
   * Stops the wait indicator. With an id, only if that wait still owns it: a
   * request that finishes must not clear the indicator a later one is using,
   * which would leave the spinner turning with a frozen progress line.
   */
  stopWaitTicker(id) {
    if (this.waitTicker === null) return;
    if (id !== void 0 && id !== this.waitTicker) return;
    window.clearInterval(this.waitTicker);
    this.waitTicker = null;
  }
  /**
   * The plugin's per-second tick: what the runner said it is doing, on the
   * reserved line, and only while the plugin's own operation runs — this
   * panel's page loads have no stream of their own.
   */
  updatePluginProgress() {
    if (!this.progressDetailEl) return;
    const running = this.actions.progressText() !== "";
    this.progressDetailEl.setText(running ? this.actions.progressDetail() : "");
  }
  renderCommit(e) {
    if (!this.listEl) return;
    const wrap = this.listEl.createDiv({ cls: "ngb-hist-commit" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header ngb-hist-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    const open = this.expanded.has(e.hash);
    (0, import_obsidian12.setIcon)(chevron, open ? "chevron-down" : "chevron-right");
    const titles = header.createDiv({ cls: "ngb-hist-titles" });
    titles.createDiv({ cls: "ngb-hist-subject", text: e.subject || "(no subject)" });
    titles.createDiv({
      cls: "ngb-settings-note ngb-hist-meta",
      text: `${e.hash.slice(0, 8)} \xB7 ${e.date.slice(0, 16).replace("T", " ")} \xB7 ${e.author}`
    });
    titles.createDiv({ cls: "ngb-filehist-change", text: describeFileChange(e) });
    const viewAt = header.createEl("button", { cls: "ngb-filehist-restore ngb-filehist-viewat" });
    const vi = viewAt.createSpan({ cls: "ngb-filehist-restore-icon" });
    (0, import_obsidian12.setIcon)(vi, "eye");
    viewAt.setAttribute("aria-label", `Show the file as it was at ${e.hash.slice(0, 8)}`);
    viewAt.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.actions.viewAtCommit(e);
    });
    const restore = header.createEl("button", { cls: "ngb-filehist-restore" });
    const ic = restore.createSpan({ cls: "ngb-filehist-restore-icon" });
    (0, import_obsidian12.setIcon)(ic, "rotate-ccw");
    restore.createSpan({ cls: "ngb-filehist-restore-label", text: "Restore file" });
    restore.setAttribute("aria-label", `Restore this file from ${e.hash.slice(0, 8)}`);
    restore.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.path !== null) this.actions.restoreWholeFile(this.path, e);
    });
    const body = wrap.createDiv({ cls: "ngb-filehist-body" });
    header.addEventListener("click", () => {
      if (this.expanded.has(e.hash)) {
        this.expanded.delete(e.hash);
        (0, import_obsidian12.setIcon)(chevron, "chevron-right");
        body.empty();
        return;
      }
      this.expanded.add(e.hash);
      (0, import_obsidian12.setIcon)(chevron, "chevron-down");
      void this.renderCommitDiff(body, e);
    });
    if (open) void this.renderCommitDiff(body, e);
  }
  /**
   * Obsidian calls this on every size change, including a rotation. The
   * embedded diffs are the same diff2html DOM the diff pane renders, and its
   * wrapped layout is measured, so they have to be re-measured here too.
   */
  onResize() {
    for (const pane of Array.from(this.contentEl.querySelectorAll(".ngb-filehist-diff"))) {
      pane.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
      sizeGutter(pane);
    }
  }
  async renderCommitDiff(body, e) {
    body.empty();
    const cached = this.diffCache.get(e.hash);
    let res;
    if (cached !== void 0) {
      res = cached;
    } else {
      const ticker = this.renderWaiting(
        body.createDiv({ cls: "ngb-filehist-waiting" }),
        "Loading diff"
      );
      res = await this.actions.loadCommitDiff(e);
      this.stopWaitTicker(ticker);
      if (res !== null) this.diffCache.set(e.hash, res);
    }
    if (!this.expanded.has(e.hash)) return;
    body.empty();
    if (res === null) {
      body.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      body.createEl("p", { cls: "ngb-ok", text: "No differences." });
      return;
    }
    const hunks = parseHunks(res.diff);
    const pane = body.createDiv({ cls: "ngb-diff-view ngb-filehist-diff" });
    pane.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    renderUnifiedDiff(pane, res.diff, {
      unit: this.actions.inlineUnit(),
      hunkBar: (bar, _hunk, i) => {
        const hunk = hunks[i];
        if (hunk === void 0) return;
        const b = bar.createEl("button", { cls: "ngb-hunk-btn" });
        (0, import_obsidian12.setIcon)(b.createSpan({ cls: "ngb-hunk-btn-icon" }), "rotate-ccw");
        b.createSpan({ text: "Restore this block" });
        b.setAttribute("aria-label", `Restore this block from ${e.hash.slice(0, 8)}`);
        b.addEventListener("click", () => void this.restoreBlock(hunk, e));
        renderHunkRange(bar, _hunk);
      }
    });
    sizeGutter(pane);
    const colors = this.actions.colors();
    for (const name of DIFF_COLOR_VARS) {
      if (colors && colors[name]) pane.style.setProperty(name, colors[name]);
      else pane.style.removeProperty(name);
    }
    if (this.actions.showInvisibles()) markInvisibles(pane);
    if (res.truncated) {
      body.createDiv({
        cls: "ngb-warning",
        text: "Diff truncated (too large). Restoring whole blocks may be incomplete."
      });
    }
  }
  /** Put one block back the way this commit left it, or explain why not. */
  async restoreBlock(hunk, e) {
    const path = this.path;
    if (path === null) return;
    const outcome = await restoreBlockInFile(path, hunk, {
      readFile: (p) => this.actions.readFile(p),
      writeFile: (p, c) => this.actions.writeFile(p, c),
      stagePatch: (patch) => this.actions.stagePatch(patch)
    });
    new import_obsidian12.Notice(describeRestore(outcome, e.hash.slice(0, 8)));
    if (outcome.kind === "restored") this.rerender();
  }
};

// src/bridge/selfCheck.ts
var LOG_TAIL_BYTES = 4e3;
async function runSelfCheck(fs, paths, hasQueuedTimeout, profileId = "") {
  const runtimeDirExists = await safeExists(fs, paths.root);
  const queuedRequests = runtimeDirExists && await safeExists(fs, paths.requestsDir) ? (await safeList(fs, paths.requestsDir)).filter((f) => f.endsWith(".json")).map(baseName) : [];
  const logPath = `${paths.root}/runner.log`;
  const runnerLogExists = await safeExists(fs, logPath);
  let runnerLogTail = "";
  if (runnerLogExists) {
    try {
      const text = await fs.read(logPath);
      runnerLogTail = text.length > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text;
    } catch {
      runnerLogTail = "(runner.log could not be read)";
    }
  }
  const pairingFilePresent = await safeExists(fs, `${paths.root}/${PAIRING_FILE}`);
  const claimPending = await safeExists(fs, `${paths.root}/${CLAIM_FILE}`);
  let markerProfileId = "";
  try {
    const raw = await fs.read(`${paths.root}/${PROFILE_MARKER_FILE}`);
    const parsed = JSON.parse(raw);
    if (typeof parsed.profileId === "string") markerProfileId = parsed.profileId;
  } catch {
  }
  let verdict;
  let headline;
  let ok = false;
  if (!runtimeDirExists) {
    headline = "No runtime folder yet";
    verdict = "The runtime folder does not exist yet. Run a command once (it is created automatically), or complete the Termux setup.";
  } else if (!runnerLogExists) {
    headline = claimPending ? "Waiting to be paired" : "Termux has never written here";
    verdict = claimPending ? "This vault is waiting to be paired: the pairing request is still lying here, so Termux has not run yet. Open Termux (or tap 'Pair this vault' again) \u2014 the runner picks the request up on its next run." : "No runner.log in this vault's runtime folder \u2014 the Termux runner has never written here, so no profile points at THIS vault. Fix: run the install command below in Termux with this vault's path (each vault gets its own profile and token; other vaults keep working), or use 'Pair this vault' if Termux is already set up.";
  } else if (markerProfileId && profileId && markerProfileId !== profileId) {
    headline = "Profile mismatch";
    verdict = `This vault is paired with profile ${profileId}, but the runner last wrote profile ${markerProfileId} here. Re-run the install command for this vault to get the two back in step.`;
  } else if (hasQueuedTimeout && queuedRequests.length > 0) {
    headline = "Still in the queue";
    verdict = "The runner has not picked your request up yet. Usually it is just slow to start \u2014 raise 'Operation timeout' in settings and try again. If the queue never clears, the trigger is not reaching Termux: check the companion's permission and Termux's allow-external-apps.";
  } else if (queuedRequests.length > 0) {
    headline = `${queuedRequests.length} request(s) waiting`;
    verdict = `${queuedRequests.length} request(s) waiting to be processed.`;
  } else if (hasQueuedTimeout) {
    headline = "Timed out \u2014 nothing is broken";
    verdict = "The runner has your request and is still working on it. It will finish, and the result is picked up when it lands. Raise 'Operation timeout' in settings if this keeps happening.";
    ok = true;
  } else {
    headline = "Nothing is stuck";
    verdict = "The runner writes into this vault's runtime folder and no requests are waiting.";
    ok = true;
  }
  return {
    runtimeDirExists,
    queuedRequests,
    runnerLogExists,
    runnerLogTail,
    pairingFilePresent,
    profileId,
    markerProfileId,
    headline,
    claimPending,
    verdict,
    ok
  };
}
async function safeExists(fs, p) {
  try {
    return await fs.exists(p);
  } catch {
    return false;
  }
}
async function safeList(fs, p) {
  try {
    return await fs.listFiles(p);
  } catch {
    return [];
  }
}
function baseName(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// src/git/remoteUrl.ts
var MAX_REMOTE_URL_LENGTH = 512;
var REASONS = {
  empty: "Enter the repository URL.",
  "too-long": `The URL is longer than ${MAX_REMOTE_URL_LENGTH} characters.`,
  "option-like": "A URL may not start with '-': git would read it as an option, not an address.",
  "not-printable-ascii": "The URL contains a space or a character that is not plain ASCII. Copy it again from your git host.",
  credentials: "This URL carries credentials before the '@'. Use the clean https://host/\u2026 form: credentials stay in Termux (asked for once and saved there), and this plugin never handles one. A token pasted as the username is still a token \u2014 a real vault lost its working setup to exactly that shape.",
  "unsupported-scheme": "Use https://host/owner/repo.git, ssh://host/path, git@host:owner/repo.git, or file:///absolute/path for a local copy. Plain http and git:// are not accepted."
};
var PRINTABLE_ASCII = /^[!-~]+$/;
var CREDENTIALS = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/;
var HTTPS_USERINFO = /^https:\/\/[^/@]+@/i;
var SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^ ]+$/;
function validateRemoteUrl(raw) {
  const url = raw.trim();
  const fail = (problem) => ({
    ok: false,
    url,
    problem,
    reason: REASONS[problem]
  });
  if (url === "") return fail("empty");
  if (url.length > MAX_REMOTE_URL_LENGTH) return fail("too-long");
  if (url.startsWith("-")) return fail("option-like");
  if (!PRINTABLE_ASCII.test(url)) return fail("not-printable-ascii");
  if (CREDENTIALS.test(url)) return fail("credentials");
  if (HTTPS_USERINFO.test(url)) return fail("credentials");
  if (url.startsWith("https://") || url.startsWith("ssh://") || url.startsWith("file:///")) {
    return { ok: true, url };
  }
  if (SCP_LIKE.test(url)) return { ok: true, url };
  return fail("unsupported-scheme");
}
function redactRemoteUrl(url) {
  return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]+@/, "$1***@");
}
function remoteFileUrl(remote, path, commit) {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) return null;
  let host = "";
  let repo = "";
  const https = /^https:\/\/(?:[^/@]+@)?([A-Za-z0-9._-]+)\/(.+)$/.exec(remote.trim());
  const scp = /^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+):(.+)$/.exec(remote.trim());
  if (https) {
    host = https[1].toLowerCase();
    repo = https[2];
  } else if (scp) {
    host = scp[1].toLowerCase();
    repo = scp[2];
  } else {
    return null;
  }
  repo = repo.replace(/\.git$/, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) return null;
  const encPath = path.split("/").map(encodeURIComponent).join("/");
  if (host === "github.com") return `https://github.com/${repo}/blob/${commit}/${encPath}`;
  if (host === "gitlab.com") return `https://gitlab.com/${repo}/-/blob/${commit}/${encPath}`;
  return null;
}
function isValidBranchName(name) {
  if (name === "" || name.length > 100) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return false;
  if (name.includes("..") || name.includes("//")) return false;
  if (name.endsWith(".lock") || name.endsWith("/")) return false;
  return true;
}

// src/main.ts
var import_obsidian16 = require("obsidian");

// src/ui/OperationLogModal.ts
var import_obsidian13 = require("obsidian");
var OperationLogModal = class extends import_obsidian13.Modal {
  /**
   * `share` is optional so the modal can still be opened by anything that has
   * only a log to show. When it is there, the button is: copying the visible
   * list leaves out the Termux side and the stderr behind each `detail`, which
   * are the two halves that actually explain a failure.
   */
  constructor(app, log, share) {
    super(app);
    this.log = log;
    this.share = share;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: operation log");
    const c = this.contentEl;
    const topBar = c.createDiv({ cls: "ngb-buttons ngb-buttons-top" });
    addCopyButton(topBar, () => this.logAsText(), "Copy log", "Log copied.");
    if (this.share !== void 0) {
      const shareBtn = topBar.createEl("button", { text: "Share as file", cls: "mod-cta" });
      shareBtn.setAttribute("aria-label", "Everything: this log, each entry's output, and the Termux runner log");
      shareBtn.addEventListener("click", () => {
        this.close();
        this.share?.();
      });
    }
    const clearTop = topBar.createEl("button", { text: "Clear log" });
    clearTop.addEventListener("click", () => {
      this.log.clear();
      this.close();
    });
    const entries = this.log.list();
    if (entries.length === 0) {
      c.createEl("p", { text: "Log is empty." });
    } else {
      const box = c.createDiv({ cls: "ngb-output" });
      for (const e of [...entries].reverse()) {
        const line = box.createDiv({ cls: "ngb-mono" });
        line.createSpan({
          text: `${e.ts} [${e.level}] ${e.action}: ${e.message}`,
          cls: e.level === "error" ? "ngb-status-error" : e.level === "warn" ? "ngb-status-waiting" : ""
        });
        if (e.detail) {
          const details = box.createEl("details", { cls: "ngb-details" });
          details.createEl("summary", { text: "detail" });
          details.createEl("pre", { text: e.detail, cls: "ngb-mono" });
        }
      }
    }
  }
  logAsText() {
    return this.log.list().map((e) => `${e.ts} [${e.level}] ${e.action}: ${e.message}${e.detail ? "\n  " + e.detail.replace(/\n/g, "\n  ") : ""}`).join("\n");
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ops/logBundle.ts
var RUNNER_LOG_TAIL_BYTES = 64 * 1024;
function tail(s, bytes) {
  if (s.length <= bytes) return { text: s, trimmed: false };
  const cut = s.slice(s.length - bytes);
  const nl = cut.indexOf("\n");
  return { text: nl >= 0 ? cut.slice(nl + 1) : cut, trimmed: true };
}
function buildLogBundle(parts) {
  const out = [];
  out.push("Native Git Bridge \u2014 operation log bundle");
  out.push(`Collected: ${parts.now}`);
  out.push("");
  out.push("## Environment");
  for (const [k, v] of Object.entries(parts.facts)) out.push(`${k}: ${redact(v)}`);
  out.push("");
  out.push(`## Plugin operation log (${parts.entries.length} entries, oldest first)`);
  if (parts.entries.length === 0) {
    out.push("(empty)");
  } else {
    for (const e of parts.entries) {
      out.push(`${e.ts} [${e.level}] ${e.action}: ${e.message}`);
      if (e.detail !== void 0 && e.detail !== "") {
        out.push(...e.detail.split("\n").map((l) => `    ${l}`));
      }
    }
  }
  out.push("");
  out.push("## Termux runner log (runtime/runner.log)");
  if (parts.runnerLog === null) {
    out.push("(not present \u2014 the runner has not written one to this vault yet)");
  } else {
    const t = tail(parts.runnerLog, RUNNER_LOG_TAIL_BYTES);
    if (t.trimmed) out.push(`(trimmed to the last ${RUNNER_LOG_TAIL_BYTES} bytes)`);
    out.push(redact(t.text).trimEnd());
  }
  out.push("");
  const streams = parts.progress ?? [];
  out.push(`## Progress streams (${streams.length}, newest first)`);
  if (streams.length === 0) {
    out.push("(none \u2014 no recent operation streamed one, or the runner predates them)");
  } else {
    for (const s of streams) {
      out.push("");
      out.push(`### ${s.id}${s.action !== void 0 && s.action !== "" ? ` \u2014 ${s.action}` : ""}`);
      out.push(s.text === "" ? "(empty)" : s.text);
    }
  }
  out.push("");
  return out.join("\n");
}
var LOG_NOTE_GLOB = "ngb-log-*.md";
function logBundleName(now) {
  return `ngb-log-${now.replace(/[:.]/g, "-").slice(0, 19)}.txt`;
}

// src/ops/progressStream.ts
function collapseProgress(raw) {
  return raw.split("\n").map((line) => {
    const chunks = line.split("\r");
    return (chunks[chunks.length - 1] ?? "").replace(/[ \t]+$/, "");
  }).join("\n");
}
function lastProgressLine(raw, maxChars = 64) {
  const lines = collapseProgress(raw).split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (last === void 0) return null;
  const clean = redact(last);
  return clean.length > maxChars ? clean.slice(0, maxChars - 1) + "\u2026" : clean;
}
function progressForBundle(raw, maxBytes = 8 * 1024) {
  const text = redact(collapseProgress(raw)).replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= maxBytes) return text;
  const kept = text.slice(text.length - maxBytes);
  const from = kept.indexOf("\n");
  return `\u2026 (${text.length - maxBytes} earlier bytes omitted)
${from >= 0 ? kept.slice(from + 1) : kept}`;
}

// src/ops/repairJob.ts
function missingOids(fsckMissing, cap = 64) {
  const seen = /* @__PURE__ */ new Set();
  for (const m of fsckMissing.matchAll(/\b[0-9a-f]{40}\b/g)) {
    seen.add(m[0]);
    if (seen.size >= cap) break;
  }
  return [...seen];
}
function decideStaleLock(f, freshSeconds = 120) {
  if (!f.lockExists) return { kind: "no-lock" };
  if (f.liveGit && f.lockAgeSeconds !== null && f.lockAgeSeconds <= freshSeconds) {
    return { kind: "running" };
  }
  if (f.liveProcesses.length === 0) return { kind: "corpse" };
  return { kind: "ask-kill" };
}
function planRepair(f) {
  const plan = [];
  const lock = decideStaleLock(f.lock);
  if (lock.kind === "corpse") plan.push({ step: "lock", act: "remove-corpse" });
  else if (lock.kind === "running") plan.push({ step: "lock", act: "wait-running" });
  else if (lock.kind === "ask-kill") plan.push({ step: "lock", act: "ask-kill" });
  if (!f.identity.any || !f.identity.local) {
    plan.push({ step: "identity", act: "offer-set" });
  } else if (f.identity.global) {
    plan.push({ step: "identity", act: "offer-drop-global" });
  }
  if (f.globalCredHelper) plan.push({ step: "cred-helper", act: "offer-reset" });
  if (f.sparse.enabled) {
    if (f.sparse.cone) plan.push({ step: "sparse", act: "cone-needs-decision" });
    else if (f.sparse.foreign) {
      plan.push({ step: "sparse", act: "foreign-needs-decision" });
    } else if (!f.sparse.hasBase || f.sparse.hasEmptyingDefault) {
      plan.push({ step: "sparse", act: "repair-definition" });
    }
  }
  if (f.rescueBranches.length > 0) plan.push({ step: "leftovers", act: "rescue-branches" });
  if (f.previousGitDirs.length > 0) plan.push({ step: "leftovers", act: "previous-git" });
  return plan;
}
function decideRepair(stage, findings, ctx) {
  const oids = missingOids(findings.fsckMissing);
  if (oids.length === 0) {
    return findings.fsckRemaining.trim() === "" ? { kind: "clean" } : { kind: "damaged" };
  }
  if (stage === "scan") return { kind: "fetch-missing", oids };
  if (stage === "fetch-missing") return { kind: "ask-refetch" };
  if (ctx.hasUpstream && (ctx.ahead > 0 || ctx.cacheTreeBroken)) return { kind: "offer-reset" };
  return { kind: "missing-remote" };
}
function summarizeFsckMissing(text) {
  const counts = /* @__PURE__ */ new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()].map(([line, n]) => n > 1 ? `${line} (\xD7${n})` : line).join("\n");
}

// src/git/pathLimits.ts
var MAX_SEGMENT_BYTES = 200;
var MAX_PATH_CHARS = 180;
var utf8 = new TextEncoder();
function segmentBytes(segment) {
  return utf8.encode(segment).length;
}
function checkPathLimits(paths) {
  const out = [];
  for (const path of paths) {
    const segments = path.split("/");
    const name = segments[segments.length - 1] ?? "";
    const dirTooLong = segments.slice(0, -1).some((s) => segmentBytes(s) > MAX_SEGMENT_BYTES);
    if (dirTooLong || segmentBytes(name) > MAX_SEGMENT_BYTES) {
      out.push({ path, reason: "segment-bytes", needsFolderRename: dirTooLong });
      continue;
    }
    if (path.length > MAX_PATH_CHARS) {
      const dirLen = path.length - name.length;
      out.push({ path, reason: "path-length", needsFolderRename: dirLen > MAX_PATH_CHARS - 12 });
    }
  }
  return out;
}
function truncateToBytes(s, maxBytes) {
  let bytes = 0;
  let out = "";
  for (const ch of s) {
    const b = utf8.encode(ch).length;
    if (bytes + b > maxBytes) break;
    bytes += b;
    out += ch;
  }
  return out;
}
function proposeRename(path, taken) {
  const issue = checkPathLimits([path])[0];
  if (issue === void 0) return null;
  if (issue.needsFolderRename) return null;
  const cut = path.lastIndexOf("/");
  const dir = cut >= 0 ? path.slice(0, cut + 1) : "";
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const byteBudget = MAX_SEGMENT_BYTES - segmentBytes(ext) - 3;
  const charBudget = Math.max(8, MAX_PATH_CHARS - dir.length - ext.length - 3);
  let base = truncateToBytes(stem, byteBudget).slice(0, charBudget).trimEnd();
  if (base === "") base = "untitled";
  let candidate = `${dir}${base}${ext}`;
  for (let n = 2; taken.has(candidate) || candidate === path; n++) {
    candidate = `${dir}${base} ${n}${ext}`;
    if (n > 99) return null;
  }
  return candidate;
}

// src/ui/RunnerOutputView.ts
var import_obsidian14 = require("obsidian");
var NGB_OUTPUT_VIEW = "native-git-bridge-output";
var NGB_OUTPUT_ICON = "terminal";
var RunnerOutputView = class extends import_obsidian14.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    /** Text node of the stream, replaced in place so scrolling survives. */
    this.streamEl = null;
    this.streamBox = null;
    this.headlineEl = null;
    this.factsEl = null;
    this.cancelBtn = null;
    this.refreshBtn = null;
    this.wrapBtn = null;
    // Named to collide with NOTHING on the base classes: a field here was once
    // called `open`, it shadowed an untyped runtime member of Obsidian's view
    // chain, and the panel rendered black — constructor run, `onOpen` never
    // called. tsc cannot see that class of fault; prefix everything.
    this.outTab = "current";
    this.tabBtns = /* @__PURE__ */ new Map();
    /** The panel body — the ONE scroller; the console field has none of its own. */
    this.panelBodyEl = null;
    this.last = null;
    /** True while a snapshot is being gathered, so ticks cannot overlap. */
    this.polling = false;
  }
  getViewType() {
    return NGB_OUTPUT_VIEW;
  }
  getDisplayText() {
    return "Native Git output";
  }
  getIcon() {
    return NGB_OUTPUT_ICON;
  }
  async onOpen() {
    try {
      this.renderShell();
      await this.tick();
      this.registerInterval(window.setInterval(() => void this.tick(), 1e3));
    } catch (e) {
      const c = this.contentEl;
      c.empty();
      c.createEl("pre", {
        text: `The output panel could not draw itself: ${e instanceof Error ? e.stack ?? e.message : String(e)}`
      });
    }
  }
  /** One refresh: gather what the selected tab needs, update text in place. */
  async tick() {
    if (this.polling) return;
    this.polling = true;
    try {
      const snap = await this.actions.snapshot({
        runnerLog: this.outTab === "runner",
        past: this.outTab === "past",
        opLog: this.outTab === "oplog"
      });
      this.last = snap;
      this.apply(snap);
    } catch (e) {
      if (this.streamEl) {
        this.streamEl.setText(
          `Could not read the plugin's state: ${e instanceof Error ? e.message : String(e)}

Retrying every second.`
        );
      }
    } finally {
      this.polling = false;
    }
  }
  renderShell() {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view", "ngb-output-view");
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    this.panelBodyEl = body;
    const footBar = c.createDiv({ cls: "ngb-sv-footbar" });
    const mobile = import_obsidian14.Platform.isPhone;
    const bar = (mobile ? footBar : headEl).createDiv({ cls: "ngb-sv-toolbar" });
    this.tabBtns.clear();
    const tabBtn = (tab, icon, label2) => {
      const b = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon ngb-out-tab" });
      b.setAttribute("aria-label", label2);
      (0, import_obsidian14.setIcon)(b, icon);
      b.addEventListener("click", () => this.setTab(tab));
      this.tabBtns.set(tab, b);
    };
    tabBtn("current", "activity", "Live operation");
    tabBtn("past", "layers", "Earlier operations");
    tabBtn("runner", "scroll", "Termux runner log");
    tabBtn("oplog", "file-clock", "Plugin operation log");
    bar.createDiv({ cls: "ngb-out-tab-sep" });
    const wrapBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    wrapBtn.setAttribute("aria-label", "Wrap long lines");
    (0, import_obsidian14.setIcon)(wrapBtn, "wrap-text");
    wrapBtn.addEventListener("click", () => {
      void (async () => {
        await this.actions.toggleWrapLines();
        this.applyWrapState();
      })();
    });
    this.wrapBtn = wrapBtn;
    const refreshBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    refreshBtn.setAttribute("aria-label", "Read the output again now");
    (0, import_obsidian14.setIcon)(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => void this.tick());
    this.refreshBtn = refreshBtn;
    const strip = headEl.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    const cancel = stripLeft.createEl("button", {
      cls: "clickable-icon ngb-sv-icon ngb-sv-icon-warn ngb-sv-cancel-slot"
    });
    cancel.setAttribute("aria-label", "Cancel current operation");
    (0, import_obsidian14.setIcon)(cancel, "x");
    cancel.addEventListener("click", () => this.actions.cancel());
    this.cancelBtn = cancel;
    this.headlineEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    const stripRight = strip.createDiv({ cls: "ngb-sv-strip-right" });
    const histBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    histBtn.setAttribute("aria-label", "Repository history");
    (0, import_obsidian14.setIcon)(histBtn, "history");
    histBtn.addEventListener("click", () => this.actions.openHistoryPanel());
    const statusBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    statusBtn.setAttribute("aria-label", "Git panel");
    (0, import_obsidian14.setIcon)(statusBtn, "git-branch");
    statusBtn.addEventListener("click", () => this.actions.openStatusPanel());
    this.streamBox = body.createEl("pre", { cls: "ngb-out-stream" });
    this.streamEl = this.streamBox.createEl("code");
    this.streamEl.setText("Reading\u2026");
    this.headlineEl?.setText("\u2026");
    this.factsEl = body.createDiv({ cls: "ngb-out-facts" });
    this.applyTabState();
    this.applyWrapState();
  }
  /** The wrap toggle's highlight and the console's class, from the saved pref. */
  applyWrapState() {
    const on = this.actions.wrapLines();
    this.wrapBtn?.toggleClass("ngb-sv-icon-active", on);
    this.wrapBtn?.setAttribute("aria-pressed", on ? "true" : "false");
    this.streamBox?.toggleClass("ngb-out-wrap", on);
  }
  /**
   * Back to the live-operation tab. Called by whatever OPENS the panel: the
   * view survives in the workspace, so without this a tab selected an hour ago
   * is what a fresh "show me what is happening" tap would land on.
   */
  showLive() {
    if (this.outTab === "current") return;
    this.outTab = "current";
    this.applyTabState();
  }
  /**
   * Select a tab. Tapping the active one still returns to the live view (the
   * pre-Live-button habit keeps working), and the Live tab itself is idempotent
   * because "current" is what a deselection falls back to anyway.
   */
  setTab(tab) {
    this.outTab = this.outTab === tab ? "current" : tab;
    this.applyTabState();
    void this.tick();
  }
  applyTabState() {
    for (const [tab, btn] of this.tabBtns) {
      btn.toggleClass("ngb-out-tab-on", this.outTab === tab);
      btn.setAttribute("aria-pressed", this.outTab === tab ? "true" : "false");
    }
    if (this.factsEl) {
      if (this.outTab === "current") this.factsEl.show();
      else this.factsEl.hide();
    }
  }
  apply(s) {
    const running = s.action !== null;
    if (this.cancelBtn) {
      if (running) this.cancelBtn.show();
      else this.cancelBtn.hide();
    }
    this.refreshBtn?.toggleClass("ngb-anim-spin", running);
    if (this.headlineEl) {
      this.headlineEl.toggleClass("ngb-sv-progress-idle", !running);
      this.headlineEl.setText(
        s.stateText ?? (running ? `${s.action}\u2026 ${s.elapsedSeconds}s` : "Idle")
      );
    }
    if (this.streamEl && this.streamBox) {
      const text = this.contentFor(s, running);
      if (this.streamEl.textContent !== text) {
        const box = this.panelBodyEl ?? this.streamBox;
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        this.streamEl.setText(text);
        if (atBottom) box.scrollTop = box.scrollHeight;
      }
    }
    if (this.factsEl) {
      this.factsEl.empty();
      const row = (label2, value, warn = false) => {
        const r = this.factsEl.createDiv({ cls: "ngb-out-fact" });
        r.createSpan({ cls: "ngb-out-fact-label", text: label2 });
        const v = r.createSpan({ cls: "ngb-out-fact-value", text: value });
        if (warn) v.addClass("ngb-out-fact-warn");
      };
      if (running) {
        row("Request", s.requestId ?? "\u2014");
        row("Budget", `${s.timeoutSeconds}s`);
        row(
          "Companion",
          s.companionAcked ? "started Termux for this request" : "no acknowledgement yet",
          !s.companionAcked
        );
        row("Queued requests", String(s.queued), s.queued > 1);
        if (s.stream === "" && s.elapsedSeconds > 20) {
          row(
            "Nothing yet",
            "the runner may be waiting for its lock \u2014 see the runner log below",
            true
          );
        }
      } else if (s.lastVerdict !== null) {
        row("Last operation", s.lastVerdict);
      }
    }
  }
  /** What the console field shows, decided by the selected tab. */
  contentFor(s, running) {
    if (this.outTab === "runner") {
      return s.runnerLog !== "" ? s.runnerLog : "The runner has not written a log to this vault yet.";
    }
    if (this.outTab === "oplog") {
      return s.opLog !== "" ? s.opLog : "The operation log is empty.";
    }
    if (this.outTab === "past") {
      if (s.past.length === 0) return "No earlier streams. They are kept for 24 hours.";
      return s.past.map((p) => `\u2500\u2500 ${p.action} \xB7 ${p.id} \u2500\u2500
${p.text}`).join("\n\n");
    }
    return s.stream !== "" ? s.stream : running ? "Waiting for the runner to say something.\n\nA request that has only just been written shows nothing for a second or two. If this stays empty, the runner has not picked the request up \u2014 the facts below say whether it was even asked to." : "Nothing is running.\n\nThe last operation's output stays here until the next one starts.";
  }
};

// src/main.ts
var DEFAULT_SHARED_PREFS = {
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
  commitTemplates: [DEFAULT_COMMIT_TEMPLATE],
  autoCommitTemplate: DEFAULT_COMMIT_TEMPLATE,
  commitDateFormat: DEFAULT_COMMIT_DATE_FORMAT,
  treeView: false,
  customColors: false,
  colorsLight: { ...DEFAULT_COLORS.light },
  colorsDark: { ...DEFAULT_COLORS.dark }
};
function failureDetail(result) {
  const err = result.error;
  if (!err) return void 0;
  const parts = [`${err.code}: ${err.message}`];
  if (err.stdout !== void 0 && err.stdout.trim() !== "") parts.push(`stdout:
${err.stdout.trimEnd()}`);
  if (err.stderr !== void 0 && err.stderr.trim() !== "") parts.push(`stderr:
${err.stderr.trimEnd()}`);
  return parts.join("\n");
}
function abortMergeFailure(result) {
  const err = result.error;
  if (err?.code !== "GIT_FAILED") return { offerReapply: false, lines: [] };
  return {
    offerReapply: true,
    lines: [
      err.message,
      "The usual cause is a sparse checkout that has drifted from the index: aborting has to put the working tree back, and it cannot restore a file it is not allowed to materialise. Git's own output is below.",
      "Reapplying the sparse rules puts the two back in step, and the abort then normally succeeds on the next try. Nothing is deleted by it and no history is touched."
    ]
  };
}
var MARKER_KEY = "active-op";
var REPAIR_JOB_KEY = "repair-job";
var LAST_SYNC_KEY = "last-sync";
var RECENT_COMMIT_MESSAGES_KEY = "recent-commit-messages";
var NativeGitBridgePlugin = class extends import_obsidian15.Plugin {
  constructor() {
    super(...arguments);
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS };
    this.statusBar = null;
    this.activeCancel = null;
    /**
     * Every request currently in flight, oldest first (insertion order).
     *
     * Two read-only requests may overlap on purpose: only a mutation takes the
     * lock, and the runner drains its queue one at a time regardless. The
     * display, though, has one slot for the action, the path, the progress line
     * and the cancel token — so a teardown needs to know what else is running
     * before it empties them.
     */
    this.inFlight = /* @__PURE__ */ new Map();
    /**
     * How the last finished operation ended, for the output panel.
     *
     * Kept because that panel is usually opened AFTER something went wrong, and a
     * panel that says only "Idle" over the output of a failed sync leaves the
     * reader to guess whether the sync failed or never ran.
     */
    this.lastVerdict = null;
    /** Which request the display slots below currently belong to. */
    this.runningId = null;
    /**
     * The panel is showing a status nobody has read since the repository last
     * moved: an operation failed, timed out or was cancelled without bringing
     * fresh status back. Cleared the moment any status is absorbed.
     */
    this.statusStale = false;
    this.progressText = null;
    /** Human-readable step name while the multi-step repair runs, else null. */
    this.repairJobStep = null;
    /**
     * What the runner said it is doing (newest progress-stream line), kept apart
     * from `progressText` so the state line stays short and stable while this
     * one changes with every step. The panels draw it on a reserved second line.
     */
    this.progressDetail = null;
    /**
     * The newest line the runner has streamed for the request in flight, and the
     * id it belongs to. Kept as a field because the ticker that renders it is
     * synchronous and reading a file is not: the read is started from one tick
     * and shown by the next.
     */
    this.liveProgress = null;
    this.runningAction = null;
    /** Target path of the running action, when it is per-path (stage/unstage/discard file). */
    this.runningPath = null;
    this.lastStatus = null;
    this.lastAutoSyncMs = 0;
    this.statusPollId = null;
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
    this.pairingPollMs = 500;
    this.pairingWaitMs = PAIRING_WAIT_MS;
    /** Remote URL of the repository as of the last status (already redacted by the runner). */
    this.lastRemoteUrl = "";
    /**
     * Warn once per session when the Termux-side runner predates this plugin
     * build. Updating main.js in the vault does not touch the runner script, so a
     * stale runner is a genuinely common failure mode (it shows up as
     * RUNNER_INTERNAL / serialization errors).
     */
    this.runnerVersionWarned = false;
    this.companionSetupAutoOpened = false;
    /** Last runner version reported by a result (0 = never heard from). */
    this.lastRunnerVersion = 0;
    /** Probe window used by the missing-companion detection; tests shrink it. */
    this.companionProbeMs = 4e3;
    /** Time of the last obsidian://native-git-bridge-ack from the companion. */
    this.lastCompanionAckMs = 0;
    /** What the companion reported about Termux (null until the first ack). */
    this.lastAckTermuxInstalled = null;
    /** Companion version from its ack ("" until one arrives). */
    this.lastCompanionVersion = "";
    this.ackWaiters = [];
    // -------------------- repo config management (sparse / gitignore / exclude)
    /** In-memory caches so the file context menu can decide add-vs-remove synchronously. */
    this.gitignoreLines = [];
    this.excludeLines = [];
    /** Sets of no-longer-hidden protected paths already asked about this session. */
    this.sparseReconcileOffered = /* @__PURE__ */ new Set();
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
    this.lastRescueBranches = [];
  }
  async onload() {
    this.store = new DeviceLocalSettingsStore(getLocalStorageBackend(), this.resolveScopeId());
    this.deviceSettings = this.store.read();
    this.lastRunnerVersion = Number(this.store.getValue("last-runner-version") ?? 0) || 0;
    this.lastCompanionVersion = this.store.getValue("last-companion-version") ?? "";
    this.log = new OperationLog(this.store);
    const data = await this.loadData();
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS, ...data ?? {} };
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
      (leaf) => new StatusView(leaf, {
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
        finishInProgressOp: (kind) => kind === "merge" ? void this.cmdCommit() : void this.cmdContinueRebase(),
        abortInProgressOp: (kind) => kind === "merge" ? void this.cmdAbortMerge() : void this.cmdAbortRebase(),
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
          const menu = new import_obsidian15.Menu();
          this.buildGitMenu(menu, p, group);
          menu.showAtPosition(pos);
        },
        groupAction: (group, kind) => this.groupAction(group, kind),
        groupMenu: (group, pos) => {
          const menu = new import_obsidian15.Menu();
          this.buildGroupMenu(menu, group);
          menu.showAtPosition(pos);
        }
      })
    );
    this.registerView(
      NGB_HISTORY_VIEW,
      (leaf) => new HistoryView(leaf, {
        loadPage: (skip, limit) => this.loadRepoLogPage(skip, limit),
        openDiffAtCommit: (file, entry2) => void this.openCommitDiff(file, entry2),
        openFile: (p) => this.openVaultFile(p),
        // Long press / right click on a file row: the file-at-commit menu
        // (restore, view as of the commit, diff, history, copy) — the same
        // answers the file-history panel gives for the same file (item 10).
        fileMenu: (file, entry2, pos) => {
          const menu = new import_obsidian15.Menu();
          this.addMenuEntries(menu, {
            kind: "file-at-commit",
            path: file.path,
            hash: entry2.hash,
            date: entry2.date,
            subject: entry2.subject,
            code: file.code
          });
          menu.showAtPosition(pos);
        },
        progressText: () => this.progressText ?? "",
        progressDetail: () => this.progressDetail ?? "",
        openOutput: () => void this.openOutputPanel(),
        treeView: () => this.sharedPrefs.treeView,
        toggleTree: () => void this.setSharedPref({ treeView: !this.sharedPrefs.treeView }),
        openStatusPanel: () => void this.openStatusPanel(),
        rowsPerGroup: () => this.deviceSettings.rowsPerGroup
      })
    );
    this.registerView(
      NGB_DIFF_VIEW,
      (leaf) => new DiffView(leaf, {
        loadDiff: (path, from, to, limitKb) => this.loadDiffText(path, from, to, limitKb),
        applyPatch: (patch, target, reverse) => this.applyHunkPatch(patch, target, reverse),
        confirmDiscard: (lines) => new Promise((resolve) => {
          new ConfirmModal(
            this.app,
            {
              title: lines === 1 ? "Discard this line?" : `Discard ${lines} lines?`,
              body: [
                "The change is removed from the file itself. Unlike staging, this is not a move between the index and the working tree, and there is no opposite action that brings it back.",
                "Obsidian's own version history may still have the text; git will not."
              ],
              confirmLabel: "Discard",
              danger: true
            },
            (ok) => resolve(ok)
          ).open();
        }),
        confirmLargerDiff: (notice) => new Promise((resolve) => {
          new ConfirmModal(
            this.app,
            {
              title: "Show the whole diff?",
              body: overrideWarning(notice),
              confirmLabel: notice.overrideLabel ?? "Show it",
              icon: "file-diff"
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
        }
      })
    );
    this.registerView(
      NGB_FILE_HISTORY_VIEW,
      (leaf) => new FileHistoryView(leaf, {
        loadPage: (path, skip, limit) => this.loadFileLogPage(path, skip, limit),
        loadCommitDiff: (e) => this.loadDiffText(e.pathAtCommit, `${e.hash}^`, e.hash),
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
        colors: () => this.diffColorVars()
      })
    );
    this.registerView(
      NGB_OUTPUT_VIEW,
      (leaf) => new RunnerOutputView(leaf, {
        snapshot: (want) => this.outputSnapshot(want),
        cancel: () => void this.cmdCancel(),
        openStatusPanel: () => void this.openStatusPanel(),
        openHistoryPanel: () => void this.openHistoryPanel(),
        wrapLines: () => this.sharedPrefs.wrapOutputLines,
        toggleWrapLines: () => this.setSharedPref({ wrapOutputLines: !this.sharedPrefs.wrapOutputLines })
      })
    );
    this.registerView(
      NGB_CONFLICT_VIEW,
      (leaf) => new ConflictView(leaf, {
        readFile: (p) => this.readVaultTextFile(p),
        writeFile: async (p, content) => {
          await this.app.vault.adapter.write(p, content);
        },
        stageFile: (p) => this.cmdStageFile(p),
        markersVisible: () => this.sharedPrefs.showConflictMarkers,
        showInvisibles: () => this.sharedPrefs.showInvisibles,
        wrapLines: () => this.sharedPrefs.wrapDiffLines,
        inlineUnit: () => this.sharedPrefs.inlineDiffUnit,
        colors: () => this.conflictColorVars()
      })
    );
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
  registerFileMenu() {
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
  buildGitMenu(menu, path, known, kind = "file") {
    if (!import_obsidian15.Platform.isAndroidApp) return;
    if (!this.deviceSettings.enabledOnThisDevice) return;
    const v = validateRepoRelativePath(path);
    if (!v.ok) return;
    const p = v.normalized;
    const group = known ?? this.inferGroup(p);
    const scope = kind === "folder" ? { kind: "folder", path: p, group, count: this.pathsUnder(p, group).length } : { kind: "file", path: p, group };
    this.addMenuEntries(menu, scope);
  }
  /** Which panel group a path belongs to, from the last status the panel saw. */
  inferGroup(p) {
    const st = this.lastStatus?.status;
    const under = (path) => path === p || path.startsWith(p + "/");
    if (st?.conflicted.some((e) => under(e.path))) return "conflicted";
    if (st?.unstaged.some((e) => under(e.path))) return "unstaged";
    if (st?.untracked.some(under)) return "untracked";
    if (st?.staged.some((e) => under(e.path))) return "staged";
    return "unstaged";
  }
  /** Paths of a group at or under `base` (empty base = the whole group). */
  pathsUnder(base, group) {
    return this.groupPaths(group).filter(
      (f) => base === "" || f === base || f.startsWith(base + "/")
    );
  }
  /** Turn the shared menu description into real Obsidian menu items. */
  addMenuEntries(menu, scope) {
    const single2 = scope.kind === "file";
    const path = scope.kind === "group" ? "" : scope.path;
    const targets = () => scope.kind === "folder" || scope.kind === "group" ? this.pathsUnder(path, scope.group) : [path];
    const entries = buildMenuEntries(scope, {
      menuGitignore: this.deviceSettings.menuGitignore,
      menuSparse: this.deviceSettings.menuSparse,
      menuExclude: this.deviceSettings.menuExclude,
      ignored: single2 && this.isGitignored(path),
      sparseExcluded: single2 && this.isSparseExcluded(path),
      excluded: single2 && this.isExcluded(path),
      // The entry is only honest when the runner can serve it; 0 (never heard
      // from a runner) also stays silent rather than offering a refusal.
      untrack: this.lastRunnerVersion >= 14,
      remoteMappable: scope.kind === "file-at-commit" && remoteFileUrl(this.lastRemoteUrl, scope.path, scope.hash) !== null
    });
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
  runMenuAction(action, scope, targets) {
    const path = scope.kind === "group" ? "." : scope.path;
    if (scope.kind === "file-at-commit") {
      switch (action) {
        case "open-diff-at-commit":
          void this.openDiffPane({
            path: scope.path,
            from: `${scope.hash}^`,
            to: scope.hash,
            label: `${scope.hash.slice(0, 8)}^ \u2192 ${scope.hash.slice(0, 8)}`
          });
          return;
        case "show-at-commit":
          void this.showFileAtCommit(scope.path, scope.hash, scope.date);
          return;
        case "restore-from-commit":
          this.confirmRestore(scope.path, {
            hash: scope.hash,
            date: scope.date,
            author: "",
            subject: scope.subject,
            pathAtCommit: scope.path
          });
          return;
        case "open-history":
          void this.openFileHistoryPanel(scope.path);
          return;
        case "open-remote": {
          const url = remoteFileUrl(this.lastRemoteUrl, scope.path, scope.hash);
          if (url !== null) this.openExternalUri(url);
          return;
        }
        case "copy-path":
          void navigator.clipboard.writeText(scope.path);
          new import_obsidian15.Notice("Path copied.");
          return;
        default:
          return;
      }
    }
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
        new import_obsidian15.Notice("Path copied.");
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
  confirmResolveMany(paths, side) {
    if (paths.length === 0) return;
    new ConfirmModal(
      this.app,
      {
        title: side === "ours" ? "Keep the LOCAL version of these files?" : "Keep the REMOTE version of these files?",
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `\u2026and ${paths.length - 10} more` : "",
          side === "ours" ? "The incoming remote changes to these files are discarded." : "Your local changes to these files are discarded.",
          `This runs one Termux round trip per file (${paths.length} in total).`
        ].filter((l) => l !== ""),
        confirmLabel: side === "ours" ? "Keep local" : "Keep remote",
        danger: true
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) {
          const result = await this.runOperation("resolve-conflict", {
            path: p,
            side,
            protectedPaths: this.effectiveProtectedPaths()
          });
          if (!result?.ok) break;
          this.absorbStatusData(result.data ?? {});
        }
        await this.cmdStatus(true);
      }
    ).open();
  }
  /**
   * (Re)start the status auto-refresh timer (Settings → "Auto-refresh
   * status"). Fires only while the status panel exists, Obsidian is visible
   * and nothing is in flight — every refresh is a Termux round trip.
   */
  restartStatusPoll() {
    if (this.statusPollId !== null) {
      window.clearInterval(this.statusPollId);
      this.statusPollId = null;
    }
    const secs = Math.floor(this.deviceSettings.statusRefreshSeconds);
    if (!Number.isFinite(secs) || secs <= 0) return;
    this.statusPollId = window.setInterval(() => {
      void this.maybeAutoStatus();
    }, secs * 1e3);
    this.registerInterval(this.statusPollId);
  }
  async maybeAutoStatus() {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (document.visibilityState === "hidden") return;
    if (this.lock.active || this.runningAction !== null) return;
    if (this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW).length === 0) return;
    await this.cmdStatus(true);
  }
  registerAutomaticActions() {
    this.restartStatusPoll();
    const s = this.deviceSettings;
    if (s.periodicSyncMinutes > 0) {
      this.registerInterval(
        window.setInterval(() => {
          void this.maybeAutoSync("periodic");
        }, s.periodicSyncMinutes * 6e4)
      );
    }
    if (s.autoSyncOnClose) {
      const onHide = () => {
        if (document.visibilityState === "hidden") void this.queueSyncAndForget();
      };
      this.registerDomEvent(document, "visibilitychange", onHide);
    }
  }
  async maybeAutoSync(reason) {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (this.lock.active) return;
    const minGap = s.minAutoSyncIntervalMinutes * 6e4;
    if (Date.now() - this.lastAutoSyncMs < minGap) return;
    if (!this.autoActionAllowed()) return;
    this.lastAutoSyncMs = Date.now();
    this.log.add("info", "auto", `Automatic sync (${reason}).`);
    await this.cmdSync(void 0, true);
  }
  /** Queue a sync request without waiting (used only on close/background). */
  async queueSyncAndForget() {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (this.lock.active) return;
    const minGap = s.minAutoSyncIntervalMinutes * 6e4;
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
  onunload() {
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
  notify(message) {
    const mode = this.deviceSettings.notificationMode;
    this.log.add("info", "notify", message);
    if (mode === "notice") new import_obsidian15.Notice(message);
    else if (mode === "status-only") {
      this.progressText = message;
      this.updateProgressInView(message);
      window.setTimeout(() => {
        if (this.progressText === message) {
          this.progressText = null;
          this.updateProgressInView(null);
        }
      }, 4e3);
    }
  }
  /** Result window for a SUCCESSFUL operation: shown only when enabled. */
  reportSuccess(title, lines, stdout) {
    if (this.deviceSettings.showSuccessModals) {
      new ResultModal(this.app, title, lines, { stdout }).open();
    } else {
      this.notify(`${title}: ${lines[0] ?? "done"}`);
      if (stdout) this.log.add("info", "result", title, stdout);
    }
  }
  // ------------------------------------------------------------------ setup
  resolveScopeId() {
    const appId = this.app.appId;
    if (typeof appId === "string" && appId.length > 0) return appId;
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
  makeRuntimeFS() {
    const adapter = this.app.vault.adapter;
    return {
      exists: (p) => adapter.exists(p),
      read: (p) => adapter.read(p),
      write: (p, d) => adapter.write(p, d),
      mkdir: (p) => adapter.mkdir(p),
      remove: (p) => adapter.remove(p),
      listFiles: async (p) => (await adapter.list(p)).files
    };
  }
  async startupChecks() {
    this.refreshStatusBarIdle();
    this.warnIfObsidianGitEnabledOnAndroid();
    await this.tryImportPairing();
    await this.reconcileAfterRestart();
    this.offerInterruptedRepair();
    await this.loadGitignore();
    if (import_obsidian15.Platform.isAndroidApp && !this.deviceSettings.authToken && !this.store.getValue("setup-guide-shown")) {
      this.store.setValue("setup-guide-shown", "1");
      this.openSetupGuide("First run: this device is not set up yet.");
    }
    void this.remindAboutPreviousRepos();
    const onOpen = this.deviceSettings.onOpenAction;
    if (this.deviceSettings.enabledOnThisDevice && onOpen !== "nothing") {
      if (this.autoActionAllowed()) {
        this.log.add("info", "auto", `Auto ${onOpen} on open.`);
        if (onOpen === "sync") void this.cmdSync(void 0, true);
        else void this.cmdPull(true);
      }
    }
  }
  /** Best-effort gates for automatic actions (Wi-Fi / battery), default permissive. */
  autoActionAllowed() {
    const s = this.deviceSettings;
    try {
      if (s.wifiOnly) {
        const conn = navigator.connection;
        if (conn?.type && conn.type !== "wifi") return false;
      }
    } catch {
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
  isObsidianGitActiveOnDevice() {
    const plugins = this.app.plugins;
    if (!plugins?.enabledPlugins?.has("obsidian-git")) return false;
    let disabled = null;
    try {
      const load = this.app.loadLocalStorage;
      if (typeof load === "function") disabled = load.call(this.app, "obsidian-git:pluginDisabled");
    } catch {
    }
    if (disabled === null || disabled === void 0) {
      try {
        disabled = window.localStorage.getItem("obsidian-git:pluginDisabled");
      } catch {
      }
    }
    return disabled !== "true";
  }
  warnIfObsidianGitEnabledOnAndroid() {
    if (!import_obsidian15.Platform.isAndroidApp) return;
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
          "Native Git Bridge will never disable another plugin automatically."
        ],
        confirmLabel: "Don't warn again on this device",
        icon: "bell-off"
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
  async tryImportPairing() {
    const adapter = this.app.vault.adapter;
    const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/runtime/${PAIRING_FILE}`;
    try {
      if (!await adapter.exists(path)) return;
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
          termuxIntegrationEnabled: true
        });
        try {
          await adapter.remove(path);
        } catch {
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
              "Replace it only if you re-ran the installer on purpose."
            ],
            confirmLabel: "Replace token",
            danger: true
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
  async learnProfileId(result) {
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
  async cmdPairThisVault() {
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const adapter = this.app.vault.adapter;
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const claimPath = `${root}/${CLAIM_FILE}`;
    const pairingPath = `${root}/${PAIRING_FILE}`;
    const needsRepo = !await this.vaultHasRepository();
    try {
      await this.client.ensureRuntimeDirs();
      await adapter.write(
        claimPath,
        JSON.stringify(
          {
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            vault: this.app.vault.getName(),
            bootstrap: needsRepo
          },
          null,
          2
        )
      );
    } catch (e) {
      new ResultModal(this.app, "Pairing failed", [`The pairing request could not be written: ${String(e)}`], {
        isError: true
      }).open();
      return;
    }
    this.log.add("info", "pairing", "Pairing request written; asking Termux to pick it up.");
    this.makeTransport().trigger(`r-${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-pair`);
    new import_obsidian15.Notice("Asked Termux to pair this vault\u2026");
    const deadline = Date.now() + this.pairingWaitMs;
    for (; ; ) {
      await new Promise((r) => window.setTimeout(r, this.pairingPollMs));
      if (await adapter.exists(pairingPath)) {
        await this.tryImportPairing();
        if (this.deviceSettings.authToken) {
          try {
            if (await adapter.exists(claimPath)) await adapter.remove(claimPath);
          } catch {
          }
          new ResultModal(this.app, "This vault is paired", [
            `Profile: ${this.deviceSettings.profileId || "(unnamed)"}`,
            "Termux answered with a token of its own for this vault. Other vaults keep their own profiles and tokens."
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
        "If nothing happens: Termux must be installed and the runner already set up once (the install command below does that), and the companion app needs its RUN_COMMAND permission."
      ],
      {
        isError: true,
        actions: [
          {
            label: "Copy command & open Termux",
            cta: true,
            keepOpen: true,
            onClick: () => this.copyCommandAndOpenTermux()
          }
        ]
      }
    ).open();
  }
  /**
   * Repositories set aside by a re-clone, read from the manifests the runner
   * writes next to them. No Termux round trip and no walking of a large
   * directory: the manifest is a few hundred bytes.
   */
  async listPreviousRepos() {
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const out = [];
    try {
      const listing = await this.app.vault.adapter.list(root);
      for (const f of listing.files) {
        const name = f.slice(f.lastIndexOf("/") + 1);
        if (!name.startsWith(PREVIOUS_GIT_PREFIX) || !name.endsWith(".json")) continue;
        const parsed = parsePreviousRepo(await this.app.vault.adapter.read(f));
        if (parsed) out.push(parsed);
      }
    } catch {
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
  async remindAboutPreviousRepos() {
    const repos = await this.listPreviousRepos();
    if (repos.length === 0) return;
    if (this.footprintState()?.partial === true && (this.lastStatus?.status.unstaged.some((e) => e.worktree === "D") ?? false)) {
      return;
    }
    const s = this.deviceSettings;
    const due = reposToRemindAbout(repos, {
      lastRemindedAt: s.previousRepoRemindedAt,
      dismissed: s.previousRepoDismissed
    });
    if (due.length === 0) return;
    await this.updateDeviceSettings({ previousRepoRemindedAt: Date.now() });
    this.showPreviousRepoModal(due, "A previous repository is still taking up space");
  }
  /** The reminder and the settings entry share one window. */
  showPreviousRepoModal(repos, title) {
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const total = repos.reduce((n, r) => n + r.sizeKb, 0);
    const lines = [
      repos.length === 1 ? "Re-cloning this vault put the repository it replaced aside instead of deleting it, because it may hold commits that exist nowhere else." : `Re-cloning this vault put ${repos.length} earlier repositories aside instead of deleting them.`,
      "",
      ...repos.map((r) => `${r.dir} \u2014 ${describePreviousRepo(r)}${r.lastCommit ? `, last: ${r.lastCommit}` : ""}`),
      "",
      `Total: ${formatSize(total)}, in ${root}/`,
      "",
      "Keeping it costs only disk. Deleting it is final: any commit that exists only there goes with it. To look inside first, in Termux:",
      `git -C <vault> remote add previous <vault>/${root}/${repos[0]?.dir ?? ""}`,
      "git -C <vault> fetch previous     # then browse previous/<branch>"
    ];
    const actions = [
      {
        label: repos.length === 1 ? "Delete it" : "Delete all of them",
        onClick: () => this.confirmDeletePreviousRepos(repos)
      },
      {
        label: "Keep, remind me tomorrow",
        cta: true,
        onClick: () => void 0
      },
      {
        label: "Keep, stop reminding",
        onClick: () => {
          void this.updateDeviceSettings({
            previousRepoDismissed: [
              ...this.deviceSettings.previousRepoDismissed,
              ...repos.map((r) => r.dir)
            ]
          });
          this.notify("The old repository stays; no more reminders about it.");
        }
      }
    ];
    new ResultModal(this.app, title, lines, { actions }).open();
  }
  confirmDeletePreviousRepos(repos) {
    const total = repos.reduce((n, r) => n + r.sizeKb, 0);
    const commits = repos.reduce((n, r) => n + r.commits, 0);
    new ConfirmModal(
      this.app,
      {
        title: "Delete the old repository?",
        body: [
          `${repos.length === 1 ? "One repository" : `${repos.length} repositories`}, ${formatSize(total)}, ${commits} commit${commits === 1 ? "" : "s"} in total.`,
          "Only the history goes: your notes are the files in the vault and are not touched.",
          "This cannot be undone from here. Any commit that exists only in this copy \u2014 anything never pushed \u2014 is gone with it."
        ],
        confirmLabel: "Delete permanently",
        icon: "trash",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const root = new RuntimePaths(this.app.vault.configDir).root;
        const failed = [];
        for (const r of repos) {
          try {
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
  async vaultHasRepository() {
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
  async cmdSetupRepository() {
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const s = this.deviceSettings;
    const hasRepo = await this.vaultHasRepository();
    const paired = s.authToken !== "";
    const lines = [];
    const actions = [];
    lines.push(
      hasRepo ? "This vault is a git repository." : "This vault is NOT a git repository yet.",
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
        onClick: () => void this.cmdPairThisVault()
      });
      new ResultModal(this.app, "Set up the repository", lines, { actions }).open();
      return;
    }
    if (!hasRepo) {
      lines.push(
        "Two ways to give it one:",
        "\u2022 Start fresh \u2014 create an empty repository here and, if you want, commit what the vault already contains. You can add a remote afterwards.",
        "\u2022 Clone an existing one \u2014 the vault keeps the files it already has; anything that exists on both sides is reported and you decide, nothing is overwritten silently.",
        "",
        "Credentials never come through the plugin. Set them up once in Termux (a credential helper, an SSH key, or `gh auth login`) \u2014 see docs/setup.md."
      );
      actions.push(
        { label: "Create a repository here", cta: true, keepOpen: true, onClick: () => this.promptInitRepo() },
        { label: "Clone from a remote", keepOpen: true, onClick: () => this.promptClone() }
      );
    } else {
      lines.push(
        `Remote, as of the last status: ${this.lastRemoteUrl || "not seen yet \u2014 run Status to find out"}`,
        "",
        "Fetch, pull and push need one. Set it if the repository has none, or change it if it moved or was set up with the wrong account."
      );
      actions.push({
        label: this.lastRemoteUrl ? "Change the remote" : "Add a remote",
        cta: true,
        keepOpen: true,
        onClick: () => this.promptSetRemote()
      });
      actions.push({
        label: "Re-clone from a remote",
        keepOpen: true,
        onClick: () => this.promptClone(true)
      });
    }
    new ResultModal(this.app, "Set up the repository", lines, { actions }).open();
  }
  /**
   * Shared precondition for the two direct commands: Android, and paired with
   * Termux. Pairing is checked because neither command can do anything without
   * a runner, and the guided setup is the only place that can fix that.
   */
  async setupPrecondition() {
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return false;
    }
    if (this.deviceSettings.authToken === "") {
      new ResultModal(
        this.app,
        "Not paired with Termux yet",
        [
          "Termux has to know this vault before it can create or clone anything here.",
          "Pairing works even before the repository exists."
        ],
        {
          actions: [
            { label: "Pair this vault", cta: true, keepOpen: true, onClick: () => void this.cmdPairThisVault() }
          ]
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
  async cmdCreateRepository() {
    if (!await this.setupPrecondition()) return;
    if (await this.vaultHasRepository()) {
      new ResultModal(
        this.app,
        "This vault is already a repository",
        [
          "Nothing was changed. Creating a second repository over an existing one would hide its history rather than remove it.",
          "To point it somewhere else, set the remote; to start from a remote instead, use 'Clone an existing remote into this vault'."
        ],
        {
          actions: [
            { label: "Set the remote", cta: true, keepOpen: true, onClick: () => this.promptSetRemote() },
            { label: "Clone instead", keepOpen: true, onClick: () => this.promptClone(true) }
          ]
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
  async cmdCloneRepository() {
    if (!await this.setupPrecondition()) return;
    this.promptClone(await this.vaultHasRepository());
  }
  promptInitRepo() {
    new CommitMessageModal(
      this.app,
      {
        title: "Create a repository in this vault",
        placeholder: "main",
        submitLabel: "Create repository",
        initial: "main"
      },
      (branch) => {
        if (branch === null) return;
        if (!isValidBranchName(branch)) {
          new ResultModal(this.app, "Invalid branch name", [
            `'${branch}' is not a branch name this plugin will send.`,
            "Letters, digits, dot, dash, underscore and slash; no '..', no leading dash."
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
              "Decline to create the repository empty and commit later, after reviewing what is in it."
            ],
            confirmLabel: "Create and commit everything",
            icon: "check"
          },
          async (commitAll) => {
            const result = await this.runOperation("init-repo", {
              branch,
              initialCommit: commitAll,
              message: "Initial commit (native git bridge)"
            });
            if (!result) return;
            if (!result.ok) return this.renderMutationError("Native Git: init failed", result);
            this.absorbStatusData(result.data ?? {});
            new ResultModal(this.app, "Repository created", [
              `Branch: ${result.data?.branch ?? branch}`,
              result.data?.committed === "true" ? "The vault's files are in the first commit." : "Nothing is committed yet.",
              "Next: add a remote, then push."
            ], {
              actions: [
                { label: "Add a remote", cta: true, keepOpen: true, onClick: () => this.promptSetRemote() }
              ]
            }).open();
          }
        ).open();
      }
    ).open();
  }
  promptSetRemote() {
    new CommitMessageModal(
      this.app,
      {
        title: "Remote for this vault",
        placeholder: "https://github.com/you/vault.git",
        submitLabel: "Save remote",
        initial: ""
      },
      async (raw) => {
        if (raw === null) return;
        const verdict = validateRemoteUrl(raw);
        if (!verdict.ok) {
          new ResultModal(this.app, "That URL cannot be used", [verdict.reason ?? "Invalid URL."], {
            isError: true
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
  promptClone(replaceExisting = false) {
    if (replaceExisting) {
      new ConfirmModal(
        this.app,
        {
          title: "Replace this vault's repository?",
          body: [
            "The repository will be cloned again from a remote you give next.",
            "Your notes are not touched: files that exist on both sides keep your version and show up as local changes, files that exist only here stay untracked.",
            "The repository that is here now is NOT deleted \u2014 it is set aside in the plugin's runtime folder, with its history intact, and you decide later what to do with it.",
            "Nothing happens until the clone succeeds: a clone that fails leaves everything exactly as it is."
          ],
          confirmLabel: "Choose the remote",
          icon: "download"
        },
        (confirmed) => {
          if (confirmed) this.askCloneUrl(true);
        }
      ).open();
      return;
    }
    this.askCloneUrl(false);
  }
  askCloneUrl(replaceExisting) {
    new CommitMessageModal(
      this.app,
      {
        title: "Clone into this vault",
        placeholder: "https://github.com/you/vault.git",
        submitLabel: "Clone",
        initial: ""
      },
      (raw) => {
        if (raw === null) return;
        const verdict = validateRemoteUrl(raw);
        if (!verdict.ok) {
          new ResultModal(this.app, "That URL cannot be used", [verdict.reason ?? "Invalid URL."], {
            isError: true
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
  askCloneKind(url, replaceExisting) {
    new ResultModal(
      this.app,
      "How much should this device hold?",
      [
        "Full clone: the whole history and all file content. Everything works offline.",
        "Lightweight (partial clone, blob:none): file content is fetched when something needs it, and content that a sparse checkout hides is never downloaded at all. Old file versions and 'Show again' need the network. Best for devices with little space."
      ],
      {
        actions: [
          { label: "Full clone", cta: true, onClick: () => void this.runClone(url, replaceExisting) },
          {
            label: "Lightweight (partial clone)",
            onClick: () => void this.runClone(url, replaceExisting, "blob:none")
          }
        ]
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
  afterRemoteSet(url, d) {
    const shown = redactRemoteUrl(url);
    const remoteBranches = (d.remoteBranches ?? "").split("\n").filter((b) => b.trim() !== "");
    const localCommits = d.localCommits === "true";
    if (d.remoteReachable !== "true") {
      new ResultModal(this.app, "Remote saved", [
        `Origin is now ${shown}.`,
        "It could not be reached just now, so there is nothing more to say about it yet \u2014 usually credentials that are not set up in Termux, or no connection. Run Fetch once they are."
      ]).open();
      return;
    }
    if (remoteBranches.length === 0) {
      new ResultModal(this.app, "Remote saved", [
        `Origin is now ${shown}.`,
        "The remote is empty, so this vault's history will be the first thing in it. Commit, then push."
      ]).open();
      return;
    }
    if (!localCommits) {
      new ResultModal(
        this.app,
        "Remote saved \u2014 it already has content",
        [
          `Origin is now ${shown}, and it already contains: ${remoteBranches.join(", ")}.`,
          "This vault has no commits yet, so it can simply take that history over. Your existing files are kept: the ones that also exist in the repository become ordinary local changes, and the rest of the repository is checked out around them \u2014 the same result cloning would have given."
        ],
        {
          actions: [
            {
              label: "Get the repository's content",
              cta: true,
              onClick: () => void this.runAdoptRemote()
            }
          ]
        }
      ).open();
      return;
    }
    new ResultModal(
      this.app,
      "Remote saved; histories are unrelated",
      [
        `Origin is now ${shown}, and it already contains: ${remoteBranches.join(", ")}.`,
        "This vault also has commits of its own, made here. Git treats the two as unrelated histories: pull will refuse to merge them, and push will be rejected. Nothing is broken \u2014 but they cannot simply be joined.",
        "",
        "The clean way out: open a NEW empty vault and clone the repository into it, then move your notes across.",
        "The deliberate way: in Termux, either `git pull --allow-unrelated-histories` (keeps both, expect conflicts) or reset onto the remote branch (throws your local commits away). This plugin does neither for you."
      ],
      { isError: true }
    ).open();
  }
  /** Take an already configured remote's history into a repository with none. */
  async runAdoptRemote() {
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
        collisions.length > 10 ? `\u2026and ${collisions.length - 10} more` : ""
      );
    }
    new ResultModal(this.app, "Repository content taken over", lines.filter((l) => l !== "")).open();
  }
  async runClone(url, replaceExisting = false, filter) {
    const args = { url };
    if (replaceExisting) args.replaceExisting = true;
    if (filter !== void 0) args.filter = filter;
    const route = cloneRoute({
      url,
      replaceExisting,
      credsConfigured: this.lastStatus?.credsConfigured ?? null
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
  runCloneViaTermux(args) {
    if (this.lastRunnerVersion > 0 && this.lastRunnerVersion < 15) {
      new ResultModal(
        this.app,
        "Termux runner is too old for this",
        [
          `Finishing a clone downloaded in Termux needs runner v15; this device answers with v${this.lastRunnerVersion}.`,
          RUNNER_OUTDATED_HINT
        ],
        {
          isError: true,
          actions: [
            {
              label: "Copy command & open Termux",
              cta: true,
              keepOpen: true,
              onClick: () => this.copyCommandAndOpenTermux()
            }
          ]
        }
      ).open();
      return;
    }
    const cmd = manualCloneCommand({
      url: String(args.url),
      vaultPath: this.deviceSettings.repoPathHint,
      configDir: this.app.vault.configDir,
      profileId: this.deviceSettings.profileId,
      filter: typeof args.filter === "string" ? args.filter : void 0,
      depth: typeof args.depth === "number" ? args.depth : void 0
    });
    if (cmd === null) {
      new import_obsidian15.Notice(
        "Set the repository path in settings first \u2014 the clone command addresses the vault by its absolute path in Termux."
      );
      return;
    }
    void navigator.clipboard.writeText(cmd);
    new import_obsidian15.Notice("Clone command copied - long-press in Termux to paste, then Enter.");
    new ResultModal(
      this.app,
      "Clone in Termux, then continue here",
      [
        // Two short lines; the command itself sits collapsed below. A device
        // screenshot showed the earlier five-line version plus the inline
        // command filling the whole screen.
        "1. The command is copied. In Termux: paste, Enter, answer git's username/token prompts (saved and reused). Keep Termux visible until the download finishes.",
        "2. Come back and press Continue \u2014 the repository is moved into the vault, nothing is downloaded twice, your notes are kept."
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
            }
          },
          {
            label: "Continue \u2014 finish the clone",
            cta: true,
            onClick: () => void this.finishManualClone(args)
          }
        ]
      }
    ).open();
  }
  /**
   * The finish half: an ordinary clone-into-vault round trip. A v15 runner
   * finds the pre-downloaded repository and completes locally; a Continue
   * pressed too early (download still running, or never started) comes back
   * as an ordinary failure whose message says what to do.
   */
  async finishManualClone(args) {
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
  offerCloneViaTermux(args, result) {
    new ResultModal(
      this.app,
      "The clone needs credentials",
      [
        "The remote asked for credentials and none are saved for this repository. Credentials live only in Termux, and git can only ask for them at a terminal.",
        "Download the repository in Termux instead: the button opens the instructions \u2014 a plain git clone command to paste, with git's own prompts and progress \u2014 and the clone is finished here afterwards without a second download.",
        ...summarizeGitError(result.error?.stderr, result.error?.stdout, 3)
      ],
      {
        isError: true,
        actions: [
          {
            label: "Clone via Termux",
            cta: true,
            onClick: () => void this.runCloneViaTermux(args)
          }
        ]
      }
    ).open();
  }
  /** Render a finished clone's result window (shared by both routes). */
  reportCloneOutcome(result) {
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
        "Your versions were kept \u2014 they now show in the panel as local changes:",
        ...collisions.slice(0, 10),
        collisions.length > 10 ? `\u2026and ${collisions.length - 10} more` : "",
        "",
        "Open each one to see the difference, then commit to keep yours or discard to take the repository's version. Files that exist only here were left alone and are simply untracked."
      );
    }
    if (result.data?.previousGit) {
      lines.push(
        "",
        `The repository that was here is not deleted \u2014 it is set aside as ${result.data.previousGit} in the plugin's runtime folder. The plugin will remind you about the disk it uses; delete it once you are sure nothing in it is needed.`
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
  async reconcileAfterRestart() {
    const raw = this.store.getValue(MARKER_KEY);
    if (!raw) {
      await this.client.cleanupOld();
      return;
    }
    let marker = null;
    try {
      marker = JSON.parse(raw);
    } catch {
    }
    this.store.removeValue(MARKER_KEY);
    if (!marker) return;
    const outcome = await this.client.awaitResult(marker.id, 1, void 0);
    if (outcome.kind === "result") {
      const r = outcome.result;
      this.log.add(
        "info",
        marker.action,
        `Recovered result for operation ${marker.id} finished while Obsidian was closed (ok=${r.ok}).`
      );
      await this.client.consume(marker.id);
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
  offerInterruptedRepair() {
    const raw = this.store.getValue(REPAIR_JOB_KEY);
    if (!raw) return;
    this.store.removeValue(REPAIR_JOB_KEY);
    let step = "";
    try {
      step = String(JSON.parse(raw).step ?? "");
    } catch {
    }
    new ResultModal(
      this.app,
      "A repair was interrupted",
      [
        step !== "" ? `Obsidian closed while a repository repair was running (${step}).` : "Obsidian closed while a repository repair was running.",
        "Nothing was lost: the repair runs as short steps and picks its work back up from a fresh scan."
      ],
      {
        actions: [
          {
            label: "Continue the repair",
            cta: true,
            onClick: () => void this.cmdRepairObjects(true)
          }
        ]
      }
    ).open();
  }
  persistMarker(marker) {
    if (marker) this.store.setValue(MARKER_KEY, JSON.stringify(marker));
    else this.store.removeValue(MARKER_KEY);
  }
  // -------------------------------------------------------------- settings
  async updateDeviceSettings(patch) {
    this.deviceSettings = this.store.write(patch);
    this.refreshStatusBarIdle();
  }
  async resetDeviceSettings() {
    this.store.reset();
    this.deviceSettings = this.store.read();
    this.refreshStatusBarIdle();
    new import_obsidian15.Notice("Native Git Bridge: device-local settings reset.");
  }
  refreshStatusBarIdle() {
    if (!this.statusBar) return;
    if (!this.deviceSettings.enabledOnThisDevice) this.statusBar.set("disabled");
    else if (this.lock.active) this.statusBar.set("syncing");
    else if (this.lastStatus) this.applyStatusToStatusBar(this.lastStatus.status);
    else this.statusBar.set("clean");
  }
  applyStatusToStatusBar(s) {
    if (!this.statusBar) return;
    if (this.lastStatus?.mergeInProgress || this.lastStatus?.rebaseInProgress) {
      this.statusBar.set(
        "conflict",
        s.conflicted.length > 0 ? `(${s.conflicted.length})` : void 0
      );
    } else if (s.conflicted.length > 0) this.statusBar.set("conflict", `(${s.conflicted.length})`);
    else if (s.staged.length + s.unstaged.length + s.untracked.length > 0)
      this.statusBar.set("changed", `(${s.staged.length + s.unstaged.length + s.untracked.length})`);
    else this.statusBar.set("clean", s.ahead > 0 ? `\u2191${s.ahead}` : void 0);
  }
  // -------------------------------------------------------------- commands
  registerCommands() {
    const cmds = [
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
      // Setting and CHANGING are one command — git config overwrites — but a
      // set identity left the change route unreachable: the check window only
      // offered Set while none existed. Its own palette entry is the direct
      // answer to "how do I change it" (user, 2026-08-26).
      { id: "set-git-identity", name: "Set or change the git identity (typed in Termux, never read here)", cb: () => this.cmdSetGitIdentity() },
      // The unified repair (0.6.6): one command walks every known problem in
      // sequence. The routes that start from an error window stay where they
      // are — a window that caught a specific failure is the shortest path to
      // its fix — but this is the one place to start from nothing.
      { id: "repair-repository", name: "Repair the repository (walk every problem)", cb: () => void this.cmdRepairObjects() }
    ];
    for (const c of cmds) this.addCommand({ id: c.id, name: c.name, callback: c.cb });
    this.registerObsidianProtocolHandler("native-git-bridge-ack", (params) => {
      const p = params;
      this.onCompanionAck(p?.src, p?.termux, p?.cv);
    });
  }
  // ------------------------------------------------------------ operations
  /** Guard + queue + trigger + await one bridge operation. */
  async runOperation(action, args = {}, fromRepairJob = false) {
    const s = this.deviceSettings;
    if (this.repairJobStep !== null && !fromRepairJob) {
      new import_obsidian15.Notice(`A repair is running (${this.repairJobStep}). Wait for it to finish.`);
      return null;
    }
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice(
        "Native Git Bridge works on Android only (it delegates git to Termux). On desktop, use git directly or the obsidian-git plugin."
      );
      return null;
    }
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
    const needsRunner = ACTION_MIN_RUNNER.get(action);
    if (this.lastRunnerVersion > 0 && needsRunner !== void 0 && this.lastRunnerVersion < needsRunner) {
      new ResultModal(
        this.app,
        "Termux runner is too old for this action",
        [
          `'${action}' needs runner v${needsRunner}; this device answers with v${this.lastRunnerVersion}.`,
          RUNNER_OUTDATED_HINT
        ],
        {
          isError: true,
          actions: [
            {
              label: "Copy command & open Termux",
              cta: true,
              keepOpen: true,
              onClick: () => this.copyCommandAndOpenTermux()
            }
          ]
        }
      ).open();
      return null;
    }
    const req = createRequest(
      action,
      args,
      s.authToken,
      timeoutSecondsFor(action, s.opTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS),
      /* @__PURE__ */ new Date(),
      randomSuffix(),
      s.profileId
    );
    const mutating = MUTATING_ACTIONS.has(action);
    if (mutating && !this.lock.tryAcquire(req.id, action)) {
      new import_obsidian15.Notice(`Another operation is running (${this.lock.active?.action}). Try again later.`);
      return null;
    }
    if (!mutating && this.lock.active && MUTATING_ACTIONS.has(this.lock.active.action)) {
      new import_obsidian15.Notice(`A ${this.lock.active.action} operation is running; try again when it finishes.`);
      return null;
    }
    const cancel = new CancelToken();
    this.statusBar?.set("syncing");
    this.log.add("info", action, `Queued request ${req.id}.`);
    void this.openStatusPanel(false);
    const startedAt = Date.now();
    const path = typeof args["path"] === "string" ? args["path"] : null;
    this.inFlight.set(req.id, {
      id: req.id,
      action,
      path,
      cancel,
      startedAt,
      timeoutSeconds: req.timeoutSeconds
    });
    this.runningId = req.id;
    this.activeCancel = cancel;
    this.runningAction = action;
    this.runningPath = path;
    this.progressText = `${action}\u2026 0s`;
    this.progressDetail = null;
    this.liveProgress = null;
    this.pushStatusToView();
    const ticker = window.setInterval(() => {
      if (this.runningId !== req.id) return;
      const secs = Math.round((Date.now() - startedAt) / 1e3);
      const live = this.liveProgress?.id === req.id ? this.liveProgress.line : "";
      this.progressText = `${action}\u2026 ${secs}s`;
      this.progressDetail = live !== "" ? live : null;
      if (secs === LONG_OPERATION_SECONDS && this.sharedPrefs.openOutputForLongOps) {
        void this.openOutputPanel();
      }
      this.updateProgressInView(this.progressText, this.progressDetail);
      void this.refreshLiveProgress(req.id);
    }, 1e3);
    try {
      await this.client.submit(req);
      const ackBaseline = this.lastCompanionAckMs;
      this.makeTransport().trigger(req.id);
      const waited = await this.client.awaitResult(req.id, req.timeoutSeconds * 1e3, cancel);
      if (waited.kind === "timeout") {
        await this.client.requestCancel(req.id);
        if (mutating) this.statusStale = true;
        this.log.add(
          "warn",
          action,
          `Request ${req.id} timed out after ${req.timeoutSeconds}s (cancel flag written to prevent late execution).`
        );
        await this.cmdSelfCheck(true);
        if (this.lastCompanionAckMs > ackBaseline) {
          this.log.add(
            "warn",
            action,
            `Companion acknowledged the trigger and the runner did not answer within ${req.timeoutSeconds}s. It may still be working; a result that lands later is picked up.`
          );
        } else if (!this.companionSetupAutoOpened) {
          this.companionSetupAutoOpened = true;
          void this.openCompanionSetup();
        }
        this.lastVerdict = `${action} timed out after ${req.timeoutSeconds}s (it may still be running in Termux)`;
        return null;
      }
      if (waited.kind === "cancelled") {
        await this.client.requestCancel(req.id);
        if (mutating) this.statusStale = true;
        this.lastVerdict = `${action} cancelled`;
        this.log.add("warn", action, `Request ${req.id} cancelled by user.`);
        new import_obsidian15.Notice(`Native Git: ${action} cancelled.`);
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
      this.lastVerdict = result.ok ? `${action} finished` : `${action} failed: ${result.error?.message ?? `exit ${result.exitCode}`}`;
      if (!result.ok && result.error?.code === "REPO_MISSING" && action !== "status" && !await this.vaultHasRepository()) {
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
      if (this.runningId === req.id) this.adoptNewestInFlight();
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
  adoptNewestInFlight() {
    const next = [...this.inFlight.values()].pop();
    if (next === void 0) {
      this.progressText = null;
      this.progressDetail = null;
      this.liveProgress = null;
      this.runningAction = null;
      this.runningPath = null;
      this.activeCancel = null;
      this.runningId = null;
      return;
    }
    if (this.liveProgress?.id !== next.id) this.liveProgress = null;
    this.runningId = next.id;
    this.runningAction = next.action;
    this.runningPath = next.path;
    this.activeCancel = next.cancel;
    this.progressText = `${next.action}\u2026 ${Math.round((Date.now() - next.startedAt) / 1e3)}s`;
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
  async refreshLiveProgress(id) {
    try {
      const raw = await this.client.readProgress(id);
      if (raw === null) return;
      const line = lastProgressLine(raw);
      if (line !== null && this.runningId === id) this.liveProgress = { id, line };
    } catch {
    }
  }
  checkRunnerVersion(result) {
    const version = typeof result.runnerVersion === "number" ? result.runnerVersion : 1;
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
        `Runner version: ${version} \u2014 this plugin needs ${RUNNER_MIN_VERSION}.`,
        RUNNER_OUTDATED_HINT
      ],
      { isError: true }
    ).open();
  }
  makeTransport() {
    return new CompanionIntentTransport(
      this.deviceSettings.companionUriTemplate,
      (uri) => this.openExternalUri(uri)
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
  openUrlPreferCompanion(companionUri, directUrl) {
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
  openTermux() {
    if (this.lastAckTermuxInstalled === false) {
      this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL);
      return;
    }
    this.openExternalUri(COMPANION_OPEN_TERMUX_URI);
  }
  openExternalUri(uri) {
    let opened = null;
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
  /**
   * The companion (>= 0.4.0) bounces obsidian://native-git-bridge-ack back for
   * every URI it receives, giving a DETERMINISTIC "companion is installed and
   * reachable" signal — and, since 0.4.1, whether Termux itself is installed
   * (the WebView cannot query other packages; the companion can). Registered
   * in onload.
   */
  onCompanionAck(src, termux, companionVersion) {
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
  awaitCompanionAck(timeoutMs) {
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
  awaitAppSwitch() {
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
  async probeCompanion() {
    return new Promise((resolve) => {
      let misses = 0;
      const done = (alive) => {
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
  async openCompanionSetup() {
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("The companion app exists only on Android.");
      return;
    }
    this.log.add("info", "companion", "Opening companion setup checklist.");
    const q = `?pv=${encodeURIComponent(this.manifest.version)}&rv=${this.lastRunnerVersion}&rmin=${RUNNER_MIN_VERSION}&rship=${RUNNER_SHIPPED_VERSION}&cmin=${encodeURIComponent(COMPANION_MIN_VERSION)}`;
    this.openExternalUri(COMPANION_SETUP_URI + q);
    if (await this.probeCompanion()) return;
    this.log.add("warn", "companion", "Setup URI opened nothing - companion app likely not installed.");
    new ResultModal(
      this.app,
      "Companion app not installed?",
      [
        "Nothing opened, which usually means the Git Bridge Companion app is not installed on this device.",
        "The companion is the only supported trigger: it holds the Android permission to run the Termux runner. Without it, requests just time out.",
        "Copy the link below and paste it into your browser (Chrome/Firefox). That is the reliable route here: with no companion installed, Obsidian can only open its built-in browser tab, whose downloads are often discarded when the tab closes \u2014 so the APK never reaches Downloads.",
        `Latest release (companion APK): ${COMPANION_RELEASES_URL}`,
        "After installing, grant the 'Run commands in Termux environment' permission in the companion, then try again."
      ],
      {
        actions: [
          {
            label: "Copy download link",
            cta: true,
            keepOpen: true,
            onClick: () => {
              void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
              new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
            }
          },
          {
            label: "Try opening in browser",
            keepOpen: true,
            onClick: () => this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_RELEASES_URL)
          }
        ]
      }
    ).open();
  }
  // ------------------------------------------------------------- command impls
  async cmdStatus(silent = false, offerSetupWhenMissing = false) {
    const result = await this.runOperation("status");
    if (!result) return;
    if (!result.ok) {
      if (offerSetupWhenMissing && result.error?.code === "REPO_MISSING" && !await this.vaultHasRepository()) {
        await this.cmdSetupRepository();
        return;
      }
      this.renderStatusFailure(result);
      return;
    }
    this.absorbStatusData(result.data ?? {});
    if (!silent) this.openStatusModal();
  }
  openStatusModal() {
    new StatusModal(this.app, {
      status: this.lastStatus?.status,
      sparse: this.lastStatus?.sparse,
      lastCommit: this.lastStatus?.lastCommit,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? void 0,
      bridgeAvailable: this.deviceSettings.termuxIntegrationEnabled ? "enabled (companion app)" : "disabled",
      activeOperation: this.lock.active ? this.lock.active.action : void 0,
      fetchedAt: this.lastStatus?.fetchedAt
    }).open();
  }
  async cmdShowChangedFiles() {
    if (!this.lastStatus) {
      await this.cmdStatus(true);
    }
    if (this.lastStatus) {
      new ChangedFilesModal(this.app, this.lastStatus.status, this.lastStatus.fetchedAt).open();
    }
  }
  async cmdVerifySparseSafety() {
    const protectedPaths = this.effectiveProtectedPaths();
    if (protectedPaths.length === 0) {
      new import_obsidian15.Notice("No protected sparse paths configured (see settings).");
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
  async trashAll(paths) {
    const adapter = this.app.vault.adapter;
    let moved = 0;
    let absent = 0;
    const failed = [];
    const expand = async (raw) => {
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
      const out = [];
      try {
        const listing = await adapter.list(p);
        for (const f of listing.files) out.push(f);
        for (const d of listing.folders) out.push(...await expand(d));
      } catch (e) {
        this.log.add("warn", "sparse", `Could not list ${p}: ${String(e)}`);
      }
      out.push(p);
      return out;
    };
    const targets = [];
    for (const raw of paths) {
      for (const t of await expand(raw)) if (!targets.includes(t)) targets.push(t);
    }
    for (const t of targets) {
      try {
        await adapter.trashLocal(t);
        moved++;
      } catch (e) {
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
  async runSparseRepair(plan) {
    const done = [];
    const problems = [];
    const allPaths = [...plan.unstage, ...plan.resolveToHead];
    if (allPaths.length > 0) {
      const result = await this.runOperation("unstage-protected", {
        paths: allPaths,
        protectedPaths: this.effectiveProtectedPaths()
      });
      if (!result) return;
      if (!result.ok) {
        this.renderMutationError("Native Git: could not clear the index entries", result);
        return;
      }
      const n = Number(result.data?.unstagedProtectedCount ?? plan.unstage.length);
      this.absorbStatusData(result.data ?? {});
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
          failed.length > 12 ? `\u2026and ${failed.length - 12} more` : ""
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
  sparseSafetyFixes() {
    return {
      repair: (plan) => {
        const body = [];
        if (plan.trash.length > 0) {
          body.push(
            `Move to Obsidian's trash (${plan.trash.length}):`,
            ...plan.trash.slice(0, 8),
            plan.trash.length > 8 ? `\u2026and ${plan.trash.length - 8} more` : ""
          );
        }
        if (plan.unstage.length > 0) {
          body.push(
            `Remove from the index only (${plan.unstage.length}) \u2014 staged additions with no file on disk:`,
            ...plan.unstage.slice(0, 8),
            plan.unstage.length > 8 ? `\u2026and ${plan.unstage.length - 8} more` : ""
          );
        }
        if (plan.resolveToHead.length > 0) {
          body.push(
            `Restore to the committed version (${plan.resolveToHead.length}) \u2014 conflicted inside a protected folder:`,
            ...plan.resolveToHead.slice(0, 8),
            plan.resolveToHead.length > 8 ? `\u2026and ${plan.resolveToHead.length - 8} more` : "",
            "These are files this device is not allowed to edit, so the committed version is the one to keep. Restoring it clears the conflict and lets the merge be finished; nothing on disk is touched."
          );
        }
        body.push(
          "Trashed files go to .trash in the vault and can be restored from there. Index entries are removed with 'git rm --cached', which only undoes a staged addition \u2014 nothing in the last commit is touched, and no file is deleted by it."
        );
        new ConfirmModal(
          this.app,
          {
            title: "Clear these out of the way?",
            body: body.filter((l) => l !== ""),
            confirmLabel: "Clear them",
            icon: "trash",
            danger: true
          },
          async (confirmed) => {
            if (!confirmed) return;
            await this.runSparseRepair(plan);
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
              "Protection is derived from the sparse rules, so they also disappear from the protected set."
            ],
            confirmLabel: "Remove exclusion",
            icon: "eye",
            danger: true
          },
          async (confirmed) => {
            if (!confirmed) return;
            for (const d of dirs) await this.cmdSparseExclude(d, false);
            await this.cmdStatus(true);
          }
        ).open();
      }
    };
  }
  /** Hide (exclude=true) or materialize a path via non-cone sparse patterns. */
  async cmdSparseExclude(path, exclude, skipConfirm = false) {
    const go = async () => {
      const result = await this.runOperation(exclude ? "sparse-exclude-add" : "sparse-exclude-remove", { path });
      if (!result) return;
      if (!result.ok) {
        new ResultModal(this.app, "Sparse change failed", [result.error?.message ?? "Unknown error."], {
          stdout: result.error?.stdout,
          stderr: result.error?.stderr,
          isError: true
        }).open();
        return;
      }
      this.absorbStatusData(result.data ?? {});
      new import_obsidian15.Notice(exclude ? `Hidden via sparse checkout: ${path}` : `Materialized again: ${path}`);
    };
    if (exclude && !skipConfirm) {
      new ConfirmModal(
        this.app,
        {
          title: "Hide via sparse checkout?",
          body: [
            `'${path}' will be removed from THIS device's working tree (git sparse-checkout exclusion).`,
            "Nothing is deleted from the repository or other devices, and the path automatically joins the protected set, so it can never be committed as a deletion from here."
          ],
          confirmLabel: "Hide on this device"
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
  async cmdExcludeChange(path, add, standalone = true) {
    const result = await this.runOperation(add ? "exclude-add" : "exclude-remove", { path });
    if (!result) return;
    if (!result.ok) {
      new ResultModal(this.app, "Exclude change failed", [result.error?.message ?? "Unknown error."], {
        stdout: result.error?.stdout,
        stderr: result.error?.stderr,
        isError: true
      }).open();
      return;
    }
    this.absorbExcludeList(result.data?.excludeList);
    new import_obsidian15.Notice(add ? `Added to .git/info/exclude: /${path}` : `Removed from exclude: ${path}`);
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
  async refreshAfterRuleChange(data) {
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
  warnIfRuleTargetsTracked(paths) {
    const st = this.lastStatus?.status;
    if (!st) return;
    const tracked = trackedPathsAmong(st, paths);
    if (tracked.length === 0) return;
    const subject = tracked.length === 1 ? `'${tracked[0]}' is tracked by git` : `${tracked.length} of these paths are tracked by git`;
    const explanation = `${subject}: ignore rules only affect untracked files, so the changes will keep appearing until the file is untracked.`;
    if (tracked.length === 1 && this.lastRunnerVersion >= 14) {
      this.offerUntrack(tracked[0], explanation);
      return;
    }
    new import_obsidian15.Notice(explanation);
  }
  /** The untrack confirmation, shared by the notice-upgrade and the menu entry. */
  offerUntrack(path, lead) {
    new ConfirmModal(
      this.app,
      {
        title: "Stop tracking this file?",
        body: [
          ...lead === void 0 ? [] : [lead],
          `'${path}' stays on disk; a deletion enters the index for you to commit.`,
          "Once that commit reaches your other devices, their pull deletes their copy \u2014 or reports a conflict if it has local changes. The panel shows and resolves both.",
          "Without an ignore rule for the path, the next sync or commit stages the file right back."
        ],
        confirmLabel: "Stop tracking",
        icon: "eye-off",
        danger: true
      },
      async (ok) => {
        if (ok) await this.cmdUntrackFile(path);
      }
    ).open();
  }
  /** Stop tracking one file, keeping it on disk (`git rm --cached` semantics, runner v14). */
  async cmdUntrackFile(path) {
    const result = await this.runOperation("untrack-file", {
      path,
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) {
      this.renderMutationError("Native Git: could not stop tracking the file", result);
      return;
    }
    this.absorbStatusData(result.data ?? {});
    new import_obsidian15.Notice(`No longer tracked (still on disk): ${path}. Commit the staged deletion to finish.`);
    if (!this.isGitignored(path) && !this.isExcluded(path)) {
      new import_obsidian15.Notice(`No ignore rule covers ${path} yet: the next sync or commit will track it again unless one is added.`);
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
  async cmdMaintenance() {
    const scan = await this.runOperation("maintenance-scan", {});
    if (!scan) return;
    if (!scan.ok) {
      new ResultModal(this.app, "Native Git: storage scan failed", [scan.error?.message ?? "Unknown error."], {
        stdout: scan.error?.stdout,
        stderr: scan.error?.stderr,
        isError: true
      }).open();
      return;
    }
    this.absorbStatusData(scan.data ?? {});
    const before = parseCountObjects(scan.data?.countObjects ?? "");
    const rescue = (scan.data?.rescueBranches ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    new ConfirmModal(
      this.app,
      {
        title: `Free up ${formatSize(totalKb(before))}?`,
        body: maintenanceReportLines(before, rescue),
        confirmLabel: "Clean up now",
        icon: "eraser"
      },
      async (ok) => {
        if (ok) await this.runMaintenanceSteps(before);
      }
    ).open();
  }
  async runMaintenanceSteps(before) {
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
    this.log.add(
      "info",
      "maintenance",
      `${verdict} (repack filter: ${repack.data?.repackFilter ?? "unknown"})`
    );
    new ResultModal(this.app, "Repository storage cleaned", [verdict]).open();
  }
  // ------------------------------------------------ repository footprint (v14)
  /** What the settings toggles reflect; null until a status has been heard. */
  footprintState() {
    if (!this.lastStatus) return null;
    return {
      shallow: this.lastStatus.shallow === true,
      partial: this.lastStatus.partialFilter !== void 0
    };
  }
  /** Runner v14 is what serves every footprint action. */
  footprintAvailable() {
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
  async ensureFootprintState() {
    const known = this.footprintState();
    if (known !== null) return known;
    const result = await this.runOperation("status");
    if (!result) return null;
    if (!result.ok) {
      if (result.error?.code === "REPO_MISSING" && !await this.vaultHasRepository()) {
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
  footprintChange(title, body, confirmLabel, errTitle, action, args, danger, after) {
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
  async cmdShallowEnable() {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (fp.shallow) {
      new import_obsidian15.Notice("History is already shallow on this device; the toggle now shows it.");
      return;
    }
    const depth = this.deviceSettings.shallowDepth;
    await this.footprintChange(
      "Limit history on this device?",
      [
        `Only the newest ${depth} commits stay on this device; older history leaves it. The remote and your other devices keep everything.`,
        "The history panels here reach only what stays, and restoring a file from an older commit is not possible on this device.",
        "This also clears git's local undo journal (the reflog) on this device: with it kept, the old commits stay pinned and the cut would free nothing for 90 days.",
        "Disk space returns after the next Clean up repository storage."
      ],
      `Keep ${depth} commits`,
      "Native Git: shallow failed",
      "repo-shallow",
      { depth },
      true,
      () => new import_obsidian15.Notice(`History limited to the newest ${depth} commits on this device. Run Clean up repository storage to free the space.`)
    );
  }
  async cmdUnshallow() {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (!fp.shallow) {
      new import_obsidian15.Notice("The full history is already on this device; the toggle now shows it.");
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
      () => new import_obsidian15.Notice("Full history restored on this device.")
    );
  }
  async cmdPartialEnable() {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (fp.partial) {
      new import_obsidian15.Notice("Partial clone is already enabled on this device; the toggle now shows it.");
      return;
    }
    await this.footprintChange(
      "Enable partial clone on this device?",
      [
        "The repository is marked as a partial clone (blob:none): file content is fetched when something needs it, and the content of files your sparse checkout hides is never downloaded at all.",
        "'Show again (remove sparse exclusion)' will need the NETWORK from now on: materialising hidden files fetches their content from the remote.",
        "Old versions of files open on demand the same way, so file history needs the network for content this device has not fetched yet.",
        "Applies to this device only. Run Clean up repository storage afterwards to shed content that is already downloaded."
      ],
      "Enable partial clone",
      "Native Git: partial clone failed",
      "repo-partial-enable",
      {},
      true,
      () => new import_obsidian15.Notice("Partial clone enabled on this device. Run Clean up repository storage to shed already-downloaded content.")
    );
  }
  async cmdPartialDisable() {
    const fp = await this.ensureFootprintState();
    if (fp === null) return;
    if (!fp.partial) {
      new import_obsidian15.Notice("Partial clone is already off on this device; the toggle now shows it.");
      return;
    }
    await this.footprintChange(
      "Disable partial clone?",
      [
        "Everything the filter skipped is fetched from the remote first \u2014 one large download \u2014 and the repository is unmarked only once nothing is missing."
      ],
      "Disable partial clone",
      "Native Git: partial clone stays",
      "repo-partial-disable",
      {},
      false,
      () => new import_obsidian15.Notice("Partial clone disabled; all content is local again.")
    );
  }
  /**
   * The one-time offer: sparse is hiding files, the runner can serve partial
   * clone, and the device is still downloading content it will never show.
   * Fires once per device; the settings toggle stays available either way.
   */
  maybeOfferPartialForSparse() {
    if (this.deviceSettings.partialOfferShown) return;
    const st = this.lastStatus;
    if (!st || !st.sparse.enabled || st.partialFilter !== void 0) return;
    if (this.lastRunnerVersion < 14) return;
    this.deviceSettings = this.store.write({ partialOfferShown: true });
    void this.cmdPartialEnable();
  }
  async refreshExcludeList() {
    const result = await this.runOperation("exclude-list");
    if (!result?.ok) return null;
    this.absorbExcludeList(result.data?.excludeList);
    return this.excludeLines;
  }
  absorbExcludeList(raw) {
    if (raw === void 0) return;
    this.excludeLines = parseIgnoreEntries(raw);
  }
  isExcluded(path) {
    return ignoreEntryMatches(this.excludeLines, path);
  }
  // .gitignore is a plain tracked file in the vault: edited directly, no Termux.
  async loadGitignore() {
    try {
      const raw = await this.app.vault.adapter.read(".gitignore");
      this.gitignoreLines = raw.split(/\r?\n/);
    } catch {
      this.gitignoreLines = [];
    }
    return parseIgnoreEntries(this.gitignoreLines.join("\n"));
  }
  isGitignored(path) {
    return ignoreEntryMatches(parseIgnoreEntries(this.gitignoreLines.join("\n")), path);
  }
  /** `standalone = false`: bulk route; it warns and refreshes once itself. */
  async gitignoreAdd(entry2, standalone = true) {
    if (entry2.trim() === "" || hasControlChars(entry2)) {
      new import_obsidian15.Notice("Invalid .gitignore entry.");
      return;
    }
    await this.loadGitignore();
    if (this.gitignoreLines.some((l) => l.trim() === entry2.trim())) return;
    while (this.gitignoreLines.length > 0 && this.gitignoreLines[this.gitignoreLines.length - 1] === "") {
      this.gitignoreLines.pop();
    }
    this.gitignoreLines.push(entry2.trim());
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new import_obsidian15.Notice(`Added to .gitignore: ${entry2.trim()}`);
    if (standalone) {
      this.warnIfRuleTargetsTracked([entry2.trim().replace(/^\//, "").replace(/\/$/, "")]);
      await this.refreshAfterRuleChange();
    }
  }
  async gitignoreRemove(entry2, standalone = true) {
    await this.loadGitignore();
    const before = this.gitignoreLines.length;
    this.gitignoreLines = this.gitignoreLines.filter((l) => l.trim() !== entry2.trim());
    if (this.gitignoreLines.length === before) return;
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new import_obsidian15.Notice(`Removed from .gitignore: ${entry2.trim()}`);
    if (standalone) await this.refreshAfterRuleChange();
  }
  isSparseExcluded(path) {
    return this.deviceSettings.derivedProtectedPaths.includes(path);
  }
  lastKnownSparse() {
    return this.lastStatus?.sparse ?? null;
  }
  currentExcludeLines() {
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
  async outputSnapshot(want) {
    const paths = new RuntimePaths(this.app.vault.configDir);
    const current = [...this.inFlight.values()].pop() ?? null;
    let stream = "";
    if (current !== null) {
      const raw = await this.client.readProgress(current.id);
      if (raw !== null) stream = progressForBundle(raw, 32 * 1024);
    } else {
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
          const tail2 = text.slice(-8 * 1024);
          const nl = tail2.indexOf("\n");
          runnerLog = redact(nl >= 0 && text.length > 8 * 1024 ? tail2.slice(nl + 1) : tail2).trimEnd();
        }
      } catch {
        runnerLog = "";
      }
    }
    let opLog = "";
    if (want.opLog) {
      opLog = this.log.list().map(
        (e) => `${e.ts} [${e.level}] ${e.action}: ${e.message}` + (e.detail !== void 0 ? `
    ${e.detail.split("\n").join("\n    ")}` : "")
      ).join("\n");
    }
    let past = [];
    if (want.past) {
      const all = await this.collectProgressStreams(paths, 6);
      past = all.filter((s) => s.id !== current?.id).slice(0, 5).map((s) => ({ id: s.id, action: streamAction(s.text) ?? "operation", text: s.text }));
    }
    return {
      action: current?.action ?? null,
      stateText: this.progressText,
      requestId: current?.id ?? null,
      elapsedSeconds: current === null ? 0 : Math.round((Date.now() - current.startedAt) / 1e3),
      timeoutSeconds: current?.timeoutSeconds ?? 0,
      stream,
      queued,
      companionAcked: current !== null && this.lastCompanionAckMs >= current.startedAt,
      lastVerdict: this.lastVerdict,
      runnerLog,
      past,
      opLog
    };
  }
  /** Open (or reveal) the live output panel. */
  async openOutputPanel() {
    const existing = this.app.workspace.getLeavesOfType(NGB_OUTPUT_VIEW);
    if (existing.length > 0) {
      const leaf2 = existing[0];
      await this.app.workspace.revealLeaf(leaf2);
      await leaf2.loadIfDeferred?.();
      const view = leaf2.view;
      if (view instanceof RunnerOutputView) {
        view.showLive();
        await view.tick();
        return;
      }
      this.log.add(
        "warn",
        "output-panel",
        `The output leaf held ${view ? view.getViewType() : "no view"}; recreating it.`
      );
      leaf2.detach();
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_OUTPUT_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
    await leaf.loadIfDeferred?.();
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
  async collectProgressStreams(paths, limit = 5) {
    const adapter = this.app.vault.adapter;
    let files;
    try {
      if (!await adapter.exists(paths.progressDir)) return [];
      files = (await adapter.list(paths.progressDir)).files.filter((f) => f.endsWith(".txt"));
    } catch {
      return [];
    }
    files.sort().reverse();
    const out = [];
    for (const f of files.slice(0, limit)) {
      try {
        const raw = await adapter.read(f);
        const name = f.slice(f.lastIndexOf("/") + 1);
        out.push({ id: name.replace(/\.txt$/, ""), text: progressForBundle(raw) });
      } catch {
      }
    }
    return out;
  }
  /** The one place the log window is built, so the share button cannot go missing from one of them. */
  openOperationLog() {
    new OperationLogModal(this.app, this.log, () => void this.cmdShareOperationLog()).open();
  }
  async cmdShareOperationLog() {
    const paths = new RuntimePaths(this.app.vault.configDir);
    const root = paths.root;
    const adapter = this.app.vault.adapter;
    const runnerLogPath = `${root}/runner.log`;
    let runnerLog = null;
    try {
      if (await adapter.exists(runnerLogPath)) runnerLog = await adapter.read(runnerLogPath);
    } catch {
      runnerLog = null;
    }
    const progress = await this.collectProgressStreams(paths);
    const s = this.deviceSettings;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const text = buildLogBundle({
      now,
      facts: {
        "Plugin version": this.manifest.version,
        "Runner version": this.lastRunnerVersion > 0 ? String(this.lastRunnerVersion) : "(unknown)",
        "Runner minimum": String(RUNNER_MIN_VERSION),
        Platform: import_obsidian15.Platform.isAndroidApp ? "Android app" : import_obsidian15.Platform.isMobile ? "mobile" : "desktop",
        "Obsidian requires": this.manifest.minAppVersion,
        "Profile for this vault": s.profileId || "(none yet)",
        "Protected paths (effective)": this.effectiveProtectedPaths().join(", ") || "(none)",
        "Termux integration": String(s.termuxIntegrationEnabled)
      },
      entries: this.log.list(),
      runnerLog,
      progress
    });
    const name = logBundleName(now);
    const filePath = `${root}/${name}`;
    try {
      await adapter.write(filePath, text);
    } catch (e) {
      new ResultModal(this.app, "Could not write the log bundle", [
        `Writing ${filePath} failed: ${String(e)}`
      ], { isError: true }).open();
      return;
    }
    const nav = navigator;
    if (typeof nav.share === "function") {
      try {
        const file = new File([text], name, { type: "text/plain" });
        if (nav.canShare === void 0 || nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: "Native Git Bridge log" });
          return;
        }
      } catch {
      }
    }
    new ResultModal(
      this.app,
      "Log bundle written",
      [
        `Saved to ${filePath} inside the vault.`,
        "That folder is excluded from git, so the file will not show up as a change.",
        "Android's share sheet is not reachable from inside Obsidian, and the companion cannot reach the file either: it holds one permission, to run Termux, and reading shared storage is not it. So either copy the whole bundle below, or put a copy where Obsidian's own Share can see it."
      ],
      {
        stdout: text,
        actions: [
          {
            label: "Save as a note to share",
            cta: true,
            onClick: () => void this.saveLogBundleAsNote(text, name)
          }
        ]
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
  async saveLogBundleAsNote(text, bundleName) {
    const notePath = `${bundleName.replace(/\.txt$/, "")}.md`;
    const excluded = await this.runOperation("exclude-add", { path: LOG_NOTE_GLOB });
    try {
      await this.app.vault.adapter.write(notePath, ["```", text, "```", ""].join("\n"));
    } catch (e) {
      new import_obsidian15.Notice(`Could not write ${notePath}: ${String(e)}`);
      return;
    }
    if (excluded?.ok) this.excludeLines = (excluded.data?.excludeList ?? "").split("\n").filter(Boolean);
    this.openVaultFile(notePath);
    new import_obsidian15.Notice(
      excluded?.ok ? `Saved as ${notePath}. ${LOG_NOTE_GLOB} is excluded from git on this device, so it is not a change.` : `Saved as ${notePath} \u2014 git was not told to ignore it, so it shows as untracked.`
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
  offerFileMenu(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian16.TFile)) return;
    const menu = new import_obsidian15.Menu();
    this.app.workspace.trigger("file-menu", menu, file, "more-options");
    const win = this.app.workspace.containerEl.win;
    menu.showAtPosition({ x: Math.round(win.innerWidth / 2), y: 96 });
  }
  async cmdReapplySparse() {
    new ConfirmModal(
      this.app,
      {
        title: "Reapply sparse checkout?",
        body: [
          "This runs 'git sparse-checkout reapply' in Termux to re-hide paths excluded by your sparse rules.",
          "It does not delete data from the repository; it only updates which files are materialized in the working tree."
        ],
        confirmLabel: "Reapply sparse checkout"
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
              `Patterns now active: ${(result.data?.sparseList ?? "").split("\n").filter(Boolean).length}`
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
  isDarkTheme() {
    try {
      return activeDocument.body.classList.contains("theme-dark");
    } catch {
      return true;
    }
  }
  /** The colour set in force, or null while custom colours are switched off. */
  activeColorSet() {
    if (!this.sharedPrefs.customColors) return null;
    return this.isDarkTheme() ? this.sharedPrefs.colorsDark : this.sharedPrefs.colorsLight;
  }
  diffColorVars() {
    const set = this.activeColorSet();
    return set ? diffColorVars(set) : null;
  }
  conflictColorVars() {
    const set = this.activeColorSet();
    return set ? conflictColorVars(set) : null;
  }
  /** Re-apply display preferences (and colours) to every open diff/conflict pane. */
  refreshDiffPanes() {
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
  async setSharedPref(patch) {
    this.sharedPrefs = { ...this.sharedPrefs, ...patch };
    await this.saveData(this.sharedPrefs);
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW)) {
      const view = leaf.view;
      if (view instanceof DiffView) view.refreshDisplay();
    }
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
  absorbStatusData(d) {
    if (typeof d.remoteUrl === "string") this.lastRemoteUrl = d.remoteUrl;
    if (typeof d.rescueBranches === "string") this.offerRescueCleanup(d.rescueBranches);
    if (!d.branchInfo) return;
    const status = parseStatusPorcelainV2(d.branchInfo);
    if (d.untrackedChildren !== void 0)
      status.untrackedChildren = groupUntrackedChildren(d.untrackedChildren, status.untracked);
    const sparse = parseSparseState({
      sparseEnabled: d.sparseEnabled ?? "",
      sparseCone: d.sparseCone ?? "",
      sparseList: d.sparseList ?? "",
      skipWorktreeCount: d.skipWorktreeCount,
      lsFilesV: d.lsFilesV
    });
    this.absorbSparsePatterns(sparse);
    this.lastStatus = {
      status,
      sparse,
      lastCommit: parseLastCommit(d.lastCommit ?? ""),
      fetchedAt: (/* @__PURE__ */ new Date()).toLocaleString(),
      mergeInProgress: d.mergeInProgress === "true",
      mergeMsg: d.mergeMsg?.trim() ? d.mergeMsg : void 0,
      // Absent on runners older than this one, which is exactly "no rebase":
      // an old runner cannot report a state it does not look for, and treating
      // the missing field as `true` would put a banner on every panel.
      rebaseInProgress: d.rebaseInProgress === "true",
      shallow: d.shallow === "true",
      partialFilter: d.partialFilter?.trim() ? d.partialFilter.trim() : void 0,
      // Tri-state on purpose: a runner older than v15 does not report the
      // field, and "unknown" must not read as "no credentials" — that would
      // send every re-clone on an old runner to the Termux terminal.
      credsConfigured: d.credsConfigured === void 0 ? void 0 : d.credsConfigured === "true"
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
  absorbSparsePatterns(sparse) {
    const candidates = sparse.enabled ? sparseExclusionPaths(sparse.patterns) : [];
    const validated = validateProtectedPaths(candidates);
    const derived = validated.ok ? validated.normalized : [];
    const prev = this.deviceSettings.derivedProtectedPaths;
    const missing = prev.filter((p) => !derived.includes(p));
    if (missing.length > 0) {
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
  offerSparseReconcile(missing, remaining) {
    const sig = missing.join("\n");
    if (this.sparseReconcileOffered.has(sig)) return;
    this.sparseReconcileOffered.add(sig);
    const plural2 = missing.length === 1 ? "path" : "paths";
    new ResultModal(
      this.app,
      "Protected paths are no longer hidden",
      [
        `${missing.length} ${plural2} this device protects ${missing.length === 1 ? "is" : "are"} no longer excluded by the repository's sparse checkout \u2014 after a re-clone, or after the rules were changed outside the plugin:`,
        ...missing,
        "Hide & protect again puts the sparse exclusion back (this device only; the files leave the working tree, nothing leaves the repository). Release accepts the new state: the paths stay visible and lose the protection. Until you choose, the protection stays on."
      ],
      {
        actions: [
          {
            label: "Hide & protect again",
            cta: true,
            onClick: () => void this.reapplySparseExclusions(missing)
          },
          {
            label: "Release protection",
            onClick: () => {
              this.deviceSettings = this.store.write({ derivedProtectedPaths: remaining });
              this.log.add("info", "sparse", `Protection released for: ${missing.join(", ")}.`);
              new import_obsidian15.Notice(`No longer protected: ${missing.join(", ")}.`);
              this.pushStatusToView();
            }
          }
        ]
      }
    ).open();
  }
  /**
   * Re-hide the given paths one by one; each add refreshes the derived set.
   * skipConfirm: the reconcile window the user just answered WAS the
   * confirmation, and one question per path would ask it three more times.
   */
  async reapplySparseExclusions(paths) {
    for (const p of paths) {
      await this.cmdSparseExclude(p, true, true);
    }
  }
  /**
   * The protected set actually enforced: manual paths plus (unless disabled)
   * the exclusions git itself reports. Every operation argument goes through
   * here — never through deviceSettings.protectedPaths directly.
   */
  effectiveProtectedPaths() {
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
  renderStatusFailure(result) {
    const err = result.error;
    const ownership = looksLikeDubiousOwnership(
      `${err?.message ?? ""}
${err?.stderr ?? ""}`,
      err?.stdout
    );
    this.statusBar?.set("error");
    new ResultModal(this.app, "Native Git: status failed", [err?.message ?? "Unknown error."], {
      stdout: err?.stdout,
      stderr: err?.stderr,
      isError: true,
      actions: ownership ? [
        {
          label: "Copy the safe.directory fix\u2026",
          cta: true,
          keepOpen: true,
          onClick: () => this.cmdFixSafeDirectory()
        }
      ] : void 0
    }).open();
  }
  /** Shared error rendering for mutating operations. Never a bare "failed". */
  renderMutationError(title, result) {
    const err = result.error;
    const d = result.data ?? {};
    if (!d.branchInfo) {
      this.statusStale = true;
      this.pushStatusToView();
    }
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
        abortMerge: () => this.cmdAbortMerge()
      }).open();
      return;
    }
    this.statusBar?.set("error");
    const reason = summarizeGitError(err?.stderr, err?.stdout);
    const corrupt = looksLikeObjectCorruption(err?.stderr, err?.stdout);
    const staleLock = !corrupt && looksLikeStaleLock(err?.stderr, err?.stdout);
    const identity = !corrupt && !staleLock && needsGitIdentity(`${err?.message ?? ""}
${err?.stderr ?? ""}`, err?.stdout);
    const ownership = !corrupt && !staleLock && !identity && looksLikeDubiousOwnership(`${err?.message ?? ""}
${err?.stderr ?? ""}`, err?.stdout);
    const lines = [err?.message ?? "Unknown error.", ...reason];
    if (corrupt) {
      lines.push(
        "",
        "This is not about the operation you ran: the repository's object database is damaged. An empty object file is what git leaves when it was stopped mid-write \u2014 Android does that to Termux in the background, and a cancelled operation can do it too.",
        "The repair removes only files that are EMPTY, which cannot contain anything, and then fetches to bring the real objects back from the remote. Nothing that holds data is touched."
      );
    }
    if (staleLock) {
      lines.push(
        "",
        "A leftover lock file is blocking git: a process the system killed mid-write leaves .git/index.lock behind, and every operation fails on it until the file is removed. The button below stops Termux's processes (so nothing can be holding the lock) and deletes it."
      );
    }
    if (identity) {
      lines.push(
        "",
        "git has no name and email to sign this repository's commits with \u2014 a re-clone brings a fresh .git, and the local identity dies with the old one. The button copies the command that sets a LOCAL identity at the Termux terminal; what you type there never reaches the plugin."
      );
    }
    if (ownership) {
      lines.push(
        "",
        "git refuses to touch this repository because its files belong to another uid \u2014 the normal state of Android shared storage. The one-line fix tells git to trust exactly this directory; the button copies it and opens Termux."
      );
    }
    new ResultModal(this.app, title, lines, {
      stdout: err?.stdout,
      stderr: err?.stderr,
      isError: true,
      actions: corrupt ? [{ label: "Repair the repository", cta: true, onClick: () => void this.cmdRepairObjects() }] : staleLock ? [{ label: "Delete the stale lock\u2026", cta: true, onClick: () => this.cmdRepairStaleLock() }] : identity ? [{ label: "Set the git identity\u2026", cta: true, keepOpen: true, onClick: () => this.cmdSetGitIdentity() }] : ownership ? [{ label: "Copy the safe.directory fix\u2026", cta: true, keepOpen: true, onClick: () => this.cmdFixSafeDirectory() }] : void 0
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
  cmdRepairStaleLock() {
    if (this.lastRunnerVersion >= 16) {
      void this.runStaleLockTriage();
      return;
    }
    this.confirmStaleLockKill([]);
  }
  async runStaleLockTriage() {
    const t = await this.runOperation("repair-triage", {});
    if (!t) return;
    if (!t.ok) return this.renderMutationError("Native Git: triage failed", t);
    this.absorbStatusData(t.data ?? {});
    const d = t.data ?? {};
    const procs = (d.liveProcesses ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    const plan = decideStaleLock({
      lockExists: d.lockExists === "true",
      lockAgeSeconds: d.lockAgeSeconds === void 0 || d.lockAgeSeconds === "" ? null : Number(d.lockAgeSeconds),
      liveGit: d.liveGit === "true",
      liveProcesses: procs
    });
    if (plan.kind === "no-lock") {
      new import_obsidian15.Notice("No lock file is there \u2014 it may have been released already.");
      return;
    }
    if (plan.kind === "corpse") {
      const result = await this.runOperation("repair-stale-lock", { skipKill: true });
      if (!result) return;
      if (!result.ok) return this.renderMutationError("Native Git: unlock failed", result);
      this.absorbStatusData(result.data ?? {});
      new import_obsidian15.Notice(
        result.data?.lockRemoved === "true" ? "Stale lock removed \u2014 nothing was holding it, so nothing was stopped. Run the operation again." : "No lock file was there \u2014 it may have been released already. Run the operation again."
      );
      return;
    }
    if (plan.kind === "running") {
      new ResultModal(
        this.app,
        "A git command seems to be running",
        [
          `The lock was written ${d.lockAgeSeconds ?? "?"} seconds ago and a live git process exists \u2014 that reads as a command still working, not a leftover. Waiting is the safe choice: interrupting a write is how object files end up empty.`,
          `Running now:
${procs.join("\n")}`
        ],
        {
          isError: true,
          actions: [
            {
              label: "Stop Termux & delete anyway\u2026",
              onClick: () => this.confirmStaleLockKill(procs)
            }
          ]
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
  confirmStaleLockKill(procs) {
    new ConfirmModal(
      this.app,
      {
        title: "Delete the stale git lock?",
        body: [
          ".git/index.lock guards the repository while one git process writes. A process Android killed leaves it behind, and every operation then fails with 'another git process seems to be running'.",
          "To make the removal safe, EVERY Termux process is stopped first \u2014 including a terminal session, if one is open \u2014 and the runner arrives in a fresh Termux started by the trigger. Only then is the lock file deleted.",
          procs.length > 0 ? `What stops now: ${procs.join(", ")}.` : "Do not run this while a download you started in Termux is still visibly working."
        ],
        confirmLabel: "Stop Termux & delete the lock",
        icon: "lock-open",
        danger: true
      },
      async (ok) => {
        if (!ok) return;
        const result = await this.runOperation("repair-stale-lock", {});
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: unlock failed", result);
        this.absorbStatusData(result.data ?? {});
        const killed = (result.data?.killedProcesses ?? "").split("\n").filter((s) => s.trim() !== "").length;
        new import_obsidian15.Notice(
          result.data?.lockRemoved === "true" ? `Stale lock removed${killed > 0 ? ` (${killed} process${killed === 1 ? "" : "es"} stopped)` : ""}. Run the operation again.` : "No lock file was there \u2014 it may have been released already. Run the operation again."
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
  openTermuxCommandModal(opts) {
    if (opts.command === null) {
      new import_obsidian15.Notice(
        "Set the repository path in settings first \u2014 the command addresses the vault by its absolute path in Termux."
      );
      return;
    }
    const cmd = opts.command;
    void navigator.clipboard.writeText(cmd);
    new import_obsidian15.Notice("Command copied - long-press in Termux to paste, then Enter.");
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
          }
        }
      ]
    }).open();
  }
  /**
   * The identity fix as a button. The values are TYPED at the terminal and
   * stay in Termux (the user's rule: neither the plugin nor the runner may
   * learn the git name or email); the command ends by listing the two key
   * NAMES back, so git itself confirms visibly that both now exist.
   */
  cmdSetGitIdentity() {
    this.openTermuxCommandModal({
      command: identitySetupCommand(this.deviceSettings.repoPathHint),
      title: "Set the git identity in Termux",
      body: [
        "1. The command is copied. In Termux: paste, Enter, then type the name and the email git should sign this repository's commits with. git answers with the two keys it now has \u2014 the values stay in Termux.",
        "2. Come back and run the operation again. The identity is LOCAL to this repository, so a global one is no longer needed for it."
      ]
    });
  }
  /**
   * The `safe.directory` fix as a button. A repository git refuses cannot be
   * repaired through an ordinary action — the runner rejects the profile
   * before the dispatcher — so this stays a clipboard command by the user's
   * decision (0.6.6 spec): the safer path over a new dispatch state in the
   * runner's gating.
   */
  cmdFixSafeDirectory() {
    this.openTermuxCommandModal({
      command: safeDirectoryCommand(this.deviceSettings.repoPathHint),
      title: "Allow git to use this repository",
      body: [
        "1. The command is copied. In Termux: paste, Enter. It tells git to trust exactly this directory \u2014 the files on shared storage belong to another uid, which is why git refuses them.",
        "2. Come back and run the operation again."
      ]
    });
  }
  /**
   * Presence and scope, never a value: which scopes hold user.name,
   * user.email and credential.helper, read from the status fields a v16
   * runner reports, with the two one-tap exits where they apply. The ordering
   * rule is absolute: the global identity is never offered for removal while
   * this repository has no local one.
   */
  async cmdCheckIdentity() {
    const result = await this.runOperation("status", {});
    if (!result) return;
    if (!result.ok) return this.renderStatusFailure(result);
    this.absorbStatusData(result.data ?? {});
    const d = result.data ?? {};
    if (d.userNameScopes === void 0 && d.userEmailScopes === void 0) {
      new ResultModal(
        this.app,
        "Termux runner is too old for this",
        [
          `The identity check needs runner v16; this device answers with v${this.lastRunnerVersion}.`,
          RUNNER_OUTDATED_HINT
        ],
        { isError: true }
      ).open();
      return;
    }
    const scopesOf = (v) => (v ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    const nameScopes = scopesOf(d.userNameScopes);
    const emailScopes = scopesOf(d.userEmailScopes);
    const helperScopes = scopesOf(d.credHelperScopes);
    const hasLocal = nameScopes.includes("local") && emailScopes.includes("local");
    const hasGlobal = nameScopes.includes("global") || emailScopes.includes("global");
    const hasAny = nameScopes.length > 0 && emailScopes.length > 0;
    const globalHelper = helperScopes.includes("global") || helperScopes.includes("system");
    const lines = [
      hasAny ? "git has an identity to commit with. Where each key is set (values are never read):" : "git has NO identity to commit with \u2014 the next commit or sync will fail. Where each key is set:",
      `user.name: ${nameScopes.join(", ") || "not set in any scope"}`,
      `user.email: ${emailScopes.join(", ") || "not set in any scope"}`,
      `credential.helper: ${helperScopes.join(", ") || "not set in any scope"}`
    ];
    if (!hasLocal) {
      lines.push(
        "",
        hasGlobal ? "This repository has no LOCAL identity, so commits fall back to the global one \u2014 silently, and again after every re-clone. Set a local identity first; only then is removing the global one safe." : "This repository has no LOCAL identity. Set one with the button below; the values are typed in Termux and stay there."
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
    const actions = [];
    actions.push({
      label: hasLocal ? "Change the git identity\u2026" : "Set the git identity\u2026",
      cta: !hasLocal,
      keepOpen: true,
      onClick: () => this.cmdSetGitIdentity()
    });
    if (hasLocal && hasGlobal) {
      actions.push({
        label: "Remove the global identity\u2026",
        onClick: () => this.cmdDropGlobalIdentity()
      });
    }
    if (globalHelper) {
      actions.push({
        label: "Prefer this repository's credentials\u2026",
        onClick: () => this.cmdResetCredHelper()
      });
    }
    new ResultModal(this.app, "Git identity check", lines, {
      actions: actions.length > 0 ? actions : void 0
    }).open();
  }
  /**
   * Value-free removal (`--unset-all` reads nothing). Reached only from the
   * identity check, which offers it only while a local identity exists; the
   * runner enforces the same rule again, defense in depth.
   */
  cmdDropGlobalIdentity() {
    new ConfirmModal(
      this.app,
      {
        title: "Remove the global git identity?",
        body: [
          "Removes user.name and user.email from Termux's global git configuration. The values are not read or shown anywhere.",
          "This repository keeps its own local identity. Any OTHER repository on this device without a local identity will refuse to commit until it gets one \u2014 that is the point: no more commits signed by accident."
        ],
        confirmLabel: "Remove global identity",
        danger: true
      },
      async (ok) => {
        if (!ok) return;
        const result = await this.runOperation("identity-drop-global", {});
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: identity removal failed", result);
        this.absorbStatusData(result.data ?? {});
        new import_obsidian15.Notice("Global git identity removed.");
      }
    ).open();
  }
  /** The empty-value reset that stops a global helper answering first. */
  cmdResetCredHelper() {
    new ConfirmModal(
      this.app,
      {
        title: "Prefer this repository's credentials?",
        body: [
          "A global credential helper currently answers before this repository's own credential file, so operations here can use another account's saved credentials.",
          "This writes two lines into the repository's LOCAL git config: an empty helper that stops the inherited list, then the profile's own credential file. The global configuration is not touched, and no credential is read or shown.",
          "If the profile's file is empty, the next network operation asks for credentials once, in Termux, and saves them there."
        ],
        confirmLabel: "Make the local file win"
      },
      async (ok) => {
        if (!ok) return;
        const result = await this.runOperation("cred-helper-local-reset", {});
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: credential reset failed", result);
        this.absorbStatusData(result.data ?? {});
        new import_obsidian15.Notice("This repository's own credential file now answers first.");
      }
    ).open();
  }
  openVaultFile(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian16.TFile) void this.app.workspace.getLeaf(false).openFile(f);
    else new import_obsidian15.Notice(`Cannot open ${path} (not found in vault).`);
  }
  async cmdFetch() {
    const result = await this.runOperation("fetch");
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: fetch failed", result);
    this.absorbStatusData(result.data ?? {});
    const st = this.lastStatus?.status;
    this.notify(`Fetched. Ahead ${st?.ahead ?? "?"}, behind ${st?.behind ?? "?"}.`);
  }
  async cmdPull(silent = false) {
    const result = await this.runOperation("pull", {
      protectedPaths: this.effectiveProtectedPaths()
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
  guardPathLimits() {
    const candidates = this.app.vault.getFiles().map((f) => f.path);
    const issues = checkPathLimits(candidates);
    if (issues.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let handled = false;
      const shown = issues.slice(0, 8);
      const lines = [
        `${issues.length === 1 ? "One path is" : `${issues.length} paths are`} too long for other machines: the commit would succeed here and every other clone would fail to check it out ("Filename too long").`,
        ...shown.map(
          (i) => `\u2022 ${i.path}` + (i.needsFolderRename ? " \u2014 a FOLDER name is the problem; rename it in Obsidian first" : "")
        ),
        ...issues.length > shown.length ? [`\u2026and ${issues.length - shown.length} more.`] : []
      ];
      const renamable = issues.filter((i) => !i.needsFolderRename);
      new ResultModal(this.app, "Filenames too long for other machines", lines, {
        isError: true,
        actions: [
          ...renamable.length > 0 ? [
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
                      await this.app.fileManager.renameFile(f, to);
                      taken.add(to);
                      renamed += 1;
                      this.log.add("info", "path-limits", `Renamed for other machines: ${i.path} \u2192 ${to}`);
                    } catch (e) {
                      this.log.add("error", "path-limits", `Could not rename ${i.path}: ${String(e)}`);
                    }
                  }
                  this.notify(`Native Git: shortened ${renamed} filename${renamed === 1 ? "" : "s"}.`);
                  resolve(renamed === issues.length);
                })();
              }
            }
          ] : [],
          {
            label: "Commit anyway",
            onClick: () => {
              handled = true;
              resolve(true);
            }
          }
        ],
        onDismiss: () => {
          if (!handled) resolve(false);
        }
      }).open();
    });
  }
  async cmdCommit() {
    if (!await this.guardPathLimits()) return;
    const mergeMsg = this.lastStatus?.mergeInProgress ? this.lastStatus.mergeMsg : void 0;
    const rendered = this.sharedPrefs.commitTemplates.map(
      (t) => renderCommitTemplate(t, this.sharedPrefs.commitDateFormat)
    );
    const suggestions = mergeMsg ? [] : [...rendered, ...this.recentCommitMessages().filter((r) => !rendered.includes(r))];
    new CommitMessageModal(
      this.app,
      {
        title: mergeMsg ? "Commit merge" : "Commit changes",
        placeholder: "Commit message\u2026",
        submitLabel: "Commit",
        initial: mergeMsg,
        suggestions
      },
      async (message) => {
        if (message === null) return;
        if (message !== mergeMsg) this.rememberCommitMessage(message);
        const result = await this.runOperation("commit", {
          protectedPaths: this.effectiveProtectedPaths(),
          message
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: commit failed", result);
        this.absorbStatusData(result.data ?? {});
        const committed = result.data?.committed === "true";
        this.reportSuccess(
          "Native Git: commit",
          [
            committed ? `Committed ${result.data?.newHead?.slice(0, 8) ?? ""}.` : "Nothing to commit (no staged changes after safety filtering)."
          ],
          result.data?.commitOutput
        );
      }
    ).open();
  }
  async cmdPush() {
    const result = await this.runOperation("push", {
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: push failed", result);
    this.absorbStatusData(result.data ?? {});
    this.reportSuccess("Native Git: push", ["Push completed."], result.data?.pushOutput);
  }
  /** The template the automatic sync commit uses, rendered for this moment. */
  renderedAutoCommitMessage() {
    return renderCommitTemplate(this.sharedPrefs.autoCommitTemplate, this.sharedPrefs.commitDateFormat);
  }
  /** This device's recently typed commit messages, newest first. */
  recentCommitMessages() {
    try {
      const raw = JSON.parse(this.store.getValue(RECENT_COMMIT_MESSAGES_KEY) ?? "[]");
      return Array.isArray(raw) ? raw.filter((r) => typeof r === "string") : [];
    } catch {
      return [];
    }
  }
  rememberCommitMessage(msg) {
    const next = pushRecentMessage(
      this.recentCommitMessages(),
      msg,
      this.deviceSettings.recentCommitMessagesMax
    );
    this.store.setValue(RECENT_COMMIT_MESSAGES_KEY, JSON.stringify(next));
  }
  async cmdSync(message, silent = false) {
    if (!await this.guardPathLimits()) return;
    const mergeMsg = this.lastStatus?.mergeInProgress ? this.lastStatus.mergeMsg : void 0;
    const result = await this.runOperation("sync", {
      protectedPaths: this.effectiveProtectedPaths(),
      message: message ?? mergeMsg ?? this.renderedAutoCommitMessage()
    });
    if (!result) return;
    if (!result.ok) {
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
    this.store.setValue(LAST_SYNC_KEY, (/* @__PURE__ */ new Date()).toLocaleString());
    const lines = [
      `Steps: ${(result.data?.steps ?? "").split(",").join(" \u2192 ")}`,
      `Committed: ${result.data?.committed ?? "false"} \xB7 Pushed: ${result.data?.pushed ?? "false"}`
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
  async restoreBlockFromCommit(path, hunk, commitish) {
    const outcome = await restoreBlockInFile(path, hunk, {
      readFile: (p) => this.readVaultTextFile(p),
      writeFile: async (p, content) => {
        await this.app.vault.adapter.write(p, content);
      },
      stagePatch: (patch) => this.applyHunkPatch(patch, "index", false)
    });
    new import_obsidian15.Notice(describeRestore(outcome, commitish.replace(/\^+$/, "").slice(0, 8)));
    if (outcome.kind === "restored") void this.cmdStatus(true);
  }
  async cmdRepairObjects(skipConfirm = false) {
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
          "One repair walks every known problem in order: a leftover lock, the git identity and credential scopes, the sparse definition, then the object database \u2014 short steps, so a repair Android interrupts loses one step and not the whole run.",
          "Safe fixes happen by themselves and are narrated in the output panel; anything irreversible, expensive or needing Termux is asked about or listed at the end with its exact fix.",
          "Nothing that holds data is deleted. Objects that are damaged but not empty are reported instead, because they may still be recoverable.",
          "Your files, your commits and your remote are untouched by the repair itself; if a step needs anything more it asks before doing it."
        ],
        confirmLabel: "Repair"
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
  async runRepairPreSteps() {
    const summary = [];
    const actions = [];
    const triage = await this.repairStep("repair-triage", {}, "repair 1/7: triage");
    if (triage === null) return null;
    if (!triage.ok) {
      const err = triage.error;
      if (looksLikeDubiousOwnership(`${err?.message ?? ""}
${err?.stderr ?? ""}`, err?.stdout)) {
        new ResultModal(
          this.app,
          "Repository blocked: ownership",
          [
            "git refuses this repository because its files belong to another uid \u2014 the normal state of Android shared storage \u2014 and every other repair step is blocked behind it.",
            "The one-line fix tells git to trust exactly this directory. Run it in Termux, then start the repair again."
          ],
          {
            isError: true,
            actions: [
              {
                label: "Copy the safe.directory fix\u2026",
                cta: true,
                keepOpen: true,
                onClick: () => this.cmdFixSafeDirectory()
              }
            ]
          }
        ).open();
        return null;
      }
      this.renderMutationError("Native Git: repair could not start", triage);
      return null;
    }
    const d = triage.data ?? {};
    const list = (v) => (v ?? "").split("\n").map((s) => s.trim()).filter((s) => s !== "");
    const nameScopes = list(d.userNameScopes);
    const emailScopes = list(d.userEmailScopes);
    const helperScopes = list(d.credHelperScopes);
    const sparsePatterns = list(d.sparseList);
    const procs = list(d.liveProcesses);
    const facts = {
      lock: {
        lockExists: d.lockExists === "true",
        lockAgeSeconds: d.lockAgeSeconds === void 0 || d.lockAgeSeconds === "" ? null : Number(d.lockAgeSeconds),
        liveGit: d.liveGit === "true",
        liveProcesses: procs
      },
      identity: {
        local: nameScopes.includes("local") && emailScopes.includes("local"),
        global: nameScopes.includes("global") || emailScopes.includes("global"),
        any: nameScopes.length > 0 && emailScopes.length > 0
      },
      globalCredHelper: helperScopes.includes("global") || helperScopes.includes("system"),
      sparse: {
        enabled: d.sparseEnabled === "true",
        cone: d.sparseCone === "true",
        hasBase: sparsePatterns.includes("/*"),
        hasEmptyingDefault: sparsePatterns.includes("!/*/"),
        // Anything the plugin's own model never writes: an include line other
        // than the `/*` base, or the exclude-everything `!/*`. Such a set is
        // somebody's hand-made definition and the repair must not touch it.
        foreign: sparsePatterns.some((p) => !p.startsWith("!") && p !== "/*" || p === "!/*")
      },
      rescueBranches: list(d.rescueBranches),
      previousGitDirs: list(d.previousGitDirs)
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
        summary.push("Removed a leftover index.lock \u2014 nothing was holding it, nothing was stopped.");
        continue;
      }
      if (item.step === "lock" && item.act === "wait-running") {
        new ResultModal(
          this.app,
          "A git command seems to be running",
          [
            `The lock was written ${d.lockAgeSeconds ?? "?"} seconds ago and a live git process exists \u2014 that reads as a command still working. The repair stops here: waiting is the safe choice, and interrupting a write is how object files end up empty.`,
            `Running now:
${procs.join("\n")}`,
            "Run the repair again once it finishes."
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
          label: "Delete the stale lock\u2026",
          keepOpen: true,
          onClick: () => this.confirmStaleLockKill(procs)
        });
        continue;
      }
      if (item.step === "identity" && item.act === "offer-set") {
        summary.push(
          facts.identity.any ? "This repository has no LOCAL git identity: commits fall back to the global one, silently, and again after every re-clone." : "git has NO identity to commit with \u2014 the next commit or sync will fail."
        );
        actions.push({
          label: "Set the git identity\u2026",
          keepOpen: true,
          onClick: () => this.cmdSetGitIdentity()
        });
        continue;
      }
      if (item.step === "identity" && item.act === "offer-drop-global") {
        summary.push(
          "A global git identity exists beside this repository's local one; any repository without a local identity commits under it."
        );
        actions.push({
          label: "Remove the global identity\u2026",
          keepOpen: true,
          onClick: () => this.cmdDropGlobalIdentity()
        });
        continue;
      }
      if (item.step === "cred-helper") {
        summary.push(
          "A global credential helper answers before this repository's own credential file."
        );
        actions.push({
          label: "Prefer this repository's credentials\u2026",
          keepOpen: true,
          onClick: () => this.cmdResetCredHelper()
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
      if (item.step === "sparse" && item.act === "foreign-needs-decision") {
        summary.push(
          "The sparse definition is hand-made (an include list, not this plugin's include-everything-then-exclude shape). The repair leaves it alone: rebuilding it would destroy patterns nothing else stores. If files are unexpectedly missing, review .git/info/sparse-checkout in Termux."
        );
        continue;
      }
      if (item.step === "leftovers" && item.act === "rescue-branches") {
        summary.push(
          `Repair backup branch${facts.rescueBranches.length === 1 ? "" : "es"} still there: ${facts.rescueBranches.join(", ")} \u2014 holding disk until deleted.`
        );
        actions.push({
          label: "Delete repair backup branch\u2026",
          keepOpen: true,
          onClick: () => this.cmdRescueCleanup()
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
  async repairStep(action, args, stepLabel) {
    this.repairJobStep = stepLabel;
    this.store.setValue(REPAIR_JOB_KEY, JSON.stringify({ step: stepLabel, startedAt: Date.now() }));
    const result = await this.runOperation(action, args, true);
    if (result === null) return null;
    const d = result.data ?? {};
    this.log.add(
      result.ok ? "info" : "error",
      action,
      `${stepLabel} finished ok=${result.ok}.`,
      [
        d.removedCount !== void 0 ? `removed: ${d.removedCount}` : "",
        (d.recoveredBy ?? "") !== "" ? `recovered by: ${d.recoveredBy}` : "",
        d.recoveredCount !== void 0 ? `recovered: ${d.recoveredCount}` : "",
        (d.fsckMissing ?? "").trim() !== "" ? `still missing:
${(d.fsckMissing ?? "").trim()}` : "still missing: nothing"
      ].filter((l) => l !== "").join("\n")
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
  repairRunAgainAction() {
    return { label: "Run the repair again", onClick: () => void this.cmdRepairObjects(true) };
  }
  /**
   * The repair as a queue of short requests, sequenced here and decided by
   * `decideRepair` (pure, tested against the log bundle that motivated it).
   * While the job runs every other request is refused, across the gaps between
   * steps too; a restart mid-job is offered a continue, never resumed silently.
   */
  async runRepairJob() {
    if (this.repairJobStep !== null) {
      new import_obsidian15.Notice("A repair is already running.");
      return;
    }
    try {
      let summary = [];
      let finalActions = [];
      if (this.lastRunnerVersion >= 16) {
        if (this.sharedPrefs.openOutputForLongOps) void this.openOutputPanel();
        const pre = await this.runRepairPreSteps();
        if (pre === null) return;
        summary = pre.summary;
        finalActions = pre.actions;
      }
      const scan = await this.repairStep("repair-scan", {}, "repair 4/7: object scan");
      if (scan === null || !scan.ok) {
        if (scan !== null) this.renderMutationError("Native Git: repair could not scan", scan);
        return;
      }
      const sd = scan.data ?? {};
      const removed = Number(sd.removedCount ?? "0");
      const ctx = {
        ahead: Number(sd.aheadCount ?? "0"),
        cacheTreeBroken: sd.cacheTreeBroken === "true",
        hasUpstream: sd.hasUpstream === "true"
      };
      const removedLine = removed === 0 ? "No empty object files were found; nothing needed removing." : `Removed ${removed} empty object file${removed === 1 ? "" : "s"}.`;
      let stage = "scan";
      let findings = {
        fsckMissing: (sd.fsckMissing ?? "").trim(),
        fsckRemaining: (sd.fsckRemaining ?? "").trim()
      };
      let recoveredBy = "";
      for (; ; ) {
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
            fsckRemaining: (fd.fsckRemaining ?? "").trim()
          };
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
                ...summary.length > 0 ? [...summary, ""] : [],
                removedLine,
                (recoveredBy === "" ? "The targeted fetch recovered nothing \u2014 this remote does not hand out single objects." : "The targeted fetch did not bring everything back.") + " The remaining step downloads the whole history again; run the repair again when you are ready for that.",
                summarizeFsckMissing(findings.fsckMissing)
              ],
              {
                isError: true,
                stderr: findings.fsckRemaining,
                actions: [...finalActions, this.repairRunAgainAction()]
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
            fsckRemaining: (rd.fsckRemaining ?? "").trim()
          };
          recoveredBy = (rd.recoveredBy ?? "").trim() || recoveredBy;
          stage = "refetch";
          continue;
        }
        const howLine = recoveredBy === "targeted" ? "Asked the remote for the missing objects themselves, so nothing else was downloaded." : recoveredBy === "recovery copy" ? "This git has no --refetch, so the history was downloaded into a temporary copy and the missing objects taken from it." : recoveredBy === "refetch" ? "Refetched the whole history from the remote, so anything it still has is back." : "";
        const lines = [
          ...summary.length > 0 ? [...summary, ""] : [],
          removedLine,
          ...howLine !== "" ? [howLine] : []
        ];
        if (decision.kind === "clean") {
          lines.push("", "The object store is complete: git can read everything it references.");
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
                  `This repository is set to stay lightweight, but its packs hold ${formatSize(blobKb)} of file content the filter allows shedding${recoveredBy === "refetch" || recoveredBy === "recovery copy" ? " \u2014 the refetch brought back what had been shed" : ""}. The cleanup takes it back.`
                );
                finalActions = [
                  ...finalActions,
                  {
                    label: `Free up ${formatSize(blobKb)}\u2026`,
                    onClick: () => void this.runMaintenanceSteps(before)
                  }
                ];
              }
            }
          }
          new ResultModal(this.app, "Repository repaired", lines, {
            stdout: sd.removedObjects,
            actions: finalActions.length > 0 ? finalActions : void 0
          }).open();
          return;
        }
        if (decision.kind === "damaged") {
          lines.push(
            "",
            "Nothing is missing any more. What git still reports is damaged content in objects that are NOT empty, and those are left alone on purpose: they may hold recoverable data, and recovering them means working in Termux \u2014 `git cat-file`, or restoring that object from another clone.",
            findings.fsckRemaining
          );
          new ResultModal(this.app, "Damaged objects left alone", lines, {
            stderr: findings.fsckRemaining,
            isError: true,
            actions: [...finalActions, this.repairRunAgainAction()]
          }).open();
          return;
        }
        if (decision.kind === "offer-reset") {
          lines.push(
            "",
            `The remote does not have these objects, and this branch carries local-only state (${ctx.ahead > 0 ? `${ctx.ahead} unpushed commit${ctx.ahead === 1 ? "" : "s"}` : "a damaged index"}), so the damage is inside what was never pushed. Downloading cannot fix it and cloning again would throw the local commits away.`,
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
                onClick: () => void this.cmdRepairResetUpstream(ctx.ahead)
              },
              ...finalActions,
              this.repairRunAgainAction()
            ]
          }).open();
          return;
        }
        lines.push(
          "",
          "The remote does not have these objects either, so nothing can bring them back: the history that referenced them is gone on both sides. Cloning the vault again is the way out \u2014 your notes on disk are not affected by it.",
          summarizeFsckMissing(findings.fsckMissing)
        );
        new ResultModal(this.app, "Repository still incomplete", lines, {
          stderr: findings.fsckRemaining,
          isError: true,
          actions: [...finalActions, this.repairRunAgainAction()]
        }).open();
        return;
      }
    } finally {
      this.repairJobStep = null;
      this.store.removeValue(REPAIR_JOB_KEY);
    }
  }
  offerRescueCleanup(raw) {
    const refs = raw.split("\n").filter((r) => /^ngb-rescue-/.test(r.trim()));
    this.lastRescueBranches = refs;
    if (refs.length === 0) return;
    const today = (/* @__PURE__ */ new Date()).toDateString();
    if (this.store.getValue("rescue-reminded") === today) return;
    this.store.setValue("rescue-reminded", today);
    this.showRescueCleanup(refs);
  }
  /**
   * On demand from the palette too, not only once a day: the daily gate left a
   * user with a branch they WANTED gone (its shed blobs were spamming every
   * prune with "not our ref") and no button until tomorrow.
   */
  cmdRescueCleanup() {
    if (this.lastRescueBranches.length === 0) {
      new import_obsidian15.Notice("No ngb-rescue backup branch is known. Run Status once if one should be here.");
      return;
    }
    this.showRescueCleanup(this.lastRescueBranches);
  }
  showRescueCleanup(refs) {
    new ResultModal(
      this.app,
      "A repair backup branch is still here",
      [
        `${refs.length === 1 ? `The branch '${refs[0]}' keeps` : `${refs.length} ngb-rescue branches keep`} the history a rebuild abandoned. Once you have checked nothing is lost, delete ${refs.length === 1 ? "it" : "them"} \u2014 until then the repair check keeps naming the old objects.`
      ],
      {
        actions: refs.slice(0, 3).map((r) => ({
          label: `Delete ${r}`,
          onClick: () => void this.cmdDropRescueBackup(r)
        }))
      }
    ).open();
  }
  async cmdDropRescueBackup(ref) {
    new ConfirmModal(
      this.app,
      {
        title: "Delete the backup branch?",
        body: [
          `'${ref}' points at the history that was abandoned by the rebuild. Deleting it makes those commits unreachable \u2014 check first that everything you need is in your files or already synced.`,
          "Your files and the rebuilt branch are not touched by this."
        ],
        confirmLabel: "Delete",
        danger: true
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
  confirmRefetch(missing) {
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: "Download the whole history?",
          body: [
            "The targeted fetch did not bring these objects back, so the remaining route downloads the repository's entire history again. On a large vault that is the full size of the repository, over this device's current connection.",
            "Nothing local is overwritten by it: the download only ADDS objects.",
            missing
          ],
          confirmLabel: "Download"
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
  async cmdRepairResetUpstream(ahead) {
    new ConfirmModal(
      this.app,
      {
        title: "Rebuild on the remote state?",
        body: [
          `This moves the branch to what the remote has and rebuilds the index from it. Every file on disk stays exactly as it is \u2014 nothing is deleted or reverted \u2014 and everything the ${ahead > 0 ? `${ahead} local commit${ahead === 1 ? "" : "s"}` : "local history"} contained shows up as uncommitted changes, for the next sync to commit once.`,
          "The old history stays reachable under a backup branch, so nothing becomes unrecoverable. The local commit messages are what is lost: the separate commits become one.",
          "Anything currently staged is unstaged by the rebuild."
        ],
        confirmLabel: "Rebuild",
        danger: true
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
            `The old history is kept under the branch '${backup}'. Once you have checked nothing is lost, delete it with the button below \u2014 the repair check keeps naming its objects until it is gone.`
          ],
          {
            actions: backup !== "" ? [
              {
                label: "Delete the backup branch",
                onClick: () => void this.cmdDropRescueBackup(backup)
              }
            ] : void 0
          }
        ).open();
      }
    ).open();
  }
  async cmdAbortMerge() {
    new ConfirmModal(
      this.app,
      {
        title: "Abort merge?",
        body: [
          "This runs 'git merge --abort' and returns the repository to its state before the pull.",
          "Conflict resolutions you already made in the affected files will be discarded."
        ],
        confirmLabel: "Abort merge",
        danger: true
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
  reportAbortMergeFailure(result) {
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
        { label: "Reapply sparse rules", cta: true, onClick: () => void this.cmdReapplySparse() }
      ]
    }).open();
  }
  /**
   * The two exits from an unfinished rebase. Nothing in this plugin starts a
   * rebase; one can only be here because it was started in Termux. Before the
   * panel banner existed, that state was invisible and inescapable from inside
   * Obsidian, exactly like the unfinished merge it sits next to.
   */
  async cmdAbortRebase() {
    new ConfirmModal(
      this.app,
      {
        title: "Abort rebase?",
        body: [
          "This runs 'git rebase --abort' and returns the branch to where it was before the rebase started.",
          "Conflict resolutions you already made during the rebase will be discarded."
        ],
        confirmLabel: "Abort rebase",
        danger: true
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
  async cmdContinueRebase() {
    const result = await this.runOperation("continue-rebase");
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: continue rebase failed", result);
    this.absorbStatusData(result.data ?? {});
    this.notify("Rebase continued.");
  }
  // ---------------------------------------------------- phase 4: history/diff
  activeFilePath() {
    const f = this.app.workspace.getActiveFile();
    if (!f) {
      new import_obsidian15.Notice("No active file.");
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
  cmdFileHistory() {
    const path = this.activeFilePath();
    if (path === null) return;
    void this.openFileHistoryPanel(path);
  }
  /**
   * `date` is optional because the diff pane reaches this with a commit-ish and
   * nothing else: it offers the file itself when there is no diff to show, and
   * at that point it has a `HEAD`, a hash or a `hash^`, not a log entry.
   */
  async showFileAtCommit(path, hash, date) {
    const result = await this.runOperation("show-file-at-commit", { path, commit: hash });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: show file failed", result);
    const bytes = decodeBase64ToBytes(result.data?.contentBase64 ?? "");
    const text = bytesToTextIfNotBinary(bytes);
    const when = date === void 0 ? "" : ` \xB7 ${date.slice(0, 16).replace("T", " ")}`;
    const meta = `${path} @ ${hash.slice(0, 8)}${when} \xB7 ${bytes.length} bytes`;
    if (text === null) {
      new ResultModal(this.app, "Binary file", [
        `${path} at ${hash.slice(0, 8)} is binary (${bytes.length} bytes); preview is not available.`,
        "Restore is still possible from the history list."
      ]).open();
      return;
    }
    new TextPreviewModal(this.app, "File at commit", meta, text).open();
  }
  async cmdDiffCurrentFile() {
    const path = this.activeFilePath();
    if (path === null) return;
    await this.openDiffPane({ path, from: "HEAD", to: "WORKTREE", label: "HEAD \u2192 working tree" });
  }
  confirmRestore(currentPath, e) {
    const renamed = e.pathAtCommit !== currentPath;
    new ConfirmModal(
      this.app,
      {
        title: "Restore file version?",
        body: [
          `File: ${e.pathAtCommit}`,
          `Version: ${e.hash.slice(0, 8)} (${e.date.slice(0, 16).replace("T", " ")}) \u2014 ${e.subject}`,
          renamed ? `Note: the file had a different name at that commit. The historical content will be written into the CURRENT file (${currentPath}); nothing is created at the old path.` : "The current working-tree content of this file will be overwritten. The version stays in Git history, but uncommitted edits to this file are lost."
        ],
        confirmLabel: "Restore this version",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        if (renamed) {
          const result2 = await this.runOperation("show-file-at-commit", {
            path: e.pathAtCommit,
            commit: e.hash
          });
          if (!result2) return;
          if (!result2.ok) return this.renderMutationError("Native Git: restore failed", result2);
          const bytes = decodeBase64ToBytes(result2.data?.contentBase64 ?? "");
          await this.app.vault.adapter.writeBinary(
            currentPath,
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          );
          this.log.add("info", "restore-file", `Restored ${currentPath} from ${e.hash} (historical name ${e.pathAtCommit}).`);
          this.notify("File content restored from the selected version.");
          return;
        }
        const result = await this.runOperation("restore-file", {
          path: currentPath,
          commit: e.hash,
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: restore failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify(`Restored ${currentPath} from ${e.hash.slice(0, 8)}.`);
      }
    ).open();
  }
  // ------------------------------------------------- status panel & selfcheck
  async openStatusPanel(reveal = true) {
    const existing = this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW);
    if (existing.length > 0) {
      if (reveal) await this.app.workspace.revealLeaf(existing[0]);
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
  async openHistoryPanel() {
    const existing = this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      const view = existing[0].view;
      if (view instanceof HistoryView) await view.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_HISTORY_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  /** Open (or retarget) the history panel of ONE file. */
  async openFileHistoryPanel(path) {
    const existing = this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW);
    const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: NGB_FILE_HISTORY_VIEW, active: true, state: { path } });
    await this.app.workspace.revealLeaf(leaf);
  }
  async loadFileLogPage(path, skip, limit) {
    const result = await this.runOperation("file-log", { path, skip, limit });
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: history failed", result);
      return null;
    }
    return parseFileLog(result.data?.log ?? "", path);
  }
  async loadRepoLogPage(skip, limit) {
    const result = await this.runOperation("repo-log", { skip, limit });
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: history failed", result);
      return null;
    }
    return parseRepoLog(result.data?.log ?? "");
  }
  /** The diff a commit introduced for one file, in an Obsidian pane. */
  async openCommitDiff(file, entry2) {
    const short = entry2.hash.slice(0, 8);
    await this.openDiffPane({
      path: file.path,
      from: `${entry2.hash}^`,
      to: entry2.hash,
      label: `${short}^ \u2192 ${short}`
    });
  }
  /**
   * Tap on a changed file in the status panel. A STAGED row shows what would
   * be committed (HEAD → index); an unstaged row shows what is NOT staged yet
   * (index → worktree) — so a file staged and then edited again shows two
   * genuinely different diffs.
   */
  async openStatusDiff(path, group) {
    if (group === "staged") {
      await this.openDiffPane({ path, from: "HEAD", to: "INDEX", label: "HEAD \u2192 staged" });
      return;
    }
    await this.openDiffPane({ path, from: "INDEX", to: "WORKTREE", label: "staged \u2192 working tree" });
  }
  async openDiffPane(state) {
    const existing = this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW);
    const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: NGB_DIFF_VIEW,
      active: true,
      state
    });
    await this.app.workspace.revealLeaf(leaf);
  }
  // ------------------------------------------------- conflict resolution
  /** Vault file as text, or null when it looks binary (NUL byte probe). */
  async readVaultTextFile(path) {
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
  async openConflict(path, pos) {
    const text = await this.readVaultTextFile(path);
    if (text !== null) {
      const existing = this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW);
      const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: NGB_CONFLICT_VIEW, active: true, state: { path } });
      await this.app.workspace.revealLeaf(leaf);
      return;
    }
    const menu = new import_obsidian15.Menu();
    this.buildGitMenu(menu, path);
    menu.showAtPosition(pos);
  }
  /** Whole-file resolution via the runner, after explicit confirmation. */
  cmdResolveConflict(path, side) {
    new ConfirmModal(
      this.app,
      {
        title: side === "ours" ? "Keep the LOCAL version (yours)?" : "Keep the REMOTE version?",
        body: [
          `File: ${path}`,
          side === "ours" ? "The incoming remote changes to this file are discarded; your local version is kept and the file is marked resolved." : "Your local changes to this file are discarded; the incoming remote version is kept and the file is marked resolved.",
          "This cannot be undone for the losing side's uncommitted content."
        ],
        confirmLabel: side === "ours" ? "Keep local" : "Keep remote",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("resolve-conflict", {
          path,
          side,
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: resolve failed", result);
        this.absorbStatusData(result.data ?? {});
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
  openWithDefaultApp(path) {
    const anyApp = this.app;
    if (typeof anyApp.openWithDefaultApp === "function") anyApp.openWithDefaultApp(path);
    else new import_obsidian15.Notice("Opening with the default app is not available in this Obsidian version.");
  }
  /**
   * Unified diff text for the diff pane. A root commit has no parent: when
   * "<hash>^" fails, the diff is retried against git's canonical empty tree,
   * so the first commit renders as all-additions instead of an error.
   */
  async loadDiffText(path, from, to, limitKb) {
    const maxBytes = (limitKb ?? this.deviceSettings.diffLimitKb) * 1024;
    let result = await this.runOperation("diff-file", { path, from, to, maxBytes });
    if (result && !result.ok && from.endsWith("^")) {
      result = await this.runOperation("diff-file", {
        path,
        from: EMPTY_TREE_HASH,
        to,
        maxBytes
      });
    }
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: diff failed", result);
      return null;
    }
    const d = result.data ?? {};
    const num = (k) => {
      const n = Number(d[k]);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      diff: d.diff ?? "",
      truncated: d.truncated === "true",
      hunksShown: num("hunksShown"),
      hunksTotal: num("hunksTotal"),
      totalBytes: num("diffBytesTotal"),
      limitBytes: num("diffBytesLimit") || maxBytes
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
  async applyHunkPatch(patch, target, reverse) {
    const result = await this.runOperation("apply-patch", {
      patch,
      target,
      reverse,
      protectedPaths: this.effectiveProtectedPaths()
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
  updateProgressInView(text, detail = null) {
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW)) {
      const view = leaf.view;
      if (view instanceof StatusView) view.updateProgressText(text, detail);
    }
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
  pushStatusToView() {
    const leaves = this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW);
    if (leaves.length === 0) return;
    const inProgress = this.lastStatus?.rebaseInProgress || this.lastStatus?.mergeInProgress;
    const state = inProgress ? "conflict" : this.statusBar?.current ?? (this.lock.active ? "syncing" : "clean");
    const extra = {
      sparse: this.lastStatus?.sparse,
      mergeInProgress: this.lastStatus?.mergeInProgress,
      rebaseInProgress: this.lastStatus?.rebaseInProgress,
      activeOperation: this.lock.active ? this.lock.active.action : void 0,
      progress: this.progressText ?? void 0,
      progressDetail: this.progressDetail ?? void 0,
      runningAction: this.runningAction ?? void 0,
      runningPath: this.runningPath ?? void 0,
      treeView: this.sharedPrefs.treeView,
      rowsPerGroup: this.deviceSettings.rowsPerGroup,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? void 0,
      fetchedAt: this.lastStatus?.fetchedAt,
      bridge: this.deviceSettings.termuxIntegrationEnabled ? "companion app" : "disabled"
    };
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof StatusView) {
        if (this.lastStatus)
          view.setData({
            ...summaryToViewData(this.lastStatus.status, extra, state),
            statusLoaded: !this.statusStale
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
            ...extra
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
  openSetupGuide(reason) {
    const s = this.deviceSettings;
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const lines = [
      reason,
      "",
      "Three parts are needed, in this order:",
      "1. Termux (runs the real git) \u2014 the F-Droid build.",
      "2. Git Bridge Companion app (the only way Obsidian can trigger Termux).",
      "3. One command pasted into Termux \u2014 it installs the runner and pairs this plugin automatically (no token typing).",
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
      `Termux installed: ${this.lastAckTermuxInstalled === null ? "unknown (the companion reports this)" : this.lastAckTermuxInstalled ? "yes" : "NO"}`
    ];
    const actions = [
      {
        label: "Get Termux",
        keepOpen: true,
        onClick: () => this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL)
      },
      {
        label: "Copy release link",
        keepOpen: true,
        onClick: () => {
          void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
          new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
        }
      },
      {
        label: "Open companion setup",
        keepOpen: true,
        onClick: () => void this.openCompanionSetup()
      },
      {
        label: "Copy command & open Termux",
        cta: true,
        keepOpen: true,
        onClick: () => this.copyCommandAndOpenTermux()
      }
    ];
    if (this.installCommandLocal() !== null) {
      actions.push({
        label: "Copy offline command",
        keepOpen: true,
        onClick: () => this.copyLocalCommandAndOpenTermux()
      });
    }
    if (!s.authToken) {
      actions.splice(actions.length - 1, 0, {
        label: "Pair this vault",
        keepOpen: true,
        onClick: () => void this.cmdPairThisVault()
      });
    } else {
      actions.splice(actions.length - 1, 0, {
        label: "Set up repository",
        keepOpen: true,
        onClick: () => void this.cmdSetupRepository()
      });
    }
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled) {
      actions.unshift({
        label: "Enable on this device",
        keepOpen: true,
        onClick: () => {
          void this.updateDeviceSettings({ enabledOnThisDevice: true, termuxIntegrationEnabled: true }).then(
            () => new import_obsidian15.Notice("Enabled. Now do steps 1-3 if you have not yet.")
          );
        }
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
  companionOutdated() {
    const companion = this.lastCompanionVersion;
    if (companion === "") return false;
    return compareVersions(this.manifest.version, companion) > 0;
  }
  /**
   * Each part carries a floor and a shipped version, and the advice has four
   * states (the user's model, 2026-08-25): below the floor — refuse and name
   * the part actually at fault; between the floor and the current version —
   * an update is available and everything keeps working; matched — silence;
   * NEWER than this build knows — not an error but a CHOICE, with both exits
   * named (update the plugin, or reinstall the other half pinned to this
   * plugin's version). `kind` is what lets a surface pick buttons without
   * parsing the text.
   */
  versionAdvice() {
    const out = [];
    const plugin = this.manifest.version;
    const companion = this.lastCompanionVersion;
    if (companion !== "") {
      if (compareVersions(companion, COMPANION_MIN_VERSION) < 0) {
        out.push({
          part: "companion",
          kind: "below-floor",
          text: `The companion app (${companion}) is older than this plugin can work with (needs at least ${COMPANION_MIN_VERSION}). Install the newest APK from the latest release \u2014 it updates over the current one.`
        });
      } else if (compareVersions(plugin, companion) > 0) {
        out.push({
          part: "companion",
          kind: "update-available",
          text: `A newer companion app (${plugin}) ships with this plugin; the installed one (${companion}) keeps working. Update the APK when convenient \u2014 or stay on it by installing the matching plugin (the button explains how).`
        });
      } else if (compareVersions(plugin, companion) < 0) {
        out.push({
          part: "plugin",
          kind: "newer-half",
          text: `The companion app (${companion}) is NEWER than this plugin (${plugin}). Either update the plugin from the latest release, or install the companion APK matching ${plugin} from that release's page \u2014 every release keeps its own APK.`
        });
      }
    }
    if (this.lastRunnerVersion > 0 && this.lastRunnerVersion < RUNNER_MIN_VERSION) {
      out.push({
        part: "runner",
        kind: "below-floor",
        text: `The Termux runner (v${this.lastRunnerVersion}) is older than this plugin needs (v${RUNNER_MIN_VERSION}). Re-run the install command in Termux \u2014 updating the plugin never updates the runner.`
      });
    } else if (this.lastRunnerVersion > RUNNER_SHIPPED_VERSION) {
      out.push({
        part: "runner",
        kind: "newer-half",
        text: `The Termux runner (v${this.lastRunnerVersion}) is NEWER than this plugin knows (it ships v${RUNNER_SHIPPED_VERSION}). Either update the plugin from the latest release, or reinstall the runner pinned to this plugin \u2014 the install command in settings does exactly that.`
      });
    }
    return out;
  }
  /**
   * The manual half of the outdated-companion choice (the user's ask,
   * 2026-08-25): staying on the installed companion means installing the
   * PLUGIN release that matches it, by hand — the one route Obsidian cannot
   * perform itself. Offered only for companions since 0.6.0: the wire
   * protocol is v1 and profile files are format 1 across those releases, so
   * the downgrade reads everything the newer plugin left behind; earlier
   * releases predate profiles and the claim does not hold.
   */
  cmdStayOnCompanion() {
    const cv = this.lastCompanionVersion;
    const url = releaseTagUrl(cv);
    new ResultModal(
      this.app,
      "Match this companion by hand",
      [
        `1. Open the release page for ${cv} in a real browser (Chrome/Firefox) \u2014 the button copies the link.`,
        "2. From its assets, download main.js, manifest.json and styles.css into .obsidian/plugins/native-git-bridge/ (replacing the three files).",
        "3. Reload the plugin (Settings -> Community plugins: toggle it off and on).",
        "4. Re-run the install command from THAT plugin's settings \u2014 it is pinned to the same release, so the runner ends up matching too.",
        "Profiles, tokens and the runtime folder need no changes: the wire protocol and the profile format are the same across these releases."
      ],
      {
        actions: [
          {
            label: "Copy the release link",
            cta: true,
            keepOpen: true,
            onClick: () => {
              void navigator.clipboard.writeText(url);
              new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox.");
            }
          }
        ]
      }
    ).open();
  }
  /**
   * Whether the stay-on-this-companion route may be offered: the downgrade
   * claim (profiles, tokens, runtime all readable by the older release) holds
   * from 0.6.0 onward — profiles and the claim/pairing flow arrived there.
   */
  stayOnCompanionAvailable() {
    return this.lastCompanionVersion !== "" && compareVersions(this.lastCompanionVersion, "0.6.0") >= 0;
  }
  /**
   * The pinned exit of the newer-companion choice: the APK matching THIS
   * plugin. Copied, not opened — an APK download started in Obsidian's
   * Custom Tab is frequently discarded when the tab closes (§10's oldest
   * companion lesson), and no companion can be asked to open it, since the
   * companion is exactly the half being replaced.
   */
  copyMatchingApkLink() {
    const url = releaseTagUrl(this.manifest.version);
    void navigator.clipboard.writeText(url);
    new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox and install the APK from that page.");
  }
  /** The one-line Termux install command (same one settings shows). */
  installCommand() {
    return bootstrapCommand(this.manifest.version, this.deviceSettings.repoPathHint);
  }
  /**
   * The same install taken from the copy inside this vault instead of from a
   * release. Only meaningful once the repository path is known, because Termux
   * addresses the vault by its own absolute path.
   */
  installCommandLocal() {
    const p = this.deviceSettings.repoPathHint.trim().replace(/\/+$/, "");
    if (p === "" || !p.startsWith("/")) return null;
    return bootstrapCommandLocal(p, this.app.vault.configDir);
  }
  /** Copy the offline install command, then bring Termux to the front. */
  copyLocalCommandAndOpenTermux() {
    const cmd = this.installCommandLocal();
    if (cmd === null) {
      new import_obsidian15.Notice("Set the repository path in settings first \u2014 Termux needs the vault's absolute path.");
      return;
    }
    void navigator.clipboard.writeText(cmd);
    new import_obsidian15.Notice("Offline install command copied - long-press in Termux to paste, then Enter.");
    this.openTermux();
  }
  /** Open the latest release page (companion APK + plugin files live there). */
  openLatestRelease() {
    this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_RELEASES_URL);
  }
  /** Copy the install command, then bring Termux to the front (via the companion). */
  copyCommandAndOpenTermux() {
    void navigator.clipboard.writeText(this.installCommand());
    new import_obsidian15.Notice("Install command copied - long-press in Termux to paste, then Enter.");
    this.openTermux();
  }
  async cmdSelfCheck(timedOut = false) {
    registerIcons();
    const paths = new RuntimePaths(this.app.vault.configDir);
    const report = await runSelfCheck(this.makeRuntimeFS(), paths, timedOut, this.deviceSettings.profileId);
    const outdated = /ERROR building result for [^(]*$/m.test(report.runnerLogTail);
    const lines = [report.verdict];
    if (outdated) {
      lines.push("", "The Termux runner is OUTDATED. Fix: the button below copies the install command and opens Termux - paste and run it there.");
    }
    const facts = [
      `Runtime folder (as the plugin sees it): ${paths.root}`,
      `Profile for this vault: ${report.profileId || "none yet"}${report.markerProfileId && report.markerProfileId !== report.profileId ? ` (the runner wrote ${report.markerProfileId} here)` : ""}`,
      `Runner has written into THIS vault's runtime folder: ${report.runnerLogExists ? "yes" : "NO"}`,
      `Queued requests: ${report.queuedRequests.length}${report.queuedRequests.length ? " (" + report.queuedRequests.join(", ") + ")" : ""}`,
      `Pairing file waiting: ${report.pairingFilePresent ? "yes" : "no"}`
    ];
    if (!report.ok) lines.push("", ...facts);
    for (const a of this.versionAdvice()) lines.push("", a.text);
    this.log.add(report.ok ? "info" : "warn", "self-check", report.verdict);
    const actions = [];
    if (import_obsidian15.Platform.isAndroidApp && (!report.ok || outdated || this.versionAdvice().length > 0)) {
      actions.push({
        label: "Copy command & open Termux",
        cta: true,
        onClick: () => this.copyCommandAndOpenTermux()
      });
      if (this.lastAckTermuxInstalled !== false) {
        actions.push({
          label: "Open Termux",
          keepOpen: true,
          onClick: () => this.openTermux()
        });
      }
      if (this.lastAckTermuxInstalled === false) {
        actions.push({
          label: "Get Termux",
          keepOpen: true,
          onClick: () => this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL)
        });
        lines.push(
          "",
          `Termux is NOT installed on this device. Official site: ${TERMUX_SITE_URL}`,
          `Direct F-Droid page: ${TERMUX_FDROID_URL} \u2014 do not use the Play Store build, it is deprecated.`
        );
      }
      if (this.lastCompanionAckMs === 0) {
        actions.push({
          label: "Copy release link",
          keepOpen: true,
          onClick: () => {
            void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
            new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
          }
        });
      } else if (this.companionOutdated()) {
        actions.push({
          label: "Update companion app",
          keepOpen: true,
          onClick: () => this.openExternalUri(COMPANION_DOWNLOAD_APK_URI)
        });
      }
    }
    new ResultModal(this.app, report.headline, lines, {
      stdout: report.ok ? [...facts, "", report.runnerLogTail].join("\n").trimEnd() || void 0 : report.runnerLogTail || void 0,
      isError: !report.ok,
      actions
    }).open();
  }
  // ------------------------------------------------- per-file staging actions
  async cmdStageAll() {
    const result = await this.runOperation("stage-all", {
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: stage all failed", result);
    this.absorbStatusData(result.data ?? {});
    this.notify("Staged all permitted changes (protected paths excluded).");
  }
  async cmdUnstageAll() {
    const result = await this.runOperation("unstage-all", {
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: unstage all failed", result);
    this.absorbStatusData(result.data ?? {});
    this.notify("Unstaged all changes.");
  }
  async cmdStageFile(path, mode = "all") {
    const result = await this.runOperation("stage-file", {
      path,
      mode,
      protectedPaths: this.effectiveProtectedPaths()
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
  folderAction(group, folderPath, kind) {
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
  groupAction(group, kind) {
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
    if (group === "untracked") {
      void this.stageEntries(this.untrackedUnder(null));
      return;
    }
    void this.cmdStageFile(".", "update");
  }
  /** Stage a handful of paths, one request each, stopping at the first failure. */
  async stageEntries(paths) {
    if (paths.length === 0) {
      this.notify("Nothing to stage: no new files.");
      return;
    }
    for (const p of paths) {
      const result = await this.runOperation("stage-file", {
        path: p.endsWith("/") ? p.slice(0, -1) : p,
        mode: "all",
        protectedPaths: this.effectiveProtectedPaths()
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
  buildGroupMenu(menu, group) {
    if (!import_obsidian15.Platform.isAndroidApp) return;
    if (!this.deviceSettings.enabledOnThisDevice) return;
    this.addMenuEntries(menu, { kind: "group", group, count: this.groupPaths(group).length });
  }
  /** Paths currently listed in a panel group (as the panel last saw them). */
  groupPaths(group) {
    const st = this.lastStatus?.status;
    if (!st) return [];
    const raw = group === "staged" ? st.staged.map((e) => e.path) : group === "unstaged" ? st.unstaged.map((e) => e.path) : group === "conflicted" ? st.conflicted.map((e) => e.path) : st.untracked;
    return [...new Set(raw.map((p) => p.endsWith("/") ? p.slice(0, -1) : p))];
  }
  /** .gitignore is a tracked vault file, so a bulk add is ONE write. */
  confirmBulkIgnore(paths) {
    new ConfirmModal(
      this.app,
      {
        title: `Add ${paths.length} paths to .gitignore?`,
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `\u2026and ${paths.length - 10} more` : "",
          ".gitignore is a tracked file, so this change reaches every device and every collaborator once committed."
        ].filter((l) => l !== ""),
        confirmLabel: "Add to .gitignore",
        icon: "eye-off"
      },
      async (ok) => {
        if (!ok) return;
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
  confirmBulkPerPath(paths, kind) {
    const label2 = kind === "sparse" ? "sparse exclusions" : ".git/info/exclude";
    new ConfirmModal(
      this.app,
      {
        title: `Add ${paths.length} paths to ${label2}?`,
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `\u2026and ${paths.length - 10} more` : "",
          `This runs one Termux round trip per path (${paths.length} in total) and cannot be cancelled halfway without leaving part of the list applied.`,
          kind === "sparse" ? "Hidden paths are removed from THIS device's working tree and automatically join the protected set." : "The exclude file is device-local and never synced."
        ].filter((l) => l !== ""),
        confirmLabel: `Apply to ${paths.length} paths`,
        icon: "eye-off",
        danger: kind === "sparse"
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) {
          if (kind === "sparse") await this.cmdSparseExclude(p, true, true);
          else await this.cmdExcludeChange(p, true, false);
        }
        this.notify(`Applied to ${paths.length} paths.`);
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
  confirmDeleteUntracked(scopeLine, targets) {
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
          permanent ? `${count} will be deleted from disk. Nothing Git has recorded is touched, and this cannot be undone: a file Git never saw is in no history.` : `${count} will move to Obsidian's trash (.trash in the vault), so this is reversible from there.`,
          ...targets.slice(0, 8),
          many && targets.length > 8 ? `\u2026and ${targets.length - 8} more` : ""
        ].filter((l) => l !== ""),
        confirmLabel: permanent ? "Delete from disk" : "Move to trash",
        icon: "trash",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        if (permanent) {
          for (const t of targets) {
            const result = await this.runOperation("discard-file", {
              path: t.endsWith("/") ? t.slice(0, -1) : t,
              protectedPaths: this.effectiveProtectedPaths()
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
          moved === targets.length ? `Moved ${count} to the trash.` : `Moved ${moved} of ${targets.length} untracked entries to the trash; the rest are in the operation log.`
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
  discardPath(path, group) {
    if (group === "untracked") {
      this.confirmDeleteUntracked(`Path: ${path}`, this.untrackedUnder(path));
      return;
    }
    this.cmdDiscardFile(path);
  }
  /** Untracked entries git reported at or under `path`; `null` for all of them. */
  untrackedUnder(path) {
    const st = this.lastStatus?.status;
    if (!st) return [];
    return untrackedTargets(st.untracked, path);
  }
  async cmdUnstageFile(path) {
    const result = await this.runOperation("unstage-file", {
      path,
      protectedPaths: this.effectiveProtectedPaths()
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
  cmdDiscardAll() {
    const st = this.lastStatus?.status;
    const n = st?.unstaged.length ?? 0;
    new ConfirmModal(
      this.app,
      {
        title: "Discard all local changes?",
        body: [
          n > 0 ? `${n} file${n === 1 ? "" : "s"} with unstaged changes will go back to the staged version (or to HEAD when nothing is staged for them).` : "All unstaged changes will go back to the staged version (or to HEAD).",
          "Staged changes and untracked files are kept. Protected sparse paths are excluded.",
          "This cannot be undone: the discarded edits are not in Git history."
        ],
        confirmLabel: "Discard local changes",
        icon: "undo-2",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("discard-all", {
          protectedPaths: this.effectiveProtectedPaths()
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
  cmdResetAll() {
    const st = this.lastStatus?.status;
    const n = (st?.staged.length ?? 0) + (st?.unstaged.length ?? 0);
    new ConfirmModal(
      this.app,
      {
        title: "Reset everything to HEAD?",
        body: [
          n > 0 ? `${n} staged and unstaged change${n === 1 ? "" : "s"} will be thrown away; the working tree and the index go back to the last commit.` : "The working tree and the index go back to the last commit.",
          "Untracked files are kept, and protected sparse paths are excluded. The branch itself is not moved: commits are untouched.",
          "This cannot be undone: nothing being discarded here is in Git history."
        ],
        confirmLabel: "Reset to HEAD",
        icon: "rotate-ccw",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("reset-all", {
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: reset failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Reset the working tree and index to HEAD.");
      }
    ).open();
  }
  cmdDiscardFile(path) {
    new ConfirmModal(
      this.app,
      {
        title: "Discard changes?",
        body: [
          `File: ${path}`,
          "Tracked files are reset to the last commit; untracked files are deleted.",
          "This cannot be undone \u2014 the changes are not in Git history."
        ],
        confirmLabel: "Discard changes",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("discard-file", {
          path,
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: discard failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify(`Discarded changes in ${path}.`);
      }
    ).open();
  }
  async cmdDiagnostics() {
    const report = { pluginSide: {}, problems: [] };
    const s = this.deviceSettings;
    report.pluginSide["Plugin version"] = this.manifest.version;
    report.pluginSide["Platform"] = import_obsidian15.Platform.isAndroidApp ? "Android app" : import_obsidian15.Platform.isMobile ? "mobile" : "desktop";
    report.pluginSide["Enabled on this device"] = String(s.enabledOnThisDevice);
    report.pluginSide["Termux integration"] = String(s.termuxIntegrationEnabled);
    report.pluginSide["Pairing token set"] = s.authToken ? "yes" : "no";
    report.pluginSide["Profile for this vault"] = s.profileId || "(none yet)";
    report.pluginSide["Protected paths (manual)"] = s.protectedPaths.join(", ") || "(none)";
    report.pluginSide["Protected paths (derived from sparse)"] = (s.autoProtectSparse ? s.derivedProtectedPaths.join(", ") : "(auto-protect off)") || "(none)";
    report.pluginSide["Protected paths (effective)"] = this.effectiveProtectedPaths().join(", ") || "(none)";
    report.pluginSide["Device-local storage"] = this.store.isVolatile ? "VOLATILE (in-memory fallback)" : "persistent";
    report.pluginSide["Pending requests"] = String(await this.client.pendingRequestCount());
    report.pluginSide["Active operation"] = this.lock.active ? `${this.lock.active.action} (${this.lock.active.id})` : "none";
    if (!import_obsidian15.Platform.isAndroidApp)
      report.problems.push(
        "Not an Android device: the bridge (companion app + Termux) exists only on Android, so all operations are disabled here."
      );
    if (this.store.isVolatile) report.problems.push("Device-local storage is unavailable; settings will not persist.");
    if (!s.authToken) report.problems.push("No pairing token configured.");
    if (this.effectiveProtectedPaths().length === 0)
      report.problems.push(
        "No protected sparse paths (neither manual nor derived from sparse exclusions). Fine for full checkouts; risky if this repo uses sparse checkout."
      );
    if (import_obsidian15.Platform.isAndroidApp) {
      if (this.isObsidianGitActiveOnDevice()) {
        report.problems.push(
          "obsidian-git is ACTIVE on this device (not device-disabled): incompatible with a native sparse-checkout index. Use its 'Disable on this device' toggle."
        );
      }
    }
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
  async cmdCancel() {
    if (!this.activeCancel) {
      new import_obsidian15.Notice("No operation is currently awaiting a result.");
      return;
    }
    this.activeCancel.cancel();
  }
};
function compareVersions(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}
function streamAction(text) {
  const first = text.split("\n", 1)[0]?.trim() ?? "";
  const word = first.split(/\s+/, 1)[0];
  if (word === void 0 || word === "" || !/^[a-z][a-z-]*$/.test(word)) return null;
  return word;
}
function getLocalStorageBackend() {
  try {
    const ls = typeof activeWindow !== "undefined" ? activeWindow.localStorage : void 0;
    if (!ls) return null;
    const probe = "__ngb_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
