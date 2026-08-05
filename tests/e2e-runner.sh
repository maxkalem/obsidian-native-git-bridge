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
mkdir -p Notes "Private/Hidden" "Projects/Archive"
echo "note" > Notes/note.md
echo "note with space" > "Notes/unicode nøte.md"
echo "hidden note" > Private/Hidden/mem.md
echo "archive spec" > Projects/Archive/spec.md
git add -A && git commit -qm "initial" && git push -q origin HEAD

echo "# setup: non-cone sparse checkout excluding protected dirs"
# git >= 2.36 defaults `sparse-checkout set` to cone mode, which rejects
# exclusion patterns ("specify directories rather than patterns") and would
# silently leave the cone default `/* !/*/` in place. Request pattern mode
# explicitly — the user's real vault uses non-cone rules.
git sparse-checkout set --no-cone '/*' '!Private/Hidden/' '!Projects/Archive/' 2>/dev/null
check '[ "$(git config core.sparseCheckout)" = "true" ]' "core.sparseCheckout enabled"
check '[ "$(git config core.sparseCheckoutCone 2>/dev/null || echo false)" != "true" ]' "non-cone (pattern) mode active"
check '[ ! -e Private/Hidden/mem.md ]' "protected file removed from worktree by sparse checkout"
check 'git ls-files -v | grep -q "^S Private/Hidden/mem.md"' "skip-worktree bit set on protected file"
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
  # createdAt must be fresh: the runner expires requests older than
  # timeoutSeconds + NGB_EXPIRY_GRACE instead of executing them.
  cat > "$RUNTIME/requests/$1.json" <<REQ
{"protocolVersion":1,"id":"$1","token":"$3","action":"$2","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","timeoutSeconds":30,"args":$args}
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
check 'jq -er ".data.sparseList" "$RES" | grep -q "Hidden"' "status lists sparse patterns"
check '[ "$(jq -r ".data.skipWorktreeCount" "$RES")" -ge 1 ]' "status reports skip-worktree count"

echo "# test: status enumerates files inside untracked directories (untrackedChildren)"
# git status collapses a fully untracked directory into one "dir/" entry; the
# plugin needs the files inside as actionable rows, so the runner lists them.
mkdir -p "New Folder/nested"
echo "one" > "New Folder/idea one.md"
echo "two" > "New Folder/nested/idea two.md"
echo "loose" > loose.md
req "r-20260803T100003Z-stat02" status "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100003Z-stat02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "status ok with untracked directory present"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "^? \"\\?New Folder/"' "porcelain still collapses the directory to one entry"
check 'jq -er ".data.untrackedChildren" "$RES" | grep -qx "New Folder/idea one.md"' "untrackedChildren lists a file inside the new folder"
check 'jq -er ".data.untrackedChildren" "$RES" | grep -qx "New Folder/nested/idea two.md"' "untrackedChildren lists a nested file"
check '! jq -er ".data.untrackedChildren" "$RES" | grep -qx "loose.md"' "loose untracked file is NOT duplicated into untrackedChildren"
check '! jq -er ".data.untrackedChildren" "$RES" | grep -q "Private/Hidden"' "sparse-hidden protected files never appear as untracked children"
rm -rf "New Folder" loose.md

echo "# test: verify-sparse-safety - clean tree is SAFE (omissions are not deletions)"
req "r-20260803T100004Z-safe01" verify-sparse-safety "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100004Z-safe01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "safety action ok"
check '[ -z "$(jq -r ".data.statusProtected" "$RES")" ]' "no worktree changes reported for protected paths"
check '[ -z "$(jq -r ".data.stagedProtected" "$RES")" ]' "no staged changes reported for protected paths"

echo "# test: verify-sparse-safety detects a real staged deletion of a protected path"
# Use plumbing to stage a deletion of a protected path (porcelain git rm is
# blocked by the sparse rules; a buggy tool or isomorphic-git would not be).
git update-index --force-remove Private/Hidden/mem.md
req "r-20260803T100005Z-safe02" verify-sparse-safety "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100005Z-safe02.json"
check 'jq -er ".data.stagedProtected" "$RES" | grep -q "^D.*mem.md"' "staged deletion of protected path detected"
# restore index and sparse bits
git reset -q -- Private/Hidden/mem.md
git sparse-checkout reapply 2>/dev/null || true

echo "# test: path traversal in protectedPaths rejected"
req "r-20260803T100006Z-trav01" verify-sparse-safety "$TOKEN" '{"protectedPaths":["../outside"]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100006Z-trav01.json" >/dev/null' "traversal path -> BAD_REQUEST"

