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
- **A clone that seems to hang** — the plugin gives a clone an hour, not the ordinary 90 seconds. Cancelling does not stop the clone inside Termux, but because the repository is only moved into place on success, the vault is either untouched or complete; run *Status* afterwards to see which.

## AUTH after pairing a second vault

Each vault has its own token. A request file copied from one vault into another's runtime folder is rejected (`AUTH`), and a request naming another vault's profile is rejected (`BAD_REQUEST`). If a vault genuinely lost its token, re-pair it (*Pair this vault*) or re-run the installer for it.

## A clone asks for credentials

A private https remote needs a username and a token, credentials live only in Termux, and the runner never answers a prompt — so the download happens in a terminal, as a plain `git clone`. The plugin copies a ready command to the clipboard and opens Termux: paste it (long-press → Paste), press Enter, and answer git's questions. It is ordinary git, so the progress meter and the prompts are the ones you know; the password prompt shows nothing while you type, which is normal. What you enter is saved for this repository, so fetch, pull and push work without asking afterwards.

When the download finishes, come back to Obsidian and press **Continue** in the same window: the downloaded repository is moved into the vault without a second download, and your existing notes are treated exactly as in an ordinary clone — nothing is overwritten. Pressing Continue too early is safe: the plugin says the download has not finished and you simply try again. If the download was interrupted, run the copied command again — it starts clean.

This needs runner v15; on an older runner the plugin says so and offers the runner update command instead. SSH remotes never take this route (a key does not prompt), and a re-clone of a repository whose credentials are already set up runs through the companion as always.

## "Another git process seems to be running" (a stale index.lock)

`.git/index.lock` guards the repository while one git process writes. A process the system kills mid-write leaves it behind, and every later operation then fails with `Unable to create '….git/index.lock': File exists`. No git process is actually running — the lock is a leftover.

Every failure window carrying that message offers **Delete the stale lock…**. To make the removal safe, it first stops every Termux process (including a terminal session, if you have one open — the runner arrives in a fresh Termux started by the trigger) and only then deletes the file, so nothing can be holding the lock when it goes. Do not use it while a download you started in Termux is still visibly working; let that finish first.

## A long clone or fetch dies with `Killed`

`Killed` in the terminal (or a result saying the command was killed by the system) is not git failing — it is Android. Two mechanisms produce it: the out-of-memory killer, and the "phantom process" limit Android 12+ applies to background apps' child processes, both delivered as SIGKILL with no further explanation. ChromeOS runs Android apps in a VM where memory is tighter still.

What helps, in order of effort: keep Termux visible in the foreground for the whole transfer (a backgrounded app's processes are the first to go); choose the lightweight clone (`blob:none`), which transfers a fraction of the data; and, as the permanent fix for the phantom-process half, disable the limit once via adb — `adb shell settings put global settings_enable_monitor_phantom_procs false` — as described in Termux's own documentation.

A killed clone changes nothing in the vault (the repository is only moved into place on success); run it again.

## GIT_FAILED on fetch/push: authentication

The runner never answers a prompt on an ordinary run (`GIT_TERMINAL_PROMPT=0`), so a credential problem fails fast instead of hanging. Check it in Termux, where the credentials live:

```
GIT_TERMINAL_PROMPT=0 git -C /path/to/vault ls-remote --heads origin
```

- **HTTPS with a PAT.** The token expired, or this repository has no credential helper of its own and the global one belongs to another account. `git -C <vault> config --get credential.helper` shows which one applies; the installer configures a per-repository file when you let it.
- **GitHub OAuth via `gh`.** `gh auth status` says whether the token is still valid and which account is active. `gh auth switch` changes the active account for every repository at once, which is the usual reason one vault suddenly authenticates as the other.
- **SSH.** `ssh -T git@github.com` proves the key. A vault with its own key uses `core.sshCommand`, visible with `git -C <vault> config --get core.sshCommand`.

No credential is ever visible from the plugin side: remote URLs are redacted in results and in `runner.log`.

## An operation finished after you closed Obsidian

The runner is one-shot and keeps going once it has been triggered, so an operation can finish in Termux with Obsidian already gone. Its result is picked up on the next start, and from 0.6.3 it is treated exactly like a live one: the fresh status it carries is applied, and a failure is reported the way it would have been at the time, which is what puts a conflict window back on screen. It used to be recorded in the operation log and otherwise dropped, so a pull that had left the repository mid-merge produced no error at all and the panel opened with no status.

## SAFETY_BLOCKED: sparse checkout safety check failed

The central guarantee of this plugin. Protected paths appeared as git changes (status or staged), so commit/push/sync stopped before touching anything. This happens when sparse checkout got disabled or its rules changed, or something staged protected paths outside the bridge. Do **not** commit from another tool. Run *Native Git Bridge: Verify sparse safety* to see the exact entries, then *Native Git Bridge: Reapply sparse checkout*.

The repair button is labelled for what it will do, which depends on where the blocking entry lives:

- **Delete files locally** — the paths are files that are new here. All of them go to Obsidian's trash, folders included, file by file. The sparse repair always uses the trash, whatever *Delete new files permanently* is set to: it is repairing a state the user did not ask for, so it does not get to be the irreversible one.
- **Remove from index** — the paths are staged additions with no file on disk. See below.
- **Delete and unstage** — a mix of the two.

### The sparse repair says it worked, and the same paths come back

Fixed in runner v13. Before it, a protected path whose name contained a space or a character outside ASCII — an em dash in a note title is enough — could not be cleared at all: git prints such a path quoted and octal-escaped, the repair compared that against the real name, decided the entry was already gone, and reported success having removed nothing. Sync then blocked on the same list, forever.

If you see this, the runner is older than the plugin. Update it (Settings shows the version, the companion has an "Update runner" button) and repair again.

### Sending a log to someone

The operation log window has **Share as file**. It writes one file carrying every source of evidence — the plugin's log, the output behind each entry (which is where git's own reason usually is), `runtime/runner.log` from the Termux side, and the progress streams of the last few operations — and hands it to Android's share sheet.

