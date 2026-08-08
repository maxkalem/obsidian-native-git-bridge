#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - Termux installer.
# Usage: bash install.sh [/absolute/path/to/vault-repo] [--with-ssh]
set -u

# Output width. Termux on a phone is far narrower than a desktop terminal (the
# default font gives roughly 60 columns in portrait), so text hard-wrapped in
# the source at ~78 columns wrapped a SECOND time at the terminal edge, in the
# middle of words, and the result was unreadable. Nothing here is pre-wrapped
# any more: every message is one logical line and `say` folds it at the width
# the terminal actually reports.
#
# `stty size` is asked of /dev/tty, not of stdin: the installer is normally run
# through `curl … | bash`, where stdin is the pipe and has no size at all.
term_cols() {
  local c=""
  if [ -r /dev/tty ]; then
    # stderr is redirected BEFORE stdin on purpose: when /dev/tty exists but
    # cannot be opened (no controlling terminal), the failing redirection is
    # reported by the shell, and it must land in /dev/null like everything else.
    c="$(stty size 2>/dev/null < /dev/tty | cut -d' ' -f2 || true)"
  fi
  [ -n "$c" ] || c="${COLUMNS:-}"
  case "$c" in ""|*[!0-9]*) c=72 ;; esac
  # Below ~32 the hanging indent eats the line; above ~100 long prose becomes
  # hard to follow. Both bounds only matter for unusual terminals.
  [ "$c" -lt 32 ] && c=32
  [ "$c" -gt 100 ] && c=100
  printf '%s' "$c"
}
NGB_COLS="$(term_cols)"

# Wrap on spaces, never inside a word. A word longer than the line (a path, a
# URL, a token) is printed whole and allowed to overflow: breaking it would
# make it impossible to select and copy, which is the one thing those lines
# exist for. Continuations get a hanging indent so a wrapped bullet or numbered
# step still reads as one item.
say() {
  local text="$*"
  if [ -z "$text" ]; then printf '\n'; return 0; fi
  # `indent` prefixes the CONTINUATION lines (a hanging indent). `lead` is the
  # message's own leading whitespace, which word splitting is about to strip:
  # a line written as "   detail…" has to keep its indent on the FIRST line too,
  # or the sub-point ends up further left than the point it belongs to.
  local indent="" lead=""
  case "$text" in
    "-- "*|"== "*) indent="   " ;;
    "ERROR: "*)    indent="   " ;;
    [0-9].\ *)     indent="   " ;;
    "   "*)        indent="   "; lead="   " ;;
  esac
  # Word splitting below must not glob: several messages contain '*' or '?'.
  local had_glob=off
  case "$-" in *f*) had_glob=on ;; esac
  set -f
  local line="" word=""
  for word in $text; do
    if [ -z "$line" ]; then
      line="$lead$word"
    elif [ "$(( ${#line} + 1 + ${#word} ))" -le "$NGB_COLS" ]; then
      line="$line $word"
    else
      printf '%s\n' "$line"
      line="$indent$word"
    fi
  done
  printf '%s\n' "$line"
  [ "$had_glob" = on ] || set +f
}

# Verbatim line: a command the user is meant to copy, printed exactly as
# written. Reflowing those would change what gets pasted.
sayr() { printf '%s\n' "$*"; }

# Errors are wrapped too: a failure message is the one line the user has to be
# able to read, and it is usually the longest.
fail() { say "ERROR: $*" >&2; exit 1; }

# Prompts must work when piped through `curl | bash` (stdin is the pipe), so we
# talk to /dev/tty. With no terminal at all (e.g. re-run non-interactively) we
# assume "yes" and log every decision instead of hanging.
confirm() { # $1 question -> 0=yes
  if [ "${NGB_ASSUME_YES:-}" = "1" ]; then say "   auto-yes: $1"; return 0; fi
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '%s [y/N] ' "$1" > /dev/tty
    local yn=""; IFS= read -r yn < /dev/tty || yn=""
    [ "$yn" = "y" ] || [ "$yn" = "Y" ]
  else
    say "   non-interactive: assuming yes: $1"; return 0
  fi
}

