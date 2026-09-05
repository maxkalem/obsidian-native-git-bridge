import {
  App,
  Notice,
  Platform,
  PluginSettingTab,
  type Setting,
  type SettingDefinition,
  type SettingDefinitionItem,
  type SettingDefinitionPage,
  type SettingGroupItem,
} from "obsidian";
import type NativeGitBridgePlugin from "../main";
import { validateProtectedPaths } from "./pathValidation";
import {
  DEFAULT_DEVICE_SETTINGS,
  DIFF_LIMIT_CHOICES_KB,
  ROWS_PER_GROUP_CHOICES,
  type DeviceLocalSettings,
} from "./DeviceLocalSettingsStore";
import { ConfirmModal } from "../ui/modals";
import { CommitMessageModal, promptNewTemplate, TemplateManagerModal } from "../ui/gitModals";
import { MIN_NETWORK_TIMEOUT_SECONDS, RUNNER_MIN_VERSION } from "../constants";
import { DEFAULT_COLORS, type NgbColorSet } from "../ui/colors";
import { formatSize } from "../git/previousRepos";
import { DEFAULT_COMMIT_DATE_FORMAT } from "../git/commitMessage";
import { parseIgnoreEntries } from "../git/ignoreFile";

/**
 * The settings tab, declared rather than drawn.
 *
 * `getSettingDefinitions()` returns the whole tab as data; Obsidian renders
 * it, indexes it for the settings search, and calls `getControlValue` /
 * `setControlValue` for every control. The two storages behind the controls
 * are named in the key: `device.<field>` is this device's `localStorage`
 * settings, `shared.<field>` is `data.json` (cosmetic preferences that travel
 * with the vault). A handful of keys are neither — `footprint.shallow` and
 * `footprint.partial` reflect the repository's actual state and run a
 * command when moved — and are answered case by case below.
 *
 * What stays imperative, through `render` definitions, is what has no
 * declarative shape: the version badges with their advice boxes, the two
 * install commands (a wrapped code box), the pairing token (a password
 * input), and the notes between sections. Everything else is a control, an
 * action, or a list.
 *
 * The four rule managers — protected paths, sparse exclusions, `.gitignore`,
 * `.git/info/exclude` — are PAGES, each holding a `list`. They used to be
 * collapsible `<details>` blocks on the main page, collapsed because the lists
 * can run long; a page is the declarative form of the same idea and gives
 * every entry a delete button and the list an add row without a stylesheet of
 * our own. A page's `displayValue` carries what the collapsed hint used to.
 * A mutation calls `update()`, which re-renders from fresh definitions; the
 * old code refreshed each list in place to keep the main page's scroll
 * position, and a page has no such position to lose.
 */
