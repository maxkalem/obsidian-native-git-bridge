# Community plugin submission: design notes for reviewers

This page answers, up front, the questions this plugin predictably raises in a review. Nothing here asks for an exception without a reason; where a rule is bent, the reason and the containment are stated.

## What the plugin is

An Android-only Git frontend. Every Git operation is executed by the **real `git` binary inside Termux**; the plugin never implements Git itself. The reason is data safety rather than preference: on mobile, [obsidian-git](https://github.com/Vinzent03/obsidian-git) uses isomorphic-git, which does not understand a native index containing sparse-checkout / skip-worktree entries and can stage sparse omissions as mass deletions. Vaults that use sparse checkout (this one has ~3900 sparse-hidden files) therefore need native Git.

## How this differs from the Git plugins already in the directory

Every existing mobile approach avoids the native index rather than using it: isomorphic-git plugins reimplement Git in JavaScript (no sparse checkout, no skip-worktree), and API-based plugins transfer files over HTTP with no repository on the device (no local history, no offline commits, no SSH, a token in plugin settings). Both are perfectly good for a normal full checkout. The README recommends them for that case. This plugin exists for the case they cannot serve: a vault that uses sparse checkout, needs offline commits against a real local repository, and keeps credentials outside the vault entirely.

## Why a companion app is required

A pure Obsidian plugin **cannot** trigger Termux: sending Termux's `RUN_COMMAND` intent requires the *sending* app to declare `com.termux.permission.RUN_COMMAND` in its own manifest, which a plugin inside Obsidian cannot do. A thin companion APK (`companion/`, ~3 small activities, no state) therefore exists solely to forward that intent. Its scope is deliberately minimal:

- it executes a **fixed script path**, never anything taken from the URI;
- the URI it receives carries a **request id** and display-only version numbers, never the pairing token and never command content;
- it installs nothing and holds no vault access.

Rationale and the rejected alternatives (local HTTP server, [Termux:Widget](https://github.com/termux/termux-widget) taps, Tasker) are in [ADR-001](ADR-001-android-invocation.md).

## Nothing runs in the background

There is no server, no listening port, no daemon, no polling loop at rest. The Termux runner is one-shot: it drains a request queue and exits. The plugin polls a result file **only while an operation is in flight** (400 ms interval), and Termux is contacted only because the user ran a command or an enabled lifecycle event fired.

## Platform behaviour on desktop

`isDesktopOnly` is `false` and correct: the plugin uses no Node or Electron APIs (no `fs`, `path`, `crypto`, `child_process`, no `require`). It loads fine on desktop, where it disables every operation and says why. The settings tab shows a single explanation instead of settings, since all settings are device-local and could not do anything there. Desktop users are pointed at plain Git or obsidian-git.

## Answers to the automated review's recommendations

### Dynamic code execution

An earlier build was flagged for `new Function()`. It came from `hogan.js`, the Mustache compiler inside `diff2html`, which was the plugin's only runtime dependency and built its output as an HTML string from compiled templates.

That dependency has been removed. The diff panes parse the unified diff and build the DOM directly (`src/git/unifiedDiff.ts`, `src/git/inlineDiff.ts`, `src/ui/diffDom.ts`). This also removed the HTML-string round trip through `sanitizeHTMLToDom` and 92 KB of bundle. `package.json` now declares no `dependencies`, so the shipped `main.js` contains only this repository's own source, which is what the reproducible-build check compares against.

The intra-line highlighting is a longest common subsequence over tokens, written from the algorithm and unit-tested as a pure function. It compares words by default: `diff2html` was configured with `diffStyle: "char"` and rendered "brown" → "red" as `<del>b</del>r<del>own</del>`, the two sharing an `r`, which is minimal and hard to read in prose. Characters are available as a setting, because a path, an identifier or a number is a case where one letter is the whole edit. The character mode is a second pass over the stretches the word pass already marked as changed, rather than a single comparison over the whole line: a line-wide character LCS would put the algorithm's O(n·m) ceiling at a few hundred characters, which is shorter than an ordinary paragraph, and every paragraph would come back reported as wholly changed. The same function answers the same question for the conflict pane, which compares the local block against the remote one line by line.

### Inline CSS variables for the optional custom colours

The diff and conflict panes write CSS custom properties onto their own root element with `element.style.setProperty`. These are not style declarations that could live in the stylesheet: they are how an opt-in user preference overrides the stylesheet's defaults on the same element, and removing the property returns control to the theme without a reload. Values are validated as hex before being written, the defaults come from theme variables, and with the toggle off (the default) no inline style is written.

### Clipboard access

Used in exactly one direction, **writing**, for three things the user asked for: the Termux install command, a download link, and a "copy details" button on result windows (so a failure can be pasted into an issue). The plugin never reads the clipboard.

### `localStorage` instead of the plugin data API

This is intentional. The plugin folder itself is synced through Git in this workflow, so `data.json` reaches every device. Anything device-specific (the enable flag, the pairing token, protected paths, timeouts, the last seen runner/companion versions) must **not** travel: a token or an absolute Termux path from another phone is at best useless and at worst dangerous. `data.json` therefore holds only cosmetic shared preferences: status-bar and ribbon visibility, diff line wrapping, invisible-character glyphs, whether changed lines are compared by word or by character, whether line-selection mode survives opening another file, raw conflict markers, the list/tree layout choice, and the optional custom pane colours (a boolean plus two sets of hex values, validated as hex before they are ever written into a `style` attribute). The status auto-refresh interval is device-local for the same reason: it decides how often a device wakes Termux. So is whether deleting an untracked file moves it to Obsidian's trash (the default) or removes it from disk, since that decides whether `.trash` grows on this particular device, and so is how many rows the status panel draws per group, which buys render time on the device that has to draw them. The store is scoped by vault identity, degrades to an in-memory map when storage is unavailable, and reports that state in diagnostics.

### Extra files in the release

`bootstrap.sh`, `install.sh`, `native-git-bridge-runner.sh` and the companion APK are attached on purpose. Obsidian ignores them; the **Termux installer** does not: the one-line install command fetches the scripts from the release matching the plugin version, which is what keeps plugin and runner in step (see [update.md](update.md)). Removing them would leave the installer pulling from a moving branch instead.

## Deviations from the guidelines, and why

### Adapter API instead of Vault API

The Vault API cannot see the two file groups this plugin must touch:

- the request/result files under `<vault>/.obsidian/plugins/native-git-bridge/runtime/` (inside the config directory, which the Vault API does not expose), and
- `.gitignore` at the vault root (a dotfile, which the Vault API ignores).

All other file work goes through the adapter for the same reason. No user note is ever written by this plugin.

### Four private-API uses

Each is optional, defensively typed (`as unknown as {...}` with `?.`), and degrades silently if the API changes:

| Use | Why it is needed | If it disappears |
|------|------------------|------------------|
| `app.appId` | Scopes device-local settings per installation, so a plugin folder synced through Git cannot leak one device's token/paths to another. A persisted random id is used as a fallback. | Falls back to the generated id |
| `app.plugins.enabledPlugins` | Detects an **active** obsidian-git on the same Android device and warns once. This is the data-loss scenario described above, not a rivalry. The plugin never disables another plugin. | No warning is shown |
| `app.loadLocalStorage` | Reads obsidian-git's own device-local "disabled on this device" flag, so the warning is not shown when the user already took the recommended action. | Falls back to `window.localStorage`, then to showing the warning |
| `app.openWithDefaultApp` | "Open in default app" on a conflicted file the resolution pane cannot display (binary), so the user can inspect it before choosing a side. Not in the mobile typings. | A notice explains the action is unavailable |

### The settings tab still implements `display()`

The declarative settings API (`getSettingDefinitions`, 1.13.0+) is the intended direction and this tab has not migrated yet. Its four rule managers are per-item editors with live lists, and the version panel renders warnings with action buttons; porting them to definitions with `render` callbacks is a focused change that deserves its own release and on-device testing rather than being bundled with a lint pass. Internal refreshes already call `update()` where it exists, falling back to `display()` on older builds.

## Several repositories on one device

Since runner v10 the Termux side keeps one profile per paired vault (`~/.config/native-git-bridge/profiles/<id>.conf`, mode 600), each with its own token, and one runner run drains them all. Points a reviewer may want to check:

- The plugin never sends a repository path. A request may carry an opaque `profileId`; the runner **looks it up** in files only Termux can write and rejects anything else. A token valid for one vault is rejected for another.
- Profile files are parsed, never sourced, so a damaged or tampered file cannot execute anything.
- Each profile is entered with `cd` plus `GIT_CEILING_DIRECTORIES` and a `--show-toplevel` check, so a vault nested inside another vault's repository can never operate on the outer one.
- A vault nested inside another is excluded from the outer repository through the **outer repository's `.git/info/exclude`** — device-local, never synced, and no tracked file (such as `.gitignore`) is edited.
- Pairing a second vault from the plugin writes a claim file that carries no secret; the token is generated in Termux and comes back in `pairing.json`. Nothing the claim contains is trusted. Residual risk and its bounds: [threat-model.md](threat-model.md) T12–T14.

Rationale and the rejected alternatives: [ADR-002](ADR-002-multiple-repositories.md).

## "Install or update themselves or their dependencies"

Worth addressing head-on, because this plugin syncs vaults and many such vaults track `.obsidian/`.

The plugin never updates itself. It downloads nothing, contacts no server of ours, and has no auto-update path: a new `main.js` can only arrive the way any other file in the user's repository arrives — because the user ran pull, sync or clone against **their own remote**. The plugin treats its own files exactly like any other tracked path; it does not detect, prefer or reload them. That is the same behaviour any Git client has in a vault whose configuration directory is tracked, including [obsidian-git](https://github.com/Vinzent03/obsidian-git), and it is the user's data rather than a distribution channel.

Where it could surprise someone, we say so rather than hide it: after a clone that brings in the configuration directory, the plugin tells the user to restart Obsidian, because the app read that configuration at startup and holds it in memory. The README discloses this under *What this plugin accesses*.

## Security posture

- The runner receives **JSON** and calls `git` with **argv arrays** only, never a concatenated shell string, behind an action allow-list.
- Every path argument is validated on both sides: repository-relative, no `..`, no absolute or home paths, no control characters, no `.git` segment (case-insensitively, because Android shared storage is case-insensitive), and no Git pathspec magic (`:/`, `:(exclude)`).
- Credentials never touch the plugin: authentication lives entirely in Termux (PAT via credential helper, SSH, or GitHub's OAuth device flow through `gh`). Remote URLs are redacted in logs and results; the pairing token is never logged.
- No force push, no root, no destructive auto-repair. Restores, discards and merge aborts require explicit typed confirmation.
- Before any commit or push, protected sparse paths must show no Git changes, or the operation is blocked. Staging uses pathspec excludes, so protected paths cannot enter the index through the bridge at all.
- The diff pane parses git's unified diff and builds the DOM node by node (`src/git/unifiedDiff.ts`, `src/ui/diffDom.ts`). No JavaScript Git implementation is involved, no HTML string is assembled, and no `innerHTML` is written. This replaced the bundled diff2html in 0.6.2 and left the plugin with no runtime dependencies at all.

Full model, including accepted residual risks and a dated review log: [threat-model.md](threat-model.md).

## Testing

`npm test` runs 685 unit tests (parsers with seeded fuzzing over unicode, quoted paths, CRLF and truncated output; the plugin id against the id in `manifest.json` and against the segment the Termux scripts hardcode; the panels' wait indicators, so a request that finishes leaves no timer behind and cannot take down the indicator a later request is using; refreshing a panel while a request is in flight, which must neither start a second request nor show the answer to the first as the result of the refresh; the unified-diff parser and the intra-line diff in both units; the rendered diff DOM, asserted against the class names the stylesheet is keyed to; conflict-marker parsing, per-block resolution and the conflict pane’s own intra-line comparison; path-tree grouping; panel layout, including which region each control lands in on a phone versus desktop, and which hunk controls stay usable while nothing is selected; bridge recovery paths; plugin orchestration against an in-memory vault). `npm run test:e2e` runs 557 checks against a **real** Git repository with a non-cone sparse checkout, covering conflicts and their resolution, index-vs-worktree diffs, protected-path violations, payloads above the 128 KB `execve` limit, concurrency, interruption, detached HEAD, non-fast-forward rejection, unborn branches, an expired PAT, several profiles on one device (migration of a single-repo config, sibling and nested vaults, token and profile isolation, a moved repository, a deleted one, a corrupt profile file), repository bootstrap (init, set-remote, and cloning into a vault that already holds files), the three states that had no exit (a protected sparse path stranded in the index, an unfinished rebase, and a file changed locally that the incoming merge also changes — which git refuses to merge over whether or not the content would conflict), and hunk-level staging: the same patch applied to the index and to the working tree, forward and reversed, refused for a second path, a protected path, a traversal path and a patch that no longer applies; and what the installer reports about the profiles already on the device, including the ones whose vault is gone.

What is **not** machine-verified: there is no Android device or emulator in CI. The APK builds are verified; RUN_COMMAND forwarding, storage permissions and the Termux round trip are verified by hand on a device. That is also why the companion ships a three-step verified checklist.

## Distribution of the companion APK

Built and signed by the release workflow and attached to each GitHub release as `git-bridge-companion-<version>.apk`, carrying the same version number as the plugin. It is signed with a private release key (not a shared test key), so Android update-installs it over the previous version and a forged "update" cannot be installed on top of it.

## Licensing

The plugin, the Termux runner and the companion app are one work under the **GNU General Public License, version 3** (`LICENSE`, SPDX `GPL-3.0-only`). The choice is deliberate: the point of this project is a Git frontend that a user can inspect, and a proprietary derivative of it would be exactly the thing it exists to avoid.

`package.json` declares no runtime dependencies, so nothing third-party is bundled into `main.js`. One piece of third-party material is redistributed and is marked as such: the diff rules in `styles.css` and the `d2h-*` class names are adapted from [diff2html](https://github.com/rtfpessoa/diff2html)'s MIT-licensed stylesheet, and the MIT notice sits beside them in the file. MIT material may be redistributed inside a GPLv3 work provided its notice travels with it, which is why the notice is kept rather than folded away. The library itself was removed in 0.6.2.

No code was taken from [obsidian-git](https://github.com/Vinzent03/obsidian-git) or [Version History Diff](https://github.com/kometenstaub/obsidian-version-history-diff). Both were read as references while deciding what users expect from a Git panel; the reasoning is recorded in [research-notes.md](research-notes.md) and [ADR-001-android-invocation.md](ADR-001-android-invocation.md).
