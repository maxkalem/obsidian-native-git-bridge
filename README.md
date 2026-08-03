# Obsidian Native Git Bridge

Native Git for Obsidian on **Android**, executed by the real `git` binary inside
**Termux** — with first-class **sparse checkout** support. No isomorphic-git, no
HTTP server, no open ports, nothing running in the background.

> Status: Phase 2 prototype — status, sparse-safety verification, sparse
> reapply, diagnostics, operation log, cancellation. Pull/commit/push/sync land
> in Phase 3 (see `docs/`).

## Why

[obsidian-git](https://github.com/Vinzent03/obsidian-git) uses isomorphic-git on
mobile, which does not understand a native Git index containing
sparse-checkout / skip-worktree data — it can misread sparse omissions as mass
deletions. This plugin delegates every Git operation to native Git in Termux
through a file-based request/response protocol, and hard-blocks any commit/push
in which protected sparse paths appear as changes.

## How it works

1. You run a command (e.g. *Native Git: Status*).
2. The plugin writes `runtime/requests/<id>.json` inside the plugin folder
   (locally excluded from Git via `.git/info/exclude`).
3. Depending on the integration type:
   - **Termux widget (default, documented):** you tap the pinned *GitBridge*
     shortcut; Termux runs the runner script once as a background task.
   - **Companion intent (experimental):** a custom-scheme URI starts a minimal
     companion app that forwards a RUN_COMMAND intent to Termux (see
     `docs/ADR-001-android-invocation.md` for why this needs a companion app).
4. The runner validates the pairing token, the action allow-list and all paths,
   runs git with argv arrays, writes `runtime/results/<id>.json` atomically and
   **exits**.
5. The plugin (polling only while the operation is in flight) renders the result.

## Install (Termux side)

```
# inside Termux, from the plugin folder of your vault:
bash .obsidian/plugins/native-git-bridge/termux/install.sh /storage/emulated/0/<YourVault>
```

The installer installs `git`+`jq`, links shared storage, verifies the repo and
sparse checkout, installs the runner and the `GitBridge` widget task, excludes
the runtime dir locally, runs a self-test, and prints the pairing token to paste
into the plugin settings. Credentials (SSH keys, credential helper, `gh`) stay
entirely inside Termux; the plugin never stores or sees them.

## Sparse checkout safety

Configure protected paths (defaults: `Private/AgentsMemory`, `Projects/Backus`)
in the settings. Before any commit or push the bridge runs

```
git status --porcelain=v1 -- "Private/AgentsMemory" "Projects/Backus"
git diff --cached --name-status -- "Private/AgentsMemory" "Projects/Backus"
```

and blocks the operation if either reports anything. Sparse omissions are never
treated as deletions, and there is no automatic destructive "repair".

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

Docs: `docs/ADR-001-android-invocation.md`, `docs/threat-model.md`,
`docs/protocol.md`, `docs/limitations.md`, `docs/research-notes.md`.

## License

MIT. Version History Diff (MIT) and obsidian-git were reviewed for integration
(see research notes); no code was copied from either.
