# Request/response protocol v1

Directory (repo-relative, excluded via `.git/info/exclude`), one per paired vault:

```
.obsidian/plugins/native-git-bridge/runtime/
  requests/<id>.json                        written by plugin, consumed (moved to done/) by runner
  results/<id>.json                         written atomically by runner (tmp + mv)
  cancel/<id>                               empty flag file; runner checks between steps
  done/<id>.json                            processed requests (kept ≤ 24 h)
  progress/<id>.txt                         git's stderr as it happens; read while waiting (kept ≤ 24 h)
  runner.log                                runner log, secrets stripped, size-capped
  pairing.json                              written by installer/runner, imported and deleted by plugin
  profile.json                              written by runner: which profile serves this vault
  claim.json                                written by plugin: "pair this vault"; consumed by runner
```

Termux side (runner ≥ 10), mode 600, never inside a vault:

```
~/.config/native-git-bridge/
  runner.sh                                 the runner itself (fixed path; the companion runs THIS)
  profiles/<profile-id>.conf                one per paired vault: repo dir, runtime dir, token
  creds/<profile-id>                        optional per-repository credential file (git store helper)
  .runner.lock                              single-instance lock across all profiles
  runner.log                                cross-profile lines (migration, discovery, broken profiles)
  config.legacy                             the pre-v10 single-repo config, kept after migration
```

## Request

```json
{
  "protocolVersion": 1,
  "id": "r-20260803T101500-8f3ka9",
  "token": "<device-local token>",
  "action": "status",
  "createdAt": "2026-08-03T10:15:00.000Z",
  "timeoutSeconds": 120,
  "profileId": "p-0011223344556677",
  "args": {}
}
```

