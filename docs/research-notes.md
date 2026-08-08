# Phase 1 research notes (2026-08-03)

## Obsidian plugin API (relevant surface)
- `Plugin.addCommand/addRibbonIcon/addStatusBarItem/addSettingTab`, `Notice`, `Modal`, `SuggestModal`, `Platform.isAndroidApp`, `Vault.adapter` (read/write/exists/mkdir/ remove/list): sufficient for the file protocol; adapter paths are vault-relative.
- `app.appId` (undocumented but long-stable) is a per-install identifier; used with a fallback UUID for scoping device-local storage keys. `localStorage` in Obsidian is per-app-install, not synced; meets the device-local requirement.
- Plugin data.json (`loadData/saveData`) may be synced with the vault → only non-device-specific UI prefs go there.

## Vinzent03/obsidian-git
- [obsidian-git](https://github.com/Vinzent03/obsidian-git) on mobile = isomorphic-git; README: "highly unstable", no SSH, memory limits.
- isomorphic-git does not honor skip-worktree/sparse-checkout index extensions (`sparse-checkout` is unimplemented there), so letting it touch a native sparse index risks staging mass deletions, which is the failure this project prevents. Hence the Android-side incompatibility warning when both plugins are enabled.

## kometenstaub/obsidian-version-history-diff
- [Version History Diff](https://github.com/kometenstaub/obsidian-version-history-diff), MIT license. Read as a reference only. No code from it is used anywhere in this repository, so its attribution requirement never applied.
- Integrates with obsidian-git through that plugin's own (private) API; no provider-registration surface for third parties → own views first (SHIPPED: history panel + diff pane), optional upstream adapter PR second.
- Its rendering approach was adopted for our diff pane: git's unified diff, rendered line by line with intra-line highlighting. Until 0.6.2 that rendering went through diff2html; 0.6.2 replaced it with `src/git/unifiedDiff.ts`, `src/git/inlineDiff.ts` and `src/ui/diffDom.ts`, which build the nodes directly and left the plugin with no runtime dependencies. No code was ever copied from either project. What is borrowed is presentation: the `d2h-*` class names and the diff rules in styles.css are adapted from diff2html's MIT-licensed stylesheet and carry its notice, and keying those colours to Obsidian's theme variables is an idea this project saw in Version History Diff before doing its own. This repository is GPLv3; MIT material may be redistributed inside it as long as the MIT notice travels with it.

## Termux
- RUN_COMMAND intent: requires sender-manifest permission + allow-external-apps; results via PendingIntent (Java only) or `EXTRA_RESULT_DIRECTORY` files (≥ 0.115).
- [Termux:Widget](https://github.com/termux/termux-widget): `~/.shortcuts/tasks/*` run as background tasks on tap; hidden-dir and symlink escapes are blocked by the widget app; env is not fully loaded → runner uses full shebang `#!/data/data/com.termux/files/usr/bin/bash` and absolute paths.
- Storage: vault on shared storage requires `termux-setup-storage`; Android ≥ 11 sometimes needs permission re-grant (documented in installer output).
