# Native Git Bridge

> **Android only.** This plugin needs Termux and a small companion app; it
> cannot work on desktop, where it loads, explains itself and disables every
> operation. On desktop use plain Git or
> [obsidian-git](https://github.com/Vinzent03/obsidian-git). Its natural
> habitat is a vault shared between a desktop (any Git tooling) and an Android
> device (this bridge).

Native Git for Obsidian on **Android**, executed by the real `git` binary inside
**Termux** — with first-class **sparse checkout** support. No isomorphic-git, no
HTTP server, no open ports, nothing running in the background.

> Status: implemented — status, sparse safety, pull/commit/push/, sync/fetch with 
> conflict handling, per-file history (rename-aware), view at commit, diffs, 
> confirmed restore, plus hardening (parser fuzzing, recovery paths, request 
> expiry, security re-audit) and release workflows. 
> Version History Diff exposes no public provider API (it consumes obsidian-git's
> private API), so the history/diff UX is provided by this plugin's own views; 
> an upstream adapter PR remains an option (see docs/research-notes.md).

## Why

[obsidian-git](https://github.com/Vinzent03/obsidian-git) uses isomorphic-git on
mobile, which does not understand a native Git index containing
sparse-checkout / skip-worktree data — it can misread sparse omissions as mass
deletions. This plugin delegates every Git operation to native Git in Termux
through a file-based request/response protocol, and hard-blocks any commit/push
in which protected sparse paths appear as changes.

## Alternatives — and when to prefer them

The community directory already has several Git plugins. On mobile they take
one of two approaches, and **neither can work with a native sparse-checkout
index**, which is the entire reason this one exists:

- **isomorphic-git in the app** — e.g.
  [obsidian-git](https://github.com/Vinzent03/obsidian-git). A JavaScript Git
  implementation that does not implement sparse checkout and does not honour
  skip-worktree, so a sparse index can be misread as mass deletions.
- **The hosting provider's REST API** — e.g.
  [Hybrid Git Sync](https://community.obsidian.md/plugins/hybrid-git-sync),
  Fit, Git Vault Sync. There is no repository on the phone at all: files are
  transferred over HTTP. That means no local history, no offline commits, no
  SSH, provider-specific limits, and an access token stored in the plugin's
  own settings.

**Prefer one of those** if your vault is a normal full checkout, you sync only
through GitHub/GitLab, and you would rather not install Termux and a companion
app. They are simpler to set up and they work on iOS, which this plugin never
will.

**Use this plugin** when you need the things only real Git can give you on the
device: a **sparse checkout** that stays intact (with a safety gate that
refuses to commit sparse omissions as deletions), full **offline** commits
against a real local repository, SSH or a credential helper with credentials
that **never enter the vault or the plugin**, and identical Git semantics on
desktop and phone — including a vault whose `.obsidian/plugins/` folder is
itself tracked, which is why every device-specific setting here is stored
outside `data.json`.

## How it works

1. You run a command (e.g. *Native Git: Status*).
2. The plugin writes `runtime/requests/<id>.json` inside the plugin folder
   (locally excluded from Git via `.git/info/exclude`).
3. The plugin opens `nativegitbridge://run`; the companion app (the only
   supported trigger) forwards a RUN_COMMAND intent to Termux, which executes
   the fixed runner script once in the background. See
   `docs/ADR-001-android-invocation.md` for why a companion app is required.
4. The runner validates the pairing token, the action allow-list and all paths,
   runs git with argv arrays, writes `runtime/results/<id>.json` atomically and
   **exits**.
5. The plugin (polling only while the operation is in flight) renders the result.

## Install — two APKs and one pasted line

1. Install **Termux** (from F-Droid) and the **Git Bridge Companion** APK
   (built by `.github/workflows/build-companion.yml`; grant it the
   "Run commands in Termux environment" permission).
2. Paste one line into Termux (also available with a Copy button in the plugin
   settings):

```
curl -fsSL https://raw.githubusercontent.com/maxkalem/obsidian-native-git-bridge/main/native-git-bridge/termux/bootstrap.sh | bash -s -- "/storage/emulated/0/<YourVault>"
```

> [!warning]
> Be sure to replace \<YourVault\> in this command with the path to your vault! 
> DO NOT COPY THE COMMAND AS-IS.

The installer sets up everything inside Termux: packages (git, jq, openssh),
storage access, `allow-external-apps` for the companion, an SSH key (it prints
the public key to add as a repo deploy key), repo + sparse verification, the
runner, a local `.git/info/exclude` entry, a self-test — and drops a one-shot
`pairing.json` that the plugin imports automatically, so the token never needs
to be copied by hand. Credentials stay entirely inside Termux; the plugin never
stores or sees them. Any auth you already use works unchanged — a GitHub PAT
via the git credential helper (or embedded in the remote URL, which the
installer offers to move into `~/.git-credentials`), or an SSH key (generated
only for SSH remotes). The runner always runs git with
`GIT_TERMINAL_PROMPT=0`, so an expired PAT fails fast with a clear error
instead of hanging, and diagnostics reports the detected auth method.

## Sparse checkout safety

Protected paths are **derived from the repository's own sparse-checkout
exclusions** (read from git through the runner on every status) and can be
extended manually in the settings — there are no baked-in defaults. Before any
commit or push the bridge runs

```
git status --porcelain=v1 -- "<protected>" …
git diff --cached --name-status -- "<protected>" …
```

and blocks the operation if either reports anything. Sparse omissions are never
treated as deletions, and there is no automatic destructive "repair".

Sparse exclusions, `.gitignore` entries and `.git/info/exclude` entries can be
managed per item from the settings (collapsible sections) and from the file
context menu (long tap / right click): stage/unstage, add/remove in
`.gitignore`, hide/show via sparse, add/remove in the local exclude file.

## Device-local by design

Enable state, integration type, pairing token, timeouts, automation flags and
protected paths are stored in device-local storage scoped by vault identity —
never in `data.json` — so syncing the plugin folder through Git cannot leak one
device's configuration to another. Only cosmetic UI preferences are shared.

## Development

```
npm install
npm test          # unit tests (vitest)
npm run test:e2e  # runner end-to-end against a real sparse-checkout repo
npm run build     # type check + bundle to main.js
```

Docs: [setup guide](docs/setup.md) · [troubleshooting](docs/troubleshooting.md)
· [updating](docs/update.md) · [release engineering](docs/release.md) ·
[design notes for reviewers](docs/submission.md) ·
[ADR-001: why a companion app](docs/ADR-001-android-invocation.md) ·
[threat model](docs/threat-model.md) · [protocol](docs/protocol.md) ·
[limitations](docs/limitations.md) · [research notes](docs/research-notes.md).

----
# HOW TO INSTALL THE PLUGIN MANUALLY

1. Copy the entire "native-git-bridge" folder into your vault at:
     ``` 
     (YourVault)/.obsidian/plugins/native-git-bridge/
     ``` 
   After copying it must contain: main.js, manifest.json, styles.css
   (the termux/ folder holds helper scripts; Obsidian ignores it).
 
2. Restart Obsidian (or Settings -> Community plugins -> Reload).
 
3. Settings -> Community plugins -> enable "Native Git Bridge".
 
4. In the plugin settings press "Copy command" and paste the command
   into Termux - everything else is set up automatically (the pairing
   token is imported by the plugin on its own).

----

## License

MIT. Version History Diff (MIT) and obsidian-git were reviewed for integration
(see research notes); no code was copied from either.
