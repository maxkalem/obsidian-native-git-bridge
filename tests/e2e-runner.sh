#!/usr/bin/env bash
# End-to-end test of the Termux runner against a real git repository with
# non-cone sparse checkout, executed on plain Linux (identical git semantics;
# Android storage quirks are covered in docs/limitations.md).
set -u

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok - $*"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $*"; }
check(){ if eval "$1"; then ok "$2"; else bad "$2"; fi; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$SCRIPT_DIR/native-git-bridge/termux/native-git-bridge-runner.sh"

echo "# setup: bare remote + working clone with protected dirs"
git init -q --bare "$ROOT/remote.git"
git clone -q "$ROOT/remote.git" "$ROOT/vault" 2>/dev/null
cd "$ROOT/vault"
git config user.email test@example.com
git config user.name Test
mkdir -p Notes "Private/AgentsMemory" "Projects/Backus"
echo "note" > Notes/note.md
echo "note with space" > "Notes/unicode nøte.md"
echo "secret memory" > Private/AgentsMemory/mem.md
echo "backus spec" > Projects/Backus/spec.md
git add -A && git commit -qm "initial" && git push -q origin HEAD

echo "# setup: non-cone sparse checkout excluding protected dirs"
git sparse-checkout init 2>/dev/null
git sparse-checkout set '/*' '!Private/AgentsMemory/' '!Projects/Backus/' 2>/dev/null
check '[ "$(git config core.sparseCheckout)" = "true" ]' "core.sparseCheckout enabled"
check '[ ! -e Private/AgentsMemory/mem.md ]' "protected file removed from worktree by sparse checkout"
check 'git ls-files -v | grep -q "^S Private/AgentsMemory/mem.md"' "skip-worktree bit set on protected file"
check '[ -z "$(git status --porcelain=v1)" ]' "sparse omission does NOT appear as a change (not a deletion)"

echo "# setup: runner config"
TOKEN="e2e-test-token-123"
RUNTIME="$ROOT/vault/.obsidian/plugins/native-git-bridge/runtime"
mkdir -p "$RUNTIME/requests" "$ROOT/conf"
# Mirror the installer: the runtime dir is locally excluded, never committed.
echo ".obsidian/plugins/native-git-bridge/runtime/" >> .git/info/exclude
cat > "$ROOT/conf/config" <<CONF
NGB_REPO_DIR="$ROOT/vault"
NGB_TOKEN="$TOKEN"
NGB_RUNTIME_DIR="$RUNTIME"
CONF
export NGB_CONFIG="$ROOT/conf/config"

req() { # $1 id, $2 action, $3 token, $4 extra-args-json
  local args="${4:-}"
  [ -z "$args" ] && args='{}'
  cat > "$RUNTIME/requests/$1.json" <<REQ
{"protocolVersion":1,"id":"$1","token":"$3","action":"$2","createdAt":"2026-08-03T10:00:00Z","timeoutSeconds":30,"args":$args}
REQ
}

echo "# test: ping round trip"
req "r-20260803T100000Z-ping01" ping "$TOKEN"
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260803T100000Z-ping01.json" >/dev/null' "ping result ok=true"
check '[ ! -e "$RUNTIME/requests/r-20260803T100000Z-ping01.json" ]' "request consumed (moved to done/)"
check '[ -e "$RUNTIME/done/r-20260803T100000Z-ping01.json" ]' "request archived in done/"

echo "# test: auth rejection with wrong token"
req "r-20260803T100001Z-auth01" status "WRONG"
bash "$RUNNER"
check 'jq -e ".ok == false and .error.code == \"AUTH\"" "$RUNTIME/results/r-20260803T100001Z-auth01.json" >/dev/null' "wrong token -> AUTH error, no execution"

echo "# test: unknown action rejected by allow-list"
req "r-20260803T100002Z-bad001" "rm-rf-everything" "$TOKEN"
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100002Z-bad001.json" >/dev/null' "unknown action -> BAD_REQUEST"

echo "# test: status action returns branch + sparse fields"
req "r-20260803T100003Z-stat01" status "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100003Z-stat01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "status ok"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head"' "status contains porcelain v2 branch header"
check '[ "$(jq -r ".data.sparseEnabled" "$RES")" = "true" ]' "status reports sparse enabled"
check 'jq -er ".data.sparseList" "$RES" | grep -q "AgentsMemory"' "status lists sparse patterns"
check 'jq -er ".data.lsFilesV" "$RES" | grep -q "^S "' "status reports skip-worktree entries"

echo "# test: verify-sparse-safety - clean tree is SAFE (omissions are not deletions)"
req "r-20260803T100004Z-safe01" verify-sparse-safety "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100004Z-safe01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "safety action ok"
check '[ -z "$(jq -r ".data.statusProtected" "$RES")" ]' "no worktree changes reported for protected paths"
check '[ -z "$(jq -r ".data.stagedProtected" "$RES")" ]' "no staged changes reported for protected paths"

echo "# test: verify-sparse-safety detects a real staged deletion of a protected path"
# Use plumbing to stage a deletion of a protected path (porcelain git rm is
# blocked by the sparse rules; a buggy tool or isomorphic-git would not be).
git update-index --force-remove Private/AgentsMemory/mem.md
req "r-20260803T100005Z-safe02" verify-sparse-safety "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100005Z-safe02.json"
check 'jq -er ".data.stagedProtected" "$RES" | grep -q "^D.*mem.md"' "staged deletion of protected path detected"
# restore index and sparse bits
git reset -q -- Private/AgentsMemory/mem.md
git sparse-checkout reapply 2>/dev/null || true

echo "# test: path traversal in protectedPaths rejected"
req "r-20260803T100006Z-trav01" verify-sparse-safety "$TOKEN" '{"protectedPaths":["../outside"]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100006Z-trav01.json" >/dev/null' "traversal path -> BAD_REQUEST"

echo "# test: sparse-reapply"
req "r-20260803T100007Z-reap01" sparse-reapply "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100007Z-reap01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sparse-reapply ok"
check 'jq -er ".data.sparseList" "$RES" | grep -q "AgentsMemory"' "sparse-reapply returns pattern list"
check '[ ! -e Private/AgentsMemory/mem.md ]' "protected file hidden again after reapply"

echo "# test: cancellation flag prevents execution"
req "r-20260803T100008Z-canc01" status "$TOKEN"
mkdir -p "$RUNTIME/cancel"; touch "$RUNTIME/cancel/r-20260803T100008Z-canc01"
bash "$RUNNER"
check 'jq -e ".error.code == \"CANCELLED\"" "$RUNTIME/results/r-20260803T100008Z-canc01.json" >/dev/null' "cancel flag -> CANCELLED result"

echo "# test: diagnostics"
req "r-20260803T100009Z-diag01" diagnostics "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100009Z-diag01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "diagnostics ok"
check 'jq -er ".data.gitVersion" "$RES" | grep -q "git version"' "diagnostics reports git version"
check '[ "$(jq -r ".data.sparseEnabled" "$RES")" = "true" ]' "diagnostics reports sparse state"
check 'jq -er ".data.authMethod" "$RES" | grep -q .' "diagnostics reports auth method"

echo "# phase 3: commit + push to a real remote"
echo "more" >> Notes/note.md
req "r-20260803T100010Z-comm01" commit "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"],"message":"e2e: edit note"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100010Z-comm01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "commit ok"
check '[ "$(jq -r ".data.committed" "$RES")" = "true" ]' "commit created"
req "r-20260803T100011Z-push01" push "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260803T100011Z-push01.json" >/dev/null' "push ok"
check '[ "$(git rev-parse HEAD)" = "$(git -C "$ROOT/remote.git" rev-parse HEAD)" ]' "remote updated by push"

