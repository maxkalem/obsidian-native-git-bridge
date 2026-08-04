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
  default: () => NativeGitBridgePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian12 = require("obsidian");

// src/constants.ts
var PLUGIN_ID = "native-git-bridge";
var PROTOCOL_VERSION = 1;
var RUNNER_MIN_VERSION = 4;
var DEFAULT_PROTECTED_PATHS = [];
var RUNTIME_DIR_NAME = "runtime";
var REQUESTS_DIR = "requests";
var RESULTS_DIR = "results";
var CANCEL_DIR = "cancel";
var DONE_DIR = "done";
var POLL_INTERVAL_MS = 400;
var DEFAULT_TIMEOUT_SECONDS = 90;
var RESULT_RETENTION_MS = 24 * 60 * 60 * 1e3;
var STALE_LOCK_MS = 30 * 60 * 1e3;
var DISPLAY_OUTPUT_LIMIT = 100 * 1024;
var LOG_MAX_ENTRIES = 200;
var SPARSE_SAFETY_WARNING = "Sparse checkout safety check failed. The excluded directories appear as Git changes. No commit or push was performed.";
var STORAGE_PREFIX = "ngb:v1";
var REPO_RAW_BASE = "https://raw.githubusercontent.com/maxkalem/obsidian-native-git-bridge/main/native-git-bridge";
var PAIRING_FILE = "pairing.json";
var COMPANION_SETUP_URI = "nativegitbridge://setup";
var COMPANION_APK_URL = "https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest/download/git-bridge-companion.apk";
var COMPANION_RELEASES_URL = "https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest";
var COMPANION_OPEN_TERMUX_URI = "nativegitbridge://open-termux";
var COMPANION_DOWNLOAD_APK_URI = "nativegitbridge://download-apk";
var TERMUX_SITE_URL = "https://termux.dev";
var TERMUX_FDROID_URL = "https://f-droid.org/packages/com.termux/";
var COMPANION_GET_TERMUX_URI = "nativegitbridge://get-termux";
var RUNNER_OUTDATED_HINT = "The Termux runner script is outdated. Updating the plugin does not update it \u2014 re-run the install command in Termux (Settings -> Native Git Bridge -> Copy command, or the 'Set up Termux' button in the companion app).";

// src/types.ts
var MUTATING_ACTIONS = /* @__PURE__ */ new Set([
  "sparse-reapply",
  "pull",
  "commit",
  "push",
  "sync",
  "restore-file",
  "abort-merge",
  "stage-file",
  "unstage-file",
  "discard-file",
  "stage-all",
  "unstage-all"
]);

// src/settings/DeviceLocalSettingsStore.ts
var CURRENT_SCHEMA_VERSION = 1;
var DEFAULT_DEVICE_SETTINGS = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  enabledOnThisDevice: false,
  termuxIntegrationEnabled: false,
  repoPathHint: "",
  authToken: "",
  protectedPaths: [...DEFAULT_PROTECTED_PATHS],
  derivedProtectedPaths: [],
  autoProtectSparse: true,
  opTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  autoPullOnOpen: false,
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
  menuExclude: true
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
  key(suffix = "settings") {
    return `${STORAGE_PREFIX}:${this.scopeId}:${suffix}`;
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
    return merged;
  }
  /** Generic scoped value access for auxiliary device-local state (log, operation markers). */
  getValue(suffix) {
    return this.rawGet(this.key(suffix));
  }
  setValue(suffix, value) {
    this.rawSet(this.key(suffix), value);
  }
  removeValue(suffix) {
    this.rawRemove(this.key(suffix));
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
var CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]");
function validateRepoRelativePath(input) {
  if (typeof input !== "string") return { ok: false, reason: "Not a string." };
  let p = input.trim();
  if (p === "") return { ok: false, reason: "Empty path." };
  if (CONTROL_CHARS.test(p)) return { ok: false, reason: "Control characters are not allowed." };
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
  btn.addEventListener("click", async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      new import_obsidian.Notice(noticeText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        new import_obsidian.Notice(noticeText);
      } catch {
        new import_obsidian.Notice("Could not access the clipboard.");
      }
      ta.remove();
    }
  });
  return btn;
}