ask_line() { # $1 prompt -> stdout answer
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '%s' "$1" > /dev/tty
    local a=""; IFS= read -r a < /dev/tty || a=""
    printf '%s' "$a"
  else
    printf ''
  fi
}

# Find Obsidian vaults that are git repositories on shared storage.
detect_vaults() {
  local roots="/storage/emulated/0 $HOME/storage/shared /sdcard"
  local r d v
  { for r in $roots; do
      [ -d "$r" ] || continue
      find "$r/" -maxdepth 4 -type d -name .obsidian 2>/dev/null
    done; } | while IFS= read -r d; do
      v="$(dirname "$d")"
      [ -d "$v/.git" ] && realpath "$v" 2>/dev/null
    done | sort -u
}

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

# 3. Storage access: request it and WAIT for the user to accept the dialog,
# so the installer continues by itself instead of demanding a re-run.
if [ ! -d "$HOME/storage" ]; then
  say "-- Shared storage is not linked yet. Requesting access (termux-setup-storage)."
  say "   Please ACCEPT the Android permission dialog that appears now..."
  termux-setup-storage || true
  waited=0
  while [ ! -d "$HOME/storage" ] && [ "$waited" -lt 120 ]; do
    sleep 2
    waited=$((waited + 2))
  done
  if [ -d "$HOME/storage" ]; then
    say "-- Storage access granted; continuing."
  else
    fail "Storage access was not granted within 2 minutes. Accept the dialog and re-run the same command."
  fi
fi

# 4. Repository path: use the argument, otherwise auto-detect vaults
# (folders on shared storage containing both .obsidian and .git).
if [ -z "$REPO_ARG" ]; then
  say "-- No path given; scanning shared storage for Obsidian vaults with a git repo..."
  VAULTS="$(detect_vaults)"
  COUNT="$(printf '%s\n' "$VAULTS" | grep -c . || true)"
  if [ "$COUNT" -eq 1 ]; then
    REPO_ARG="$VAULTS"
    say "-- Found exactly one: $REPO_ARG"
  elif [ "$COUNT" -gt 1 ]; then
    say "-- Found several vaults:"
    printf '%s\n' "$VAULTS" | nl -w2 -s'. '
    PICK="$(ask_line 'Enter the number of the vault to use: ')"
    REPO_ARG="$(printf '%s\n' "$VAULTS" | sed -n "${PICK}p")"
    [ -n "$REPO_ARG" ] || fail "Invalid selection."
  else
    say "-- No vault with a .git repository was found on shared storage. Either pass the path explicitly:"
    sayr "     bash install.sh /storage/emulated/0/<YourVault>"
    say "   or, if the vault has no repository yet, let the plugin make one: open the vault in Obsidian and use Settings -> Native Git Bridge -> Set up repository (it pairs the vault first, then creates or clones the repository without leaving the app)."
    fail "No vault with a .git repository found on shared storage."
  fi
fi
REPO_DIR="$REPO_ARG"
[ -d "$REPO_DIR" ] || fail "Directory does not exist: $REPO_DIR"

# 7+8. Verify repository; explain safe.directory if needed (repo on shared
# storage is usually owned by a different uid, which new git versions reject).
if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git -C "$REPO_DIR" rev-parse --is-inside-work-tree 2>&1 | grep -qi 'dubious ownership'; then
    say "-- Git rejected the repository because of 'dubious ownership' (normal for shared storage). The following EXPLICIT global change marks only this directory as safe:"
    sayr "     git config --global --add safe.directory \"$REPO_DIR\""
    confirm "Apply it now?" || fail "Cannot continue without safe.directory. Nothing was changed."
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

# 5. Install runner + profile + token.
# One profile per vault: profiles/<id>.conf, mode 600, its own token. Running
# this installer for a second vault ADDS a profile; it never overwrites the
# first one (which used to leave that vault silently unanswered).
CONF_DIR="$HOME/.config/native-git-bridge"
PROFILES_DIR="$CONF_DIR/profiles"
mkdir -p "$PROFILES_DIR"
chmod 700 "$CONF_DIR" "$PROFILES_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_SRC="$SCRIPT_DIR/native-git-bridge-runner.sh"
[ -f "$RUNNER_SRC" ] || fail "runner script not found next to installer: $RUNNER_SRC"
cp "$RUNNER_SRC" "$CONF_DIR/runner.sh"
chmod 700 "$CONF_DIR/runner.sh"