The streams are the ones worth knowing about, because they are the only account of an operation that produced no result at all. A fetch killed by the timeout leaves no entry detail and no runner verdict, but its stream stops at the percentage it reached, which is the difference between a bridge that was working and one that was stuck.

Credentials are redacted from both halves on the way in, including the Termux log, which is the one that can pick up a remote URL with a token in it from git's own output.

The file is written into the plugin's `runtime/` folder, which the installer excludes from git, so it can never appear as a change in the repository it describes.

Android's share sheet is not reachable from inside Obsidian, and the companion app cannot reach the file either: it holds exactly one permission, to run the Termux runner, and reading shared storage is not it — giving it that access to send a log would cost more than the log is worth. So the window offers two routes instead. **Copy details** puts the whole bundle on the clipboard. **Save as a note to share** writes a second copy into the vault root and opens it, where Obsidian's own note menu has Share.

That second copy is an ordinary file in the vault, so it appears as an untracked change until you delete it. That is why it is a separate button rather than what the plugin does by default.

### An operation seems to hang

**Tap the state line** — the one counting the seconds in the Git panel. It opens the output panel, which shows what Termux is saying while it says it.

The panel has four things in it, in the order they answer the question:

- **The stream.** git's own output, as it arrives: `Receiving objects: 62% (1204/1943)` is a slow connection doing its job; the same line unchanged for a minute is a connection that has stopped answering.
- **Whether the request reached Termux at all.** Silence means one of two opposite things — too early, or nothing ever started — and this is what tells them apart: the request id, whether the companion confirmed it launched Termux, and how many requests are queued. Past twenty seconds with an empty stream, it says so.
- **The Termux runner log**, collapsed. What the runner did outside this operation: waiting for its lock, draining another vault's queue, refusing something.
- **Earlier operations**, collapsed. The streams of the last few, kept for 24 hours — enough to compare a sync that worked with one that did not.

The state line reads the same as everywhere else (`repair-refetch… 300s`), and the request's budget is in the facts beside it, because "300s" alone cannot tell you whether to keep waiting.

Settings has **Open the output panel for long operations**, off by default: with it on, anything running for more than 30 seconds opens the panel by itself.

The runner writes the stream to `runtime/progress/<id>.txt`, so it is also there afterwards, in the shared log bundle. An operation that timed out has nothing else to show for itself.

A runner older than the plugin writes none of this. The panel then shows the request state and the runner log, and the stream section says the runner has written nothing — which is the truth rather than a fault.

### "object file … is empty", or anything mentioning an unreadable object

The operation named in the error is not the problem. A message like

```
error: object file .git/objects/2d/9ebf…af7 is empty
fatal: unable to read tree (2d9ebf…)
```

means the repository's object database is damaged: git created an object file and was stopped before it could write to it. On Android that is routine — the system stops Termux when it goes to the background — and cancelling an operation while git is mid-write can do it too. Everything that has to walk the tree fails afterwards, each time complaining about whatever you happened to be doing.

The failure window offers **Repair the repository**. It runs as short steps — Android stopping Termux mid-run loses one step, not the whole repair, and a repair interrupted by closing Obsidian offers to continue on the next launch. First it removes only object files that are *empty*, which by definition contain nothing, then it asks the remote for exactly the missing objects, by name. On a measured case that was 52 KB against a 3.7 MB history; the output panel lists them as it goes (`asking origin for object 1 of 2`). Objects that are damaged but not empty are reported instead of removed: those may still be recoverable, and that is a decision to make deliberately in Termux.

