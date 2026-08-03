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
say "-- Installing packages (git, jq)..."
pkg install -y git jq >/dev/null || fail "pkg install failed"
if $WITH_SSH; then
  say "-- Installing openssh (for SSH remotes)..."
  pkg install -y openssh >/dev/null || fail "openssh install failed"
fi

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

# 11. Next steps.
say ""
say "== Done. Next steps =="
say "1. Add a Termux:Widget to your home screen (install the Termux:Widget app if needed)"
say "   and pin the 'GitBridge' task, or long-press the Termux:Widget icon for shortcuts."
say "2. In Obsidian -> Settings -> Native Git Bridge:"
say "   - enable the plugin on this device,"
say "   - enable Termux integration,"
say "   - paste this pairing token:"
say ""
say "   $TOKEN"
say ""
say "3. Run 'Native Git: Run diagnostics' in Obsidian, then tap the GitBridge widget."
say "Note: nothing runs in the background; the runner only executes when you tap the widget."
