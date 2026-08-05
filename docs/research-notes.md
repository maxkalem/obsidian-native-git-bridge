# Phase 1 research notes (2026-08-03)

## Obsidian plugin API (relevant surface)
- `Plugin.addCommand/addRibbonIcon/addStatusBarItem/addSettingTab`, `Notice`, `Modal`, `SuggestModal`, `Platform.isAndroidApp`, `Vault.adapter` (read/write/exists/mkdir/ remove/list): sufficient for the file protocol; adapter paths are vault-relative.
- `app.appId` (undocumented but long-stable) is a per-install identifier; used with a fallback UUID for scoping device-local storage keys. `localStorage` in Obsidian is per-app-install, not synced; meets the device-local requirement.
- Plugin data.json (`loadData/saveData`) may be synced with the vault → only non-device-specific UI prefs go there.

## Vinzent03/obsidian-git
- Mobile = isomorphic-git; README: "highly unstable", no SSH, memory limits.
- isomorphic-git does not honor skip-worktree/sparse-checkout index extensions (`sparse-checkout` is unimplemented there), so letting it touch a native sparse index risks staging mass deletions, which is the failure this project prevents. Hence the Android-side incompatibility warning when both plugins are enabled.

## kometenstaub/obsidian-version-history-diff
- MIT license (attribution required if code reused; we reuse none in Phase 2).
- Integrates with obsidian-git through that plugin's own (private) API; no provider-registration surface for third parties → own views first (SHIPPED: history panel + diff pane), optional upstream adapter PR second.
- Its rendering approach was adopted for our diff pane: git's unified diff → diff2html (`diffStyle: "char"`, line-by-line) → `sanitizeHTMLToDom`. No code was copied; the diff2html CSS in styles.css carries the MIT attribution and follows their Obsidian-variable adaptation.

## Termux
- RUN_COMMAND intent: requires sender-manifest permission + allow-external-apps; results via PendingIntent (Java only) or `EXTRA_RESULT_DIRECTORY` files (≥ 0.115).
- Termux:Widget: `~/.shortcuts/tasks/*` run as background tasks on tap; hidden-dir and symlink escapes are blocked by the widget app; env is not fully loaded → runner uses full shebang `#!/data/data/com.termux/files/usr/bin/bash` and absolute paths.
- Storage: vault on shared storage requires `termux-setup-storage`; Android ≥ 11 sometimes needs permission re-grant (documented in installer output).
