# Troubleshooting

Every failed operation shows an error code. Find yours below. When in doubt,
run *Native Git: Check bridge* (local, instant) and *Native Git: Diagnostics*
(full Termux round trip), and check the operation log (the `log` button in the
status panel).

## TIMEOUT — the plugin stopped waiting

The request never got an answer. The plugin writes a cancel flag, so the
operation will **not** execute later, and runs the local bridge check
automatically. The companion (≥ 0.4.0) acknowledges every trigger back to the
plugin, which splits the diagnosis in two:

- **No acknowledgement** — the trigger never reached the companion. The plugin
  opens the companion's checklist automatically (once per session); if neither
  an ack nor an app switch follows, it offers the APK download link, because
  that means the companion is not installed at all.
- **Acknowledged but no result** — the companion is fine; the break is further
  down (Termux force-stopped, runner missing/outdated, wrong vault path). See
  the bridge-check verdict.

In order of likelihood:

1. **Companion app missing or unpermitted.** Open the companion — all three
   checklist items must be green.
2. **Runner installed for a different vault.** The local check reports when
   `runner.log` has never appeared in *this* vault's runtime folder: the
   installer was pointed at another path. Re-run the install command with the
   correct vault path.
3. **Termux was force-stopped** (battery optimization). Open Termux once and
   retry; consider excluding Termux from battery optimization.
4. **A very slow network operation.** Raise the timeout in settings; the runner
   itself caps network git at 120 s per command.

Recovery path: run `~/.config/native-git-bridge/runner.sh` by hand in Termux
and watch its output.

## AUTH — pairing token mismatch

The plugin and the runner hold different tokens (usually after re-running the
installer on a device where the plugin had already paired). Re-running the
installer keeps the existing token, so this normally heals on the next plugin
start (it imports `pairing.json`). If not: plugin settings → pairing → import
or paste the token printed at the end of the install output.

## SAFETY_BLOCKED — sparse checkout safety check failed

The load-bearing guarantee. Protected paths appeared as git changes (status or
staged), so commit/push/sync stopped before touching anything. This happens
when sparse checkout got disabled or its rules changed, or something staged
protected paths outside the bridge. Do **not** commit from another tool.
Run *Native Git: Verify sparse safety* to see the exact entries, then
*Native Git: Reapply sparse checkout*. If entries remain staged, unstage them
in Termux (`git restore --staged -- <path>`), then verify again. The bridge
never auto-repairs here by design.

## CONFLICT — merge conflicts

A pull/sync produced conflicting files; nothing was committed or pushed. The
Conflicts group in the status panel lists them. Either resolve each file in the
editor and run sync again, or *Native Git: Abort merge* to return to the
pre-merge state. The bridge never picks a side automatically.

## GIT_FAILED — git itself said no

The result carries git's stdout/stderr (Copy button in the modal). Common
cases and their meaning:

- `Authentication failed` / `could not read Username`: expired or missing PAT.
  Fix credentials in Termux (e.g. `git pull` once interactively to re-enter the
  PAT into the credential store). The runner never prompts — it fails fast.
- `[rejected] ... fetch first` / `non-fast-forward`: the remote moved ahead.
  Run *Sync* (fetch + merge + push) instead of a bare push. Force push does not
  exist in this bridge.
- `Detached HEAD; refusing to push`: check out a branch in Termux. The bridge
  never guesses which branch you meant.
- `user.name / user.email are not configured`: run the two `git config
  --global` commands shown in the message, in Termux.

## BAD_REQUEST — invalid request

An unknown action, invalid path (absolute, `..`, inside `.git`, git pathspec
magic), over-long commit message, or malformed arguments. When triggered by
normal UI use this indicates a plugin/runner version mismatch — see
RUNNER_INTERNAL below.

## RUNNER_INTERNAL — the runner could not finish

A serialization failure (see `runner.log` in the runtime folder), or a request
that was interrupted twice and given up on. Most commonly the runner is simply
**outdated**: updating the plugin never updates the runner. Re-run the install
command (Settings → Copy command); the plugin's version handshake tells you
explicitly when this is the case.

## EXPIRED — a stale request was skipped

The runner found a request whose creation time was long past (plugin no longer
waiting). It answered EXPIRED instead of executing — a days-old sync must never
surprise you with a commit. Just run the operation again.

## CANCELLED

You cancelled, or a timed-out request was later archived. Nothing was executed
(a git command already mid-flight is never killed mid-index-write; cancellation
applies between steps).

## FILE_ABSENT / TOO_LARGE (history views)

The file does not exist at that commit (rename? use the file history view,
which follows renames), or is beyond the 1 MB view limit at that commit.

## Still stuck

`~/.config/native-git-bridge/runner.sh` in Termux runs the exact same code
path by hand and prints everything. `runner.log` in
`<vault>/.obsidian/plugins/native-git-bridge/runtime/` records every run.
Nothing else logs anywhere; credentials never appear in either.
