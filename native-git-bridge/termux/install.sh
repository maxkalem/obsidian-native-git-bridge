#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - Termux installer.
# Usage: bash install.sh [/absolute/path/to/repository] [--vault /absolute/path/to/vault] [--with-ssh]
#
# One path when the vault IS the repository, which is the usual arrangement.
# Two when they differ: the repository is the git work tree, the vault is the
# folder Obsidian opens (it holds .obsidian and this plugin's runtime folder),
# and one has to contain the other — a documentation vault inside a code
# repository, or one folder of a larger vault kept as a repository of its own.
# The plugin can also say where the repository is through a setup-intent file
# in its runtime folder (see intent_repo_above); a folder that is not a
# repository yet is then paired for the plugin to create or clone into.
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

# Colors, only when stdout is a terminal (a piped run — the e2e suite, a log —
# gets plain text). The rule, user-given (2026-08-26) and refined the same
# day from the first device screenshot: color the STATUS WORD, not the line —
# whole-line green made entire sections read as one green wall. Positive
# words (OK, PASSED, enabled…) are wrapped in $NGB_GREEN…$NGB_OFF inline at
# the call site; profile ids get $NGB_YELLOW and the pairing token $NGB_BOLD
# (the user's picks after two device rounds: yellow for ids, cyan for the
# runner's version line, bold for the token — findable without shouting).
# Whole-line red stays for warnings and errors ($NGB_TINT via saybad): a
# failure is the one case where the entire line is the point.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  NGB_GREEN="$(printf '\033[32m')"
  NGB_RED="$(printf '\033[31m')"
  NGB_YELLOW="$(printf '\033[33m')"
  NGB_BOLD="$(printf '\033[1m')"
  NGB_OFF="$(printf '\033[0m')"
else
  NGB_GREEN=""; NGB_RED=""; NGB_YELLOW=""; NGB_BOLD=""; NGB_OFF=""
fi
NGB_TINT=""

# Visible length of a string: the color codes this script injects are
# invisible on screen but count in ${#…}, which would wrap colored lines
# early. Only this script's own five codes can appear in a message, so
# stripping exactly those is exact.
vlen() {
  local s="$*"
  if [ -n "$NGB_OFF" ]; then
    s="${s//"$NGB_GREEN"/}"; s="${s//"$NGB_RED"/}"
    s="${s//"$NGB_YELLOW"/}"; s="${s//"$NGB_BOLD"/}"; s="${s//"$NGB_OFF"/}"
  fi
  printf '%s' "${#s}"
}

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
    elif [ "$(( $(vlen "$line") + 1 + $(vlen "$word") ))" -le "$NGB_COLS" ]; then
      line="$line $word"
    else
      printf '%s%s%s\n' "$NGB_TINT" "$line" "$NGB_OFF"
      line="$indent$word"
    fi
  done
  printf '%s%s%s\n' "$NGB_TINT" "$line" "$NGB_OFF"
  [ "$had_glob" = on ] || set +f
}

# Whole-line red for warnings and errors (see the color rule above). The
# green counterpart was removed the day it was added: whole-line green made
# sections read as a green wall; positive words are colored inline instead.
saybad() { NGB_TINT="$NGB_RED"; say "$@"; NGB_TINT=""; }

# Section break: a blank line and a 20-dash rule before the title. The phone
# screen has no scrollback landmarks, so one visual break per stage is what
# makes a long install skimmable (user request, 2026-08-26).
NGB_SEP="--------------------"
section() { say ""; sayr "$NGB_SEP"; say "$*"; }

# Verbatim line: a command the user is meant to copy, printed exactly as
# written. Reflowing those would change what gets pasted.
sayr() { printf '%s\n' "$*"; }

# Errors are wrapped too: a failure message is the one line the user has to be
# able to read, and it is usually the longest.
fail() { saybad "ERROR: $*" >&2; exit 1; }

# apt/pkg output, reshaped for a phone screen (user request, 2026-08-26).
# What changes and why:
# - pkg's mirror probes ("[*] (weight) url: ok") put the verdict LAST, where a
#   narrow screen wraps it out of sight; the verdict now leads, colored, then
#   the URL. The "[*]" is pkg's list bullet and the number its rotation
#   weight — neither helps a person, both are dropped.
# - "Get:" lines lead with the size, then the package and version.
# - Index/dpkg boilerplate (Reading package lists, Unpacking, "The following
#   packages…" lists) is dropped: it names no decision and fills the screen.
# - apt's whole-system summary ("0 upgraded … 77 not upgraded") reads as
#   "nothing was installed" when it is really counting packages this installer
#   deliberately leaves alone; it is replaced with the honest count.
# - Warnings and errors pass through, in red. Everything unrecognized passes
#   through untouched, so a real failure is never filtered away.
apt_filter() {
  awk -v G="$NGB_GREEN" -v R="$NGB_RED" -v N="$NGB_OFF" '
    { sub(/\r$/, "") }
    /\([0-9]+\) https?:\/\/.*: (ok|bad)$/ {
      url = substr($0, index($0, ") http") + 2)
      if (url ~ /: ok$/) { sub(/: ok$/, "", url); printf "%sOK%s  %s\n", G, N, url }
      else { sub(/: bad$/, "", url); printf "%sBAD%s %s\n", R, N, url }
      next
    }
    /^Get:[0-9]+ / {
      line = $0; size = ""
      if (line ~ /\[[^]]*\]$/) {
        q = length(line)
        while (substr(line, q, 1) != "[") q--
        size = substr(line, q + 1, length(line) - q - 1)
        line = substr(line, 1, q - 1); sub(/ +$/, "", line)
      }
      n = split(line, f, " ")
      what = (n >= 7) ? f[5] " " f[7] : f[n]
      printf "GET %s  %s\n", size, what
      next
    }
    /^The following packages have unmet dependencies/ { printf "%s%s%s\n", R, $0, N; inlist = 2; next }
    inlist == 2 && /^ / { printf "%s%s%s\n", R, $0, N; next }
    /^The following/ { inlist = 1; next }
    inlist == 1 && /^ / { next }
    { inlist = 0 }
    /^(Hit:[0-9]+|Reading package lists|Building dependency tree|Reading state information|Listing\.)/ { next }
    /^[0-9]+ packages? can be upgraded/ { next }
    /^Run .apt list --upgradable/ { next }
    /^Report issues at/ { next }
    /^(Selecting previously unselected|Preparing to unpack|Unpacking )/ { next }
    /^WARNING: apt does not have a stable CLI interface/ { next }
    /^[0-9]+ upgraded, [0-9]+ newly installed/ {
      printf "%sOK%s  %s new, %s upgraded. Only git, jq, openssh and what they need are touched; the rest of Termux is left alone on purpose.\n", G, N, $3, $1
      next
    }
    /^(W:|E:|Err)/ { printf "%s%s%s\n", R, $0, N; next }
    { print }
  '
}

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

