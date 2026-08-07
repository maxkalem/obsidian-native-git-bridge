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

## REPO_EXISTS and other bootstrap questions

- **REPO_EXISTS** — the vault already holds a repository, so "create" and "clone" refuse rather than write over it. If you meant to point it somewhere else, use *Set up repository → Change the remote*; if you really want to start over, remove `.git` in Termux yourself, deliberately.
- **After a clone, files show as modified** — that is the design, not a fault: those files existed in the vault and in the repository, and your versions were kept rather than overwritten. Open one to see the difference; commit to keep yours, discard to take the repository's. Files that exist only in the vault are untracked, exactly as they were.
- **After a clone, files show as deleted** — the repository has files that could not be written into the working tree (a name that collides with a directory, or storage that filled up). The repository itself is fine: *discard* restores them from the index.
- **The repository was created, but the first commit failed** — usually `user.name` / `user.email` are not configured in Termux. The message carries the two commands; run them, then commit from the panel. The repository itself is there and needs no repair.
- **"refusing to merge unrelated histories"** — the vault was made a repository here *and* committed, and the remote it was later pointed at has its own history. They share no commit, so git will not join them. The clean way out is a new empty vault with the repository cloned into it; the deliberate ways (`git pull --allow-unrelated-histories`, or resetting onto the remote branch) are yours to run in Termux. To avoid it entirely: create the repository without the first commit, set the remote, then *Get the repository's content*.
- **"A previous repository is still taking up space"** — a re-clone set the old repository aside instead of deleting it, and it is still there. Delete it from that window (or Settings → *Previous repository copies* → Review) once you are sure nothing in it is needed; "stop reminding" keeps it silently. To look inside first, attach it to the current repository as a remote — the window shows the two commands. Your notes are not involved either way: only history lives in that copy.
- **A clone that seems to hang** — the plugin gives a clone 15 minutes, not the ordinary 90 seconds. Cancelling does not stop the clone inside Termux, but because the repository is only moved into place on success, the vault is either untouched or complete; run *Status* afterwards to see which.

## AUTH after pairing a second vault

Each vault has its own token. A request file copied from one vault into another's runtime folder is rejected (`AUTH`), and a request naming another vault's profile is rejected (`BAD_REQUEST`). If a vault genuinely lost its token, re-pair it (*Pair this vault*) or re-run the installer for it.

## GIT_FAILED on fetch/push: authentication

The runner never answers a prompt (`GIT_TERMINAL_PROMPT=0`), so a credential problem fails fast instead of hanging. Check it in Termux, where the credentials live:

```
GIT_TERMINAL_PROMPT=0 git -C /path/to/vault ls-remote --heads origin
```

- **HTTPS with a PAT.** The token expired, or this repository has no credential helper of its own and the global one belongs to another account. `git -C <vault> config --get credential.helper` shows which one applies; the installer configures a per-repository file when you let it.
- **GitHub OAuth via `gh`.** `gh auth status` says whether the token is still valid and which account is active. `gh auth switch` changes the active account for every repository at once, which is the usual reason one vault suddenly authenticates as the other.
- **SSH.** `ssh -T git@github.com` proves the key. A vault with its own key uses `core.sshCommand`, visible with `git -C <vault> config --get core.sshCommand`.

No credential is ever visible from the plugin side: remote URLs are redacted in results and in `runner.log`.

## SAFETY_BLOCKED: sparse checkout safety check failed

The central guarantee of this plugin. Protected paths appeared as git changes (status or staged), so commit/push/sync stopped before touching anything. This happens when sparse checkout got disabled or its rules changed, or something staged protected paths outside the bridge. Do **not** commit from another tool. Run *Native Git Bridge: Verify sparse safety* to see the exact entries, then *Native Git Bridge: Reapply sparse checkout*.

The repair button is labelled for what it will do, which depends on where the blocking entry lives:

- **Delete files locally** — the paths are files that are new here. All of them go to Obsidian's trash, folders included, file by file.
- **Remove from index** — the paths are staged additions with no file on disk. See below.
- **Delete and unstage** — a mix of the two.

The check re-runs straight afterwards, so the result is visible without asking for it again. Anything the repair could not deal with is listed with a reason rather than skipped.

