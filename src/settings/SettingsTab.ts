import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type NativeGitBridgePlugin from "../main";
import { validateProtectedPaths } from "./pathValidation";
import {
  DEFAULT_DEVICE_SETTINGS,
  DIFF_LIMIT_CHOICES_KB,
  ROWS_PER_GROUP_CHOICES,
} from "./DeviceLocalSettingsStore";
import { ConfirmModal } from "../ui/modals";
import { MIN_NETWORK_TIMEOUT_SECONDS, RUNNER_MIN_VERSION } from "../constants";
import { DEFAULT_COLORS, type NgbColorSet } from "../ui/colors";
import { formatSize } from "../git/previousRepos";
import type { InlineDiffUnit } from "../git/inlineDiff";
import { Notice } from "obsidian";

export class NativeGitBridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NativeGitBridgePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.deviceSettings;

    // The bridge (companion app + Termux RUN_COMMAND) exists only on Android.
    // Elsewhere: explain, and show no settings at all — every one of them is
    // device-local, so configuring them on desktop could never do anything.
    if (!Platform.isAndroidApp) {
      containerEl.createDiv({
        cls: "ngb-warning",
        text:
          "Native Git Bridge works on Android only: it delegates every Git operation " +
          "to the real git binary inside Termux, triggered through a companion app. " +
          "There is nothing to configure on this device — on desktop, use git directly " +
          "or the obsidian-git plugin. Settings appear when you open this tab on your " +
          "Android device (they are stored per device and never synced through the vault).",
      });
      return;
    }

    // Versions first: three parts update independently, so "which versions do
    // I actually have here" is the first question when something misbehaves.
    const advice = this.plugin.versionAdvice();
    const stale = (part: "plugin" | "companion" | "runner") => advice.some((a) => a.part === part);
    const badge = (text: string, part: "plugin" | "companion" | "runner") =>
      ver.createSpan({
        cls: stale(part) ? "ngb-version-badge ngb-version-stale" : "ngb-version-badge",
        text,
      });

    const ver = containerEl.createDiv({ cls: "ngb-version-row" });
    badge(`Plugin ${this.plugin.manifest.version}`, "plugin");
    const rv = this.plugin.lastRunnerVersion;
    // "needs vN" only when it actually differs — otherwise it reads like a problem.
    badge(
      rv === 0
        ? `Runner: unknown`
        : rv === RUNNER_MIN_VERSION
          ? `Runner v${rv}`
          : `Runner v${rv} (needs v${RUNNER_MIN_VERSION})`,
      "runner"
    );
    badge(
      this.plugin.lastCompanionVersion !== ""
        ? `Companion ${this.plugin.lastCompanionVersion}`
        : "Companion: not seen yet",
      "companion"
    );

    for (const a of advice) {
      const box = containerEl.createDiv({ cls: "ngb-warning" });
      box.createDiv({ text: a.text });
      const btns = box.createDiv({ cls: "ngb-add-row" });
      if (a.part === "runner") {
        const b = btns.createEl("button", { text: "Copy command & open Termux", cls: "mod-cta" });
        b.addEventListener("click", () => this.plugin.copyCommandAndOpenTermux());
      } else {
        const b = btns.createEl("button", { text: "Open latest release", cls: "mod-cta" });
        b.addEventListener("click", () => this.plugin.openLatestRelease());
      }
    }

    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text:
        "All settings below are stored on this device only (never synced through the vault), " +
        "so each device can be enabled and configured independently.",
    });
    if (this.plugin.store.isVolatile) {
      containerEl.createDiv({
        cls: "ngb-warning",
        text:
          "Device-local storage is unavailable; settings will not survive an app restart. " +
          "Check available storage / WebView state.",
      });
    }

    new Setting(containerEl).setName("Setup (one line in Termux)").setHeading();
    const cmd = this.plugin.installCommand();
    // A dedicated class (not <pre>) so long URLs wrap on narrow phone screens.
    const cmdBox = containerEl.createDiv({ cls: "ngb-cmd" });
    cmdBox.setText(cmd);
    cmdBox.setAttribute("aria-label", "Install command");
    new Setting(containerEl)
      .setName("Install command")
      .setDesc(
        "Install Termux (F-Droid) and the Git Bridge Companion app, then paste this single command into Termux. " +
          "It finds your vault automatically, installs git/jq/openssh, links storage, enables the companion trigger, " +
          "verifies the repo and pairs with this plugin — no manual token copying. The Companion app has a " +
          "'Set up Termux' button that copies this command and opens Termux for you."
      )
      .addButton((b) =>
        b.setButtonText("Copy command").setCta().onClick(() => { void (async () => {
          await navigator.clipboard.writeText(cmd);
          new Notice("Install command copied.");
        })(); })
      );

    const localCmd = this.plugin.installCommandLocal();
    if (localCmd !== null) {
      const localBox = containerEl.createDiv({ cls: "ngb-cmd" });
      localBox.setText(localCmd);
      localBox.setAttribute("aria-label", "Offline install command");
      new Setting(containerEl)
        .setName("Install without a network")
        .setDesc(
          "The Termux scripts ship inside this plugin's folder, so the vault on this device already " +
            "carries them. This command installs and updates the runner from there — no GitHub, no " +
            "downloads. Useful on a bad connection, and when the runner is behind after the plugin " +
            "arrived through vault sync."
        )
        .addButton((b) =>
          b.setButtonText("Copy offline command").onClick(() => { void (async () => {
            await navigator.clipboard.writeText(localCmd);
            new Notice("Offline install command copied.");
          })(); })
        );
    }

    new Setting(containerEl)
      .setName("Setup guide")
      .setDesc(
        "The three parts in order (Termux, companion app, one pasted command) with the current state of this device and one-tap actions."
      )
      .addButton((b) =>
        b.setButtonText("Open setup guide").setCta().onClick(() => this.plugin.openSetupGuide("Setup guide."))
      );

    new Setting(containerEl)
      .setName("Companion app checklist")
      .setDesc(
        "Opens the Git Bridge Companion setup screen: Termux detected, 'Run commands in Termux' " +
          "permission, and a live round-trip test. Open it whenever operations time out."
      )
      .addButton((b) =>
        b.setButtonText("Open companion setup").onClick(() => void this.plugin.openCompanionSetup())
      );

    new Setting(containerEl)
      .setName("Enable on this device")
      .setDesc("Master switch. Off by default on every new device.")
      .addToggle((t) =>
        t.setValue(s.enabledOnThisDevice).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ enabledOnThisDevice: v });
          // Structure changes (the whole tab is hidden when disabled), so a
          // full refresh is needed. Prefer update(): on 1.13+ re-calling the
          // deprecated display() does not refresh declarative settings.
          this.refreshTab();
        })(); })
      );

    new Setting(containerEl)
      .setName("Termux integration")
      .setDesc("Allow this plugin to queue requests for the Termux runner.")
      .addToggle((t) =>
        t.setValue(s.termuxIntegrationEnabled).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ termuxIntegrationEnabled: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Pairing token")
      .setDesc(
        "Paste the token printed by the Termux installer. " +
          "It authenticates requests between this plugin and the runner. Stored locally; never logged."
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("token from installer")
          .setValue(s.authToken)
          .onChange((v) => { void (async () => {
            await this.plugin.updateDeviceSettings({ authToken: v.trim() });
          })(); });
      });

    new Setting(containerEl)
      .setName("Profile for this vault")
      .setDesc(
        s.profileId
          ? `Termux serves this vault as ${s.profileId}. Every vault on the device has its own profile and its own token; one runner drains them all.`
          : "This vault has no Termux profile yet. Pairing asks the runner for one; it generates the token in Termux and answers with it."
      )
      .addButton((b) =>
        b
          .setButtonText(s.profileId ? "Pair again" : "Pair this vault")
          .onClick(() => void this.plugin.cmdPairThisVault())
      );

    new Setting(containerEl)
      .setName("Repository for this vault")
      .setDesc(
        "Create a repository here, clone an existing one into this vault, or change the remote. " +
          "Everything that needs a password stays in Termux; this only does the parts that carry no secret."
      )
      .addButton((b) =>
        b.setButtonText("Set up repository").onClick(() => void this.plugin.cmdSetupRepository())
      );

    this.renderPreviousReposSetting(containerEl);

    new Setting(containerEl)
      .setName("Repository path (informational)")
      .setDesc("The repo path as seen from Termux, e.g. /storage/emulated/0/Documents/Vault. The runner config is authoritative.")
      .addText((t) =>
        t.setValue(s.repoPathHint).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ repoPathHint: v.trim() });
        })(); })
      );

    new Setting(containerEl).setName("Repository rules").setHeading();
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text:
        "Sparse exclusions, .gitignore and .git/info/exclude, managed per item. " +
        "Each section is collapsed because these lists can get long.",
    });

    this.renderProtectedPathsSection(containerEl, s);
    this.renderSparseSection(containerEl);
    this.renderGitignoreSection(containerEl);
    this.renderExcludeSection(containerEl);

    new Setting(containerEl).setName("File context menu").setHeading();
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text:
        "Which Git entries appear on right click / long tap of a file or folder. " +
        "Stage/Unstage is always shown while the bridge is enabled.",
    });

    new Setting(containerEl)
      .setName("Show .gitignore commands")
      .setDesc("Add to / remove from .gitignore (shared, synced through git).")
      .addToggle((t) =>
        t.setValue(s.menuGitignore).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ menuGitignore: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Show sparse commands")
      .setDesc("Hide on this device / show again (sparse checkout exclusions).")
      .addToggle((t) =>
        t.setValue(s.menuSparse).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ menuSparse: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Show .git exclude commands")
      .setDesc("Add to / remove from .git/info/exclude (this clone only, never synced).")
      .addToggle((t) =>
        t.setValue(s.menuExclude).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ menuExclude: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Rows shown per group")
      .setDesc(
        "How many rows the status panel draws in each group before it offers the rest. " +
          "Every group can be long at once, and a folder of a few thousand new files arrives " +
          "as one Git entry that expands into a row each. The group's count always states the " +
          "true total. Device-local: what it costs is render time here."
      )
      .addDropdown((d) => {
        for (const n of ROWS_PER_GROUP_CHOICES) d.addOption(String(n), String(n));
        d.setValue(String(s.rowsPerGroup)).onChange((v) => { void (async () => {
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) return;
          await this.plugin.updateDeviceSettings({ rowsPerGroup: n });
        })(); });
      });

    new Setting(containerEl)
      .setName("Delete new files permanently")
      .setDesc(
        "Off: deleting untracked files moves them to Obsidian's trash (.trash in the vault), " +
          "which is the only way back for a file Git never recorded. On: they are deleted from " +
          "disk. Device-local, because what it decides is whether .trash grows on this device."
      )
      .addToggle((t) =>
        t.setValue(s.deleteUntrackedPermanently).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ deleteUntrackedPermanently: v });
        })(); })
      );

    new Setting(containerEl).setName("Notifications").setHeading();

    new Setting(containerEl)
      .setName("Show a result window on success")
      .setDesc(
        "Off: successful operations only update the status panel (and the log). " +
          "Failures, conflicts and safety blocks are always shown as a window."
      )
      .addToggle((t) =>
        t.setValue(s.showSuccessModals).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ showSuccessModals: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Short messages")
      .setDesc(
        "Where brief informational messages go. Note: a plugin cannot raise native Android " +
          "toasts, so the choices are Obsidian's own notice, the status panel, or the log only."
      )
      .addDropdown((d) =>
        d
          .addOption("notice", "Obsidian notice (toast)")
          .addOption("status-only", "Status panel only")
          .addOption("log-only", "Operation log only")
          .setValue(s.notificationMode)
          .onChange((v) => { void (async () => {
            await this.plugin.updateDeviceSettings({
              notificationMode: v as "notice" | "status-only" | "log-only",
            });
          })(); })
      );

    new Setting(containerEl)
      .setName("Name the file above the Git menu")
      .setDesc(
        "Show the folder and the file name at the top of the Git context menu, above the entries. " +
          "On by default: a panel row truncates the name and the file explorer shows no path at all, " +
          "so without it the menu can offer 'Discard changes' over a file it never identifies. " +
          "A deep path costs two or three rows. Cosmetic and shared across devices (stored in data.json)."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.showMenuHeader).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ showMenuHeader: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Spell the change out in the status panel")
      .setDesc(
        "Show 'modified', 'conflicted' or 'deleted' beside a file name. On by default. " +
          "Mobile only — on desktop the tooltip carries it — and the change letter at the " +
          "end of the row states it either way, so turning this off gives long names more room. " +
          "Cosmetic and shared across devices (stored in data.json)."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.showChangeWords).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ showChangeWords: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Open the output panel for long operations")
      .setDesc(
        "Show what Termux is saying, by itself, once an operation has run for 30 seconds. " +
          "Off by default: a panel that appears on its own takes a slot in the sidebar while " +
          "you are reading something else. Either way, tapping the state line in the Git panel " +
          "(the one that counts the seconds) opens it. Cosmetic and shared across devices."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.openOutputForLongOps).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ openOutputForLongOps: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Wrap long lines")
      .setDesc(
        "Wrap lines in the diff and conflict panes instead of scrolling horizontally. " +
          "In the conflict pane the line numbers and the Keep buttons stay pinned to " +
          "the left edge while the text scrolls, so no control can end up out of reach. " +
          "Cosmetic and shared across devices (stored in data.json)."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.wrapDiffLines).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ wrapDiffLines: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Show invisible characters in diffs")
      .setDesc(
        "Render whitespace as glyphs in the diff pane: · space, → tab, ␍ CR. " +
          "Makes leading/trailing whitespace visible. Note: copying from the " +
          "diff then copies the glyphs, not the original whitespace."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.showInvisibles).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ showInvisibles: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Compare changed lines by")
      .setDesc(
        "What gets highlighted inside a line that changed, in the diff pane, " +
          "the file history and the conflict pane. Words suit prose: 'brown' " +
          "becoming 'red' is one word replaced. Characters suit paths, " +
          "identifiers and numbers, where one letter is the whole edit."
      )
      .addDropdown((d) =>
        d
          .addOption("word", "Words")
          .addOption("char", "Characters")
          .setValue(this.plugin.sharedPrefs.inlineDiffUnit)
          .onChange((v) => { void (async () => {
            await this.plugin.setSharedPref({ inlineDiffUnit: v as InlineDiffUnit });
          })(); })
      );

    new Setting(containerEl)
      .setName("Keep line selection when opening another file")
      .setDesc(
        "The diff pane is reused for every diff. Off: opening another file " +
          "leaves line-selection mode, so a diff never arrives already in it. " +
          "On: the mode stays. The ticked lines are dropped either way — they " +
          "point at lines of the diff that was on screen."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.keepLineSelection).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ keepLineSelection: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Show raw conflict markers")
      .setDesc(
        "In the conflict pane: show the file's <<<<<<< / ======= / >>>>>>> " +
          "lines as they really are, with the side labels and Keep buttons on " +
          "separate rows. Off: the markers stay hidden under those rows."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.showConflictMarkers).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ showConflictMarkers: v });
        })(); })
      );

    this.renderColorSection(containerEl);

    new Setting(containerEl)
      .setName("Diff size limit")
      .setDesc(
        "How much of one diff the pane builds at a time. The runner keeps whole " +
          "hunks within the limit and never a partial one, and the pane says how " +
          "many it left out, with a one-tap way to fetch the rest for that diff " +
          "alone. Every diff line costs about a dozen elements to draw, so this " +
          "is a per-phone decision and stays device-local."
      )
      .addDropdown((d) => {
        for (const kb of DIFF_LIMIT_CHOICES_KB) {
          d.addOption(String(kb), kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`);
        }
        d.setValue(String(s.diffLimitKb)).onChange((v) => { void (async () => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n <= 0) return;
          await this.plugin.updateDeviceSettings({ diffLimitKb: n });
        })(); });
      });

    new Setting(containerEl)
      .setName("Auto-refresh status (seconds)")
      .setDesc(
        "While the status panel is open, run a status this often to pick up " +
          "outside changes. 0 disables it. Each refresh wakes Termux — " +
          "consider battery before choosing a small interval. Device-local."
      )
      .addText((t) => {
        t.inputEl.inputMode = "numeric";
        t.setPlaceholder("0")
          .setValue(String(s.statusRefreshSeconds))
          .onChange((v) => { void (async () => {
            const n = parseInt(v, 10);
            if (!Number.isFinite(n) || n < 0) return;
            await this.plugin.updateDeviceSettings({ statusRefreshSeconds: n });
            this.plugin.restartStatusPoll();
          })(); });
      });

    new Setting(containerEl).setName("Automatic actions").setHeading();

    new Setting(containerEl)
      .setName("When Obsidian opens")
      .setDesc(
        "Pull brings work in and changes nothing you have not seen. Sync also commits and pushes, " +
          "so on every launch it publishes whatever is lying around — including the workspace file " +
          "Obsidian rewrites just by being opened. Nothing is the default."
      )
      .addDropdown((d) =>
        d
          .addOption("nothing", "Nothing")
          .addOption("pull", "Pull")
          .addOption("sync", "Sync (commit and push too)")
          .setValue(s.onOpenAction)
          .onChange((v) => { void (async () => {
            await this.plugin.updateDeviceSettings({
              onOpenAction: v as "nothing" | "pull" | "sync",
            });
          })(); })
      );

    new Setting(containerEl)
      .setName("Sync when Obsidian closes / goes to background")
      .setDesc("Queues a sync request during the close transition; Termux may finish it after Obsidian is gone.")
      .addToggle((t) =>
        t.setValue(s.autoSyncOnClose).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ autoSyncOnClose: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Periodic sync while Obsidian is open (minutes, 0 = off)")
      .addText((t) =>
        t.setValue(String(s.periodicSyncMinutes)).onChange((v) => { void (async () => {
          const n = Math.max(0, Math.floor(Number(v) || 0));
          await this.plugin.updateDeviceSettings({ periodicSyncMinutes: n });
        })(); })
      );

    new Setting(containerEl)
      .setName("Minimum interval between automatic syncs (minutes)")
      .addText((t) =>
        t.setValue(String(s.minAutoSyncIntervalMinutes)).onChange((v) => { void (async () => {
          const n = Math.max(1, Math.floor(Number(v) || 15));
          await this.plugin.updateDeviceSettings({ minAutoSyncIntervalMinutes: n });
        })(); })
      );

    new Setting(containerEl)
      .setName("Only sync on Wi-Fi (best effort)")
      .setDesc("Uses the WebView network API when available; skipped silently when the API is missing.")
      .addToggle((t) =>
        t.setValue(s.wifiOnly).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ wifiOnly: v });
        })(); })
      );

    new Setting(containerEl)
      .setName("Skip automatic sync when battery is low (best effort)")
      .addToggle((t) =>
        t.setValue(s.skipOnLowBattery).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ skipOnLowBattery: v });
        })(); })
      );

    new Setting(containerEl).setName("Advanced").setHeading();

    new Setting(containerEl)
      .setName("Operation log")
      .setDesc(
        "Recent bridge operations (URLs redacted). Lives here since the " +
          "panel strip slot went to the tree/list toggle; also available as " +
          "the 'Open operation log' command."
      )
      .addButton((b) =>
        b.setButtonText("Open").onClick(() => this.plugin.openOperationLog())
      );

    new Setting(containerEl)
      .setName("Operation timeout (seconds)")
      .setDesc(
        `How long to wait for the runner before giving up. Default ${DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds}. ` +
          `Fetch, pull, push and sync never get less than ${MIN_NETWORK_TIMEOUT_SECONDS}s whatever is set here, ` +
          "and cloning has its own much larger budget: those wait for a network, not for git. " +
          "Giving up does not stop the runner — it finishes what it started, and a result that lands " +
          "later is picked up — so a short value buys nothing but alarming windows."
      )
      .addText((t) =>
        t.setValue(String(s.opTimeoutSeconds)).onChange((v) => { void (async () => {
          const n = Math.min(3600, Math.max(10, Math.floor(Number(v) || DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds)));
          await this.plugin.updateDeviceSettings({ opTimeoutSeconds: n });
        })(); })
      );

    new Setting(containerEl)
      .setName("Companion intent URI template")
      .setDesc('Advanced. "{id}" is replaced by the request id; change it only if the companion app uses a custom scheme.')
      .addText((t) =>
        t.setValue(s.companionUriTemplate).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ companionUriTemplate: v.trim() });
        })(); })
      );

    new Setting(containerEl)
      .setName("Reset device-local settings")
      .setDesc("Restores all settings on this device to defaults. The vault and repository are not touched.")
      .addButton((b) =>
        b.setButtonText("Reset").setDestructive().onClick(() => {
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
  private refreshTab(): void {
    const anyThis = this as unknown as { update?: () => void };
    if (typeof anyThis.update === "function") anyThis.update();
    else this.display();
  }

  // ------------------------------------------------ collapsible rule managers

  /**
   * Which sections the user has expanded. Add/remove actions re-render the
   * whole tab (display()), which would otherwise collapse every <details>
   * back to its default state — remembering titles here keeps them open.
   */
  private openSections = new Set<string>();

  /** Collapsible <details> block with a title; open state survives re-renders. */
  private detailsSection(
    containerEl: HTMLElement,
    title: string,
    hint: string
  ): { body: HTMLElement; hintEl: HTMLElement } {
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
  private entryRow(
    listEl: HTMLElement,
    text: string,
    onRemove: (() => void | Promise<void>) | null
  ): void {
    const row = listEl.createDiv({ cls: "ngb-entry-row" });
    row.createSpan({ cls: "ngb-entry-text", text });
    if (onRemove) {
      const btn = row.createEl("button", { text: "Remove" });
      btn.addEventListener("click", () => void onRemove());
    }
  }

  /** Input + Add button; `onAdd` receives the trimmed value. May be async. */
  private addRow(
    body: HTMLElement,
    placeholder: string,
    label: string,
    onAdd: (v: string) => void | Promise<void>
  ): void {
    const row = body.createDiv({ cls: "ngb-add-row" });
    const input = row.createEl("input", { type: "text", placeholder });
    const btn = row.createEl("button", { text: label });
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
  private renderPreviousReposSetting(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName("Previous repository copies")
      .setDesc("Checking…");
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
        b
          .setButtonText("Review")
          .onClick(() => this.plugin.showPreviousRepoModal(repos, "Previous repository copies"))
      );
      setting.settingEl.show();
    })();
  }

  private renderColorSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Custom colours in the diff and conflict panes")
      .setDesc(
        "Off: the panes follow your theme. On: the colours below are used. " +
          "Cosmetic and shared across devices (stored in data.json)."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.sharedPrefs.customColors).onChange((v) => { void (async () => {
          await this.plugin.setSharedPref({ customColors: v });
          this.refreshTab();
        })(); })
      );
    if (!this.plugin.sharedPrefs.customColors) return;

    const fields: Array<{ key: keyof NgbColorSet; name: string; desc: string }> = [
      { key: "diffAddBg", name: "Added line background", desc: "Diff pane" },
      { key: "diffAddHl", name: "Added characters", desc: "Diff pane, intra-line highlight" },
      { key: "diffDelBg", name: "Deleted line background", desc: "Diff pane" },
      { key: "diffDelHl", name: "Deleted characters", desc: "Diff pane, intra-line highlight" },
      { key: "conflictLocalBg", name: "LOCAL side background", desc: "Conflict pane (yours)" },
      { key: "conflictRemoteBg", name: "REMOTE side background", desc: "Conflict pane (theirs)" },
    ];
    for (const mode of ["dark", "light"] as const) {
      const { body } = this.detailsSection(
        containerEl,
        mode === "dark" ? "Colours (dark theme)" : "Colours (light theme)",
        ""
      );
      const prefKey = mode === "dark" ? "colorsDark" : "colorsLight";
      for (const f of fields) {
        new Setting(body)
          .setName(f.name)
          .setDesc(f.desc)
          .addColorPicker((cp) =>
            cp.setValue(this.plugin.sharedPrefs[prefKey][f.key]).onChange((v) => { void (async () => {
              await this.plugin.setSharedPref({
                [prefKey]: { ...this.plugin.sharedPrefs[prefKey], [f.key]: v },
              });
            })(); })
          );
      }
      new Setting(body)
        .setName("Reset to the defaults")
        .setDesc("Restores the values this plugin ships with for this theme.")
        .addButton((b) =>
          b.setButtonText("Reset").onClick(() => { void (async () => {
            await this.plugin.setSharedPref({ [prefKey]: { ...DEFAULT_COLORS[mode] } });
            this.refreshTab();
          })(); })
        );
    }
  }

  private renderProtectedPathsSection(
    containerEl: HTMLElement,
    s: { autoProtectSparse: boolean; derivedProtectedPaths: string[] }
  ): void {
    const { body, hintEl } = this.detailsSection(containerEl, "Protected paths", "");
    new Setting(body)
      .setName("Auto-protect sparse exclusions")
      .setDesc("Paths hidden by the repository's own sparse rules join the protected set automatically (read from git on every status).")
      .addToggle((t) =>
        t.setValue(s.autoProtectSparse).onChange((v) => { void (async () => {
          await this.plugin.updateDeviceSettings({ autoProtectSparse: v });
          refresh();
        })(); })
      );
    const derivedNote = body.createEl("p", { cls: "ngb-settings-note" });
    const list = body.createDiv();
    const invalidNote = body.createDiv({ cls: "ngb-invalid" });
    const refresh = () => {
      const cur = this.plugin.deviceSettings;
      hintEl.setText(`${this.plugin.effectiveProtectedPaths().length} effective`);
      derivedNote.setText(
        !cur.autoProtectSparse
          ? "Auto-protect is off: only the manual paths below are protected."
          : cur.derivedProtectedPaths.length
            ? `Derived from sparse checkout: ${cur.derivedProtectedPaths.join(", ")}`
            : "Derived from sparse checkout: none yet (run Status once to read them from git)."
      );
      list.empty();
      for (const p of cur.protectedPaths) {
        this.entryRow(list, p, async () => {
          await this.plugin.updateDeviceSettings({
            protectedPaths: this.plugin.deviceSettings.protectedPaths.filter((x) => x !== p),
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

  private renderSparseSection(containerEl: HTMLElement): void {
    const { body, hintEl } = this.detailsSection(containerEl, "Sparse checkout exclusions", "");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text:
        "Paths hidden from THIS device's working tree (non-cone sparse checkout, applied by git in Termux). " +
        "Hiding never deletes anything from the repository; removing an exclusion materializes the files again.",
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
    this.addRow(body, "Folder/Subfolder", "Hide path", (v) =>
      void this.plugin.cmdSparseExclude(v, true).then(refresh)
    );
  }

  private renderGitignoreSection(containerEl: HTMLElement): void {
    const { body, hintEl } = this.detailsSection(containerEl, ".gitignore", "shared, synced through git");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text: ".gitignore is a tracked file: entries apply to ALL devices once the change is committed and synced.",
    });
    const list = body.createDiv();
    const refresh = () => {
      void this.plugin.loadGitignore().then((entries) => {
        hintEl.setText(`${entries.length} entries · shared, synced through git`);
        list.empty();
        for (const e of entries) {
          this.entryRow(list, e, () => void this.plugin.gitignoreRemove(e).then(refresh));
        }
      });
    };
    refresh();
    this.addRow(body, "pattern, e.g. /Scratch/ or *.tmp", "Add entry", (v) =>
      void this.plugin.gitignoreAdd(v).then(refresh)
    );
  }

  private renderExcludeSection(containerEl: HTMLElement): void {
    const { body, hintEl } = this.detailsSection(containerEl, ".git/info/exclude", "this clone only, never synced");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text:
        "Local ignore rules stored inside .git — they never reach the remote or other devices. " +
        "Managed through the Termux runner; press Load to read the current file.",
    });
    const list = body.createDiv();
    const refresh = () => {
      const entries = this.plugin.currentExcludeLines();
      hintEl.setText(`${entries.length} entries · this clone only`);
      list.empty();
      for (const e of entries) {
        const path = e.replace(/^\//, "").replace(/\/$/, "");
        this.entryRow(list, e, () => void this.plugin.cmdExcludeChange(path, false).then(refresh));
      }
    };
    refresh();
    new Setting(body).addButton((b) =>
      b.setButtonText("Load from Termux").onClick(() => void this.plugin.refreshExcludeList().then(refresh))
    );
    this.addRow(body, "Folder/Subfolder", "Add to exclude", (v) =>
      void this.plugin.cmdExcludeChange(v, true).then(refresh)
    );
  }
}
