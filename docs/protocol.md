# Request/response protocol v1

Directory (repo-relative, excluded via `.git/info/exclude`):

```
.obsidian/plugins/native-git-bridge/runtime/
  requests/<id>.json      written by plugin, consumed (moved to done/) by runner
  results/<id>.json       written atomically by runner (tmp + mv)
  cancel/<id>             empty flag file; runner checks between steps
  done/<id>.json          processed requests (kept ≤ 24 h)
  runner.log              runner log, secrets stripped, size-capped
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
- `action` (implemented): `ping` | `status` | `verify-sparse-safety` |
  `sparse-reapply` | `diagnostics` | `fetch` | `pull` | `commit` | `push` | `sync` |
  `abort-merge`. Phase 4 adds `file-log`, `show-file-at-commit`, `diff-file`,
  `restore-file`. `pull`/`commit`/`push`/`sync` require `args.protectedPaths`
  (validated on both sides) and enforce the sparse safety gate; `commit`/`sync`
  require `args.message` (`sync` falls back to a default). Conflicts are returned
  as `error.code = "CONFLICT"` with `data.conflicts`; safety violations as
  `error.code = "SAFETY_BLOCKED"` with `data.statusProtected`/`data.stagedProtected`.
  Staging always uses `git add -A -- . ":(exclude)<protected>"…`, so protected
  paths can never enter the index through the bridge.
- `args` are action-specific; every path is repository-relative and validated on
  **both** sides.

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

- `data` carries *raw* git output fields (e.g. `statusPorcelainV2`,
  `sparseCheckoutList`); parsing happens in TypeScript so bash stays trivial and
  auditable.
- `error`: `{ "code": "AUTH" | "BAD_REQUEST" | "GIT_FAILED" | "CANCELLED" |
  "SAFETY_BLOCKED" | "TIMEOUT", "message": "…" , "stdout": "…", "stderr": "…" }`.
- Written atomically: `results/<id>.json.tmp` → `mv` → `results/<id>.json`.

## `status` result data
`branchInfo` (git status --porcelain=v2 --branch), `sparseEnabled`,
`sparseCone`, `sparseCheckoutList`, `skipWorktreeCount`, `lastCommit`
(`git log -1 --format=%H%x09%cI%x09%s`), `remoteUrlRedacted`.

## `verify-sparse-safety` result data
`statusProtected` (porcelain v1 limited to protected paths), `stagedProtected`
(`git diff --cached --name-status -- <paths…>`), plus the inputs echoed back.
The **plugin** computes the verdict; the runner additionally refuses `commit`/`push`/
`sync` actions itself if either output is non-empty (defense in depth).

## Lifecycle rules
- Plugin polls `results/<id>.json` every 400 ms until `timeoutSeconds` (then reports
  TIMEOUT but leaves the request in place — the runner may still be waiting for a tap).
- Cancellation: plugin creates `cancel/<id>`; a not-yet-started request is skipped by
  the runner with a CANCELLED result; a running mutating git command is never killed
  mid-flight (index safety) — cancellation applies between steps.
- Both sides delete `done/`, `results/`, `cancel/` entries older than 24 h.
- The runner processes requests oldest-first, one at a time, and exits when the
  queue is empty. It never daemonizes.
