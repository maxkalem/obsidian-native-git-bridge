# Setup guide (Android)

What you install, in order: **Termux** (runs real git), the **Git Bridge
Companion** app (forwards triggers to Termux), and the **plugin** (the UI in
Obsidian). Nothing runs in the background at any point; Termux executes a
one-shot script only when you invoke a command in Obsidian.

## Prerequisites

- An Obsidian vault on shared storage (e.g. `/storage/emulated/0/MyVault`) that
  is already a git repository with a configured remote. Sparse checkout is
  supported but not required.
- Termux from **F-Droid** (the Play Store build is deprecated and its
  RUN_COMMAND behaviour differs).

## Step 1 — Termux

Get it from the official site <https://termux.dev>, which lists the supported
download sources — in practice the **F-Droid build**
(<https://f-droid.org/packages/com.termux/>). Avoid the Play Store build: it is
deprecated. Open Termux once so it initializes its home directory.

Note: the companion app never installs anything itself — it can only open
F-Droid or the download page for you. Installing an APK would require
`REQUEST_INSTALL_PACKAGES` on an app that already holds the Termux
RUN_COMMAND permission, which is not a trade this project makes.

## Step 2 — Companion app

Install `git-bridge-companion.apk` from the GitHub release (or, if the release
carries only `git-bridge-companion-DEBUG-SIGNATURE.apk`, that one — it works,
but future updates will require uninstalling it first). Open it: it shows a three-step checklist —

1. *Termux installed* — detected automatically.
2. *Run commands in Termux environment* — tap to grant the Android permission.
3. *Round trip* — verified automatically after step 3 below (the app triggers
   the runner through the real RUN_COMMAND path and shows a green checkmark
   when a result comes back).

All three checkmarks must be green before the bridge can work.

## Step 3 — one pasted line in Termux

```
curl -fsSL https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest/download/bootstrap.sh | bash -s -- "/storage/emulated/0/<YourVault>"
```

(You can omit the path — the installer scans shared storage for vaults that are
git repositories and asks if it finds several.)

Better: copy the command from the plugin (Settings → Copy command) or from the
companion app's step 3. Those versions are **pinned to the release you are
running**, so the runner they install is exactly the one your plugin build was
tested against. The command above tracks the newest release instead, and
neither fetches from the `main` branch — that is the development state and may
be mid-change.

The installer requests storage access (accept the Android dialog), installs
git/jq/openssh, marks the repo as `safe.directory` if needed (asks first),
enables `allow-external-apps` (required for the companion), checks your
authentication non-interactively, installs the runner to
`~/.config/native-git-bridge/runner.sh`, excludes the runtime folder from git
locally, runs a ping self-test, and drops a one-shot `pairing.json` that the
plugin imports and deletes on its next start.

Authentication stays entirely in Termux: an existing PAT via credential helper,
a token in the remote URL (the installer offers to move it into
`~/.git-credentials`), or an SSH key (generated automatically for SSH remotes —
add the printed public key to your git host).

## Step 4 — the plugin

1. Copy the `native-git-bridge` folder to
   `<YourVault>/.obsidian/plugins/native-git-bridge/` (it must contain
   `main.js`, `manifest.json`, `styles.css`).
2. Restart Obsidian → Settings → Community plugins → enable **Native Git Bridge**.
3. Open the plugin settings and **Enable on this device** (the enable flag is
   device-local by design). The pairing token imports automatically.
4. If your vault uses sparse checkout, review **Protected paths** — directories
   excluded by sparse checkout that must never be committed as deletions.

## Step 5 — verify

Run *Native Git: Status* from the command palette or the sidebar panel. The
first round trip confirms the whole chain. If nothing comes back, run
*Native Git: Check bridge* — it diagnoses locally (runner never ran here /
outdated runner / stuck requests) without waiting for a timeout.

Once status works, everything else does too: tapping a changed file opens its
diff in a pane, and the history button (right of the operation log) opens the
repository history — commits expand into their changed files, each opening the
diff that commit introduced.

Also see: [troubleshooting.md](troubleshooting.md), [update.md](update.md).
