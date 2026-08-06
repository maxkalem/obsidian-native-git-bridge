# Request/response protocol v1

Directory (repo-relative, excluded via `.git/info/exclude`):

```
.obsidian/plugins/native-git-bridge/runtime/
  requests/<id>.json                        written by plugin, consumed (moved to done/) by runner
  results/<id>.json                         written atomically by runner (tmp + mv)
  cancel/<id>                               empty flag file; runner checks between steps
  done/<id>.json                            processed requests (kept ≤ 24 h)
  runner.log                                runner log, secrets stripped, size-capped
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
  "args": {}
}
```

- `id`: `^r-[0-9TZ.-]+-[a-z0-9]+$`, unique per request.
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
  "data": { "…action-specific raw command outputs…" },
  "error": null
}
```

- `data` carries *raw* git output fields (e.g. `statusPorcelainV2`, `sparseCheckoutList`); parsing happens in TypeScript so bash stays trivial and auditable.
- `error`: `{ "code": "AUTH" | "BAD_REQUEST" | "GIT_FAILED" | "CANCELLED" | "SAFETY_BLOCKED" | "TIMEOUT" | "EXPIRED" | "RUNNER_INTERNAL" | "CONFLICT" | "FILE_ABSENT" | "TOO_LARGE", "message": "…" , "stdout": "…", "stderr": "…" }`.
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
- The runner processes requests oldest-first, one at a time, and exits when the queue is empty. It never daemonizes.

## Config-management actions (runner ≥ 4)
`sparse-exclude-add` / `sparse-exclude-remove` edit non-cone sparse patterns (`!/<path>` appended / removed, full list re-applied via `git sparse-checkout set --no-cone --stdin`); cone-mode repos are refused. `exclude-add` / `exclude-remove` / `exclude-list` manage literal lines in `$GIT_DIR/info/exclude`. All take a validated repo-relative `path`; all return fresh status fields (and `excludeList`) so the plugin can refresh its caches. `.gitignore` is a tracked vault file and is edited by the plugin directly; no runner action exists for it.

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

Versions 1–3 predate the first tagged release: the oldest runner any published release shipped is v4. Actions introduced after v4 are additionally listed in the plugin's `ACTION_MIN_RUNNER` map, so requesting one against an older runner produces a named "runner too old for this action" message instead of a bare `BAD_REQUEST`. Capabilities that are argument-level rather than new actions (the `INDEX` ref, `stage-file` `mode`) are covered by the version handshake only, hence the strict `RUNNER_MIN_VERSION` bump for them.