echo "# test: git pathspec magic in file paths rejected (':/' would address the whole repo)"
req "r-20260803T100006Z-mag001" stage-file "$TOKEN" '{"path":":/","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100006Z-mag001.json" >/dev/null' "stage-file ':/' -> BAD_REQUEST (no repo-wide staging)"
check 'git diff --cached --quiet' "nothing was staged by the pathspec-magic attempt"
req "r-20260803T100006Z-mag002" file-log "$TOKEN" '{"path":":(glob)**"}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100006Z-mag002.json" >/dev/null' "file-log ':(glob)**' -> BAD_REQUEST"

echo "# test: .git may not appear as any path segment, in any case"
req "r-20260803T100006Z-git001" discard-file "$TOKEN" '{"path":".GIT/config","protectedPaths":[]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100006Z-git001.json" >/dev/null' "discard-file '.GIT/config' -> BAD_REQUEST (case-insensitive guard)"
check '[ -f .git/config ]' ".git/config untouched"
req "r-20260803T100006Z-git002" stage-file "$TOKEN" '{"path":"sub/.git/hooks/pre-commit","protectedPaths":[]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100006Z-git002.json" >/dev/null' "nested .git segment -> BAD_REQUEST"

echo "# test: sparse-reapply"
req "r-20260803T100007Z-reap01" sparse-reapply "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100007Z-reap01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sparse-reapply ok"
check 'jq -er ".data.sparseList" "$RES" | grep -q "Hidden"' "sparse-reapply returns pattern list"
check '[ ! -e Private/Hidden/mem.md ]' "protected file hidden again after reapply"

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
req "r-20260803T100010Z-comm01" commit "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"],"message":"e2e: edit note"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100010Z-comm01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "commit ok"
check '[ "$(jq -r ".data.committed" "$RES")" = "true" ]' "commit created"
req "r-20260803T100011Z-push01" push "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260803T100011Z-push01.json" >/dev/null' "push ok"
check '[ "$(git rev-parse HEAD)" = "$(git -C "$ROOT/remote.git" rev-parse HEAD)" ]' "remote updated by push"

echo "# phase 3: empty commit is a no-op, not an error"
req "r-20260803T100012Z-comm02" commit "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"],"message":"e2e: nothing"}'
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
req "r-20260803T100013Z-sync01" sync "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"],"message":"e2e: sync"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100013Z-sync01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sync ok"
check '[ -f FromOther.md ]' "remote change merged into worktree"
check '[ "$(jq -r ".data.pushed" "$RES")" = "true" ]' "local change pushed"
check 'git -C "$ROOT/remote.git" cat-file -e "$(git rev-parse HEAD)" && [ "$(git rev-parse HEAD)" = "$(git -C "$ROOT/remote.git" rev-parse HEAD)" ]' "remote head equals local after sync"
check 'jq -er ".data.steps" "$RES" | grep -q "safety-preflight-ok"' "sync recorded safety pre-flight"
check '[ ! -e Private/Hidden/mem.md ]' "protected dir still sparse-hidden after sync"

echo "# phase 3: sync is blocked when a protected path shows changes"
mkdir -p Private/Hidden
echo "accidental" > Private/Hidden/leak.md
HEAD_BEFORE="$(git rev-parse HEAD)"
req "r-20260803T100014Z-sync02" sync "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"],"message":"e2e: should block"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100014Z-sync02.json"
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$RES" >/dev/null' "sync blocked with SAFETY_BLOCKED"
check 'jq -er ".error.message" "$RES" | grep -q "No commit or push was performed"' "mandated warning text present"
check '[ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ]' "no commit was created"
check 'git diff --cached --quiet' "nothing was staged"
rm -f Private/Hidden/leak.md; rmdir Private/Hidden 2>/dev/null || true

echo "# phase 3: conflicting histories stop the sync, nothing is pushed"
sed -i 's/^note$/local edit/' Notes/note.md 2>/dev/null || printf 'local edit\nmore\n' > Notes/note.md
git add Notes/note.md && git commit -qm "local: edit note"
sed -i '1s/.*/remote edit/' "$ROOT/other/Notes/note.md"
git -C "$ROOT/other" pull -q --no-rebase 2>/dev/null || true
git -C "$ROOT/other" add -A && git -C "$ROOT/other" commit -qm "other: conflicting edit" && git -C "$ROOT/other" push -q
REMOTE_BEFORE="$(git -C "$ROOT/remote.git" rev-parse HEAD)"
req "r-20260803T100015Z-sync03" sync "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"],"message":"e2e: conflict"}'
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

