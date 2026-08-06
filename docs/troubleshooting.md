# Troubleshooting

Every failed operation shows an error code. Find yours below. When in doubt, run *Native Git Bridge: Check bridge* (local, instant) and *Native Git Bridge: Diagnostics* (full Termux round trip), and check the operation log (Settings → Native Git Bridge → Advanced → Operation log, or the *Open operation log* command).

## TIMEOUT: the plugin stopped waiting

The request never got an answer. The plugin writes a cancel flag, so the operation will **not** execute later, and runs the local bridge check automatically. The companion (≥ 0.4.0) acknowledges every trigger back to the plugin, which splits the diagnosis in two:

- **No acknowledgement.** The trigger never reached the companion. The plugin opens the companion's checklist automatically (once per session); if neither an ack nor an app switch follows, it offers the APK download link, because that means the companion is not installed at all.
- **Acknowledged but no result.** The companion is fine; the break is further down (Termux force-stopped, runner missing/outdated, wrong vault path). See the bridge-check verdict.

In order of likelihood:

1. **Companion app missing or unpermitted.** Open the companion; all three checklist items must be green.
2. **No profile for this vault.** The local check reports when `runner.log` has never appeared in *this* vault's runtime folder: no Termux profile points here (a second vault that was never paired, or the installer was pointed at another path). Use *Pair this vault* in the settings or the setup guide, or re-run the install command with this vault's path. Other vaults keep their own profiles and tokens.
3. **Termux is closed or was force-stopped** (swiped away, or battery optimization killed it). Android then refuses to start its background service, so the trigger arrives at the companion but never reaches the runner. The companion detects this case and opens Termux for you (toast: "Termux is closed…"); Bridge check also offers an **Open Termux** button. Keep Termux running (its persistent notification is enough) and consider excluding it from battery optimization.
4. **A very slow network operation.** Raise the timeout in settings; the runner itself caps network git at 120 s per command.

Recovery path: run `~/.config/native-git-bridge/runner.sh` by hand in Termux and watch its output.

## AUTH: pairing token mismatch

The plugin and the runner hold different tokens (usually after re-running the installer on a device where the plugin had already paired). Re-running the installer keeps the existing token, so this normally heals on the next plugin start (it imports `pairing.json`). If not: plugin settings → pairing → import or paste the token printed at the end of the install output.

## REPO_MISSING: the profile's repository is gone

The runner knows a profile for this vault, but the directory it points at no longer exists, is unreadable, or is no longer a git work tree of its own. Nothing was executed.

- **The vault was moved.** Trigger any operation again: on a run with nothing else to do the runner scans shared storage, finds the marker the vault carries (`runtime/profile.json`) and follows it, keeping the profile and the token.
- **The `.git` directory is gone.** Restore or re-clone the repository. If the vault sits inside another vault's repository, the runner deliberately refuses to fall back to the outer one — that is the whole point of the ceiling it sets around each repository.
- **The vault was deleted.** The profile stays behind and is reported, not silently reused. Delete `~/.config/native-git-bridge/profiles/<id>.conf` to clean up.
- **Dubious ownership** (shared storage owned by another uid): the message names the exact command, `git config --global --add safe.directory "<path>"`.

## AUTH after pairing a second vault

Each vault has its own token. A request file copied from one vault into another's runtime folder is rejected (`AUTH`), and a request naming another vault's profile is rejected (`BAD_REQUEST`). If a vault genuinely lost its token, re-pair it (*Pair this vault*) or re-run the installer for it.

## SAFETY_BLOCKED: sparse checkout safety check failed

The central guarantee of this plugin. Protected paths appeared as git changes (status or staged), so commit/push/sync stopped before touching anything. This happens when sparse checkout got disabled or its rules changed, or something staged protected paths outside the bridge. Do **not** commit from another tool. Run *Native Git Bridge: Verify sparse safety* to see the exact entries, then *Native Git Bridge: Reapply sparse checkout*. If entries remain staged, unstage them in Termux (`git restore --staged -- <path>`), then verify again. The bridge never auto-repairs here by design.

## CONFLICT: merge conflicts

