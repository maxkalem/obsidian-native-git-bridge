import { App, PluginSettingTab, Setting } from "obsidian";
import type NativeGitBridgePlugin from "../main";
import { validateProtectedPaths } from "./pathValidation";
import { DEFAULT_DEVICE_SETTINGS } from "./DeviceLocalSettingsStore";
import { ConfirmModal } from "../ui/modals";
import { REPO_RAW_BASE } from "../constants";
import { Notice } from "obsidian";

export class NativeGitBridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NativeGitBridgePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.deviceSettings;

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
    const cmd = s.repoPathHint
      ? `curl -fsSL ${REPO_RAW_BASE}/termux/bootstrap.sh | bash -s -- "${s.repoPathHint}"`
      : `curl -fsSL ${REPO_RAW_BASE}/termux/bootstrap.sh | bash`;
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

    containerEl.createEl("h3", { text: "Sparse checkout protection" });
    const desc = containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text:
        "Repository-relative paths excluded by sparse checkout. Before any commit or push these must " +
        "show no Git changes; otherwise the operation is blocked. One path per line.",
    });
    void desc;
    const invalidNote = containerEl.createDiv({ cls: "ngb-invalid" });
    new Setting(containerEl).setName("Protected sparse paths").addTextArea((ta) => {
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
}