echo "# phase 3: resolve-conflict keeps the chosen side and marks the file resolved"
git pull -q --no-rebase 2>/dev/null || true   # recreate the same conflict
check 'git ls-files -u | grep -q "Notes/note.md"' "conflict reproduced for resolve tests"
req "r-20260803T100017Z-res001" resolve-conflict "$TOKEN" '{"path":"Notes/note.md","side":"both","protectedPaths":[]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100017Z-res001.json" >/dev/null' "invalid side -> BAD_REQUEST"
req "r-20260803T100017Z-res002" resolve-conflict "$TOKEN" '{"path":"Notes/unicode nøte.md","side":"ours","protectedPaths":[]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260803T100017Z-res002.json" >/dev/null' "non-conflicted file -> BAD_REQUEST"
req "r-20260803T100017Z-res003" resolve-conflict "$TOKEN" '{"path":"Private/Hidden/mem.md","side":"ours","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$RUNTIME/results/r-20260803T100017Z-res003.json" >/dev/null' "protected path -> SAFETY_BLOCKED"
req "r-20260803T100017Z-res004" resolve-conflict "$TOKEN" '{"path":"Notes/note.md","side":"ours","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100017Z-res004.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "resolve-conflict (ours) ok"
check 'grep -q "local edit" Notes/note.md' "worktree keeps OUR content"
check '! grep -q "remote edit" Notes/note.md' "their content is gone"
check '! git ls-files -u | grep -q "Notes/note.md"' "file no longer unmerged (marked resolved)"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head"' "fresh status rides along"
git commit -qm "e2e: merge resolved (ours)" && git push -q 2>/dev/null || true

echo "# phase 4: file history with rename tracking"
printf 'v1\n' > "Notes/hist note.md"
git add -A && git commit -qm "hist: create"
printf 'v1\nv2\n' > "Notes/hist note.md"
git add -A && git commit -qm "hist: edit"
git mv "Notes/hist note.md" "Notes/hist renamed.md"
git commit -qm "hist: rename"
req "r-20260804T100000Z-log001" file-log "$TOKEN" '{"path":"Notes/hist renamed.md","limit":10,"skip":0}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100000Z-log001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "file-log ok"
check '[ "$(jq -r ".data.log" "$RES" | grep -c "hist:")" = "3" ]' "file-log follows across the rename (3 commits)"
check 'jq -r ".data.log" "$RES" | grep -q "hist note.md"' "historical name present in log"

echo "# phase 4: show file at old commit (pre-rename path)"
OLD_HASH="$(git log --format=%H --reverse -- "Notes/hist renamed.md" "Notes/hist note.md" | head -1)"
OLD_HASH="$(git log --follow --format=%H -- "Notes/hist renamed.md" | tail -1)"
req "r-20260804T100001Z-show01" show-file-at-commit "$TOKEN" "{\"path\":\"Notes/hist note.md\",\"commit\":\"$OLD_HASH\"}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100001Z-show01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "show-file-at-commit ok"
check '[ "$(jq -r ".data.contentBase64" "$RES" | base64 -d)" = "v1" ]' "content at old commit is v1"

echo "# phase 4: absent file at commit -> FILE_ABSENT"
req "r-20260804T100002Z-show02" show-file-at-commit "$TOKEN" "{\"path\":\"Notes/never-existed.md\",\"commit\":\"$OLD_HASH\"}"
bash "$RUNNER"
check 'jq -e ".error.code == \"FILE_ABSENT\"" "$RUNTIME/results/r-20260804T100002Z-show02.json" >/dev/null' "absent file reported"

echo "# phase 4: diff between commit and worktree"
printf 'v1\nv2\nworktree\n' > "Notes/hist renamed.md"
req "r-20260804T100003Z-diff01" diff-file "$TOKEN" '{"path":"Notes/hist renamed.md","from":"HEAD","to":"WORKTREE"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-diff01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "diff-file ok"
check 'jq -r ".data.diff" "$RES" | grep -q "^+worktree"' "diff shows worktree addition"

echo "# phase 4: repository-wide log for the history panel (repo-log)"
req "r-20260804T100003Z-rlog01" repo-log "$TOKEN" '{"limit":10,"skip":0}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-rlog01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repo-log ok"
check '[ "$(jq -r ".data.log" "$RES" | grep -c "hist:")" = "3" ]' "repo-log lists the three hist commits"
check 'jq -r ".data.log" "$RES" | grep -q "^R[0-9]*.*hist note.md.*hist renamed.md"' "repo-log carries name-status rename lines"
req "r-20260804T100003Z-rlog02" repo-log "$TOKEN" '{"limit":1,"skip":1}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-rlog02.json"
check '[ "$(jq -r ".data.log" "$RES" | grep -c "^\x1e" || true)" -le 1 ]' "repo-log pagination honours limit"

echo "# phase 4: diff of a commit against its parent (history panel taps)"
REN_HASH="$(git log --format=%H --grep 'hist: rename' -n1)"
req "r-20260804T100003Z-diff02" diff-file "$TOKEN" "{\"path\":\"Notes/hist renamed.md\",\"from\":\"$REN_HASH^\",\"to\":\"$REN_HASH\"}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-diff02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "diff-file accepts a single trailing ^ on a commit"
check 'jq -r ".data.diff" "$RES" | grep -q "hist renamed.md"' "parent diff mentions the file"
req "r-20260804T100003Z-diff03" diff-file "$TOKEN" '{"path":"Notes/note.md","from":"HEAD^^","to":"HEAD"}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260804T100003Z-diff03.json" >/dev/null' "double ^ is still rejected"