- `id`: `^r-[0-9TZ.-]+-[a-z0-9]+$`, unique per request.
- `profileId` (runner ≥ 10, optional): which paired vault the request belongs to, `^p-[0-9a-f]{8,32}$`. It is **looked up** in `profiles/`, never used as a path, and a request naming a profile other than the one that owns the request directory is rejected with `BAD_REQUEST`. Omitted while a vault has not learned its id yet (pairings from before v10); the token then carries the whole burden, as before.
- `action` (implemented): `ping` | `status` | `verify-sparse-safety` | `sparse-reapply` | `diagnostics` | `fetch` | `pull` | `commit` | `push` | `sync` | `abort-merge` | `abort-rebase` | `continue-rebase` | `unstage-protected` | `apply-patch`.
  - **Runner v4**: `file-log` (paginated, rename-aware via `--follow --name-status`), `show-file-at-commit` (base64 content, 1 MB cap, `FILE_ABSENT`/`TOO_LARGE` errors), `diff-file` (commit→commit or commit→WORKTREE, with a `truncated` flag; capped at 200 KB in v4, replaced by the hunk-aligned budget in v12; a commit-ish may carry a single trailing `^` so the history panel can diff a commit against its parent), `restore-file` (worktree-only `git restore --source`, blocked for protected paths).
  - **Runner v5**: `repo-log` (repository-wide paginated log for the history panel, same `\x1e`/`\x1f` record format as `file-log` with a `--name-status` block per commit, no `--follow`).
  - **Runner v6**: `resolve-conflict` (`args.path` + `args.side` = `ours`|`theirs`; refuses non-conflicted paths and protected paths, then `git checkout --<side>` + `git add` to mark the file resolved, only ever on an explicit user choice; the bridge never picks a side by itself).
  - **Runner v7**: `diff-file` accepts the `INDEX` pseudo-ref (`HEAD→INDEX` = `git diff --cached`, `INDEX→WORKTREE` = plain `git diff`; INDEX pairs with nothing else), `stage-file` accepts `args.mode` = `all` (default) | `update` (`git add -u`, for folder rows in the tracked-changes group), FAILED mutating actions still attach fresh status fields to `data` (merged with any error payload such as `data.conflicts`), and the runner prints `NGB_RUNNER_VERSION=<n>` on stdout so the companion app's probe can learn the current runner version.
  - **Runner v14**: `untrack-file` — `git rm --cached` semantics via `git update-index --force-remove` (the file stays on disk, a staged deletion enters the index for the user to commit; refuses protected paths and anything without an exact index entry, matched `-z` so quoting never applies). And storage maintenance as three short actions the plugin sequences like the repair: `maintenance-scan` (read-only; raw `git count-objects -v` plus a size-and-name listing of the pack directory), `maintenance-prune` (`git prune` with a whitelisted `expire`, plus every pack-directory `tmp_*`/`.tmp-*` file removed by hand — that cleanup is `git gc`'s job, and gc is deliberately not used because it would also expire reflogs, the safety net the repair verdicts rely on), `maintenance-repack` (`git repack -a -d`: one new pack of everything reachable, redundant packs removed by git only after the new pack is complete; on a partial clone it adds `--filter` where this git can and reports `repackFilter` either way). Plus the repository footprint actions: `repo-shallow` (`args.depth`, digits only, 1..100000: `git fetch --depth` then a full reflog expiry — with the reflog kept, the old commits stay pinned and the cut frees nothing for 90 days), `repo-unshallow`, `repo-partial-enable` (permanent `blob:none` partial-clone marking, plus `repack --filter` and `git backfill --sparse` where this git has them — both reported), `repo-partial-disable` (fetches every promised object back first and refuses to unmark a repository that would be left incomplete). `clone-into-vault` additionally accepts `args.filter` (whitelist: `blob:none`) and `args.depth` for a lightweight clone. All are listed in `ACTION_MIN_RUNNER`, so an older runner refuses them by name and `RUNNER_MIN_VERSION` stays 12.
  - **Runner v13**: two unrelated things, because v13 grew before it was released (see below). `sync` stages and commits **before** the merge, but only when the merge would otherwise be refused — see the section below. `sync` and `pull` reapply the sparse checkout **after** the merge as well as before it: a merge does not honour `skip-worktree` — it cannot merge a file it cannot see — so it may materialise excluded files and clear their bit, after which every one of them is a visible change under a protected path and the safety gate blocks the very operation that produced them. Reapplying is idempotent and touches nothing tracked. `resolve-conflict` also answers a **delete/modify** conflict, where one side removed the file: `git checkout --theirs` fails there with "does not have their version", so choosing the side that deleted it now removes the file and marks the path resolved (`resolvedBy: "deleted"`), and choosing the side that kept it keeps it (`resolvedBy: "kept"`). And the object-database repair, as five short actions the plugin sequences: `repair-scan`, `repair-fetch-missing`, `repair-refetch`, `repair-reset-upstream` and `repair-drop-backup` — see the section below for what each does and why the repair is not one action. All five are listed in `ACTION_MIN_RUNNER`, so an older runner refuses them by name and everything else keeps working; nothing else here changed an action, an argument or a result field, so `RUNNER_MIN_VERSION` stays 12.
  - **Runner v16**: `repair-sparse-definition` (re-seed the `/*` base of a non-cone sparse definition and drop git's own emptying default; a step of the unified repair), `identity-drop-global` (`git config --global --unset-all` for `user.name` and `user.email`, value-free; refused while the repository has no local identity), `cred-helper-local-reset` (an empty local `credential.helper` value that resets the inherited helper list, then the profile's own store helper, so a global helper stops answering first), `repair-triage` (read-only: the stale-lock facts — lock existence and age, live processes with their command names — plus the set-aside previous repositories and the ordinary status fields, in one round trip). `repair-stale-lock` additionally accepts `args.skipKill` (the plain removal for a lock the triage proved nothing can be holding) and reports `killedProcesses`.
  - `pull`/`commit`/`push`/`sync` require `args.protectedPaths` (validated on both sides) and enforce the sparse safety gate; `commit`/`sync` require `args.message` (`sync` falls back to a default). Conflicts are returned as `error.code = "CONFLICT"` with `data.conflicts`; safety violations as `error.code = "SAFETY_BLOCKED"` with `data.statusProtected`/`data.stagedProtected`. Staging always uses `git add -A -- . ":(exclude)<protected>"…`, so protected paths can never enter the index through the bridge.
- `args` are action-specific; every path is repository-relative and validated on **both** sides.

## Result

```json
{
  "protocolVersion": 1,
  "id": "r-20260803T101500-8f3ka9",
  "action": "status",
  "ok": true,
  "exitCode": 0,
  "startedAt": "…", "finishedAt": "…",
  "runnerVersion": 10,
  "profileId": "p-0011223344556677",
  "data": { "…action-specific raw command outputs…" },
  "error": null
}
```

- `data` carries *raw* git output fields (e.g. `branchInfo`, `sparseList`); parsing happens in TypeScript so bash stays trivial and auditable.
- `profileId` (runner ≥ 10): the profile that answered. A vault with no id yet adopts the one from its first result; a vault that already has one never replaces it on the strength of a result (that would be the plugin re-pointing itself at another repository).
- `error`: `{ "code": "AUTH" | "BAD_REQUEST" | "GIT_FAILED" | "CANCELLED" | "SAFETY_BLOCKED" | "TIMEOUT" | "EXPIRED" | "RUNNER_INTERNAL" | "CONFLICT" | "FILE_ABSENT" | "TOO_LARGE" | "REPO_MISSING" | "REPO_EXISTS", "message": "…" , "stdout": "…", "stderr": "…" }`.
- Written atomically: `results/<id>.json.tmp` → `mv` → `results/<id>.json`.

## `status` result data
`branchInfo` (git status --porcelain=v2 --branch), `sparseEnabled`, `sparseCone`, `sparseList`, `skipWorktreeCount`, `lastCommit` (`git log -1 --format=%H%x09%cI%x09%s`), `remoteUrl` (redacted), `userNameScopes` + `userEmailScopes` + `credHelperScopes` (runner v16+: which config scopes hold `user.name`, `user.email` and `credential.helper`, one scope name per line from `git config --list --show-scope --name-only` — presence and scope ONLY, never a value; the identity and credential values never enter the runner, the plugin, a result or a log. On git older than 2.26 a per-scope probe answers instead), `credsConfigured` (runner v15+: whether TERMUX-SIDE credentials exist that a re-clone could authenticate with — the profile's own credential file with something in it, or a global helper in Termux's own gitconfig. A helper in the vault repository's local config deliberately does not count: it dies with the old `.git` on a re-clone, and credentials are never reused from inside the vault. The FACT only, never a helper's value — a helper line can embed a secret. The plugin uses it to decide whether a re-clone can authenticate non-interactively or should be handed to a Termux terminal from the start), `shallow` + `partialFilter` (runner v14+: whether a shallow boundary exists and which partial-clone filter is configured, so the footprint toggles reflect the repository rather than a remembered preference), `mergeInProgress` + `mergeMsg` (runner v7+: `true` while MERGE_HEAD exists, plus git's own prepared `MERGE_MSG`, so the plugin can prefill the commit modal after a manual conflict resolution and let `sync` commit the merge without asking), `rescueBranches` (runner v13+: newline-separated `ngb-rescue-*` branch names, so the plugin can keep offering to delete a repair backup whose one-time window was closed), `untrackedChildren` (runner v5+: newline-separated raw paths of the files inside fully untracked directories. git status collapses such a directory to one `dir/` entry, so without this field the plugin cannot show the files in a freshly created folder; collected via `git ls-files --others --exclude-standard -z`, so quoting never applies). The same fields ride along on every mutating action's result so the plugin can refresh without a second round trip.

## `verify-sparse-safety` result data
`statusProtected` (porcelain v1 limited to protected paths, `-uall` since runner v10 so nothing is collapsed into a `dir/` entry), `stagedProtected` (`git diff --cached --name-status -- <paths…>`), plus the inputs echoed back. The **plugin** computes the verdict; the runner additionally refuses `commit`/`push`/ `sync` actions itself if either output is non-empty (defense in depth).

## Lifecycle rules
- Plugin polls `results/<id>.json` every 400 ms until `timeoutSeconds`. On timeout it reports TIMEOUT, writes `cancel/<id>` (so the request can never *execute* at some later trigger) and leaves the request file for the runner to archive.
- Cancellation: plugin creates `cancel/<id>`; a not-yet-started request is skipped by the runner with a CANCELLED result; a running mutating git command is never killed mid-flight (index safety); cancellation applies between steps.
- Expiry (runner ≥ 3): a queued request older than `createdAt + timeoutSeconds + 600 s` is answered with an EXPIRED error instead of being executed. A days-old `sync` must never surprise the user with a commit. An unparsable `createdAt` fails open (executes), so a broken clock cannot brick the bridge.
- Interrupted requests (found in `processing/` at startup) are requeued exactly once, tracked by a `<name>.retried` marker; a second interruption yields a RUNNER_INTERNAL result and the request is archived, so `processing/` never accumulates and a poison request cannot loop forever.
- Both sides delete `done/`, `results/`, `cancel/`, `progress/` entries older than 24 h; the plugin also sweeps `requests/` older than 24 h (a request that never reached Termux must not linger), and the runner sweeps orphaned `.retried` markers.
- Progress: while a request runs, the runner appends git's stderr to `progress/<id>.txt`, announcing each step of a multi-step action before taking it. The plugin reads the last line from the same poll and shows it beside the elapsed time, and the output panel reads the whole file once a second while it is open; the file is kept after the request finishes so the shareable log bundle can carry it, and so a panel opened after a failure still has something to show. Optional in both directions and outside the version handshake — an older runner writes none and nothing looks broken, a newer one writing for an older plugin leaves files the 24 h sweep collects. Network commands are given `--progress` explicitly, because git draws no meter when stderr is not a terminal. A request rejected before it executes gets no file at all.
- The runner processes requests oldest-first, one at a time, and exits when the queue is empty. It never daemonizes. From v10 "the queue" is the union of every profile's `requests/` directory, sorted by request id (ids embed a UTC timestamp, so that is chronological across vaults).

## Config-management actions (runner ≥ 4)
`sparse-exclude-add` / `sparse-exclude-remove` edit non-cone sparse patterns (`!/<path>` appended / removed, full list re-applied via `git sparse-checkout set --no-cone --stdin`); cone-mode repos are refused. Since runner v15, `sparse-exclude-add` on a repository whose sparse checkout is DISABLED enables it, seeding the pattern list with git's include-everything base (`/*`) so the first exclusion cannot read as "hide everything" — a re-clone brings a fresh `.git` and the sparse configuration dies with the old one, and the earlier refusal sent the user to Termux to type the exact command the runner runs itself. `exclude-add` / `exclude-remove` / `exclude-list` manage literal lines in `$GIT_DIR/info/exclude`. All take a validated repo-relative `path`. The sparse actions return fresh status fields; since runner v16 the exclude-changing actions do too (alongside the updated `excludeList`), so no follow-up `status` round trip is needed; `exclude-list` returns the list only. `.gitignore` is a tracked vault file and is edited by the plugin directly; no runner action exists for it.

Two guards on `sparse-exclude-add` since runner v16, both born on a real device. It refuses a path that already holds STAGED content, naming the staged paths: excluding such a path strands its index entries — `sparse-checkout reapply` takes the files off disk, skip-worktree hides that they are gone, and the result is a bare `A ` only `unstage-protected` can clear. And every sparse pattern write is VERIFIED: the effective file is read back and must hold the `/*` base, no `!/*/` line, and cone mode off — `/*` plus `!/*/` is git's own default pattern set, written when `sparse-checkout set` runs non-cone with no pattern or when cone mode prints its header, and it empties the working tree of everything below the top level. A write that fails the check is rolled back (the saved pattern file and config are restored, or sparse is disabled again when it was off before) and refused with the written content quoted. A repository already in the emptied state is repaired by `repair-sparse-definition`, which keeps every `!/<path>` exclusion, drops the `!/*/` line, re-seeds `/*` and reapplies through the same verified write.

## Several repositories on one device (runner ≥ 10)

The trigger the companion app sends is fixed and carries no vault identity (see ADR-001), so the runner cannot be told which vault woke it. It therefore drains **all** of them:

- **Profiles.** One file per paired vault, `profiles/<id>.conf`, mode 600, `KEY="value"` lines with an `NGB_PROFILE_FORMAT=1` marker. One file per profile (rather than one file with repeated keys) keeps writes atomic, removal trivial, and one corrupt profile from taking the others down. Profile files are **parsed, never sourced**: a damaged or tampered file cannot execute anything.
- **Token scope.** One token per profile, generated in Termux. A token valid for profile A is rejected for profile B (`AUTH`), which is what makes a request file copied from another vault harmless.
- **Selection.** The request directory a file was found in decides the profile; the optional `profileId` must agree with it. The runner never accepts a repository path from a request.
- **Migration.** An existing single-repo `config` is turned into a profile on the first run of the new runner, keeping its token, and the old file is renamed `config.legacy` so migration cannot run twice. Current installations do not need re-pairing.
- **Confinement.** Each profile is entered with `cd` **and** `GIT_CEILING_DIRECTORIES` set to the repository's parent, and the runner verifies that `git rev-parse --show-toplevel` is the repository itself. A vault whose `.git` disappeared therefore fails with `REPO_MISSING` instead of silently operating on the repository above it — the case that matters when two vaults nest.
- **Broken profiles.** A repository that is gone, unreadable or no longer a work tree never aborts the run: its own queue is answered with `REPO_MISSING` (so the plugin in that vault stops waiting) and the other profiles are drained normally.
- **Relocation.** The runner writes `runtime/profile.json` into each vault. When a profile's recorded directory is no longer a work tree, an idle run scans shared storage for that marker and follows the vault to its new location, keeping id and token. A profile whose marker is nowhere to be found is treated as deleted; no replacement repository is ever linked to it automatically.
- **Adoption.** A vault with no profile writes `runtime/claim.json` ("pair this vault") and triggers the runner. On an otherwise idle run the runner finds the claim, checks that the directory really is a repository of its own, generates a **new token in Termux**, writes `pairing.json` and deletes the claim. Nothing the claim contains is trusted, and no secret ever travels towards Termux.
- **Cost.** The shared-storage scan runs only when a profile is broken or when the run has no work at all, so a normal operation never pays for it. `NGB_SCAN_ROOTS`, `NGB_SCAN_MAXDEPTH`, `NGB_CLAIM_MAX_AGE` and `NGB_DISCOVER=1` are the knobs.

### Nested vaults

A vault opened inside another vault's repository (`Main/` and `Main/Projects/ABCproject/`) is two repositories, and the outer one would otherwise offer the inner working tree for staging and could record it as a gitlink. The inner repository is excluded from the outer one through the **outer repository's `.git/info/exclude`**, written by the installer and re-checked by the runner on every run.

Why that and not the alternatives:

- `.gitignore` is a tracked file: it syncs to every device and every collaborator, most of whom do not have the inner vault at all, and editing it would need an explicit confirmation naming the file. Excluding a device-local situation in a synced file is the wrong scope.
- A **submodule** rewrites the outer repository's history, needs a remote for the inner repository and has no support anywhere else in this project.
- **Sparse-checkout exclusion** would hide the folder from the working tree, which is the opposite of what is wanted: the user wants to open that folder as a vault.
- `.git/info/exclude` matches how the runtime directory is already handled: device-local, never synced, never a tracked file.

Both repositories may hold overlapping content; only the inner repository's own files stop appearing in the outer one's status. The installer prints exactly which line it added to which file.

## Repository bootstrap (runner ≥ 11)

Until v11 the plugin assumed the vault already was a repository with a working remote. These three actions add the beginning of the story; everything interactive (a PAT, a passphrase) still happens in Termux, and no secret ever travels towards the plugin.

- **`init-repo`** — `args.branch` (default `main`), `args.initialCommit`, `args.message`. Creates a repository in the vault, sets the default branch explicitly, writes the runtime exclude, optionally makes the first commit. It refuses `REPO_EXISTS` when one is already there. Once `git init` has run the repository EXISTS, so a failure after that point (no `user.name`, for example) is reported with `data.initialised = true` and a message that says so, never as a bare "init failed".
- **`set-remote`** — `args.url`. Adds `origin`, or changes it when it is already there. Returns the previous URL redacted, plus what it found: `remoteReachable`, `remoteBranches` (from `ls-remote`, 30 s budget, an unreachable remote is reported as unknown rather than as a failure) and `localCommits`. Those three decide what can happen next.
- **`adopt-remote`** — optional `args.branch`. Takes an already configured remote's history into a repository that has **no commits of its own**: fetch, point HEAD at the branch, then the same two steps the clone uses. It refuses when the local side already has commits, because then the two histories are unrelated and no automatic answer would be honest.
- **`clone-into-vault`** — `args.url`, optional `args.branch`, optional `args.replaceExisting`.

### Cloning into a directory that is not empty

A vault always holds at least its configuration directory, so a plain `git clone` refuses it. The sequence is:

1. `git clone --no-checkout` into `runtime/clone-tmp/` — inside the vault, so the next step is a rename on the same filesystem rather than a copy. A failure here leaves the vault untouched; the temporary directory is removed either way.
2. Move `.git` into the vault (refusing if one appeared meanwhile), write the runtime exclude, exclude the new repository from any outer paired vault.
3. `git reset HEAD` — the repository's tree goes into the **index**, the working tree is not touched. Files the vault already had now differ from the index, which is exactly what "a local change" means.
4. `git ls-files --deleted | git checkout-index --stdin -u` — everything the vault does **not** have is written out of the index. Only those paths are written, so no existing file is touched.

What the user ends up with is a complete checkout **plus** their own versions of the overlapping files, listed in the panel as ordinary modifications. Taking the repository's version is then the per-file *discard* the panel already has, with the diff visible first, instead of a blind decision before anything can be inspected. Files that exist only in the vault are left alone and are simply untracked. The result reports `collisions` so the plugin can name them.

Rejected alternatives, both of which were built and thrown away:

- **`onCollision` = abort / keep-local / take-remote**, decided before the clone. `abort` meant the common case (a vault always has `.obsidian/`) refused to do anything; `keep-local` used `git reset` alone and therefore never checked out the repository's *other* files, leaving them listed as deleted; `take-remote` overwrote files that exist in no history. Three modes, two of them wrong.
- **Moving the vault's files aside** into a scratch folder (or into `.trash`) and back after the checkout. It reaches the same end state, but it mixes tool state into the user's own trash, it doubles disk use while it runs, and an interruption strands the user's notes in a folder they have to fish them out of. Reset + checkout-index reaches the same place with no file ever moved: an interruption at worst leaves some repository files not yet written, which the panel shows as deletions and one *discard* fixes.

Why the temporary directory lives in `runtime/` rather than a `.tmp` at the vault root: it is already excluded from git and invisible in Obsidian, and it is on the same filesystem, which is what makes the move a rename.

A clone gets `NGB_CLONE_TIMEOUT` (3600 s; 900 until runner v15) instead of the ordinary network budget, and the plugin sends a matching `timeoutSeconds`. An hour rather than fifteen minutes because a full clone of a real vault outlives fifteen on a phone connection, and the interactive credential route adds the time a person takes to paste the command and answer git's prompts. Cancellation cannot interrupt a clone in flight — the runner has no cancellation point inside a git command — but because the repository is moved into place only on success, a cancelled or timed-out clone still leaves the vault either untouched or complete, never half populated.

### Remote URLs

Validated identically on both sides (`src/git/remoteUrl.ts` and `valid_remote_url` in the runner), passed to git as an argv element, and redacted in every log and result:

- accepted: `https://…`, `ssh://…`, `user@host:path`, `file:///absolute/path` (a local copy, e.g. on the SD card);
- refused: anything starting with `-` (git would read it as an option), plain `http://`, `git://`, `ext::…`, whitespace, control characters, non-ASCII, and **any URL carrying a password** — that would put a secret into a file inside the vault and into `.git/config`, so it is rejected with a message pointing at the credential helper, the SSH key or `gh auth login`.

### What the vault looks like afterwards

The top level of the vault is the remote's top level plus `.git`, and it does not matter which way the repository got there. Nothing else is added: no scratch directory (the clone works inside `runtime/`, which is removed afterwards), nothing placed in the trash, nothing renamed. A vault that already held notes keeps them, untracked. Given a remote containing

```
.obsidian/  .trash/  Private/  Projects/  .gitignore
```

both routes end with exactly

```
.git  .gitignore  .obsidian  .trash  Private  Projects
```

and the only entries in `git status` are the files that existed on both sides (kept as the vault's version, shown as modified) plus whatever the vault had of its own (untracked). The e2e suite asserts that listing literally, for both routes, against a vault populated the way Obsidian really leaves one.

### Re-cloning a vault that already has a repository

`replaceExisting: true` is the only way past `REPO_EXISTS`, and the order is what makes it safe: the clone happens **first**, into `runtime/clone-tmp/`, and the vault's existing repository is not touched until that clone has succeeded. A re-clone that fails on a bad URL, missing credentials or a dropped connection changes nothing at all.

When it succeeds, the old `.git` is **renamed** (never deleted) to `runtime/previous-git-<timestamp>/`, and a manifest is written beside it:

```json
{"dir":"previous-git-20260807T101500Z","createdAt":"…","sizeKb":188416,
 "commits":1240,"branch":"main","lastCommit":"abc1234 2026-08-01 fix typo"}
```

A repository is the one kind of data whose loss is invisible — a missing file is noticed today, a missing commit in three weeks — so it is kept, and the decision is left to the user. The manifest exists so the plugin can describe it (size, commits, branch, last commit) without walking a directory that may hold hundreds of megabytes. If anything fails after the rename, the old repository is moved back.

The old history stays fully usable: it is a valid git directory, so it can be attached to the new repository and browsed, cherry-picked or merged deliberately —

```
git -C <vault> remote add previous <vault>/<runtime>/previous-git-<timestamp>
git -C <vault> fetch previous
```

Nothing removes it automatically. The plugin reminds the user about the disk it uses once a day (device-local: the copy is on this device and so is the decision), offers to delete it with an explicit confirmation, and offers "stop reminding about this one". The reminder never fires when there is nothing set aside.

### The two ways in end in the same place

"Create a repository here, then point it at my existing remote" must land where cloning lands, or the plugin has two doors into two different rooms. It does — with one condition:

| | after `clone-into-vault` | after `init-repo` (no commit) + `set-remote` + `adopt-remote` |
|---|---|---|
| history | the remote's | the remote's |
| branch | the remote's | the remote's (the name chosen at init is replaced) |
| upstream | set | set |
| overlapping files | the vault's version, shown as a local change | identical |
| other repository files | checked out | identical |
| vault-only files | untouched, untracked | identical |

The e2e suite asserts that literally: same HEAD, same branch, same upstream, same `status --porcelain`, same files on disk.

The condition is that the local side has **no commits**. `init-repo` with `initialCommit: true` against a remote that already has content produces two unrelated histories — `pull` then answers `refusing to merge unrelated histories` and `push` is rejected. `set-remote` therefore reports `remoteBranches` and `localCommits` so the plugin can say this immediately, while it is still cheap to fix, instead of letting git say it days later. The plugin offers *Get the repository's content* in the recoverable case and explains the two deliberate ways out (`--allow-unrelated-histories`, or resetting onto the remote branch in Termux) in the other. It does neither by itself.

### A remote whose HEAD is stale

`git init --bare` writes `HEAD -> master`; a repository that only ever received `main` therefore advertises a HEAD that does not exist. Plain `git clone` gives up there ("unable to checkout working tree") and leaves an unusable repository. The runner picks a branch instead: the requested one, else `main`, else `master`, else the only one there is — and names them all in the error if the choice is genuinely ambiguous.

### A vault that is not a repository yet

Bootstrap has to work before there is anything to work on, which touches the profile model of v10. The decision: **the bootstrap flow creates the profile itself**, rather than requiring the installer first.

A profile is therefore in one of three states, decided on every activation:

| state | meaning | allowed actions |
|---|---|---|
| `ready` | a git work tree of its own | everything |
| `bootstrap` | the directory is there, no repository of its own | `ping`, `diagnostics`, `init-repo`, `clone-into-vault` |
| unusable | gone, unreadable, or git refuses it (dubious ownership) | none; the queue is answered `REPO_MISSING` |

A vault with no repository pairs by writing `claim.json` with `"bootstrap": true`; the runner then adopts a directory that is not a work tree, which it otherwise refuses. Everything else about adoption is unchanged: the claim carries no secret, the token is generated in Termux, and the claim must be fresh. Until a repository exists the profile can answer nothing but the two actions that create one, so the widened adoption cannot be used to reach anything else.

## Runner version history

Updating the plugin does **not** update the runner in Termux, so the two carry independent version numbers and every result echoes `runnerVersion`. The rule: `RUNNER_VERSION` (runner script) and `RUNNER_MIN_VERSION` (plugin) move together in the release that ships the change, and a capability is attributed to the version **users actually received it in**, not to whatever the constant happened to say while the code was being written. Without that rule, "your runner is v5, this build needs v7" would not be actionable.

| Runner | Shipped in | Added |
|---|---|---|
| 1 | pre-release | `ping`, `status`, `verify-sparse-safety`, `sparse-reapply`, `diagnostics`, `fetch`, `pull`, `commit`, `push`, `sync`, `abort-merge`; the sparse safety gate |
| 2 | pre-release | History/diff/staging actions: `file-log`, `show-file-at-commit`, `diff-file`, `restore-file`, `stage-file`, `unstage-file`, `discard-file`, `stage-all`, `unstage-all` |
| 3 | pre-release | Robustness, no new actions: request expiry (`EXPIRED` instead of executing a stale request), retry-exactly-once recovery (`.retried` marker), all-JSON-through-files serialization |
| 4 | 0.5.0 – 0.5.5 | Config management: `sparse-exclude-add`, `sparse-exclude-remove`, `exclude-add`, `exclude-remove`, `exclude-list` |
| 5 | 0.5.6 | `repo-log` (repository-wide history) and `untrackedChildren` in status |
| 6 | 0.5.7 | `resolve-conflict` (whole-file keep-ours / keep-theirs, on an explicit user choice) |
| 7 | 0.5.8 | `INDEX` pseudo-ref for `diff-file`; `stage-file` `args.mode` (`all` \| `update`); fresh status fields on **failed** mutating actions; `mergeInProgress` + `mergeMsg` in status; `NGB_RUNNER_VERSION=<n>` on stdout for the companion's probe |
| 8 | 0.5.9 | Per-path actions (`stage-file`, `unstage-file`, `discard-file`) exclude protected paths that lie UNDER the requested path, so acting on a parent folder can no longer stage or discard a sparse-protected subdirectory; `discard-file` on an untracked folder deletes the untracked files it contains instead of failing; new `discard-all` (drops unstaged work, keeps staged content and untracked files) and `reset-all` (index and worktree back to HEAD, expressed as a pathspec restore so protected paths stay excluded and untracked files survive) |
| 9 | 0.5.10 | `file-log` uses `--raw --numstat`, so each commit reports the change letter, both sides of a rename and the added/deleted counts the file-history view shows |
| 10 | 0.6.0 | Several repositories per device: `profiles/<id>.conf` (one per vault, own token), automatic migration of the single-repo config, one run drains every profile oldest-first, `profileId` in requests and results, `REPO_MISSING` for a dead profile, git pinned per profile (`GIT_CEILING_DIRECTORIES` + toplevel check) so nested vaults cannot leak into each other, nested-vault exclusion in the outer repository's `.git/info/exclude`, relocation of a moved vault and self-pairing of a new one (`claim.json` → `pairing.json`), global single-instance lock in the config directory; `verify-sparse-safety` and the safety gate run `git status -uall`, so a new folder under a protected path is reported file by file instead of as one collapsed `dir/` line (the plugin offers to trash exactly that list) |
| 11 | 0.6.1 | Repository bootstrap: `init-repo`, `set-remote`, `clone-into-vault` (clones into a vault that already holds files without overwriting any of them; the overlap becomes ordinary local changes), `REPO_EXISTS`, the `bootstrap` profile state and `"bootstrap": true` claims, remote-URL validation shared with the plugin. Later in the same unreleased 0.6.1: `unstage-protected`, `abort-rebase`, `continue-rebase`, and `rebaseInProgress` in status (see below) |
| 12 | 0.6.2 | Hunk-level staging and a diff budget: `apply-patch` (one patch, `--cached` or not, forward or reversed, which covers stage / unstage / discard of a hunk or of picked lines); `diff-file` takes `args.maxBytes` and trims at HUNK boundaries, reporting `hunksShown`, `hunksTotal`, `diffBytesTotal` and `diffBytesLimit`; failed actions attach fresh status by exclusion rather than from a hand-kept list |
| 13 | 0.6.3 | `sync` stages and commits before the merge when the merge would otherwise be refused, and reapplies the sparse checkout after it; `resolve-conflict` answers delete/modify conflicts; the progress stream (`progress/<id>.txt`); the object repair as five short actions (`repair-scan`, `repair-fetch-missing`, `repair-refetch`, `repair-reset-upstream`, `repair-drop-backup`); `rescueBranches` in status; command-line credentials and `safe.directory` for the recovery copy; userinfo-and-token redaction in every log and stream |
| 14 | 0.6.4 | `untrack-file` (stop tracking one file, keep it on disk); storage maintenance (`maintenance-scan`, `maintenance-prune`, `maintenance-repack`) — the exit from an object database grown by repeated refetches and interrupted downloads (see below); repository footprint (`repo-shallow`, `repo-unshallow`, `repo-partial-enable`, `repo-partial-disable`, plus `filter`/`depth` on `clone-into-vault`) with `shallow` and `partialFilter` riding in status (see below) |
| 15 | 0.6.5 | The manual clone route: `clone-into-vault` ADOPTS a repository already downloaded into `runtime/clone-tmp/repo` (plain `git clone --no-checkout` pasted into Termux, git's own prompts and progress) when its origin equals the requested URL and HEAD resolves — see below. Interactive runs (`runner.sh interactive`: same queue, same results, but git may prompt at the terminal); `credsConfigured` in status; clone credential persistence — an https clone adds the profile's own store helper and, once landed, configures it in the repository when no helper is configured anywhere yet; `sparse-exclude-add` enables non-cone sparse (seeded `/*`) on a repository where it is disabled; `repair-stale-lock` — remove a leftover `.git/index.lock` (on Termux it first kills every other process of its uid, so nothing can be holding the lock; the trigger that delivers the request is the fresh Termux start). The v14 credential passthrough is REMOVED: a re-clone reuses credentials from Termux-side storage only, never from the vault's own `.git/config` |
| 16 | 0.6.6 | Identity and credential scope, value-free: `userNameScopes`/`userEmailScopes`/`credHelperScopes` in status (`--show-scope --name-only`; presence and scope only, never a value), `identity-drop-global`, `cred-helper-local-reset`; the sparse write guard (verified pattern writes with rollback), `sparse-exclude-add` refusing a path with staged content, `repair-sparse-definition`; `repair-triage` (read-only lock/process/leftover facts for the unified repair) and `repair-stale-lock` with `args.skipKill` + `killedProcesses`; exclude changes carry fresh status fields; `-c core.pager=cat` on every git call (a broken `core.pager` only ever bit the interactive runs, which have the tty that engages it) |

### No runtime dependencies

`package.json` declares no `dependencies`. The diff panes parse the unified diff and build their DOM in `src/git/unifiedDiff.ts`, `src/git/inlineDiff.ts` and `src/ui/diffDom.ts`. They previously used `diff2html`, which compiled Mustache templates with `new Function`.

The plugin executes no generated code. All repository access goes through the git binary in Termux.

### Runner v13: sync commits before the merge when the merge needs it

`sync` used to fetch, pull, stage, commit, push, in that order, and one state had no exit: a path changed locally and not yet committed that the incoming merge also changes. Git refuses to merge over it — and refuses whether or not the merge would actually conflict, because the refusal is about the working tree rather than the content. Sync stopped before it ever reached its own commit step, so pressing it again repeated the refusal forever and the only way out was to stage and commit by hand.

v13 asks git which paths the merge would bring in (`git diff --name-only -z HEAD...@{upstream}`), intersects them with what is dirty or untracked here (`git diff --name-only -z HEAD` plus `git ls-files -z --others --exclude-standard`), and stages and commits **first** only when the two overlap. Nothing else changes: with no overlap the order is exactly what it was, so an ordinary sync still produces no merge commit.

Two consequences worth stating rather than discovering:

- A local commit can exist after a failed sync. It is reported as `committed-before-merge` in `steps`, and the plugin says so instead of letting "sync failed" read as "nothing happened".
- A collision that used to be an inescapable refusal now becomes an ordinary merge conflict when the two sides really disagree, which is a state this plugin displays and resolves per block.

If the colliding path is one staging cannot reach — a protected sparse path — the action answers `SAFETY_BLOCKED` naming the path, rather than letting git fail with a message about a file the user is not allowed to touch.

`RUNNER_MIN_VERSION` stays 12. No action, argument or result field changed; a v12 runner keeps doing it the old way, which fails exactly where it failed before and no worse.

### Saying what a long operation is doing (runner 13)

Everything the plugin could show about an operation in flight was how long it had been waiting. git's stderr went to a temporary file whose name only the runner knew, and was read after git exited, so through the fifteen minutes an object repair takes, "three percent in" and "completely stuck" looked identical — and if the budget ran out, the report was a bare timeout with no indication of how far it had got.

The runner now appends that stderr to `progress/<id>.txt` while it works, and announces its own steps there before taking them, which is the only progress a step made of plumbing rather than one long command can produce. Two details carry the weight:

- **`--progress`, explicitly.** git draws no meter unless stderr is a terminal, and here it never is. Without the flag the one operation the user most wants to watch is the one that says nothing.
- **The delta is taken by byte offset.** git appends; the runner records the size before each command and reads what was added. That keeps `GIT_ERR` exactly this command's output while the file accumulates the whole narrative — and it means one writer and no race, where a `tee` into a second file would have had both.

Reading the file collapses each carriage-return run to its final state, which is what a terminal would have shown, and redacts it: over https a token is carried as the username, and fetch prints the URL it used.

This needs no handshake. An older runner writes no file and nothing looks broken; a newer one writing for an older plugin leaves files the 24 h sweep collects.

### Repairing the object database (runner 13)

The repair is four short actions, sequenced by the plugin, and none of them deletes anything that holds data. `repair-scan` removes files of size zero under `.git/objects` — the exact residue of an interrupted write — then runs the connectivity check and reports what it removed (`removedObjects`, `removedCount`), what git cannot find (`fsckMissing`), everything git still complains about (`fsckRemaining`), and whose the damage might be: `aheadCount` (commits the upstream does not have), `hasUpstream`, and `cacheTreeBroken` (the index's own cache-tree names a missing object). `repair-fetch-missing` takes `args.oids` (full 40-hex ids, at most 64, validated before git sees them) and asks the remote for exactly those objects. `repair-refetch` downloads the whole history again. `repair-reset-upstream` is the exit for damage inside local-only history: it writes a visible backup branch (`backupRef`), moves the branch to `@{upstream}` with `git reset --mixed`, and reapplies the sparse checkout — the working tree is never touched, so the content of the abandoned commits survives as ordinary uncommitted changes. Every step that changes the object store re-runs the connectivity check itself and reports fresh findings, so learning whether a step worked never costs an extra round trip. `repair-drop-backup` deletes the backup branch once the user has checked nothing is lost; its `args.ref` must match the `ngb-rescue-<timestamp>` shape exactly, which is what keeps it from being a general branch-delete — the user is never sent to Termux for anything beyond installing the runner and entering credentials.

Why four actions and not one: Android kills Termux in the background, and one 4–13 minute request loses the whole repair where a short step loses only itself — the interrupted step is covered by the ordinary retry-exactly-once. The decisions between the steps (fetch or not, refetch or not, what the verdict is) live in the plugin, where they are pure functions with unit tests; a step therefore answers `ok=true` even when objects are still missing, because the findings are the answer and the verdict is the plugin's to draw — the same split `verify-sparse-safety` has always had. The full-history download and the branch rebuild each sit behind an explicit confirmation in the plugin; the runner primitives themselves never ask.

The restraint is the design. An object that is corrupt but not empty may still be recoverable, and deciding that needs a person at a terminal, so the scan names it and nothing touches it.

Three things about the one-piece version of this were wrong, each found on a real device rather than by reading, and the split above is partly their consequence:

**The fetch must not depend on having removed something.** It was gated on `removedCount > 0`, which is false in the one state that matters: the first repair deletes the empty file, the object is still missing — deleting a file downloads nothing — and every repair after that finds nothing to remove and so skipped the only step that could help. The decision comes from `git fsck --connectivity-only`, asked after every step. `--connectivity-only` rather than `--full` because it answers exactly the question ("what can git not find") and skips re-hashing every object, which took between four and thirty-nine minutes on a real vault — long enough to outlive the action's own budget.

**A repair that did not repair must not answer `ok`.** fsck exits non-zero for findings that are not faults (`dangling` objects are the ordinary residue of a rebase), and the conclusion drawn from that was "report success whatever is found". So the action reported success on a repository that could not read its own tree, and the user went round *repair → success → sync → `unable to read tree` → repair* four times. The verdict is drawn from the findings after the last step, split in two so the endings can be told apart: objects that are **missing** (the remote may have them) and objects that are **damaged** (left alone by design, so fetching again would change nothing). And a fourth ending was found from a real log bundle after the first three shipped: missing objects that survive a full refetch while the branch is ahead of its upstream, or while the index's cache-tree names them, were **never on the remote** — they belong to unpushed commits or to the index, no download can bring them back, and advising a fresh clone there would discard the local commits. That case is what `repair-reset-upstream` exists for, and the plugin offers it instead of the clone advice whenever the local-only evidence is present.

**The recovery asks for the missing objects, not for the history.** This is the route that normally runs, and the reason is arithmetic: the full-history routes below download everything, which on a vault of a few gigabytes is a few gigabytes to recover a tree object of a few hundred bytes.

The mechanism is git's own partial-clone plumbing. A repository that names a remote as a *promisor* is permitted to be missing objects: when something asks for one, git fetches it from the promisor on the spot. Marking `origin` as one turns "this object is gone" into "this object has not been fetched yet", and then asking for each missing object — `git cat-file -t <oid>` — is the whole recovery. Measured on git 2.34 against a genuinely missing tree, with a remote that did not even support filtering: **52 KB transferred against a 3.7 MB history**.

The marking is undone afterwards, always, and that is not tidiness. A repository left marked as a partial clone treats every missing object as "not fetched yet", which is precisely the assumption that would make the verdict dishonest again. `core.repositoryformatversion` goes back to whatever it was (a 1 left behind with no extensions is a repository older git refuses to open at all), and any `.promisor` pack marker this created is removed, because a stale one lets a later fsck treat that pack's objects as promised rather than missing. A repository that was **already** a partial clone is left entirely alone: that configuration is the user's.

**Before git 2.41 there is no `--refetch`, and the fallback cannot be a plain fetch.** Both are reached only when the targeted recovery did not finish the job. Measured against a repository broken exactly this way, every cheaper idea transfers nothing at all:

| attempt | result |
| --- | --- |
| `git fetch --prune origin` | "Already up to date", silence |
| `git -c fetch.negotiationAlgorithm=noop fetch` | writes the ref, sends no pack |
| the same into refs that do not exist yet | the same |

The reason is identical each time: fetch decides what to **want** from whether the wanted commit is present locally, and it is — what is gone is a tree underneath it. No transfer starts, so negotiation never gets a say. `--refetch` exists to say "want everything, claim nothing", and on older git the runner instead builds a bare repository under `runtime/clone-tmp/`, fetches into it (a repository holding nothing has nothing to negotiate about) and copies its pack files in. That only ever *adds*: pack files are named after their own content, so a collision is a file already held, and no ref, index or working-tree file is touched. It costs the same full download `--refetch` costs, plus room for it, and the temporary copy is removed as soon as it has been read.

`git clone` was the first version of that and it failed on the device with `could not read Username for 'https://github.com': terminal prompts disabled`. Authentication here is per repository by design, so a brand-new clone has no credential configuration and — since the runner never permits a prompt on an ordinary run — no way to ask for one. The repository's `credential.*` keys are therefore passed on the **command line** (`git -c …`), not written into the temporary repository's config file: that directory is inside the vault, on shared storage, where file modes are not enforced and any app holding the storage permission can read it. A helper that embeds a token inline is a shape people really use, and writing that into the vault is exactly what rule 11 forbids. In argv it is readable only by the same uid, which is Termux, which owns the credential file anyway — and nothing is written, so nothing outlives the fetch.

Two limits of the check, both deliberate:

- **`--no-reflogs`.** By default fsck treats every reflog entry as a root, so an object that only a discarded local commit ever referenced counts as a fault — and the verdict for a fault a fetch cannot fix is "clone the vault again", the most destructive advice this plugin gives. Nothing is blocked by such an object: pull, merge, commit and checkout walk refs and the index, never the reflog.
- **Corrupt blob *content* is not detected.** Connectivity walks the graph, so it parses commits and trees and notices one that cannot be inflated; it never reads a blob's contents. A blob damaged but not empty is therefore invisible here, and `git fsck --full` in Termux is the tool for it. This action would not touch such an object anyway.

### Storage maintenance (runner 14)

The object database only ever grows on its own. The refetch recovery deliberately only adds pack files (removing anything mid-recovery would risk the repository it is trying to save), so every full refetch leaves the previous history's packs in place; an interrupted download leaves a `tmp_pack_*` file as large as whatever arrived, and nothing collects it. On a real device that compounded to 20 GB of `.git/objects` over a history of roughly 4 GB.

The cleanup is three actions the plugin sequences, for the same reason the repair is split: Android kills Termux in the background, and a short step loses a step where one long action loses the whole job. The plugin runs prune BEFORE repack because the repack needs headroom — the new pack is written while every old one still exists — and pruning a stale multi-gigabyte tmp file first is what makes that headroom likely to exist.

- `maintenance-scan` is read-only and cheap: raw `git count-objects -v` (whose `garbage`/`size-garbage` fields are exactly where interrupted-download residue lands) plus a size-and-name listing of the pack directory, so the confirmation the plugin shows is built from real numbers. Parsing happens in TypeScript.
- `maintenance-prune` runs `git prune --expire=<whitelisted>`, which walks refs, reflogs and the index and touches nothing they reach. Pack-directory `tmp_*`/`.tmp-*` files are removed by hand, with NO age grace: `git prune` does not clean the pack directory (that is `git gc`'s `clean_pack_garbage`), and any tmp file present while maintenance runs is an orphan by construction — the runner is single-instance locked, so no fetch of ours can be writing one, and nothing else writes there. An earlier one-hour grace spared a 4.31 GB corpse twice in one afternoon on a real device while protecting nothing.
- `maintenance-repack` runs `git repack -a -d`: everything reachable into one new pack, redundant packs removed by git itself and only after the new pack is complete, so an interruption leaves the repository whole plus one tmp file the next prune collects. `repack` prints no meter when stderr is not a terminal and has no progress flag, so the step announces itself in the progress stream and is otherwise silent — the same deal fsck has.

`git gc` was rejected as the one-shot answer: it does all of the above but also expires reflogs, and the reflog is the safety net this plugin's own repair verdicts rely on staying conservative (`--no-reflogs` exists in the fsck calls for the mirror-image reason). A rescue branch (`ngb-rescue-*`) keeps its objects reachable by design, so the scan names it and the space it holds is not freed until the user deletes the backup through `repair-drop-backup`.

### Repository footprint (runner 14)

A sparse checkout hides files from the working tree but not from the object database: the packs hold every version of every file, hidden or not, so a vault showing 200 MB can carry gigabytes of `.git`. Two standard git mechanisms cut that down, and both are DEVICE decisions — the shallow boundary and the partial-clone marking live inside `.git`, which git never syncs, so the plugin's settings show the repository's actual state (status carries `shallow` and `partialFilter`) and a toggle moves only after the runner has answered ok.

- **Shallow** (`repo-shallow`, depth from the plugin's device setting): only the newest N commits stay on this device. The action also expires the reflog, and that is not optional: reflog entries pin the old commits, and with the reflog kept the cut frees nothing until the entries age out. The user is explicitly discarding old history, so discarding this device's undo journal over it is the same decision, stated in the confirmation. Space returns with the next maintenance repack. `repo-unshallow` downloads the full history back.
- **Partial clone** (`repo-partial-enable`): the same `blob:none` marking the object recovery uses temporarily, made permanent — blobs are fetched when something needs them, and the content of files a sparse checkout hides is never fetched at all. Where this git can, the action also sheds already-held blob content (`repack --filter`, 2.42+) and prefetches the current checkout so the working set stays readable offline (`git backfill --sparse`, 2.49+); on older git both are skipped and reported, the marking still makes every future fetch light, and the maintenance repack sheds the rest once the git is new enough (it adds `--filter=blob:none` on a marked repository when supported). `repo-partial-disable` is the honest reverse: every promised object is fetched back first (`fetch --refetch`), and a repository that would be left incomplete is refused rather than unmarked.

The visible costs are stated where the user says yes: on a partial clone, *Show again (remove sparse exclusion)* and old file versions need the network; on a shallow one, the history panels reach only what stays. The repair verdicts already treat a user-owned partial clone as the user's configuration and leave it alone — that rule predates this feature and is why it needs no repair changes.

### Manual clone downloads, interactive runs and clone credentials (runner 15)

Authentication is per repository, and the runner never permits a prompt on an ordinary run (`GIT_TERMINAL_PROMPT=0`), which together leave one state with no exit: a clone of a private https remote into a vault whose profile has no saved credentials. A fresh vault has no repository and therefore no credential configuration; the clone can only fail with `could not read Username … terminal prompts disabled`, and re-running it changes nothing.

The exit splits the clone in two. The DOWNLOAD is a plain `git clone --no-checkout --progress` command the plugin builds and copies to the clipboard, run by the user in a Termux terminal: git's own credential prompts, git's own progress meter, into `runtime/clone-tmp/repo` — the same scratch path the runner's own download uses, prefixed with a wipe so an interrupted attempt never blocks the retry. The FINISH is the ordinary `clone-into-vault` request, sent when the user comes back and confirms: the runner finds the downloaded repository, checks that its `remote.origin.url` equals the validated URL the request carries and that HEAD resolves, and completes the collision-safe landing locally, downloading nothing. A resolvable HEAD is what separates a finished transfer from one still running or killed — `git clone` writes the remote config before the transfer and the refs only after it — and an unfinished one is refused with instructions rather than wiped, because wiping it would fail the very command the user is watching in Termux. A leftover pointing at a different remote is stale and is replaced by an ordinary download. Nothing is queued while the user is still typing a token, so nothing can expire or be claimed meanwhile. This stays inside the standing rule that the user touches Termux only to install the runner and to enter credentials.

An earlier shape of the same exit — pasting `runner.sh interactive`, where the runner queues run with prompts allowed — is kept as a capability: the same runner, same queue, same result files, but `GIT_TERMINAL_PROMPT=1`, with the progress stream mirrored to the terminal. It is no longer what the plugin hands out for clones (the runner's stderr redirection made a working clone look hung the moment the credential prompt was answered; a plain git command has nothing to hide), but it remains the way to let a QUEUED operation ask for credentials at a terminal — an expired PAT on fetch or pull, for example.

Credentials live in Termux and nowhere else, and every part of the flow holds to that. They are ENTERED only at a Termux terminal (the interactive run). They are STORED only in Termux-private files — the profile's `creds/<profile>` (mode 600) or whatever global helper the user configured in Termux's own gitconfig. And they are REUSED at a re-clone only from those two places: the profile's store helper is added to the clone's command line (argv only, nothing written into the vault), and a global helper applies to the temporary clone by inheritance. v14 briefly did this differently — it copied the replaced repository's `credential.*` keys onto the command line, which read them out of the vault's own `.git/config`, a file on shared storage, so a setup that kept credentials inside the vault kept working. That passthrough is removed: a re-clone whose credentials exist only inside the vault now fails over to the interactive run, which saves them where they belong.

So that the credentials are asked for once rather than on every operation, the manual command carries `-c credential.helper=store --file=$HOME/.config/native-git-bridge/creds/<profile>`: clone-time `-c` both applies during the initial fetch and persists into the cloned config, so what the user types is saved per repository, in Termux, and travels into the vault only as a helper line carrying a file PATH — the same thing the installer writes, never a credential. The runner's own https download adds the same helper on its command line, and `persist_clone_credentials` writes it into a landed repository when no helper is configured anywhere already: a configured helper is somebody's deliberate setup and is left alone. Without that a re-clone quietly disarmed itself — the old repository's config died with the old `.git`, and the very next fetch failed where the clone had just succeeded.

The plugin decides the route before the round trip, from what is already known: a fresh https clone goes to the manual route outright (a repository that does not exist has no credentials by construction), a re-clone goes there when status reports `credsConfigured=false` (no Termux-side credentials — a vault-local helper deliberately does not count), and everything else — ssh, file, Termux-side credentials present — takes the companion route as before. A companion-route clone that still fails wanting credentials is answered with the same manual-route offer, offered rather than taken. `credsConfigured` is absent on older runners, and absent means unknown, which routes to the companion: an old runner must not have every re-clone sent to the terminal.

### Identity and credential scope, value-free (runner 16)

The rule that shapes all of it: the git identity's VALUES never enter the runner, the plugin, a result file or a log. Presence and scope are all the bridge ever learns — `git config --list --show-scope --name-only` answers "which scopes hold `user.name`, `user.email`, `credential.helper`" in one process without printing a value, and `require_identity` tests presence through `--name-only` output counts rather than capturing anything. Setting an identity therefore happens only at a Termux terminal, with git's own prompts; the plugin hands over the command on the clipboard.

Two facts about git config decide the two actions. Identity precedence is local over global (and worktree over local), so the hazard is not an override: it is that a repository with NO local identity commits under the global one silently — which is exactly what a re-clone produces, because a fresh `.git` takes the local config with the old one. `identity-drop-global` removes the global identity value-free, and it refuses — as does the plugin, before ever offering it — while the repository has no local identity, because with no local one the global identity is the only thing letting commits happen anywhere on the device.

`credential.helper` behaves the opposite way: it is multi-valued, ACCUMULATES across scopes, and the first helper that answers wins — system, then global, then local — so a global helper silently shadows the profile's own credential file. An empty value in the local config resets the inherited list, which makes `cred-helper-local-reset` two `--add` lines: the empty reset, then the profile's `store --file=…` helper. The installer writes the same pair, and the manual clone command carries the same empty `-c credential.helper=` ahead of its store helper so a cloned config is born protected.

### The stale-lock triage (runner 16)

`repair-stale-lock` (v15) killed blind: every other process of the uid, no questions, and it had never said it closes an open Termux session. v16 splits the reading from the killing. `repair-triage` reports the lock's existence and age, every other live process of the uid with its command name, the set-aside previous repositories, and the ordinary status fields — read-only, one round trip. The plugin's plan follows from two of those facts: a live git plus a fresh lock is a RUNNING command and the answer is to wait (interrupting a write is how object files end up empty); a lock with no process that could be holding it is a corpse from Android stopping Termux and is simply removed (`args.skipKill`, no kill, nothing closes); anything else keeps the kill, behind a confirmation that names what stops. The action reports `killedProcesses` so the result can say what it did rather than that it did something.

### Why a version sometimes grows instead of becoming the next one

The rule above says a runner version number is never reused. `unstage-protected`, `abort-rebase`, `continue-rebase` and `rebaseInProgress` were added to v11 anyway, during the window when 0.6.1 had not yet been released: no release had shipped a v11 runner, so no installed v11 could be stale. The only device carrying one was the developer's, reinstalled by hand alongside that change.
That exception closed when 0.6.1 shipped. Everything after it is v12, which is why v12 carries two unrelated features rather than one.

The same window opened again for v13, which is why it carries the `sync` reordering, the four-step object repair and the progress stream together. The condition is the whole rule and it is narrow: **no release has shipped that runner version**, so the only device that can be carrying it is the developer's, and that one is reinstalled by hand alongside the change. The moment a release goes out, the number is spent — a device in the field would then report a version whose behaviour it does not have, and the handshake would believe it.

### Leaving an unfinished operation (runner 11)

Both additions are exits from states the plugin could see but not leave.

**`unstage-protected`** — `args.paths[]` + `args.protectedPaths[]`. Removes protected sparse paths from the index, and does nothing else. It is the only write the runner performs on a protected path. Three conditions are checked before anything is removed:

1. the path is protected (the inverse of the usual guard, so the action cannot serve as a general bypass);
2. it has an exact index entry;
3. it is **not** in HEAD.

Condition 3 is the safety argument. With no committed content at that path, dropping the index entry undoes an addition and cannot become a staged deletion.
The file on disk, where there is one, is left alone.

The state this addresses: a file staged inside a directory that was added to the sparse exclusions afterwards. `git sparse-checkout reapply` takes the file off disk and leaves the index entry, with skip-worktree set. `git status` then reports a bare `A `. Skip-worktree stops git looking at the worktree, so nothing in the output says the file is missing. The safety gate blocked commit, push and sync; the plugin's "delete these files" repair moved nothing, there being no file; and `unstage-file` was refused by the protected-path guard. Termux was the only way out.

`git rm --cached` cannot do the removal: the path lies outside the sparse-checkout definition, and git refuses ("matched paths that exist outside of your sparse-checkout definition") without `--sparse`, which requires git 2.35. The runner uses `git update-index --force-remove`, which has no such guard and works on every version.

**`abort-rebase`, `continue-rebase`, and `rebaseInProgress` in status.** Nothing in the plugin starts a rebase; one reaches this state only by starting it in Termux. Detection differs from a merge: there is no `MERGE_HEAD`, only a state directory, whose name depends on the backend git chose: `rebase-merge` for the merge and interactive backends, `rebase-apply` for the older am backend. Both are checked.

`continue-rebase` refuses while any path is unmerged, and reports how many.
`git rebase --continue` in that state opens an editor, and the runner has no terminal, so it would hang until the request expired. When it does run,
`GIT_EDITOR=true` accepts the message git prepared.

### Hunk-level staging (runner 12)

**`apply-patch`** — `args.patch`, `args.target` (`index` | `worktree`), `args.reverse`, `args.protectedPaths`. One action for three operations, because they are one operation pointed three ways:

| operation | target | reverse | effect |
|---|---|---|---|
| stage hunk | `index` | no | the hunk enters the index; the file is untouched |
| unstage hunk | `index` | yes | the hunk leaves the index; the file is untouched |
| discard hunk | `worktree` | yes | the hunk leaves the file |

The patch arrives as a field and is written to a file before git sees it, never as an argument: the 128 KB `execve` limit applies, and a patch contains newlines and whatever else the vault holds.

Three guards, in order. The patch must name exactly ONE path, taken from the patch itself rather than from the request, because the patch is what git acts on; that path must pass `valid_rel_path`; and it must not be protected.

No `--3way` and no fuzz. A patch that does not apply exactly means the diff the user was reading is stale, and the answer is to say so, not to guess where the hunk belongs now. The error message says to refresh the diff.

### The diff budget (runner 12)

`diff-file` takes `args.maxBytes` and keeps WHOLE hunks within it, reporting `hunksShown`, `hunksTotal`, `diffBytesTotal` and `diffBytesLimit` so the pane can say "12 of 40 hunks" and offer to fetch the rest for that one diff.

This replaced a cap that sliced the diff text with bash's `${s:0:n}`, which had two faults. It was locale-dependent: measured on one file, `${#s}` reported 216 "characters" under `LC_ALL=C` and 154 under UTF-8, for 217 actual bytes, so one number meant two different sizes depending on the environment. And the byte form could cut a multi-byte character in half — truncating `Це` at 3 bytes yields `d0a6d0`, which jq turns into `Ц` plus a replacement character.

Cutting between hunks removes both: the seam is always a line boundary, so the output is always valid UTF-8, and `LC_ALL=C awk` makes the measurement mean bytes everywhere. Half a hunk was never useful anyway — it cannot be staged, cannot be applied, and forces every reader to tolerate a broken tail.

Note the `NGB_FIELD_MAX_BYTES` ceiling (4 MB) is the real transport limit and always was; the diff cap is a rendering budget. The pane costs about 12 DOM nodes per diff line, which is what actually decides whether a diff feels instant.

Versions 1–3 predate the first tagged release: the oldest runner any published release shipped is v4. Actions introduced after v4 are additionally listed in the plugin's `ACTION_MIN_RUNNER` map, so requesting one against an older runner produces a named "runner too old for this action" message instead of a bare `BAD_REQUEST`. Capabilities that are argument-level rather than new actions (the `INDEX` ref, `stage-file` `mode`) are covered by the version handshake only, hence the strict `RUNNER_MIN_VERSION` bump for them.