# Migrate an existing single-repo config before looking for a profile: the
# runner does it on its first run, so one implementation covers both paths.
# NGB_SCAN_ROOTS="" keeps this run from scanning shared storage - it is here to
# migrate, and a scan of a full phone would look like a hang.
NGB_SCAN_ROOTS="" "$CONF_DIR/runner.sh" >/dev/null 2>&1 || true

profile_value() { # $1 file, $2 key
  sed -n "s/^$2=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" "$1" | head -1
}

# Reuse the profile of THIS repository if it already has one (re-running the
# installer must not re-pair a working vault), otherwise create a new one.
PROFILE_FILE=""
REPO_REAL="$(realpath "$REPO_DIR" 2>/dev/null || printf '%s' "$REPO_DIR")"
for f in "$PROFILES_DIR"/*.conf; do
  [ -f "$f" ] || continue
  p="$(profile_value "$f" NGB_REPO_DIR)"
  [ -n "$p" ] || continue
  if [ "$(realpath "$p" 2>/dev/null || printf '%s' "$p")" = "$REPO_REAL" ]; then
    PROFILE_FILE="$f"; break
  fi
done

RUNTIME_DIR="$REPO_DIR/.obsidian/plugins/native-git-bridge/runtime"
if [ -n "$PROFILE_FILE" ]; then
  PROFILE_ID="$(profile_value "$PROFILE_FILE" NGB_PROFILE_ID)"
  TOKEN="$(profile_value "$PROFILE_FILE" NGB_TOKEN)"
  say "-- Existing profile for this vault reused: $PROFILE_ID (token kept)."
else
  PROFILE_ID="p-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  PROFILE_FILE="$PROFILES_DIR/$PROFILE_ID.conf"
  say "-- New profile for this vault: $PROFILE_ID (its own token)."
fi
cat > "$PROFILE_FILE" <<CONF
NGB_PROFILE_FORMAT=1
NGB_PROFILE_ID="$PROFILE_ID"
NGB_REPO_DIR="$REPO_DIR"
NGB_RUNTIME_DIR="$RUNTIME_DIR"
NGB_TOKEN="$TOKEN"
CONF
chmod 600 "$PROFILE_FILE"
say "-- Runner installed to $CONF_DIR/runner.sh (profile chmod 600)."

# Every profile on the device, numbered, with the one just written marked.
#
# A bare count answers "how many" but not "which of them are still real", and
# the failure this exists to catch is accumulation: a vault that was moved or
# deleted leaves a profile behind, and the only visible symptom is that the
# number of profiles quietly exceeds the number of repositories on the phone.
# Naming each directory, and saying which no longer holds a repository, turns
# that into something the reader can act on. Nothing is deleted here: a profile
# carries the vault's token, and removing one is the user's decision.
list_profiles() {
  total=0
  for f in "$PROFILES_DIR"/*.conf; do
    [ -f "$f" ] || continue
    total=$(( total + 1 ))
  done
  [ "$total" -gt 0 ] || return 0
  n=0
  mine=0
  for f in "$PROFILES_DIR"/*.conf; do
    [ -f "$f" ] || continue
    n=$(( n + 1 ))
    [ "$f" = "$PROFILE_FILE" ] && mine="$n"
  done
  say ""
  say "== Profiles on this device: $total (this vault is #$mine) =="
  n=0
  for f in "$PROFILES_DIR"/*.conf; do
    [ -f "$f" ] || continue
    n=$(( n + 1 ))
    pid="$(profile_value "$f" NGB_PROFILE_ID)"
    dir="$(profile_value "$f" NGB_REPO_DIR)"
    mark=""
    [ "$f" = "$PROFILE_FILE" ] && mark="  <- this vault"
    state=""
    if [ ! -d "$dir" ]; then
      state="  MISSING (directory is gone)"
    elif ! git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
      state="  NOT A REPOSITORY (no git work tree there)"
    fi
    sayr "  $n. ${pid:-<unreadable>}  ${dir:-<unreadable>}$state$mark"
  done
  say "One runner drains all of them. A profile you no longer want is one file:"
  sayr "  rm $PROFILES_DIR/<profile-id>.conf"
  say ""
}
list_profiles

# 5b. Nested vaults: a vault opened INSIDE another vault's repository is its own
# repository, and the outer one would otherwise offer the inner working tree for
# staging. The exclusion goes into the OUTER repository's .git/info/exclude:
# device-local (only this device has both vaults), never synced, and it never
# touches a tracked file such as .gitignore.
OUTER=""
probe="$(dirname "$REPO_DIR")"
while [ "$probe" != "/" ] && [ -n "$probe" ]; do
  if [ -d "$probe/.git" ]; then OUTER="$probe"; break; fi
  probe="$(dirname "$probe")"
done
if [ -n "$OUTER" ]; then
  REL="${REPO_DIR#"$OUTER"/}"
  OUTER_EXCLUDE="$OUTER/.git/info/exclude"
  mkdir -p "$(dirname "$OUTER_EXCLUDE")"
  if [ -s "$OUTER_EXCLUDE" ] && [ "$(tail -c 1 "$OUTER_EXCLUDE" | od -An -tx1 | tr -d ' \n')" != "0a" ]; then
    printf '\n' >> "$OUTER_EXCLUDE"
  fi
  if grep -qxF "/$REL/" "$OUTER_EXCLUDE" 2>/dev/null; then
    say "-- This vault sits inside the repository $OUTER; it is already excluded there."
  else
    printf '/%s\n' "$REL" >> "$OUTER_EXCLUDE"
    say "-- This vault sits INSIDE another repository: $OUTER"
    say "   Added '/$REL/' to $OUTER_EXCLUDE (local only, nothing tracked was changed), so the outer repository never records this vault's files."
  fi
fi

# 5c. Authentication - adapts to what you already use (PAT over HTTPS,
# credential helper, or SSH) and is configured PER REPOSITORY, so two vaults can
# use two different accounts. Credentials never leave Termux and never reach
# the plugin, a result file or any log.
CREDS_DIR="$CONF_DIR/creds"
PROFILE_CREDS="$CREDS_DIR/$PROFILE_ID"
REMOTE_URL="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
case "$REMOTE_URL" in
  https://*@*)
    say "-- HTTPS remote with credentials embedded in the URL detected."
    say "   This works, but the token then appears in .git/config."
    if confirm "Move the token into this repository's own credential file (chmod 600) and clean the URL?"; then
      CREDS="${REMOTE_URL#https://}"; CREDS="${CREDS%%@*}"
      HOSTPATH="${REMOTE_URL#https://*@}"
      HOSTONLY="${HOSTPATH%%/*}"
      mkdir -p "$CREDS_DIR"; chmod 700 "$CREDS_DIR"
      printf 'https://%s@%s\n' "$CREDS" "$HOSTONLY" >> "$PROFILE_CREDS"
      chmod 600 "$PROFILE_CREDS"
      git -C "$REPO_DIR" config --local credential.helper "store --file=$PROFILE_CREDS"
      git -C "$REPO_DIR" remote set-url origin "https://$HOSTPATH"
      say "-- Token moved to $PROFILE_CREDS (this repository only); remote URL cleaned."
    else
      say "-- Left as is (the bridge redacts credentials from all logs and results)."
    fi
    ;;
  https://*)
    HELPER="$(git -C "$REPO_DIR" config --local --get credential.helper 2>/dev/null || true)"
    if [ -z "$HELPER" ]; then
      GLOBAL_HELPER="$(git config --global --get credential.helper 2>/dev/null || true)"
      say "-- HTTPS remote without a repository-local credential helper: pushes from the bridge would fail, or would silently use another vault's account (the runner never prompts)."
      if confirm "Give this repository its own credential file ($PROFILE_CREDS)?"; then
        mkdir -p "$CREDS_DIR"; chmod 700 "$CREDS_DIR"
        : >> "$PROFILE_CREDS"; chmod 600 "$PROFILE_CREDS"
        git -C "$REPO_DIR" config --local credential.helper "store --file=$PROFILE_CREDS"
        say "-- credential.helper set for this repository only. Run this once in Termux and enter your PAT as the password; it is reused non-interactively after that:"
        sayr "     git -C \"$REPO_DIR\" pull"
      elif [ -n "$GLOBAL_HELPER" ]; then
        say "-- Falling back to the global credential helper '$GLOBAL_HELPER'."
      fi
    else
      say "-- HTTPS remote with a repository-local credential helper: OK, this vault's PAT will be used."
    fi
    ;;
  git@*|ssh://*)
    SSH_KEY="$HOME/.ssh/id_ed25519"
    LOCAL_SSH="$(git -C "$REPO_DIR" config --local --get core.sshCommand 2>/dev/null || true)"
    if [ -n "$LOCAL_SSH" ]; then
      say "-- SSH remote with a repository-local key configuration: OK."
    elif [ ! -f "$SSH_KEY" ]; then
      mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
      ssh-keygen -t ed25519 -N "" -f "$SSH_KEY" -C "native-git-bridge@termux" >/dev/null
      say "-- Generated SSH key $SSH_KEY (add the public key to your repository):"
      cat "$SSH_KEY.pub"
    else
      say "-- SSH remote with an existing key: OK."
      if [ "$OTHER_COUNT" -gt 0 ] || [ "$WITH_SSH" = true ]; then
        if confirm "Use a SEPARATE ssh key for this vault (needed for a different account)?"; then
          NEWKEY="$HOME/.ssh/ngb-$PROFILE_ID"
          [ -f "$NEWKEY" ] || ssh-keygen -t ed25519 -N "" -f "$NEWKEY" -C "native-git-bridge@termux ($PROFILE_ID)" >/dev/null
          git -C "$REPO_DIR" config --local core.sshCommand "ssh -i $NEWKEY -o IdentitiesOnly=yes"
          say "-- This repository now uses $NEWKEY. Add the public key to that account:"
          cat "$NEWKEY.pub"
        fi
      fi
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
    say "-- WARNING: non-interactive access to the remote FAILED. The bridge will not be able to fetch or push until credentials work without a prompt (expired PAT? missing helper?)."
  fi
fi

# 6. Exclude the runtime dir locally (never synced).
GIT_DIR_PATH="$(git -C "$REPO_DIR" rev-parse --git-dir)"
case "$GIT_DIR_PATH" in
  /*) : ;;
  *) GIT_DIR_PATH="$REPO_DIR/$GIT_DIR_PATH" ;;
esac
EXCLUDE_FILE="$GIT_DIR_PATH/info/exclude"
mkdir -p "$(dirname "$EXCLUDE_FILE")"
EXCLUDE_LINE=".obsidian/plugins/native-git-bridge/runtime/"
# Append only after a newline: a file whose last line has none would otherwise
# swallow our entry into it (and corrupt that line too).
if [ -s "$EXCLUDE_FILE" ] && [ "$(tail -c 1 "$EXCLUDE_FILE" | od -An -tx1 | tr -d ' \n')" != "0a" ]; then
  printf '\n' >> "$EXCLUDE_FILE"
fi
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
{"token":"$TOKEN","repoPath":"$REPO_DIR","profileId":"$PROFILE_ID","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
PAIR
say "-- Pairing file written; the Obsidian plugin will import the token automatically."

# 12. Next steps.
say ""
say "== Done. What is left (outside Termux) =="
say "1. Open Obsidian -> Settings -> Native Git Bridge -> enable on this device. The pairing token is imported automatically on plugin start."
say "2. In the Git Bridge Companion app: grant the 'Run commands in Termux environment' permission (step 2 there) - all three checkmarks must be green."
say "3. Authentication: whatever you already use in Termux (PAT via credential helper, token in URL, or SSH key) keeps working - see the auth check result above."
say ""
say "Manual pairing token (only needed if auto-import fails):"
sayr "$TOKEN"
say "Profile for this vault: $PROFILE_ID"
sayr "$PROFILE_FILE"
say "Note: nothing runs in the background; the runner executes only when triggered."
say "Recovery: you can always run it by hand with"
sayr "~/.config/native-git-bridge/runner.sh"
say "Another vault? Run the same command with its path; each vault gets its own profile and token, and one runner drains them all."