echo "# phase 4: root commit diff against the canonical empty tree"
ROOT_HASH="$(git rev-list --max-parents=0 HEAD | head -1)"
req "r-20260804T100003Z-diff04" diff-file "$TOKEN" "{\"path\":\"Notes/note.md\",\"from\":\"4b825dc642cb6eb9a060e54bf8d69288fbee4904\",\"to\":\"$ROOT_HASH\"}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-diff04.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "empty-tree diff ok (root-commit fallback path)"
check 'jq -r ".data.diff" "$RES" | grep -q "^+note"' "root commit renders as additions"

echo "# phase 4: restore file from commit after confirmation (runner side)"
HEAD_HASH="$(git rev-parse HEAD)"
req "r-20260804T100004Z-rest01" restore-file "$TOKEN" "{\"path\":\"Notes/hist renamed.md\",\"commit\":\"$HEAD_HASH\",\"protectedPaths\":[\"Private/Hidden\",\"Projects/Archive\"]}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100004Z-rest01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "restore ok"
check '[ "$(cat "Notes/hist renamed.md")" = "v1
v2" ]' "worktree content restored to committed version"

echo "# phase 4: restore into a protected path is blocked"
req "r-20260804T100005Z-rest02" restore-file "$TOKEN" "{\"path\":\"Private/Hidden/mem.md\",\"commit\":\"$HEAD_HASH\",\"protectedPaths\":[\"Private/Hidden\",\"Projects/Archive\"]}"
bash "$RUNNER"
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$RUNTIME/results/r-20260804T100005Z-rest02.json" >/dev/null' "protected restore blocked"

echo "# phase 4: binary file round trip"
printf '\x00\x01\x02BIN' > Notes/blob.bin
git add Notes/blob.bin && git commit -qm "hist: binary"
req "r-20260804T100006Z-show03" show-file-at-commit "$TOKEN" '{"path":"Notes/blob.bin","commit":"HEAD"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100006Z-show03.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "binary show ok"
check '[ "$(jq -r ".data.contentBase64" "$RES" | base64 -d | od -An -tx1 | tr -d "[:space:]")" = "00010242494e" ]' "binary bytes intact"

echo "# source control: stage / unstage / discard per file"
printf 'staged content\n' > Notes/stage-me.md
req "r-20260804T130000Z-stg001" stage-file "$TOKEN" '{"path":"Notes/stage-me.md","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T130000Z-stg001.json" >/dev/null' "stage-file ok"
check 'git diff --cached --name-only | grep -q "Notes/stage-me.md"' "file is staged"
req "r-20260804T130001Z-uns001" unstage-file "$TOKEN" '{"path":"Notes/stage-me.md","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T130001Z-uns001.json" >/dev/null' "unstage-file ok"
check '! git diff --cached --name-only | grep -q "Notes/stage-me.md"' "file is unstaged"
req "r-20260804T130002Z-dsc001" discard-file "$TOKEN" '{"path":"Notes/stage-me.md","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T130002Z-dsc001.json" >/dev/null' "discard-file ok (untracked)"
check '[ ! -e Notes/stage-me.md ]' "untracked file deleted by discard"
printf 'tracked change\n' >> Notes/note.md
req "r-20260804T130003Z-dsc002" discard-file "$TOKEN" '{"path":"Notes/note.md","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check '! grep -q "tracked change" Notes/note.md' "tracked file restored by discard"
req "r-20260804T130004Z-stg002" stage-file "$TOKEN" '{"path":"Private/Hidden/mem.md","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$RUNTIME/results/r-20260804T130004Z-stg002.json" >/dev/null' "staging a protected path is blocked"

echo "# source control: stage all / unstage all (protected paths excluded)"
printf 'bulk1\n' > Notes/bulk1.md
printf 'bulk2\n' > Notes/bulk2.md
mkdir -p Private/Hidden && printf 'leak\n' > Private/Hidden/leak2.md
req "r-20260804T140000Z-sta001" stage-all "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T140000Z-sta001.json"
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$RES" >/dev/null' "stage-all blocked while a protected path is dirty"
rm -f Private/Hidden/leak2.md
req "r-20260804T140001Z-sta002" stage-all "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T140001Z-sta002.json" >/dev/null' "stage-all ok once clean"
check '[ "$(git diff --cached --name-only | grep -c "Notes/bulk")" = "2" ]' "both files staged"
req "r-20260804T140002Z-uns002" unstage-all "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T140002Z-uns002.json" >/dev/null' "unstage-all ok"
check '[ -z "$(git diff --cached --name-only)" ]' "index empty after unstage-all"
rm -f Notes/bulk1.md Notes/bulk2.md

