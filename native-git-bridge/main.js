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
var import_obsidian7 = require("obsidian");

// src/constants.ts
var PLUGIN_ID = "native-git-bridge";
var PROTOCOL_VERSION = 1;
var DEFAULT_PROTECTED_PATHS = ["Private/AgentsMemory", "Projects/Backus"];
var RUNTIME_DIR_NAME = "runtime";
var REQUESTS_DIR = "requests";
var RESULTS_DIR = "results";
var CANCEL_DIR = "cancel";
var DONE_DIR = "done";
var POLL_INTERVAL_MS = 400;
var DEFAULT_TIMEOUT_SECONDS = 180;
var RESULT_RETENTION_MS = 24 * 60 * 60 * 1e3;
var STALE_LOCK_MS = 30 * 60 * 1e3;
var DISPLAY_OUTPUT_LIMIT = 100 * 1024;
var LOG_MAX_ENTRIES = 200;
var SPARSE_SAFETY_WARNING = "Sparse checkout safety check failed. The excluded directories appear as Git changes. No commit or push was performed.";
var STORAGE_PREFIX = "ngb:v1";
var REPO_RAW_BASE = "https://raw.githubusercontent.com/maxkalem/obsidian-native-git-bridge/main";
var PAIRING_FILE = "pairing.json";

// src/types.ts
var MUTATING_ACTIONS = /* @__PURE__ */ new Set([
  "sparse-reapply",
  "pull",
  "commit",
  "push",
  "sync",
  "restore-file",
  "abort-merge"
]);