### "It says the file is added, but the file is not there"

A file staged inside a directory that was added to the sparse exclusions afterwards keeps its index entry when *Reapply sparse checkout* removes it from disk. Sparse checkout sets skip-worktree, so git stops looking at the worktree for that path and reports a bare `A`: the index says "added", and nothing in the output says the file is missing. Deleting had nothing to delete, and unstaging was refused because the path is protected.

**Remove from index** drops the index entry, and nothing else. No file is touched. It is refused for any path that exists in the last commit, since removing one of those would stage a deletion of committed content, which is the accident this check exists to prevent. Those belong in Termux: `git restore --staged -- <path>`.

Nothing here repairs itself. Each button is one explicit, confirmed action.

## CONFLICT: merge conflicts

A pull/sync produced conflicting files; nothing was committed or pushed. The Conflicts group in the status panel lists them with a warning icon. Ways out, all of them explicit, because the bridge never picks a side automatically:

- **Tap a conflicted text file** → the resolution pane: every conflict block shows *LOCAL (yours)* against *REMOTE (branch or commit)* with a Keep button per block. Blocks you leave unresolved are rewritten with Obsidian-safe markers (`-<<<<<<<` / `-=======` / `->>>>>>>`) so the note still renders sanely; both marker forms are understood. Settings → *Show raw conflict markers* switches between hiding the marker lines under the action rows and showing them as real lines.
- **Tap a conflicted binary file** (or long-press any conflicted row) → the Git menu: *keep local version*, *keep remote version* (whole file, confirmed), or *Open in default app* to inspect it first.
- Resolve the file in the editor yourself and stage it.
- The pane follows the same display preferences as the diff panes (line wrapping, whitespace glyphs, custom colours), which is often how a "these two sides look identical" conflict turns out to be a whitespace-only difference.
- *Native Git Bridge: Abort merge* returns to the pre-merge state.

When every conflict is resolved, **Commit** prefills git's own merge message (`Merge branch … # Conflicts: …`) and **Sync** uses it automatically.

## "A merge is already in progress" and no conflicts anywhere

Every pull answers `CONFLICT: A merge is already in progress. Resolve or abort it first.`, while the Conflicts group is empty because everything has already been resolved and staged. The merge is unfinished rather than conflicted: `.git/MERGE_HEAD` still exists, and git will not start another merge until it is gone.

The status panel shows a banner above the file list, in the fixed region, whenever a merge or rebase is unfinished. It offers both exits:

- **Commit merge** — finishes the merge, prefilled with git's own merge message. Enabled only when no path is still conflicted.
- **Abort merge** — `git merge --abort`. The branch returns to where it was before the pull, and conflict resolutions made during the merge are discarded.

An unfinished rebase gets the same banner with *Continue rebase* and *Abort rebase*. Nothing in the plugin starts a rebase, so one arrives here only from Termux. *Continue* is refused while any path is still conflicted, and reports how many: `git rebase --continue` in that state wants an editor, and the runner has no terminal.

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

## A hunk will not stage: "the diff is out of date"

`apply-patch` applies exactly, with no three-way merge and no fuzz. When it fails, the diff the pane was showing no longer matches the file or the index — usually because the file changed after the diff was fetched, in Obsidian or anywhere else. Refresh the diff (close and reopen the pane, or run *Status*) and try the hunk again. Nothing was applied, so there is nothing to undo.

## "Showing 12 of 40 hunks"

The diff was larger than the budget in Settings → *Diff size limit* (100 KB by default). Whole hunks are kept and never a partial one, so what you see is a valid patch and every hunk button on it works.

**Show the whole diff** fetches the rest for that one diff, after a confirmation that names how many lines it is. The setting is untouched; the next diff starts from the configured budget again. The warning counts lines rather than bytes because lines are what the panel pays for: roughly a dozen elements each.

Raise the setting if you routinely read large diffs, and remember it is a per-device choice — it decides how long the pane takes to build, which depends on the phone.

## Still stuck

`~/.config/native-git-bridge/runner.sh` in Termux runs the exact same code path by hand and prints everything. `runner.log` in `<vault>/.obsidian/plugins/native-git-bridge/runtime/` records every run. Nothing else logs anywhere; credentials never appear in either.
