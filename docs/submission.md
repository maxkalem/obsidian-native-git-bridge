# Community plugin submission — design notes for reviewers

This page answers, up front, the questions this plugin predictably raises in a
review. Nothing here asks for an exception without a reason; where a rule is
bent, the reason and the containment are stated.

## What the plugin is

An Android-only Git frontend. Every Git operation is executed by the **real
`git` binary inside Termux**; the plugin never implements Git itself. The
reason is data safety rather than preference: on mobile,
[obsidian-git](https://github.com/Vinzent03/obsidian-git) uses isomorphic-git,
which does not understand a native index containing sparse-checkout /
skip-worktree entries and can stage sparse omissions as mass deletions. Vaults
that use sparse checkout (this one has ~3900 sparse-hidden files) therefore
need native Git.

## How this differs from the Git plugins already in the directory

Every existing mobile approach avoids the native index rather than using it:
isomorphic-git plugins reimplement Git in JavaScript (no sparse checkout, no
skip-worktree), and API-based plugins transfer files over HTTP with no
repository on the device (no local history, no offline commits, no SSH, a token
in plugin settings). Both are perfectly good for a normal full checkout — the
README recommends them for that case. This plugin exists for the case they
cannot serve: a vault that uses sparse checkout, needs offline commits against
a real local repository, and keeps credentials outside the vault entirely.

## Why a companion app is required

A pure Obsidian plugin **cannot** trigger Termux: sending Termux's
`RUN_COMMAND` intent requires the *sending* app to declare
`com.termux.permission.RUN_COMMAND` in its own manifest, which a plugin inside
Obsidian cannot do. A thin companion APK (`companion/`, ~3 small activities, no
state) therefore exists solely to forward that intent. Its scope is
deliberately minimal:

- it executes a **fixed script path**, never anything taken from the URI;
- the URI it receives carries a **request id** and display-only version
  numbers — never the pairing token, never command content;
- it installs nothing and holds no vault access.

Rationale and the rejected alternatives (local HTTP server, Termux:Widget taps,
Tasker) are in [ADR-001](ADR-001-android-invocation.md).

## Nothing runs in the background

There is no server, no listening port, no daemon, no polling loop at rest. The
Termux runner is one-shot: it drains a request queue and exits. The plugin
polls a result file **only while an operation is in flight** (400 ms interval),
and Termux is contacted only because the user ran a command or an enabled
lifecycle event fired.

## Platform behaviour on desktop

`isDesktopOnly` is `false` and correct: the plugin uses no Node or Electron
APIs (no `fs`, `path`, `crypto`, `child_process`, no `require`). It loads fine
on desktop, where it disables every operation and says why — the settings tab
shows a single explanation instead of settings, since all settings are
device-local and could not do anything there. Desktop users are pointed at
plain Git or obsidian-git.

## Answers to the automated review's recommendations

### Clipboard access

Used in exactly one direction — **writing** — for three things the user asked
for: the Termux install command, a download link, and a "copy details" button on
result windows (so a failure can be pasted into an issue). The plugin never
reads the clipboard.

### `localStorage` instead of the plugin data API

Deliberate, and load-bearing. The plugin folder itself is synced through Git in
this workflow, so `data.json` reaches every device. Anything device-specific
(the enable flag, the pairing token, protected paths, timeouts, the last seen
runner/companion versions) must **not** travel: a token or an absolute Termux
path from another phone is at best useless and at worst dangerous.
`data.json` therefore holds only cosmetic shared preferences. The store is
scoped by vault identity, degrades to an in-memory map when storage is
unavailable, and reports that state in diagnostics.

### Extra files in the release

`bootstrap.sh`, `install.sh`, `native-git-bridge-runner.sh` and the companion
APK are attached on purpose. Obsidian ignores them; the **Termux installer**
does not: the one-line install command fetches the scripts from the release
matching the plugin version, which is what keeps plugin and runner in step (see
[update.md](update.md)). Removing them would leave the installer pulling from a
moving branch instead.

## Deviations from the guidelines, and why

### Adapter API instead of Vault API

The Vault API cannot see the two file groups this plugin must touch:

- the request/result files under
  `<vault>/.obsidian/plugins/native-git-bridge/runtime/` (inside the config
  directory, which the Vault API does not expose), and
- `.gitignore` at the vault root (a dotfile, which the Vault API ignores).

All other file work goes through the adapter for the same reason. No user note
is ever written by this plugin.

### Four private-API uses

Each is optional, defensively typed (`as unknown as {...}` with `?.`), and
degrades silently if the API changes:

| Use | Why it is needed | If it disappears |
|------|------------------|------------------|
| `app.appId` | Scopes device-local settings per installation, so a plugin folder synced through Git cannot leak one device's token/paths to another. A persisted random id is used as a fallback. | Falls back to the generated id |
| `app.plugins.enabledPlugins` | Detects an **active** obsidian-git on the same Android device and warns once — this is the data-loss scenario described above, not a rivalry. The plugin never disables another plugin. | No warning is shown |
| `app.loadLocalStorage` | Reads obsidian-git's own device-local "disabled on this device" flag, so the warning is not shown when the user already took the recommended action. | Falls back to `window.localStorage`, then to showing the warning |
| `app.openWithDefaultApp` | "Open in default app" on a conflicted file the resolution pane cannot display (binary), so the user can inspect it before choosing a side. Not in the mobile typings. | A notice explains the action is unavailable |

### The settings tab still implements `display()`

The declarative settings API (`getSettingDefinitions`, 1.13.0+) is the intended
direction and this tab has not migrated yet. Its four rule managers are
per-item editors with live lists, and the version panel renders warnings with
action buttons; porting them to definitions with `render` callbacks is a
focused change that deserves its own release and on-device testing rather than
being bundled with a lint pass. Internal refreshes already call `update()`
where it exists, falling back to `display()` on older builds.

## Security posture

- The runner receives **JSON** and calls `git` with **argv arrays** only —
  never a concatenated shell string — behind an action allow-list.
- Every path argument is validated on both sides: repository-relative, no
  `..`, no absolute or home paths, no control characters, no `.git` segment
  (case-insensitively, because Android shared storage is case-insensitive),
  and no Git pathspec magic (`:/`, `:(exclude)`).
- Credentials never touch the plugin: authentication lives entirely in Termux
  (PAT via credential helper, or SSH). Remote URLs are redacted in logs and
  results; the pairing token is never logged.
- No force push, no root, no destructive auto-repair. Restores, discards and
  merge aborts require explicit typed confirmation.
- Before any commit or push, protected sparse paths must show no Git changes,
  or the operation is blocked. Staging uses pathspec excludes, so protected
  paths cannot enter the index through the bridge at all.
- The diff pane renders git's unified diff through the bundled
  **diff2html** library (MIT, render-only — no JavaScript Git implementation
  is involved), and its HTML output is inserted exclusively via Obsidian's
  `sanitizeHTMLToDom`, never raw `innerHTML`.

Full model, including accepted residual risks and a dated review log:
[threat-model.md](threat-model.md).

## Testing

`npm test` runs 146 unit tests (parsers with seeded fuzzing over unicode,
quoted paths, CRLF and truncated output; bridge recovery paths; plugin
orchestration against an in-memory vault). `npm run test:e2e` runs 154 checks
against a **real** Git repository with a non-cone sparse checkout, covering
conflicts, protected-path violations, payloads above the 128 KB `execve` limit,
concurrency, interruption, detached HEAD, non-fast-forward rejection, unborn
branches and an expired PAT.

What is **not** machine-verified: there is no Android device or emulator in CI.
The APK builds are verified; RUN_COMMAND forwarding, storage permissions and
the Termux round trip are verified by hand on a device, which is exactly why the
companion ships a three-step verified checklist.

## Distribution of the companion APK

Built and signed by the release workflow and attached to each GitHub release as
`git-bridge-companion-<version>.apk`, carrying the same version number as the
plugin. It is signed with a private release key (not a shared test key), so
Android update-installs it over the previous version and a forged "update"
cannot be installed on top of it.
