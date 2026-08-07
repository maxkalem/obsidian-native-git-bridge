#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - Termux runner (protocol v1).
# One-shot: drains the pending requests of EVERY paired vault (profile), writes
# results, exits. Never daemonizes.
# Security: per-profile token check, action allow-list, validated paths,
# argv arrays only, git pinned to the profile's own repository.
set -u
umask 077

RUNNER_VERSION=12
PROFILE_FORMAT=1

# The store: one directory holding profiles/<id>.conf (one per paired vault),
# runner.sh itself and the cross-profile lock. NGB_CONFIG keeps naming the
# LEGACY single-repo config file; when it is set, its directory becomes the
# config dir, so a test harness (or a relocated setup) can move the whole store.
NGB_CONFIG="${NGB_CONFIG:-}"
if [ -n "$NGB_CONFIG" ]; then
  NGB_CONFIG_DIR="${NGB_CONFIG_DIR:-$(dirname "$NGB_CONFIG")}"
else
  NGB_CONFIG_DIR="${NGB_CONFIG_DIR:-$HOME/.config/native-git-bridge}"
  NGB_CONFIG="$NGB_CONFIG_DIR/config"
fi
PROFILES_DIR="$NGB_CONFIG_DIR/profiles"
# One runner drains every profile, so the single-instance lock is global and
# lives with the profiles, not inside one vault's runtime directory.
LOCK_DIR="$NGB_CONFIG_DIR/.runner.lock"
NGB_LOG_MAX_BYTES="${NGB_LOG_MAX_BYTES:-262144}"

# Never let git block on an interactive credential prompt: with a missing or
# expired PAT the command must fail fast with a clear stderr, not hang.
export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=never
export SSH_ASKPASS=/bin/false

die() { echo "native-git-bridge-runner: $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git not installed (pkg install git)"
command -v jq  >/dev/null 2>&1 || die "jq not installed (pkg install jq)"

mkdir -p "$PROFILES_DIR" 2>/dev/null || die "config dir not writable: $NGB_CONFIG_DIR"
chmod 700 "$NGB_CONFIG_DIR" "$PROFILES_DIR" 2>/dev/null || true

# Until a profile is activated, log lines go next to the profiles. Every
# activated profile switches LOG_FILE to its own runtime/runner.log, which is
# what the plugin's bridge check reads.
LOG_FILE="$NGB_CONFIG_DIR/runner.log"
PROFILE_ID=""
PROFILE_FILE=""
NGB_REPO_DIR=""
NGB_TOKEN=""
NGB_RUNTIME_DIR=""
REQ_DIR=""; PROC_DIR=""; RES_DIR=""; CAN_DIR=""; DONE_DIR=""

log() {
  # Never log tokens or credentialed URLs.
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE"
  if [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$NGB_LOG_MAX_BYTES" ]; then
    tail -c $((NGB_LOG_MAX_BYTES / 2)) "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
}

redact_url() { sed -E 's#(\w+://)[^/@[:space:]]+:[^/@[:space:]]+@#\1***@#g'; }

# ---- validation helpers ------------------------------------------------------

valid_id() { printf '%s' "$1" | grep -Eq '^r-[0-9A-Za-z.TZ:-]{1,64}$'; }

# Opaque profile id. It is also a FILE NAME (profiles/<id>.conf), so the
# charset is deliberately tiny: no dots, no slashes, nothing to traverse with.
valid_profile_id() { printf '%s' "$1" | grep -Eq '^p-[0-9a-f]{8,32}$'; }

# Tokens are compared verbatim; the charset only has to keep the profile file
# (KEY="value" lines) parsable and unambiguous.
valid_token() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._-]{8,128}$'; }

# A remote URL is user input, so it is validated on both sides and never
# interpolated into a shell string (git is called with argv arrays).
#
# Refused on purpose:
#   - anything starting with "-", which git would read as an option;
#   - credentials in the URL (`https://user:pass@host/…`). They would be
#     written into the request file inside the vault and into .git/config,
#     and this plugin's rule is that no secret ever reaches the plugin side.
#     Authentication belongs to a credential helper or an SSH key, in Termux.
#   - plain http, control characters, whitespace, anything non-ASCII.
NGB_MAX_URL_LEN="${NGB_MAX_URL_LEN:-512}"
valid_remote_url() {
  local u="$1"
  [ -n "$u" ] || return 1
  [ "${#u}" -le "$NGB_MAX_URL_LEN" ] || return 1
  case "$u" in -*) return 1 ;; esac
  printf '%s' "$u" | LC_ALL=C grep -Eq '^[!-~]+$' || return 1
  printf '%s' "$u" | grep -Eq '^[A-Za-z][A-Za-z0-9+.-]*://[^/@]*:[^/@]*@' && return 1
  case "$u" in
    https://*|ssh://*) return 0 ;;
    # A local repository, e.g. a copy on the SD card. It carries no protocol
    # and cannot execute anything; the dangerous git URL forms (ext::, git::)
    # are not in this list and their arguments contain spaces anyway.
    file:///*) return 0 ;;
  esac
  # scp-like form: user@host:path
  printf '%s' "$u" | grep -Eq '^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^ ]+$' && return 0
  return 1
}

# Branch names: a safe subset of git's rules (no leading '-', no "..", no
# trailing ".lock", no control characters, no refspec punctuation).
valid_branch_name() {
  local b="$1"
  [ -n "$b" ] || return 1
  [ "${#b}" -le 100 ] || return 1
  printf '%s' "$b" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]*$' || return 1
  case "$b" in *..*|*.lock|*/|*//*) return 1 ;; esac
  return 0
}