# Find Obsidian vaults on shared storage that belong to a git repository, and
# say which one. Prints one `vault<TAB>repository` line per vault: the same
# directory twice in the usual arrangement, an ANCESTOR when the vault sits
# inside a code repository (git finds that one by walking up from the vault).
# A repository BELOW a vault cannot be detected — nothing says which folder
# it would be — and is named on the command line instead.
#
# A vault may also carry the plugin's SETUP INTENT (`runtime/setup.json`,
# written when the user said in Obsidian "the repository is N folders above
# this vault"). Such a vault is listed with that ancestor as its repository
# whether or not a repository exists there yet: pairing a folder that is not
# a repository is exactly what lets the plugin create or clone it afterwards.
# The intent is honoured by THIS script only, on a run the user started, and
# only after both folders were printed and confirmed — the runner never reads
# it, so nothing on shared storage can point the unattended half at a folder
# the user did not approve.
detect_vaults() {
  local roots="/storage/emulated/0 $HOME/storage/shared /sdcard"
  local r d v top above
  { for r in $roots; do
      [ -d "$r" ] || continue
      find "$r/" -maxdepth 4 -type d -name .obsidian 2>/dev/null
    done; } | while IFS= read -r d; do
      v="$(dirname "$d")"
      above="$(intent_repo_above "$v")"
      if [ -n "$above" ]; then
        top="$(ancestor_dir "$v" "$above")"
      else
        top="$(git -C "$v" rev-parse --show-toplevel 2>/dev/null || true)"
      fi
      [ -n "$top" ] || continue
      printf '%s\t%s\n' "$(realpath "$v" 2>/dev/null || printf '%s' "$v")" \
        "$(realpath "$top" 2>/dev/null || printf '%s' "$top")"
    done | sort -u
}

# The plugin's setup intent for a vault: how many folders above the vault the
# repository is (1..8), or nothing. Read defensively — the file lies on shared
# storage — and never acted on without the confirmation below.
intent_file_for() { # $1 vault
  printf '%s/.obsidian/plugins/native-git-bridge/runtime/setup.json' "$1"
}
intent_repo_above() { # $1 vault -> "N" or ""
  local f n
  f="$(intent_file_for "$1")"
  [ -f "$f" ] || { printf ''; return 0; }
  n="$(jq -r '.repoAbove // empty' "$f" 2>/dev/null || true)"
  case "$n" in [1-8]) printf '%s' "$n" ;; *) printf '' ;; esac
}

# The rest of the plugin's intent: a remote to clone (validated by the
# runner, which refuses anything that is not a plain https/ssh/scp/file URL,
# and again when queued below through jq so it can never break the request's
# JSON), and whether to hide everything outside the vault afterwards.
intent_clone_url() { # $1 vault -> URL or ""
  local f
  f="$(intent_file_for "$1")"
  [ -f "$f" ] || { printf ''; return 0; }
  jq -r '.cloneUrl // empty' "$f" 2>/dev/null | head -1 | tr -d '\r\n' || true
}
intent_hide_outside() { # $1 vault -> "true" or ""
  local f
  f="$(intent_file_for "$1")"
  [ -f "$f" ] || { printf ''; return 0; }
  [ "$(jq -r '.hideOutside // false' "$f" 2>/dev/null || true)" = "true" ] && printf 'true' || printf ''
}

# Queue the requests the intent asked for, in the order the plugin would have
# sent them: clone first, then hide everything outside the vault. Built with
# jq so a URL can never break the JSON; ids embed a timestamp one second
# apart, which is what orders them in the runner's queue. A request file is
# exactly what the plugin writes, so the runner treats them the same way —
# validating the URL, landing the clone collision-safe, and answering into
# results/ for the plugin to see later.
queue_intent_requests() { # $1 runtime dir, $2 token, $3 clone URL or "", $4 "true" to hide outside
  local rt="$1" token="$2" url="$3" hide="$4" now id1 id2
  mkdir -p "$rt/requests"
  now="$(date -u +%s)"
  QUEUED_CLONE_ID=""; QUEUED_HIDE_ID=""
  if [ -n "$url" ]; then
    id1="r-$(date -u -d "@$now" +%Y%m%dT%H%M%SZ)-install-clone"
    jq -n --arg id "$id1" --arg token "$token" --arg url "$url" \
      --arg created "$(date -u -d "@$now" +%Y-%m-%dT%H:%M:%SZ)" \
      '{protocolVersion:1,id:$id,token:$token,action:"clone-into-vault",createdAt:$created,timeoutSeconds:3600,args:{url:$url}}' \
      > "$rt/requests/$id1.json"
    QUEUED_CLONE_ID="$id1"
  fi
  if [ "$hide" = "true" ]; then
    id2="r-$(date -u -d "@$((now + 1))" +%Y%m%dT%H%M%SZ)-install-hide"
    jq -n --arg id "$id2" --arg token "$token" \
      --arg created "$(date -u -d "@$((now + 1))" +%Y-%m-%dT%H:%M:%SZ)" \
      '{protocolVersion:1,id:$id,token:$token,action:"hide-outside-vault",createdAt:$created,timeoutSeconds:600,args:{}}' \
      > "$rt/requests/$id2.json"
    QUEUED_HIDE_ID="$id2"
  fi
}