echo "# regression: large repo payloads must not break result serialization (execve 128KB arg limit)"
mkdir -p Bulk
python3 - <<'GEN'
import os
os.makedirs("Bulk", exist_ok=True)
for i in range(3000):
    with open(f"Bulk/a-fairly-long-file-name-to-inflate-git-output-{i:05d}.md", "w") as f:
        f.write("x\n")
GEN
git add -A >/dev/null 2>&1 && git commit -qm "bulk: many files"
# Hide them via a sparse exclusion so `git ls-files -v | grep ^S` exceeds 128KB.
# (Manual `update-index --skip-worktree` is ignored for worktree-present files
# when sparse checkout is active on git >= 2.35; real vaults get their S bits
# from sparse patterns anyway, so this is also the more faithful fixture.)
git sparse-checkout set --no-cone '/*' '!Private/Hidden/' '!Projects/Archive/' '!Bulk/' 2>/dev/null
SKIP_BYTES="$(git ls-files -v | grep '^S ' | wc -c)"
check '[ "$SKIP_BYTES" -gt 131072 ]' "test fixture really exceeds the 128KB argument limit ($SKIP_BYTES bytes)"
req "r-20260804T110000Z-big001" status "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T110000Z-big001.json"
check '[ -f "$RES" ]' "result file written despite huge payload"
check 'jq -e ".ok == true" "$RES" >/dev/null' "status ok on a large sparse repo"
check '[ "$(jq -r ".data.skipWorktreeCount" "$RES")" -ge 3000 ]' "skip-worktree count reported (not the full list)"
check '! grep -q "ERROR building" "$RUNTIME/runner.log"' "no serialization errors in runner.log"
# clean up the fixture so later assertions are unaffected: restore the original
# sparse rules (Bulk reappears in the worktree), then remove it for real
git sparse-checkout set --no-cone '/*' '!Private/Hidden/' '!Projects/Archive/' 2>/dev/null
git rm -rq Bulk >/dev/null 2>&1 || true
rm -rf Bulk
git commit -qm "bulk: remove" >/dev/null 2>&1 || true

echo "# concurrency: two runners must not process the same request twice"
req "r-20260804T150000Z-conc01" status "$TOKEN"
bash "$RUNNER" & bash "$RUNNER" & wait
DONE_COUNT="$(grep -c "DONE r-20260804T150000Z-conc01" "$RUNTIME/runner.log" || true)"
check '[ "$DONE_COUNT" = "1" ]' "request processed exactly once (got $DONE_COUNT DONE lines)"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T150000Z-conc01.json" >/dev/null' "result still produced under concurrency"
check '[ -z "$(ls -A "$RUNTIME/processing" 2>/dev/null)" ]' "processing dir drained"
check '[ ! -d "$RUNTIME/.runner.lock" ]' "lock released on exit"

echo "# handshake: runner reports its protocol version"
check '[ "$(jq -r ".runnerVersion" "$RUNTIME/results/r-20260804T150000Z-conc01.json")" = "6" ]' "runnerVersion = 6 reported to the plugin"

echo "# resilience: interrupted requests are requeued on the next run"
req "r-20260804T150100Z-intr01" status "$TOKEN"
mkdir -p "$RUNTIME/processing"
mv "$RUNTIME/requests/r-20260804T150100Z-intr01.json" "$RUNTIME/processing/"
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T150100Z-intr01.json" >/dev/null' "interrupted request recovered and completed"
check '[ -z "$(ls "$RUNTIME/processing" 2>/dev/null)" ]' "processing/ left empty (no markers, no requests)"

echo "# resilience: a request interrupted TWICE is not retried forever"
req "r-20260804T150101Z-intr02" status "$TOKEN"
mv "$RUNTIME/requests/r-20260804T150101Z-intr02.json" "$RUNTIME/processing/"
: > "$RUNTIME/processing/r-20260804T150101Z-intr02.json.retried"   # simulate: already requeued once
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T150101Z-intr02.json"
check 'jq -e ".ok == false and .error.code == \"RUNNER_INTERNAL\"" "$RES" >/dev/null' "twice-interrupted request -> RUNNER_INTERNAL result (no infinite requeue)"
check '[ ! -e "$RUNTIME/processing/r-20260804T150101Z-intr02.json" ]' "poison request archived out of processing/"
check '[ ! -e "$RUNTIME/processing/r-20260804T150101Z-intr02.json.retried" ]' "retry marker removed"