# Values stored in a profile file: absolute path, no quotes, no control chars.
valid_abs_path() {
  local p="$1"
  case "$p" in
    /*) : ;;
    *) return 1 ;;
  esac
  case "$p" in *'"'*|*'\'*) return 1 ;; esac
  printf '%s' "$p" | LC_ALL=C grep -q '[[:cntrl:]]' && return 1
  return 0
}

valid_rel_path() {
  # repository-relative: not empty, no leading /, no backslash, no '..' segment,
  # no control chars, not inside .git, no git pathspec magic.
  local p="$1"
  [ -n "$p" ] || return 1
  case "$p" in
    # A leading ':' is git pathspec magic (":/", ":(exclude)…", ":!…"). It
    # would change what a path argument MEANS to git — ":/" as a stage-file
    # path would stage the whole repo, bypassing the protected-path excludes.
    /*|*\\*|~*|:*) return 1 ;;
    ..|../*|*/..|*/../*) return 1 ;;
  esac
  # Reject .git as ANY segment, case-insensitively: Android shared storage is
  # case-insensitive, so ".GIT/config" would resolve to the real .git/config.
  local lower
  lower="$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    .git|.git/*|*/.git|*/.git/*) return 1 ;;
  esac
  printf '%s' "$p" | LC_ALL=C grep -q '[[:cntrl:]]' && return 1
  return 0
}

# ---- result writing ----------------------------------------------------------

# ---- large-payload-safe JSON building ---------------------------------------
# A single execve() argument is limited to 128 KB on Linux, so big git output
# (status of a large vault, sparse lists, diffs, file contents) must NOT be
# passed via --arg. We stage each field in a temp file and use jq --rawfile.

NGB_FIELD_MAX_BYTES="${NGB_FIELD_MAX_BYTES:-4194304}"
JSON_TMPDIR=""

json_tmpdir() {
  [ -n "$JSON_TMPDIR" ] || JSON_TMPDIR="$(mktemp -d)"
  printf '%s' "$JSON_TMPDIR"
}

json_cleanup() { [ -n "$JSON_TMPDIR" ] && rm -rf "$JSON_TMPDIR"; JSON_TMPDIR=""; }

# obj_from_fields name1 value1 name2 value2 ... -> JSON object on stdout
obj_from_fields() {
  local dir; dir="$(json_tmpdir)"
  local -a args=()
  local filter="{" first=1 name value f i=0
  while [ "$#" -ge 2 ]; do
    name="$1"; value="$2"; shift 2
    i=$((i + 1))
    f="$dir/f$i"
    printf '%s' "$value" > "$f"
    if [ "$(wc -c < "$f")" -gt "$NGB_FIELD_MAX_BYTES" ]; then
      head -c "$NGB_FIELD_MAX_BYTES" "$f" > "$f.cut" && mv "$f.cut" "$f"
      printf '\n(truncated by runner)' >> "$f"
    fi
    args+=(--rawfile "v$i" "$f")
    [ "$first" = 1 ] || filter="$filter,"
    first=0
    filter="$filter\"$name\":\$v$i"
  done
  filter="$filter}"
  jq -n "${args[@]}" "$filter"
}

write_result() {
  # $1 id, $2 action, $3 ok(true/false), $4 exitCode, $5 dataJson, $6 errorJson, $7 startedAt
  local id="$1" action="$2" ok="$3" ec="$4" data="$5" err="$6" started="$7"
  mkdir -p "$RES_DIR" 2>/dev/null || true
  local tmp="$RES_DIR/$id.json.tmp"
  local dir; dir="$(json_tmpdir)"
  [ -n "$data" ] || data='null'
  [ -n "$err" ] || err='null'
  printf '%s' "$data" > "$dir/data.json"
  printf '%s' "$err"  > "$dir/error.json"
  jq -n \
    --arg id "$id" \
    --arg action "$action" \
    --argjson ok "$ok" \
    --argjson exitCode "$ec" \
    --arg startedAt "$started" \
    --arg finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson runnerVersion "$RUNNER_VERSION" \
    --arg profileId "$PROFILE_ID" \
    --slurpfile data "$dir/data.json" \
    --slurpfile error "$dir/error.json" \
    '{protocolVersion:1,id:$id,action:$action,ok:$ok,exitCode:$exitCode,
      startedAt:$startedAt,finishedAt:$finishedAt,runnerVersion:$runnerVersion,
      profileId:$profileId,
      data:($data[0] // null),error:($error[0] // null)}' > "$tmp" 2>>"$LOG_FILE"
  if [ ! -s "$tmp" ]; then
    # Last-resort minimal result: the plugin must never be left hanging.
    log "ERROR building result for $id (falling back to minimal result)"
    printf '{"protocolVersion":1,"id":"%s","action":"%s","ok":false,"exitCode":1,"error":{"code":"RUNNER_INTERNAL","message":"The runner could not serialize the result (see runner.log)."},"data":null}\n' \
      "$id" "$action" > "$tmp"
  fi
  mv "$tmp" "$RES_DIR/$id.json"
}

# ---- profile store -----------------------------------------------------------
# One file per paired vault: profiles/<id>.conf, mode 600, KEY="value" lines.
# One file per profile (rather than one file with repeated keys) keeps writes
# atomic, removal trivial, and a corrupt profile from taking the others down.
#
# Profile files are PARSED, never sourced: a damaged (or tampered) file must not
# be able to execute anything, and unknown keys are ignored instead of leaking
# into the runner's environment.

new_profile_id() { printf 'p-%s' "$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"; }
new_token()      { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

read_kv_file() { # $1 file -> P_FORMAT P_ID P_REPO P_RUNTIME P_TOKEN
  P_FORMAT=""; P_ID=""; P_REPO=""; P_RUNTIME=""; P_TOKEN=""
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    [ "$key" = "$line" ] && continue
    val="${line#*=}"
    case "$val" in '"'*'"') val="${val#\"}"; val="${val%\"}" ;; esac
    case "$key" in
      NGB_PROFILE_FORMAT) P_FORMAT="$val" ;;
      NGB_PROFILE_ID)     P_ID="$val" ;;
      NGB_REPO_DIR)       P_REPO="$val" ;;
      NGB_RUNTIME_DIR)    P_RUNTIME="$val" ;;
      NGB_TOKEN)          P_TOKEN="$val" ;;
    esac
  done < "$1"
}

read_profile_file() { # $1 file -> validated P_* ; 1 = unusable
  read_kv_file "$1" || return 1
  [ "$P_FORMAT" = "$PROFILE_FORMAT" ] || {
    log "PROFILE ignoring $(basename "$1"): unsupported format '$P_FORMAT'"; return 1; }
  valid_profile_id "$P_ID" || { log "PROFILE ignoring $(basename "$1"): invalid id"; return 1; }
  [ "$P_ID.conf" = "$(basename "$1")" ] || {
    log "PROFILE ignoring $(basename "$1"): id does not match the file name"; return 1; }
  valid_token "$P_TOKEN" || { log "PROFILE ignoring $P_ID: invalid token"; return 1; }
  valid_abs_path "$P_REPO" || { log "PROFILE ignoring $P_ID: invalid repo dir"; return 1; }
  [ -n "$P_RUNTIME" ] || P_RUNTIME="$P_REPO/.obsidian/plugins/native-git-bridge/runtime"
  valid_abs_path "$P_RUNTIME" || { log "PROFILE ignoring $P_ID: invalid runtime dir"; return 1; }
  return 0
}

write_profile_file() { # $1 id, $2 repo, $3 runtime, $4 token
  local f="$PROFILES_DIR/$1.conf" tmp="$PROFILES_DIR/.$1.conf.tmp"
  valid_profile_id "$1" && valid_abs_path "$2" && valid_abs_path "$3" && valid_token "$4" || {
    log "PROFILE refusing to write an invalid profile ($1)"; return 1; }
  {
    printf 'NGB_PROFILE_FORMAT=%s\n' "$PROFILE_FORMAT"
    printf 'NGB_PROFILE_ID="%s"\n' "$1"
    printf 'NGB_REPO_DIR="%s"\n' "$2"
    printf 'NGB_RUNTIME_DIR="%s"\n' "$3"
    printf 'NGB_TOKEN="%s"\n' "$4"
  } > "$tmp" || return 1
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" "$f"
}

list_profile_files() {
  local f
  shopt -s nullglob
  for f in "$PROFILES_DIR"/*.conf; do printf '%s\n' "$f"; done
}

default_runtime_for() { printf '%s/.obsidian/plugins/native-git-bridge/runtime' "$1"; }

# An existing single-repo config is migrated ONCE, keeping its token, so a
# current installation keeps working without re-pairing. The old file is kept
# as config.legacy for reference (and so migration cannot run twice).
migrate_legacy_config() {
  [ -z "$(list_profile_files)" ] || return 0
  [ -f "$NGB_CONFIG" ] || return 0
  read_kv_file "$NGB_CONFIG"
  if ! valid_abs_path "${P_REPO:-}" || ! valid_token "${P_TOKEN:-}"; then
    log "MIGRATE legacy config found but unusable (repo dir or token missing)"
    return 0
  fi
  local id runtime
  id="$(new_profile_id)"
  runtime="${P_RUNTIME:-$(default_runtime_for "$P_REPO")}"
  if write_profile_file "$id" "$P_REPO" "$runtime" "$P_TOKEN"; then
    mv "$NGB_CONFIG" "$NGB_CONFIG.legacy" 2>/dev/null || true
    log "MIGRATE legacy config -> profile $id (token preserved, repo $P_REPO)"
  fi
}

profile_file_for_repo() { # $1 absolute repo dir -> prints conf path, empty if none
  local f real target
  target="$(realpath "$1" 2>/dev/null || printf '%s' "$1")"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    read_profile_file "$f" || continue
    real="$(realpath "$P_REPO" 2>/dev/null || printf '%s' "$P_REPO")"
    if [ "$real" = "$target" ]; then printf '%s' "$f"; return 0; fi
  done < <(list_profile_files)
  return 1
}

# ---- profile activation ------------------------------------------------------

# Pin git to THIS profile's repository. cwd alone is not enough once two
# profiles nest (a vault inside another vault's repository): if the inner .git
# ever disappears, plain discovery would silently walk up and operate on the
# OUTER repository. The ceiling stops discovery at the repository's own parent,
# and the toplevel comparison proves which repository answered.
pin_git_to_repo() {
  export GIT_CEILING_DIRECTORIES="$(dirname "$NGB_REPO_DIR")"
  export GIT_DISCOVERY_ACROSS_FILESYSTEM=0
}

# A profile is in one of three states:
#   ready      - a git work tree of its own; every action is allowed
#   bootstrap  - the directory is there but holds no repository of its own yet;
#                only the actions that CREATE one are allowed (v11)
#   unusable   - the directory is gone, unreadable, or git refuses it
# The middle state exists because a vault can be paired before it is a
# repository: "make this vault a repository" has to be answerable through the
# same protocol as everything else.
PROFILE_STATE="unusable"
PROFILE_UNHEALTHY_REASON=""
repo_is_usable() {
  PROFILE_STATE="unusable"
  PROFILE_UNHEALTHY_REASON=""
  if [ ! -d "$NGB_REPO_DIR" ]; then
    PROFILE_UNHEALTHY_REASON="The repository directory no longer exists ($NGB_REPO_DIR)."
    return 1
  fi
  cd "$NGB_REPO_DIR" 2>/dev/null || {
    PROFILE_UNHEALTHY_REASON="The repository directory is not accessible ($NGB_REPO_DIR)."
    return 1; }
  pin_git_to_repo
  local top err
  err="$(git rev-parse --show-toplevel 2>&1 >/dev/null)"
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$top" ] || [ "$(realpath "$top" 2>/dev/null || printf '%s' "$top")" != \
       "$(realpath "$NGB_REPO_DIR" 2>/dev/null || printf '%s' "$NGB_REPO_DIR")" ]; then
    # No repository of its own. Either it never had one (bootstrap) or it lost
    # it while sitting inside another repository — and the ceiling above makes
    # both look the same, which is what keeps a nested pair apart: git here can
    # never resolve to the repository above.
    case "$err" in
      *"dubious ownership"*)
        PROFILE_UNHEALTHY_REASON="Git refuses the repository (dubious ownership). In Termux run: git config --global --add safe.directory \"$NGB_REPO_DIR\""
        return 1 ;;
    esac
    PROFILE_STATE="bootstrap"
    PROFILE_UNHEALTHY_REASON="$NGB_REPO_DIR is not a git repository of its own yet."
    return 0
  fi
  PROFILE_STATE="ready"
  return 0
}

# Actions allowed while a profile is in the bootstrap state. Everything else
# needs a repository and is answered with REPO_MISSING.
bootstrap_action_allowed() {
  case "$1" in
    ping|diagnostics|init-repo|clone-into-vault) return 0 ;;
    *) return 1 ;;
  esac
}

activate_profile() { # $1 conf file -> 0 usable, 1 skip (PROFILE_UNHEALTHY_REASON set)
  # Clear first: a failed activation must never leave the PREVIOUS profile's
  # directories in place, or a broken profile would answer its neighbour's queue.
  PROFILE_ID=""; PROFILE_FILE=""; NGB_REPO_DIR=""; NGB_TOKEN=""; NGB_RUNTIME_DIR=""
  REQ_DIR=""; PROC_DIR=""; RES_DIR=""; CAN_DIR=""; DONE_DIR=""
  LOG_FILE="$NGB_CONFIG_DIR/runner.log"
  read_profile_file "$1" || { PROFILE_UNHEALTHY_REASON="Unusable profile file."; return 1; }
  PROFILE_FILE="$1"
  PROFILE_ID="$P_ID"
  NGB_REPO_DIR="$P_REPO"
  NGB_TOKEN="$P_TOKEN"
  NGB_RUNTIME_DIR="$P_RUNTIME"
  REQ_DIR="$NGB_RUNTIME_DIR/requests"
  PROC_DIR="$NGB_RUNTIME_DIR/processing"
  RES_DIR="$NGB_RUNTIME_DIR/results"
  CAN_DIR="$NGB_RUNTIME_DIR/cancel"
  DONE_DIR="$NGB_RUNTIME_DIR/done"
  if [ -d "$NGB_RUNTIME_DIR" ] || mkdir -p "$NGB_RUNTIME_DIR" 2>/dev/null; then
    LOG_FILE="$NGB_RUNTIME_DIR/runner.log"
    mkdir -p "$REQ_DIR" "$RES_DIR" "$CAN_DIR" "$DONE_DIR" "$PROC_DIR" 2>/dev/null || true
  else
    LOG_FILE="$NGB_CONFIG_DIR/runner.log"
  fi
  repo_is_usable || return 1
  write_profile_marker
  return 0
}

# A marker inside the runtime directory ties a vault to its profile. It is how
# a MOVED repository is recognized again (the profile id travels with the vault,
# the absolute path does not) and it lives in the runtime dir, which is excluded
# from git, so it is never synced to another device.
write_profile_marker() {
  local f="$NGB_RUNTIME_DIR/profile.json" want
  want="$(printf '{"profileId":"%s","repoDir":"%s"}' "$PROFILE_ID" "$NGB_REPO_DIR")"
  [ "$(cat "$f" 2>/dev/null || true)" = "$want" ] && return 0
  printf '%s\n' "$want" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" 2>/dev/null || true
}

# ---- nested vaults -------------------------------------------------------------
# A vault opened inside another vault's repository (Main/ and
# Main/Projects/ABCproject/) is TWO repositories. Without help the outer one
# reports the inner working tree as an untracked directory and would happily
# record it as a gitlink.
#
# The inner repository is excluded from the outer one through the outer repo's
# .git/info/exclude, matching how the runtime directory is handled: device-local
# (this device has both vaults, other devices may not), never synced, and it
# never touches a tracked file. .gitignore was rejected because it is synced and
# would hide the folder for every collaborator; a submodule was rejected because
# it rewrites the outer repository's history and the project supports none.
ensure_nested_exclusion() { # $1 outer repo dir, $2 inner repo dir
  local rel line xf
  rel="${2#"$1"/}"
  [ "$rel" = "$2" ] && return 0
  line="/$rel/"
  xf="$(git -C "$1" rev-parse --git-path info/exclude 2>/dev/null || true)"
  [ -n "$xf" ] || return 0
  case "$xf" in /*) : ;; *) xf="$1/$xf" ;; esac
  mkdir -p "$(dirname "$xf")" 2>/dev/null || return 0
  grep -qxF "$line" "$xf" 2>/dev/null && return 0
  ensure_trailing_newline "$xf"
  printf '%s\n' "$line" >> "$xf" || return 0
  log "NESTED excluded $line from the outer repository $1 (.git/info/exclude, local only)"
}

# ---- discovery: relocation and adoption ----------------------------------------
# Both need to find vaults on shared storage. The scan is only run when there is
# nothing else to do (an idle trigger) or when a profile's repository is missing,
# so a normal operation never pays for it.

# Note the plain "-": an explicitly EMPTY value disables the scan (the
# installer uses that so its migration run cannot walk shared storage).
NGB_SCAN_ROOTS="${NGB_SCAN_ROOTS-/storage/emulated/0 $HOME/storage/shared /sdcard}"
NGB_SCAN_MAXDEPTH="${NGB_SCAN_MAXDEPTH:-9}"
NGB_CLAIM_MAX_AGE="${NGB_CLAIM_MAX_AGE:-900}"

scan_runtime_files() { # prints runtime marker/claim files found under the scan roots
  local r
  for r in $NGB_SCAN_ROOTS; do
    [ -d "$r" ] || continue
    find "$r" -maxdepth "$NGB_SCAN_MAXDEPTH" -type f \
      \( -name profile.json -o -name claim.json \) \
      -path '*/plugins/native-git-bridge/runtime/*' 2>/dev/null
  done | sort -u
}

vault_dir_of_runtime_file() { # $1 .../<config>/plugins/native-git-bridge/runtime/<file>
  local d; d="$(dirname "$1")"          # runtime
  d="$(dirname "$d")"                    # native-git-bridge
  d="$(dirname "$d")"                    # plugins
  d="$(dirname "$d")"                    # .obsidian (config dir)
  dirname "$d"                           # vault root
}

dir_is_own_worktree() { # $1 dir
  [ -d "$1" ] || return 1
  local top
  top="$(GIT_CEILING_DIRECTORIES="$(dirname "$1")" git -C "$1" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$top" ] || return 1
  [ "$(realpath "$top" 2>/dev/null)" = "$(realpath "$1" 2>/dev/null)" ]
}

# A repository that moved keeps its profile: the marker in the runtime directory
# carries the profile id, so the new location can be adopted without re-pairing.
# A profile whose marker is nowhere to be found is treated as deleted; no
# replacement repository is ever linked to it automatically.
relocate_profiles() { # $1..$n = marker files
  local mf vault id conf
  for mf in "$@"; do
    case "$mf" in */profile.json) : ;; *) continue ;; esac
    id="$(jq -r '.profileId // empty' "$mf" 2>/dev/null || true)"
    valid_profile_id "$id" || continue
    conf="$PROFILES_DIR/$id.conf"
    [ -f "$conf" ] || continue
    read_profile_file "$conf" || continue
    vault="$(vault_dir_of_runtime_file "$mf")"
    [ "$(realpath "$vault" 2>/dev/null)" = "$(realpath "$P_REPO" 2>/dev/null)" ] && continue
    # Only relocate when the recorded location is really gone: two markers with
    # the same id (a copied vault) must not make the profile bounce.
    dir_is_own_worktree "$P_REPO" && continue
    dir_is_own_worktree "$vault" || continue
    if write_profile_file "$id" "$vault" "$(default_runtime_for "$vault")" "$P_TOKEN"; then
      log "RELOCATED profile $id: $P_REPO -> $vault (token kept)"
    fi
  done
}

# A vault that has no profile yet asks for one by writing runtime/claim.json.
# The token is generated HERE, in Termux: nothing a claim file contains is
# trusted, so a stray file can at most cause an empty profile for a repository
# the user already opened as a vault on this device.
adopt_claims() { # $1..$n = marker files
  local cf vault created age now id token runtime
  for cf in "$@"; do
    case "$cf" in */claim.json) : ;; *) continue ;; esac
    vault="$(vault_dir_of_runtime_file "$cf")"
    created="$(jq -r '.createdAt // empty' "$cf" 2>/dev/null || true)"
    now="$(date -u +%s)"
    if [ -n "$created" ] && age="$(date -u -d "$created" +%s 2>/dev/null)"; then
      if [ $((now - age)) -gt "$NGB_CLAIM_MAX_AGE" ]; then
        log "CLAIM ignoring a stale pairing request in $vault"
        rm -f "$cf" 2>/dev/null || true
        continue
      fi
    fi
    if profile_file_for_repo "$vault" >/dev/null; then
      rm -f "$cf" 2>/dev/null || true
      continue
    fi
    # Normally a claim is only honoured for a directory that is already a git
    # work tree. A vault that asks to be BOOTSTRAPPED has none yet by
    # definition, so it may pair without one — the claim file's own location
    # proves it is an Obsidian vault (it lies in this plugin's runtime folder),
    # and until a repository exists the profile can answer nothing but the two
    # actions that create one.
    if ! dir_is_own_worktree "$vault"; then
      if [ "$(jq -r '.bootstrap // false' "$cf" 2>/dev/null || echo false)" != "true" ]; then
        log "CLAIM $vault is not a git repository of its own; not pairing it"
        continue
      fi
      if [ ! -d "$vault" ] || [ ! -w "$vault" ]; then
        log "CLAIM $vault is not a writable directory; not pairing it"
        continue
      fi
      log "CLAIM $vault has no repository yet; pairing it for bootstrap"
    fi
    id="$(new_profile_id)"
    token="$(new_token)"
    runtime="$(default_runtime_for "$vault")"
    write_profile_file "$id" "$vault" "$runtime" "$token" || continue
    mkdir -p "$runtime" 2>/dev/null || true
    printf '{"token":"%s","repoPath":"%s","profileId":"%s","createdAt":"%s"}\n' \
      "$token" "$vault" "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$runtime/pairing.json.tmp" &&
      mv "$runtime/pairing.json.tmp" "$runtime/pairing.json"
    printf '{"profileId":"%s","repoDir":"%s"}\n' "$id" "$vault" > "$runtime/profile.json" 2>/dev/null || true
    rm -f "$cf" 2>/dev/null || true
    log "ADOPTED $vault as profile $id (new token; pairing file written)"
  done
}

err_json() {
  # $1 code, $2 message, $3 stdout, $4 stderr  (payloads may be large)
  obj_from_fields code "$1" message "$2" stdout "${3:-}" stderr "${4:-}"
}

# ---- git capture -------------------------------------------------------------

GIT_OUT=""; GIT_ERR=""; GIT_EC=0
run_git() {
  # Runs git with argv array; captures stdout/stderr; never through a shell string.
  local out_f err_f
  out_f="$(mktemp)"; err_f="$(mktemp)"
  git "$@" > "$out_f" 2> "$err_f"
  GIT_EC=$?
  GIT_OUT="$(cat "$out_f")"
  GIT_ERR="$(cat "$err_f" | redact_url)"
  rm -f "$out_f" "$err_f"
  return $GIT_EC
}

# ---- protected-path safety (defense in depth for future mutating actions) ----