echo "# phase 3: empty commit is a no-op, not an error"
req "r-20260803T100012Z-comm02" commit "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"],"message":"e2e: nothing"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100012Z-comm02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "no-op commit ok"
check '[ "$(jq -r ".data.committed" "$RES")" = "false" ]' "no commit created when tree clean"

echo "# phase 3: sync merges remote changes and pushes local ones"
git clone -q "$ROOT/remote.git" "$ROOT/other" 2>/dev/null
git -C "$ROOT/other" config user.email o@e; git -C "$ROOT/other" config user.name o
echo "remote side" > "$ROOT/other/FromOther.md"
git -C "$ROOT/other" add -A && git -C "$ROOT/other" commit -qm "other: add file" && git -C "$ROOT/other" push -q
echo "local side" > Notes/local.md
req "r-20260803T100013Z-sync01" sync "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"],"message":"e2e: sync"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100013Z-sync01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sync ok"
check '[ -f FromOther.md ]' "remote change merged into worktree"
check '[ "$(jq -r ".data.pushed" "$RES")" = "true" ]' "local change pushed"
check 'git -C "$ROOT/remote.git" cat-file -e "$(git rev-parse HEAD)" && [ "$(git rev-parse HEAD)" = "$(git -C "$ROOT/remote.git" rev-parse HEAD)" ]' "remote head equals local after sync"
check 'jq -er ".data.steps" "$RES" | grep -q "safety-preflight-ok"' "sync recorded safety pre-flight"
check '[ ! -e Private/AgentsMemory/mem.md ]' "protected dir still sparse-hidden after sync"

