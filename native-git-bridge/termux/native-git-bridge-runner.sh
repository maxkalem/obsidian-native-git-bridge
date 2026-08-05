#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - Termux runner (protocol v1).
# One-shot: drains pending requests, writes results, exits. Never daemonizes.
# Security: token check, action allow-list, validated paths, argv arrays only.
set -u
umask 077

RUNNER_VERSION=7
CONFIG_FILE="${NGB_CONFIG:-$HOME/.config/native-git-bridge/config}"

# Never let git block on an interactive credential prompt: with a missing or
# expired PAT the command must fail fast with a clear stderr, not hang.
export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=never
export SSH_ASKPASS=/bin/false

die() { echo "native-git-bridge-runner: $*" >&2; exit 1; }

[ -f "$CONFIG_FILE" ] || die "config not found: $CONFIG_FILE (run install.sh first)"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

: "${NGB_REPO_DIR:?NGB_REPO_DIR missing in config}"
: "${NGB_TOKEN:?NGB_TOKEN missing in config}"
NGB_RUNTIME_DIR="${NGB_RUNTIME_DIR:-$NGB_REPO_DIR/.obsidian/plugins/native-git-bridge/runtime}"
NGB_LOG_MAX_BYTES="${NGB_LOG_MAX_BYTES:-262144}"

command -v git >/dev/null 2>&1 || die "git not installed (pkg install git)"
command -v jq  >/dev/null 2>&1 || die "jq not installed (pkg install jq)"

cd "$NGB_REPO_DIR" 2>/dev/null || die "repo dir not accessible: $NGB_REPO_DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git work tree: $NGB_REPO_DIR"

REQ_DIR="$NGB_RUNTIME_DIR/requests"
PROC_DIR="$NGB_RUNTIME_DIR/processing"
LOCK_DIR="$NGB_RUNTIME_DIR/.runner.lock"
RES_DIR="$NGB_RUNTIME_DIR/results"
CAN_DIR="$NGB_RUNTIME_DIR/cancel"
DONE_DIR="$NGB_RUNTIME_DIR/done"
LOG_FILE="$NGB_RUNTIME_DIR/runner.log"
mkdir -p "$REQ_DIR" "$RES_DIR" "$CAN_DIR" "$DONE_DIR" "$PROC_DIR"

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
    --slurpfile data "$dir/data.json" \
    --slurpfile error "$dir/error.json" \
    '{protocolVersion:1,id:$id,action:$action,ok:$ok,exitCode:$exitCode,
      startedAt:$startedAt,finishedAt:$finishedAt,runnerVersion:$runnerVersion,
      data:($data[0] // null),error:($error[0] // null)}' > "$tmp" 2>>"$LOG_FILE"
  if [ ! -s "$tmp" ]; then
    # Last-resort minimal result: the plugin must never be left hanging.
    log "ERROR building result for $id (falling back to minimal result)"
    printf '{"protocolVersion":1,"id":"%s","action":"%s","ok":false,"exitCode":1,"error":{"code":"RUNNER_INTERNAL","message":"The runner could not serialize the result (see runner.log)."},"data":null}\n' \
      "$id" "$action" > "$tmp"
  fi
  mv "$tmp" "$RES_DIR/$id.json"
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
  run_git status --porcelain=v1 -- "$@" || true
  SAFE_STATUS="$GIT_OUT"
  run_git diff --cached --name-status -- "$@" || true
  SAFE_STAGED="$GIT_OUT"
}

# ---- actions -----------------------------------------------------------------

action_ping() {
  DATA=$(obj_from_fields pong "pong" runnerVersion "$RUNNER_VERSION")
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
    mergeMsg "$merge_msg")
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


# ---- phase 4 actions: history / diff / restore --------------------------------

NGB_MAX_SHOW_BYTES="${NGB_MAX_SHOW_BYTES:-1048576}"
NGB_MAX_DIFF_CHARS="${NGB_MAX_DIFF_CHARS:-200000}"

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
  if ! run_git log --follow --name-status --max-count="$limit" --skip="$skip" \
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
  local diff_out="$GIT_OUT"
  if [ "${#diff_out}" -gt "$NGB_MAX_DIFF_CHARS" ]; then
    diff_out="${diff_out:0:$NGB_MAX_DIFF_CHARS}"
    truncated=true
  fi
  DATA=$(obj_from_fields diff "$diff_out" truncated "$truncated" from "$from" to "$to" path "$path")
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