sparse_safety_raw() {
  # $@ = protected paths; sets SAFE_STATUS and SAFE_STAGED
  SAFE_STATUS=""; SAFE_STAGED=""
  [ $# -eq 0 ] && return 0
  # -uall: git collapses a fully untracked directory into a single "dir/" line.
  # For the gate that makes no difference (any output blocks), but the plugin
  # offers "move these files to the trash" from exactly this list, and one
  # collapsed line meant one entry was deleted while the rest stayed behind.
  # The pathspec is limited to the protected paths, so this lists what is new
  # THERE and nothing else.
  run_git status --porcelain=v1 -uall -- "$@" || true
  SAFE_STATUS="$GIT_OUT"
  run_git diff --cached --name-status -- "$@" || true
  SAFE_STAGED="$GIT_OUT"
}

# ---- actions -----------------------------------------------------------------

action_ping() {
  DATA=$(obj_from_fields pong "pong" runnerVersion "$RUNNER_VERSION" profileId "$PROFILE_ID")
}

# Files hidden inside fully untracked directories: git status collapses such a
# directory to a single "dir/" entry, so the plugin could not show (or act on)
# the notes inside a freshly created folder. Enumerate them here, in the same
# result — a second Termux round trip per folder would be far too expensive.
# Everything runs -z (NUL-separated, never quoted, immune to core.quotePath),
# then joins with newlines: vault file names cannot contain newlines (both the
# plugin's path validation and this runner reject control characters).
collect_untracked_children() {
  UNTRACKED_CHILDREN=""
  local dirs=() d
  while IFS= read -r -d '' d; do
    case "$d" in */) dirs+=("$d") ;; esac
  done < <(git ls-files --others --exclude-standard --directory --no-empty-directory -z 2>/dev/null || true)
  [ "${#dirs[@]}" -eq 0 ] && return 0
  UNTRACKED_CHILDREN="$(git ls-files --others --exclude-standard -z -- "${dirs[@]}" 2>/dev/null | tr '\0' '\n')"
}

collect_status_fields() {
  run_git status --porcelain=v2 --branch || true; local branch_info="$GIT_OUT"
  local sparse_enabled sparse_cone sparse_list skip_count last_commit remote_url
  # During a merge, expose git's own prepared MERGE_MSG ("Merge branch … \n\n
  # # Conflicts: …") so the plugin can prefill the commit modal after a manual
  # resolution and auto-use it for sync.
  local merge_active=false merge_msg=""
  if [ -e "$(git rev-parse --git-path MERGE_HEAD)" ]; then
    merge_active=true
    merge_msg="$(cat "$(git rev-parse --git-path MERGE_MSG)" 2>/dev/null || true)"
  fi
  # An unfinished rebase looks nothing like an unfinished merge: there is no
  # MERGE_HEAD, only a state DIRECTORY, and which of the two it is depends on
  # the backend git chose (rebase-merge for the interactive/merge backend,
  # rebase-apply for the older am backend). Reported so the panel can offer the
  # way out; nothing here starts a rebase.
  local rebase_active=false
  if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
    rebase_active=true
  fi
  sparse_enabled="$(git config --get core.sparseCheckout 2>/dev/null || true)"
  sparse_cone="$(git config --get core.sparseCheckoutCone 2>/dev/null || true)"
  sparse_list="$(git sparse-checkout list 2>/dev/null || true)"
  # Only the COUNT is needed by the plugin; the full list can be megabytes.
  skip_count="$(git ls-files -v 2>/dev/null | grep -c '^S ' || true)"
  last_commit="$(git log -1 --format='%H%x09%cI%x09%s' 2>/dev/null || true)"
  remote_url="$(git remote get-url origin 2>/dev/null | redact_url || true)"
  collect_untracked_children
  DATA=$(obj_from_fields \
    branchInfo "$branch_info" \
    sparseEnabled "$sparse_enabled" \
    sparseCone "$sparse_cone" \
    sparseList "$sparse_list" \
    skipWorktreeCount "$skip_count" \
    lastCommit "$last_commit" \
    remoteUrl "$remote_url" \
    untrackedChildren "$UNTRACKED_CHILDREN" \
    mergeInProgress "$merge_active" \
    mergeMsg "$merge_msg" \
    rebaseInProgress "$rebase_active")
}

action_status() { collect_status_fields; }

action_verify_sparse_safety() {
  # protected paths from args.protectedPaths (validated)
  local req_file="$1"
  mapfile -t ppaths < <(jq -r '.args.protectedPaths[]? // empty' "$req_file")
  if [ "${#ppaths[@]}" -eq 0 ]; then
    ERROR=$(err_json "BAD_REQUEST" "No protectedPaths provided." "" ""); return 1
  fi
  local p
  for p in "${ppaths[@]}"; do
    if ! valid_rel_path "$p"; then
      ERROR=$(err_json "BAD_REQUEST" "Invalid protected path (must be repo-relative, no .., no absolute paths)." "" "")
      return 1
    fi
  done
  sparse_safety_raw "${ppaths[@]}"
  local plist; plist=$(printf '%s\n' "${ppaths[@]}")
  DATA=$(obj_from_fields statusProtected "$SAFE_STATUS" stagedProtected "$SAFE_STAGED" protectedPaths "$plist")
}

action_sparse_reapply() {
  local enabled
  enabled="$(git config --get core.sparseCheckout 2>/dev/null || true)"
  if [ "$enabled" != "true" ]; then
    ERROR=$(err_json "GIT_FAILED" "core.sparseCheckout is not enabled in this repository." "" "")
    return 1
  fi
  if ! run_git sparse-checkout reapply; then
    ERROR=$(err_json "GIT_FAILED" "git sparse-checkout reapply failed." "$GIT_OUT" "$GIT_ERR")
    return 1
  fi
  local reapply_out="$GIT_OUT"
  local sparse_list; sparse_list="$(git sparse-checkout list 2>/dev/null || true)"
  DATA=$(obj_from_fields reapplyOutput "$reapply_out" sparseList "$sparse_list")
}

action_diagnostics() {
  local git_version jq_version repo_root inside sparse_enabled sparse_cone cone_patterns skip_count remote_url safe_dir
  git_version="$(git --version 2>/dev/null || echo unknown)"
  jq_version="$(jq --version 2>/dev/null || echo unknown)"
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo unknown)"
  inside="$(git rev-parse --is-inside-work-tree 2>/dev/null || echo false)"
  sparse_enabled="$(git config --get core.sparseCheckout 2>/dev/null || true)"
  sparse_cone="$(git config --get core.sparseCheckoutCone 2>/dev/null || true)"
  cone_patterns="$(git sparse-checkout list 2>/dev/null | wc -l | tr -d ' ')"
  skip_count="$(git ls-files -v 2>/dev/null | grep -c '^S ' || true)"
  remote_url="$(git remote get-url origin 2>/dev/null | redact_url || true)"
  safe_dir="$(git config --global --get-all safe.directory 2>/dev/null | tr '\n' ' ' || true)"
  local raw_url auth_method cred_helper
  raw_url="$(git remote get-url origin 2>/dev/null || true)"
  cred_helper="$(git config --get credential.helper 2>/dev/null || git config --global --get credential.helper 2>/dev/null || true)"
  case "$raw_url" in
    https://*@*) auth_method="https (credentials embedded in URL - consider credential.helper store)" ;;
    https://*)   auth_method="https (PAT via credential helper: ${cred_helper:-NOT CONFIGURED})" ;;
    git@*|ssh://*) auth_method="ssh" ;;
    "")          auth_method="no remote" ;;
    *)           auth_method="other" ;;
  esac
  DATA=$(obj_from_fields \
    gitVersion "$git_version" \
    jqVersion "$jq_version" \
    repoRoot "$repo_root" \
    insideWorkTree "$inside" \
    sparseEnabled "$sparse_enabled" \
    sparseCone "$sparse_cone" \
    sparsePatternCount "$cone_patterns" \
    skipWorktreeCount "$skip_count" \
    remoteUrl "$remote_url" \
    safeDirectory "$safe_dir" \
    authMethod "$auth_method" \
    runtimeDir "$NGB_RUNTIME_DIR" \
    profileId "$PROFILE_ID" \
    profileState "$PROFILE_STATE" \
    profileCount "$(list_profile_files | grep -c . || true)" \
    runnerVersion "$RUNNER_VERSION")
}


# ---- phase 3 helpers ----------------------------------------------------------

NGB_NET_TIMEOUT="${NGB_NET_TIMEOUT:-120}"
# Seconds past createdAt+timeoutSeconds before a queued request is expired
# instead of executed (covers a manual recovery run of the runner).
NGB_EXPIRY_GRACE="${NGB_EXPIRY_GRACE:-600}"

run_git_net() {
  # Network git commands wrapped in a hard timeout so a dead link cannot hang the runner.
  local out_f err_f
  out_f="$(mktemp)"; err_f="$(mktemp)"
  timeout -k 5 "$NGB_NET_TIMEOUT" git "$@" > "$out_f" 2> "$err_f"
  GIT_EC=$?
  GIT_OUT="$(cat "$out_f")"
  GIT_ERR="$(cat "$err_f" | redact_url)"
  rm -f "$out_f" "$err_f"
  [ $GIT_EC -eq 124 ] && GIT_ERR="$GIT_ERR
(timed out after ${NGB_NET_TIMEOUT}s)"
  return $GIT_EC
}

merge_data() { # $1 jsonA, $2 jsonB -> stdout merged (file-based: payloads can be large)
  local dir; dir="$(json_tmpdir)"
  printf '%s' "${1:-null}" > "$dir/a.json"
  printf '%s' "${2:-null}" > "$dir/b.json"
  jq -n --slurpfile a "$dir/a.json" --slurpfile b "$dir/b.json" \
    '(($a[0] // {}) * ($b[0] // {}))'
}

# Read args.protectedPaths into PPATHS (validated). Empty array is allowed.
read_protected_paths() {
  local req_file="$1"
  PPATHS=()
  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if ! valid_rel_path "$p"; then
      ERROR=$(err_json "BAD_REQUEST" "Invalid protected path in request." "" "")
      return 1
    fi
    PPATHS+=("$p")
  done < <(jq -r '.args.protectedPaths[]? // empty' "$req_file")
  return 0
}

conflicted_files() { git diff --name-only --diff-filter=U 2>/dev/null || true; }

merge_in_progress() { [ -e "$(git rev-parse --git-path MERGE_HEAD)" ]; }
rebase_in_progress() {
  [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]
}

# Mandatory gate before commit/push/sync. Sets ERROR (SAFETY_BLOCKED) on violation.
# Sparse-checkout omissions never appear here: git status only reports real
# worktree/index changes, and skip-worktree entries are silent by design.
safety_gate() {
  [ "${#PPATHS[@]}" -eq 0 ] && return 0
  sparse_safety_raw "${PPATHS[@]}"
  if [ -n "$SAFE_STATUS" ] || [ -n "$SAFE_STAGED" ]; then
    DATA=$(obj_from_fields statusProtected "$SAFE_STATUS" stagedProtected "$SAFE_STAGED")
    ERROR=$(err_json "SAFETY_BLOCKED" \
      "Sparse checkout safety check failed. The excluded directories appear as Git changes. No commit or push was performed." \
      "$SAFE_STATUS" "$SAFE_STAGED")
    return 1
  fi
  return 0
}

# Stage everything EXCEPT protected paths (pathspec excludes: protected paths
# can never be staged by the bridge, so they can never be committed as deletions).
stage_all_except_protected() {
  local specs=(".")
  local p
  for p in "${PPATHS[@]}"; do
    specs+=(":(exclude)$p")
  done
  run_git add -A -- "${specs[@]}"
}

require_identity() {
  if [ -z "$(git config --get user.email 2>/dev/null)" ] || [ -z "$(git config --get user.name 2>/dev/null)" ]; then
    ERROR=$(err_json "GIT_FAILED" "git user.name / user.email are not configured in Termux. Run: git config --global user.name '...' && git config --global user.email '...'" "" "")
    return 1
  fi
  return 0
}

# ---- phase 3 actions ----------------------------------------------------------

action_fetch() {
  if ! run_git_net fetch --prune; then
    ERROR=$(err_json "GIT_FAILED" "git fetch failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  local fetch_out="$GIT_OUT"
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields fetchOutput "$fetch_out")")
}

action_pull() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  if merge_in_progress; then
    ERROR=$(err_json "CONFLICT" "A merge is already in progress. Resolve or abort it first." "" "")
    DATA=$(obj_from_fields conflicts "$(conflicted_files)")
    return 1
  fi
  if ! run_git_net pull --no-rebase --no-edit; then
    local pull_out="$GIT_OUT" pull_err="$GIT_ERR"
    local conf; conf="$(conflicted_files)"
    if [ -n "$conf" ]; then
      DATA=$(obj_from_fields conflicts "$conf" pullOutput "$pull_out")
      ERROR=$(err_json "CONFLICT" "Pull produced merge conflicts. Sync stopped; nothing was pushed." "$pull_out" "$pull_err")
    else
      ERROR=$(err_json "GIT_FAILED" "git pull failed." "$pull_out" "$pull_err")
    fi
    return 1
  fi
  local pull_out="$GIT_OUT"
  # Post-merge safety: a merge must never have materialized changes to protected paths.
  if ! safety_gate; then return 1; fi
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields pullOutput "$pull_out")")
}

action_commit() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  require_identity || return 1
  local msg; msg=$(jq -r '.args.message // empty' "$req_file")
  if [ -z "$msg" ] || [ "${#msg}" -gt 1000 ]; then
    ERROR=$(err_json "BAD_REQUEST" "Commit message missing or longer than 1000 characters." "" ""); return 1
  fi
  safety_gate || return 1
  if ! stage_all_except_protected; then
    ERROR=$(err_json "GIT_FAILED" "git add failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  # Defense in depth: re-check the index AFTER staging.
  safety_gate || return 1
  local committed=false new_head="" commit_out=""
  if ! git diff --cached --quiet 2>/dev/null; then
    if ! run_git commit -m "$msg"; then
      ERROR=$(err_json "GIT_FAILED" "git commit failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
    committed=true
    commit_out="$GIT_OUT"
    new_head="$(git rev-parse HEAD 2>/dev/null || true)"
  fi
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields committed "$committed" newHead "$new_head" commitOutput "$commit_out")")
}

action_push() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  safety_gate || return 1
  local branch; branch="$(git symbolic-ref --short -q HEAD || true)"
  if [ -z "$branch" ]; then
    ERROR=$(err_json "GIT_FAILED" "Detached HEAD; refusing to push." "" ""); return 1
  fi
  if ! run_git_net push -u origin "$branch"; then
    ERROR=$(err_json "GIT_FAILED" "git push failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  local push_out="$GIT_OUT$GIT_ERR"
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields pushOutput "$push_out")")
}

