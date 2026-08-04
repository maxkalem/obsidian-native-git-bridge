import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type NativeGitBridgePlugin from "../main";
import { validateProtectedPaths } from "./pathValidation";
import { DEFAULT_DEVICE_SETTINGS } from "./DeviceLocalSettingsStore";
import { ConfirmModal } from "../ui/modals";
import { RUNNER_MIN_VERSION } from "../constants";
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

    containerEl.createEl("h3", { text: "Setup (one line in Termux)" });
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
        b.setButtonText("Copy command").setCta().onClick(async () => {
          await navigator.clipboard.writeText(cmd);
          new Notice("Install command copied.");
        })
      );

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
        t.setValue(s.enabledOnThisDevice).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ enabledOnThisDevice: v });
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Termux integration")
      .setDesc("Allow this plugin to queue requests for the Termux runner.")
      .addToggle((t) =>
        t.setValue(s.termuxIntegrationEnabled).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ termuxIntegrationEnabled: v });
        })
      );

    new Setting(containerEl)
      .setName("Pairing token")
      .setDesc(
        "Paste the token printed by the Termux installer (termux/install.sh). " +
          "It authenticates requests between this plugin and the runner. Stored locally; never logged."
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("token from installer")
          .setValue(s.authToken)
          .onChange(async (v) => {
            await this.plugin.updateDeviceSettings({ authToken: v.trim() });
          });
      });

    new Setting(containerEl)
      .setName("Repository path (informational)")
      .setDesc("The repo path as seen from Termux, e.g. /storage/emulated/0/Documents/Vault. The runner config is authoritative.")
      .addText((t) =>
        t.setValue(s.repoPathHint).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ repoPathHint: v.trim() });
        })
      );

    containerEl.createEl("h3", { text: "Repository rules" });
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

    containerEl.createEl("h3", { text: "File context menu" });
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
        t.setValue(s.menuGitignore).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ menuGitignore: v });
        })
      );

    new Setting(containerEl)
      .setName("Show sparse commands")
      .setDesc("Hide on this device / show again (sparse checkout exclusions).")
      .addToggle((t) =>
        t.setValue(s.menuSparse).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ menuSparse: v });
        })
      );

    new Setting(containerEl)
      .setName("Show .git exclude commands")
      .setDesc("Add to / remove from .git/info/exclude (this clone only, never synced).")
      .addToggle((t) =>
        t.setValue(s.menuExclude).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ menuExclude: v });
        })
      );

    containerEl.createEl("h3", { text: "Notifications" });

    new Setting(containerEl)
      .setName("Show a result window on success")
      .setDesc(
        "Off: successful operations only update the status panel (and the log). " +
          "Failures, conflicts and safety blocks are always shown as a window."
      )
      .addToggle((t) =>
        t.setValue(s.showSuccessModals).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ showSuccessModals: v });
        })
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
          .onChange(async (v) => {
            await this.plugin.updateDeviceSettings({
              notificationMode: v as "notice" | "status-only" | "log-only",
            });
          })
      );

    containerEl.createEl("h3", { text: "Automatic actions (all off by default)" });

    new Setting(containerEl)
      .setName("Pull when Obsidian opens")
      .addToggle((t) =>
        t.setValue(s.autoPullOnOpen).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ autoPullOnOpen: v });
        })
      );

    new Setting(containerEl)
      .setName("Sync when Obsidian closes / goes to background")
      .setDesc("Queues a sync request during the close transition; Termux may finish it after Obsidian is gone.")
      .addToggle((t) =>
        t.setValue(s.autoSyncOnClose).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ autoSyncOnClose: v });
        })
      );

    new Setting(containerEl)
      .setName("Periodic sync while Obsidian is open (minutes, 0 = off)")
      .addText((t) =>
        t.setValue(String(s.periodicSyncMinutes)).onChange(async (v) => {
          const n = Math.max(0, Math.floor(Number(v) || 0));
          await this.plugin.updateDeviceSettings({ periodicSyncMinutes: n });
        })
      );

    new Setting(containerEl)
      .setName("Minimum interval between automatic syncs (minutes)")
      .addText((t) =>
        t.setValue(String(s.minAutoSyncIntervalMinutes)).onChange(async (v) => {
          const n = Math.max(1, Math.floor(Number(v) || 15));
          await this.plugin.updateDeviceSettings({ minAutoSyncIntervalMinutes: n });
        })
      );

    new Setting(containerEl)
      .setName("Only sync on Wi-Fi (best effort)")
      .setDesc("Uses the WebView network API when available; skipped silently when the API is missing.")
      .addToggle((t) =>
        t.setValue(s.wifiOnly).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ wifiOnly: v });
        })
      );

    new Setting(containerEl)
      .setName("Skip automatic sync when battery is low (best effort)")
      .addToggle((t) =>
        t.setValue(s.skipOnLowBattery).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ skipOnLowBattery: v });
        })
      );

    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Operation timeout (seconds)")
      .addText((t) =>
        t.setValue(String(s.opTimeoutSeconds)).onChange(async (v) => {
          const n = Math.min(3600, Math.max(10, Math.floor(Number(v) || DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds)));
          await this.plugin.updateDeviceSettings({ opTimeoutSeconds: n });
        })
      );

    new Setting(containerEl)
      .setName("Companion intent URI template")
      .setDesc('Advanced. "{id}" is replaced by the request id; change it only if the companion app uses a custom scheme.')
      .addText((t) =>
        t.setValue(s.companionUriTemplate).onChange(async (v) => {
          await this.plugin.updateDeviceSettings({ companionUriTemplate: v.trim() });
        })
      );

    new Setting(containerEl)
      .setName("Reset device-local settings")
      .setDesc("Restores all settings on this device to defaults. The vault and repository are not touched.")
      .addButton((b) =>
        b.setButtonText("Reset").setWarning().onClick(() => {
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
              this.display();
            }
          ).open();
        })
      );
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
  private entryRow(listEl: HTMLElement, text: string, onRemove: (() => void) | null): void {
    const row = listEl.createDiv({ cls: "ngb-entry-row" });
    row.createSpan({ cls: "ngb-entry-text", text });
    if (onRemove) {
      const btn = row.createEl("button", { text: "Remove" });
      btn.addEventListener("click", onRemove);
    }
  }

  /** Input + Add button; `onAdd` receives the trimmed value. */
  private addRow(body: HTMLElement, placeholder: string, label: string, onAdd: (v: string) => void): void {
    const row = body.createDiv({ cls: "ngb-add-row" });
    const input = row.createEl("input", { type: "text", placeholder });
    const btn = row.createEl("button", { text: label });
    btn.addEventListener("click", () => {
      const v = input.value.trim();
      if (v !== "") onAdd(v);
      input.value = "";
    });
  }

  // Every section refreshes ONLY its own list in place. Re-rendering the whole
  // tab (display()) on each add/remove resets the scroll position and makes
  // the collapsibles flicker — the view visibly "jumps".

  private renderProtectedPathsSection(
    containerEl: HTMLElement,
    s: { autoProtectSparse: boolean; derivedProtectedPaths: string[] }
  ): void {
    const { body, hintEl } = this.detailsSection(containerEl, "Protected paths", "");
    new Setting(body)
      .setName("Auto-protect sparse exclusions")
      .setDesc("Paths hidden by the repository's own sparse rules join the protected set automatically (read from git on every status).")
      .addToggle((t) =>
        t.setValue(s.autoProtectSparse).onChange(async (v) => {
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