action_stage_file() {
  local req_file="$1" path mode
  path=$(jq -r '.args.path // empty' "$req_file")
  mode=$(jq -r '.args.mode // "all"' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  read_protected_paths "$req_file" || return 1
  refuse_if_protected "$path" || return 1
  case "$mode" in
    all)
      # Files and folders alike; on a folder this also picks up untracked files.
      if ! run_git add -- "$path"; then
        ERROR=$(err_json GIT_FAILED "git add failed." "$GIT_OUT" "$GIT_ERR"); return 1
      fi ;;
    update)
      # Tracked changes only (folder rows in the "Changes" group): untracked
      # files under the folder must NOT be swept in by a tracked-group action.
      if ! run_git add -u -- "$path"; then
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
  # Works for both tracked and newly added files.
  if ! run_git restore --staged -- "$path"; then
    if ! run_git rm --cached -q -- "$path"; then
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
  if git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    tracked=true
  else
    tracked=false
  fi
  if [ "$tracked" = true ]; then
    if ! run_git restore --staged --worktree -- "$path"; then
      ERROR=$(err_json GIT_FAILED "git restore failed." "$GIT_OUT" "$GIT_ERR"); return 1
    fi
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
    file-log)              action_file_log "$req_file" || { ok=false; ec=1; } ;;
    repo-log)              action_repo_log "$req_file" || { ok=false; ec=1; } ;;
    resolve-conflict)      action_resolve_conflict "$req_file" || { ok=false; ec=1; } ;;
    show-file-at-commit)   action_show_file_at_commit "$req_file" || { ok=false; ec=1; } ;;
    diff-file)             action_diff_file "$req_file" || { ok=false; ec=1; } ;;
    restore-file)          action_restore_file "$req_file" || { ok=false; ec=1; } ;;
    stage-file)            action_stage_file "$req_file" || { ok=false; ec=1; } ;;
    unstage-file)          action_unstage_file "$req_file" || { ok=false; ec=1; } ;;
    discard-file)          action_discard_file "$req_file" || { ok=false; ec=1; } ;;
    stage-all)             action_stage_all "$req_file" || { ok=false; ec=1; } ;;
    unstage-all)           action_unstage_all "$req_file" || { ok=false; ec=1; } ;;
    sparse-exclude-add)    action_sparse_exclude_add "$req_file" || { ok=false; ec=1; } ;;
    sparse-exclude-remove) action_sparse_exclude_remove "$req_file" || { ok=false; ec=1; } ;;
    exclude-add)           action_exclude_add "$req_file" || { ok=false; ec=1; } ;;
    exclude-remove)        action_exclude_remove "$req_file" || { ok=false; ec=1; } ;;
    exclude-list)          action_exclude_list || { ok=false; ec=1; } ;;
    *)
      ok=false; ec=1
      ERROR=$(err_json "BAD_REQUEST" "Action not allowed: $action" "" "")
      ;;
  esac
  [ "$ERROR" != "null" ] && ok=false

  # FAILED mutating actions still carry fresh status fields: a rejected pull
  # or a blocked commit changes what the user should see (conflict markers,
  # dirty files), and the plugin must not keep rendering the stale state. The
  # error payload (e.g. data.conflicts) is preserved by merging.
  if [ "$ok" = false ]; then
    case "$action" in
      pull|commit|push|sync|sparse-reapply|restore-file|abort-merge|stage-file|unstage-file|discard-file|stage-all|unstage-all|resolve-conflict)
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

# Requests interrupted mid-flight (device killed Termux) are retried ONCE.
# A `.retried` marker enforces the cap: a request that reliably kills the
# runner must not requeue forever. Markers are removed on completion, on
# give-up, and (as a backstop) by the 24 h sweep.
shopt -s nullglob
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

pending=("$REQ_DIR"/*.json)
if [ "${#pending[@]}" -eq 0 ]; then
  log "RUN no pending requests"
else
  # oldest first (ids embed a UTC timestamp, so lexical sort is chronological)
  mapfile -t sorted < <(printf '%s\n' "${pending[@]}" | sort)
  for f in "${sorted[@]}"; do
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
cleanup_old
json_cleanup
exit 0