echo "# phase 3: sync is blocked when a protected path shows changes"
mkdir -p Private/AgentsMemory
echo "accidental" > Private/AgentsMemory/leak.md
HEAD_BEFORE="$(git rev-parse HEAD)"
req "r-20260803T100014Z-sync02" sync "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"],"message":"e2e: should block"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100014Z-sync02.json"
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$RES" >/dev/null' "sync blocked with SAFETY_BLOCKED"
check 'jq -er ".error.message" "$RES" | grep -q "No commit or push was performed"' "mandated warning text present"
check '[ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ]' "no commit was created"
check 'git diff --cached --quiet' "nothing was staged"
rm -f Private/AgentsMemory/leak.md; rmdir Private/AgentsMemory 2>/dev/null || true

echo "# phase 3: conflicting histories stop the sync, nothing is pushed"
sed -i 's/^note$/local edit/' Notes/note.md 2>/dev/null || printf 'local edit\nmore\n' > Notes/note.md
git add Notes/note.md && git commit -qm "local: edit note"
sed -i '1s/.*/remote edit/' "$ROOT/other/Notes/note.md"
git -C "$ROOT/other" pull -q --no-rebase 2>/dev/null || true
git -C "$ROOT/other" add -A && git -C "$ROOT/other" commit -qm "other: conflicting edit" && git -C "$ROOT/other" push -q
REMOTE_BEFORE="$(git -C "$ROOT/remote.git" rev-parse HEAD)"
req "r-20260803T100015Z-sync03" sync "$TOKEN" '{"protectedPaths":["Private/AgentsMemory","Projects/Backus"],"message":"e2e: conflict"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100015Z-sync03.json"
check 'jq -e ".error.code == \"CONFLICT\"" "$RES" >/dev/null' "sync reports CONFLICT"
check 'jq -er ".data.conflicts" "$RES" | grep -q "Notes/note.md"' "conflicted file listed"
check '[ "$(git -C "$ROOT/remote.git" rev-parse HEAD)" = "$REMOTE_BEFORE" ]' "nothing pushed on conflict"

echo "# phase 3: abort-merge restores pre-merge state"
req "r-20260803T100016Z-abrt01" abort-merge "$TOKEN"
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260803T100016Z-abrt01.json" >/dev/null' "abort-merge ok"
check '! git diff --name-only --diff-filter=U | grep -q .' "no conflicted files remain"
check '[ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ]' "MERGE_HEAD removed"

echo "# test: runner exits (no daemon) and log has no token"
check '! grep -q "$TOKEN" "$RUNTIME/runner.log"' "token never written to runner.log"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
