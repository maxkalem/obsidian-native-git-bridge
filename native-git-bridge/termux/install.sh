#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - Termux installer.
# Usage: bash install.sh [/absolute/path/to/vault-repo] [--with-ssh]
set -u

say()  { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

REPO_ARG="${1:-}"
WITH_SSH=false
for a in "$@"; do [ "$a" = "--with-ssh" ] && WITH_SSH=true; done

say "== Native Git Bridge installer =="

# 1. Verify we are inside Termux.
case "${PREFIX:-}" in
  */com.termux/*) : ;;
  *) fail "This installer must run inside Termux (PREFIX=${PREFIX:-unset})." ;;
esac

# 2. Install required packages.
say "-- Installing packages (git, jq, openssh)..."
pkg install -y git jq openssh >/dev/null || fail "pkg install failed"

# 3. Storage access.
if [ ! -d "$HOME/storage" ]; then
  say "-- Shared storage is not linked yet. Running termux-setup-storage."
  say "   Please ACCEPT the Android permission dialog, then re-run this installer."
  termux-setup-storage
  exit 0
fi

# 4. Repository path.
if [ -z "$REPO_ARG" ]; then
  printf 'Enter the absolute path of your vault repository (e.g. /storage/emulated/0/Documents/MyVault): '
  read -r REPO_ARG
fi
REPO_DIR="$REPO_ARG"
[ -d "$REPO_DIR" ] || fail "Directory does not exist: $REPO_DIR"

# 7+8. Verify repository; explain safe.directory if needed (repo on shared
# storage is usually owned by a different uid, which new git versions reject).
if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git -C "$REPO_DIR" rev-parse --is-inside-work-tree 2>&1 | grep -qi 'dubious ownership'; then
    say "-- Git rejected the repository because of 'dubious ownership' (normal for shared storage)."
    say "   The following EXPLICIT global change marks only this directory as safe:"
    say "     git config --global --add safe.directory \"$REPO_DIR\""
    printf 'Apply it now? [y/N] '
    read -r yn
    [ "$yn" = "y" ] || fail "Cannot continue without safe.directory. Nothing was changed."
    git config --global --add safe.directory "$REPO_DIR"
    git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Still not a git work tree."
  else
    fail "Not a git work tree: $REPO_DIR"
  fi
fi
say "-- Repository OK: $REPO_DIR"

# 9. Verify sparse checkout (informational; sparse is supported, not required).
SPARSE=$(git -C "$REPO_DIR" config --get core.sparseCheckout 2>/dev/null || true)
if [ "$SPARSE" = "true" ]; then
  say "-- Sparse checkout: ENABLED ($(git -C "$REPO_DIR" sparse-checkout list 2>/dev/null | wc -l | tr -d ' ') patterns)"
else
  say "-- Sparse checkout: not enabled (that's fine if you don't use it)."
fi

# 4b. Allow the companion app to trigger the runner (RUN_COMMAND intent).
# This only permits apps that ALSO hold the RUN_COMMAND permission, which the
# user grants per-app in Android settings.
TP="$HOME/.termux/termux.properties"
mkdir -p "$HOME/.termux"
if ! grep -Eq '^\s*allow-external-apps\s*=\s*true\s*$' "$TP" 2>/dev/null; then
  printf '\nallow-external-apps=true\n' >> "$TP"
  command -v termux-reload-settings >/dev/null 2>&1 && termux-reload-settings || true
  say "-- Enabled allow-external-apps in ~/.termux/termux.properties (needed for the companion app)."
else
  say "-- allow-external-apps already enabled."
fi

# 4c. Authentication check - adapts to what you already use (PAT over HTTPS,
# credential helper, or SSH). Credentials never leave Termux.
REMOTE_URL="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
case "$REMOTE_URL" in
  https://*@*)
    say "-- HTTPS remote with credentials embedded in the URL detected."
    say "   This works, but the token then appears in .git/config."
    printf 'Move the token into the git credential store (~/.git-credentials, chmod 600) and clean the URL? [y/N] '
    read -r yn
    if [ "$yn" = "y" ]; then
      CREDS="${REMOTE_URL#https://}"; CREDS="${CREDS%%@*}"
      HOSTPATH="${REMOTE_URL#https://*@}"
      HOSTONLY="${HOSTPATH%%/*}"
      printf 'https://%s@%s\n' "$CREDS" "$HOSTONLY" >> "$HOME/.git-credentials"
      chmod 600 "$HOME/.git-credentials"
      git -C "$REPO_DIR" config --local credential.helper store
      git -C "$REPO_DIR" remote set-url origin "https://$HOSTPATH"
      say "-- Token moved to credential store; remote URL cleaned."
    else
      say "-- Left as is (the bridge redacts credentials from all logs and results)."
    fi
    ;;
  https://*)
    HELPER="$(git -C "$REPO_DIR" config --get credential.helper 2>/dev/null || git config --global --get credential.helper 2>/dev/null || true)"
    if [ -z "$HELPER" ]; then
      say "-- HTTPS remote without a credential helper: pushes from the bridge would fail"
      say "   (the runner never prompts interactively)."
      printf 'Enable the git credential store and cache your PAT on the next pull? [y/N] '
      read -r yn
      if [ "$yn" = "y" ]; then
        git -C "$REPO_DIR" config --local credential.helper store
        say "-- credential.helper=store set (repo-local). Run 'git pull' once in Termux and"
        say "   enter your PAT as the password; it will be reused non-interactively afterwards."
      fi
    else
      say "-- HTTPS remote with credential helper '$HELPER': OK, your PAT will be used."
    fi
    ;;
  git@*|ssh://*)
    if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
      mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
      ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519" -C "native-git-bridge@termux" >/dev/null
      say "-- Generated SSH key ~/.ssh/id_ed25519 (add the public key to your repo):"
      cat "$HOME/.ssh/id_ed25519.pub"
    else
      say "-- SSH remote with existing key: OK."
    fi
    ;;
  "")
    say "-- WARNING: no 'origin' remote configured; pull/push will fail until you add one."
    ;;
esac

# Non-interactive auth self-test (fails fast instead of hanging).
if [ -n "$REMOTE_URL" ]; then
  if GIT_TERMINAL_PROMPT=0 timeout 30 git -C "$REPO_DIR" ls-remote --heads origin >/dev/null 2>&1; then
    say "-- Remote authentication check PASSED (non-interactive ls-remote)."
  else
    say "-- WARNING: non-interactive access to the remote FAILED. The bridge will not be able"
    say "   to fetch/push until credentials work without a prompt (expired PAT? missing helper?)."
  fi
fi

# 5. Install runner + config + token.
CONF_DIR="$HOME/.config/native-git-bridge"
mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_SRC="$SCRIPT_DIR/native-git-bridge-runner.sh"
[ -f "$RUNNER_SRC" ] || fail "runner script not found next to installer: $RUNNER_SRC"
cp "$RUNNER_SRC" "$CONF_DIR/runner.sh"
chmod 700 "$CONF_DIR/runner.sh"

TOKEN=""
if [ -f "$CONF_DIR/config" ]; then
  # shellcheck disable=SC1091
  . "$CONF_DIR/config" 2>/dev/null || true
  TOKEN="${NGB_TOKEN:-}"
fi
if [ -z "$TOKEN" ]; then
  TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
RUNTIME_DIR="$REPO_DIR/.obsidian/plugins/native-git-bridge/runtime"
cat > "$CONF_DIR/config" <<CONF
NGB_REPO_DIR="$REPO_DIR"
NGB_TOKEN="$TOKEN"
NGB_RUNTIME_DIR="$RUNTIME_DIR"
CONF
chmod 600 "$CONF_DIR/config"
say "-- Runner installed to $CONF_DIR/runner.sh (config chmod 600)."

# Widget shortcut (background task).
mkdir -p "$HOME/.shortcuts/tasks"
chmod 700 "$HOME/.shortcuts" "$HOME/.shortcuts/tasks"
cat > "$HOME/.shortcuts/tasks/GitBridge" <<'WIDGET'
#!/data/data/com.termux/files/usr/bin/bash
exec "$HOME/.config/native-git-bridge/runner.sh"
WIDGET
chmod 700 "$HOME/.shortcuts/tasks/GitBridge"
say "-- Widget task created: ~/.shortcuts/tasks/GitBridge"

# 6. Exclude the runtime dir locally (never synced).
GIT_DIR_PATH="$(git -C "$REPO_DIR" rev-parse --git-dir)"
case "$GIT_DIR_PATH" in
  /*) : ;;
  *) GIT_DIR_PATH="$REPO_DIR/$GIT_DIR_PATH" ;;
esac
EXCLUDE_FILE="$GIT_DIR_PATH/info/exclude"
mkdir -p "$(dirname "$EXCLUDE_FILE")"
EXCLUDE_LINE=".obsidian/plugins/native-git-bridge/runtime/"
grep -qxF "$EXCLUDE_LINE" "$EXCLUDE_FILE" 2>/dev/null || printf '%s\n' "$EXCLUDE_LINE" >> "$EXCLUDE_FILE"
say "-- Runtime dir excluded via .git/info/exclude (local only)."

# 10. Test round trip: write a ping request and run the runner once.
mkdir -p "$RUNTIME_DIR/requests"
TEST_ID="r-$(date -u +%Y%m%dT%H%M%SZ)-install"
cat > "$RUNTIME_DIR/requests/$TEST_ID.json" <<REQ
{"protocolVersion":1,"id":"$TEST_ID","token":"$TOKEN","action":"ping","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","timeoutSeconds":30,"args":{}}
REQ
"$CONF_DIR/runner.sh" || fail "runner test run failed"
if jq -e '.ok == true' "$RUNTIME_DIR/results/$TEST_ID.json" >/dev/null 2>&1; then
  say "-- Self-test PASSED (ping round trip)."
  rm -f "$RUNTIME_DIR/results/$TEST_ID.json"
else
  fail "Self-test failed; see $RUNTIME_DIR/runner.log"
fi

# 11. Auto-pairing: the plugin imports this file on next start and deletes it,
# so the token never has to be copied by hand. (It transits vault storage once;
# same trust boundary as the request files themselves.)
cat > "$RUNTIME_DIR/pairing.json" <<PAIR
{"token":"$TOKEN","repoPath":"$REPO_DIR","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
PAIR
say "-- Pairing file written; the Obsidian plugin will import the token automatically."

# 12. Next steps.
say ""
say "== Done. What is left (outside Termux) =="
say "1. Open Obsidian -> Settings -> Native Git Bridge -> enable on this device."
say "   The pairing token is imported automatically on plugin start."
say "2. If you use the companion app: set integration type to 'Companion app intent'"
say "   and grant it the 'Run commands in Termux environment' permission in Android settings."
say "   Without the companion: pin the 'GitBridge' Termux:Widget task instead."
say "3. Authentication: whatever you already use in Termux (PAT via credential helper,"
say "   token in URL, or SSH key) keeps working - see the auth check result above."
say ""
say "Manual pairing token (only needed if auto-import fails): $TOKEN"
say "Note: nothing runs in the background; the runner executes only when triggered."