# The N-th ancestor of a directory, or nothing when the walk reaches the
# filesystem root first (a repository at "/" is nobody's intention).
ancestor_dir() { # $1 dir, $2 levels
  local d="$1" i=0
  while [ "$i" -lt "$2" ]; do
    case "$d" in */*) d="${d%/*}" ;; *) printf ''; return 0 ;; esac
    [ -n "$d" ] || { printf ''; return 0; }
    i=$((i + 1))
  done
  printf '%s' "$d"
}

# One line of the detection list as a person reads it: the vault, and the
# repository only when it is not the same directory.
describe_pair() { # $1 "vault<TAB>repo"
  local v="${1%%	*}" r="${1#*	}"
  if [ "$v" = "$r" ]; then printf '%s' "$v"; else printf '%s  (repository: %s)' "$v" "$r"; fi
}

# Arguments: the first bare path is the repository, `--vault PATH` the vault
# when it differs, `--with-ssh` as before. A function so the e2e suite can
# lift and exercise it without running the installer.
install_args() { # $@ -> REPO_ARG, VAULT_ARG, WITH_SSH
  REPO_ARG=""; VAULT_ARG=""; WITH_SSH=false
  local a expect_vault=false
  for a in "$@"; do
    if [ "$expect_vault" = true ]; then VAULT_ARG="$a"; expect_vault=false; continue; fi
    case "$a" in
      --with-ssh) WITH_SSH=true ;;
      --vault) expect_vault=true ;;
      --vault=*) VAULT_ARG="${a#--vault=}" ;;
      --*) return 1 ;;
      *) [ -z "$REPO_ARG" ] && REPO_ARG="$a" ;;
    esac
  done
  [ "$expect_vault" = false ] || return 1
  return 0
}

# The two roots have to nest (ADR-003). Prints nothing and succeeds for the
# usual arrangement and for either nesting; fails for two unrelated
# directories, where no line in any exclude file could describe the layout.
roots_nest() { # $1 repo, $2 vault
  local r v
  r="$(realpath "$1" 2>/dev/null || printf '%s' "${1%/}")"
  v="$(realpath "$2" 2>/dev/null || printf '%s' "${2%/}")"
  [ "$r" = "$v" ] && return 0
  case "$v" in "$r"/*) return 0 ;; esac
  case "$r" in "$v"/*) return 0 ;; esac
  return 1
}

# The `.git/info/exclude` line for a directory inside the repository, or
# nothing when it lies outside it — a runtime directory above the work tree
# needs no exclusion, and the hard-coded `.obsidian/…` default this used to
# write named nothing there (the runner had the same bug; ADR-003).
exclude_line_for() { # $1 repo, $2 dir inside it -> "rel/" or ""
  local r d
  r="$(realpath "$1" 2>/dev/null || printf '%s' "${1%/}")"
  d="$(realpath -m "$2" 2>/dev/null || printf '%s' "${2%/}")"
  case "$d" in
    "$r"/*) printf '%s/' "${d#"$r"/}" ;;
    *) printf '' ;;
  esac
}

install_args "$@" || fail "Usage: bash install.sh [/path/to/repository] [--vault /path/to/vault] [--with-ssh]"

# One rule ABOVE the title only: every section below brings its own rule, so
# a closing one here put two rules back to back (user report, 2026-08-26).
sayr "$NGB_SEP"
say "Native Git Bridge installer"

# 1. Verify we are inside Termux — and WHICH Termux. The Play Store app was
# frozen at 0.101 in 2020 and its package repository with it: nothing modern
# installs there and the failure mode is quiet (a years-old git, no upgrades,
# everything "works" until a feature needs a version the repo cannot give).
# Markers, in order of certainty: TERMUX_VERSION is exported by the app since
# 0.107, so an environment WITHOUT it is a frozen-era build; newer builds also
# name their store in TERMUX_APK_RELEASE. A frozen REPOSITORY is caught
# functionally in step 2, whatever the app says.
case "${PREFIX:-}" in
  */com.termux/*) : ;;
  *) fail "This installer must run inside Termux (PREFIX=${PREFIX:-unset})." ;;
esac
if [ -z "${TERMUX_VERSION:-}" ]; then
  saybad "!! WARNING: this looks like the abandoned Play Store Termux (pre-0.107):"
  saybad "   TERMUX_VERSION is not set. Its package repository is frozen in 2020,"
  saybad "   so git and everything else stay at old versions and parts of this"
  saybad "   plugin will NOT work. Install Termux from F-Droid:"
  saybad "   https://f-droid.org/packages/com.termux/"
else
  case "${TERMUX_APK_RELEASE:-}" in
    *PLAY*)
      saybad "!! WARNING: this Termux came from Google Play (TERMUX_APK_RELEASE=${TERMUX_APK_RELEASE})."
      saybad "   Play builds lag behind F-Droid and their repository can hold old"
      saybad "   packages; if git below stays under 2.42, install the F-Droid build." ;;
  esac
fi

# 2. Packages: install what is missing, UPGRADE what can be upgraded. `pkg
# install` alone only ensures a package exists — with a stale apt index it
# kept a years-old git through two runner reinstalls in one day on a real
# device — so the index is refreshed first (that is what makes `apt install`
# an upgrade), and the version git ACTUALLY ends up at is reported and judged
# rather than assumed. The plugin's partial-clone shedding needs
# `repack --filter` (git 2.42+); prefetching the visible files afterwards
# (`git backfill --sparse`) needs 2.49+.
# apt's own output is shown rather than swallowed — the refresh is a network
# step that can sit for minutes retrying a dead mirror, and a silent line
# reads as a hang — but it flows through apt_filter, which reshapes it for a
# phone screen. pipefail inside the subshell: without it the filter's own
# exit status would mask a failed pkg run.
section "Packages"
say "-- Refreshing the package index (network; a dead mirror can take a while)..."
( set -o pipefail; pkg update -y 2>&1 | apt_filter ) \
  || saybad "   (index refresh failed; installs may use stale versions)"
GIT_BEFORE="$(git --version 2>/dev/null | awk '{print $3}')"
say "-- Installing/upgrading git, jq, openssh..."
( set -o pipefail; pkg install -y git jq openssh 2>&1 | apt_filter ) || fail "pkg install failed"
GIT_VERSION="$(git --version 2>/dev/null | awk '{print $3}')"
if [ -n "$GIT_BEFORE" ] && [ "$GIT_BEFORE" != "$GIT_VERSION" ]; then
  say "-- git $GIT_BEFORE -> ${NGB_GREEN}$GIT_VERSION${NGB_OFF}"
else
  say "-- git $GIT_VERSION"
fi
GIT_MAJ="${GIT_VERSION%%.*}"; GIT_REST="${GIT_VERSION#*.}"; GIT_MIN="${GIT_REST%%.*}"
case "$GIT_MAJ$GIT_MIN" in ''|*[!0-9]*) GIT_MAJ=0; GIT_MIN=0 ;; esac
if [ "$GIT_MAJ" -lt 2 ] || { [ "$GIT_MAJ" -eq 2 ] && [ "$GIT_MIN" -lt 42 ]; }; then
  # The index was JUST refreshed and this is still the best git on offer, so
  # the repository itself is outdated — the functional Play-Store marker,
  # whatever the app's environment claimed above.
  saybad "!! git is older than 2.42 and this is the newest this Termux can install:"
  saybad "   the package repository itself is outdated (a Play Store build, or a"
  saybad "   very old install). Partial-clone storage cleanup cannot shed content"
  saybad "   on this git. Install Termux from F-Droid for current packages."
fi

# 3. Storage access: request it and WAIT for the user to accept the dialog,
# so the installer continues by itself instead of demanding a re-run.
if [ ! -d "$HOME/storage" ]; then
  section "Storage access"
  say "-- Shared storage is not linked yet. Requesting access (termux-setup-storage)."
  say "   Please ACCEPT the Android permission dialog that appears now..."
  termux-setup-storage || true
  waited=0
  while [ ! -d "$HOME/storage" ] && [ "$waited" -lt 120 ]; do
    sleep 2
    waited=$((waited + 2))
  done
  if [ -d "$HOME/storage" ]; then
    say "-- Storage access ${NGB_GREEN}granted${NGB_OFF}; continuing."
  else
    fail "Storage access was not granted within 2 minutes. Accept the dialog and re-run the same command."
  fi
fi

# 4. Allow the companion app to trigger the runner (RUN_COMMAND intent), and
# install the runner itself. BOTH happen before any vault is looked for: they
# depend on nothing vault-shaped, and the old order meant a brand-new device
# (no vault yet) failed out of the installer with the property never enabled
# and no runner installed — the ChromeOS first-run hit exactly that. The
# property only permits apps that ALSO hold the RUN_COMMAND permission, which
# the user grants per-app in Android settings.
section "Runner"
TP="$HOME/.termux/termux.properties"
mkdir -p "$HOME/.termux"
if ! grep -Eq '^\s*allow-external-apps\s*=\s*true\s*$' "$TP" 2>/dev/null; then
  printf '\nallow-external-apps=true\n' >> "$TP"
  command -v termux-reload-settings >/dev/null 2>&1 && termux-reload-settings || true
  say "-- ${NGB_GREEN}Enabled${NGB_OFF} allow-external-apps in ~/.termux/termux.properties (needed for the companion app)."
else
  say "-- allow-external-apps already ${NGB_GREEN}enabled${NGB_OFF}."
fi

CONF_DIR="$HOME/.config/native-git-bridge"
PROFILES_DIR="$CONF_DIR/profiles"
mkdir -p "$PROFILES_DIR"
chmod 700 "$CONF_DIR" "$PROFILES_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_SRC="$SCRIPT_DIR/native-git-bridge-runner.sh"
[ -f "$RUNNER_SRC" ] || fail "runner script not found next to installer: $RUNNER_SRC"
cp "$RUNNER_SRC" "$CONF_DIR/runner.sh"
chmod 700 "$CONF_DIR/runner.sh"
say "-- Runner ${NGB_GREEN}successfully${NGB_OFF} installed to $CONF_DIR/runner.sh."
# Migrate an existing single-repo config before looking for a profile: the
# runner does it on its first run, so one implementation covers both paths.
# NGB_SCAN_ROOTS="" keeps this run from scanning shared storage - it is here to
# migrate, and a scan of a full phone would look like a hang.
#
# The run also drains anything already queued — a pending sync or pull is a
# network operation that can take minutes — so it runs in interactive mode:
# the runner narrates each step to this terminal instead of looking hung
# (the same reason apt's output is shown above).
say "-- First runner pass (config migration; drains any queued requests — live output follows)..."
NGB_SCAN_ROOTS="" "$CONF_DIR/runner.sh" interactive || true

# 5. Repository and vault paths: the arguments, otherwise auto-detect vaults
# on shared storage (a folder holding .obsidian that belongs to a git
# repository — the folder itself, or one above it).
section "Vault"
VAULT_DIR=""
if [ -z "$REPO_ARG" ]; then
  [ -z "$VAULT_ARG" ] || fail "--vault names the vault; the repository path has to be given with it."
  say "-- No path given; scanning shared storage for Obsidian vaults with a git repo..."
  VAULTS="$(detect_vaults)"
  COUNT="$(printf '%s\n' "$VAULTS" | grep -c . || true)"
  PAIR=""
  if [ "$COUNT" -eq 1 ]; then
    PAIR="$VAULTS"
    say "-- Found exactly one: $(describe_pair "$PAIR")"
  elif [ "$COUNT" -gt 1 ]; then
    say "-- Found several vaults:"
    n=0
    printf '%s\n' "$VAULTS" | while IFS= read -r line; do
      n=$((n + 1)); sayr "$(printf '%2d. %s' "$n" "$(describe_pair "$line")")"
    done
    PICK="$(ask_line 'Enter the number of the vault to use: ')"
    PAIR="$(printf '%s\n' "$VAULTS" | sed -n "${PICK}p")"
    [ -n "$PAIR" ] || fail "Invalid selection."
  fi
  if [ -n "$PAIR" ]; then
    VAULT_DIR="${PAIR%%	*}"
    REPO_ARG="${PAIR#*	}"
  else
    # Not a failure. Everything a vaultless device CAN have is already
    # installed above, and the plugin pairs a new vault by itself: it writes a
    # claim file and the runner adopts it on its next idle run, token minted
    # here in Termux. This is the ordinary first run on a brand-new device.
    say "-- No vault with a git repository was found, and none was named."
    say "   The runner and the companion permission are installed anyway."
    section "Done (runner installed; no vault paired yet)"
    say "Finish from inside Obsidian: open (or create) your vault, enable the"
    say "plugin in Settings -> Native Git Bridge, and use 'Set up repository'."
    say "It pairs this vault first (no token copying), then creates or clones"
    say "the repository without leaving the app."
    say "Re-running this installer with the vault's path also works:"
    sayr "     bash install.sh /storage/emulated/0/<YourVault>"
    exit 0
  fi
fi
REPO_DIR="$REPO_ARG"
[ -d "$REPO_DIR" ] || fail "Directory does not exist: $REPO_DIR"
# One path that is a VAULT carrying the plugin's setup intent: the path the
# plugin's own install command passes is the vault, and the intent says where
# the repository is. Explicit --vault always wins over the file.
INTENT_ABOVE=""
if [ -z "$VAULT_ARG" ] && [ -z "$VAULT_DIR" ]; then
  INTENT_ABOVE="$(intent_repo_above "$REPO_DIR")"
  if [ -n "$INTENT_ABOVE" ]; then
    VAULT_DIR="$REPO_DIR"
    REPO_DIR="$(ancestor_dir "$VAULT_DIR" "$INTENT_ABOVE")"
    [ -n "$REPO_DIR" ] || fail "The plugin asked for a repository $INTENT_ABOVE folder(s) above $VAULT_DIR, and there is no such folder."
  fi
elif [ -n "$VAULT_DIR" ] && [ -z "$VAULT_ARG" ]; then
  INTENT_ABOVE="$(intent_repo_above "$VAULT_DIR")"
fi
# The vault: named, detected, or the repository itself. It has to be an
# Obsidian vault — the runtime directory goes under its .obsidian, and that is
# where the plugin will look for answers — and it has to nest with the
# repository one way or the other.
[ -n "$VAULT_ARG" ] && VAULT_DIR="$VAULT_ARG"
[ -n "$VAULT_DIR" ] || VAULT_DIR="$REPO_DIR"
[ -d "$VAULT_DIR" ] || fail "Vault directory does not exist: $VAULT_DIR"
if [ "$VAULT_DIR" != "$REPO_DIR" ]; then
  [ -d "$VAULT_DIR/.obsidian" ] || fail "Not an Obsidian vault (no .obsidian inside): $VAULT_DIR"
  roots_nest "$REPO_DIR" "$VAULT_DIR" || fail "The vault must be inside the repository or the repository inside the vault: $VAULT_DIR is neither, relative to $REPO_DIR."
fi

# 7+8. Verify repository; explain safe.directory if needed (repo on shared
# storage is usually owned by a different uid, which new git versions reject).
#
# A folder that is NOT a repository yet is accepted when the vault is a
# different folder (the plugin's setup intent, or --vault): the profile is
# written in the runner's bootstrap state, and Create / Clone in the plugin
# then land the repository here, above the vault. The user is told exactly
# that and confirms both folders first. A plain single path stays what it
# was: a vault that is its own repository, refused when it is not one — the
# plugin pairs that case by itself, without this script.
BOOTSTRAP=false
if [ "$VAULT_DIR" != "$REPO_DIR" ] && ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
   ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree 2>&1 | grep -qi 'dubious ownership'; then
  BOOTSTRAP=true
  say "-- There is no git repository in $REPO_DIR yet."
  say "-- Repository (to be created or cloned from the plugin): $REPO_DIR"
  say "-- Vault: $VAULT_DIR"
  confirm "Pair this vault with that folder as its repository?" || fail "Nothing was changed."
elif ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
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
# Inside a work tree is not the same as being one: a folder below another
# repository passes the test above while its `.git` is the parent's. The
# runner pins git to the profile's own directory and would answer
# REPO_MISSING there forever, so name the real root now instead.
if [ "$BOOTSTRAP" = false ]; then
  REPO_TOP="$(git -C "$REPO_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$REPO_TOP" ] && [ "$(realpath "$REPO_TOP" 2>/dev/null || printf '%s' "$REPO_TOP")" != "$(realpath "$REPO_DIR" 2>/dev/null || printf '%s' "$REPO_DIR")" ]; then
    fail "$REPO_DIR is inside the repository $REPO_TOP but is not a repository of its own. Pass the repository root as the first argument and, if the vault is this folder, add: --vault \"$REPO_DIR\""
  fi
  if [ "$VAULT_DIR" = "$REPO_DIR" ]; then
    say "-- Repository ${NGB_GREEN}OK${NGB_OFF}: $REPO_DIR"
  else
    say "-- Repository ${NGB_GREEN}OK${NGB_OFF}: $REPO_DIR"
    say "-- Vault: $VAULT_DIR (the repository and the vault are different folders; the plugin's runtime lives in the vault, git works in the repository)"
    if [ -n "$INTENT_ABOVE" ]; then
      confirm "Pair this vault with that repository?" || fail "Nothing was changed."
    fi
  fi
fi

# 9. Verify sparse checkout (informational; sparse is supported, not required).
if [ "$BOOTSTRAP" = false ]; then
  SPARSE=$(git -C "$REPO_DIR" config --get core.sparseCheckout 2>/dev/null || true)
  if [ "$SPARSE" = "true" ]; then
    say "-- Sparse checkout: ${NGB_GREEN}ENABLED${NGB_OFF} ($(git -C "$REPO_DIR" sparse-checkout list 2>/dev/null | wc -l | tr -d ' ') patterns)"
  else
    say "-- Sparse checkout: not enabled (that's fine if you don't use it)."
  fi
fi

# 6. Profile + token for this vault (the runner itself went in at step 4).
# One profile per vault: profiles/<id>.conf, mode 600, its own token. Running
# this installer for a second vault ADDS a profile; it never overwrites the
# first one (which used to leave that vault silently unanswered).
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

# The runtime directory is the VAULT's, never derived from the repository:
# with the repository above the vault the two differ, and the plugin reads
# answers only from its own vault (ADR-003). A re-run that names the
# repository alone keeps the runtime directory the profile already has —
# that is how the profile remembers where the vault is.
RUNTIME_DIR="$VAULT_DIR/.obsidian/plugins/native-git-bridge/runtime"
if [ -n "$PROFILE_FILE" ]; then
  PROFILE_ID="$(profile_value "$PROFILE_FILE" NGB_PROFILE_ID)"
  TOKEN="$(profile_value "$PROFILE_FILE" NGB_TOKEN)"
  if [ -z "$VAULT_ARG" ] && [ "$VAULT_DIR" = "$REPO_DIR" ]; then
    KEPT_RUNTIME="$(profile_value "$PROFILE_FILE" NGB_RUNTIME_DIR)"
    if [ -n "$KEPT_RUNTIME" ] && [ "$KEPT_RUNTIME" != "$RUNTIME_DIR" ]; then
      RUNTIME_DIR="$KEPT_RUNTIME"
      VAULT_DIR="${RUNTIME_DIR%/.obsidian/plugins/native-git-bridge/runtime}"
      say "-- This repository's profile serves the vault $VAULT_DIR; keeping that."
    fi
  fi
  say "-- Existing profile for this vault reused: ${NGB_YELLOW}$PROFILE_ID${NGB_OFF} (token ${NGB_GREEN}kept${NGB_OFF})."
else
  PROFILE_ID="p-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  PROFILE_FILE="$PROFILES_DIR/$PROFILE_ID.conf"
  say "-- New profile for this vault: ${NGB_YELLOW}$PROFILE_ID${NGB_OFF} (its own token)."
fi
cat > "$PROFILE_FILE" <<CONF
NGB_PROFILE_FORMAT=1
NGB_PROFILE_ID="$PROFILE_ID"
NGB_REPO_DIR="$REPO_DIR"
NGB_RUNTIME_DIR="$RUNTIME_DIR"
NGB_TOKEN="$TOKEN"
CONF
chmod 600 "$PROFILE_FILE"
# "(chmod 600)" said nothing to the user (their question, 2026-08-26); say
# what the mode MEANS instead of naming it.
say "-- Profile ${NGB_GREEN}written${NGB_OFF} (only this Termux user can read it)."

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
  section "Profiles on this device: $total (this vault is #$mine)"
  n=0
  for f in "$PROFILES_DIR"/*.conf; do
    [ -f "$f" ] || continue
    n=$(( n + 1 ))
    pid="$(profile_value "$f" NGB_PROFILE_ID)"
    dir="$(profile_value "$f" NGB_REPO_DIR)"
    rt="$(profile_value "$f" NGB_RUNTIME_DIR)"
    mark=""
    [ "$f" = "$PROFILE_FILE" ] && mark="  <- this vault"
    state=""
    if [ ! -d "$dir" ]; then
      state="  MISSING (directory is gone)"
    elif ! git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
      state="  NOT A REPOSITORY (no git work tree there)"
    fi
    # The vault, when it is not the repository: the one fact that tells two
    # profiles with nested directories apart.
    vdir="${rt%/.obsidian/plugins/native-git-bridge/runtime}"
    [ -n "$rt" ] && [ "$vdir" != "$rt" ] && [ "$vdir" != "$dir" ] && state="$state  (vault: $vdir)"
    sayr "  $n. ${NGB_YELLOW}${pid:-<unreadable>}${NGB_OFF}  ${dir:-<unreadable>}$state$mark"
  done
  say "One runner drains all of them. A profile you no longer want is one file:"
  sayr "  rm $PROFILES_DIR/<profile-id>.conf"
  say ""
}
list_profiles
# How many OTHER vaults this device already serves. `total` is set by
# list_profiles (0 when there are no profiles at all). Used by the SSH branch
# below to decide whether a second account is likely; it was read there
# without ever being set, which under `set -u` killed the installer on the
# one path that reached it (found reading the code, 2026-08-26).
OTHER_COUNT=0
[ "${total:-0}" -gt 0 ] && OTHER_COUNT=$(( total - 1 ))

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
# No repository yet means no remote to configure credentials for: the clone
# from the plugin brings its own credential route (the profile's credential
# file for https, entered once at a Termux prompt; a key for ssh).
if [ "$BOOTSTRAP" = false ]; then
section "Authentication"

# git's credential-store format is `https://username:password@host`. A line
# whose userinfo has NO colon serves a username and no password, so every
# non-interactive fetch dies asking for the password the file was supposed to
# hold. That is exactly what a token-as-username remote URL produces when its
# userinfo is copied verbatim (a real device lost its working auth to this:
# `https://TOKEN@github.com/...` worked as a URL, because basic auth sends
# "TOKEN:" with an empty password — the file line needs that colon spelled
# out). Adding `:` preserves exactly the authentication the URL performed.
# Runs on every install, so re-running the installer heals an affected file.
normalize_cred_file() {
  [ -f "$PROFILE_CREDS" ] || return 0
  sed -i 's#^\(https://[^:@/]*\)@#\1:@#' "$PROFILE_CREDS" 2>/dev/null || true
}
normalize_cred_file

# credential.helper is multi-valued and ACCUMULATES across scopes: helpers are
# asked system, then global, then local, and the FIRST that answers wins, so a
# global helper silently shadows this repository's own file (a real device
# could not commit until the global credentials were deleted). An empty value
# in the local config resets the inherited list, which makes the profile's
# file authoritative. Idempotent: both lines are rewritten from scratch.
set_local_cred_helper() {
  git -C "$REPO_DIR" config --local --unset-all credential.helper 2>/dev/null || true
  git -C "$REPO_DIR" config --local --add credential.helper ''
  git -C "$REPO_DIR" config --local --add credential.helper "store --file=$PROFILE_CREDS"
}

REMOTE_URL="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
case "$REMOTE_URL" in
  https://*@*)
    say "-- HTTPS remote with credentials embedded in the URL detected."
    say "   This works, but the token then appears in .git/config."
    if confirm "Move the token into this repository's own credential file (chmod 600) and clean the URL?"; then
      CREDS="${REMOTE_URL#https://}"; CREDS="${CREDS%%@*}"
      # Token-as-username (no colon): the URL authenticated with an empty
      # password, so the stored line must say so — see normalize_cred_file.
      case "$CREDS" in *:*) : ;; *) CREDS="$CREDS:" ;; esac
      HOSTPATH="${REMOTE_URL#https://*@}"
      HOSTONLY="${HOSTPATH%%/*}"
      mkdir -p "$CREDS_DIR"; chmod 700 "$CREDS_DIR"
      printf 'https://%s@%s\n' "$CREDS" "$HOSTONLY" >> "$PROFILE_CREDS"
      chmod 600 "$PROFILE_CREDS"
      set_local_cred_helper
      git -C "$REPO_DIR" remote set-url origin "https://$HOSTPATH"
      say "-- Token ${NGB_GREEN}moved${NGB_OFF} to $PROFILE_CREDS (this repository only); remote URL cleaned."
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
        set_local_cred_helper
        say "-- credential.helper set for this repository only (with the empty first value that stops a global helper answering ahead of it). Run this once in Termux and enter your PAT as the password; it is reused non-interactively after that:"
        sayr "     git -C \"$REPO_DIR\" pull"
      elif [ -n "$GLOBAL_HELPER" ]; then
        say "-- Falling back to the global credential helper '$GLOBAL_HELPER'."
      fi
    else
      say "-- HTTPS remote with a repository-local credential helper: ${NGB_GREEN}OK${NGB_OFF}, this vault's PAT will be used."
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
    saybad "-- WARNING: no 'origin' remote configured; pull/push will fail until you add one."
    ;;
esac

# Non-interactive auth self-test (fails fast instead of hanging).
if [ -n "$REMOTE_URL" ]; then
  say "-- Checking non-interactive access to the remote (up to 30 s)..."
  if GIT_TERMINAL_PROMPT=0 timeout 30 git -C "$REPO_DIR" ls-remote --heads origin >/dev/null 2>&1; then
    say "-- Remote authentication check ${NGB_GREEN}PASSED${NGB_OFF} (non-interactive ls-remote)."
  else
    saybad "-- WARNING: non-interactive access to the remote FAILED. The bridge will not be able to fetch or push until credentials work without a prompt (expired PAT? missing helper?)."
  fi
fi
fi # BOOTSTRAP

# 6. Exclude the runtime dir and Obsidian's trash locally (never synced).
# Both lines are derived from where the VAULT is, and skipped when the
# directory lies outside the repository, where git cannot see it and a line
# would misdescribe the layout. The trash line exists because staging is
# `git add -A`: without it a note deleted in Obsidian, or a file the sparse
# repair moved out of a protected path, is committed straight back.
if [ "$BOOTSTRAP" = false ]; then
GIT_DIR_PATH="$(git -C "$REPO_DIR" rev-parse --git-dir)"
case "$GIT_DIR_PATH" in
  /*) : ;;
  *) GIT_DIR_PATH="$REPO_DIR/$GIT_DIR_PATH" ;;
esac
EXCLUDE_FILE="$GIT_DIR_PATH/info/exclude"
mkdir -p "$(dirname "$EXCLUDE_FILE")"
add_exclude_line() { # $1 line ("" = nothing to add)
  [ -n "$1" ] || return 0
  # Append only after a newline: a file whose last line has none would
  # otherwise swallow our entry into it (and corrupt that line too).
  if [ -s "$EXCLUDE_FILE" ] && [ "$(tail -c 1 "$EXCLUDE_FILE" | od -An -tx1 | tr -d ' \n')" != "0a" ]; then
    printf '\n' >> "$EXCLUDE_FILE"
  fi
  grep -qxF "$1" "$EXCLUDE_FILE" 2>/dev/null || printf '%s\n' "$1" >> "$EXCLUDE_FILE"
}
RUNTIME_LINE="$(exclude_line_for "$REPO_DIR" "$RUNTIME_DIR")"
TRASH_LINE="$(exclude_line_for "$REPO_DIR" "$VAULT_DIR/.trash")"
add_exclude_line "$RUNTIME_LINE"
add_exclude_line "$TRASH_LINE"
if [ -n "$RUNTIME_LINE" ]; then
  say "-- Runtime dir and the vault's .trash excluded via .git/info/exclude (local only)."
else
  say "-- The vault lies outside the repository: nothing to exclude, git never sees the runtime dir or the trash."
fi
else
  # The runner writes both exclusions itself the moment a repository is
  # created or cloned into this folder (init-repo / clone-into-vault).
  say "-- No repository yet: the runtime and trash exclusions are written when it is created or cloned."
fi # BOOTSTRAP

# 10. Test round trip: write a ping request and run the runner.
#
# The runner is single-instance locked and snapshots the queue when it starts,
# so a runner already serving an Obsidian trigger (sync-on-close fires exactly
# when the user closes Obsidian to open Termux) can neither see a ping written
# after its start nor let this script's run in: that run waits 20 s on the
# lock and exits 0 without processing. A single silent attempt therefore
# reported "Self-test failed" on a perfectly healthy install. Retry with a
# FRESH ping each time (a reused request would only earn an EXPIRED answer),
# waiting for the lock to clear between attempts. The lock-exit line lands in
# the global runner.log, not the vault's, so the failure message names both.
run_self_test() {
  mkdir -p "$RUNTIME_DIR/requests"
  local attempt=1 test_id waited
  while :; do
    test_id="r-$(date -u +%Y%m%dT%H%M%SZ)-install$attempt"
    cat > "$RUNTIME_DIR/requests/$test_id.json" <<REQ
{"protocolVersion":1,"id":"$test_id","token":"$TOKEN","action":"ping","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","timeoutSeconds":30,"args":{}}
REQ
    say "-- Self-test: running the runner (it drains anything queued first; live output follows)..."
    "$CONF_DIR/runner.sh" interactive || fail "runner test run failed"
    if jq -e '.ok == true' "$RUNTIME_DIR/results/$test_id.json" >/dev/null 2>&1; then
      say "-- Self-test ${NGB_GREEN}PASSED${NGB_OFF} (ping round trip)."
      rm -f "$RUNTIME_DIR/results/$test_id.json"
      return 0
    fi
    rm -f "$RUNTIME_DIR/requests/$test_id.json"
    if [ "$attempt" -ge 3 ]; then
      break
    fi
    attempt=$((attempt + 1))
    if [ -d "$CONF_DIR/.runner.lock" ]; then
      say "-- Another runner is busy (an operation Obsidian triggered); waiting for it to finish..."
      waited=0
      while [ -d "$CONF_DIR/.runner.lock" ] && [ "$waited" -lt 300 ]; do
        sleep 2
        waited=$((waited + 2))
        if [ $((waited % 20)) -eq 0 ]; then
          say "   ...still waiting for the other runner (${waited}s of 300)"
        fi
      done
    fi
  done
  fail "Self-test failed. If $CONF_DIR/runner.log ends with 'another runner is active', an Obsidian-triggered operation outlasted the retries: let it finish and re-run this installer. Otherwise see $RUNTIME_DIR/runner.log"
}
section "Self-test"
run_self_test

# 10b. What the plugin asked for in its setup intent, done HERE, in the one
# Termux session the user is already in: the clone (git's own credential
# prompt appears in this terminal if the remote needs one, and the answer is
# saved for this repository by the runner's clone-time helper), then hiding
# everything outside the vault. The runner runs in interactive mode, so it may
# prompt; the requests are the plugin's own shapes, so the plugin finds the
# results and the fresh status the next time it looks. Nothing else in Termux
# is needed of the user after this.
INTENT_CLONE=""; INTENT_HIDE=""; CLONED_NOW=false
if [ -n "$INTENT_ABOVE" ]; then
  INTENT_CLONE="$(intent_clone_url "$VAULT_DIR")"
  INTENT_HIDE="$(intent_hide_outside "$VAULT_DIR")"
fi
if [ -n "$INTENT_CLONE" ] || [ "$INTENT_HIDE" = "true" ]; then
  section "Repository"
  [ -n "$INTENT_CLONE" ] && say "-- Cloning $INTENT_CLONE into $REPO_DIR (if the remote asks for a username and password, answer here; a token is saved for this repository)..."
  [ "$INTENT_HIDE" = "true" ] && say "-- Then hiding every folder of the repository outside the vault on this device."
  queue_intent_requests "$RUNTIME_DIR" "$TOKEN" "$INTENT_CLONE" "$INTENT_HIDE"
  "$CONF_DIR/runner.sh" interactive || true
  if [ -n "$QUEUED_CLONE_ID" ]; then
    if jq -e '.ok == true' "$RUNTIME_DIR/results/$QUEUED_CLONE_ID.json" >/dev/null 2>&1; then
      say "-- Clone ${NGB_GREEN}done${NGB_OFF}: the repository is in $REPO_DIR, the vault's own files were kept."
      BOOTSTRAP=false
      CLONED_NOW=true
    else
      saybad "-- The clone did not finish: $(jq -r '.error.message // "no result"' "$RUNTIME_DIR/results/$QUEUED_CLONE_ID.json" 2>/dev/null || echo 'no result')"
      saybad "   Nothing was written into the vault. Fix the cause (URL, credentials, network) and clone from the plugin: Set up repository -> Clone from a remote."
    fi
  fi
  if [ -n "$QUEUED_HIDE_ID" ]; then
    if jq -e '.ok == true' "$RUNTIME_DIR/results/$QUEUED_HIDE_ID.json" >/dev/null 2>&1; then
      say "-- Hidden outside the vault on this device: $(jq -r '.data.sparseHiddenOutside // ""' "$RUNTIME_DIR/results/$QUEUED_HIDE_ID.json" | tr '\n' ' ')"
    else
      saybad "-- Hiding the folders outside the vault did not finish: $(jq -r '.error.message // "no result"' "$RUNTIME_DIR/results/$QUEUED_HIDE_ID.json" 2>/dev/null || echo 'no result'). The plugin offers it again under Set up repository."
    fi
  fi
fi

# 11. Auto-pairing: the plugin imports this file on next start and deletes it,
# so the token never has to be copied by hand. (It transits vault storage once;
# same trust boundary as the request files themselves.)
# It also carries where the two roots sit relative to each other (at most one
# of the two fields is non-empty), so the plugin knows the layout before its
# first status answer arrives.
VAULT_IN_REPO=""; REPO_IN_VAULT=""
REPO_REAL="$(realpath "$REPO_DIR" 2>/dev/null || printf '%s' "$REPO_DIR")"
VAULT_REAL="$(realpath "$VAULT_DIR" 2>/dev/null || printf '%s' "$VAULT_DIR")"
case "$VAULT_REAL" in "$REPO_REAL"/*) VAULT_IN_REPO="${VAULT_REAL#"$REPO_REAL"/}" ;; esac
case "$REPO_REAL" in "$VAULT_REAL"/*) REPO_IN_VAULT="${REPO_REAL#"$VAULT_REAL"/}" ;; esac
cat > "$RUNTIME_DIR/pairing.json" <<PAIR
{"token":"$TOKEN","repoPath":"$REPO_DIR","profileId":"$PROFILE_ID","vaultInRepo":"$VAULT_IN_REPO","repoInVault":"$REPO_IN_VAULT","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
PAIR
say "-- Pairing file ${NGB_GREEN}written${NGB_OFF}; the Obsidian plugin will import the token automatically."
# The setup intent is consumed: it asked for exactly this pairing.
[ -n "$INTENT_ABOVE" ] && rm -f "$(intent_file_for "$VAULT_DIR")" 2>/dev/null

# 12. Next steps. The former single block mixed the three actions with the
# token, the profile id, two file paths and three notes; the user could not
# find anything in it. Actions first, reference values after, each value on a
# line of its own under its label with blank lines between the groups.
section "Done. What is left (outside Termux)"
say "1. Open Obsidian -> Settings -> Native Git Bridge -> enable on this device. The pairing token is imported automatically on plugin start."
say "2. In the Git Bridge Companion app: grant the 'Run commands in Termux environment' permission (step 2 there) - all three checkmarks must be green."
if [ "$BOOTSTRAP" = true ]; then
  say "3. There is no repository in $REPO_DIR yet. In Obsidian: Settings -> Native Git Bridge -> Set up repository -> Create a repository, or Clone from a remote. It lands in that folder, above the vault; afterwards the same window offers to hide everything outside the vault on this device."
elif [ "$CLONED_NOW" = true ]; then
  say "3. The repository is cloned and paired; credentials you entered above are saved for it in Termux. Open Obsidian: the Git panel shows the repository, and Set up repository can still hide the folders outside the vault if that was not done here."
else
  say "3. Authentication: whatever you already use in Termux (PAT via credential helper, token in URL, or SSH key) keeps working - see the auth check result above."
fi

section "For reference"
say "Pairing token (only needed if the automatic import fails):"
# Bold, not a color: the token should be findable without shouting
# (the user's pick, 2026-08-26).
sayr "  ${NGB_BOLD}$TOKEN${NGB_OFF}"
say ""
say "Profile for this vault (${NGB_YELLOW}$PROFILE_ID${NGB_OFF}):"
sayr "  $PROFILE_FILE"
say ""
say "Nothing runs in the background; the runner executes only when triggered. Run it by hand any time:"
sayr "  ~/.config/native-git-bridge/runner.sh"
say ""
say "Another vault? Run the same command with its path; each vault gets its own profile and token, and one runner drains them all. A vault that is not the repository's root takes both paths:"
sayr "  bash install.sh /path/to/repository --vault /path/to/vault"
