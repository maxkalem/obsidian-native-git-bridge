# Threat model — Obsidian Native Git Bridge

## Assets
- Vault contents (notes, possibly private directories excluded via sparse checkout).
- Git credentials (SSH keys / credential helper state) — live **only** in Termux
  private storage; never touched, read, or transported by the plugin.
- Git history integrity (especially: protected sparse paths must never be committed
  as deletions).
- Device-local auth token pairing the plugin with the runner.

## Trust boundaries
1. **Obsidian WebView ↔ vault directory** (app-private or shared storage).
2. **Vault directory ↔ Termux** (Termux accesses the vault via shared storage after
   `termux-setup-storage`).
3. **Optional companion app ↔ Termux** (RUN_COMMAND permission boundary, enforced by
   Android + `allow-external-apps`).

## Adversaries and scenarios

| # | Threat | Mitigation |
|---|--------|------------|
| T1 | Malicious app with all-files access writes a forged request file | Runner requires the device-local token (stored `0600` in `~/.config/native-git-bridge/`, Termux-private, set once at pairing); requests without it are rejected and logged. Residual risk: an app with all-files access could *read* a pending request file and replay its token. Consequence is bounded: the runner only executes allow-listed git actions against the single configured repo — never arbitrary commands. Documented residual risk. |
| T2 | Request smuggles arbitrary command / path traversal | Action allow-list; every path argument validated (relative, no `..`, no leading `/`, no control chars); git invoked with argv arrays, never `eval`/string interpolation; refs and hashes validated against strict regexes. |
| T3 | Result forgery (fake "success") | Same shared-storage boundary as T1; result files are matched by request id and parsed defensively. Residual risk accepted and documented — an attacker at this level already has the vault files themselves. |
| T4 | Credential leakage | No tokens in plugin settings; native git uses Termux-side SSH/credential helper; runner strips credentials from remote URLs before logging (`sed` of `://user:pass@`); plugin never logs the auth token. |
| T5 | Destructive git operations triggered accidentally | Mutating actions require the operation lock; restore/discard/abort require explicit typed confirmation modals; force push not implemented; sparse-safety check blocks commit/push when protected paths appear changed; no automatic destructive "repair". |
| T6 | Sparse-checkout data loss (excluded dirs committed as deletions) | Mandatory pre-commit/pre-push check: `git status --porcelain=v1 -- <protected…>` and `git diff --cached --name-status -- <protected…>` must both be empty, else the operation is blocked with an explicit warning and nothing is committed or pushed. |
| T7 | Plugin directory synced through Git carries another device's config | All device-scoped settings (enable flag, paths, token, transport, automation) live in `localStorage` scoped by vault identity — never in `data.json`. Runtime dir is in `.git/info/exclude`. |
| T8 | Stale/orphaned operations after Obsidian is killed | Operation marker persisted device-locally; on startup the plugin reconciles marker ↔ results dir, expires stale locks, and cleans result files older than 24 h. Runner also cleans old files. |
| T9 | isomorphic-git (obsidian-git mobile) corrupting the native index | On Android the plugin detects an enabled `obsidian-git` plugin and shows a prominent incompatibility warning; it never disables it without explicit user confirmation. |

## Non-goals
- Defending against a compromised Termux installation or a rooted-device attacker.
- Protecting vault confidentiality from apps holding `MANAGE_EXTERNAL_STORAGE`.
