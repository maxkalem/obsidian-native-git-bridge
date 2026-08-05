# Known limitations (honest list, Phase 1–2)

1. **The companion app is required.** A pure Obsidian plugin cannot send Termux's
   RUN_COMMAND intent (the sender must hold `com.termux.permission.RUN_COMMAND` in its
   own manifest), so the small companion app is mandatory. The Termux:Widget variant was
   dropped because it needed a manual tap per operation. Running
   `~/.config/native-git-bridge/runner.sh` in Termux by hand remains a recovery path.
2. **Companion transport verified on-device; still device-specific caveats.** The thin companion app
   (`companion/`) is complete and CI-buildable (`.github/workflows/build-companion.yml`),
   but two things still need a real device: (a) that Obsidian's Android WebView
   dispatches `window.open("nativegitbridge://…")` — a synthetic-anchor-click fallback
   is included; (b) the RUN_COMMAND permission grant + `allow-external-apps` flow.
   The APK cannot be compiled in this environment (no Android SDK); use the CI
   workflow or Android Studio.
3. **This environment cannot run Android/Termux.** The runner script is exercised
   end-to-end in a Linux sandbox against a real git repo with sparse checkout —
   identical git semantics, but Android storage permissions, scoped-storage quirks
   (e.g. `mv` atomicity on FUSE shared storage) and widget behavior need on-device QA.
   On some Android FUSE mounts `mv` within one directory is atomic enough, but this is
   asserted, not proven here; the plugin tolerates partially-written results by
   retrying JSON parse on next poll.
4. **Wi-Fi-only and battery-aware sync**: Obsidian plugins have no stable public API
   for network type or battery level; `navigator.connection` / `navigator.getBattery`
   exist in some WebViews but are not guaranteed. Implemented as best-effort,
   default-off, and clearly labeled.
5. **Version History Diff has no public provider API** (uses obsidian-git's private
   plugin API). This plugin therefore ships its OWN history and diff views (the
   repository history panel and the diff pane, rendered by bundled diff2html in
   the same visual style); an upstream adapter PR remains an option. We will
   not monkey-patch another plugin's internals. One known nuance of our diff
   pane: a pure rename can display as an addition, because the runner limits
   the diff pathspec to the file's new path.
   The conflict-resolution pane writes REMAINING (unresolved) blocks back in
   an Obsidian-safe marker form (`-<<<<<<<` / `-=======` / `->>>>>>>`): the
   standard markers render a note as headings and nested blockquotes in
   Obsidian's editor. Both forms are parsed; git is unaffected (the unmerged
   state lives in the index) — but a desktop editor will show the dashed
   markers on a file half-resolved on the phone.
6. **Foreground-session commands on Android ≥ 10** may require Termux's
   "Draw over other apps" permission; the runner therefore always runs as a
   **background task** (`.shortcuts/tasks/`), which is unaffected.
7. **stdout/stderr size**: results carry full outputs in files (no intent size limits),
   but the plugin truncates displayed output at 100 KB with a "see runner.log" hint.