A pull/sync produced conflicting files; nothing was committed or pushed. The Conflicts group in the status panel lists them with a warning icon. Ways out, all of them explicit, because the bridge never picks a side automatically:

- **Tap a conflicted text file** → the resolution pane: every conflict block shows *LOCAL (yours)* against *REMOTE (branch or commit)* with a Keep button per block. Blocks you leave unresolved are rewritten with Obsidian-safe markers (`-<<<<<<<` / `-=======` / `->>>>>>>`) so the note still renders sanely; both marker forms are understood. Settings → *Show raw conflict markers* switches between hiding the marker lines under the action rows and showing them as real lines.
- **Tap a conflicted binary file** (or long-press any conflicted row) → the Git menu: *keep local version*, *keep remote version* (whole file, confirmed), or *Open in default app* to inspect it first.
- Resolve the file in the editor yourself and stage it.
- *Native Git Bridge: Abort merge* returns to the pre-merge state.

When every conflict is resolved, **Commit** prefills git's own merge message (`Merge branch … # Conflicts: …`) and **Sync** uses it automatically.

## "Runner too old" / an action the runner rejects

`BAD_REQUEST: action not allowed` from an up-to-date plugin means the runner in Termux predates the action. The plugin catches the common cases before spending a round trip and names the required version. Update the runner (see [update.md](update.md)); what each runner version supports is listed in [protocol.md → Runner version history](protocol.md#runner-version-history).

## GIT_FAILED: git itself said no

The result carries git's stdout/stderr (Copy button in the modal). Common cases and their meaning:

- `Authentication failed` / `could not read Username`: expired or missing PAT. Fix credentials in Termux (e.g. `git pull` once interactively to re-enter the PAT into the credential store). The runner never prompts; it fails fast.
- `[rejected] ... fetch first` / `non-fast-forward`: the remote moved ahead. Run *Sync* (fetch + merge + push) instead of a bare push. Force push does not exist in this bridge.
- `Detached HEAD; refusing to push`: check out a branch in Termux. The bridge never guesses which branch you meant.
- `user.name / user.email are not configured`: run the two `git config --global` commands shown in the message, in Termux.

## BAD_REQUEST: invalid request

An unknown action, invalid path (absolute, `..`, inside `.git`, git pathspec magic), over-long commit message, or malformed arguments. When triggered by normal UI use this indicates a plugin/runner version mismatch; see RUNNER_INTERNAL below.

## RUNNER_INTERNAL: the runner could not finish

A serialization failure (see `runner.log` in the runtime folder), or a request that was interrupted twice and given up on. Most commonly the runner is simply **outdated**: updating the plugin never updates the runner. Re-run the install command (Settings → Copy command); the plugin's version handshake tells you explicitly when this is the case.

## EXPIRED: a stale request was skipped

The runner found a request whose creation time was long past (plugin no longer waiting). It answered EXPIRED instead of executing, because a days-old sync must never surprise you with a commit. Just run the operation again.

## CANCELLED

You cancelled, or a timed-out request was later archived. Nothing was executed (a git command already mid-flight is never killed mid-index-write; cancellation applies between steps).

## FILE_ABSENT / TOO_LARGE (history views)

The file does not exist at that commit (rename? use the file history view, which follows renames), or is beyond the 1 MB view limit at that commit.

## Restoring one block from the file history did nothing

The file-history panel restores a block only when the current file still contains it exactly as it was before or after that commit. If the note has drifted since, the plugin refuses instead of guessing where the block belongs, and says so. Restore the whole file version from that commit, or copy the lines by hand from the expanded diff.

## A move shows as a deletion plus an untracked file

That is git, not the panel. Rename detection compares the index, so a file moved in the working tree is a deletion and a new untracked file until the change is staged; `git status --find-renames` does not change it. Stage both halves (the "+" buttons on the Changes and Untracked groups, or Stage all) and the two rows collapse into one "renamed" row that shows the old path.

## Still stuck

`~/.config/native-git-bridge/runner.sh` in Termux runs the exact same code path by hand and prints everything. `runner.log` in `<vault>/.obsidian/plugins/native-git-bridge/runtime/` records every run. Nothing else logs anywhere; credentials never appear in either.