action_sync() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  require_identity || return 1
  local msg; msg=$(jq -r '.args.message // empty' "$req_file")
  [ -z "$msg" ] && msg="vault sync (native git bridge)"
  [ "${#msg}" -gt 1000 ] && { ERROR=$(err_json "BAD_REQUEST" "Commit message too long." "" ""); return 1; }
  local steps="repo-verified"

  # 1-3. Verify + reapply sparse checkout when enabled (non-destructive).
  if [ "$(git config --get core.sparseCheckout 2>/dev/null || true)" = "true" ]; then
    if ! run_git sparse-checkout reapply; then
      ERROR=$(err_json "GIT_FAILED" "sparse-checkout reapply failed during sync." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
    steps="$steps,sparse-reapplied"
  fi

  # 4. Pre-flight safety: excluded paths must not be staged or changed.
  safety_gate || return 1
  steps="$steps,safety-preflight-ok"

  if merge_in_progress; then
    DATA=$(obj_from_fields conflicts "$(conflicted_files)" steps "$steps")
    ERROR=$(err_json "CONFLICT" "A merge is already in progress. Resolve or abort it first." "" "")
    return 1
  fi

  # 5. Fetch, then integrate if behind.
  if ! run_git_net fetch --prune; then
    ERROR=$(err_json "GIT_FAILED" "git fetch failed during sync." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  steps="$steps,fetched"
  local behind ahead counts
  counts="$(git rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null || echo '0 0')"
  behind="${counts%%[[:space:]]*}"; ahead="${counts##*[[:space:]]}"
  if [ "${behind:-0}" -gt 0 ]; then
    if ! run_git pull --no-rebase --no-edit; then
      local pull_out="$GIT_OUT" pull_err="$GIT_ERR"
      local conf; conf="$(conflicted_files)"
      if [ -n "$conf" ]; then
        DATA=$(obj_from_fields conflicts "$conf" steps "$steps" pullOutput "$pull_out")
        ERROR=$(err_json "CONFLICT" "Sync stopped: merge conflicts. Nothing was committed or pushed." "$pull_out" "$pull_err")
      else
        ERROR=$(err_json "GIT_FAILED" "git pull failed during sync." "$pull_out" "$pull_err")
      fi
      return 1
    fi
    steps="$steps,merged"
    # 6b. Post-merge safety.
    safety_gate || return 1
  fi

  # 7. Stage permitted changes only.
  if ! stage_all_except_protected; then
    ERROR=$(err_json "GIT_FAILED" "git add failed during sync." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  safety_gate || return 1
  steps="$steps,staged"

  # 8. Commit only when staged changes exist.
  local committed=false
  if ! git diff --cached --quiet 2>/dev/null; then
    if ! run_git commit -m "$msg"; then
      ERROR=$(err_json "GIT_FAILED" "git commit failed during sync." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
    committed=true
    steps="$steps,committed"
  fi

  # 9. Push when we have anything to publish.
  local pushed=false
  counts="$(git rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null || echo '0 0')"
  ahead="${counts##*[[:space:]]}"
  if [ "$committed" = true ] || [ "${ahead:-0}" -gt 0 ]; then
    local branch; branch="$(git symbolic-ref --short -q HEAD || true)"
    if [ -z "$branch" ]; then
      ERROR=$(err_json "GIT_FAILED" "Detached HEAD; refusing to push." "" ""); return 1
    fi
    if ! run_git_net push -u origin "$branch"; then
      ERROR=$(err_json "GIT_FAILED" "git push failed during sync (local commit kept)." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
    pushed=true
    steps="$steps,pushed"
  fi

  # 10. Structured result.
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields steps "$steps" committed "$committed" pushed "$pushed")")
}

# Whole-file conflict resolution (v6): the USER chose a side (per project rule
# the bridge never auto-picks ours/theirs). `git checkout --ours|--theirs`
# updates the worktree from the chosen index stage, then `git add` marks the
# path resolved — the standard completion of that choice.
action_resolve_conflict() {
  local req_file="$1"
  local path side p
  path=$(jq -r '.args.path // empty' "$req_file")
  side=$(jq -r '.args.side // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  case "$side" in
    ours|theirs) ;;
    *) ERROR=$(err_json BAD_REQUEST "Invalid side (must be 'ours' or 'theirs')." "" ""); return 1 ;;
  esac
  read_protected_paths "$req_file" || return 1
  for p in "${PPATHS[@]}"; do
    case "$path" in
      "$p"|"$p"/*)
        ERROR=$(err_json SAFETY_BLOCKED "Refusing to resolve inside a protected sparse path ($p)." "" "")
        return 1 ;;
    esac
  done
  if [ -z "$(git ls-files -u -- "$path" 2>/dev/null)" ]; then
    ERROR=$(err_json BAD_REQUEST "The file is not in a conflicted (unmerged) state." "" ""); return 1
  fi
  if ! run_git checkout "--$side" -- "$path"; then
    ERROR=$(err_json GIT_FAILED "git checkout --$side failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  if ! run_git add -- "$path"; then
    ERROR=$(err_json GIT_FAILED "git add (mark resolved) failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  collect_status_fields
}

action_abort_merge() {
  if ! merge_in_progress; then
    ERROR=$(err_json "BAD_REQUEST" "No merge in progress; nothing to abort." "" ""); return 1
  fi
  if ! run_git merge --abort; then
    ERROR=$(err_json "GIT_FAILED" "git merge --abort failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  collect_status_fields
}

# The two exits from an unfinished rebase. Nothing in this runner STARTS one:
# a rebase can only arrive here because it was started in Termux by hand, and
# before these existed the plugin could see that state but not leave it.
action_abort_rebase() {
  if ! rebase_in_progress; then
    ERROR=$(err_json "BAD_REQUEST" "No rebase in progress; nothing to abort." "" ""); return 1
  fi
  if ! run_git rebase --abort; then
    ERROR=$(err_json "GIT_FAILED" "git rebase --abort failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  collect_status_fields
}

# Continue is refused while anything is still unmerged, and the message says
# how many: `git rebase --continue` in that state opens an editor, and the
# runner runs with no terminal, so it would hang until the request expired.
action_continue_rebase() {
  if ! rebase_in_progress; then
    ERROR=$(err_json "BAD_REQUEST" "No rebase in progress; nothing to continue." "" ""); return 1
  fi
  local unmerged
  unmerged="$(git ls-files -u 2>/dev/null | cut -f2 | sort -u | grep -c . || true)"
  if [ "${unmerged:-0}" -gt 0 ]; then
    ERROR=$(err_json "CONFLICT" "$unmerged file(s) are still conflicted. Resolve them first, then continue." "" "")
    return 1
  fi
  # GIT_EDITOR=true: accept the message git already prepared, never prompt.
  if ! GIT_EDITOR=true run_git rebase --continue; then
    ERROR=$(err_json "GIT_FAILED" "git rebase --continue failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  collect_status_fields
}


# ---- phase 4 actions: history / diff / restore --------------------------------

NGB_MAX_SHOW_BYTES="${NGB_MAX_SHOW_BYTES:-1048576}"
# Default budget for one diff, in BYTES. The plugin sends its own value with
# every request (`args.maxBytes`); this is the fallback and the ceiling for a
# request that asks for more than the field cap can carry.
NGB_MAX_DIFF_BYTES="${NGB_MAX_DIFF_BYTES:-102400}"

# Keep WHOLE hunks of a unified diff, up to a byte budget.
#
# $1 = file holding the diff, $2 = budget in bytes.
# Sets DIFF_KEPT (path to the trimmed diff), DIFF_SHOWN, DIFF_TOTAL_HUNKS and
# DIFF_TOTAL_BYTES.
#
# LC_ALL=C is not decoration: awk's length() counts characters under a UTF-8
# locale, so the same budget meant 217 bytes in one environment and 155 in
# another. The cap this replaces had the same fault in bash (`${#s}`,
# `${s:0:n}`) and could additionally cut a multi-byte character in half, which
# jq then turned into a replacement character in the middle of the last line.
#
# Cutting between hunks removes that class of problem outright, and a partial
# hunk was never useful anyway: it cannot be staged, it cannot be applied, and
# it makes every reader of the diff tolerate a broken tail.
trim_diff_to_hunks() {
  local src="$1" limit="$2"
  DIFF_KEPT="$(dirname "$src")/diff.kept"
  local report
  report="$(LC_ALL=C awk -v LIMIT="$limit" '
    { allBytes += length($0) + 1 }
    /^@@/ { n++; size[n] = 0; text[n] = "" }
    {
      if (n == 0) { preamble = preamble $0 "\n"; preBytes += length($0) + 1 }
      else { text[n] = text[n] $0 "\n"; size[n] += length($0) + 1 }
    }
    END {
      printf "%s", preamble
      used = preBytes; shown = 0
      for (i = 1; i <= n; i++) {
        if (used + size[i] > LIMIT) break
        printf "%s", text[i]
        used += size[i]
        shown++
      }
      printf "%d %d %d", shown, n, allBytes > "/dev/stderr"
    }
  ' "$src" 2>&1 >"$DIFF_KEPT")"
  DIFF_SHOWN="${report%% *}"
  DIFF_TOTAL_HUNKS="$(printf '%s' "$report" | cut -d' ' -f2)"
  DIFF_TOTAL_BYTES="$(printf '%s' "$report" | cut -d' ' -f3)"
  : "${DIFF_SHOWN:=0}" "${DIFF_TOTAL_HUNKS:=0}" "${DIFF_TOTAL_BYTES:=0}"
}

# A single trailing ^ (first parent) is allowed so the plugin can diff a commit
# against its parent (history view). Still no ranges, no refs, no pathspecs.
valid_commitish() { printf '%s' "$1" | grep -Eq '^(HEAD|[0-9a-fA-F]{4,40})\^?$'; }

# git log --follow with rename tracking; fields separated by \x1f, records by \x1e,
# plus --name-status lines so the TS side knows the file's path AT each commit.
action_file_log() {
  local req_file="$1"
  local path limit skip
  path=$(jq -r '.args.path // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  limit=$(jq -r '.args.limit // 30' "$req_file")
  skip=$(jq -r '.args.skip // 0' "$req_file")
  printf '%s' "$limit" | grep -Eq '^[0-9]{1,3}$' || limit=30
  [ "$limit" -gt 100 ] && limit=100
  [ "$limit" -lt 1 ] && limit=1
  printf '%s' "$skip" | grep -Eq '^[0-9]{1,6}$' || skip=0
  # --raw AND --numstat together: the raw line carries the change letter (and
  # both paths of a rename), the numstat line the added/deleted counts, which
  # is what the file-history view shows per commit. Requesting only
  # --name-status loses the counts; only --numstat loses added-vs-modified.
  if ! run_git log --follow --raw --numstat --max-count="$limit" --skip="$skip" \
      --format='%x1e%H%x1f%cI%x1f%an%x1f%s' -- "$path"; then
    ERROR=$(err_json GIT_FAILED "git log failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  DATA=$(obj_from_fields log "$GIT_OUT" path "$path" limit "$limit" skip "$skip")
}

# Repository-wide log for the history panel: same record format as file-log
# (\x1e records, \x1f fields, --name-status block per commit) but across the
# whole repository and without --follow (rename tracking is per-path only).
action_repo_log() {
  local req_file="$1"
  local limit skip
  limit=$(jq -r '.args.limit // 30' "$req_file")
  skip=$(jq -r '.args.skip // 0' "$req_file")
  printf '%s' "$limit" | grep -Eq '^[0-9]{1,3}$' || limit=30
  [ "$limit" -gt 100 ] && limit=100
  [ "$limit" -lt 1 ] && limit=1
  printf '%s' "$skip" | grep -Eq '^[0-9]{1,6}$' || skip=0
  if ! run_git log --name-status --find-renames --max-count="$limit" --skip="$skip" \
      --format='%x1e%H%x1f%cI%x1f%an%x1f%s'; then
    ERROR=$(err_json GIT_FAILED "git log failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  DATA=$(obj_from_fields log "$GIT_OUT" limit "$limit" skip "$skip")
}

action_show_file_at_commit() {
  local req_file="$1"
  local path commit size content
  path=$(jq -r '.args.path // empty' "$req_file")
  commit=$(jq -r '.args.commit // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  valid_commitish "$commit" || { ERROR=$(err_json BAD_REQUEST "Invalid commit reference." "" ""); return 1; }
  if ! git cat-file -e "$commit:$path" 2>/dev/null; then
    ERROR=$(err_json FILE_ABSENT "The file does not exist at that commit." "" ""); return 1
  fi
  size=$(git cat-file -s "$commit:$path" 2>/dev/null || echo 0)
  if [ "$size" -gt "$NGB_MAX_SHOW_BYTES" ]; then
    ERROR=$(err_json TOO_LARGE "File is $size bytes at that commit (limit $NGB_MAX_SHOW_BYTES)." "" ""); return 1
  fi
  content=$(git show "$commit:$path" | base64 -w0) || {
    ERROR=$(err_json GIT_FAILED "git show failed." "" ""); return 1; }
  DATA=$(obj_from_fields contentBase64 "$content" size "$size" commit "$commit" path "$path")
}

action_diff_file() {
  local req_file="$1"
  local path from to truncated=false
  path=$(jq -r '.args.path // empty' "$req_file")
  from=$(jq -r '.args.from // empty' "$req_file")
  to=$(jq -r '.args.to // "WORKTREE"' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  # INDEX pseudo-refs: a STAGED row diffs HEAD → index (git diff --cached), an
  # UNSTAGED row diffs index → worktree (plain git diff). Both sides showing
  # HEAD → worktree made a stage-then-edit file look identical in both rows.
  if [ "$from" = "INDEX" ]; then
    [ "$to" = "WORKTREE" ] || { ERROR=$(err_json BAD_REQUEST "'from: INDEX' only diffs against WORKTREE." "" ""); return 1; }
    run_git diff --find-renames -- "$path" || true
  elif [ "$to" = "INDEX" ]; then
    valid_commitish "$from" || { ERROR=$(err_json BAD_REQUEST "Invalid 'from' commit." "" ""); return 1; }
    run_git diff --cached --find-renames "$from" -- "$path" || true
  elif [ "$to" = "WORKTREE" ]; then
    valid_commitish "$from" || { ERROR=$(err_json BAD_REQUEST "Invalid 'from' commit." "" ""); return 1; }
    run_git diff --find-renames "$from" -- "$path" || true
  else
    valid_commitish "$from" || { ERROR=$(err_json BAD_REQUEST "Invalid 'from' commit." "" ""); return 1; }
    valid_commitish "$to" || { ERROR=$(err_json BAD_REQUEST "Invalid 'to' commit." "" ""); return 1; }
    run_git diff --find-renames "$from" "$to" -- "$path" || true
  fi
  [ $GIT_EC -gt 1 ] && { ERROR=$(err_json GIT_FAILED "git diff failed." "$GIT_OUT" "$GIT_ERR"); return 1; }

  # Budget for THIS diff. The plugin sends its device-local setting, and may
  # send a larger one for a single request when the user asked to see a diff
  # that the setting would cut. Clamped to the field cap, past which the result
  # writer would truncate mid-line anyway and undo the point of hunk-aligned
  # cutting.
  local limit
  limit=$(jq -r '.args.maxBytes // empty' "$req_file")
  case "$limit" in ""|*[!0-9]*) limit="$NGB_MAX_DIFF_BYTES" ;; esac
  [ "$limit" -gt "$NGB_FIELD_MAX_BYTES" ] && limit="$NGB_FIELD_MAX_BYTES"

  local dir; dir="$(json_tmpdir)"
  printf '%s' "$GIT_OUT" > "$dir/diff.raw"
  trim_diff_to_hunks "$dir/diff.raw" "$limit"
  [ "$DIFF_SHOWN" -lt "$DIFF_TOTAL_HUNKS" ] && truncated=true

  DATA=$(obj_from_fields \
    diff "$(cat "$DIFF_KEPT")" \
    truncated "$truncated" \
    hunksShown "$DIFF_SHOWN" \
    hunksTotal "$DIFF_TOTAL_HUNKS" \
    diffBytesTotal "$DIFF_TOTAL_BYTES" \
    diffBytesLimit "$limit" \
    from "$from" to "$to" path "$path")
}

action_restore_file() {
  local req_file="$1"
  local path commit p
  path=$(jq -r '.args.path // empty' "$req_file")
  commit=$(jq -r '.args.commit // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  valid_commitish "$commit" || { ERROR=$(err_json BAD_REQUEST "Invalid commit reference." "" ""); return 1; }
  read_protected_paths "$req_file" || return 1
  for p in "${PPATHS[@]}"; do
    case "$path" in
      "$p"|"$p"/*)
        ERROR=$(err_json SAFETY_BLOCKED "Refusing to restore into a protected sparse path ($p)." "" "")
        return 1 ;;
    esac
  done
  if ! git cat-file -e "$commit:$path" 2>/dev/null; then
    ERROR=$(err_json FILE_ABSENT "The file does not exist at that commit." "" ""); return 1
  fi
  if ! run_git restore --source="$commit" --worktree -- "$path"; then
    ERROR=$(err_json GIT_FAILED "git restore failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields restored "true" restoredPath "$path" restoredFrom "$commit")")
}


# ---- per-file staging actions (source-control view) ---------------------------

# Guard: the bridge must never touch protected sparse paths.
refuse_if_protected() { # $1 path
  local p
  for p in "${PPATHS[@]}"; do
    case "$1" in
      "$p"|"$p"/*)
        ERROR=$(err_json SAFETY_BLOCKED "Refusing to touch a protected sparse path ($p)." "" "")
        return 1 ;;
    esac
  done
  return 0
}

# The ONE operation permitted on a protected sparse path: taking it back OUT of
# the index.
#
# Everything else on a protected path is refused by refuse_if_protected, and it
# has to be — but that left a state with no way out. A file created inside a
# protected directory and staged BEFORE the directory was excluded keeps its
# index entry when `sparse-checkout reapply` removes it from the worktree.
# git then reports `AD`: added to the index, absent from disk. The safety gate
# blocked every commit, push and sync because of it, the plugin's "delete the
# files" repair moved nothing (there was no file), and unstaging was refused.
# The only exit was Termux.
#
# This is narrow on purpose and cannot be used as a general bypass:
#   1. the path must BE protected (the inverse of the usual guard);
#   2. it must be in the index;
#   3. it must NOT be in HEAD.
# (3) is what makes it safe. `git rm --cached` on a path that HEAD does not
# contain removes an addition; there is no tracked content to turn into a
# staged deletion. The file on disk, if any, is never touched — deleting it is
# the plugin's job, through Obsidian's trash, and stays reversible.
action_unstage_protected() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  if [ "${#PPATHS[@]}" -eq 0 ]; then
    ERROR=$(err_json BAD_REQUEST "No protectedPaths provided." "" ""); return 1
  fi
  local paths=() p path ok_path
  mapfile -t paths < <(jq -r '.args.paths[]? // empty' "$req_file")
  if [ "${#paths[@]}" -eq 0 ]; then
    ERROR=$(err_json BAD_REQUEST "No paths provided." "" ""); return 1
  fi
  # Every path is checked BEFORE anything is removed, so a request that is
  # partly illegal changes nothing at all.
  local accepted=()
  for path in "${paths[@]}"; do
    valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
    ok_path=false
    for p in "${PPATHS[@]}"; do
      case "$path" in "$p"|"$p"/*) ok_path=true; break ;; esac
    done
    if [ "$ok_path" != true ]; then
      ERROR=$(err_json BAD_REQUEST "Not a protected sparse path: $path. This action only clears protected paths out of the index." "" "")
      return 1
    fi
    # An EXACT index entry, not a pathspec hit. `valid_rel_path` does not reject
    # the glob characters `*`, `?` and `[`, so a bare `ls-files -- "$path"`
    # would also accept a pattern, and a DIRECTORY would match its children —
    # in both cases `update-index --force-remove` then removes nothing while
    # the result claims a removal. Matching the printed path against the
    # requested one closes both.
    if ! git ls-files --cached -- "$path" 2>/dev/null | grep -qxF -- "$path"; then
      # Already gone from the index (or never an entry in the first place):
      # nothing to do and nothing to report as an error, so the repair stays
      # idempotent when it is re-run.
      continue
    fi
    # `ls-tree -- <pathspec>` is the wrong test: without -r it does not recurse,
    # so a glob answers "empty" for content that IS committed, and the guard
    # would pass on the strength of a coincidence. `cat-file -e HEAD:<path>`
    # takes a literal path, resolves nested files, and fails cleanly on an
    # unborn HEAD (correctly meaning "not in HEAD").
    if git cat-file -e "HEAD:$path" 2>/dev/null; then
      ERROR=$(err_json SAFETY_BLOCKED "$path is tracked in HEAD. Removing it from the index here would stage a deletion of committed content; resolve that one in Termux." "" "")
      return 1
    fi
    accepted+=("$path")
  done
  if [ "${#accepted[@]}" -gt 0 ]; then
    # `git rm --cached` is the obvious call and it does NOT work here: the path
    # is outside the sparse-checkout definition by construction, and git refuses
    # ("matched paths that exist outside of your sparse-checkout definition")
    # unless given --sparse, which only exists from git 2.35. The plumbing has
    # no such guard, works on every version, and does exactly one thing: drop
    # the index entry. Nothing on disk is touched either way.
    if ! run_git update-index --force-remove -- "${accepted[@]}"; then
      ERROR=$(err_json GIT_FAILED "git update-index --force-remove failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
  fi
  collect_status_fields
  local list; list=$(printf '%s\n' ${accepted[@]+"${accepted[@]}"})
  DATA=$(merge_data "$DATA" "$(obj_from_fields unstagedProtected "$list" unstagedProtectedCount "${#accepted[@]}")")
}

# Apply one patch, in one of the three directions the hunk controls need.
#
#   args.target  "index" | "worktree"     --cached, or not
#   args.reverse  true | false            -R, or not
#
# That covers all three operations with one action, because they ARE one
# operation pointed differently:
#   stage    index,    forward   the hunk enters the index, the file is untouched
#   unstage  index,    reverse   the hunk leaves the index, the file is untouched
#   discard  worktree, reverse   the hunk leaves the file
#
# The patch arrives as a field and is written to a file before git sees it:
# never as an argument, both for the 128 KB execve limit and because a patch
# contains newlines and anything else the vault happens to hold.
#
# Guards, in order:
#   1. the patch names exactly ONE path, extracted from the patch itself rather
#      than trusted from the request — that is what git will act on;
#   2. the path passes valid_rel_path;
#   3. the path is not protected.
#
# No --3way and no fuzz. A patch that does not apply exactly means the diff the
# user was looking at is stale, and the honest answer is to say so and let them
# refresh, not to guess where the hunk belongs now.
action_apply_patch() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1

  local target reverse
  target=$(jq -r '.args.target // "index"' "$req_file")
  reverse=$(jq -r '.args.reverse // false' "$req_file")
  case "$target" in
    index|worktree) ;;
    *) ERROR=$(err_json BAD_REQUEST "Invalid target (must be 'index' or 'worktree')." "" ""); return 1 ;;
  esac
  case "$reverse" in
    true|false) ;;
    *) ERROR=$(err_json BAD_REQUEST "Invalid reverse flag." "" ""); return 1 ;;
  esac

  local dir; dir="$(json_tmpdir)"
  local pf="$dir/apply.patch"
  jq -r '.args.patch // ""' "$req_file" > "$pf"
  if [ ! -s "$pf" ]; then
    ERROR=$(err_json BAD_REQUEST "Empty patch." "" ""); return 1
  fi

  # Paths the patch itself declares. /dev/null is the counterpart of a creation
  # or a deletion and names no path.
  local paths
  paths="$(sed -n 's|^--- \(.*\)$|\1|p; s|^+++ \(.*\)$|\1|p' "$pf" \
    | grep -v '^/dev/null$' \
    | sed 's|^[abciwo]/||' \
    | sort -u)"
  local count
  count="$(printf '%s\n' "$paths" | grep -c . || true)"
  if [ "$count" != "1" ]; then
    ERROR=$(err_json BAD_REQUEST "A patch must touch exactly one path; this one names $count." "" "")
    return 1
  fi
  local path="$paths"
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid path in patch: $path" "" ""); return 1; }
  refuse_if_protected "$path" || return 1

  local -a flags=(apply --whitespace=nowarn)
  [ "$target" = "index" ] && flags+=(--cached)
  [ "$reverse" = "true" ] && flags+=(-R)
  if ! run_git "${flags[@]}" -- "$pf"; then
    ERROR=$(err_json GIT_FAILED \
      "git apply failed; the diff this patch came from is probably out of date. Refresh the diff and try again." \
      "$GIT_OUT" "$GIT_ERR")
    return 1
  fi
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields appliedPath "$path" appliedTarget "$target" appliedReverse "$reverse")")
}

# Pathspec excludes for every protected path that lies UNDER $1.
#
# refuse_if_protected only rejects a path that IS protected or sits inside a
# protected directory. A path can also be an ANCESTOR of one: staging the
# folder row "Private" (or picking "Git: Stage" on a folder) would otherwise
# run `git add -- Private` and sweep in `Private/AgentsMemory/…`, which is
# exactly what the sparse gate then blocks at commit time. Per-path actions
# therefore carry the same `:(exclude)` specs that stage-all already uses.
PSPECS=()
protected_excludes_under() { # $1 base path
  PSPECS=()
  local p
  for p in "${PPATHS[@]}"; do
    # "." is the repository root (the group-wide stage button sends it), so
    # every protected path lies under it.
    if [ "$1" = "." ]; then
      PSPECS+=(":(exclude)$p")
      continue
    fi
    case "$p" in
      "$1"/*) PSPECS+=(":(exclude)$p") ;;
    esac
  done
}

action_stage_file() {
  local req_file="$1" path mode
  path=$(jq -r '.args.path // empty' "$req_file")
  mode=$(jq -r '.args.mode // "all"' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  read_protected_paths "$req_file" || return 1
  refuse_if_protected "$path" || return 1
  protected_excludes_under "$path"
  case "$mode" in
    all)
      # Files and folders alike; on a folder this also picks up untracked files.
      if ! run_git add -- "$path" "${PSPECS[@]}"; then
        ERROR=$(err_json GIT_FAILED "git add failed." "$GIT_OUT" "$GIT_ERR"); return 1
      fi ;;
    update)
      # Tracked changes only (folder rows in the "Changes" group): untracked
      # files under the folder must NOT be swept in by a tracked-group action.
      if ! run_git add -u -- "$path" "${PSPECS[@]}"; then
        ERROR=$(err_json GIT_FAILED "git add -u failed." "$GIT_OUT" "$GIT_ERR"); return 1
      fi ;;
    *)
      ERROR=$(err_json BAD_REQUEST "Invalid stage mode (must be 'all' or 'update')." "" ""); return 1 ;;
  esac
  collect_status_fields
}

action_unstage_file() {
  local req_file="$1" path
  path=$(jq -r '.args.path // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  read_protected_paths "$req_file" || return 1
  refuse_if_protected "$path" || return 1
  protected_excludes_under "$path"
  # Works for both tracked and newly added files.
  if ! run_git restore --staged -- "$path" "${PSPECS[@]}"; then
    if ! run_git rm --cached -q -- "$path" "${PSPECS[@]}"; then
      ERROR=$(err_json GIT_FAILED "git restore --staged failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
  fi
  collect_status_fields
}

action_stage_all() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  safety_gate || return 1
  if ! stage_all_except_protected; then
    ERROR=$(err_json GIT_FAILED "git add failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  safety_gate || return 1
  collect_status_fields
}

# Repository-wide discard of UNSTAGED work (the "Changes" group as a whole):
# tracked files go back to what is staged (or to HEAD when nothing is staged).
# Untracked files are deliberately left alone: deleting them would be a
# `git clean`, which the user did not ask for and cannot undo from here.
action_discard_all() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  local -a specs=(".")
  local p
  for p in "${PPATHS[@]}"; do specs+=(":(exclude)$p"); done
  if ! run_git restore --worktree -- "${specs[@]}"; then
    ERROR=$(err_json GIT_FAILED "git restore --worktree failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  collect_status_fields
}

# Everything back to HEAD: index AND worktree, the effect of `git reset --hard`
# expressed as a pathspec restore so protected paths can be excluded (a real
# --hard takes no pathspec and would wipe them too). Untracked files survive.
action_reset_all() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  local -a specs=(".")
  local p
  for p in "${PPATHS[@]}"; do specs+=(":(exclude)$p"); done
  if ! run_git restore --staged --worktree -- "${specs[@]}"; then
    # No commit yet: restore has no source, so drop the index instead.
    if ! run_git reset -q -- "${specs[@]}"; then
      ERROR=$(err_json GIT_FAILED "Reset failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
  fi
  collect_status_fields
}

action_unstage_all() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  local -a specs=(".")
  local p
  for p in "${PPATHS[@]}"; do specs+=(":(exclude)$p"); done
  if ! run_git restore --staged -- "${specs[@]}"; then
    # Repos without any commit yet cannot use restore --staged.
    if ! run_git reset -q -- "${specs[@]}"; then
      ERROR=$(err_json GIT_FAILED "Unstaging failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
  fi
  collect_status_fields
}

action_discard_file() {
  local req_file="$1" path tracked
  path=$(jq -r '.args.path // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  read_protected_paths "$req_file" || return 1
  refuse_if_protected "$path" || return 1
  protected_excludes_under "$path"
  # "Tracked" must be decided with the protected paths already excluded: a
  # folder whose only tracked content is a protected (sparse-hidden)
  # subdirectory has nothing for `git restore` to act on, and asking anyway
  # fails with "did not match any file(s)".
  if [ -n "$(git ls-files -- "$path" "${PSPECS[@]}" 2>/dev/null)" ]; then
    tracked=true
  else
    tracked=false
  fi
  if [ "$tracked" = true ]; then
    if ! run_git restore --staged --worktree -- "$path" "${PSPECS[@]}"; then
      ERROR=$(err_json GIT_FAILED "git restore failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
  elif [ -d "$NGB_REPO_DIR/$path" ]; then
    # An untracked DIRECTORY (folder row): delete the files git reports as
    # untracked inside it, honouring the same protected-path excludes, and
    # never a blind `rm -rf` of the directory.
    local f
    while IFS= read -r -d '' f; do
      rm -f -- "$NGB_REPO_DIR/$f" || {
        ERROR=$(err_json GIT_FAILED "Could not delete untracked file." "" ""); return 1; }
    done < <(git ls-files --others --exclude-standard -z -- "$path" "${PSPECS[@]}" 2>/dev/null)
  else
    # Untracked: delete the file itself (explicitly confirmed in the UI).
    rm -f -- "$NGB_REPO_DIR/$path" || {
      ERROR=$(err_json GIT_FAILED "Could not delete untracked file." "" ""); return 1; }
  fi
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields discarded "$path" wasTracked "$tracked")")
}

# ---- sparse / exclude management ----------------------------------------------
# The bridge edits CONFIG (sparse patterns, .git/info/exclude), never history.
# Only non-cone (pattern) sparse mode is supported for exclusions: cone mode
# cannot express "hide this directory" as a pattern.

# A line-based file may lack a trailing newline (git writes the sparse file,
# the installer or an editor writes info/exclude). Appending then GLUES the new
# entry onto the previous last line and silently corrupts both — e.g.
# "!/Projects/Backup" + "/.gitignore" becomes "!/Projects/Backup/.gitignore".
# Every append in this runner goes through here first.
ensure_trailing_newline() { # $1 file
  [ -s "$1" ] || return 0
  local last
  last="$(tail -c 1 "$1" | od -An -tx1 | tr -d ' \n')"
  [ "$last" = "0a" ] || printf '\n' >> "$1"
}

require_noncone_sparse() {
  if [ "$(git config --get core.sparseCheckout 2>/dev/null || true)" != "true" ]; then
    ERROR=$(err_json GIT_FAILED "Sparse checkout is not enabled in this repository. In Termux run: git sparse-checkout set --no-cone '/*'  (then retry)." "" "")
    return 1
  fi
  if [ "$(git config --get core.sparseCheckoutCone 2>/dev/null || true)" = "true" ]; then
    ERROR=$(err_json GIT_FAILED "This repository uses cone-mode sparse checkout; per-path exclusions need pattern (non-cone) mode." "" "")
    return 1
  fi
  return 0
}

# `!/path` (no trailing slash) matches the path whether it is a file or a
# directory; trailing-slash variants are still recognized when REMOVING.
action_sparse_exclude_add() {
  local req_file="$1" path
  path=$(jq -r '.args.path // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  require_noncone_sparse || return 1
  local tmpf; tmpf="$(mktemp)"
  git sparse-checkout list > "$tmpf" 2>/dev/null || true
  ensure_trailing_newline "$tmpf"
  if ! grep -qxF -e "!/$path" -e "!/$path/" -e "!$path" -e "!$path/" "$tmpf"; then
    printf '!/%s\n' "$path" >> "$tmpf"
    if ! run_git sparse-checkout set --no-cone --stdin < "$tmpf"; then
      rm -f "$tmpf"
      ERROR=$(err_json GIT_FAILED "git sparse-checkout set failed." "$GIT_OUT" "$GIT_ERR")
      return 1
    fi
  fi
  rm -f "$tmpf"
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields sparseExcluded "$path")")
}

action_sparse_exclude_remove() {
  local req_file="$1" path
  path=$(jq -r '.args.path // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  require_noncone_sparse || return 1
  local tmpf; tmpf="$(mktemp)"
  git sparse-checkout list > "$tmpf" 2>/dev/null || true
  grep -vxF -e "!/$path" -e "!/$path/" -e "!$path" -e "!$path/" "$tmpf" > "$tmpf.new" || true
  if ! cmp -s "$tmpf" "$tmpf.new"; then
    if ! run_git sparse-checkout set --no-cone --stdin < "$tmpf.new"; then
      rm -f "$tmpf" "$tmpf.new"
      ERROR=$(err_json GIT_FAILED "git sparse-checkout set failed." "$GIT_OUT" "$GIT_ERR")
      return 1
    fi
  fi
  rm -f "$tmpf" "$tmpf.new"
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields sparseUnexcluded "$path")")
}

exclude_file_path() { git rev-parse --git-path info/exclude; }

emit_exclude_list() { # DATA <- current exclude file content
  local xf; xf="$(exclude_file_path)"
  DATA=$(obj_from_fields excludeList "$(cat "$xf" 2>/dev/null || true)")
}

action_exclude_list() { emit_exclude_list; }

action_exclude_add() {
  local req_file="$1" path xf
  path=$(jq -r '.args.path // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  xf="$(exclude_file_path)"
  mkdir -p "$(dirname "$xf")"
  ensure_trailing_newline "$xf"
  grep -qxF "/$path" "$xf" 2>/dev/null || printf '/%s\n' "$path" >> "$xf"
  emit_exclude_list
}

action_exclude_remove() {
  local req_file="$1" path xf
  path=$(jq -r '.args.path // empty' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  xf="$(exclude_file_path)"
  if [ -f "$xf" ]; then
    grep -vxF -e "/$path" -e "$path" -e "/$path/" -e "$path/" "$xf" > "$xf.tmp" || true
    mv "$xf.tmp" "$xf"
  fi
  emit_exclude_list
}

# ---- repository bootstrap (v11) ------------------------------------------------
# The missing beginning of the story: a vault that is not a repository yet, or
# one without a remote. Everything interactive (a PAT, a passphrase) stays in
# Termux — these actions only do the parts that carry no secret.

NGB_CLONE_TIMEOUT="${NGB_CLONE_TIMEOUT:-900}"

# The runtime directory must be excluded from the repository the moment one
# exists, or the request/result files show up as untracked changes.
write_runtime_exclude() {
  local xf line=".obsidian/plugins/native-git-bridge/runtime/"
  # Derive the line from the profile's own runtime dir when it lives inside the
  # repository (a custom Obsidian config directory is not always ".obsidian").
  case "$NGB_RUNTIME_DIR" in
    "$NGB_REPO_DIR"/*) line="${NGB_RUNTIME_DIR#"$NGB_REPO_DIR"/}/" ;;
  esac
  xf="$(git rev-parse --git-path info/exclude 2>/dev/null || true)"
  [ -n "$xf" ] || return 0
  case "$xf" in /*) : ;; *) xf="$NGB_REPO_DIR/$xf" ;; esac
  mkdir -p "$(dirname "$xf")" 2>/dev/null || return 0
  grep -qxF "$line" "$xf" 2>/dev/null && return 0
  ensure_trailing_newline "$xf"
  printf '%s\n' "$line" >> "$xf" || true
}

# A freshly created repository inside another paired vault has to be excluded
# from that outer repository right away, not on the next run.
exclude_from_outer_profiles() {
  local conf outer
  while IFS= read -r conf; do
    [ -n "$conf" ] || continue
    outer="$(sed -n 's/^NGB_REPO_DIR="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$conf" | head -1)"
    [ -n "$outer" ] || continue
    [ "$outer" = "$NGB_REPO_DIR" ] && continue
    case "$NGB_REPO_DIR" in
      "$outer"/*) ensure_nested_exclusion "$outer" "$NGB_REPO_DIR" ;;
    esac
  done < <(list_profile_files)
}

# Bring the working tree up to the index without overwriting anything the vault
# already holds. Used by both ways of attaching a repository to a vault that
# already has files, so the two end in exactly the same state.
#
#   reset <ref>  -> the repository's tree lands in the INDEX; the working tree
#                   is untouched, so files that exist here become "modified"
#   checkout-index of the deleted paths -> everything the vault does NOT have
#                   is written out of the index, and only those paths
materialize_from_ref() { # $1 = ref to take the tree from
  if ! run_git reset -q "$1"; then
    ERROR=$(err_json GIT_FAILED "Linking the working tree to the repository failed." "$GIT_OUT" "$GIT_ERR")
    return 1
  fi
  local missing_err
  missing_err="$(git ls-files -z --deleted 2>/dev/null | git checkout-index -z --stdin -u 2>&1 >/dev/null)"
  if [ -n "$missing_err" ]; then
    MATERIALIZE_ERR="$missing_err"
    return 2
  fi
  MATERIALIZE_ERR=""
  return 0
}

# Which branch to adopt when the remote does not say (or says something that
# does not exist): the requested one, then main, then master, then the only one
# there is. Prints nothing when the choice is not obvious.
pick_remote_branch() { # $1 = requested branch or empty
  local want="$1" b count
  if [ -n "$want" ]; then
    git show-ref --verify -q "refs/remotes/origin/$want" && { printf '%s' "$want"; return 0; }
    return 1
  fi
  for b in main master; do
    git show-ref --verify -q "refs/remotes/origin/$b" && { printf '%s' "$b"; return 0; }
  done
  count="$(git for-each-ref --format='%(refname:short)' refs/remotes/origin 2>/dev/null | grep -cv '^origin/HEAD$' || true)"
  if [ "$count" = "1" ]; then
    git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v '^origin/HEAD$' | sed 's|^origin/||'
    return 0
  fi
  return 1
}

# Put the vault's current repository aside instead of destroying it.
#
# It may hold commits that exist nowhere else, and a repository is the one kind
# of data whose loss is invisible: a missing file is noticed today, a missing
# commit in three weeks. So it is RENAMED (same filesystem, instant, no copy)
# into the runtime folder, and a small manifest next to it records what it was —
# size, commits, branch, last commit — so the plugin can describe it later
# without walking a large directory.
STASHED_GIT=""
stash_existing_git() {
  local ts name dir commits branch last size
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  name="previous-git-$ts"
  dir="$NGB_RUNTIME_DIR/$name"
  [ -e "$dir" ] && { ERROR=$(err_json GIT_FAILED "A previous repository copy with this name already exists." "" ""); return 1; }
  # Facts have to be gathered while .git is still in place.
  commits="$(git rev-list --count --all 2>/dev/null || echo 0)"
  branch="$(git symbolic-ref --short -q HEAD || echo '(detached)')"
  last="$(git log -1 --format='%h %cs %s' 2>/dev/null || true)"
  if ! mv "$NGB_REPO_DIR/.git" "$dir"; then
    ERROR=$(err_json GIT_FAILED "The existing repository could not be moved aside; nothing was changed." "" "")
    return 1
  fi
  size="$(du -sk "$dir" 2>/dev/null | cut -f1)"
  printf '%s' "${size:-0}" | grep -Eq '^[0-9]+$' || size=0
  jq -n --arg dir "$name" --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --argjson sizeKb "$size" --argjson commits "${commits:-0}" \
        --arg branch "$branch" --arg lastCommit "$last" \
        '{dir:$dir,createdAt:$createdAt,sizeKb:$sizeKb,commits:$commits,branch:$branch,lastCommit:$lastCommit}' \
    > "$NGB_RUNTIME_DIR/$name.json" 2>/dev/null || true
  STASHED_GIT="$name"
  log "CLONE moved the existing repository aside as $name (${size:-0} KB, ${commits:-0} commits)"
  return 0
}

# Undo the stash: used when the clone fails after the old repository was moved.
restore_stashed_git() {
  [ -n "$STASHED_GIT" ] || return 0
  [ -e "$NGB_REPO_DIR/.git" ] && return 1
  if mv "$NGB_RUNTIME_DIR/$STASHED_GIT" "$NGB_REPO_DIR/.git" 2>/dev/null; then
    rm -f "$NGB_RUNTIME_DIR/$STASHED_GIT.json"
    log "CLONE restored the existing repository after a failure"
    STASHED_GIT=""
    return 0
  fi
  return 1
}

action_init_repo() {
  local req_file="$1" branch msg initial
  branch=$(jq -r '.args.branch // "main"' "$req_file")
  initial=$(jq -r '.args.initialCommit // false' "$req_file")
  msg=$(jq -r '.args.message // empty' "$req_file")
  valid_branch_name "$branch" || {
    ERROR=$(err_json BAD_REQUEST "Invalid branch name." "" ""); return 1; }
  if [ "$PROFILE_STATE" = "ready" ]; then
    ERROR=$(err_json REPO_EXISTS "This vault is already a git repository; refusing to re-initialise it." "" "")
    return 1
  fi
  if ! run_git init -b "$branch"; then
    # git < 2.28 has no -b; fall back to setting HEAD afterwards.
    if ! run_git init; then
      ERROR=$(err_json GIT_FAILED "git init failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
    run_git symbolic-ref HEAD "refs/heads/$branch" || true
  fi
  PROFILE_STATE="ready"
  write_runtime_exclude
  exclude_from_outer_profiles
  # From here the repository EXISTS. Anything that fails after this point must
  # say so, or the user is told "init failed" while looking at a new .git.
  local committed=false
  init_partial() { # $1 message
    collect_status_fields
    DATA=$(merge_data "$DATA" "$(obj_from_fields initialised "true" branch "$branch" committed "false")")
    ERROR=$(err_json GIT_FAILED "The repository was created ($branch). $1" "$GIT_OUT" "$GIT_ERR")
  }
  if [ "$initial" = "true" ]; then
    if ! require_identity; then
      init_partial "The first commit was not made: git user.name / user.email are not configured in Termux. Run: git config --global user.name '...' && git config --global user.email '...'  then commit from the plugin."
      return 1
    fi
    [ -n "$msg" ] || msg="Initial commit (native git bridge)"
    if [ "${#msg}" -gt 1000 ]; then
      init_partial "The commit message is longer than 1000 characters."
      return 1
    fi
    if ! run_git add -A -- .; then
      init_partial "Staging the vault's files failed."
      return 1
    fi
    if ! git diff --cached --quiet 2>/dev/null; then
      if ! run_git commit -m "$msg"; then
        init_partial "The first commit failed."
        return 1
      fi
      committed=true
    fi
  fi
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields initialised "true" branch "$branch" committed "$committed")")
}

action_set_remote() {
  local req_file="$1" url existing
  url=$(jq -r '.args.url // empty' "$req_file")
  if ! valid_remote_url "$url"; then
    ERROR=$(err_json BAD_REQUEST \
      "Invalid remote URL. Use https://host/owner/repo.git, ssh://host/path, git@host:owner/repo.git or file:///absolute/path. A URL with a password in it is refused: keep credentials in Termux (credential helper or SSH key)." "" "")
    return 1
  fi
  if [ "$PROFILE_STATE" != "ready" ]; then
    ERROR=$(err_json REPO_MISSING "This vault is not a git repository yet; create or clone one first." "" "")
    return 1
  fi
  existing="$(git remote get-url origin 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    if ! run_git remote set-url origin "$url"; then
      ERROR=$(err_json GIT_FAILED "git remote set-url failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
  else
    if ! run_git remote add origin "$url"; then
      ERROR=$(err_json GIT_FAILED "git remote add failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
  fi
  # Whether the two sides can ever meet is decided by what each already
  # contains, and getting that wrong is the classic "refusing to merge
  # unrelated histories" dead end. Ask now, while the answer is still useful.
  # A remote that cannot be reached (no credentials yet) is reported as
  # unknown rather than as a failure: setting the URL still succeeded.
  local remote_branches="" local_commits=false reachable=false
  local saved="$NGB_NET_TIMEOUT"
  NGB_NET_TIMEOUT=30
  if run_git_net ls-remote --heads origin; then
    reachable=true
    remote_branches="$(printf '%s' "$GIT_OUT" | sed -n 's|.*refs/heads/||p')"
  fi
  NGB_NET_TIMEOUT="$saved"
  git rev-parse --verify -q HEAD >/dev/null 2>&1 && local_commits=true
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields \
    remoteSet "true" \
    previousRemote "$(printf '%s' "$existing" | redact_url)" \
    remoteReachable "$reachable" \
    remoteBranches "$remote_branches" \
    localCommits "$local_commits")")
}

# Take the content of an already configured remote into a repository that has
# no commits of its own yet. This is what makes "create a repository, then
# point it at my existing remote" end up in the SAME state as cloning would:
# same history, same upstream, the vault's own files kept as local changes.
#
# It refuses the moment the local side has a history, because then the two are
# unrelated and no automatic answer is honest — that decision belongs to the
# user, in Termux, with the options spelled out.
action_adopt_remote() {
  local req_file="$1" branch picked
  branch=$(jq -r '.args.branch // empty' "$req_file")
  if [ -n "$branch" ] && ! valid_branch_name "$branch"; then
    ERROR=$(err_json BAD_REQUEST "Invalid branch name." "" ""); return 1
  fi
  if [ "$PROFILE_STATE" != "ready" ]; then
    ERROR=$(err_json REPO_MISSING "This vault is not a git repository yet." "" ""); return 1
  fi
  if [ -z "$(git remote get-url origin 2>/dev/null || true)" ]; then
    ERROR=$(err_json GIT_FAILED "This repository has no 'origin' remote yet; set one first." "" ""); return 1
  fi
  if git rev-parse --verify -q HEAD >/dev/null 2>&1; then
    ERROR=$(err_json GIT_FAILED \
      "This repository already has commits of its own, so it cannot simply take the remote's history: the two are unrelated. Either start again in an empty vault and clone, or resolve it deliberately in Termux (git pull --allow-unrelated-histories, or reset onto the remote branch and lose the local commits)." "" "")
    return 1
  fi
  if ! run_git_net fetch --prune origin; then
    ERROR=$(err_json GIT_FAILED "git fetch failed." "$GIT_OUT" "$GIT_ERR"); return 1
  fi
  if [ -z "$(git for-each-ref refs/remotes/origin 2>/dev/null)" ]; then
    collect_status_fields
    DATA=$(merge_data "$DATA" "$(obj_from_fields adopted "false" empty "true")")
    return 0
  fi
  picked="$(pick_remote_branch "$branch")" || {
    ERROR=$(err_json BAD_REQUEST \
      "Which branch? The remote has: $(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v '^origin/HEAD$' | sed 's|^origin/||' | tr '\n' ' ')" "" "")
    return 1; }
  local collisions="" f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ -e "$NGB_REPO_DIR/$f" ] && collisions="$collisions$f
"
  done < <(git ls-tree -r --name-only "refs/remotes/origin/$picked")
  git symbolic-ref HEAD "refs/heads/$picked"
  local mrc=0
  materialize_from_ref "refs/remotes/origin/$picked" || mrc=$?
  [ "$mrc" = "1" ] && return 1
  git branch --set-upstream-to="origin/$picked" "$picked" >/dev/null 2>&1 || true
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields adopted "true" branch "$picked" collisions "$collisions")")
  if [ "$mrc" = "2" ]; then
    ERROR=$(err_json GIT_FAILED \
      "The history is in place, but some files could not be written into the working tree. They are listed as deleted in the panel; 'discard' restores them." \
      "" "$(printf '%s' "$MATERIALIZE_ERR" | redact_url)")
    return 1
  fi
}

# Clone INTO a directory that already holds files (every vault holds at least
# .obsidian/). A plain `git clone` refuses that, so: clone without a checkout
# into a temporary directory inside the runtime folder (same filesystem, so the
# move is a rename), move the .git in, then decide what to do about files that
# exist on both sides. Nothing is overwritten without being asked.
action_clone_into_vault() {
  local req_file="$1" url branch tmp head_branch replace
  url=$(jq -r '.args.url // empty' "$req_file")
  branch=$(jq -r '.args.branch // empty' "$req_file")
  replace=$(jq -r '.args.replaceExisting // false' "$req_file")
  STASHED_GIT=""
  if ! valid_remote_url "$url"; then
    ERROR=$(err_json BAD_REQUEST \
      "Invalid remote URL. Use https://host/owner/repo.git, ssh://host/path, git@host:owner/repo.git or file:///absolute/path. A URL with a password in it is refused: keep credentials in Termux (credential helper or SSH key)." "" "")
    return 1
  fi
  if [ -n "$branch" ] && ! valid_branch_name "$branch"; then
    ERROR=$(err_json BAD_REQUEST "Invalid branch name." "" ""); return 1
  fi
  if [ "$PROFILE_STATE" = "ready" ] && [ "$replace" != "true" ]; then
    ERROR=$(err_json REPO_EXISTS "This vault is already a git repository; refusing to clone over it." "" "")
    return 1
  fi
  tmp="$NGB_RUNTIME_DIR/clone-tmp"
  rm -rf "$tmp"
  mkdir -p "$tmp" || { ERROR=$(err_json GIT_FAILED "Could not create a working directory for the clone." "" ""); return 1; }
  local -a cargs=(clone --no-checkout --origin origin)
  [ -n "$branch" ] && cargs+=(--branch "$branch")
  cargs+=(-- "$url" "$tmp/repo")
  local saved_timeout="$NGB_NET_TIMEOUT"
  NGB_NET_TIMEOUT="$NGB_CLONE_TIMEOUT"
  local ok=0
  run_git_net "${cargs[@]}" || ok=1
  NGB_NET_TIMEOUT="$saved_timeout"
  if [ "$ok" != 0 ]; then
    rm -rf "$tmp"
    ERROR=$(err_json GIT_FAILED "git clone failed. Nothing was written into the vault." "$GIT_OUT" "$GIT_ERR")
    return 1
  fi
  if [ ! -d "$tmp/repo/.git" ]; then
    rm -rf "$tmp"
    ERROR=$(err_json GIT_FAILED "The clone produced no repository." "" ""); return 1
  fi
  # The clone has succeeded, so now — and only now — the vault's existing
  # repository may be disturbed. Doing it in this order means a clone that
  # fails (bad URL, no credentials, connection lost) never touches what is
  # already there.
  if [ -e "$NGB_REPO_DIR/.git" ]; then
    if [ "$replace" != "true" ]; then
      rm -rf "$tmp"
      ERROR=$(err_json REPO_EXISTS "A repository appeared in this vault while the clone was running; nothing was changed." "" "")
      return 1
    fi
    if ! stash_existing_git; then
      rm -rf "$tmp"
      return 1
    fi
  fi
  if ! mv "$tmp/repo/.git" "$NGB_REPO_DIR/.git"; then
    rm -rf "$tmp"
    restore_stashed_git || true
    ERROR=$(err_json GIT_FAILED "Could not move the cloned repository into the vault." "" ""); return 1
  fi
  rm -rf "$tmp"
  run_git config core.bare false || true
  PROFILE_STATE="ready"
  write_runtime_exclude
  exclude_from_outer_profiles
  head_branch="$(git symbolic-ref --short -q HEAD || true)"
  local from_ref="HEAD"

  if ! git rev-parse --verify -q HEAD >/dev/null 2>&1; then
    # HEAD points at a branch that does not exist on the remote. Two very
    # different reasons: the remote is empty (nothing to do), or the remote's
    # HEAD is stale — a bare repository created as `master` that only ever
    # received `main`, which is common and which plain `git clone` also leaves
    # in this half-state. Pick the branch instead of leaving the vault with a
    # repository it cannot use.
    if [ -z "$(git for-each-ref refs/remotes/origin 2>/dev/null)" ]; then
      collect_status_fields
      DATA=$(merge_data "$DATA" "$(obj_from_fields cloned "true" branch "$head_branch" empty "true" collisions "")")
      return 0
    fi
    local picked
    picked="$(pick_remote_branch "$branch")" || {
      collect_status_fields
      DATA=$(merge_data "$DATA" "$(obj_from_fields cloned "true" branch "" collisions "")")
      ERROR=$(err_json GIT_FAILED \
        "The repository is in the vault, but its default branch could not be determined: $(git for-each-ref --format='%(refname:short)' refs/remotes/origin | tr '\n' ' '). Choose one and set it in Termux with: git -C \"$NGB_REPO_DIR\" switch <branch>" "" "")
      return 1; }
    head_branch="$picked"
    git symbolic-ref HEAD "refs/heads/$head_branch"
    from_ref="refs/remotes/origin/$head_branch"
  fi

  # Which tracked paths already exist here? Those are the only ones a checkout
  # could destroy, and the user decides what happens to them.
  #
  # Whether the repository tracks Obsidian's own configuration directory is
  # reported too: writing into it while Obsidian is running means the app is
  # holding an older copy in memory, which is a restart, not a repair.
  local collisions="" f config_dir="" config_tracked=false
  case "$NGB_RUNTIME_DIR" in
    "$NGB_REPO_DIR"/*)
      config_dir="${NGB_RUNTIME_DIR#"$NGB_REPO_DIR"/}"
      config_dir="${config_dir%%/*}" ;;
  esac
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ -e "$NGB_REPO_DIR/$f" ] && collisions="$collisions$f
"
    if [ -n "$config_dir" ]; then
      case "$f" in "$config_dir"/*) config_tracked=true ;; esac
    fi
  done < <(git ls-tree -r --name-only "$from_ref")

  # Two git commands, no file moves, and the vault's own files are never
  # written over:
  #
  #   1. `git reset HEAD` puts the repository's tree into the INDEX and leaves
  #      the working tree exactly as it is. Files the vault already had now
  #      differ from the index, which is precisely "a local change".
  #   2. Everything the vault does NOT have shows up as deleted-in-worktree;
  #      writing only those paths out of the index materializes the rest of the
  #      repository without touching a single existing file.
  #
  # What the user ends up with is a complete checkout plus their own versions
  # of the overlapping files, listed in the panel as ordinary modifications —
  # with a diff to look at, and per-file discard to take the repository's
  # version instead. No blind up-front choice, and nothing moved anywhere it
  # would have to be fished back out of.
  local mrc=0
  materialize_from_ref "$from_ref" || mrc=$?
  if [ "$mrc" = "1" ]; then return 1; fi
  # Whatever the clone configured, make sure the branch tracks its remote: a
  # branch adopted after a dangling HEAD has no upstream yet, and without one
  # pull and push have nothing to talk to.
  git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || \
    git branch --set-upstream-to="origin/$head_branch" "$head_branch" >/dev/null 2>&1 || true
  if [ "$mrc" = "2" ]; then
    collect_status_fields
    DATA=$(merge_data "$DATA" "$(obj_from_fields cloned "true" branch "$head_branch" collisions "$collisions")")
    ERROR=$(err_json GIT_FAILED \
      "The repository is in the vault, but some of its files could not be written into the working tree. They are listed as deleted in the panel; 'discard' restores them." \
      "" "$(printf '%s' "$MATERIALIZE_ERR" | redact_url)")
    return 1
  fi
  collect_status_fields
  DATA=$(merge_data "$DATA" "$(obj_from_fields \
    cloned "true" branch "$head_branch" collisions "$collisions" \
    configDirTracked "$config_tracked" previousGit "$STASHED_GIT")")
}

# ---- request processing ------------------------------------------------------

process_request() {
  local req_file="$1"
  local id action token started
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if ! jq -e . "$req_file" >/dev/null 2>&1; then
    log "SKIP unparsable request file $(basename "$req_file")"
    mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
    return
  fi
  id=$(jq -r '.id // empty' "$req_file")
  action=$(jq -r '.action // empty' "$req_file")
  token=$(jq -r '.token // empty' "$req_file")

  if ! valid_id "$id"; then
    log "SKIP request with invalid id"
    mv "$req_file" "$DONE_DIR/invalid-$(date +%s%N).json" 2>/dev/null || rm -f "$req_file"
    return
  fi
  if [ "$token" != "$NGB_TOKEN" ]; then
    log "AUTH failure for $id (action=$action)"
    write_result "$id" "$action" false 1 'null' "$(err_json AUTH "Pairing token mismatch. Re-run the installer or update the token in Obsidian settings." "" "")" "$started"
    mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
    return
  fi
  # The profile is decided by the request directory the file was found in, and
  # the token proves the sender knows THIS profile's secret. When the plugin
  # also names its profile, the two must agree: a request file copied from
  # another vault is a mistake (or a replay) and never runs here. The profile is
  # LOOKED UP, never taken from the request - no repoDir, no path, ever.
  local claimed_profile
  claimed_profile=$(jq -r '.profileId // empty' "$req_file")
  if [ -n "$claimed_profile" ] && [ "$claimed_profile" != "$PROFILE_ID" ]; then
    log "PROFILE mismatch for $id (request claims $claimed_profile, this is $PROFILE_ID)"
    write_result "$id" "$action" false 1 'null' \
      "$(err_json BAD_REQUEST "This request belongs to a different vault (profile mismatch). Nothing was executed." "" "")" \
      "$started"
    mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
    return
  fi
  if [ -e "$CAN_DIR/$id" ]; then
    log "CANCELLED before start: $id ($action)"
    write_result "$id" "$action" false 1 'null' "$(err_json CANCELLED "Cancelled before execution." "" "")" "$started"
    mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
    return
  fi

  # Expiry guard: a request the plugin has long stopped waiting for must not
  # execute at an arbitrary later trigger (a days-old "sync" surprising the
  # user with a commit). Grace covers the documented manual-recovery run.
  # Unparsable timestamps fail OPEN (execute) so a broken clock cannot brick
  # the bridge; the plugin additionally writes a cancel flag on timeout.
  local created created_s now_s timeout_s
  created=$(jq -r '.createdAt // empty' "$req_file")
  timeout_s=$(jq -r '.timeoutSeconds // 90' "$req_file")
  printf '%s' "$timeout_s" | grep -Eq '^[0-9]{1,5}$' || timeout_s=90
  if [ -n "$created" ] && created_s="$(date -u -d "$created" +%s 2>/dev/null)"; then
    now_s="$(date -u +%s)"
    if [ $((now_s - created_s)) -gt $((timeout_s + NGB_EXPIRY_GRACE)) ]; then
      log "EXPIRED $id (action=$action created=$created timeout=${timeout_s}s)"
      write_result "$id" "$action" false 1 'null' \
        "$(err_json EXPIRED "Request expired before execution (created $created; the plugin stopped waiting long ago). Nothing was executed - run the operation again." "" "")" \
        "$started"
      mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
      return
    fi
  fi

  # A vault that is paired but not a repository yet answers only the actions
  # that create one; everything else would operate on nothing.
  if [ "$PROFILE_STATE" = "bootstrap" ] && ! bootstrap_action_allowed "$action"; then
    write_result "$id" "$action" false 1 'null' \
      "$(err_json REPO_MISSING "$PROFILE_UNHEALTHY_REASON Create a repository here, or clone one into it, first." "" "")" \
      "$started"
    log "SKIP $id ($action): profile $PROFILE_ID has no repository yet"
    mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
    json_cleanup
    return
  fi

  DATA='null'; ERROR='null'
  local ok=true ec=0
  case "$action" in
    ping)                  action_ping || { ok=false; ec=1; } ;;
    status)                action_status || { ok=false; ec=1; } ;;
    verify-sparse-safety)  action_verify_sparse_safety "$req_file" || { ok=false; ec=1; } ;;
    sparse-reapply)        action_sparse_reapply || { ok=false; ec=1; } ;;
    diagnostics)           action_diagnostics || { ok=false; ec=1; } ;;
    fetch)                 action_fetch || { ok=false; ec=1; } ;;
    pull)                  action_pull "$req_file" || { ok=false; ec=1; } ;;
    commit)                action_commit "$req_file" || { ok=false; ec=1; } ;;
    push)                  action_push "$req_file" || { ok=false; ec=1; } ;;
    sync)                  action_sync "$req_file" || { ok=false; ec=1; } ;;
    abort-merge)           action_abort_merge || { ok=false; ec=1; } ;;
    abort-rebase)          action_abort_rebase || { ok=false; ec=1; } ;;
    continue-rebase)       action_continue_rebase || { ok=false; ec=1; } ;;
    file-log)              action_file_log "$req_file" || { ok=false; ec=1; } ;;
    repo-log)              action_repo_log "$req_file" || { ok=false; ec=1; } ;;
    resolve-conflict)      action_resolve_conflict "$req_file" || { ok=false; ec=1; } ;;
    show-file-at-commit)   action_show_file_at_commit "$req_file" || { ok=false; ec=1; } ;;
    diff-file)             action_diff_file "$req_file" || { ok=false; ec=1; } ;;
    restore-file)          action_restore_file "$req_file" || { ok=false; ec=1; } ;;
    stage-file)            action_stage_file "$req_file" || { ok=false; ec=1; } ;;
    unstage-file)          action_unstage_file "$req_file" || { ok=false; ec=1; } ;;
    unstage-protected)     action_unstage_protected "$req_file" || { ok=false; ec=1; } ;;
    apply-patch)           action_apply_patch "$req_file" || { ok=false; ec=1; } ;;
    discard-file)          action_discard_file "$req_file" || { ok=false; ec=1; } ;;
    stage-all)             action_stage_all "$req_file" || { ok=false; ec=1; } ;;
    unstage-all)           action_unstage_all "$req_file" || { ok=false; ec=1; } ;;
    discard-all)           action_discard_all "$req_file" || { ok=false; ec=1; } ;;
    reset-all)             action_reset_all "$req_file" || { ok=false; ec=1; } ;;
    sparse-exclude-add)    action_sparse_exclude_add "$req_file" || { ok=false; ec=1; } ;;
    sparse-exclude-remove) action_sparse_exclude_remove "$req_file" || { ok=false; ec=1; } ;;
    exclude-add)           action_exclude_add "$req_file" || { ok=false; ec=1; } ;;
    exclude-remove)        action_exclude_remove "$req_file" || { ok=false; ec=1; } ;;
    exclude-list)          action_exclude_list || { ok=false; ec=1; } ;;
    init-repo)             action_init_repo "$req_file" || { ok=false; ec=1; } ;;
    set-remote)            action_set_remote "$req_file" || { ok=false; ec=1; } ;;
    clone-into-vault)      action_clone_into_vault "$req_file" || { ok=false; ec=1; } ;;
    adopt-remote)          action_adopt_remote "$req_file" || { ok=false; ec=1; } ;;
    *)
      ok=false; ec=1
      ERROR=$(err_json "BAD_REQUEST" "Action not allowed: $action" "" "")
      ;;
  esac
  [ "$ERROR" != "null" ] && ok=false

  # FAILED actions still carry fresh status fields: a rejected pull or a blocked
  # commit changes what the user should see (conflict markers, dirty files), and
  # the plugin must not keep rendering the stale state. The error payload (e.g.
  # data.conflicts) is preserved by merging.
  #
  # Listed by EXCLUSION, and that direction is the point. This used to name the
  # mutating actions one by one — a second copy of the plugin's
  # MUTATING_ACTIONS, kept by hand, which had drifted: `discard-all`,
  # `reset-all`, `init-repo`, `clone-into-vault` and every action added after
  # them were missing, so a failure in any of those left the panel showing a
  # state that no longer existed.
  #
  # Inverted, the failure mode inverts with it. Forgetting to list a new
  # mutating action now costs nothing; forgetting to list a read-only one costs
  # one redundant `git status`. Neither leaves stale data on screen.
  if [ "$ok" = false ]; then
    case "$action" in
      # Read-only, or already collecting status themselves.
      ping|status|diagnostics|verify-sparse-safety|file-log|repo-log|show-file-at-commit|diff-file|exclude-list) ;;
      *)
        error_data="$DATA"
        collect_status_fields
        [ "$error_data" != "null" ] && [ -n "$error_data" ] && DATA=$(merge_data "$error_data" "$DATA")
        ;;
    esac
  fi

  write_result "$id" "$action" "$ok" "$ec" "$DATA" "$ERROR" "$started"
  log "DONE $id action=$action ok=$ok"
  json_cleanup
  mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
}

# ---- cleanup of old artifacts (24h retention) --------------------------------

cleanup_old() {
  find "$DONE_DIR" "$RES_DIR" "$CAN_DIR" -maxdepth 1 -type f -mmin +1440 -delete 2>/dev/null || true
  # A clone that was killed mid-flight (Android stopping Termux) leaves its
  # working directory behind. Nothing records that a clone finished — the
  # repository being in place IS the record — so a leftover here is by
  # definition unfinished and can go. Only after a day, so a clone still
  # running in another invocation is never pulled out from under it.
  if [ -n "$NGB_RUNTIME_DIR" ] && [ -n "$(find "$NGB_RUNTIME_DIR/clone-tmp" -maxdepth 0 -mmin +1440 2>/dev/null)" ]; then
    log "CLEANUP removing an abandoned clone working directory"
    rm -rf "$NGB_RUNTIME_DIR/clone-tmp"
  fi
  # Backstop for orphaned retry markers (their request is long gone). Live
  # *.json in processing/ never accumulates: the recovery loop drains it on
  # every run (requeue once, then give up with a result).
  find "$PROC_DIR" -maxdepth 1 -type f -name '*.retried' -mmin +1440 -delete 2>/dev/null || true
}

# ---- main --------------------------------------------------------------------

# Only one runner instance may drain the queue: two triggers arriving close
# together previously processed the same request twice (visible as duplicate
# DONE lines in the log). mkdir is atomic, so it is a safe lock primitive.
acquire_lock() {
  local waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    # Reclaim a lock left behind by a killed process (older than 10 minutes).
    if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
      log "LOCK stale lock reclaimed"
      rm -rf "$LOCK_DIR"
      continue
    fi
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge 20 ]; then
      log "LOCK another runner is active; exiting without processing"
      exit 0
    fi
  done
  trap 'rm -rf "$LOCK_DIR"; json_cleanup' EXIT
}

acquire_lock

# One line on stdout for the companion app's probe: Termux returns stdout in
# the RUN_COMMAND result bundle, so the setup screen can learn the CURRENT
# runner version right after an update instead of waiting for Obsidian to
# reopen it. Plugin-triggered runs have no result receiver — stdout is simply
# discarded there.
echo "NGB_RUNNER_VERSION=$RUNNER_VERSION"

shopt -s nullglob

# Requests interrupted mid-flight (device killed Termux) are retried ONCE.
# A `.retried` marker enforces the cap: a request that reliably kills the
# runner must not requeue forever. Markers are removed on completion, on
# give-up, and (as a backstop) by the 24 h sweep.
recover_interrupted() {
  local stale rid ract
  for stale in "$PROC_DIR"/*.json; do
    if [ -e "$stale.retried" ]; then
      log "RECOVER giving up on $(basename "$stale") (already retried once)"
      rid=$(jq -r '.id // empty' "$stale" 2>/dev/null)
      ract=$(jq -r '.action // empty' "$stale" 2>/dev/null)
      if valid_id "$rid"; then
        write_result "$rid" "${ract:-unknown}" false 1 'null' \
          "$(err_json RUNNER_INTERNAL "The request was interrupted twice and will not be retried again (see runner.log)." "" "")" \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      fi
      mv "$stale" "$DONE_DIR/" 2>/dev/null || rm -f "$stale"
      rm -f "$stale.retried"
      json_cleanup
    else
      : > "$stale.retried"
      log "RECOVER requeueing interrupted request $(basename "$stale")"
      mv "$stale" "$REQ_DIR/" 2>/dev/null || rm -f "$stale"
    fi
  done
}

# A profile whose repository is gone must never abort the whole run: its own
# queue is answered so the plugin in that vault stops waiting, and the other
# profiles are drained normally.
answer_unusable_profile() {
  local f id action token started
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for f in "$PROC_DIR"/*.json "$REQ_DIR"/*.json; do
    [ -e "$f" ] || continue
    id=$(jq -r '.id // empty' "$f" 2>/dev/null)
    action=$(jq -r '.action // empty' "$f" 2>/dev/null)
    token=$(jq -r '.token // empty' "$f" 2>/dev/null)
    if valid_id "$id" && [ "$token" = "$NGB_TOKEN" ]; then
      write_result "$id" "${action:-unknown}" false 1 'null' \
        "$(err_json REPO_MISSING "$PROFILE_UNHEALTHY_REASON" "" "")" "$started"
    fi
    mv "$f" "$DONE_DIR/" 2>/dev/null || rm -f "$f"
    json_cleanup
  done
}

migrate_legacy_config

# --- pass 1: activate every profile, recover, count work -----------------------
PROFILE_FILES=()
HEALTHY_FILES=()
HEALTHY_REPOS=()
UNHEALTHY=0
TOTAL_PENDING=0
mapfile -t PROFILE_FILES < <(list_profile_files)
if [ "${#PROFILE_FILES[@]}" -eq 0 ]; then
  log "RUN no profiles configured (run install.sh for a vault)"
fi
for conf in "${PROFILE_FILES[@]}"; do
  if activate_profile "$conf"; then
    HEALTHY_FILES+=("$conf")
    # Only a real repository takes part in the nested-vault exclusion: a vault
    # that is merely paired must not disappear from the outer repository's
    # status before it becomes a repository of its own.
    [ "$PROFILE_STATE" = "ready" ] && HEALTHY_REPOS+=("$NGB_REPO_DIR")
    recover_interrupted
    pending=("$REQ_DIR"/*.json)
    TOTAL_PENDING=$((TOTAL_PENDING + ${#pending[@]}))
  else
    UNHEALTHY=1
    log "PROFILE ${PROFILE_ID:-$(basename "$conf")} unusable: $PROFILE_UNHEALTHY_REASON"
    [ -d "$REQ_DIR" ] && answer_unusable_profile
  fi
done

# --- discovery: only when idle or when something is broken ---------------------
# An idle trigger is the signal that a vault we cannot see asked for something -
# typically a new vault requesting a profile. A missing repository may simply
# have been moved. Both are answered by one scan of shared storage; a run with
# real work to do never pays for it.
if [ "${NGB_DISCOVER:-}" = "1" ] || [ "$UNHEALTHY" = 1 ] || [ "$TOTAL_PENDING" -eq 0 ]; then
  # Cross-profile work: log it next to the profiles, not into whichever vault
  # happened to be activated last.
  LOG_FILE="$NGB_CONFIG_DIR/runner.log"
  mapfile -t MARKERS < <(scan_runtime_files)
  if [ "${#MARKERS[@]}" -gt 0 ]; then
    relocate_profiles "${MARKERS[@]}"
    adopt_claims "${MARKERS[@]}"
  fi
  # Re-activate: relocation and adoption may have added or moved work.
  HEALTHY_FILES=()
  HEALTHY_REPOS=()
  mapfile -t PROFILE_FILES < <(list_profile_files)
  for conf in "${PROFILE_FILES[@]}"; do
    if activate_profile "$conf"; then
      HEALTHY_FILES+=("$conf")
      [ "$PROFILE_STATE" = "ready" ] && HEALTHY_REPOS+=("$NGB_REPO_DIR")
      recover_interrupted
    fi
  done
fi

# Nested vaults: exclude every inner repository from its outer one (local only).
# Runs after discovery so a freshly adopted inner vault is handled immediately.
LOG_FILE="$NGB_CONFIG_DIR/runner.log"
for i in "${!HEALTHY_REPOS[@]}"; do
  for j in "${!HEALTHY_REPOS[@]}"; do
    [ "$i" = "$j" ] && continue
    case "${HEALTHY_REPOS[$j]}" in
      "${HEALTHY_REPOS[$i]}"/*) ensure_nested_exclusion "${HEALTHY_REPOS[$i]}" "${HEALTHY_REPOS[$j]}" ;;
    esac
  done
done

# --- pass 2: drain every queue, globally oldest first --------------------------
# Request ids embed a UTC timestamp, so sorting by file name orders the work
# across profiles chronologically. One request at a time, as before.
QUEUE=()
for conf in "${HEALTHY_FILES[@]}"; do
  read_profile_file "$conf" || continue
  for f in "$P_RUNTIME"/requests/*.json; do
    [ -e "$f" ] || continue
    QUEUE+=("$(printf '%s\t%s\t%s' "$(basename "$f")" "$conf" "$f")")
  done
done

if [ "${#QUEUE[@]}" -eq 0 ]; then
  log "RUN no pending requests"
else
  mapfile -t SORTED < <(printf '%s\n' "${QUEUE[@]}" | sort)
  ACTIVE_CONF=""
  for entry in "${SORTED[@]}"; do
    IFS=$'\t' read -r _reqname conf f <<< "$entry"
    if [ "$conf" != "$ACTIVE_CONF" ]; then
      activate_profile "$conf" || { log "SKIP profile $conf became unusable mid-run"; ACTIVE_CONF=""; continue; }
      ACTIVE_CONF="$conf"
    fi
    # Claim atomically: if another process took it first, mv fails and we skip.
    claimed="$PROC_DIR/$(basename "$f")"
    if mv "$f" "$claimed" 2>/dev/null; then
      process_request "$claimed"
      rm -f "$claimed.retried"   # completed: forget any interruption marker
    else
      log "SKIP $(basename "$f") already claimed"
    fi
  done
fi

for conf in "${HEALTHY_FILES[@]}"; do
  activate_profile "$conf" >/dev/null 2>&1 || continue
  cleanup_old
done
json_cleanup
exit 0
