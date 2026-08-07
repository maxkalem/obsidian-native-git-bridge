# Native Git Bridge

## Description

> **Android only.** This plugin needs Termux and a small companion app; it cannot work on desktop, where it loads, explains itself and disables every operation. On desktop use plain Git or [obsidian-git](https://github.com/Vinzent03/obsidian-git). Its natural habitat is a vault shared between a desktop (any Git tooling) and an Android device (this bridge).

Native Git for Obsidian on **Android**, executed by the real `git` binary inside **Termux**, with first-class **sparse checkout** support. No isomorphic-git, no HTTP server, no open ports, nothing running in the background.

> [!note]
> **Status: Work in progress**

## Implemented

**Git operations**, all executed by the real `git` binary in Termux: status, fetch, pull, push, commit, sync (fetch, merge, commit, push in one step), abort merge, stage and unstage per file, per folder or everything, discard local changes, reset the working tree and index to HEAD, restore a file from a commit.

**Status panel** (the primary surface on mobile):

- groups for conflicts, staged changes, changes and untracked files, each collapsible, with counts in the right-hand column;
- **list or folder-tree layout**, switched by one button; folder rows act only on the files in their group's state, and untracked folders expand into the files inside them;
- per-row actions (open, stage/unstage, discard) and a Git context menu on rows, folders and group headers with the same entries everywhere;
- renames shown as moves, with the old path on the row;
- an operation strip with progress, a cancel slot, and directional activity animations on fetch, pull and push;
- optional auto-refresh at a chosen interval.

**Diff panes** rendered by diff2html with character-level, line-by-line highlighting: a staged row shows `HEAD → staged`, an unstaged row `staged → working tree`, a commit shows what it changed. Optional line wrapping, whitespace glyphs, and optional custom colours for the diff and conflict panes (off by default, light and dark configured separately).

**History**: a repository-wide panel whose commits expand into their changed files, and a per-file panel that says what each commit did to the file (`added`, `+25 −12`, `renamed from …`), shows the file as it was at that commit, and can restore the whole file or a single block from it. Every route to a diff or a history — status panel, context menu, command palette — opens these panels; there is one surface per question.

**Merge conflicts**, resolved manually and only on an explicit choice: a resolution pane (same display preferences as the diff panes) with keep-local / keep-remote per block, whole-file resolution from the context menu for anything the pane cannot display, git's own merge message prefilled for the commit that follows.

**Sparse-checkout safety**: protected paths are derived from the repository's own sparse exclusions, every commit and push is blocked while any of them shows as a change, staging always excludes them, and the block window offers the two recoveries that apply (trash the new files, or drop the exclusion).

**Repository configuration** from the app: sparse exclusions, `.gitignore` and `.git/info/exclude`, per item or in bulk.

**Starting from nothing**: a vault that is not a repository yet can be paired, given a repository (chosen default branch, optional first commit) or have one cloned into it. Cloning into a vault that already holds files never overwrites a single one of them: the repository's other files are checked out, and the ones that exist on both sides keep your version and appear in the panel as ordinary local changes, with a diff to look at before you decide.

**Re-cloning** a vault that already has a repository replaces it only after the new clone has succeeded, and the old repository is set aside with its history intact rather than deleted — with a daily reminder about the disk it uses, and one tap to remove it.

**Authentication** never leaves Termux: a PAT through a credential helper, an SSH key, or GitHub's OAuth device flow through the GitHub CLI (`gh`), configured per repository so two vaults can use two accounts.

**Several vaults on one device**: every vault is a repository of its own with its own Termux profile, its own token and its own credentials; one runner drains them all in one pass, oldest request first. A vault opened inside another vault's repository is kept out of it through the outer repository's `.git/info/exclude` (device-local, nothing tracked is edited), and each side's operations are pinned to its own repository. A second vault can pair itself from the plugin without re-running the installer; a moved vault is found again; a deleted one is reported, never silently replaced.

**Operational**: device-local settings that never sync through the vault, a pairing token imported automatically from the installer, a version handshake between plugin, runner and companion app, a local bridge check that diagnoses without contacting Termux, a redacting operation log, and diagnostics.

## Why

[obsidian-git](https://github.com/Vinzent03/obsidian-git) uses isomorphic-git on mobile, which does not understand a native Git index containing sparse-checkout / skip-worktree data, so it can misread sparse omissions as mass deletions. This plugin delegates every Git operation to native Git in Termux through a file-based request/response protocol, and hard-blocks any commit/push in which protected sparse paths appear as changes.

## Alternatives, and when to prefer them

The community directory already has several Git plugins. On mobile they take one of three approaches, and **none of them works with a native sparse-checkout index**, which is the entire reason this one exists:

- **isomorphic-git in the app**, e.g. [obsidian-git](https://github.com/Vinzent03/obsidian-git). A JavaScript Git implementation that does not implement sparse checkout and does not honour skip-worktree, so a sparse index can be misread as mass deletions.
- **The hosting provider's REST API**, e.g. [Hybrid Git Sync](https://community.obsidian.md/plugins/hybrid-git-sync), [Fit](https://community.obsidian.md/plugins/fit), [Git Vault Sync](https://community.obsidian.md/plugins/git-vault-sync). There is no repository on the phone at all: files are transferred over HTTP. That means no local history, no offline commits, no SSH, provider-specific limits, and an access token stored in the plugin's own settings.
- **A diff viewer on top of another Git plugin**, e.g. [Version History Diff](https://github.com/kometenstaub/obsidian-version-history-diff). It shows file history and diffs well, but takes its data from [obsidian-git](https://github.com/Vinzent03/obsidian-git) through that plugin's internals (its own README calls them private APIs), so it inherits whatever the underlying plugin can do. On a sparse-checkout vault that is the isomorphic-git backend again, and it offers no way for another plugin to supply the data instead. This plugin therefore renders its own history and diff views; proposing an adapter interface upstream remains an option (see [research notes](docs/research-notes.md)).

**Prefer one of those** if your vault is a normal full checkout, you sync only through GitHub/GitLab, and you would rather not install Termux and a companion app. They are simpler to set up and they work on iOS, which this plugin never will.

**Use this plugin** when you need the things only real Git can give you on the device: a **sparse checkout** that stays intact (with a safety gate that refuses to commit sparse omissions as deletions), full **offline** commits against a real local repository, SSH or a credential helper with credentials that **never enter the vault or the plugin**, and identical Git semantics on desktop and phone. That includes a vault whose `.obsidian/plugins/` folder is itself tracked, which is why every device-specific setting here is stored outside `data.json`.

## How it works

1. You run a command (e.g. *Native Git Bridge: Status*).
2. The plugin writes `runtime/requests/<id>.json` inside the plugin folder (locally excluded from Git via `.git/info/exclude`).
3. The plugin opens `nativegitbridge://run`; the companion app (the only supported trigger) forwards a RUN_COMMAND intent to Termux, which executes the fixed runner script once in the background. See `docs/ADR-001-android-invocation.md` for why a companion app is required.
4. The runner validates the pairing token, the action allow-list and all paths, runs git with argv arrays, writes `runtime/results/<id>.json` atomically and **exits**.
5. The plugin (polling only while the operation is in flight) renders the result.

## Install: two APKs and one pasted line

1. Install **Termux** (from F-Droid) and the **Git Bridge Companion** APK (built by `.github/workflows/build-companion.yml`; grant it the "Run commands in Termux environment" permission).
2. Paste one line into Termux:

```
curl -fsSL https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest/download/bootstrap.sh | bash -s -- "/storage/emulated/0/<YourVault>"
```

> [!warning]
> Be sure to replace \<YourVault\> in this command with the path to your vault! DO NOT COPY THE COMMAND AS-IS.

Better: take the command from the plugin (**Settings → Copy command**) or from the companion app. Those are pinned to the release you are actually running, so the runner they install is the one your build was tested against — which is what the version handshake expects. The line above tracks the newest release instead. Neither fetches from the `main` branch: that is the development state and may be mid-change.

No network, or GitHub having a bad day? The plugin folder already carries the same scripts — see [Installing without a network](#installing-without-a-network).

The installer sets up everything inside Termux: packages (git, jq, openssh), storage access, `allow-external-apps` for the companion, an SSH key (it prints the public key to add as a repo deploy key), repo + sparse verification, the runner, a local `.git/info/exclude` entry, a self-test. It also drops a one-shot `pairing.json` that the plugin imports automatically, so the token never needs to be copied by hand. Credentials stay entirely inside Termux; the plugin never stores or sees them. Any auth you already use works unchanged: a GitHub PAT via the git credential helper (or embedded in the remote URL, which the installer offers to move into `~/.git-credentials`), or an SSH key (generated only for SSH remotes). The runner always runs git with `GIT_TERMINAL_PROMPT=0`, so an expired PAT fails fast with a clear error instead of hanging, and diagnostics reports the detected auth method.

## Sparse checkout safety

Protected paths are **derived from the repository's own sparse-checkout exclusions** (read from git through the runner on every status) and can be extended manually in the settings. There are no baked-in defaults. Before any commit or push the bridge runs

```
git status --porcelain=v1 -- "<protected>" …
git diff --cached --name-status -- "<protected>" …
```

and blocks the operation if either reports anything. Sparse omissions are never treated as deletions, and there is no automatic destructive "repair".

Sparse exclusions, `.gitignore` entries and `.git/info/exclude` entries can be managed per item from the settings (collapsible sections) and from the Git context menu (long tap / right click).

That menu is described once and rendered identically wherever it opens: on a file row, a folder row, a group header and in the file explorer. The order is fixed: stage/unstage, discard, keep local / keep remote for conflicts, open diff or conflict view, open file history, open in the default app, copy path, then the `.gitignore` / sparse / `.git/info/exclude` entries. Entries appear only where they apply: opening things needs a single file, discard is never offered for staged content, and a folder or group entry states how many paths it will touch. A single path can flip a config rule off again; a folder or group can only add rules, because a mixed selection has no single state to flip.

## What this plugin accesses

Stated plainly, because Obsidian's [developer policies](https://docs.obsidian.md/Developer+policies) require network use and any access outside the vault to be disclosed in the README.

- **The plugin makes no network requests of its own.** It contacts no server, sends no telemetry, needs no account, and downloads nothing. Every byte that travels does so because **git in Termux** talked to the remote **you** configured, during an operation you started (or an automatic sync you enabled). Links to GitHub in the setup screens open your browser; nothing is fetched in the background.
- **The plugin only reads and writes inside the vault**: the request and result files under `.obsidian/plugins/native-git-bridge/runtime/`, `.gitignore` at the vault root, and — only when you use the Git actions — your notes, through git. It never reads or writes anything elsewhere on the device.
- **Termux is a separate app**, and everything outside the vault lives there: the runner script, the pairing profiles and your git credentials, all under Termux's private storage. The plugin cannot read them; it only leaves a request file in the vault and asks the companion app to wake the runner.
- **Cloning** writes into the vault only. The source may be a `file:///` path elsewhere on the device (a backup on the SD card, say) — that is git in Termux reading a location you typed, and nothing outside the vault is ever written. **Cloning a repository that tracks `.obsidian/`** will write plugin files and settings into your vault, exactly as a `git pull` would. That is your own repository doing it, chosen by you; nothing is fetched from this project's servers, and no plugin (this one included) is ever updated behind your back — but you should restart Obsidian afterwards, and the plugin says so.
- **Not required, not present:** payment, an account, ads, telemetry, remote code, obfuscation.

## Device-local by design

Enable state, integration type, pairing token, timeouts, automation flags and protected paths are stored in device-local storage scoped by vault identity, never in `data.json`. Syncing the plugin folder through Git therefore cannot leak one device's configuration to another. Only cosmetic UI preferences are shared.

## Development

```
npm install
npm test          # unit tests (vitest)
npm run test:e2e  # runner end-to-end against a real sparse-checkout repo
npm run build     # type check + bundle to main.js
```

## Docs

[Setup guide](docs/setup.md) · [Troubleshooting](docs/troubleshooting.md) · [Updating](docs/update.md) · [Release engineering](docs/release.md) · [Design notes for reviewers](docs/submission.md) · [ADR-001: why a companion app](docs/ADR-001-android-invocation.md) · [ADR-002: several repositories per device](docs/ADR-002-multiple-repositories.md) · [Threat model](docs/threat-model.md) · [Protocol](docs/protocol.md) · [Limitations](docs/limitations.md) · [Research notes](docs/research-notes.md)

## Installing without a network

The `native-git-bridge/` folder holds the Termux scripts next to the plugin files, so a device that has the folder needs nothing else:

```
bash "<vault>/.obsidian/plugins/native-git-bridge/termux/bootstrap.sh" "<vault>"
```

`bootstrap.sh` takes `install.sh` and the runner from the directory it is started from. `NGB_BASE_URL` overrides that source and accepts an `https://` URL, a `file://` URL, or a plain directory path. See [setup.md](docs/setup.md).

## Installing the plugin manually

1. Copy the entire `native-git-bridge` folder into your vault at `(YourVault)/.obsidian/plugins/native-git-bridge/`. After copying it must contain `main.js`, `manifest.json` and `styles.css`. The `termux/` folder holds helper scripts; Obsidian ignores it.
2. Restart Obsidian, or use Settings -> Community plugins -> Reload.
3. Settings -> Community plugins -> enable "Native Git Bridge".
4. In the plugin settings press "Copy command" and paste the command into Termux. Everything else is set up automatically: the pairing token is imported by the plugin on its own.


## License

MIT. No code was copied from [obsidian-git](https://github.com/Vinzent03/obsidian-git) or [Version History Diff](https://github.com/kometenstaub/obsidian-version-history-diff) (both MIT); they were read to see what users already expect, and some of their interface conventions are followed here (a history panel whose commits expand into changed files, a diff pane, a go-to-file button on rows). Diff rendering bundles [diff2html](https://github.com/rtfpessoa/diff2html) (MIT), a render-only library; git itself always runs natively in Termux. The diff stylesheet in `styles.css` is adapted from diff2html's MIT-licensed CSS with the Obsidian-variable adaptations pioneered by Version History Diff.