echo "# recovery: stale requests expire instead of executing much later"
cat > "$RUNTIME/requests/r-20260803T090000Z-exp001.json" <<REQ
{"protocolVersion":1,"id":"r-20260803T090000Z-exp001","token":"$TOKEN","action":"sync","createdAt":"2026-08-03T09:00:00Z","timeoutSeconds":30,"args":{"protectedPaths":["Private/Hidden","Projects/Archive"],"message":"stale sync that must never run"}}
REQ
HEAD_BEFORE_EXP="$(git rev-parse HEAD)"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T090000Z-exp001.json"
check 'jq -e ".ok == false and .error.code == \"EXPIRED\"" "$RES" >/dev/null' "day-old sync -> EXPIRED, not executed"
check '[ "$(git rev-parse HEAD)" = "$HEAD_BEFORE_EXP" ]' "no commit was created by the expired request"
check '! git log --format=%s | grep -q "stale sync that must never run"' "stale message never entered history"

echo "# recovery: a fresh request with an unparsable createdAt still executes (fail open)"
cat > "$RUNTIME/requests/r-20260804T150102Z-exp002.json" <<REQ
{"protocolVersion":1,"id":"r-20260804T150102Z-exp002","token":"$TOKEN","action":"ping","createdAt":"not-a-date","timeoutSeconds":30,"args":{}}
REQ
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T150102Z-exp002.json" >/dev/null' "unparsable createdAt fails open (broken clock cannot brick the bridge)"

echo "# config: sparse-exclude-add hides a directory without staging deletions"
mkdir -p Extra && echo "extra" > Extra/e.md
git add Extra && git commit -qm "add Extra"
req "r-20260804T151000Z-spx001" sparse-exclude-add "$TOKEN" '{"path":"Extra"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T151000Z-spx001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sparse-exclude-add ok"
check '[ ! -e Extra/e.md ]' "excluded directory removed from the worktree"
check 'git ls-files -v | grep -q "^S Extra/e.md"' "skip-worktree bit set by git itself"
check '[ -z "$(git status --porcelain=v1)" ]' "exclusion did NOT appear as a change or deletion"
check 'jq -er ".data.sparseList" "$RES" | grep -qx "!/Extra"' "new pattern reported back to the plugin"
check '[ ! -e Private/Hidden/mem.md ]' "pre-existing exclusions preserved"
req "r-20260804T151001Z-spx002" sparse-exclude-add "$TOKEN" '{"path":"Extra"}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T151001Z-spx002.json" >/dev/null' "sparse-exclude-add is idempotent"
check '[ "$(git sparse-checkout list | grep -cx "!/Extra")" = "1" ]' "no duplicate pattern"

echo "# config: sparse-exclude-remove materializes the directory again"
req "r-20260804T151002Z-spx003" sparse-exclude-remove "$TOKEN" '{"path":"Extra"}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T151002Z-spx003.json" >/dev/null' "sparse-exclude-remove ok"
check '[ -f Extra/e.md ]' "files materialized again"
check '! git sparse-checkout list | grep -qx "!/Extra"' "pattern removed from sparse list"
git rm -rq Extra >/dev/null 2>&1 && git commit -qm "remove Extra fixture"

echo "# config: .git/info/exclude add / list / remove (local-only ignores)"
echo "scratch" > scratch-local.md
req "r-20260804T151003Z-exc001" exclude-add "$TOKEN" '{"path":"scratch-local.md"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T151003Z-exc001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "exclude-add ok"
check 'grep -qxF "/scratch-local.md" .git/info/exclude' "line written to .git/info/exclude"
check '! git status --porcelain=v1 | grep -q "scratch-local.md"' "excluded file no longer shows as untracked"
check 'jq -er ".data.excludeList" "$RES" | grep -qxF "/scratch-local.md"' "exclude list returned to the plugin"
req "r-20260804T151004Z-exc002" exclude-list "$TOKEN"
bash "$RUNNER"
check 'jq -er ".data.excludeList" "$RUNTIME/results/r-20260804T151004Z-exc002.json" | grep -qxF "/scratch-local.md"' "exclude-list reports the entry"
req "r-20260804T151005Z-exc003" exclude-remove "$TOKEN" '{"path":"scratch-local.md"}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T151005Z-exc003.json" >/dev/null' "exclude-remove ok"
check '! grep -qxF "/scratch-local.md" .git/info/exclude' "line removed from .git/info/exclude"
check 'git status --porcelain=v1 | grep -q "scratch-local.md"' "file shows as untracked again"
rm -f scratch-local.md