export class NativeGitBridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NativeGitBridgePlugin) {
    super(app, plugin);
  }

  // ---------------------------------------------------------------- storage

  getControlValue(key: string): unknown {
    const [store, field] = splitKey(key);
    switch (store) {
      case "device":
        return this.plugin.deviceSettings[field as keyof DeviceLocalSettings];
      case "shared":
        return (this.plugin.sharedPrefs as unknown as Record<string, unknown>)[field];
      case "color": {
        const [theme = "", name = ""] = field.split(".");
        const set = theme === "dark" ? this.plugin.sharedPrefs.colorsDark : this.plugin.sharedPrefs.colorsLight;
        return set[name as keyof NgbColorSet];
      }
      case "footprint": {
        const fp = this.plugin.footprintState();
        return field === "shallow" ? (fp?.shallow ?? false) : (fp?.partial ?? false);
      }
      case "slot":
        return this.plugin.deviceSettings[field as "syncOnCloseTemplate" | "autoCommitTemplate" | "syncTemplate"];
    }
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const [store, field] = splitKey(key);
    switch (store) {
      case "device":
        await this.plugin.updateDeviceSettings(this.deviceWrite(field, value));
        if (field === "enabledOnThisDevice") this.update();
        if (field === "statusRefreshSeconds") this.plugin.restartStatusPoll();
        return;
      case "shared":
        await this.plugin.setSharedPref(this.sharedWrite(field, value));
        if (field === "customColors") this.update();
        return;
      case "color": {
        const [theme = "", name = ""] = field.split(".");
        if (typeof value !== "string") return;
        const prefKey = theme === "dark" ? "colorsDark" : "colorsLight";
        await this.plugin.setSharedPref({
          [prefKey]: { ...this.plugin.sharedPrefs[prefKey], [name]: value },
        });
        return;
      }
      case "footprint": {
        // The toggle REFLECTS the repository's state and moves only after the
        // runner answered ok; a decline, a refusal or an unreachable runner
        // re-renders the tab and the toggle shows what is still true.
        if (field === "shallow") {
          if (value === true) await this.plugin.cmdShallowEnable();
          else await this.plugin.cmdUnshallow();
        } else {
          if (value === true) await this.plugin.cmdPartialEnable();
          else await this.plugin.cmdPartialDisable();
        }
        this.update();
        return;
      }
      case "slot": {
        // One slot per automatic trigger picks from the SHARED template list;
        // "+ New template…" is a sentinel that saves into the list and the
        // slot. The slot stores the template STRING, so deleting a list row
        // never retargets it — the kept string just says it left the list.
        if (typeof value !== "string") return;
        const slot = field as "syncOnCloseTemplate" | "autoCommitTemplate" | "syncTemplate";
        if (value === NEW_TEMPLATE) {
          promptNewTemplate(this.app, async (msg) => {
            await this.plugin.setSharedPref({
              commitTemplates: [...this.plugin.sharedPrefs.commitTemplates, msg],
            });
            await this.plugin.updateDeviceSettings({ [slot]: msg });
            this.update();
          });
          this.update(); // put the dropdown back until the prompt answers
          return;
        }
        await this.plugin.updateDeviceSettings({ [slot]: value });
        return;
      }
    }
  }

  /**
   * The value a device control writes, clamped the way the old text inputs
   * clamped it: a number control already refuses non-numbers, and the ranges
   * below are the ones the operations can live with.
   */
  private deviceWrite(field: string, value: unknown): Partial<DeviceLocalSettings> {
    const d = DEFAULT_DEVICE_SETTINGS;
    switch (field) {
      case "authToken":
      case "repoPathHint":
      case "companionUriTemplate":
        return { [field]: String(value ?? "").trim() };
      case "opTimeoutSeconds":
        return { opTimeoutSeconds: clampInt(value, 10, 3600, d.opTimeoutSeconds) };
      case "statusRefreshSeconds":
        return { statusRefreshSeconds: clampInt(value, 0, 86400, 0) };
      case "shallowDepth":
        return { shallowDepth: clampInt(value, 1, 100000, d.shallowDepth) };
      case "recentCommitMessagesMax":
        return { recentCommitMessagesMax: clampInt(value, 0, 50, d.recentCommitMessagesMax) };
      case "periodicSyncMinutes":
        return { periodicSyncMinutes: clampInt(value, 0, 100000, 0) };
      case "minAutoSyncIntervalMinutes":
        return { minAutoSyncIntervalMinutes: clampInt(value, 1, 100000, d.minAutoSyncIntervalMinutes) };
      case "rowsPerGroup":
        return { rowsPerGroup: clampInt(value, 1, 100000, d.rowsPerGroup) };
      case "diffLimitKb":
        return { diffLimitKb: clampInt(value, 1, 100000, d.diffLimitKb) };
      default:
        return { [field]: value } as Partial<DeviceLocalSettings>;
    }
  }

  private sharedWrite(field: string, value: unknown): Record<string, unknown> {
    if (field === "commitDateFormat") {
      const v = String(value ?? "");
      return { commitDateFormat: v.trim() === "" ? DEFAULT_COMMIT_DATE_FORMAT : v };
    }
    return { [field]: value };
  }

  // ------------------------------------------------------------ definitions

  getSettingDefinitions(): SettingDefinitionItem[] {
    // The bridge (companion app + Termux RUN_COMMAND) exists only on Android.
    // Elsewhere: explain, and show no settings at all — every one of them is
    // device-local, so configuring them on desktop could never do anything.
    if (!Platform.isAndroidApp) {
      return [
        block("Android only", (el) => {
          el.createDiv({
            cls: "ngb-warning",
            text:
              "Native Git Bridge works on Android only: it delegates every Git operation " +
              "to the real git binary inside Termux, triggered through a companion app. " +
              "There is nothing to configure on this device — on desktop, use git directly " +
              "or the obsidian-git plugin. Settings appear when you open this tab on your " +
              "Android device (they are stored per device and never synced through the vault).",
          });
        }),
      ];
    }
    const s = this.plugin.deviceSettings;
    return [
      ...this.versionItems(),
      block("Storage note", (el) => {
        el.createEl("p", {
          cls: "ngb-settings-note",
          text:
            "All settings below are stored on this device only (never synced through the vault), " +
            "so each device can be enabled and configured independently.",
        });
        if (this.plugin.store.isVolatile) {
          el.createDiv({
            cls: "ngb-warning",
            text:
              "Device-local storage is unavailable; settings will not survive an app restart. " +
              "Check available storage / WebView state.",
          });
        }
      }),
      { type: "group", heading: "Setup (one line in Termux)", items: this.setupItems(s) },
      { type: "group", heading: "Repository rules", items: this.rulesItems() },
      { type: "group", heading: "File context menu", items: this.menuItems() },
      { type: "group", heading: "Commit messages", items: this.commitMessageItems() },
      { type: "group", heading: "Notifications", items: this.notificationItems() },
      { type: "group", heading: "Repository footprint (this device)", items: this.footprintItems() },
      { type: "group", heading: "Automatic actions", items: this.automaticItems() },
      { type: "group", heading: "Advanced", items: this.advancedItems() },
    ];
  }

  /**
   * Versions first: three parts update independently, so "which versions do
   * I actually have here" is the first question when something misbehaves.
   * Badges plus one advice box per finding, each carrying the buttons its
   * `kind` earns (the four-state model): below the floor gets the one fix, an
   * available update gets the update plus the stay-put route, and a HALF
   * NEWER than this build gets both exits of that choice.
   */
  private versionItems(): SettingDefinitionItem[] {
    return [
      block("Versions", (el) => {
        const advice = this.plugin.versionAdvice();
        const stale = (part: "plugin" | "companion" | "runner") => advice.some((a) => a.part === part);
        const ver = el.createDiv({ cls: "ngb-version-row" });
        const badge = (text: string, part: "plugin" | "companion" | "runner") =>
          ver.createSpan({
            cls: stale(part) ? "ngb-version-badge ngb-version-stale" : "ngb-version-badge",
            text,
          });
        badge(`Plugin ${this.plugin.manifest.version}`, "plugin");
        const rv = this.plugin.lastRunnerVersion;
        // "needs vN" only when the runner is actually BELOW the floor.
        // Comparing for inequality branded every runner newer than the
        // minimum — that is, every correct installation — with a hint that
        // reads like a problem.
        badge(
          rv === 0 ? `Runner: unknown` : rv < RUNNER_MIN_VERSION ? `Runner v${rv} (needs v${RUNNER_MIN_VERSION})` : `Runner v${rv}`,
          "runner"
        );
        badge(
          this.plugin.lastCompanionVersion !== ""
            ? `Companion ${this.plugin.lastCompanionVersion}`
            : "Companion: not seen yet",
          "companion"
        );
        for (const a of advice) {
          const box = el.createDiv({ cls: "ngb-warning" });
          box.createDiv({ text: a.text });
          const btns = box.createDiv({ cls: "ngb-add-row" });
          const button = (text: string, cta: boolean, onClick: () => void) => {
            const b = btns.createEl("button", { text, cls: cta ? "mod-cta" : undefined });
            b.addEventListener("click", onClick);
          };
          if (a.part === "runner") {
            button("Copy command & open Termux", true, () => this.plugin.copyCommandAndOpenTermux());
            if (a.kind === "newer-half") button("Open latest release", false, () => this.plugin.openLatestRelease());
          } else if (a.part === "companion") {
            button("Update companion app", true, () => this.plugin.openLatestRelease());
            if (a.kind === "update-available" && this.plugin.stayOnCompanionAvailable()) {
              button("Stay on this companion…", false, () => this.plugin.cmdStayOnCompanion());
            }
          } else {
            // The plugin is the older half (a newer companion answered): both
            // exits of the choice. The matching APK is a copied link, never an
            // opened one — Custom Tab downloads get discarded.
            button("Open latest release", true, () => this.plugin.openLatestRelease());
            if (a.kind === "newer-half") {
              button("Copy link to the matching APK", false, () => this.plugin.copyMatchingApkLink());
            }
          }
        }
      }),
    ];
  }

  private setupItems(s: DeviceLocalSettings): SettingDefinition[] {
    const localCmd = this.plugin.installCommandLocal();
    return [
      // A dedicated class (not <pre>) so long URLs wrap on narrow phone screens.
      block("Install command", (el) => {
        const cmdBox = el.createDiv({ cls: "ngb-cmd" });
        cmdBox.setText(this.plugin.installCommand());
        cmdBox.setAttribute("aria-label", "Install command");
      }),
      {
        name: "Install command",
        desc:
          "Install Termux (F-Droid) and the Git Bridge Companion app, then paste this single command into Termux. " +
          "It finds your vault automatically, installs git/jq/openssh, links storage, enables the companion trigger, " +
          "verifies the repo and pairs with this plugin — no manual token copying. The Companion app has a " +
          "'Set up Termux' button that copies this command and opens Termux for you.",
        // Copying alone left the user to find Termux themselves; the plugin
        // method copies, notices, and brings Termux forward (or the way to GET
        // it when the companion reports it missing).
        action: () => this.plugin.copyCommandAndOpenTermux(),
      },
      ...(localCmd === null
        ? []
        : [
            block("Offline install command", (el) => {
              const localBox = el.createDiv({ cls: "ngb-cmd" });
              localBox.setText(localCmd);
              localBox.setAttribute("aria-label", "Offline install command");
            }),
            {
              name: "Install without a network",
              desc:
                "The Termux scripts ship inside this plugin's folder, so the vault on this device already " +
                "carries them. This command installs and updates the runner from there — no GitHub, no " +
                "downloads. Useful on a bad connection, and when the runner is behind after the plugin " +
                "arrived through vault sync.",
              action: () => this.plugin.copyLocalCommandAndOpenTermux(),
            } satisfies SettingDefinition,
          ]),
      {
        name: "Setup guide",
        desc: "The three parts in order (Termux, companion app, one pasted command) with the current state of this device and one-tap actions.",
        action: () => this.plugin.openSetupGuide("Setup guide."),
      },
      {
        name: "Companion app checklist",
        desc:
          "Opens the Git Bridge Companion setup screen: Termux detected, 'Run commands in Termux' " +
          "permission, and a live round-trip test. Open it whenever operations time out.",
        action: () => void this.plugin.openCompanionSetup(),
      },
      {
        name: "Enable on this device",
        desc: "Master switch. Off by default on every new device.",
        control: { type: "toggle", key: "device.enabledOnThisDevice" },
      },
      {
        name: "Termux integration",
        desc: "Allow this plugin to queue requests for the Termux runner.",
        control: { type: "toggle", key: "device.termuxIntegrationEnabled" },
      },
      // A password input has no declarative form; the row is drawn by hand so
      // the token is never shown in clear on a screen somebody else can see.
      {
        name: "Pairing token",
        desc:
          "Paste the token printed by the Termux installer. " +
          "It authenticates requests between this plugin and the runner. Stored locally; never logged.",
        aliases: ["token", "pairing"],
        render: (setting: Setting) => {
          setting.addText((t) => {
            t.inputEl.type = "password";
            t.setPlaceholder("token from installer")
              .setValue(this.plugin.deviceSettings.authToken)
              .onChange((v) => void this.setControlValue("device.authToken", v));
          });
        },
      },
      {
        name: "Profile for this vault",
        desc: s.profileId
          ? `Termux serves this vault as ${s.profileId}. Every vault on the device has its own profile and its own token; one runner drains them all.`
          : "This vault has no Termux profile yet. Pairing asks the runner for one; it generates the token in Termux and answers with it. Pairing is also where the repository's place is decided: the vault itself, or one folder inside it (use Set up repository for that).",
        aliases: ["pair", "pairing"],
        action: () => void this.plugin.cmdPairThisVault(),
      },
      {
        name: "Repository for this vault",
        desc:
          "Create a repository here or in one folder of the vault, clone an existing one, or change the remote. " +
          "Everything that needs a password stays in Termux; this only does the parts that carry no secret.",
        aliases: ["clone", "init", "remote", "set up repository"],
        action: () => void this.plugin.cmdSetupRepository(),
      },
      // Only shown when there is something to show: a repository set aside by
      // a re-clone. It is invisible otherwise, and a permanent empty row would
      // just be a question nobody has. The listing is async, so the row draws
      // itself hidden and appears when the manifests have been read.
      {
        name: "Previous repository copies",
        desc: "Checking…",
        searchable: false,
        render: (setting: Setting) => {
          setting.settingEl.hide();
          void (async () => {
            const repos = await this.plugin.listPreviousRepos();
            if (repos.length === 0) return;
            const total = repos.reduce((n, r) => n + r.sizeKb, 0);
            setting.setDesc(
              `${repos.length === 1 ? "One earlier repository was" : `${repos.length} earlier repositories were`} ` +
                `set aside by a re-clone and still use ${formatSize(total)}. Their history is intact; deleting is final.`
            );
            setting.addButton((b) =>
              b.setButtonText("Review").onClick(() => this.plugin.showPreviousRepoModal(repos, "Previous repository copies"))
            );
            setting.settingEl.show();
          })();
        },
      },
      {
        name: "Repository path (informational)",
        desc: "The repo path as seen from Termux, e.g. /storage/emulated/0/Documents/Vault. The runner config is authoritative.",
        control: { type: "text", key: "device.repoPathHint", placeholder: "/storage/emulated/0/…" },
      },
    ];
  }

  // ------------------------------------------------- the four rule managers

  private rulesItems(): SettingGroupItem[] {
    return [
      note(
        "Protected paths, sparse exclusions, .gitignore and .git/info/exclude, each on a page of its own because the lists can get long. A page shows how many entries it holds."
      ),
      this.protectedPathsPage(),
      this.sparsePage(),
      this.gitignorePage(),
      this.excludePage(),
    ];
  }

  private protectedPathsPage(): SettingDefinitionPage {
    const cur = () => this.plugin.deviceSettings;
    return {
      type: "page",
      name: "Protected paths",
      desc: "Paths the safety gate never lets a commit touch: the manual list plus, by default, everything the repository's sparse rules hide.",
      displayValue: () => `${this.plugin.effectiveProtectedPaths().length} effective`,
      items: [
        {
          name: "Auto-protect sparse exclusions",
          desc: "Paths hidden by the repository's own sparse rules join the protected set automatically (read from git on every status).",
          control: { type: "toggle", key: "device.autoProtectSparse" },
        },
        note(
          !cur().autoProtectSparse
            ? "Auto-protect is off: only the manual paths below are protected."
            : cur().derivedProtectedPaths.length
              ? `Derived from sparse checkout: ${cur().derivedProtectedPaths.join(", ")}`
              : "Derived from sparse checkout: none yet (run Status once to read them from git)."
        ),
        {
          type: "list",
          heading: "Manual paths",
          emptyState: "No manual paths. Add a folder that must never be committed as a deletion from this device.",
          items: cur().protectedPaths.map((p) => ({ name: p })),
          onDelete: (index) => {
            const p = cur().protectedPaths[index];
            if (p === undefined) return;
            void this.plugin
              .updateDeviceSettings({ protectedPaths: cur().protectedPaths.filter((x) => x !== p) })
              .then(() => this.update());
          },
          addItem: {
            name: "Add manual path",
            action: () =>
              this.promptEntry("Add a protected path", "Folder/Subfolder", "Protect", async (v) => {
                const res = validateProtectedPaths([...cur().protectedPaths, v]);
                if (!res.ok) {
                  new Notice(`Rejected "${res.offending}": ${res.reason}`);
                  return;
                }
                await this.plugin.updateDeviceSettings({ protectedPaths: res.normalized });
                this.update();
              }),
          },
        },
      ],
    };
  }

  private sparsePage(): SettingDefinitionPage {
    const sparse = this.plugin.lastKnownSparse();
    const excls = this.plugin.deviceSettings.derivedProtectedPaths;
    return {
      type: "page",
      name: "Sparse checkout exclusions",
      desc: "Paths hidden from THIS device's working tree (non-cone sparse checkout, applied by git in Termux). Hiding never deletes anything from the repository; removing an exclusion materializes the files again.",
      displayValue: () => (this.plugin.lastKnownSparse() ? `${this.plugin.deviceSettings.derivedProtectedPaths.length} hidden` : "run Status to load"),
      items: [
        ...(sparse && sparse.enabled === false ? [note("Sparse checkout is not enabled in this repository. Hiding the first path enables it.")] : []),
        {
          type: "list",
          heading: "Hidden on this device",
          emptyState: sparse ? "Nothing is hidden on this device." : "Run Status once to read the sparse rules from git.",
          items: excls.map((p) => ({ name: p })),
          onDelete: (index) => {
            const p = excls[index];
            if (p !== undefined) void this.plugin.cmdSparseExclude(p, false).then(() => this.update());
          },
          addItem: {
            name: "Hide a path on this device",
            action: () =>
              this.promptEntry("Hide a path on this device", "Folder/Subfolder", "Hide", (v) =>
                this.plugin.cmdSparseExclude(v, true).then(() => this.update())
              ),
          },
        },
      ],
    };
  }

  private gitignorePage(): SettingDefinitionPage {
    // The cached file, as it rode along with the last status (runner v18) or
    // came back from the last change — no round trip to open the page. The
    // "Reload from Termux" row is for a file changed outside the plugin.
    const entries = parseIgnoreEntries(this.plugin.currentGitignoreLines().join("\n"));
    return {
      type: "page",
      name: ".gitignore",
      desc: "A tracked file: entries apply to ALL devices once the change is committed and synced.",
      displayValue: () => `${parseIgnoreEntries(this.plugin.currentGitignoreLines().join("\n")).length} entries · shared`,
      items: [
        {
          type: "list",
          heading: "Entries",
          emptyState: "No entries, or the file has not been read yet — Reload from Termux reads it.",
          items: entries.map((e) => ({ name: e })),
          onDelete: (index) => {
            const e = entries[index];
            if (e !== undefined) void this.plugin.gitignoreRemove(e).then(() => this.update());
          },
          addItem: {
            name: "Add an entry",
            action: () =>
              this.promptEntry("Add to .gitignore", "pattern, e.g. /Scratch/ or *.tmp", "Add", (v) =>
                this.plugin.gitignoreAdd(v).then(() => this.update())
              ),
          },
        },
        {
          name: "Reload from Termux",
          desc: "Read the file again through the runner (one round trip). The list above is the copy the last status brought.",
          action: () => void this.plugin.loadGitignore().then(() => this.update()),
        },
      ],
    };
  }

  private excludePage(): SettingDefinitionPage {
    const entries = this.plugin.currentExcludeLines();
    return {
      type: "page",
      name: ".git/info/exclude",
      desc: "Local ignore rules stored inside .git — they never reach the remote or other devices. Managed through the Termux runner.",
      displayValue: () => `${this.plugin.currentExcludeLines().length} entries · this clone only`,
      items: [
        {
          type: "list",
          heading: "Entries",
          emptyState: "No entries loaded. Load from Termux reads the file.",
          items: entries.map((e) => ({ name: e })),
          onDelete: (index) => {
            const e = entries[index];
            if (e === undefined) return;
            const path = e.replace(/^\//, "").replace(/\/$/, "");
            void this.plugin.cmdExcludeChange(path, false).then(() => this.update());
          },
          addItem: {
            name: "Add to exclude",
            action: () =>
              this.promptEntry("Add to .git/info/exclude", "Folder/Subfolder", "Exclude", (v) =>
                this.plugin.cmdExcludeChange(v, true).then(() => this.update())
              ),
          },
        },
        {
          name: "Load from Termux",
          desc: "Read the current file through the runner (one round trip).",
          action: () => void this.plugin.refreshExcludeList().then(() => this.update()),
        },
      ],
    };
  }

  /** One-line text prompt for the add rows; `onDone` may be async. */
  private promptEntry(
    title: string,
    placeholder: string,
    submitLabel: string,
    onDone: (value: string) => void | Promise<void>
  ): void {
    new CommitMessageModal(this.app, { title, placeholder, submitLabel, initial: "" }, async (v) => {
      if (v === null) return;
      const trimmed = v.trim();
      if (trimmed !== "") await onDone(trimmed);
    }).open();
  }

  // ------------------------------------------------------------------ groups

  private menuItems(): SettingDefinition[] {
    return [
      note("Which Git entries appear on right click / long tap of a file or folder. Stage/Unstage is always shown while the bridge is enabled."),
      {
        name: "Show .gitignore commands",
        desc: "Add to / remove from .gitignore (shared, synced through git).",
        control: { type: "toggle", key: "device.menuGitignore" },
      },
      {
        name: "Show sparse commands",
        desc: "Hide on this device / show again (sparse checkout exclusions).",
        control: { type: "toggle", key: "device.menuSparse" },
      },
      {
        name: "Show .git exclude commands",
        desc: "Add to / remove from .git/info/exclude (this clone only, never synced).",
        control: { type: "toggle", key: "device.menuExclude" },
      },
      {
        name: "Rows shown per group",
        desc:
          "How many rows the status panel draws in each group before it offers the rest. " +
          "Every group can be long at once, and a folder of a few thousand new files arrives " +
          "as one Git entry that expands into a row each. The group's count always states the " +
          "true total. Device-local: what it costs is render time here.",
        control: {
          type: "dropdown",
          key: "device.rowsPerGroup",
          options: Object.fromEntries(ROWS_PER_GROUP_CHOICES.map((n) => [String(n), String(n)])),
        },
      },
      {
        name: "Delete new files permanently",
        desc:
          "Off: deleting untracked files moves them to Obsidian's trash (.trash in the vault), " +
          "which is the only way back for a file Git never recorded. On: they are deleted from " +
          "disk. Device-local, because what it decides is whether .trash grows on this device.",
        control: { type: "toggle", key: "device.deleteUntrackedPermanently" },
      },
    ];
  }

  private commitMessageItems(): SettingDefinition[] {
    const templates = this.plugin.sharedPrefs.commitTemplates;
    // The list itself lives in ITS OWN modal (a list of any length stopped
    // fitting this page — the user's report); the row here shows the count
    // and opens it.
    const templateIo = {
      get: () => this.plugin.sharedPrefs.commitTemplates,
      set: (next: string[]) => this.plugin.setSharedPref({ commitTemplates: next }),
      onChanged: () => this.update(),
    };
    const slot = (name: string, desc: string, key: "syncOnCloseTemplate" | "autoCommitTemplate" | "syncTemplate"): SettingDefinition => {
      const cur = this.plugin.deviceSettings[key];
      const options: Record<string, string> = {};
      if (!templates.includes(cur)) options[cur] = `${cur} (not in the list)`;
      for (const t of templates) options[t] = t;
      options[NEW_TEMPLATE] = "+ New template…";
      return { name, desc, control: { type: "dropdown", key: `slot.${key}`, options } };
    };
    return [
      {
        name: "Message templates",
        desc:
          `${templates.length} template(s). The commit window and ` +
          "the three automatic triggers below pick from this list; {{date}} becomes the current " +
          "date and time using the format below. Shared across devices (data.json).",
        action: () => new TemplateManagerModal(this.app, templateIo).open(),
      },
      slot(
        "Sync-on-close message",
        "What the fire-and-forget sync commits with when Obsidian goes to the background. Device-local.",
        "syncOnCloseTemplate"
      ),
      slot("Automatic sync message", "What the periodic sync and sync-on-open commit with. Device-local.", "autoCommitTemplate"),
      slot(
        "Sync message",
        "What the Sync command commits with when you did not type a message. A merge in progress always uses git's own prepared merge message instead. Device-local.",
        "syncTemplate"
      ),
      {
        name: "{{date}} format",
        desc:
          "Tokens: YYYY, YY, MM, DD, HH, mm, ss (the same spelling obsidian-git uses). " +
          "Local time on each device. Shared across devices.",
        control: { type: "text", key: "shared.commitDateFormat", placeholder: DEFAULT_COMMIT_DATE_FORMAT },
      },
      {
        name: "Recently typed messages to remember",
        desc:
          "The commit window offers this many of your recent messages beside the templates. " +
          "0 turns the list off. The list is typing history and stays on this device.",
        control: { type: "number", key: "device.recentCommitMessagesMax", min: 0, max: 50, step: 1 },
      },
    ];
  }

  private notificationItems(): SettingGroupItem[] {
    const colorFields: Array<{ key: keyof NgbColorSet; name: string; desc: string }> = [
      { key: "diffAddBg", name: "Added line background", desc: "Diff pane" },
      { key: "diffAddHl", name: "Added characters", desc: "Diff pane, intra-line highlight" },
      { key: "diffDelBg", name: "Deleted line background", desc: "Diff pane" },
      { key: "diffDelHl", name: "Deleted characters", desc: "Diff pane, intra-line highlight" },
      { key: "conflictLocalBg", name: "LOCAL side background", desc: "Conflict pane (yours)" },
      { key: "conflictRemoteBg", name: "REMOTE side background", desc: "Conflict pane (theirs)" },
    ];
    // Colours: one toggle guards the whole thing. While it is off the panes
    // use the theme's own values and there is nothing to configure, so the two
    // pages are hidden. Light and dark are separate pages, because one set of
    // hex values cannot be legible in both.
    const colorPage = (mode: "dark" | "light"): SettingDefinitionPage => ({
      type: "page",
      name: mode === "dark" ? "Colours (dark theme)" : "Colours (light theme)",
      visible: () => this.plugin.sharedPrefs.customColors,
      items: [
        ...colorFields.map(
          (f): SettingDefinition => ({
            name: f.name,
            desc: f.desc,
            control: { type: "color", key: `color.${mode}.${f.key}` },
          })
        ),
        {
          name: "Reset to the defaults",
          desc: "Restores the values this plugin ships with for this theme.",
          action: () => {
            void this.plugin
              .setSharedPref({ [mode === "dark" ? "colorsDark" : "colorsLight"]: { ...DEFAULT_COLORS[mode] } })
              .then(() => this.update());
          },
        },
      ],
    });
    return [
      {
        name: "Show a result window on success",
        desc:
          "Off: successful operations only update the status panel (and the log). " +
          "Failures, conflicts and safety blocks are always shown as a window.",
        control: { type: "toggle", key: "device.showSuccessModals" },
      },
      {
        name: "Short messages",
        desc:
          "Where brief informational messages go. Note: a plugin cannot raise native Android " +
          "toasts, so the choices are Obsidian's own notice, the status panel, or the log only.",
        control: {
          type: "dropdown",
          key: "device.notificationMode",
          options: { notice: "Obsidian notice (toast)", "status-only": "Status panel only", "log-only": "Operation log only" },
        },
      },
      {
        name: "Name the file above the Git menu",
        desc:
          "Show the folder and the file name at the top of the Git context menu, above the entries. " +
          "On by default: a panel row truncates the name and the file explorer shows no path at all, " +
          "so without it the menu can offer 'Discard changes' over a file it never identifies. " +
          "A deep path costs two or three rows. Cosmetic and shared across devices (stored in data.json).",
        control: { type: "toggle", key: "shared.showMenuHeader" },
      },
      {
        name: "Spell the change out in the status panel",
        desc:
          "Show 'modified', 'conflicted' or 'deleted' beside a file name. On by default. " +
          "Mobile only — on desktop the tooltip carries it — and the change letter at the " +
          "end of the row states it either way, so turning this off gives long names more room. " +
          "Cosmetic and shared across devices (stored in data.json).",
        control: { type: "toggle", key: "shared.showChangeWords" },
      },
      {
        name: "Git signs in the file explorer",
        desc:
          "Mark changed files in Obsidian's file explorer with a letter (M modified, A added, D deleted, " +
          "U untracked, ! conflict) and every folder holding one with a dot. On by default. " +
          "Taken from the last status, so it is as current as the Git panel. " +
          "Cosmetic and shared across devices (stored in data.json).",
        control: { type: "toggle", key: "shared.showExplorerSigns" },
      },
      {
        name: "Open the output panel for long operations",
        desc:
          "Show what Termux is saying, by itself, once an operation has run for 30 seconds. " +
          "Off by default: a panel that appears on its own takes a slot in the sidebar while " +
          "you are reading something else. Either way, tapping the state line in the Git panel " +
          "(the one that counts the seconds) opens it. Cosmetic and shared across devices.",
        control: { type: "toggle", key: "shared.openOutputForLongOps" },
      },
      {
        name: "Wrap long lines",
        desc:
          "Wrap lines in the diff and conflict panes instead of scrolling horizontally. " +
          "In the conflict pane the line numbers and the Keep buttons stay pinned to " +
          "the left edge while the text scrolls, so no control can end up out of reach. " +
          "Cosmetic and shared across devices (stored in data.json).",
        control: { type: "toggle", key: "shared.wrapDiffLines" },
      },
      {
        name: "Show invisible characters in diffs",
        desc:
          "Render whitespace as glyphs in the diff pane: · space, → tab, ␍ CR. " +
          "Makes leading/trailing whitespace visible. Note: copying from the " +
          "diff then copies the glyphs, not the original whitespace.",
        control: { type: "toggle", key: "shared.showInvisibles" },
      },
      {
        name: "Compare changed lines by",
        desc:
          "What gets highlighted inside a line that changed, in the diff pane, " +
          "the file history and the conflict pane. Words suit prose: 'brown' " +
          "becoming 'red' is one word replaced. Characters suit paths, " +
          "identifiers and numbers, where one letter is the whole edit.",
        control: { type: "dropdown", key: "shared.inlineDiffUnit", options: { word: "Words", char: "Characters" } },
      },
      {
        name: "Keep line selection when opening another file",
        desc:
          "The diff pane is reused for every diff. Off: opening another file " +
          "leaves line-selection mode, so a diff never arrives already in it. " +
          "On: the mode stays. The ticked lines are dropped either way — they " +
          "point at lines of the diff that was on screen.",
        control: { type: "toggle", key: "shared.keepLineSelection" },
      },
      {
        name: "Show raw conflict markers",
        desc:
          "In the conflict pane: show the file's <<<<<<< / ======= / >>>>>>> " +
          "lines as they really are, with the side labels and Keep buttons on " +
          "separate rows. Off: the markers stay hidden under those rows.",
        control: { type: "toggle", key: "shared.showConflictMarkers" },
      },
      {
        name: "Custom colours in the diff and conflict panes",
        desc:
          "Off: the panes follow your theme. On: the colours on the two pages below are used. " +
          "Cosmetic and shared across devices (stored in data.json).",
        control: { type: "toggle", key: "shared.customColors" },
      },
      colorPage("dark"),
      colorPage("light"),
      {
        name: "Diff size limit",
        desc:
          "How much of one diff the pane builds at a time. The runner keeps whole " +
          "hunks within the limit and never a partial one, and the pane says how " +
          "many it left out, with a one-tap way to fetch the rest for that diff " +
          "alone. Every diff line costs about a dozen elements to draw, so this " +
          "is a per-phone decision and stays device-local.",
        control: {
          type: "dropdown",
          key: "device.diffLimitKb",
          options: Object.fromEntries(DIFF_LIMIT_CHOICES_KB.map((kb) => [String(kb), kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`])),
        },
      },
      {
        name: "Auto-refresh status (seconds)",
        desc:
          "While the status panel is open, run a status this often to pick up " +
          "outside changes. 0 disables it. Each refresh wakes Termux — " +
          "consider battery before choosing a small interval. Device-local.",
        control: { type: "number", key: "device.statusRefreshSeconds", min: 0, step: 1, placeholder: "0" },
      },
    ];
  }

  private footprintItems(): SettingDefinition[] {
    // Both toggles REFLECT the repository's actual state, reported by the
    // runner with every status; they move only after a change is confirmed and
    // the runner answers ok. Before the first status of the session the state
    // is simply unknown — the toggles still press, and the command reads the
    // state itself before asking anything (ensureFootprintState). They used to
    // be disabled until some other action happened to fetch a status, which on
    // a fresh launch read as buttons that do not work.
    const fp = this.plugin.footprintState();
    const fpNote = !this.plugin.footprintAvailable()
      ? "Needs runner v14 on this device. Update the runner in Termux, then run Status once."
      : fp === null
        ? "The repository's state has not been read yet this session — a toggle checks it first, then asks to confirm."
        : "";
    return [
      ...(fpNote === "" ? [] : [note(fpNote)]),
      {
        name: "Shallow history",
        desc:
          "Keep only the newest commits on this device; the remote and your other " +
          "devices keep everything. The history panels here reach only what " +
          "stays, and enabling this also clears this device's reflog — without " +
          "that the old commits stay pinned and nothing is freed. Turning it " +
          "off downloads the full history back. Space returns after Clean up " +
          "repository storage.",
        control: { type: "toggle", key: "footprint.shallow", disabled: () => !this.plugin.footprintAvailable() },
      },
      {
        name: "Shallow depth",
        desc: "How many newest commits stay when shallow history is enabled. Takes effect on the next enable.",
        control: { type: "number", key: "device.shallowDepth", min: 1, max: 100000, step: 1, placeholder: "100" },
      },
      {
        name: "Partial clone (blob:none)",
        desc:
          "Fetch file content on demand instead of holding all of it. With sparse " +
          "checkout the hidden files' content is never downloaded at all — but " +
          "'Show again' and old file versions then need the network. Turning it " +
          "off downloads everything back first. Run Clean up repository storage " +
          "after enabling to shed content that is already downloaded.",
        control: { type: "toggle", key: "footprint.partial", disabled: () => !this.plugin.footprintAvailable() },
      },
    ];
  }

  private automaticItems(): SettingDefinition[] {
    return [
      {
        name: "When Obsidian opens",
        desc:
          "Pull brings work in and changes nothing you have not seen. Sync also commits and pushes, " +
          "so on every launch it publishes whatever is lying around — including the workspace file " +
          "Obsidian rewrites just by being opened. Nothing is the default.",
        control: {
          type: "dropdown",
          key: "device.onOpenAction",
          options: { nothing: "Nothing", pull: "Pull", sync: "Sync (commit and push too)" },
        },
      },
      {
        name: "Sync when Obsidian goes to the background",
        desc: "Queues a sync the moment Obsidian starts losing the screen, while Android still lets it reach Termux. If that moment is missed, Android holds the trigger until you come back and the sync runs then, if that is within about 13 minutes; later than that it is dropped. Nothing is queued when there is nothing local to send.",
        control: { type: "toggle", key: "device.autoSyncOnClose" },
      },
      {
        name: "Periodic sync while Obsidian is open (minutes, 0 = off)",
        desc: "Every tick first asks what the plugin already knows — edits since the last sync, uncommitted changes, commits the remote does not have. A tick with nothing local to send is skipped without contacting Termux.",
        control: { type: "number", key: "device.periodicSyncMinutes", min: 0, step: 1 },
      },
      {
        name: "Minimum interval between automatic syncs (minutes)",
        desc: "A debounce between any two automatic syncs (periodic, on open, on close). Lower it to let them run closer together.",
        control: { type: "number", key: "device.minAutoSyncIntervalMinutes", min: 1, step: 1 },
      },
      {
        name: "Only sync on Wi-Fi (best effort)",
        desc: "Uses the WebView network API when available; skipped silently when the API is missing.",
        control: { type: "toggle", key: "device.wifiOnly" },
      },
      {
        name: "Skip automatic sync when battery is low (best effort)",
        control: { type: "toggle", key: "device.skipOnLowBattery" },
      },
    ];
  }

  private advancedItems(): SettingDefinition[] {
    return [
      {
        name: "Operation log",
        desc:
          "Recent bridge operations (URLs redacted). Lives here since the " +
          "panel strip slot went to the tree/list toggle; also available as " +
          "the 'Open operation log' command.",
        action: () => this.plugin.openOperationLog(),
      },
      {
        name: "Operation timeout (seconds)",
        desc:
          `How long to wait for the runner before giving up. Default ${DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds}. ` +
          `Fetch, pull, push and sync never get less than ${MIN_NETWORK_TIMEOUT_SECONDS}s whatever is set here, ` +
          "and cloning has its own much larger budget: those wait for a network, not for git. " +
          "Giving up does not stop the runner — it finishes what it started, and a result that lands " +
          "later is picked up — so a short value buys nothing but alarming windows.",
        control: { type: "number", key: "device.opTimeoutSeconds", min: 10, max: 3600, step: 1 },
      },
      {
        name: "Companion intent URI template",
        desc: 'Advanced. "{id}" is replaced by the request id; change it only if the companion app uses a custom scheme.',
        control: { type: "text", key: "device.companionUriTemplate", placeholder: "nativegitbridge://run?id={id}" },
      },
      {
        name: "Reset device-local settings",
        desc: "Restores all settings on this device to defaults. The vault and repository are not touched.",
        action: () => {
          new ConfirmModal(
            this.app,
            {
              title: "Reset device-local settings?",
              body: [
                "This resets Native Git Bridge settings on this device only.",
                "The repository, the vault, and other devices are not affected.",
              ],
              confirmLabel: "Reset settings",
              danger: true,
            },
            async (confirmed) => {
              if (!confirmed) return;
              await this.plugin.resetDeviceSettings();
              this.update();
            }
          ).open();
        },
      },
    ];
  }
}

// ------------------------------------------------------------------ helpers

/** The dropdown sentinel that means "make a new template and pick it". */
const NEW_TEMPLATE = "__new__";

function splitKey(key: string): [string, string] {
  const i = key.indexOf(".");
  return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

/** An integer within [min, max], or the fallback when the input is not a number. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * A row that is a paragraph, not a setting: the notes between sections. The
 * name is what the settings search would show, so it is kept out of search.
 */
function note(text: string): SettingDefinition {
  return {
    name: "",
    searchable: false,
    render: (setting: Setting) => {
      setting.settingEl.empty();
      setting.settingEl.addClass("ngb-setting-block");
      setting.settingEl.createEl("p", { cls: "ngb-settings-note", text });
    },
  };
}

/**
 * A block of our own DOM in the place of a setting row — the version badges,
 * a command box. The Setting's info/control layout is emptied and the block
 * fills the row; `.ngb-setting-block` drops the flex layout the row would
 * otherwise impose.
 */
function block(name: string, draw: (el: HTMLElement) => void): SettingDefinition {
  return {
    name,
    searchable: false,
    render: (setting: Setting) => {
      setting.settingEl.empty();
      setting.settingEl.addClass("ngb-setting-block");
      draw(setting.settingEl);
    },
  };
}
