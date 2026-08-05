# Updating

The bridge is **three parts that update independently**. Knowing which is which saves you from every "it worked yesterday" mystery:

| Part | Lives at | Updated by |
|------|----------|------------|
| Plugin (`main.js`, `manifest.json`, `styles.css`) | `<vault>/.obsidian/plugins/native-git-bridge/` | copying new files / vault sync |
| Termux runner | `~/.config/native-git-bridge/runner.sh` (Termux private) | re-running the install command |
| Companion app | Android | installing a newer APK |

## The rule that matters

**Updating the plugin never updates the runner.** The plugin folder often syncs through git itself, so `main.js` can arrive on a device silently, while the runner stays whatever it was. The two enforce a version handshake (`RUNNER_MIN_VERSION` in the plugin vs `RUNNER_VERSION` reported in every result): when the runner is too old, the plugin says so explicitly and every result modal repeats the hint until you update.

## Updating the plugin

Replace `main.js`, `manifest.json`, `styles.css` in the plugin folder (or let vault sync deliver them), then reload the plugin (Settings → Community plugins → toggle, or restart Obsidian). Device-local settings (enable flag, token, protected paths) survive updates; they are not stored in the plugin folder.

## Updating the runner

Fastest route: open the **companion app**. When the runner is behind, the app says so instead of reporting "all steps done" and shows an **Update runner** button that copies the release-pinned install command and opens Termux: paste, Enter. Afterwards *Test trigger* (or simply reopening the screen) picks up the new runner version, so the warning clears without going back to Obsidian.

Which runner version a release expects, and what each version added, is listed in [protocol.md → Runner version history](protocol.md#runner-version-history).

The manual route is unchanged: paste the install command again in Termux (Settings → Native Git Bridge → Copy command, or see [setup.md](setup.md) step 3). Re-running is safe and idempotent: it keeps the existing pairing token, re-checks auth, re-writes the runner, and re-runs the self-test. Nothing in the vault or the git history is touched.

## Updating the companion app

The companion carries the **same version number as the release**, so "companion 0.5.2" belongs to plugin 0.5.2. If the numbers differ, the companion is the older part. It changes rarely, so a release usually says whether updating it matters.

Note Android's signature rule: a debug APK and a signed release APK cannot update each other, so uninstall the old one first (the companion holds no state, nothing is lost). Two signed APKs update over each other normally.

## After any update

Run *Native Git: Status* once. If the versions disagree you get the exact message telling you which side to update.