echo "# config: appending to files WITHOUT a trailing newline must not glue lines"
# Reproduces the corruption seen in the field: an entry such as
# "Projects/Backup.gitignores" is two entries fused into one.
printf '/*\n!/Private/Hidden/\n!/Projects/Archive' > .git/info/sparse-checkout  # no final newline
git sparse-checkout reapply 2>/dev/null || true
req "r-20260804T151008Z-nl001" sparse-exclude-add "$TOKEN" '{"path":"NlFixture"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T151008Z-nl001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sparse-exclude-add ok on a file with no trailing newline"
check 'git sparse-checkout list | grep -qx "!/Projects/Archive"' "previous last pattern survived intact"
check 'git sparse-checkout list | grep -qx "!/NlFixture"' "new pattern is its own line"
check '! git sparse-checkout list | grep -q "Archive!/"' "no glued pattern produced"
req "r-20260804T151009Z-nl002" sparse-exclude-remove "$TOKEN" '{"path":"NlFixture"}'
bash "$RUNNER"
printf '/dirty-no-newline' > .git/info/exclude
req "r-20260804T151010Z-nl003" exclude-add "$TOKEN" '{"path":"NlNote.md"}'
bash "$RUNNER"
check 'grep -qxF "/dirty-no-newline" .git/info/exclude' "exclude: previous last line survived intact"
check 'grep -qxF "/NlNote.md" .git/info/exclude' "exclude: new entry is its own line"
# restore the runtime exclusion the rest of the suite relies on
printf '.obsidian/plugins/native-git-bridge/runtime/\n' >> .git/info/exclude

echo "# config: path validation also guards the new actions"
req "r-20260804T151006Z-exc004" sparse-exclude-add "$TOKEN" '{"path":":/"}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260804T151006Z-exc004.json" >/dev/null' "pathspec magic rejected in sparse-exclude-add"
req "r-20260804T151007Z-exc005" exclude-add "$TOKEN" '{"path":".git/config"}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260804T151007Z-exc005.json" >/dev/null' ".git path rejected in exclude-add"

echo "# phase 5: detached HEAD - status works, push refuses (no force, no guessing)"
MAIN_BRANCH="$(git symbolic-ref --short HEAD)"
git checkout -q --detach
req "r-20260804T160000Z-det001" status "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T160000Z-det001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "status ok on detached HEAD"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head (detached)"' "detached state reported"
req "r-20260804T160001Z-det002" push "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T160001Z-det002.json"
check 'jq -e ".error.code == \"GIT_FAILED\"" "$RES" >/dev/null' "push on detached HEAD -> GIT_FAILED"
check 'jq -er ".error.message" "$RES" | grep -qi "detached"' "error names the detached HEAD"
git checkout -q "$MAIN_BRANCH"

echo "# phase 5: non-fast-forward push is rejected (and never forced)"
# The conflict test above intentionally left local and remote histories diverged
# on Notes/note.md (abort-merge keeps the local commit). Reconcile that
# OUT-OF-BAND first (the bridge never auto-resolves), so this section tests a
# pure non-fast-forward, not the leftover content conflict.
git fetch -q origin
git merge --no-edit -q "origin/$MAIN_BRANCH" >/dev/null 2>&1 || true
git checkout --theirs -- Notes/note.md 2>/dev/null || true
git add -A && git commit -qm "e2e: resolve standing conflict out-of-band" 2>/dev/null || true
git push -q origin "$MAIN_BRANCH"
check '[ "$(git rev-parse HEAD)" = "$(git -C "$ROOT/remote.git" rev-parse HEAD)" ]' "slate clean before non-ff test"
echo "remote goes first" > "$ROOT/other/NffRemote.md"
git -C "$ROOT/other" pull -q --no-rebase 2>/dev/null || true
git -C "$ROOT/other" add -A && git -C "$ROOT/other" commit -qm "other: nff" && git -C "$ROOT/other" push -q
REMOTE_NFF="$(git -C "$ROOT/remote.git" rev-parse HEAD)"
echo "local diverges" > Notes/nff-local.md
git add Notes/nff-local.md && git commit -qm "local: nff"
req "r-20260804T160100Z-nff001" push "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T160100Z-nff001.json"
check 'jq -e ".error.code == \"GIT_FAILED\"" "$RES" >/dev/null' "non-ff push -> GIT_FAILED"
check 'jq -er ".error.stderr" "$RES" | grep -Eqi "rejected|fetch first|non-fast-forward"' "rejection reason surfaced to the user"
check '[ "$(git -C "$ROOT/remote.git" rev-parse HEAD)" = "$REMOTE_NFF" ]' "remote untouched (no force push)"
# sync integrates the remote commit (different files: clean merge) and publishes
req "r-20260804T160101Z-nff002" sync "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"],"message":"e2e: recover from nff"}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T160101Z-nff002.json" >/dev/null' "sync recovers from non-ff (merge + push)"
check '[ "$(git rev-parse HEAD)" = "$(git -C "$ROOT/remote.git" rev-parse HEAD)" ]' "remote equals local after recovery"

echo "# phase 5: branch without upstream - push -u publishes and binds it"
git checkout -q -b e2e-no-upstream
echo "nub" > Notes/nub.md
git add Notes/nub.md && git commit -qm "nub: local only"
req "r-20260804T160200Z-nub001" push "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T160200Z-nub001.json" >/dev/null' "push ok on branch without upstream"
check 'git -C "$ROOT/remote.git" rev-parse --verify -q refs/heads/e2e-no-upstream >/dev/null' "remote branch created"
check '[ "$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null)" = "origin/e2e-no-upstream" ]' "upstream bound by push -u"
git checkout -q "$MAIN_BRANCH"

