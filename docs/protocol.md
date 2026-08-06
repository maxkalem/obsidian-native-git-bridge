# Request/response protocol v1

Directory (repo-relative, excluded via `.git/info/exclude`), one per paired vault:

```
.obsidian/plugins/native-git-bridge/runtime/
  requests/<id>.json                        written by plugin, consumed (moved to done/) by runner
  results/<id>.json                         written atomically by runner (tmp + mv)
  cancel/<id>                               empty flag file; runner checks between steps
  done/<id>.json                            processed requests (kept ≤ 24 h)
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
- `action` (implemented): `ping` | `status` | `verify-sparse-safety` | `sparse-reapply` | `diagnostics` | `fetch` | `pull` | `commit` | `push` | `sync` | `abort-merge`.
  - **Runner v4**: `file-log` (paginated, rename-aware via `--follow --name-status`), `show-file-at-commit` (base64 content, 1 MB cap, `FILE_ABSENT`/`TOO_LARGE` errors), `diff-file` (commit→commit or commit→WORKTREE, 200 KB cap with `truncated` flag; a commit-ish may carry a single trailing `^` so the history panel can diff a commit against its parent), `restore-file` (worktree-only `git restore --source`, blocked for protected paths).
  - **Runner v5**: `repo-log` (repository-wide paginated log for the history panel, same `\x1e`/`\x1f` record format as `file-log` with a `--name-status` block per commit, no `--follow`).
  - **Runner v6**: `resolve-conflict` (`args.path` + `args.side` = `ours`|`theirs`; refuses non-conflicted paths and protected paths, then `git checkout --<side>` + `git add` to mark the file resolved, only ever on an explicit user choice; the bridge never picks a side by itself).
  - **Runner v7**: `diff-file` accepts the `INDEX` pseudo-ref (`HEAD→INDEX` = `git diff --cached`, `INDEX→WORKTREE` = plain `git diff`; INDEX pairs with nothing else), `stage-file` accepts `args.mode` = `all` (default) | `update` (`git add -u`, for folder rows in the tracked-changes group), FAILED mutating actions still attach fresh status fields to `data` (merged with any error payload such as `data.conflicts`), and the runner prints `NGB_RUNNER_VERSION=<n>` on stdout so the companion app's probe can learn the current runner version.
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

- `data` carries *raw* git output fields (e.g. `statusPorcelainV2`, `sparseCheckoutList`); parsing happens in TypeScript so bash stays trivial and auditable.
- `profileId` (runner ≥ 10): the profile that answered. A vault with no id yet adopts the one from its first result; a vault that already has one never replaces it on the strength of a result (that would be the plugin re-pointing itself at another repository).
- `error`: `{ "code": "AUTH" | "BAD_REQUEST" | "GIT_FAILED" | "CANCELLED" | "SAFETY_BLOCKED" | "TIMEOUT" | "EXPIRED" | "RUNNER_INTERNAL" | "CONFLICT" | "FILE_ABSENT" | "TOO_LARGE" | "REPO_MISSING", "message": "…" , "stdout": "…", "stderr": "…" }`.
- Written atomically: `results/<id>.json.tmp` → `mv` → `results/<id>.json`.

## `status` result data
`branchInfo` (git status --porcelain=v2 --branch), `sparseEnabled`, `sparseCone`, `sparseCheckoutList`, `skipWorktreeCount`, `lastCommit` (`git log -1 --format=%H%x09%cI%x09%s`), `remoteUrlRedacted`, `mergeInProgress` + `mergeMsg` (runner v7+: `true` while MERGE_HEAD exists, plus git's own prepared `MERGE_MSG`, so the plugin can prefill the commit modal after a manual conflict resolution and let `sync` commit the merge without asking), `untrackedChildren` (runner v5+: newline-separated raw paths of the files inside fully untracked directories. git status collapses such a directory to one `dir/` entry, so without this field the plugin cannot show the files in a freshly created folder; collected via `git ls-files --others --exclude-standard -z`, so quoting never applies). The same fields ride along on every mutating action's result so the plugin can refresh without a second round trip.

## `verify-sparse-safety` result data
`statusProtected` (porcelain v1 limited to protected paths), `stagedProtected` (`git diff --cached --name-status -- <paths…>`), plus the inputs echoed back. The **plugin** computes the verdict; the runner additionally refuses `commit`/`push`/ `sync` actions itself if either output is non-empty (defense in depth).

## Lifecycle rules
- Plugin polls `results/<id>.json` every 400 ms until `timeoutSeconds`. On timeout it reports TIMEOUT, writes `cancel/<id>` (so the request can never *execute* at some later trigger) and leaves the request file for the runner to archive.
- Cancellation: plugin creates `cancel/<id>`; a not-yet-started request is skipped by the runner with a CANCELLED result; a running mutating git command is never killed mid-flight (index safety); cancellation applies between steps.
- Expiry (runner ≥ 3): a queued request older than `createdAt + timeoutSeconds + 600 s` is answered with an EXPIRED error instead of being executed. A days-old `sync` must never surprise the user with a commit. An unparsable `createdAt` fails open (executes), so a broken clock cannot brick the bridge.
- Interrupted requests (found in `processing/` at startup) are requeued exactly once, tracked by a `<name>.retried` marker; a second interruption yields a RUNNER_INTERNAL result and the request is archived, so `processing/` never accumulates and a poison request cannot loop forever.
- Both sides delete `done/`, `results/`, `cancel/` entries older than 24 h; the plugin also sweeps `requests/` older than 24 h (a request that never reached Termux must not linger), and the runner sweeps orphaned `.retried` markers.
- The runner processes requests oldest-first, one at a time, and exits when the queue is empty. It never daemonizes. From v10 "the queue" is the union of every profile's `requests/` directory, sorted by request id (ids embed a UTC timestamp, so that is chronological across vaults).

## Config-management actions (runner ≥ 4)
`sparse-exclude-add` / `sparse-exclude-remove` edit non-cone sparse patterns (`!/<path>` appended / removed, full list re-applied via `git sparse-checkout set --no-cone --stdin`); cone-mode repos are refused. `exclude-add` / `exclude-remove` / `exclude-list` manage literal lines in `$GIT_DIR/info/exclude`. All take a validated repo-relative `path`; all return fresh status fields (and `excludeList`) so the plugin can refresh its caches. `.gitignore` is a tracked vault file and is edited by the plugin directly; no runner action exists for it.

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
| 10 | 0.5.11 | Several repositories per device: `profiles/<id>.conf` (one per vault, own token), automatic migration of the single-repo config, one run drains every profile oldest-first, `profileId` in requests and results, `REPO_MISSING` for a dead profile, git pinned per profile (`GIT_CEILING_DIRECTORIES` + toplevel check) so nested vaults cannot leak into each other, nested-vault exclusion in the outer repository's `.git/info/exclude`, relocation of a moved vault and self-pairing of a new one (`claim.json` → `pairing.json`), global single-instance lock in the config directory |

Versions 1–3 predate the first tagged release: the oldest runner any published release shipped is v4. Actions introduced after v4 are additionally listed in the plugin's `ACTION_MIN_RUNNER` map, so requesting one against an older runner produces a named "runner too old for this action" message instead of a bare `BAD_REQUEST`. Capabilities that are argument-level rather than new actions (the `INDEX` ref, `stage-file` `mode`) are covered by the version handshake only, hence the strict `RUNNER_MIN_VERSION` bump for them.