// src/settings/DeviceLocalSettingsStore.ts
var CURRENT_SCHEMA_VERSION = 1;
var DEFAULT_DEVICE_SETTINGS = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  enabledOnThisDevice: false,
  termuxIntegrationEnabled: false,
  integrationType: "widget-manual",
  repoPathHint: "",
  authToken: "",
  protectedPaths: [...DEFAULT_PROTECTED_PATHS],
  opTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  autoPullOnOpen: false,
  autoSyncOnClose: false,
  periodicSyncMinutes: 0,
  minAutoSyncIntervalMinutes: 15,
  wifiOnly: false,
  skipOnLowBattery: false,
  companionUriTemplate: "nativegitbridge://run?id={id}"
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
var import_obsidian2 = require("obsidian");

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
  p = p.replace(/\/{2,}/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/\/+$/, "");
  if (p === "" || p === ".") return { ok: false, reason: "Path resolves to the repository root." };
  const segments = p.split("/");
  if (segments.some((s) => s === "..")) return { ok: false, reason: "Path traversal ('..') is not allowed." };
  if (segments.some((s) => s === "")) return { ok: false, reason: "Empty path segment." };
  if (segments[0].toLowerCase() === ".git") return { ok: false, reason: "Paths inside .git are not allowed." };
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
var import_obsidian = require("obsidian");
function outputSection(el, label2, text) {
  if (!text || text.trim() === "") return;
  const details = el.createEl("details", { cls: "ngb-details" });
  details.createEl("summary", { text: label2 });
  const box = details.createDiv({ cls: "ngb-output" });
  const shown = text.length > DISPLAY_OUTPUT_LIMIT ? text.slice(0, DISPLAY_OUTPUT_LIMIT) + "\n\u2026 (truncated; full output in runner.log)" : text;
  box.createEl("pre", { text: shown });
}
var ResultModal = class extends import_obsidian.Modal {
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
      sec.createDiv({ text: line, cls: this.opts.isError ? "ngb-status-error" : "" });
    }
    outputSection(c, "stdout", this.opts.stdout);
    outputSection(c, "stderr", this.opts.stderr);
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const ok = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    ok.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian.Modal {
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
    for (const line of this.opts.body) c.createEl("p", { text: line });
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
var ChangedFilesModal = class extends import_obsidian.Modal {
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
var SparseSafetyModal = class extends import_obsidian.Modal {
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
var StatusModal = class extends import_obsidian.Modal {
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
var import_obsidian3 = require("obsidian");
var NativeGitBridgeSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.deviceSettings;
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
    const cmd = `curl -fsSL ${REPO_RAW_BASE}/termux/bootstrap.sh | bash -s -- "${s.repoPathHint || "/storage/emulated/0/<YourVault>"}"`;
    const cmdBox = containerEl.createDiv({ cls: "ngb-output" });
    cmdBox.createEl("pre", { text: cmd, cls: "ngb-mono" });
    new import_obsidian2.Setting(containerEl).setName("Install command").setDesc(
      "Install Termux (F-Droid) and the Git Bridge Companion APK, then paste this single command into Termux. It installs git/jq/openssh, links storage, enables the companion trigger, creates an SSH key, verifies the repo and pairs with this plugin automatically \u2014 no manual token copying."
    ).addButton(
      (b) => b.setButtonText("Copy command").setCta().onClick(async () => {
        await navigator.clipboard.writeText(cmd);
        new import_obsidian3.Notice("Install command copied.");
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Enable on this device").setDesc("Master switch. Off by default on every new device.").addToggle(
      (t) => t.setValue(s.enabledOnThisDevice).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ enabledOnThisDevice: v });
        this.display();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Termux integration").setDesc("Allow this plugin to queue requests for the Termux runner.").addToggle(
      (t) => t.setValue(s.termuxIntegrationEnabled).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ termuxIntegrationEnabled: v });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Android integration type").setDesc(
      "widget-manual: you tap the Termux widget shortcut to run queued requests (documented, reliable). companion-intent: experimental; requires the companion app."
    ).addDropdown(
      (d) => d.addOption("widget-manual", "Termux widget (manual tap)").addOption("companion-intent", "Companion app intent (experimental)").setValue(s.integrationType).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({
          integrationType: v
        });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Pairing token").setDesc(
      "Paste the token printed by the Termux installer (termux/install.sh). It authenticates requests between this plugin and the runner. Stored locally; never logged."
    ).addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("token from installer").setValue(s.authToken).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ authToken: v.trim() });
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Repository path (informational)").setDesc("The repo path as seen from Termux, e.g. /storage/emulated/0/Documents/Vault. The runner config is authoritative.").addText(
      (t) => t.setValue(s.repoPathHint).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ repoPathHint: v.trim() });
      })
    );
    containerEl.createEl("h3", { text: "Sparse checkout protection" });
    const desc = containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "Repository-relative paths excluded by sparse checkout. Before any commit or push these must show no Git changes; otherwise the operation is blocked. One path per line."
    });
    const invalidNote = containerEl.createDiv({ cls: "ngb-invalid" });
    new import_obsidian2.Setting(containerEl).setName("Protected sparse paths").addTextArea((ta) => {
      ta.inputEl.rows = 4;
      ta.setValue(s.protectedPaths.join("\n")).onChange(async (v) => {
        const lines = v.split("\n").map((l) => l.trim()).filter((l) => l !== "");
        const res = validateProtectedPaths(lines);
        if (res.ok) {
          invalidNote.setText("");
          await this.plugin.updateDeviceSettings({ protectedPaths: res.normalized });
        } else {
          invalidNote.setText(`Rejected "${res.offending}": ${res.reason} Nothing saved.`);
        }
      });
    });
    containerEl.createEl("h3", { text: "Automatic actions (all off by default)" });
    new import_obsidian2.Setting(containerEl).setName("Pull when Obsidian opens").addToggle(
      (t) => t.setValue(s.autoPullOnOpen).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ autoPullOnOpen: v });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync when Obsidian closes / goes to background").setDesc("Queues a sync request during the close transition; in widget mode it runs at your next tap.").addToggle(
      (t) => t.setValue(s.autoSyncOnClose).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ autoSyncOnClose: v });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Periodic sync while Obsidian is open (minutes, 0 = off)").addText(
      (t) => t.setValue(String(s.periodicSyncMinutes)).onChange(async (v) => {
        const n = Math.max(0, Math.floor(Number(v) || 0));
        await this.plugin.updateDeviceSettings({ periodicSyncMinutes: n });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Minimum interval between automatic syncs (minutes)").addText(
      (t) => t.setValue(String(s.minAutoSyncIntervalMinutes)).onChange(async (v) => {
        const n = Math.max(1, Math.floor(Number(v) || 15));
        await this.plugin.updateDeviceSettings({ minAutoSyncIntervalMinutes: n });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Only sync on Wi-Fi (best effort)").setDesc("Uses the WebView network API when available; skipped silently when the API is missing.").addToggle(
      (t) => t.setValue(s.wifiOnly).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ wifiOnly: v });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Skip automatic sync when battery is low (best effort)").addToggle(
      (t) => t.setValue(s.skipOnLowBattery).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ skipOnLowBattery: v });
      })
    );
    containerEl.createEl("h3", { text: "Advanced" });
    new import_obsidian2.Setting(containerEl).setName("Operation timeout (seconds)").addText(
      (t) => t.setValue(String(s.opTimeoutSeconds)).onChange(async (v) => {
        const n = Math.min(3600, Math.max(10, Math.floor(Number(v) || DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds)));
        await this.plugin.updateDeviceSettings({ opTimeoutSeconds: n });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Companion intent URI template").setDesc('Experimental. "{id}" is replaced by the request id. Only used with the companion-intent type.').addText(
      (t) => t.setValue(s.companionUriTemplate).onChange(async (v) => {
        await this.plugin.updateDeviceSettings({ companionUriTemplate: v.trim() });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Reset device-local settings").setDesc("Restores all settings on this device to defaults. The vault and repository are not touched.").addButton(
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
  /** How many requests are queued and unprocessed (widget mode surfacing). */
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
    for (const dir of [this.paths.resultsDir, this.paths.cancelDir, this.paths.doneDir]) {
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
var WidgetManualTransport = class {
  constructor() {
    this.type = "widget-manual";
  }
  trigger(_requestId) {
    return {
      kind: "manual",
      instruction: 'Request queued. Tap the "GitBridge" shortcut in your Termux widget to run it.'
    };
  }
};
var CompanionIntentTransport = class {
  constructor(uriTemplate, openUri) {
    this.uriTemplate = uriTemplate;
    this.openUri = openUri;
    this.type = "companion-intent";
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
function parseSparseState(fields) {
  const enabled = fields.sparseEnabled.trim() === "true";
  const coneRaw = fields.sparseCone.trim();
  return {
    enabled,
    coneMode: coneRaw === "" ? void 0 : coneRaw === "true",
    patterns: fields.sparseList.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
    skipWorktreeCount: countSkipWorktree(fields.lsFilesV)
  };
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
  "waiting-tap": { cls: "ngb-status-waiting", label: "git: tap widget" },
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

// src/main.ts
var import_obsidian8 = require("obsidian");

// src/ui/OperationLogModal.ts
var import_obsidian6 = require("obsidian");
var OperationLogModal = class extends import_obsidian6.Modal {
  constructor(app, log) {
    super(app);
    this.log = log;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: operation log");
    const c = this.contentEl;
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
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const clear = btns.createEl("button", { text: "Clear log" });
    clear.addEventListener("click", () => {
      this.log.clear();
      this.close();
    });
    const close = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    close.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var DEFAULT_SHARED_PREFS = { showStatusBar: true, showRibbonIcon: true };
var MARKER_KEY = "active-op";
var LAST_SYNC_KEY = "last-sync";
var NativeGitBridgePlugin = class extends import_obsidian7.Plugin {
  constructor() {
    super(...arguments);
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS };
    this.statusBar = null;
    this.activeCancel = null;
    this.lastStatus = null;
    this.lastAutoSyncMs = 0;
  }
  async onload() {
    this.store = new DeviceLocalSettingsStore(getLocalStorageBackend(), this.resolveScopeId());
    this.deviceSettings = this.store.read();
    this.log = new OperationLog(this.store);
    const data = await this.loadData();
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS, ...data ?? {} };
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
  onunload() {
    this.activeCancel?.cancel();
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
  warnIfObsidianGitEnabledOnAndroid() {
    if (!import_obsidian7.Platform.isAndroidApp) return;
    const plugins = this.app.plugins;
    if (plugins?.enabledPlugins?.has("obsidian-git")) {
      this.log.add("warn", "compat", "obsidian-git enabled on Android alongside Native Git Bridge.");
      new ResultModal(
        this.app,
        "Plugin compatibility warning",
        [
          "The 'Git' (obsidian-git) plugin is enabled on this Android device.",
          "Its mobile backend (isomorphic-git) does not understand native sparse-checkout / skip-worktree index data and may stage protected paths as deletions.",
          "Recommendation: disable obsidian-git on this device (Settings \u2192 Community plugins). Native Git Bridge will not disable it automatically."
        ],
        { isError: true }
      ).open();
    }
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
        new import_obsidian7.Notice("Native Git Bridge: paired with the Termux runner.");
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
        `Operation ${marker.id} from the previous session has no result yet; it may still run when you tap the widget. Its result will be cleaned up automatically.`
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
    new import_obsidian7.Notice("Native Git Bridge: device-local settings reset.");
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
      { id: "show-changed-files", name: "Native Git: Show changed files", cb: () => void this.cmdShowChangedFiles() },
      { id: "verify-sparse-safety", name: "Native Git: Verify sparse checkout safety", cb: () => void this.cmdVerifySparseSafety() },
      { id: "reapply-sparse", name: "Native Git: Reapply sparse checkout", cb: () => void this.cmdReapplySparse() },
      { id: "diagnostics", name: "Native Git: Run diagnostics", cb: () => void this.cmdDiagnostics() },
      { id: "open-operation-log", name: "Native Git: Open operation log", cb: () => new OperationLogModal(this.app, this.log).open() },
      { id: "cancel-operation", name: "Native Git: Cancel current operation when possible", cb: () => void this.cmdCancel() }
    ];
    for (const c of cmds) this.addCommand({ id: c.id, name: c.name, callback: c.cb });
  }
  // ------------------------------------------------------------ operations
  /** Guard + queue + trigger + await one bridge operation. */
  async runOperation(action, args = {}) {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice) {
      new import_obsidian7.Notice("Native Git Bridge is disabled on this device (see settings).");
      return null;
    }
    if (!s.termuxIntegrationEnabled) {
      new import_obsidian7.Notice("Termux integration is disabled on this device (see settings).");
      return null;
    }
    if (!s.authToken) {
      new import_obsidian7.Notice("No pairing token set. Run the Termux installer, then paste the token in settings.");
      return null;
    }
    const req = createRequest(action, args, s.authToken, s.opTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
    const mutating = MUTATING_ACTIONS.has(action);
    if (mutating && !this.lock.tryAcquire(req.id, action)) {
      new import_obsidian7.Notice(`Another operation is running (${this.lock.active?.action}). Try again later.`);
      return null;
    }
    if (!mutating && this.lock.active && MUTATING_ACTIONS.has(this.lock.active.action)) {
      new import_obsidian7.Notice(`A ${this.lock.active.action} operation is running; try again when it finishes.`);
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
        new import_obsidian7.Notice(outcome.instruction, 1e4);
      }
      const waited = await this.client.awaitResult(req.id, req.timeoutSeconds * 1e3, cancel);
      if (waited.kind === "timeout") {
        this.log.add("warn", action, `Request ${req.id} timed out after ${req.timeoutSeconds}s (request left queued).`);
        new ResultModal(this.app, `Native Git: ${action} timed out`, [
          `No result arrived within ${req.timeoutSeconds}s.`,
          s.integrationType === "widget-manual" ? "Did you tap the GitBridge shortcut in the Termux widget? The request stays queued and will run at the next tap." : "Check that the companion app and Termux are set up correctly (see diagnostics)."
        ]).open();
        return null;
      }
      if (waited.kind === "cancelled") {
        await this.client.requestCancel(req.id);
        this.log.add("warn", action, `Request ${req.id} cancelled by user.`);
        new import_obsidian7.Notice(`Native Git: ${action} cancelled.`);
        return null;
      }
      const result = waited.result;
      await this.client.consume(req.id);
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
      this.activeCancel = null;
      if (mutating) this.lock.release(req.id);
      this.refreshStatusBarIdle();
    }
  }
  makeTransport() {
    if (this.deviceSettings.integrationType === "companion-intent") {
      return new CompanionIntentTransport(this.deviceSettings.companionUriTemplate, (uri) => {
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
      });
    }
    return new WidgetManualTransport();
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
      lsFilesV: d.lsFilesV ?? ""
    });
    const lastCommit = parseLastCommit(d.lastCommit ?? "");
    this.lastStatus = { status, sparse, lastCommit, fetchedAt: (/* @__PURE__ */ new Date()).toLocaleString() };
    this.applyStatusToStatusBar(status);
    if (!silent) this.openStatusModal();
  }
  openStatusModal() {
    new StatusModal(this.app, {
      status: this.lastStatus?.status,
      sparse: this.lastStatus?.sparse,
      lastCommit: this.lastStatus?.lastCommit,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? void 0,
      bridgeAvailable: this.deviceSettings.termuxIntegrationEnabled ? `enabled (${this.deviceSettings.integrationType})` : "disabled",
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
    const protectedPaths = this.deviceSettings.protectedPaths;
    if (protectedPaths.length === 0) {
      new import_obsidian7.Notice("No protected sparse paths configured (see settings).");
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
        new ResultModal(
          this.app,
          result.ok ? "Sparse checkout reapplied" : "Sparse reapply failed",
          result.ok ? ["Sparse checkout rules were reapplied.", `Patterns now active: ${(result.data?.sparseList ?? "").split("\n").filter(Boolean).length}`] : [result.error?.message ?? "Unknown error."],
          { stdout: result.error?.stdout ?? result.data?.reapplyOutput, stderr: result.error?.stderr, isError: !result.ok }
        ).open();
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
      lsFilesV: d.lsFilesV ?? ""
    });
    this.lastStatus = {
      status,
      sparse,
      lastCommit: parseLastCommit(d.lastCommit ?? ""),
      fetchedAt: (/* @__PURE__ */ new Date()).toLocaleString()
    };
    this.applyStatusToStatusBar(status);
  }
  /** Shared error rendering for mutating operations. Never a bare "failed". */
  renderMutationError(title, result) {
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
    if (f instanceof import_obsidian8.TFile) void this.app.workspace.getLeaf(false).openFile(f);
    else new import_obsidian7.Notice(`Cannot open ${path} (not found in vault).`);
  }
  async cmdFetch() {
    const result = await this.runOperation("fetch");
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: fetch failed", result);
    this.absorbStatusData(result.data ?? {});
    const st = this.lastStatus?.status;
    new import_obsidian7.Notice(`Fetched. Ahead ${st?.ahead ?? "?"}, behind ${st?.behind ?? "?"}.`);
  }
  async cmdPull(silent = false) {
    const result = await this.runOperation("pull", {
      protectedPaths: this.deviceSettings.protectedPaths
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: pull failed", result);
    this.absorbStatusData(result.data ?? {});
    if (!silent) {
      new ResultModal(this.app, "Native Git: pull", ["Pull completed."], {
        stdout: result.data?.pullOutput
      }).open();
    }
  }
  async cmdCommit() {
    new CommitMessageModal(
      this.app,
      { title: "Commit changes", placeholder: "Commit message\u2026", submitLabel: "Commit" },
      async (message) => {
        if (message === null) return;
        const result = await this.runOperation("commit", {
          protectedPaths: this.deviceSettings.protectedPaths,
          message
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: commit failed", result);
        this.absorbStatusData(result.data ?? {});
        const committed = result.data?.committed === "true";
        new ResultModal(
          this.app,
          "Native Git: commit",
          [
            committed ? `Committed ${result.data?.newHead?.slice(0, 8) ?? ""}.` : "Nothing to commit (no staged changes after safety filtering)."
          ],
          { stdout: result.data?.commitOutput }
        ).open();
      }
    ).open();
  }
  async cmdPush() {
    const result = await this.runOperation("push", {
      protectedPaths: this.deviceSettings.protectedPaths
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: push failed", result);
    this.absorbStatusData(result.data ?? {});
    new ResultModal(this.app, "Native Git: push", ["Push completed."], {
      stdout: result.data?.pushOutput
    }).open();
  }
  async cmdSync(message, silent = false) {
    const result = await this.runOperation("sync", {
      protectedPaths: this.deviceSettings.protectedPaths,
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
    if (silent) new import_obsidian7.Notice("Native Git: sync completed.");
    else new ResultModal(this.app, "Native Git: sync completed", lines, { stdout: result.data?.pullOutput }).open();
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
        new import_obsidian7.Notice("Merge aborted; repository restored.");
      }
    ).open();
  }
  async cmdDiagnostics() {
    const report = { pluginSide: {}, problems: [] };
    const s = this.deviceSettings;
    report.pluginSide["Plugin version"] = this.manifest.version;
    report.pluginSide["Platform"] = import_obsidian7.Platform.isAndroidApp ? "Android app" : import_obsidian7.Platform.isMobile ? "mobile" : "desktop";
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
    if (import_obsidian7.Platform.isAndroidApp) {
      const plugins = this.app.plugins;
      if (plugins?.enabledPlugins?.has("obsidian-git")) {
        report.problems.push("obsidian-git is enabled on Android: incompatible with a native sparse-checkout index.");
      }
    }
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
  async cmdCancel() {
    if (!this.activeCancel) {
      new import_obsidian7.Notice("No operation is currently awaiting a result.");
      return;
    }
    this.activeCancel.cancel();
  }
};
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