**Downloading the whole history is a separate step and it always asks first**, because an ordinary fetch asks the remote only for what the local refs say is missing — and the refs still claim to have the object that is gone, so a normal fetch transfers nothing at all. On a large vault over a phone connection expect minutes, and the full size of the repository in traffic.

**The verdict is honest, which means it can say the repair did not work.** Four endings:

- *Repository repaired* — git can read everything it references again.
- *Repository still incomplete*, before the full download — the targeted fetch did not bring everything back; run the repair again when you are ready for the full download, or with a better connection.
- *Repository still incomplete*, with **Rebuild on the remote state** — the missing objects were never on the remote: they belong to commits this device made and never pushed, or to the index itself. No download can bring them back, and cloning again would throw those local commits away. The button moves the branch to what the remote has while leaving every file on disk exactly as it is: the content of the local commits becomes ordinary uncommitted changes, the next sync commits it once, and the old history stays reachable under a backup branch named in the window. The separate commit messages are what is lost. Once you have checked nothing is missing, the same window deletes the backup branch; until it is deleted, the repair check keeps naming the old history's objects.
- *Repository still incomplete* with neither button — the full refetch ran, the objects are **still** missing, and nothing points at local-only damage: the remote genuinely does not have them. The history that referenced them is gone on both sides, and cloning the vault again is the way out. Your notes on disk are not affected by that.

If you once saw this repair report success several times while `unable to read tree` kept coming back, that was a bug and it is fixed: the fetch used to be skipped whenever there was no empty file left to remove, which is exactly the state after the first repair.

### "Abort merge failed" and the pull keeps refusing

`git merge --abort` is `git reset --merge`: it has to put the working tree back the way it was. It cannot do that while the sparse checkout has drifted from the index — index entries under an excluded directory with no file on disk — so it fails, the repository stays mid-merge, and every pull after it answers "a merge is already in progress".

The way out is **Reapply sparse rules**, offered as a button on the failure window itself (Settings has the same command). It puts the sparse state and the index back in step; the abort then normally succeeds on the next try. Nothing is deleted by it and no commit is touched.

If the abort still fails after that, git's own output is in the window and in the operation log, and the state has to be resolved in Termux.

### The sparse safety window

Beside it, whenever the violations fall under directories that are sparse-excluded, there is a second button: **Unprotect path**. It removes those directories from the sparse exclusions, so they are checked out and committed like any other directory. That is the way out when the answer is "I actually want this folder tracked here" rather than "these files should not be here", and it is the only route that resolves the block by changing the configuration instead of the files. Nothing is deleted by it and git history is untouched.

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

- `Authentication failed` / `could not read Username`: expired or missing PAT. Fix credentials in Termux (e.g. `git pull` once interactively to re-enter the PAT into the credential store, or `bash ~/.config/native-git-bridge/runner.sh interactive` to let a queued operation ask for them — see "A clone asks for credentials" above). The runner never prompts on its own; it fails fast.
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

## A file added to .gitignore or the exclude list still shows its changes

That is git, not the panel. Ignore rules only affect files git does not track yet: a file that has ever been committed keeps reporting its changes whatever `.gitignore` or `.git/info/exclude` say, and it stays in every commit. The plugin says so when you add a rule for such a file, and offers **Stop tracking (keep the file)** — also available in the file's git menu (runner v14 or newer). Untracking stages a deletion for you to commit; the file stays on disk and becomes untracked, which is the state the ignore rule can act on. Two things to know before committing it: once that commit reaches your other devices, their pull removes their copy of the file (or reports a conflict if it has local changes there), and without an ignore rule the next sync or commit stages the file right back. *Hide on this device (sparse)* is different: it removes the file from this device's working tree entirely, tracked or not, which is the wrong tool for a file Obsidian keeps rewriting.

## `.git/objects` keeps growing

The object database grows and never shrinks by itself, and two things grow it fast: every full-history repair download adds a complete pack without removing the old ones (deliberately — removing anything mid-recovery would risk the repository it is trying to save), and an interrupted download leaves a temporary pack file as large as whatever arrived. Repeated repairs can multiply gigabytes this way.

**Clean up repository storage** in the command palette is the exit. It scans first and shows the real numbers — how large the object database is, how many packs, how much is leftover temporary files — then, after your confirmation, removes stale temporary files and unreachable loose objects older than two weeks and repacks everything reachable into one pack. Nothing any branch, tag, reflog or the index can reach is touched, and reflogs are not expired. The repack is the long step: it needs free space roughly the size of the repacked history while it runs, and the output panel shows what is happening. A repair backup branch (`ngb-rescue-…`) keeps its objects alive on purpose; the report names it, and its space is freed once you delete the backup.

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