echo "# phase 5: unborn branch (fresh repo, no commit yet)"
UB_DIR="$ROOT/unborn"
git init -q "$UB_DIR"
git -C "$UB_DIR" config user.email u@e; git -C "$UB_DIR" config user.name u
UB_RUNTIME="$UB_DIR/.obsidian/plugins/native-git-bridge/runtime"
mkdir -p "$UB_RUNTIME/requests" "$ROOT/conf-unborn"
cat > "$ROOT/conf-unborn/config" <<CONF
NGB_REPO_DIR="$UB_DIR"
NGB_TOKEN="$TOKEN"
NGB_RUNTIME_DIR="$UB_RUNTIME"
CONF
req_ub() { # $1 id, $2 action, $3 extra-args-json
  local args="${3:-}"; [ -z "$args" ] && args='{}'
  cat > "$UB_RUNTIME/requests/$1.json" <<REQ
{"protocolVersion":1,"id":"$1","token":"$TOKEN","action":"$2","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","timeoutSeconds":30,"args":$args}
REQ
}
req_ub "r-20260804T160300Z-unb001" status
NGB_CONFIG="$ROOT/conf-unborn/config" bash "$RUNNER"
RES="$UB_RUNTIME/results/r-20260804T160300Z-unb001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "status ok on unborn branch"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.oid (initial)"' "unborn state reported as (initial)"
echo "first" > "$UB_DIR/first.md"
req_ub "r-20260804T160301Z-unb002" commit '{"protectedPaths":[],"message":"e2e: first commit on unborn branch"}'
NGB_CONFIG="$ROOT/conf-unborn/config" bash "$RUNNER"
RES="$UB_RUNTIME/results/r-20260804T160301Z-unb002.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "first commit ok"
check '[ "$(jq -r ".data.committed" "$RES")" = "true" ]' "root commit created"
check '[ "$(git -C "$UB_DIR" rev-list --count HEAD)" = "1" ]' "repository has exactly one commit"

echo "# phase 5: repo without a remote - deterministic results, no hang"
# `git fetch --prune` with no remote configured is a successful no-op (exit 0),
# so the runner reports ok=true; push names origin explicitly and must fail.
req_ub "r-20260804T160400Z-nrm001" fetch
NGB_CONFIG="$ROOT/conf-unborn/config" bash "$RUNNER"
RES="$UB_RUNTIME/results/r-20260804T160400Z-nrm001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "fetch without remote is a no-op success (git semantics)"
check '[ "$(jq -r ".data.remoteUrl" "$RES")" = "" ]' "status data shows no remote URL"
req_ub "r-20260804T160401Z-nrm002" push '{"protectedPaths":[]}'
NGB_CONFIG="$ROOT/conf-unborn/config" bash "$RUNNER"
check 'jq -e ".error.code == \"GIT_FAILED\"" "$UB_RUNTIME/results/r-20260804T160401Z-nrm002.json" >/dev/null' "push without remote -> GIT_FAILED"

echo "# phase 5: expired PAT - non-interactive fast failure, credentials never leak"
PORT_FILE="$ROOT/http401.port"
python3 - "$PORT_FILE" <<'PY' &
import sys, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def _reply(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="git"')
        self.end_headers()
    do_GET = do_POST = do_HEAD = lambda self: self._reply()
    def log_message(self, *a): pass
with socketserver.TCPServer(("127.0.0.1", 0), H) as srv:
    open(sys.argv[1], "w").write(str(srv.server_address[1]))
    srv.serve_forever()
PY
SRV_PID=$!
for _ in $(seq 1 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
PORT="$(cat "$PORT_FILE")"
ORIG_URL="$(git remote get-url origin)"
git remote set-url origin "http://user:expiredpat123@127.0.0.1:$PORT/repo.git"
T0=$(date +%s)
req "r-20260804T160500Z-pat001" fetch "$TOKEN"
bash "$RUNNER"
T1=$(date +%s)
RES="$RUNTIME/results/r-20260804T160500Z-pat001.json"
check 'jq -e ".error.code == \"GIT_FAILED\"" "$RES" >/dev/null' "expired PAT -> GIT_FAILED (no hang on a prompt)"
check '[ $((T1 - T0)) -lt 30 ]' "auth failure is fast ($((T1 - T0))s), not a timeout"
check '! grep -q "expiredpat123" "$RES"' "credential never appears in the result (redacted)"
check '! grep -q "expiredpat123" "$RUNTIME/runner.log"' "credential never appears in runner.log"
git remote set-url origin "$ORIG_URL"
kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null

echo "# test: runner exits (no daemon) and log has no token"
check '! grep -q "$TOKEN" "$RUNTIME/runner.log"' "token never written to runner.log"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
