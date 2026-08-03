#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - Termux runner (protocol v1).
# One-shot: drains pending requests, writes results, exits. Never daemonizes.
# Security: token check, action allow-list, validated paths, argv arrays only.
set -u
umask 077

RUNNER_VERSION=1
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
RES_DIR="$NGB_RUNTIME_DIR/results"
CAN_DIR="$NGB_RUNTIME_DIR/cancel"
DONE_DIR="$NGB_RUNTIME_DIR/done"
LOG_FILE="$NGB_RUNTIME_DIR/runner.log"
mkdir -p "$REQ_DIR" "$RES_DIR" "$CAN_DIR" "$DONE_DIR"

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
  # no control chars, not inside .git
  local p="$1"
  [ -n "$p" ] || return 1
  case "$p" in
    /*|*\\*|~*) return 1 ;;
    ..|../*|*/..|*/../*) return 1 ;;
    .git|.git/*) return 1 ;;
  esac
  printf '%s' "$p" | LC_ALL=C grep -q '[[:cntrl:]]' && return 1
  return 0
}

# ---- result writing ----------------------------------------------------------

write_result() {
  # $1 id, $2 action, $3 ok(true/false), $4 exitCode, $5 dataJson, $6 errorJson, $7 startedAt
  local id="$1" action="$2" ok="$3" ec="$4" data="$5" err="$6" started="$7"
  local tmp="$RES_DIR/$id.json.tmp"
  jq -n \
    --argjson protocolVersion 1 \
    --arg id "$id" \
    --arg action "$action" \
    --argjson ok "$ok" \
    --argjson exitCode "$ec" \
    --arg startedAt "$started" \
    --arg finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson runnerVersion "$RUNNER_VERSION" \
    --argjson data "$data" \
    --argjson error "$err" \
    '{protocolVersion:$protocolVersion,id:$id,action:$action,ok:$ok,exitCode:$exitCode,
      startedAt:$startedAt,finishedAt:$finishedAt,runnerVersion:$runnerVersion,
      data:$data,error:$error}' > "$tmp" || { log "ERROR building result for $id"; rm -f "$tmp"; return 1; }
  mv "$tmp" "$RES_DIR/$id.json"
}

err_json() {
  # $1 code, $2 message, $3 stdout, $4 stderr
  jq -n --arg code "$1" --arg message "$2" --arg out "${3:-}" --arg err "${4:-}" \
    '{code:$code,message:$message,stdout:$out,stderr:$err}'
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
  DATA=$(jq -n --arg pong "pong" --argjson v "$RUNNER_VERSION" '{pong:$pong,runnerVersion:($v|tostring)}')
}

collect_status_fields() {
  run_git status --porcelain=v2 --branch || true; local branch_info="$GIT_OUT"
  local sparse_enabled sparse_cone sparse_list ls_v last_commit remote_url
  sparse_enabled="$(git config --get core.sparseCheckout 2>/dev/null || true)"
  sparse_cone="$(git config --get core.sparseCheckoutCone 2>/dev/null || true)"
  sparse_list="$(git sparse-checkout list 2>/dev/null || true)"
  ls_v="$(git ls-files -v 2>/dev/null | grep '^S ' || true)"
  last_commit="$(git log -1 --format='%H%x09%cI%x09%s' 2>/dev/null || true)"
  remote_url="$(git remote get-url origin 2>/dev/null | redact_url || true)"
  DATA=$(jq -n \
    --arg branchInfo "$branch_info" \
    --arg sparseEnabled "$sparse_enabled" \
    --arg sparseCone "$sparse_cone" \
    --arg sparseList "$sparse_list" \
    --arg lsFilesV "$ls_v" \
    --arg lastCommit "$last_commit" \
    --arg remoteUrl "$remote_url" \
    '{branchInfo:$branchInfo,sparseEnabled:$sparseEnabled,sparseCone:$sparseCone,
      sparseList:$sparseList,lsFilesV:$lsFilesV,lastCommit:$lastCommit,remoteUrl:$remoteUrl}')
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
  DATA=$(jq -n \
    --arg statusProtected "$SAFE_STATUS" \
    --arg stagedProtected "$SAFE_STAGED" \
    --arg protectedPaths "$plist" \
    '{statusProtected:$statusProtected,stagedProtected:$stagedProtected,protectedPaths:$protectedPaths}')
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
  DATA=$(jq -n --arg reapplyOutput "$reapply_out" --arg sparseList "$sparse_list" \
    '{reapplyOutput:$reapplyOutput,sparseList:$sparseList}')
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
  DATA=$(jq -n \
    --arg gitVersion "$git_version" \
    --arg jqVersion "$jq_version" \
    --arg repoRoot "$repo_root" \
    --arg insideWorkTree "$inside" \
    --arg sparseEnabled "$sparse_enabled" \
    --arg sparseCone "$sparse_cone" \
    --arg sparsePatternCount "$cone_patterns" \
    --arg skipWorktreeCount "$skip_count" \
    --arg remoteUrl "$remote_url" \
    --arg safeDirectory "$safe_dir" \
    --arg authMethod "$auth_method" \
    --arg runnerVersion "$RUNNER_VERSION" \
    '{gitVersion:$gitVersion,jqVersion:$jqVersion,repoRoot:$repoRoot,insideWorkTree:$insideWorkTree,
      sparseEnabled:$sparseEnabled,sparseCone:$sparseCone,sparsePatternCount:$sparsePatternCount,
      skipWorktreeCount:$skipWorktreeCount,remoteUrl:$remoteUrl,safeDirectory:$safeDirectory,
      authMethod:$authMethod,runnerVersion:$runnerVersion}')
}


# ---- phase 3 helpers ----------------------------------------------------------

NGB_NET_TIMEOUT="${NGB_NET_TIMEOUT:-120}"

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

merge_data() { # $1 jsonA, $2 jsonB -> stdout merged
  jq -n --argjson a "$1" --argjson b "$2" '$a * $b'
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
    DATA=$(jq -n --arg statusProtected "$SAFE_STATUS" --arg stagedProtected "$SAFE_STAGED" \
      '{statusProtected:$statusProtected,stagedProtected:$stagedProtected}')
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
  DATA=$(merge_data "$DATA" "$(jq -n --arg fetchOutput "$fetch_out" '{fetchOutput:$fetchOutput}')")
}

action_pull() {
  local req_file="$1"
  read_protected_paths "$req_file" || return 1
  if merge_in_progress; then
    ERROR=$(err_json "CONFLICT" "A merge is already in progress. Resolve or abort it first." "" "")
    DATA=$(jq -n --arg conflicts "$(conflicted_files)" '{conflicts:$conflicts}')
    return 1
  fi
  if ! run_git_net pull --no-rebase --no-edit; then
    local pull_out="$GIT_OUT" pull_err="$GIT_ERR"
    local conf; conf="$(conflicted_files)"
    if [ -n "$conf" ]; then
      DATA=$(jq -n --arg conflicts "$conf" --arg pullOutput "$pull_out" '{conflicts:$conflicts,pullOutput:$pullOutput}')
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
  DATA=$(merge_data "$DATA" "$(jq -n --arg pullOutput "$pull_out" '{pullOutput:$pullOutput}')")
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
  DATA=$(merge_data "$DATA" "$(jq -n --argjson committed "$committed" --arg newHead "$new_head" --arg commitOutput "$commit_out" \
    '{committed:($committed|tostring),newHead:$newHead,commitOutput:$commitOutput}')")
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
  DATA=$(merge_data "$DATA" "$(jq -n --arg pushOutput "$push_out" '{pushOutput:$pushOutput}')")
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
    DATA=$(jq -n --arg conflicts "$(conflicted_files)" --arg steps "$steps" '{conflicts:$conflicts,steps:$steps}')
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
        DATA=$(jq -n --arg conflicts "$conf" --arg steps "$steps" --arg pullOutput "$pull_out" \
          '{conflicts:$conflicts,steps:$steps,pullOutput:$pullOutput}')
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
  DATA=$(merge_data "$DATA" "$(jq -n \
    --arg steps "$steps" \
    --arg committed "$committed" \
    --arg pushed "$pushed" \
    '{steps:$steps,committed:$committed,pushed:$pushed}')")
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

valid_commitish() { printf '%s' "$1" | grep -Eq '^(HEAD|[0-9a-fA-F]{4,40})$'; }

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
  DATA=$(jq -n --arg log "$GIT_OUT" --arg path "$path" --arg limit "$limit" --arg skip "$skip" \
    '{log:$log,path:$path,limit:$limit,skip:$skip}')
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
  DATA=$(jq -n --arg contentBase64 "$content" --arg size "$size" --arg commit "$commit" --arg path "$path" \
    '{contentBase64:$contentBase64,size:$size,commit:$commit,path:$path}')
}

action_diff_file() {
  local req_file="$1"
  local path from to truncated=false
  path=$(jq -r '.args.path // empty' "$req_file")
  from=$(jq -r '.args.from // empty' "$req_file")
  to=$(jq -r '.args.to // "WORKTREE"' "$req_file")
  valid_rel_path "$path" || { ERROR=$(err_json BAD_REQUEST "Invalid file path." "" ""); return 1; }
  valid_commitish "$from" || { ERROR=$(err_json BAD_REQUEST "Invalid 'from' commit." "" ""); return 1; }
  if [ "$to" = "WORKTREE" ]; then
    run_git diff --find-renames "$from" -- "$path" || true
  else
    valid_commitish "$to" || { ERROR=$(err_json BAD_REQUEST "Invalid 'to' commit." "" ""); return 1; }
    run_git diff --find-renames "$from" "$to" -- "$path" || true
  fi
  [ $GIT_EC -gt 1 ] && { ERROR=$(err_json GIT_FAILED "git diff failed." "$GIT_OUT" "$GIT_ERR"); return 1; }
  local diff_out="$GIT_OUT"
  if [ "${#diff_out}" -gt "$NGB_MAX_DIFF_CHARS" ]; then
    diff_out="${diff_out:0:$NGB_MAX_DIFF_CHARS}"
    truncated=true
  fi
  DATA=$(jq -n --arg diff "$diff_out" --argjson truncated "$truncated" --arg from "$from" --arg to "$to" --arg path "$path" \
    '{diff:$diff,truncated:($truncated|tostring),from:$from,to:$to,path:$path}')
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
  DATA=$(merge_data "$DATA" "$(jq -n --arg restored "true" --arg path "$path" --arg commit "$commit" \
    '{restored:$restored,restoredPath:$path,restoredFrom:$commit}')")
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
    show-file-at-commit)   action_show_file_at_commit "$req_file" || { ok=false; ec=1; } ;;
    diff-file)             action_diff_file "$req_file" || { ok=false; ec=1; } ;;
    restore-file)          action_restore_file "$req_file" || { ok=false; ec=1; } ;;
    *)
      ok=false; ec=1
      ERROR=$(err_json "BAD_REQUEST" "Action not allowed: $action" "" "")
      ;;
  esac
  [ "$ERROR" != "null" ] && ok=false

  write_result "$id" "$action" "$ok" "$ec" "$DATA" "$ERROR" "$started"
  log "DONE $id action=$action ok=$ok"
  mv "$req_file" "$DONE_DIR/" 2>/dev/null || rm -f "$req_file"
}

# ---- cleanup of old artifacts (24h retention) --------------------------------

cleanup_old() {
  find "$DONE_DIR" "$RES_DIR" "$CAN_DIR" -maxdepth 1 -type f -mmin +1440 -delete 2>/dev/null || true
}

# ---- main --------------------------------------------------------------------

shopt -s nullglob
pending=("$REQ_DIR"/*.json)
if [ "${#pending[@]}" -eq 0 ]; then
  log "RUN no pending requests"
else
  # oldest first (ids embed a UTC timestamp, so lexical sort is chronological)
  mapfile -t sorted < <(printf '%s\n' "${pending[@]}" | sort)
  for f in "${sorted[@]}"; do
    process_request "$f"
  done
fi
cleanup_old
exit 0