// src/ui/modals.ts
function outputSection(el, label2, text) {
  if (!text || text.trim() === "") return;
  const details = el.createEl("details", { cls: "ngb-details" });
  details.createEl("summary", { text: label2 });
  const box = details.createDiv({ cls: "ngb-output" });
  const shown = text.length > DISPLAY_OUTPUT_LIMIT ? text.slice(0, DISPLAY_OUTPUT_LIMIT) + "\n\u2026 (truncated; full output in runner.log)" : text;
  box.createEl("pre", { text: shown });
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
    const ok = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    ok.addEventListener("click", () => this.close());
  }
  fullText() {
    const parts = [this.title, ...this.lines];
    if (this.opts.stdout) parts.push("", "--- stdout ---", this.opts.stdout);
    if (this.opts.stderr) parts.push("", "--- stderr ---", this.opts.stderr);
    return parts.join("\n");
  }
  onClose() {
    this.contentEl.empty();
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
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const cancel = btns.createEl("button", { text: this.opts.cancelLabel ?? "Cancel" });
    cancel.addEventListener("click", () => {
      this.decided = true;
      this.close();
      this.onDecision(false);
    });
    const confirm = btns.createEl("button", {
      text: this.opts.confirmLabel,
      cls: this.opts.danger ? "mod-warning" : "mod-cta"
    });
    confirm.addEventListener("click", () => {
      this.decided = true;
      this.close();
      this.onDecision(true);
    });
  }
  onClose() {
    if (!this.decided) this.onDecision(false);
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
      ["Conflicted", this.status.conflicted.map((e) => ({ path: e.path, badge: "!" }))],
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
        li.createSpan({ cls: "ngb-badge", text: it.badge });
        li.createSpan({ text: it.path });
      }
    }
    if (!any) c.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SparseSafetyModal = class extends import_obsidian2.Modal {
  constructor(app, report, warningText) {
    super(app);
    this.report = report;
    this.warningText = warningText;
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
        text: "No automatic repair is performed. Use 'Run diagnostics' to inspect the sparse state, and resolve the changes manually in Termux (e.g. review why the protected paths were touched)."
      });
    }
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Protected paths: ${this.report.protectedPaths.join(", ")} \xB7 checked ${this.report.checkedAt}`
    });
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

// src/settings/SettingsTab.ts
var import_obsidian4 = require("obsidian");
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
    containerEl.createEl("h3", { text: "Setup (one line in Termux)" });
    const cmd = s.repoPathHint ? `curl -fsSL ${REPO_RAW_BASE}/termux/bootstrap.sh | bash -s -- "${s.repoPathHint}"` : `curl -fsSL ${REPO_RAW_BASE}/termux/bootstrap.sh | bash`;
    const cmdBox = containerEl.createDiv({ cls: "ngb-cmd" });
    cmdBox.setText(cmd);
    cmdBox.setAttribute("aria-label", "Install command");
    new import_obsidian3.Setting(containerEl).setName("Install command").setDesc(
      "Install Termux (F-Droid) and the Git Bridge Companion app, then paste this single command into Termux. It finds your vault automatically, installs git/jq/openssh, links storage, enables the companion trigger, verifies the repo and pairs with this plugin \u2014 no manual token copying. The Companion app has a 'Set up Termux' button that copies this command and opens Termux for you."
    ).addButton(
      (b) => b.setButtonText("Copy command").setCta().onClick(async () => {
        await navigator.clipboard.writeText(cmd);
        new import_obsidian4.Notice("Install command copied.");
      })
    );
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
      (t) => t.setValue(s.enabledOnThisDevice).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ enabledOnThisDevice: v });
        this.display();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Termux integration").setDesc("Allow this plugin to queue requests for the Termux runner.").addToggle(
      (t) => t.setValue(s.termuxIntegrationEnabled).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ termuxIntegrationEnabled: v });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Pairing token").setDesc(
      "Paste the token printed by the Termux installer (termux/install.sh). It authenticates requests between this plugin and the runner. Stored locally; never logged."
    ).addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("token from installer").setValue(s.authToken).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ authToken: v.trim() });
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Repository path (informational)").setDesc("The repo path as seen from Termux, e.g. /storage/emulated/0/Documents/Vault. The runner config is authoritative.").addText(
      (t) => t.setValue(s.repoPathHint).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ repoPathHint: v.trim() });
      })
    );
    containerEl.createEl("h3", { text: "Repository rules" });
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "Sparse exclusions, .gitignore and .git/info/exclude, managed per item. Each section is collapsed because these lists can get long."
    });
    this.renderProtectedPathsSection(containerEl, s);
    this.renderSparseSection(containerEl);
    this.renderGitignoreSection(containerEl);
    this.renderExcludeSection(containerEl);
    containerEl.createEl("h3", { text: "File context menu" });
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "Which Git entries appear on right click / long tap of a file or folder. Stage/Unstage is always shown while the bridge is enabled."
    });
    new import_obsidian3.Setting(containerEl).setName("Show .gitignore commands").setDesc("Add to / remove from .gitignore (shared, synced through git).").addToggle(
      (t) => t.setValue(s.menuGitignore).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ menuGitignore: v });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show sparse commands").setDesc("Hide on this device / show again (sparse checkout exclusions).").addToggle(
      (t) => t.setValue(s.menuSparse).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ menuSparse: v });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show .git exclude commands").setDesc("Add to / remove from .git/info/exclude (this clone only, never synced).").addToggle(
      (t) => t.setValue(s.menuExclude).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ menuExclude: v });
      })
    );
    containerEl.createEl("h3", { text: "Notifications" });
    new import_obsidian3.Setting(containerEl).setName("Show a result window on success").setDesc(
      "Off: successful operations only update the status panel (and the log). Failures, conflicts and safety blocks are always shown as a window."
    ).addToggle(
      (t) => t.setValue(s.showSuccessModals).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ showSuccessModals: v });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Short messages").setDesc(
      "Where brief informational messages go. Note: a plugin cannot raise native Android toasts, so the choices are Obsidian's own notice, the status panel, or the log only."
    ).addDropdown(
      (d) => d.addOption("notice", "Obsidian notice (toast)").addOption("status-only", "Status panel only").addOption("log-only", "Operation log only").setValue(s.notificationMode).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({
          notificationMode: v
        });
      })
    );
    containerEl.createEl("h3", { text: "Automatic actions (all off by default)" });
    new import_obsidian3.Setting(containerEl).setName("Pull when Obsidian opens").addToggle(
      (t) => t.setValue(s.autoPullOnOpen).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ autoPullOnOpen: v });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Sync when Obsidian closes / goes to background").setDesc("Queues a sync request during the close transition; Termux may finish it after Obsidian is gone.").addToggle(
      (t) => t.setValue(s.autoSyncOnClose).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ autoSyncOnClose: v });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Periodic sync while Obsidian is open (minutes, 0 = off)").addText(
      (t) => t.setValue(String(s.periodicSyncMinutes)).onChange(async (v) => {
        const n = Math.max(0, Math.floor(Number(v) || 0));
        await this.plugin.updateDeviceSettings({ periodicSyncMinutes: n });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Minimum interval between automatic syncs (minutes)").addText(
      (t) => t.setValue(String(s.minAutoSyncIntervalMinutes)).onChange(async (v) => {
        const n = Math.max(1, Math.floor(Number(v) || 15));
        await this.plugin.updateDeviceSettings({ minAutoSyncIntervalMinutes: n });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Only sync on Wi-Fi (best effort)").setDesc("Uses the WebView network API when available; skipped silently when the API is missing.").addToggle(
      (t) => t.setValue(s.wifiOnly).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ wifiOnly: v });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Skip automatic sync when battery is low (best effort)").addToggle(
      (t) => t.setValue(s.skipOnLowBattery).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ skipOnLowBattery: v });
      })
    );
    containerEl.createEl("h3", { text: "Advanced" });
    new import_obsidian3.Setting(containerEl).setName("Operation timeout (seconds)").addText(
      (t) => t.setValue(String(s.opTimeoutSeconds)).onChange(async (v) => {
        const n = Math.min(3600, Math.max(10, Math.floor(Number(v) || DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds)));
        await this.plugin.updateDeviceSettings({ opTimeoutSeconds: n });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Companion intent URI template").setDesc('Advanced. "{id}" is replaced by the request id; change it only if the companion app uses a custom scheme.').addText(
      (t) => t.setValue(s.companionUriTemplate).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ companionUriTemplate: v.trim() });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Reset device-local settings").setDesc("Restores all settings on this device to defaults. The vault and repository are not touched.").addButton(
      (b) => b.setButtonText("Reset").setWarning().onClick(() => {
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
            this.display();
          }
        ).open();
      })
    );
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
  entryRow(listEl, text, onRemove) {
    const row = listEl.createDiv({ cls: "ngb-entry-row" });
    row.createSpan({ cls: "ngb-entry-text", text });
    if (onRemove) {
      const btn = row.createEl("button", { text: "Remove" });
      btn.addEventListener("click", onRemove);
    }
  }
  /** Input + Add button; `onAdd` receives the trimmed value. */
  addRow(body, placeholder, label2, onAdd) {
    const row = body.createDiv({ cls: "ngb-add-row" });
    const input = row.createEl("input", { type: "text", placeholder });
    const btn = row.createEl("button", { text: label2 });
    btn.addEventListener("click", () => {
      const v = input.value.trim();
      if (v !== "") onAdd(v);
      input.value = "";
    });
  }
  // Every section refreshes ONLY its own list in place. Re-rendering the whole
  // tab (display()) on each add/remove resets the scroll position and makes
  // the collapsibles flicker — the view visibly "jumps".
  renderProtectedPathsSection(containerEl, s) {
    const { body, hintEl } = this.detailsSection(containerEl, "Protected paths", "");
    new import_obsidian3.Setting(body).setName("Auto-protect sparse exclusions").setDesc("Paths hidden by the repository's own sparse rules join the protected set automatically (read from git on every status).").addToggle(
      (t) => t.setValue(s.autoProtectSparse).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ autoProtectSparse: v });
        refresh();
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
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (const b of arr) s += alphabet[b % alphabet.length];
  return s;
}
function createRequest(action, args, token, timeoutSeconds, now = /* @__PURE__ */ new Date(), rand = randomSuffix()) {
  const id = makeRequestId(now, rand);
  if (!isValidRequestId(id)) throw new Error(`Generated invalid request id: ${id}`);
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    token,
    action,
    createdAt: now.toISOString(),
    timeoutSeconds,
    args
  };
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
    return new Promise((r) => setTimeout(r, ms));
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
      this.paths.doneDir
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
  requestFile(id) {
    return `${this.requestsDir}/${id}.json`;
  }
  resultFile(id) {
    return `${this.resultsDir}/${id}.json`;
  }
  cancelFile(id) {
    return `${this.cancelDir}/${id}`;
  }
  all() {
    return [this.root, this.requestsDir, this.resultsDir, this.cancelDir, this.doneDir];
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
function evaluateSparseSafety(statusProtectedRaw, stagedProtectedRaw, protectedPaths, now = /* @__PURE__ */ new Date()) {
  const violations = [];
  for (const e of parseStatusPorcelainV1(statusProtectedRaw)) {
    const code = e.index !== "." ? e.index : e.worktree;
    violations.push({ path: e.path, status: label(code), source: "worktree" });
  }
  for (const e of parseNameStatus(stagedProtectedRaw)) {
    violations.push({ path: e.path, status: label(e.index), source: "staged" });
  }
  return {
    safe: violations.length === 0,
    violations,
    protectedPaths: [...protectedPaths],
    checkedAt: now.toISOString()
  };
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
        if (Array.isArray(parsed)) this.entries = parsed.slice(-LOG_MAX_ENTRIES);
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
  return s.replace(/(\w+:\/\/)[^/\s@]+:[^/\s@]+@/g, "$1***@");
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
var import_obsidian5 = require("obsidian");
var DiagnosticsModal = class extends import_obsidian5.Modal {
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
var import_obsidian6 = require("obsidian");
var CommitMessageModal = class extends import_obsidian6.Modal {
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
    const ta = c.createEl("textarea", { cls: "ngb-mono" });
    ta.rows = 3;
    ta.style.width = "100%";
    ta.placeholder = this.opts.placeholder;
    ta.value = this.opts.initial ?? "";
    const note = c.createDiv({ cls: "ngb-invalid" });
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const cancel = btns.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.resolved = true;
      this.close();
      this.onDone(null);
    });
    const submit = btns.createEl("button", { text: this.opts.submitLabel, cls: "mod-cta" });
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
      this.onDone(msg);
    };
    submit.addEventListener("click", doSubmit);
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doSubmit();
    });
    window.setTimeout(() => ta.focus(), 10);
  }
  onClose() {
    if (!this.resolved) this.onDone(null);
    this.contentEl.empty();
  }
};
var ConflictModal = class extends import_obsidian6.Modal {
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
      li.createSpan({ cls: "ngb-badge", text: "U" });
      const link = li.createEl("a", { text: f });
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
      this.actions.abortMerge();
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
  if (typeof r.createdAt === "string") out.createdAt = r.createdAt;
  return out;
}

// src/git/historyParsers.ts
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
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("	");
      const code = parts[0] ?? "";
      if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
        pathAtCommit = unquoteGitPath(parts[2]);
      } else if (parts.length >= 2) {
        pathAtCommit = unquoteGitPath(parts[1]);
      }
      if (pathAtCommit !== void 0) break;
    }
    if (pathAtCommit === void 0) pathAtCommit = lastKnownPath;
    lastKnownPath = pathAtCommit;
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      pathAtCommit
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

// src/ui/historyViews.ts
var import_obsidian7 = require("obsidian");
var TextPreviewModal = class extends import_obsidian7.Modal {
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
    const box = c.createDiv({ cls: "ngb-output ngb-output-tall" });
    box.createEl("pre", { text: this.text });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DiffModal = class extends import_obsidian7.Modal {
  constructor(app, title, meta, diffText, truncated) {
    super(app);
    this.title = title;
    this.meta = meta;
    this.diffText = diffText;
    this.truncated = truncated;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    c.createDiv({ cls: "ngb-settings-note", text: this.meta });
    if (this.diffText.trim() === "") {
      c.createEl("p", { cls: "ngb-ok", text: "No differences." });
      return;
    }
    const box = c.createDiv({ cls: "ngb-output ngb-output-tall ngb-diff" });
    for (const line of this.diffText.split("\n")) {
      const cls = line.startsWith("+") && !line.startsWith("+++") ? "ngb-diff-add" : line.startsWith("-") && !line.startsWith("---") ? "ngb-diff-del" : line.startsWith("@@") ? "ngb-diff-hunk" : line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---") ? "ngb-diff-meta" : "";
      box.createDiv({ cls: `ngb-diff-line ${cls}`, text: line === "" ? " " : line });
    }
    if (this.truncated) {
      c.createDiv({ cls: "ngb-warning", text: "Diff truncated (too large). Full diff is available via git in Termux." });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var FileHistoryModal = class extends import_obsidian7.Modal {
  constructor(app, filePath, actions) {
    super(app);
    this.filePath = filePath;
    this.actions = actions;
    this.entries = [];
    this.skip = 0;
    this.pageSize = 30;
    this.exhausted = false;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("History");
    const c = this.contentEl;
    c.createDiv({ cls: "ngb-settings-note ngb-mono", text: this.filePath });
    this.listEl = c.createDiv();
    const btns = c.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    void this.loadMore();
  }
  async loadMore() {
    this.moreBtn.disabled = true;
    this.moreBtn.setText("Loading\u2026");
    const page = await this.actions.loadPage(this.skip, this.pageSize);
    this.moreBtn.disabled = false;
    this.moreBtn.setText("Load more");
    if (page === null) return;
    if (this.skip === 0 && page.length === 0) {
      this.listEl.createEl("p", { text: "No history for this file (not committed yet?)." });
      this.moreBtn.hide();
      return;
    }
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn.hide();
    }
    const startIndex = this.entries.length;
    this.entries.push(...page);
    this.skip += page.length;
    page.forEach((e, i) => this.renderRow(e, startIndex + i));
  }
  renderRow(e, index) {
    const row = this.listEl.createDiv({ cls: "ngb-history-row" });
    const head = row.createDiv();
    head.createSpan({ cls: "ngb-badge", text: e.hash.slice(0, 8) });
    head.createSpan({ text: ` ${e.date.slice(0, 16).replace("T", " ")} \xB7 ${e.author}`, cls: "ngb-settings-note" });
    row.createDiv({ text: e.subject });
    if (e.pathAtCommit !== this.filePath) {
      row.createDiv({ cls: "ngb-settings-note ngb-mono", text: `as: ${e.pathAtCommit}` });
    }
    const acts = row.createDiv({ cls: "ngb-history-actions" });
    const mk = (label2, cb, danger = false) => {
      const b = acts.createEl("button", { text: label2, cls: danger ? "mod-warning" : "" });
      b.addEventListener("click", cb);
    };
    mk("View", () => this.actions.viewAt(e));
    mk("Diff vs now", () => this.actions.diffVsCurrent(e));
    const prev = this.entries[index + 1];
    mk("Diff vs previous", () => {
      const p = this.entries[index + 1];
      if (p) this.actions.diffVsPrevious(e, p);
      else if (this.exhausted) new import_obsidian7.Notice("This is the oldest known commit for the file.");
      else new import_obsidian7.Notice("Load more history first (the previous commit is not loaded yet).");
    });
    mk("Restore\u2026", () => this.actions.restore(e), true);
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/StatusView.ts
var import_obsidian10 = require("obsidian");

// src/ui/icons.ts
var import_obsidian8 = require("obsidian");
var NGB_ICON_PUSH = "ngb-push";
var NGB_ICON_PULL = "ngb-pull";
var NGB_ICON_STAGE_ALL = "ngb-stage-all";
var NGB_ICON_UNSTAGE_ALL = "ngb-unstage-all";
var NGB_ICON_SYNC = "ngb-sync";
var SCALE = 100 / 24;
function scaled(path, strokeWidth = 2) {
  return `<g transform="scale(${SCALE})" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</g>`;
}
function registerIcons() {
  (0, import_obsidian8.addIcon)(NGB_ICON_PUSH, scaled('<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>'));
  (0, import_obsidian8.addIcon)(NGB_ICON_PULL, scaled('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'));
  (0, import_obsidian8.addIcon)(
    NGB_ICON_STAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M17 10v8M13 14h8"/>')
  );
  (0, import_obsidian8.addIcon)(
    NGB_ICON_UNSTAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M13 14h8"/>')
  );
  (0, import_obsidian8.addIcon)(
    NGB_ICON_SYNC,
    scaled('<path d="M8 3v14M4 13l4 4 4-4M16 21V7M12 11l4-4 4 4"/>')
  );
}

// src/ui/animatedIcons.ts
var import_obsidian9 = require("obsidian");
function applySweepIcon(button, iconName, direction) {
  button.empty();
  const wrap = button.createSpan({ cls: "ngb-sweep" });
  const base = wrap.createSpan({ cls: "ngb-sweep-base" });
  (0, import_obsidian9.setIcon)(base, iconName);
  const lit = wrap.createSpan({ cls: `ngb-sweep-lit ngb-sweep-${direction}` });
  (0, import_obsidian9.setIcon)(lit, iconName);
}

// src/ui/StatusView.ts
var NGB_STATUS_VIEW = "native-git-bridge-status";
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
var StatusView = class extends import_obsidian10.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.data = null;
    this.progressEl = null;
    this.cancelBtn = null;
    this.collapsed = {
      conflicted: false,
      staged: false,
      unstaged: false,
      untracked: true
    };
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
  updateProgressText(text) {
    if (this.data) this.data.progress = text ?? void 0;
    if (this.progressEl && this.cancelBtn) {
      this.applyStripState(text, this.data?.activeOperation ?? null);
      return;
    }
    this.render();
  }
  /** Toggle the reserved cancel slot and the label without rebuilding the row. */
  applyStripState(progress, activeOperation) {
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
  }
  async onOpen() {
    this.render();
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
    c.empty();
    c.addClass("ngb-status-view");
    const d = this.data;
    const bar = c.createDiv({ cls: "ngb-sv-toolbar" });
    const running = d?.runningAction;
    const iconBtn = (icon, tooltip, cb, actionName, anim = "pulse") => {
      const b = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
      b.setAttribute("aria-label", tooltip);
      const active = Boolean(actionName) && running === actionName;
      if (active && (anim === "sweep-down" || anim === "sweep-up")) {
        applySweepIcon(b, icon, anim === "sweep-down" ? "down" : "up");
        b.addClass("ngb-sv-icon-active");
      } else {
        (0, import_obsidian10.setIcon)(b, icon);
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
    iconBtn("cloud-download", "Fetch", this.actions.fetch, "fetch", "sweep-down");
    iconBtn(NGB_ICON_PULL, "Pull", this.actions.pull, "pull", "sweep-down");
    iconBtn(NGB_ICON_PUSH, "Push", this.actions.push, "push", "sweep-up");
    iconBtn("refresh-cw", "Refresh status", this.actions.refresh, "status", "spin");
    const strip = c.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    const cancel = stripLeft.createEl("button", {
      cls: "clickable-icon ngb-sv-icon ngb-sv-icon-warn ngb-sv-cancel-slot"
    });
    cancel.setAttribute("aria-label", "Cancel current operation");
    (0, import_obsidian10.setIcon)(cancel, "x");
    cancel.addEventListener("click", () => this.actions.cancel());
    this.cancelBtn = cancel;
    this.progressEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    this.applyStripState(d?.progress ?? null, d?.activeOperation ?? null);
    const logBtn = strip.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    logBtn.setAttribute("aria-label", "Operation log");
    (0, import_obsidian10.setIcon)(logBtn, "file-clock");
    logBtn.addEventListener("click", this.actions.openLog);
    const head = c.createDiv({ cls: "ngb-sv-header" });
    head.createSpan({ cls: `ngb-sv-dot ngb-sv-${d?.state ?? "unknown"}` });
    head.createSpan({ cls: "ngb-sv-state", text: d ? stateLabel(d.state) : "not checked yet" });
    if (d) {
      head.createSpan({
        cls: "ngb-settings-note",
        text: ` ${d.branch ?? "\u2014"} \u2191${d.ahead} \u2193${d.behind}`
      });
    }
    if (!d) {
      c.createEl("p", { cls: "ngb-settings-note", text: "Press refresh to query native Git." });
      return;
    }
    const stageable = d.unstaged.length + d.untracked.length > 0;
    this.renderGroup(c, "conflicted", "Conflicts", d.conflicted.map((e) => entry(e, "U")), true);
    this.renderGroup(
      c,
      "staged",
      "Staged changes",
      d.staged.map((e) => entry(e, e.index)),
      false,
      stageable
    );
    this.renderGroup(c, "unstaged", "Changes", d.unstaged.map((e) => entry(e, e.worktree)), false);
    this.renderGroup(
      c,
      "untracked",
      "Untracked",
      d.untracked.map((p) => ({ path: p, code: "?" })),
      false
    );
    if (d.conflicted.length + d.staged.length + d.unstaged.length + d.untracked.length === 0) {
      c.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
    }
    const foot = c.createDiv({ cls: "ngb-sv-footer" });
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
  }
  renderGroup(parent, group, title, items, danger, showWhenEmpty = false) {
    if (items.length === 0 && !showWhenEmpty) return;
    const wrap = parent.createDiv({ cls: "ngb-sv-group" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    (0, import_obsidian10.setIcon)(chevron, this.collapsed[group] ? "chevron-right" : "chevron-down");
    header.createSpan({
      cls: danger ? "ngb-sv-group-title ngb-status-conflict" : "ngb-sv-group-title",
      text: title
    });
    header.createSpan({ cls: "ngb-badge", text: String(items.length) });
    header.addEventListener("click", () => {
      this.collapsed[group] = !this.collapsed[group];
      this.render();
    });
    if (this.collapsed[group]) return;
    const list = wrap.createDiv({ cls: "ngb-sv-list" });
    if (items.length === 0) {
      list.createDiv({ cls: "ngb-sv-empty", text: "Nothing staged yet." });
      return;
    }
    for (const it of items) {
      const rowEl = list.createDiv({ cls: "ngb-sv-file" });
      const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
      const kind = CHANGE_LABEL[it.code] ?? it.code;
      const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName(it.path) });
      name.setAttribute("aria-label", `${it.path} - ${kind}`);
      main.addEventListener("click", () => this.actions.openFile(it.path));
      if (import_obsidian10.Platform.isMobile) {
        main.createSpan({ cls: "ngb-sv-file-kind", text: kind });
      }
      const acts = rowEl.createDiv({ cls: "ngb-sv-file-actions" });
      const act = (icon, tooltip, cb, warn = false, spinning = false) => {
        const b = acts.createEl("button", {
          cls: `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}${spinning ? " ngb-anim-pulse ngb-sv-icon-active" : ""}`
        });
        b.setAttribute("aria-label", tooltip);
        (0, import_obsidian10.setIcon)(b, icon);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          cb();
        });
      };
      const busy = this.data?.runningAction;
      if (group === "staged") {
        act("minus", "Unstage", () => this.actions.unstage(it.path), false, busy === "unstage-file");
      } else {
        act("plus", "Stage", () => this.actions.stage(it.path), false, busy === "stage-file");
      }
      act("undo-2", "Discard changes", () => this.actions.discard(it.path), true, busy === "discard-file");
      const codeEl = rowEl.createSpan({
        cls: `ngb-sv-file-code ngb-code-${it.code}`,
        text: it.code
      });
      codeEl.setAttribute("aria-label", kind);
    }
  }
};
function entry(e, code) {
  return { path: e.path, code: code === "." ? "M" : code };
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
    conflicted: s.conflicted,
    ...extra
  };
}

// src/bridge/selfCheck.ts
var LOG_TAIL_BYTES = 4e3;
async function runSelfCheck(fs, paths, hasQueuedTimeout) {
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
  const pairingFilePresent = await safeExists(fs, `${paths.root}/pairing.json`);
  let verdict;
  let ok = false;
  if (!runtimeDirExists) {
    verdict = "The runtime folder does not exist yet. Run a command once (it is created automatically), or complete the Termux setup.";
  } else if (!runnerLogExists) {
    verdict = "No runner.log in this vault's runtime folder \u2014 the Termux runner has never written here. Most likely the installer configured a DIFFERENT folder (another vault or path spelling). Fix: in Termux run  cat ~/.config/native-git-bridge/config  and compare NGB_RUNTIME_DIR with the path shown below; re-run the install command with the correct vault path if they differ.";
  } else if (hasQueuedTimeout && queuedRequests.length > 0) {
    verdict = "The runner has written here before, but your request is still queued. Either the runner was not triggered (companion permission / allow-external-apps), or it stopped before processing the queue \u2014 see the log tail below.";
  } else if (queuedRequests.length > 0) {
    verdict = `${queuedRequests.length} request(s) waiting to be processed.`;
  } else {
    verdict = "Runtime folder looks healthy: the runner writes here and no requests are stuck.";
    ok = true;
  }
  return {
    runtimeDirExists,
    queuedRequests,
    runnerLogExists,
    runnerLogTail,
    pairingFilePresent,
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

// src/main.ts
var import_obsidian13 = require("obsidian");

// src/ui/OperationLogModal.ts
var import_obsidian11 = require("obsidian");
var OperationLogModal = class extends import_obsidian11.Modal {
  constructor(app, log) {
    super(app);
    this.log = log;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: operation log");
    const c = this.contentEl;
    const topBar = c.createDiv({ cls: "ngb-buttons ngb-buttons-top" });
    addCopyButton(topBar, () => this.logAsText(), "Copy log", "Log copied.");
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

// src/main.ts
var DEFAULT_SHARED_PREFS = { showStatusBar: true, showRibbonIcon: true };
var MARKER_KEY = "active-op";
var LAST_SYNC_KEY = "last-sync";
var _NativeGitBridgePlugin = class _NativeGitBridgePlugin extends import_obsidian12.Plugin {
  constructor() {
    super(...arguments);
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS };
    this.statusBar = null;
    this.activeCancel = null;
    this.progressText = null;
    this.runningAction = null;
    this.lastStatus = null;
    this.lastAutoSyncMs = 0;
    /**
     * Warn once per session when the Termux-side runner predates this plugin
     * build. Updating main.js in the vault does not touch the runner script, so a
     * stale runner is a genuinely common failure mode (it shows up as
     * RUNNER_INTERNAL / serialization errors).
     */
    this.runnerVersionWarned = false;
    this.companionSetupAutoOpened = false;
    /** Probe window used by the missing-companion detection; tests shrink it. */
    this.companionProbeMs = 4e3;
    /** Time of the last obsidian://native-git-bridge-ack from the companion. */
    this.lastCompanionAckMs = 0;
    /** What the companion reported about Termux (null until the first ack). */
    this.lastAckTermuxInstalled = null;
    this.ackWaiters = [];
    // -------------------- repo config management (sparse / gitignore / exclude)
    /** In-memory caches so the file context menu can decide add-vs-remove synchronously. */
    this.gitignoreLines = [];
    this.excludeLines = [];
  }
  async onload() {
    this.store = new DeviceLocalSettingsStore(getLocalStorageBackend(), this.resolveScopeId());
    this.deviceSettings = this.store.read();
    this.log = new OperationLog(this.store);
    const data = await this.loadData();
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS, ...data ?? {} };
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
        refresh: () => void this.cmdStatus(true),
        sync: () => void this.cmdSync(),
        pull: () => void this.cmdPull(),
        push: () => void this.cmdPush(),
        fetch: () => void this.cmdFetch(),
        commit: () => void this.cmdCommit(),
        stageAll: () => void this.cmdStageAll(),
        unstageAll: () => void this.cmdUnstageAll(),
        openLog: () => new OperationLogModal(this.app, this.log).open(),
        cancel: () => void this.cmdCancel(),
        openFile: (p) => this.openVaultFile(p),
        stage: (p) => void this.cmdStageFile(p),
        unstage: (p) => void this.cmdUnstageFile(p),
        discard: (p) => this.cmdDiscardFile(p)
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
  registerFileMenu() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!import_obsidian12.Platform.isAndroidApp) return;
        if (!this.deviceSettings.enabledOnThisDevice) return;
        const path = file.path;
        const v = validateRepoRelativePath(path);
        if (!v.ok) return;
        const p = v.normalized;
        const st = this.lastStatus?.status;
        const staged = st?.staged.some((e) => e.path === p || e.path.startsWith(p + "/")) ?? false;
        const unstaged = (st?.unstaged.some((e) => e.path === p || e.path.startsWith(p + "/")) ?? false) || (st?.untracked.some((u) => u === p || u.startsWith(p + "/")) ?? false);
        if (unstaged || !st) {
          menu.addItem(
            (i) => i.setTitle("Git: Stage").setIcon("plus-circle").onClick(() => void this.cmdStageFile(p))
          );
        }
        if (staged) {
          menu.addItem(
            (i) => i.setTitle("Git: Unstage").setIcon("minus-circle").onClick(() => void this.cmdUnstageFile(p))
          );
        }
        if (this.deviceSettings.menuGitignore) {
          if (this.isGitignored(p)) {
            menu.addItem(
              (i) => i.setTitle("Git: Remove from .gitignore").setIcon("eye").onClick(() => void this.gitignoreRemove(`/${p}`))
            );
          } else {
            menu.addItem(
              (i) => i.setTitle("Git: Add to .gitignore").setIcon("eye-off").onClick(() => void this.gitignoreAdd(`/${p}`))
            );
          }
        }
        if (!this.deviceSettings.menuSparse) {
        } else if (this.isSparseExcluded(p)) {
          menu.addItem(
            (i) => i.setTitle("Git: Show again (remove sparse exclusion)").setIcon("eye").onClick(() => void this.cmdSparseExclude(p, false))
          );
        } else {
          menu.addItem(
            (i) => i.setTitle("Git: Hide on this device (sparse)").setIcon("eye-off").onClick(() => void this.cmdSparseExclude(p, true))
          );
        }
        if (!this.deviceSettings.menuExclude) {
        } else if (this.isExcluded(p)) {
          menu.addItem(
            (i) => i.setTitle("Git: Remove from .git exclude").setIcon("eye").onClick(() => void this.cmdExcludeChange(p, false))
          );
        } else {
          menu.addItem(
            (i) => i.setTitle("Git: Add to .git exclude (local ignore)").setIcon("eye-off").onClick(() => void this.cmdExcludeChange(p, true))
          );
        }
      })
    );
  }
  registerAutomaticActions() {
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
    if (mode === "notice") new import_obsidian12.Notice(message);
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
    await this.loadGitignore();
    if (import_obsidian12.Platform.isAndroidApp && !this.deviceSettings.authToken && !this.store.getValue("setup-guide-shown")) {
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
    if (!import_obsidian12.Platform.isAndroidApp) return;
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
        cancelLabel: "Close"
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
    new import_obsidian12.Notice("Native Git Bridge: device-local settings reset.");
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
    if (s.conflicted.length > 0) this.statusBar.set("conflict", `(${s.conflicted.length})`);
    else if (s.staged.length + s.unstaged.length + s.untracked.length > 0)
      this.statusBar.set("changed", `(${s.staged.length + s.unstaged.length + s.untracked.length})`);
    else this.statusBar.set("clean", s.ahead > 0 ? `\u2191${s.ahead}` : void 0);
  }
  // -------------------------------------------------------------- commands
  registerCommands() {
    const cmds = [
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
      { id: "bridge-self-check", name: "Native Git: Check bridge (no Termux round trip)", cb: () => void this.cmdSelfCheck() },
      { id: "open-companion-setup", name: "Native Git: Open companion app setup", cb: () => void this.openCompanionSetup() },
      { id: "setup-guide", name: "Native Git: Setup guide (Termux, companion, pairing)", cb: () => this.openSetupGuide("Setup guide.") },
      { id: "cancel-operation", name: "Native Git: Cancel current operation when possible", cb: () => void this.cmdCancel() }
    ];
    for (const c of cmds) this.addCommand({ id: c.id, name: c.name, callback: c.cb });
    this.registerObsidianProtocolHandler("native-git-bridge-ack", (params) => {
      const p = params;
      this.onCompanionAck(p?.src, p?.termux);
    });
  }
  // ------------------------------------------------------------ operations
  /** Guard + queue + trigger + await one bridge operation. */
  async runOperation(action, args = {}) {
    const s = this.deviceSettings;
    if (!import_obsidian12.Platform.isAndroidApp) {
      new import_obsidian12.Notice(
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
    const req = createRequest(action, args, s.authToken, s.opTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
    const mutating = MUTATING_ACTIONS.has(action);
    if (mutating && !this.lock.tryAcquire(req.id, action)) {
      new import_obsidian12.Notice(`Another operation is running (${this.lock.active?.action}). Try again later.`);
      return null;
    }
    if (!mutating && this.lock.active && MUTATING_ACTIONS.has(this.lock.active.action)) {
      new import_obsidian12.Notice(`A ${this.lock.active.action} operation is running; try again when it finishes.`);
      return null;
    }
    const cancel = new CancelToken();
    this.activeCancel = cancel;
    this.statusBar?.set("syncing");
    this.pushStatusToView();
    this.log.add("info", action, `Queued request ${req.id}.`);
    void this.openStatusPanel(false);
    const startedAt = Date.now();
    this.runningAction = action;
    this.progressText = `${action}\u2026 0s`;
    this.pushStatusToView();
    const ticker = window.setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1e3);
      this.progressText = `${action}\u2026 ${secs}s`;
      this.updateProgressInView(this.progressText);
    }, 1e3);
    try {
      await this.client.submit(req);
      const ackBaseline = this.lastCompanionAckMs;
      this.makeTransport().trigger(req.id);
      const waited = await this.client.awaitResult(req.id, req.timeoutSeconds * 1e3, cancel);
      if (waited.kind === "timeout") {
        await this.client.requestCancel(req.id);
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
            "Companion acknowledged the trigger but no result arrived: the problem is on the Termux/runner side (see the bridge check)."
          );
        } else if (!this.companionSetupAutoOpened) {
          this.companionSetupAutoOpened = true;
          void this.openCompanionSetup();
        }
        return null;
      }
      if (waited.kind === "cancelled") {
        await this.client.requestCancel(req.id);
        this.log.add("warn", action, `Request ${req.id} cancelled by user.`);
        new import_obsidian12.Notice(`Native Git: ${action} cancelled.`);
        return null;
      }
      const result = waited.result;
      await this.client.consume(req.id);
      this.checkRunnerVersion(result);
      this.log.add(
        result.ok ? "info" : "error",
        action,
        `Request ${req.id} finished ok=${result.ok} exit=${result.exitCode}.`,
        result.error ? `${result.error.code}: ${result.error.message}` : void 0
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
      this.activeCancel = null;
      if (mutating) this.lock.release(req.id);
      this.refreshStatusBarIdle();
      this.pushStatusToView();
    }
  }
  checkRunnerVersion(result) {
    const version = typeof result.runnerVersion === "number" ? result.runnerVersion : 1;
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
  openExternalUri(uri) {
    let opened = null;
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
  }
  /**
   * The companion (>= 0.4.0) bounces obsidian://native-git-bridge-ack back for
   * every URI it receives, giving a DETERMINISTIC "companion is installed and
   * reachable" signal — and, since 0.4.1, whether Termux itself is installed
   * (the WebView cannot query other packages; the companion can). Registered
   * in onload.
   */
  onCompanionAck(src, termux) {
    this.lastCompanionAckMs = Date.now();
    if (termux === "1") this.lastAckTermuxInstalled = true;
    else if (termux === "0") this.lastAckTermuxInstalled = false;
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
    if (!import_obsidian12.Platform.isAndroidApp) {
      new import_obsidian12.Notice("The companion app exists only on Android.");
      return;
    }
    this.log.add("info", "companion", "Opening companion setup checklist.");
    this.openExternalUri(COMPANION_SETUP_URI);
    if (await this.probeCompanion()) return;
    this.log.add("warn", "companion", "Setup URI opened nothing - companion app likely not installed.");
    new ResultModal(
      this.app,
      "Companion app not installed?",
      [
        "Nothing opened, which usually means the Git Bridge Companion app is not installed on this device.",
        "The companion is the only supported trigger: it holds the Android permission to run the Termux runner. Without it, requests just time out.",
        "Copy the link below and paste it into your browser (Chrome/Firefox). That is the reliable route here: with no companion installed, Obsidian can only open its built-in browser tab, whose downloads are often discarded when the tab closes \u2014 so the APK never reaches Downloads.",
        `Direct APK: ${COMPANION_APK_URL}`,
        `All assets: ${COMPANION_RELEASES_URL}`,
        "After installing, grant the 'Run commands in Termux environment' permission in the companion, then try again."
      ],
      {
        actions: [
          {
            label: "Copy download link",
            cta: true,
            keepOpen: true,
            onClick: () => {
              void navigator.clipboard.writeText(COMPANION_APK_URL);
              new import_obsidian12.Notice("Link copied - paste it into Chrome or Firefox to download the APK.");
            }
          },
          {
            label: "Try opening in browser",
            keepOpen: true,
            onClick: () => this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_APK_URL)
          }
        ]
      }
    ).open();
  }
  // ------------------------------------------------------------- command impls
  async cmdStatus(silent = false) {
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
      skipWorktreeCount: d.skipWorktreeCount,
      lsFilesV: d.lsFilesV
    });
    const lastCommit = parseLastCommit(d.lastCommit ?? "");
    this.absorbSparsePatterns(sparse);
    this.lastStatus = { status, sparse, lastCommit, fetchedAt: (/* @__PURE__ */ new Date()).toLocaleString() };
    this.applyStatusToStatusBar(status);
    this.pushStatusToView();
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
      new import_obsidian12.Notice("No protected sparse paths configured (see settings).");
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
  /** Hide (exclude=true) or materialize a path via non-cone sparse patterns. */
  async cmdSparseExclude(path, exclude) {
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
      new import_obsidian12.Notice(exclude ? `Hidden via sparse checkout: ${path}` : `Materialized again: ${path}`);
    };
    if (exclude) {
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
  /** Add/remove a line in .git/info/exclude (device-local ignore, via the runner). */
  async cmdExcludeChange(path, add) {
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
    new import_obsidian12.Notice(add ? `Added to .git/info/exclude: /${path}` : `Removed from exclude: ${path}`);
  }
  async refreshExcludeList() {
    const result = await this.runOperation("exclude-list");
    if (!result?.ok) return null;
    this.absorbExcludeList(result.data?.excludeList);
    return this.excludeLines;
  }
  absorbExcludeList(raw) {
    if (raw === void 0) return;
    this.excludeLines = raw.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  }
  isExcluded(path) {
    return [`/${path}`, path, `/${path}/`, `${path}/`].some((v) => this.excludeLines.includes(v));
  }
  async loadGitignore() {
    try {
      const raw = await this.app.vault.adapter.read(".gitignore");
      this.gitignoreLines = raw.split(/\r?\n/);
    } catch {
      this.gitignoreLines = [];
    }
    return this.gitignoreLines.filter((l) => l.trim() !== "");
  }
  isGitignored(path) {
    const variants = [`/${path}`, path, `/${path}/`, `${path}/`];
    return this.gitignoreLines.some((l) => variants.includes(l.trim()));
  }
  async gitignoreAdd(entry2) {
    if (entry2.trim() === "" || _NativeGitBridgePlugin.CONTROL_CHARS.test(entry2)) {
      new import_obsidian12.Notice("Invalid .gitignore entry.");
      return;
    }
    await this.loadGitignore();
    if (this.gitignoreLines.some((l) => l.trim() === entry2.trim())) return;
    while (this.gitignoreLines.length > 0 && this.gitignoreLines[this.gitignoreLines.length - 1] === "") {
      this.gitignoreLines.pop();
    }
    this.gitignoreLines.push(entry2.trim());
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new import_obsidian12.Notice(`Added to .gitignore: ${entry2.trim()}`);
  }
  async gitignoreRemove(entry2) {
    await this.loadGitignore();
    const before = this.gitignoreLines.length;
    this.gitignoreLines = this.gitignoreLines.filter((l) => l.trim() !== entry2.trim());
    if (this.gitignoreLines.length === before) return;
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new import_obsidian12.Notice(`Removed from .gitignore: ${entry2.trim()}`);
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
  /** Parse the status fields every mutating action returns and refresh UI. */
  absorbStatusData(d) {
    if (!d.branchInfo) return;
    const status = parseStatusPorcelainV2(d.branchInfo);
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
      fetchedAt: (/* @__PURE__ */ new Date()).toLocaleString()
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
  absorbSparsePatterns(sparse) {
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
  effectiveProtectedPaths() {
    const s = this.deviceSettings;
    const merged = [...s.protectedPaths];
    if (s.autoProtectSparse) {
      for (const p of s.derivedProtectedPaths) if (!merged.includes(p)) merged.push(p);
    }
    return merged;
  }
  /** Shared error rendering for mutating operations. Never a bare "failed". */
  renderMutationError(title, result) {
    const err = result.error;
    const d = result.data ?? {};
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
        abortMerge: () => this.cmdAbortMerge()
      }).open();
      return;
    }
    this.statusBar?.set("error");
    new ResultModal(this.app, title, [err?.message ?? "Unknown error."], {
      stdout: err?.stdout,
      stderr: err?.stderr,
      isError: true
    }).open();
  }
  openVaultFile(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian13.TFile) void this.app.workspace.getLeaf(false).openFile(f);
    else new import_obsidian12.Notice(`Cannot open ${path} (not found in vault).`);
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
  async cmdCommit() {
    new CommitMessageModal(
      this.app,
      { title: "Commit changes", placeholder: "Commit message\u2026", submitLabel: "Commit" },
      async (message) => {
        if (message === null) return;
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
  async cmdSync(message, silent = false) {
    const result = await this.runOperation("sync", {
      protectedPaths: this.effectiveProtectedPaths(),
      message: message ?? ""
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: sync failed", result);
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
        if (!result.ok) return this.renderMutationError("Native Git: abort merge failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Merge aborted; repository restored.");
      }
    ).open();
  }
  // ---------------------------------------------------- phase 4: history/diff
  activeFilePath() {
    const f = this.app.workspace.getActiveFile();
    if (!f) {
      new import_obsidian12.Notice("No active file.");
      return null;
    }
    return f.path;
  }
  /** Entry point for history / view-at-commit / restore commands. */
  cmdFileHistory() {
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
      diffVsCurrent: (e) => void this.showDiff(path, e.hash, "WORKTREE", `${e.hash.slice(0, 8)} \u2192 working tree`),
      diffVsPrevious: (e, prev) => void this.showDiff(path, prev.hash, e.hash, `${prev.hash.slice(0, 8)} \u2192 ${e.hash.slice(0, 8)}`),
      restore: (e) => this.confirmRestore(path, e)
    }).open();
  }
  async showFileAtCommit(e) {
    const result = await this.runOperation("show-file-at-commit", {
      path: e.pathAtCommit,
      commit: e.hash
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: show file failed", result);
    const bytes = decodeBase64ToBytes(result.data?.contentBase64 ?? "");
    const text = bytesToTextIfNotBinary(bytes);
    const meta = `${e.pathAtCommit} @ ${e.hash.slice(0, 8)} \xB7 ${e.date.slice(0, 16).replace("T", " ")} \xB7 ${bytes.length} bytes`;
    if (text === null) {
      new ResultModal(this.app, "Binary file", [
        `${e.pathAtCommit} at ${e.hash.slice(0, 8)} is binary (${bytes.length} bytes); preview is not available.`,
        "Restore is still possible from the history list."
      ]).open();
      return;
    }
    new TextPreviewModal(this.app, "File at commit", meta, text).open();
  }
  async showDiff(path, from, to, label2) {
    const result = await this.runOperation("diff-file", { path, from, to });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: diff failed", result);
    new DiffModal(
      this.app,
      "Diff",
      `${path} \xB7 ${label2}`,
      result.data?.diff ?? "",
      result.data?.truncated === "true"
    ).open();
  }
  async cmdDiffCurrentFile() {
    const path = this.activeFilePath();
    if (path === null) return;
    await this.showDiff(path, "HEAD", "WORKTREE", "HEAD \u2192 working tree");
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
      if (reveal) this.app.workspace.revealLeaf(existing[0]);
      this.pushStatusToView();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_STATUS_VIEW, active: reveal });
    if (reveal) this.app.workspace.revealLeaf(leaf);
    this.pushStatusToView();
  }
  /** Tick the elapsed-time label without rebuilding the panel. */
  updateProgressInView(text) {
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW)) {
      const view = leaf.view;
      if (view instanceof StatusView) view.updateProgressText(text);
    }
  }
  /** Mirror current state into the sidebar panel (works on mobile). */
  pushStatusToView() {
    const leaves = this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW);
    if (leaves.length === 0) return;
    const state = this.statusBar?.current ?? (this.lock.active ? "syncing" : "clean");
    const extra = {
      sparse: this.lastStatus?.sparse,
      activeOperation: this.lock.active ? this.lock.active.action : void 0,
      progress: this.progressText ?? void 0,
      runningAction: this.runningAction ?? void 0,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? void 0,
      fetchedAt: this.lastStatus?.fetchedAt,
      bridge: this.deviceSettings.termuxIntegrationEnabled ? "companion app" : "disabled"
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
    if (!import_obsidian12.Platform.isAndroidApp) {
      new import_obsidian12.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
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
      `Companion APK: ${COMPANION_APK_URL}`,
      "",
      "Current state on this device:",
      `Enabled here: ${s.enabledOnThisDevice ? "yes" : "NO (turn it on in settings)"}`,
      `Termux integration: ${s.termuxIntegrationEnabled ? "on" : "OFF (turn it on in settings)"}`,
      `Paired with a runner: ${s.authToken ? "yes" : "NO (step 3 pairs it automatically)"}`,
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
        label: "Copy companion APK link",
        keepOpen: true,
        onClick: () => {
          void navigator.clipboard.writeText(COMPANION_APK_URL);
          new import_obsidian12.Notice("Link copied - paste it into Chrome or Firefox to download the APK.");
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
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled) {
      actions.unshift({
        label: "Enable on this device",
        keepOpen: true,
        onClick: () => {
          void this.updateDeviceSettings({ enabledOnThisDevice: true, termuxIntegrationEnabled: true }).then(
            () => new import_obsidian12.Notice("Enabled. Now do steps 1-3 if you have not yet.")
          );
        }
      });
    }
    this.log.add("info", "setup", `Setup guide shown: ${reason}`);
    new ResultModal(this.app, "Set up Native Git Bridge", lines, { actions }).open();
  }
  /** The one-line Termux install command (same one settings shows). */
  installCommand() {
    const hint = this.deviceSettings.repoPathHint;
    return hint ? `curl -fsSL ${REPO_RAW_BASE}/termux/bootstrap.sh | bash -s -- "${hint}"` : `curl -fsSL ${REPO_RAW_BASE}/termux/bootstrap.sh | bash`;
  }
  /** Copy the install command, then bring Termux to the front (via the companion). */
  copyCommandAndOpenTermux() {
    void navigator.clipboard.writeText(this.installCommand());
    new import_obsidian12.Notice("Install command copied - long-press in Termux to paste, then Enter.");
    this.openExternalUri(COMPANION_OPEN_TERMUX_URI);
  }
  async cmdSelfCheck(timedOut = false) {
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
    this.log.add(report.ok ? "info" : "warn", "self-check", report.verdict);
    const actions = [];
    if (import_obsidian12.Platform.isAndroidApp) {
      actions.push({
        label: "Copy command & open Termux",
        cta: true,
        onClick: () => this.copyCommandAndOpenTermux()
      });
      if (this.lastAckTermuxInstalled !== false) {
        actions.push({
          label: "Open Termux",
          keepOpen: true,
          onClick: () => this.openExternalUri(COMPANION_OPEN_TERMUX_URI)
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
          label: "Copy companion APK link",
          keepOpen: true,
          onClick: () => {
            void navigator.clipboard.writeText(COMPANION_APK_URL);
            new import_obsidian12.Notice("Link copied - paste it into Chrome or Firefox to download the APK.");
          }
        });
      } else {
        actions.push({
          label: "Update companion app",
          keepOpen: true,
          onClick: () => this.openExternalUri(COMPANION_DOWNLOAD_APK_URI)
        });
      }
    }
    new ResultModal(this.app, "Bridge check", lines, {
      stdout: report.runnerLogTail || void 0,
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
  async cmdStageFile(path) {
    const result = await this.runOperation("stage-file", {
      path,
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: stage failed", result);
    this.absorbStatusData(result.data ?? {});
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
    report.pluginSide["Platform"] = import_obsidian12.Platform.isAndroidApp ? "Android app" : import_obsidian12.Platform.isMobile ? "mobile" : "desktop";
    report.pluginSide["Enabled on this device"] = String(s.enabledOnThisDevice);
    report.pluginSide["Termux integration"] = String(s.termuxIntegrationEnabled);
    report.pluginSide["Pairing token set"] = s.authToken ? "yes" : "no";
    report.pluginSide["Protected paths (manual)"] = s.protectedPaths.join(", ") || "(none)";
    report.pluginSide["Protected paths (derived from sparse)"] = (s.autoProtectSparse ? s.derivedProtectedPaths.join(", ") : "(auto-protect off)") || "(none)";
    report.pluginSide["Protected paths (effective)"] = this.effectiveProtectedPaths().join(", ") || "(none)";
    report.pluginSide["Device-local storage"] = this.store.isVolatile ? "VOLATILE (in-memory fallback)" : "persistent";
    report.pluginSide["Pending requests"] = String(await this.client.pendingRequestCount());
    report.pluginSide["Active operation"] = this.lock.active ? `${this.lock.active.action} (${this.lock.active.id})` : "none";
    if (!import_obsidian12.Platform.isAndroidApp)
      report.problems.push(
        "Not an Android device: the bridge (companion app + Termux) exists only on Android, so all operations are disabled here."
      );
    if (this.store.isVolatile) report.problems.push("Device-local storage is unavailable; settings will not persist.");
    if (!s.authToken) report.problems.push("No pairing token configured.");
    if (this.effectiveProtectedPaths().length === 0)
      report.problems.push(
        "No protected sparse paths (neither manual nor derived from sparse exclusions). Fine for full checkouts; risky if this repo uses sparse checkout."
      );
    if (import_obsidian12.Platform.isAndroidApp) {
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
      new import_obsidian12.Notice("No operation is currently awaiting a result.");
      return;
    }
    this.activeCancel.cancel();
  }
};
// .gitignore is a plain tracked file in the vault: edited directly, no Termux.
// Built via the RegExp constructor so this source file contains no raw control bytes.
_NativeGitBridgePlugin.CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]");
var NativeGitBridgePlugin = _NativeGitBridgePlugin;
function getLocalStorageBackend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = "__ngb_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
