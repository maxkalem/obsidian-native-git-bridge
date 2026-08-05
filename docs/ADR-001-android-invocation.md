# ADR-001: Android invocation mechanism for native Git via Termux

Status: Accepted · Date: 2026-08-03 · Amended 2026-08-04

## Context

The plugin must run native Git (with sparse checkout / skip-worktree support) for an Obsidian vault on Android. Obsidian mobile is a Capacitor app; plugins are JavaScript running inside its WebView. A plugin cannot spawn processes, cannot bind ports (and is forbidden to by requirements), and cannot declare Android permissions of its own.

Native Git lives inside Termux. Termux offers exactly one supported programmatic entry point for third parties, plus one supported user-triggered entry point.

## Verified facts (sources checked 2026-08-03)

1. **RUN_COMMAND Intent** (termux-app wiki, "RUN_COMMAND Intent", rev. 2026-05-30):
   - Third-party apps can run commands in Termux by sending an intent to `com.termux.app.RunCommandService`.
   - **Mandatory:** the *sender app* must declare `com.termux.permission.RUN_COMMAND` in **its own `AndroidManifest.xml`**, and the user must grant it.
   - **Mandatory:** `allow-external-apps=true` in `~/.termux/termux.properties`.
   - Obsidian's manifest does not declare this permission. An Obsidian plugin cannot add manifest entries. **Therefore a pure Obsidian plugin cannot send RUN_COMMAND.**
   - Android does not allow starting a *service* from an `intent:` URI opened by a WebView/browser (`Intent.parseUri` results are delivered via `startActivity` only). So an `intent://…RunCommandService` URL is not a workaround.

2. **Termux:Widget** (termux-widget README, v0.15.0):
   - Scripts in `~/.shortcuts/tasks/` run as **background tasks in Termux** when the user taps a home-screen widget entry, a pinned launcher shortcut, or a dynamic shortcut. No extra permission on the calling side; the tap *is* the authorization.
   - Fully documented; requires no third-party app.

3. **obsidian-git README** (Vinzent03/obsidian-git, master): mobile backend is isomorphic-git, explicitly described as "very unstable"; "It is not possible for an Obsidian plugin to use a native Git installation on Android or iOS" (i.e. not possible *in-process*, which is why this project delegates to Termux).

4. **Version History Diff** (kometenstaub/obsidian-version-history-diff): MIT licensed. Its README states it "uses private APIs" and credits Vinzent03 "for creating the necessary APIs in the Obsidian Git plugin", i.e. it consumes obsidian-git's plugin instance directly; there is **no documented provider-registration API**.

## Decision

Implement a **file-based request/response protocol** through the vault directory (which both Obsidian and Termux can read/write), with a pluggable **trigger transport** deciding how the Termux-side runner gets started:

- **Transport A, `widget-manual` (default; fully verified):** The plugin writes `runtime/requests/<id>.json`, then shows a persistent notice: "Tap the *Git Bridge* Termux shortcut". The user taps the pinned Termux:Widget shortcut; `~/.shortcuts/tasks/GitBridge` runs the runner once; the runner drains pending requests, writes `runtime/results/<id>.json`, and exits. The plugin polls the result file (only while the operation is in flight) and renders it. One tap per batch of operations; zero background services; zero extra apps.

- **Transport B, `companion-intent` (optional; enables tap-free automation):** A minimal companion app (~1 activity) declares `com.termux.permission.RUN_COMMAND` and exposes an exported, BROWSABLE activity for a custom scheme (`nativegitbridge://run?...`). The plugin opens that URI with `window.open()`; the companion forwards a RUN_COMMAND intent that executes the fixed runner script path (never a caller-supplied command), then finishes. The runner still reads the request *file*; the URI carries only the request id (no command content, no token). Status: the RUN_COMMAND side is documented; **whether Obsidian's WebView reliably dispatches `window.open(customScheme)` to Android must be verified on-device** before this transport is declared working. It ships behind a setting marked "experimental"; the companion app is a later-phase deliverable.

Rejected alternatives:
- Local HTTP server / port listener in Termux: forbidden by requirements, and would require a permanent background process.
- Termux:Boot / cron / inotify daemon watching the request dir: permanent background process; forbidden.
- Direct RUN_COMMAND from Obsidian: impossible (permission must be in sender manifest).
- Tasker / MacroDroid glue: workable for individual users but not a supportable default; documented in README as a DIY variant of Transport B.

## Request/response flow (both transports)

```
Obsidian plugin                    shared vault dir                    Termux
--------------                     ----------------                    ------
1. acquire op lock
2. write requests/<id>.json  ───►  .obsidian/plugins/<id>/runtime/
3. trigger transport (notice or intent URI)
                                                            4. runner starts (widget tap
                                                               or RUN_COMMAND), reads
                                                               request, validates token,
                                                               action allow-list, paths
                                                            5. runs git with argv arrays
                                                            6. writes results/<id>.json.tmp,
                                                               mv → results/<id>.json, exits
7. poll results/<id>.json (400 ms, bounded by timeout)
8. parse, render, cleanup, release lock
```

Nothing listens when no operation is active. If Obsidian is killed mid-operation, a dispatched runner may still finish writing the result file; on next launch the plugin reconciles the persisted "operation in flight" marker against the results directory.

## Consequences

- Manual mode costs the user one tap per operation batch, the honest price of "no server, no background process, no companion app".
- The runtime directory lives inside the repo, so the installer adds it to `.git/info/exclude` (local-only, never synced).
- All git execution and argument handling happens in bash on the Termux side with an action allow-list; the plugin never composes shell strings.

## Amendment (2026-08-04): widget transport dropped

Transport A (`widget-manual`) was implemented and worked, but it required a manual Termux:Widget tap for **every** operation, which defeats the "press a button in Obsidian and it runs" requirement. Once the companion app (`companion/`) was verified end-to-end on-device, including the RUN_COMMAND result coming back through a PendingIntent, the widget transport was removed together with the integration-type setting: there is now exactly one supported mechanism, so there is nothing for the user to choose.

The runner remains a plain one-shot script, so running `~/.config/native-git-bridge/runner.sh` by hand in Termux is still a valid recovery path if the companion app is unavailable. That is documented as recovery, not as a mode.
