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

# Hermetic HOME: git's global config and the runner's default config directory
# both live under it, so the suite can set a commit identity (init-repo makes
# the first commit) without touching the developer's own ~/.gitconfig, and a
# test that forgets NGB_CONFIG cannot write into a real home directory.
export HOME="$ROOT/home"
mkdir -p "$HOME"
git config --global user.email e2e@example.com
git config --global user.name "E2E"

# The runner scans shared storage for vaults when it has nothing else to do.
# Point that scan at a directory that does not exist, so the suite can never
# touch a real device path; the multi-profile phase overrides it per run.
export NGB_SCAN_ROOTS="$ROOT/no-scan-roots"

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

echo "# test: verify-sparse-safety lists new files individually, never a collapsed folder"
# git status collapses a fully untracked directory into one "dir/" line. The
# plugin offers "move these files to the trash" from exactly this list, so one
# collapsed line used to mean one entry deleted and the rest left behind.
mkdir -p "Private/Hidden/New Notes"
echo one > "Private/Hidden/New Notes/one.md"
echo two > "Private/Hidden/New Notes/two.md"
echo three > "Private/Hidden/loose new.md"
req "r-20260803T100004Z-safe0u" verify-sparse-safety "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260803T100004Z-safe0u.json"
check 'jq -er ".data.statusProtected" "$RES" | grep -qF "Private/Hidden/New Notes/one.md"' "first file inside a new folder is listed"
check 'jq -er ".data.statusProtected" "$RES" | grep -qF "Private/Hidden/New Notes/two.md"' "second file inside the same folder is listed too"
check 'jq -er ".data.statusProtected" "$RES" | grep -qF "Private/Hidden/loose new.md"' "a loose new file is listed"
check '[ "$(jq -er ".data.statusProtected" "$RES" | grep -c .)" = "3" ]' "one line per file, no collapsed directory entry"
rm -rf "Private/Hidden/New Notes" "Private/Hidden/loose new.md"

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
check '[ "$(jq -r ".data.mergeInProgress" "$RES")" = "true" ]' "conflict result reports the merge in progress"
check 'jq -er ".data.mergeMsg" "$RES" | grep -q "^Merge"' "git's prepared merge message rides along for the commit modal"
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
check 'jq -r ".data.log" "$RES" | grep -qE "^:[0-9]{6} [0-9]{6} .* R[0-9]+"' "file-log carries the raw change letter (runner v9)"
check 'jq -r ".data.log" "$RES" | grep -qE "^[0-9]+[[:space:]][0-9]+[[:space:]]"' "file-log carries numstat counts"
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

echo "# phase 4: INDEX pseudo-ref diffs (staged vs unstaged rows)"
printf 'v1\nv2\nstaged line\n' > "Notes/hist renamed.md"
git add "Notes/hist renamed.md"
printf 'v1\nv2\nstaged line\nworktree line\n' > "Notes/hist renamed.md"
req "r-20260804T100003Z-idx001" diff-file "$TOKEN" '{"path":"Notes/hist renamed.md","from":"HEAD","to":"INDEX"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-idx001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "HEAD->INDEX diff ok"
check 'jq -r ".data.diff" "$RES" | grep -q "^+staged line"' "staged diff shows the staged addition"
check '! jq -r ".data.diff" "$RES" | grep -q "^+worktree line"' "staged diff does NOT show the unstaged edit"
req "r-20260804T100003Z-idx002" diff-file "$TOKEN" '{"path":"Notes/hist renamed.md","from":"INDEX","to":"WORKTREE"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-idx002.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "INDEX->WORKTREE diff ok"
check 'jq -r ".data.diff" "$RES" | grep -q "^+worktree line"' "unstaged diff shows only the new edit"
check '! jq -r ".data.diff" "$RES" | grep -q "^+staged line"' "unstaged diff does NOT repeat the staged part"
req "r-20260804T100003Z-idx003" diff-file "$TOKEN" '{"path":"Notes/hist renamed.md","from":"INDEX","to":"HEAD"}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260804T100003Z-idx003.json" >/dev/null' "INDEX only pairs with WORKTREE"
git restore --staged "Notes/hist renamed.md" && git checkout -- "Notes/hist renamed.md"

echo "# phase 4: stage-file mode=update stages tracked changes only (folder rows)"
printf 'v1\nv2\nedit\n' > "Notes/hist renamed.md"
echo "brand new" > "Notes/brand-new.md"
req "r-20260804T100003Z-upd001" stage-file "$TOKEN" '{"path":"Notes","mode":"update","protectedPaths":[]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-upd001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "stage mode=update ok"
check 'git diff --cached --name-only | grep -q "hist renamed.md"' "tracked change staged"
check '! git diff --cached --name-only | grep -q "brand-new.md"' "untracked file NOT swept in by mode=update"
req "r-20260804T100003Z-upd002" stage-file "$TOKEN" '{"path":"Notes","mode":"sideways","protectedPaths":[]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260804T100003Z-upd002.json" >/dev/null' "unknown stage mode -> BAD_REQUEST"
git restore --staged Notes && git checkout -- "Notes/hist renamed.md" && rm -f "Notes/brand-new.md"

echo "# phase 4: a folder action must NOT sweep in a protected path below it"
# The folder rows in the tree layout (and "Git: Stage" on a folder) send the
# FOLDER path. refuse_if_protected only rejects the path itself or paths under
# a protected one, so an ancestor folder used to stage its protected children.
mkdir -p Private/Hidden
echo "leaked note" > "Private/Hidden/leak.md"
echo "ordinary" > "Private/plain.md"
req "r-20260804T100003Z-anc001" stage-file "$TOKEN" '{"path":"Private","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-anc001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "staging an ancestor folder succeeds"
check 'git diff --cached --name-only | grep -q "Private/plain.md"' "the folder's own files are staged"
check '! git diff --cached --name-only | grep -q "Private/Hidden"' "the protected subdirectory is NOT staged"
req "r-20260804T100003Z-anc002" stage-file "$TOKEN" '{"path":"Private","mode":"update","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T100003Z-anc002.json" >/dev/null' "mode=update on an ancestor folder ok"
check '! git diff --cached --name-only | grep -q "Private/Hidden"' "mode=update leaves the protected subdirectory alone"
req "r-20260804T100003Z-anc003" unstage-file "$TOKEN" '{"path":"Private","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T100003Z-anc003.json" >/dev/null' "unstaging an ancestor folder ok"
check 'git diff --cached --quiet' "nothing staged remains"
req "r-20260804T100003Z-anc004" discard-file "$TOKEN" '{"path":"Private","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260804T100003Z-anc004.json" >/dev/null' "discarding an untracked folder ok"
check '[ ! -e "Private/plain.md" ]' "untracked files in the folder are gone"
check '[ -e "Private/Hidden/leak.md" ]' "files inside the protected subdirectory are untouched"
rm -rf Private/Hidden
git sparse-checkout reapply 2>/dev/null || true

echo "# phase 4: the group-wide stage button sends '.' and must still exclude protected paths"
printf 'v1\nv2\ngroup edit\n' > "Notes/hist renamed.md"
mkdir -p Private/Hidden && echo "protected new" > Private/Hidden/leak.md
req "r-20260804T100003Z-grp001" stage-file "$TOKEN" '{"path":".","mode":"update","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-grp001.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "stage-file '.' mode=update ok"
check 'git diff --cached --name-only | grep -q "hist renamed.md"' "tracked change at the repo root is staged"
check '! git diff --cached --name-only | grep -q "Private/Hidden"' "protected paths are excluded for a '.' base"
git restore --staged . 2>/dev/null || git reset -q
rm -f Private/Hidden/leak.md
git checkout -- "Notes/hist renamed.md" 2>/dev/null || true
git sparse-checkout reapply 2>/dev/null || true

echo "# phase 4: discard-all drops unstaged work, keeps staged and untracked"
printf 'v1\nv2\nstaged edit\n' > "Notes/hist renamed.md"
git add "Notes/hist renamed.md"
printf 'v1\nv2\nstaged edit\nlocal edit\n' > "Notes/hist renamed.md"
printf 'changed\n' > Notes/note.md
echo "keep me" > Notes/untracked-keep.md
mkdir -p Private/Hidden && echo "protected new" > Private/Hidden/leak.md
req "r-20260804T100003Z-dall01" discard-all "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-dall01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "discard-all ok"
check 'grep -q "staged edit" "Notes/hist renamed.md"' "staged content is kept"
check '! grep -q "local edit" "Notes/hist renamed.md"' "the unstaged edit on top of it is gone"
check '[ "$(cat Notes/note.md)" != "changed" ]' "another unstaged file is restored"
check '[ -e Notes/untracked-keep.md ]' "untracked files are NOT deleted"
check '[ -e Private/Hidden/leak.md ]' "protected paths are untouched"

echo "# phase 4: reset-all clears index and worktree, still excluding protected paths"
req "r-20260804T100003Z-rall01" reset-all "$TOKEN" '{"protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-rall01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "reset-all ok"
check 'git diff --cached --quiet' "index is empty again"
check 'git diff --quiet' "worktree matches HEAD"
check '! grep -q "staged edit" "Notes/hist renamed.md"' "the staged edit is gone too"
check '[ -e Notes/untracked-keep.md ]' "untracked files survive a reset"
check '[ -e Private/Hidden/leak.md ]' "protected paths survive a reset"
rm -f Notes/untracked-keep.md Private/Hidden/leak.md
git sparse-checkout reapply 2>/dev/null || true

echo "# phase 4: FAILED mutating actions still carry fresh status fields"
req "r-20260804T100003Z-err001" restore-file "$TOKEN" "{\"path\":\"Notes/never-existed.md\",\"commit\":\"$OLD_HASH\",\"protectedPaths\":[]}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260804T100003Z-err001.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "restore of absent file fails as before"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head"' "error result includes fresh branchInfo"

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
check '[ ! -d "$RUNTIME/.runner.lock" ]' "no lock left inside the vault runtime dir"
check '[ ! -d "$ROOT/conf/.runner.lock" ]' "global lock released on exit"

echo "# handshake: runner reports its protocol version"
check '[ "$(jq -r ".runnerVersion" "$RUNTIME/results/r-20260804T150000Z-conc01.json")" = "11" ]' "runnerVersion = 11 reported to the plugin"
check 'bash "$RUNNER" | grep -q "NGB_RUNNER_VERSION=11"' "runner announces its version on stdout (companion probe)"

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

# =============================================================================
# phase 6: several repositories on one device (profiles)
# =============================================================================
# Everything below uses its own config directory, so the single-repo phases
# above keep proving that a legacy setup still works.

MULTI="$ROOT/multi"
MCONF="$ROOT/conf-multi"
mkdir -p "$MULTI" "$MCONF"
mrun() { NGB_CONFIG="$MCONF/config" NGB_SCAN_ROOTS="$MULTI" bash "$RUNNER" "$@"; }
mkvault() { # $1 dir
  mkdir -p "$1/.obsidian/plugins/native-git-bridge/runtime/requests"
  git init -q "$1"
  git -C "$1" config user.email m@e; git -C "$1" config user.name m
  echo "note in $(basename "$1")" > "$1/note.md"
  git -C "$1" add -A && git -C "$1" commit -qm "init $(basename "$1")"
  # Mirror the installer: the runtime dir is excluded locally, never committed.
  echo ".obsidian/plugins/native-git-bridge/runtime/" >> "$1/.git/info/exclude"
}
mreq() { # $1 runtime, $2 id, $3 token, $4 action, $5 profileId(optional), $6 args(optional)
  local pid="${5:-}" args="${6:-}"
  [ -z "$args" ] && args='{}'
  mkdir -p "$1/requests"
  cat > "$1/requests/$2.json" <<REQ
{"protocolVersion":1,"id":"$2","token":"$3","action":"$4","profileId":"$pid","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","timeoutSeconds":30,"args":$args}
REQ
}
claim() { # $1 runtime
  mkdir -p "$1"
  printf '{"createdAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$1/claim.json"
}

echo "# phase 6: an existing single-repo config is migrated to a profile"
mkvault "$MULTI/VaultA"
A_RT="$MULTI/VaultA/.obsidian/plugins/native-git-bridge/runtime"
A_TOKEN="legacy-token-abc123"
cat > "$MCONF/config" <<CONF
NGB_REPO_DIR="$MULTI/VaultA"
NGB_TOKEN="$A_TOKEN"
NGB_RUNTIME_DIR="$A_RT"
CONF
mreq "$A_RT" "r-20260805T100000Z-mig001" "$A_TOKEN" ping
mrun >/dev/null
A_CONF="$(ls "$MCONF"/profiles/*.conf 2>/dev/null | head -1)"
check '[ -n "$A_CONF" ]' "legacy config migrated into profiles/<id>.conf"
check 'grep -q "NGB_TOKEN=\"$A_TOKEN\"" "$A_CONF"' "migration keeps the existing token (no re-pairing)"
check 'grep -q "^NGB_PROFILE_FORMAT=1$" "$A_CONF"' "profile carries a format marker for future migrations"
check '[ "$(stat -c %a "$A_CONF")" = "600" ]' "profile file is chmod 600"
check '[ -f "$MCONF/config.legacy" ] && [ ! -f "$MCONF/config" ]' "legacy config retired (migration cannot run twice)"
check 'jq -e ".ok == true" "$A_RT/results/r-20260805T100000Z-mig001.json" >/dev/null' "the migrated vault keeps working with its old token"
A_PID="$(jq -r .profileId "$A_RT/results/r-20260805T100000Z-mig001.json")"
check '[ -n "$A_PID" ] && [ "$A_PID" != "null" ]' "results name the profile they were answered by"
check '[ "$(jq -r .profileId "$A_RT/profile.json")" = "$A_PID" ]' "runtime dir carries a profile marker"

echo "# phase 6: a second vault pairs itself without re-running the installer"
mkvault "$MULTI/VaultB"
B_RT="$MULTI/VaultB/.obsidian/plugins/native-git-bridge/runtime"
claim "$B_RT"
mrun >/dev/null
check '[ "$(ls "$MCONF"/profiles/*.conf | wc -l)" = "2" ]' "claim from an unpaired vault created a second profile"
check '[ -f "$B_RT/pairing.json" ]' "pairing file written into the new vault"
check '[ ! -f "$B_RT/claim.json" ]' "claim consumed"
B_TOKEN="$(jq -r .token "$B_RT/pairing.json")"
B_PID="$(jq -r .profileId "$B_RT/pairing.json")"
check '[ -n "$B_TOKEN" ] && [ "$B_TOKEN" != "$A_TOKEN" ]' "the second vault gets its OWN token"
check 'printf %s "$B_PID" | grep -Eq "^p-[0-9a-f]{8,32}$"' "pairing file carries an opaque profile id"

echo "# phase 6: one run drains every profile's queue"
mreq "$A_RT" "r-20260805T110000Z-two001" "$A_TOKEN" status "$A_PID"
mreq "$B_RT" "r-20260805T110001Z-two002" "$B_TOKEN" status "$B_PID"
mrun >/dev/null
check 'jq -e ".ok == true" "$A_RT/results/r-20260805T110000Z-two001.json" >/dev/null' "vault A answered"
check 'jq -e ".ok == true" "$B_RT/results/r-20260805T110001Z-two002.json" >/dev/null' "vault B answered in the same run"
check '[ "$(jq -r .profileId "$B_RT/results/r-20260805T110001Z-two002.json")" = "$B_PID" ]' "each result carries its own profile id"
# The queue is one global list sorted by request id, and ids embed a UTC
# timestamp: the older request can never start after the newer one.
check '[ "$(jq -r .startedAt "$A_RT/results/r-20260805T110000Z-two001.json")" \< "$(jq -r .startedAt "$B_RT/results/r-20260805T110001Z-two002.json")" ] || [ "$(jq -r .startedAt "$A_RT/results/r-20260805T110000Z-two001.json")" = "$(jq -r .startedAt "$B_RT/results/r-20260805T110001Z-two002.json")" ]' "oldest request first across profiles"

echo "# phase 6: a token is valid for its own profile only"
mreq "$B_RT" "r-20260805T120000Z-tok001" "$A_TOKEN" status "$A_PID"
mrun >/dev/null
check 'jq -e ".error.code == \"AUTH\"" "$B_RT/results/r-20260805T120000Z-tok001.json" >/dev/null' "vault A's request replayed into vault B -> AUTH"
mreq "$A_RT" "r-20260805T120001Z-tok002" "$A_TOKEN" status "$B_PID"
mrun >/dev/null
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$A_RT/results/r-20260805T120001Z-tok002.json" >/dev/null' "right token but foreign profile id -> BAD_REQUEST"
check '! grep -q "$A_TOKEN" "$MCONF/runner.log"' "no token in the shared runner log"
check '! grep -q "$B_TOKEN" "$B_RT/runner.log"' "no token in the per-vault runner log"

echo "# phase 6: a vault inside another vault's repository"
# VaultN lives INSIDE VaultA's working tree and is its own repository.
mkvault "$MULTI/VaultA/Projects/VaultN"
N_RT="$MULTI/VaultA/Projects/VaultN/.obsidian/plugins/native-git-bridge/runtime"
claim "$N_RT"
mrun >/dev/null
N_TOKEN="$(jq -r .token "$N_RT/pairing.json")"
N_PID="$(jq -r .profileId "$N_RT/pairing.json")"
check '[ -n "$N_TOKEN" ] && [ "$N_TOKEN" != "$A_TOKEN" ]' "the nested vault is a profile of its own"
check 'grep -qxF "/Projects/VaultN/" "$MULTI/VaultA/.git/info/exclude"' "inner repository excluded from the outer one via .git/info/exclude (local, not synced)"
check '! git -C "$MULTI/VaultA" status --porcelain | grep -q "VaultN"' "outer repository no longer offers the inner working tree for staging"
check '[ -z "$(git -C "$MULTI/VaultA" status --porcelain -- Projects)" ]' "outer status is clean: the inner vault is invisible to it"
check '! grep -q "VaultN" "$MULTI/VaultA/.gitignore" 2>/dev/null' "no tracked file was edited to achieve it"
# Operations must stay inside the repository they were sent to.
mreq "$N_RT" "r-20260805T130000Z-nst001" "$N_TOKEN" status "$N_PID"
mreq "$A_RT" "r-20260805T130001Z-nst002" "$A_TOKEN" status "$A_PID"
mrun >/dev/null
check '[ "$(jq -r .data.branchInfo "$N_RT/results/r-20260805T130000Z-nst001.json" | grep -c "branch.head")" = "1" ]' "inner vault answers with its own branch header"
check 'jq -er .data.lastCommit "$N_RT/results/r-20260805T130000Z-nst001.json" | grep -q "init VaultN"' "inner status reports the INNER repository's last commit"
check 'jq -er .data.lastCommit "$A_RT/results/r-20260805T130001Z-nst002.json" | grep -q "init VaultA"' "outer status reports the OUTER repository's last commit"
echo "inner change" >> "$MULTI/VaultA/Projects/VaultN/note.md"
mreq "$N_RT" "r-20260805T130100Z-nst003" "$N_TOKEN" commit "$N_PID" '{"protectedPaths":[],"message":"e2e: inner commit"}'
mrun >/dev/null
check 'jq -e ".ok == true" "$N_RT/results/r-20260805T130100Z-nst003.json" >/dev/null' "commit inside the inner repository succeeds"
check '[ "$(git -C "$MULTI/VaultA/Projects/VaultN" rev-list --count HEAD)" = "2" ]' "the commit landed in the inner repository"
check '[ "$(git -C "$MULTI/VaultA" rev-list --count HEAD)" = "1" ]' "the outer repository did not gain a commit"
check '[ -z "$(git -C "$MULTI/VaultA" status --porcelain)" ]' "the outer repository stayed clean throughout"

echo "# phase 6: an inner repository that lost its .git never falls back to the outer one"
mv "$MULTI/VaultA/Projects/VaultN/.git" "$MULTI/VaultA/Projects/VaultN/.git-off"
mreq "$N_RT" "r-20260805T140000Z-esc001" "$N_TOKEN" status "$N_PID"
mreq "$A_RT" "r-20260805T140001Z-esc002" "$A_TOKEN" status "$A_PID"
mrun >/dev/null
check 'jq -e ".error.code == \"REPO_MISSING\"" "$N_RT/results/r-20260805T140000Z-esc001.json" >/dev/null' "no work tree of its own -> REPO_MISSING, not the outer repository"
check 'jq -e ".ok == true" "$A_RT/results/r-20260805T140001Z-esc002.json" >/dev/null' "the other profiles are drained in the same run"
mv "$MULTI/VaultA/Projects/VaultN/.git-off" "$MULTI/VaultA/Projects/VaultN/.git"

echo "# phase 6: a moved repository is found again by its profile marker"
mv "$MULTI/VaultB" "$MULTI/VaultB-moved"
B_RT="$MULTI/VaultB-moved/.obsidian/plugins/native-git-bridge/runtime"
mrun >/dev/null
check 'grep -q "NGB_REPO_DIR=\"$MULTI/VaultB-moved\"" "$MCONF/profiles/$B_PID.conf"' "profile follows the repository to its new location"
check 'grep -q "NGB_TOKEN=\"$B_TOKEN\"" "$MCONF/profiles/$B_PID.conf"' "relocation keeps the token (no re-pairing)"
mreq "$B_RT" "r-20260805T150000Z-mov001" "$B_TOKEN" status "$B_PID"
mrun >/dev/null
check 'jq -e ".ok == true" "$B_RT/results/r-20260805T150000Z-mov001.json" >/dev/null' "the moved vault works without touching the installer"

echo "# phase 6: a deleted repository is reported, not fatal, and never replaced"
rm -rf "$MULTI/VaultB-moved/.git"
mreq "$B_RT" "r-20260805T160000Z-del001" "$B_TOKEN" status "$B_PID"
mreq "$A_RT" "r-20260805T160001Z-del002" "$A_TOKEN" status "$A_PID"
mrun >/dev/null
check 'jq -e ".error.code == \"REPO_MISSING\"" "$B_RT/results/r-20260805T160000Z-del001.json" >/dev/null' "queued request of a dead profile is answered (no silent timeout)"
check 'jq -e ".ok == true" "$A_RT/results/r-20260805T160001Z-del002.json" >/dev/null' "removing one vault leaves the others fully functional"
check 'grep -q "NGB_REPO_DIR=\"$MULTI/VaultB-moved\"" "$MCONF/profiles/$B_PID.conf"' "a dead profile is never re-pointed at another repository"

echo "# phase 6: claims are not a way in"
mkdir -p "$MULTI/NotARepo/.obsidian/plugins/native-git-bridge/runtime"
claim "$MULTI/NotARepo/.obsidian/plugins/native-git-bridge/runtime"
BEFORE="$(ls "$MCONF"/profiles/*.conf | wc -l)"
mrun >/dev/null
check '[ "$(ls "$MCONF"/profiles/*.conf | wc -l)" = "$BEFORE" ]' "a claim from a directory that is not a repository pairs nothing"
mkvault "$MULTI/VaultStale"
S_RT="$MULTI/VaultStale/.obsidian/plugins/native-git-bridge/runtime"
printf '{"createdAt":"2020-01-01T00:00:00Z"}\n' > "$S_RT/claim.json"
mrun >/dev/null
check '[ "$(ls "$MCONF"/profiles/*.conf | wc -l)" = "$BEFORE" ]' "a stale claim is discarded, not honoured"
check '[ ! -f "$S_RT/claim.json" ]' "stale claim removed"

echo "# phase 6: a corrupt profile cannot take the others down"
printf 'this is not a profile\n' > "$MCONF/profiles/p-00000000deadbeef.conf"
mreq "$A_RT" "r-20260805T170000Z-cor001" "$A_TOKEN" status "$A_PID"
mrun >/dev/null
check 'jq -e ".ok == true" "$A_RT/results/r-20260805T170000Z-cor001.json" >/dev/null' "healthy profiles keep working next to a corrupt one"
check 'grep -q "PROFILE ignoring" "$MCONF/runner.log"' "the corrupt profile is logged and skipped"
rm -f "$MCONF/profiles/p-00000000deadbeef.conf"

# =============================================================================
# phase 7: repository bootstrap (runner v11)
# =============================================================================
# A vault that is not a repository yet, or one without a remote. Its own config
# directory again, so nothing here can disturb the phases above.

BOOT="$ROOT/boot"
BCONF="$ROOT/conf-boot"
mkdir -p "$BOOT" "$BCONF"
brun() { NGB_CONFIG="$BCONF/config" NGB_SCAN_ROOTS="$BOOT" bash "$RUNNER" "$@"; }
# A vault with files but NO repository, asking to be paired for bootstrap.
newvault() { # $1 dir
  mkdir -p "$1/.obsidian/plugins/native-git-bridge/runtime"
  printf '{"createdAt":"%s","bootstrap":true}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$1/.obsidian/plugins/native-git-bridge/runtime/claim.json"
}
breq() { # $1 runtime, $2 id, $3 token, $4 action, $5 profileId, $6 args
  local args="${6:-}"
  [ -z "$args" ] && args='{}'
  mkdir -p "$1/requests"
  cat > "$1/requests/$2.json" <<REQ
{"protocolVersion":1,"id":"$2","token":"$3","action":"$4","profileId":"$5","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","timeoutSeconds":300,"args":$args}
REQ
}

echo "# phase 7: a vault with no repository can be paired, and says so"
newvault "$BOOT/Fresh"
F_RT="$BOOT/Fresh/.obsidian/plugins/native-git-bridge/runtime"
echo "my note" > "$BOOT/Fresh/note.md"
brun >/dev/null
check '[ -f "$F_RT/pairing.json" ]' "a vault without a repository can pair for bootstrap"
F_TOKEN="$(jq -r .token "$F_RT/pairing.json")"
F_PID="$(jq -r .profileId "$F_RT/pairing.json")"
breq "$F_RT" "r-20260806T100000Z-boot01" "$F_TOKEN" status "$F_PID"
brun >/dev/null
check 'jq -e ".error.code == \"REPO_MISSING\"" "$F_RT/results/r-20260806T100000Z-boot01.json" >/dev/null' "a normal action before there is a repository -> REPO_MISSING"
check 'jq -er ".error.message" "$F_RT/results/r-20260806T100000Z-boot01.json" | grep -qi "clone"' "the message says what to do about it"
# A claim without the bootstrap flag is still refused for a non-repository.
mkdir -p "$BOOT/NotAsked/.obsidian/plugins/native-git-bridge/runtime"
printf '{"createdAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$BOOT/NotAsked/.obsidian/plugins/native-git-bridge/runtime/claim.json"
BEFORE_N="$(ls "$BCONF"/profiles/*.conf | wc -l)"
brun >/dev/null
check '[ "$(ls "$BCONF"/profiles/*.conf | wc -l)" = "$BEFORE_N" ]' "a plain claim still needs a repository (only bootstrap claims may pair without one)"

echo "# phase 7: init-repo"
breq "$F_RT" "r-20260806T101000Z-init01" "$F_TOKEN" init-repo "$F_PID" '{"branch":"trunk","initialCommit":true,"message":"e2e: first commit"}'
brun >/dev/null
RES="$F_RT/results/r-20260806T101000Z-init01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "init-repo succeeds in a vault that has files"
check '[ "$(jq -r .data.branch "$RES")" = "trunk" ]' "the default branch is the one that was asked for"
check '[ "$(git -C "$BOOT/Fresh" symbolic-ref --short HEAD)" = "trunk" ]' "…and git agrees"
check '[ "$(jq -r .data.committed "$RES")" = "true" ]' "the first commit was made"
check 'git -C "$BOOT/Fresh" ls-files | grep -qx "note.md"' "the vault's note is in that commit"
check '! git -C "$BOOT/Fresh" ls-files | grep -q "runtime/"' "the runtime folder is NOT committed"
check 'grep -q "native-git-bridge/runtime/" "$BOOT/Fresh/.git/info/exclude"' "init writes the runtime exclude itself"
breq "$F_RT" "r-20260806T101001Z-init02" "$F_TOKEN" init-repo "$F_PID" '{"branch":"main"}'
brun >/dev/null
check 'jq -e ".error.code == \"REPO_EXISTS\"" "$F_RT/results/r-20260806T101001Z-init02.json" >/dev/null' "an existing repository is never re-initialised"
check '[ "$(git -C "$BOOT/Fresh" symbolic-ref --short HEAD)" = "trunk" ]' "…and the refusal changed nothing"
newvault "$BOOT/BadBranch"
BB_RT="$BOOT/BadBranch/.obsidian/plugins/native-git-bridge/runtime"
brun >/dev/null
BB_TOKEN="$(jq -r .token "$BB_RT/pairing.json")"; BB_PID="$(jq -r .profileId "$BB_RT/pairing.json")"
breq "$BB_RT" "r-20260806T101002Z-init03" "$BB_TOKEN" init-repo "$BB_PID" '{"branch":"--upload-pack=id"}'
brun >/dev/null
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$BB_RT/results/r-20260806T101002Z-init03.json" >/dev/null' "a branch name that could be an option is rejected"
check '[ ! -d "$BOOT/BadBranch/.git" ]' "…and nothing was created"

echo "# phase 7: set-remote"
breq "$F_RT" "r-20260806T102000Z-rem01" "$F_TOKEN" set-remote "$F_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
check 'jq -e ".ok == true" "$F_RT/results/r-20260806T102000Z-rem01.json" >/dev/null' "set-remote adds origin"
check '[ "$(git -C "$BOOT/Fresh" remote get-url origin)" = "file://$ROOT/remote.git" ]' "…and git has it"
breq "$F_RT" "r-20260806T102001Z-rem02" "$F_TOKEN" set-remote "$F_PID" "{\"url\":\"https://example.com/changed.git\"}"
brun >/dev/null
check '[ "$(git -C "$BOOT/Fresh" remote get-url origin)" = "https://example.com/changed.git" ]' "set-remote changes an existing origin"
for BAD in '"https://user:hunter2@example.com/x.git"' '"-oProxyCommand=id"' '"http://example.com/x.git"' '"ext::sh -c id"' '"https://exa mple.com/x.git"'; do
  breq "$F_RT" "r-20260806T1030$(printf %02d $RANDOM | tail -c 3)Z-bad$$" "$F_TOKEN" set-remote "$F_PID" "{\"url\":$BAD}"
done
brun >/dev/null
check '[ "$(grep -l "BAD_REQUEST" "$F_RT"/results/*bad$$.json 2>/dev/null | wc -l)" -ge 1 ]' "credentials in a URL, option-like URLs, http, ext:: and whitespace are all refused"
check '[ "$(git -C "$BOOT/Fresh" remote get-url origin)" = "https://example.com/changed.git" ]' "…and none of them changed the remote"
check '! grep -rq "hunter2" "$F_RT/results" "$F_RT/runner.log" "$BCONF/runner.log"' "a password in a rejected URL never reaches a result or a log"

echo "# phase 7: clone into a vault that already has files"
newvault "$BOOT/CloneA"
CA_RT="$BOOT/CloneA/.obsidian/plugins/native-git-bridge/runtime"
mkdir -p "$BOOT/CloneA/Notes"
echo "local version" > "$BOOT/CloneA/Notes/note.md"   # exists in the repository too
echo "only here" > "$BOOT/CloneA/mine.md"             # exists only in the vault
brun >/dev/null
CA_TOKEN="$(jq -r .token "$CA_RT/pairing.json")"; CA_PID="$(jq -r .profileId "$CA_RT/pairing.json")"
breq "$CA_RT" "r-20260806T104000Z-cln01" "$CA_TOKEN" clone-into-vault "$CA_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
RES="$CA_RT/results/r-20260806T104000Z-cln01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "the clone succeeds even though files exist on both sides"
check 'jq -er ".data.collisions" "$RES" | grep -qx "Notes/note.md"' "the overlapping file is reported"
# The point of the whole flow: nothing of the user's is written over, and the
# rest of the repository still arrives.
check '[ "$(cat "$BOOT/CloneA/Notes/note.md")" = "local version" ]' "the vault's own version is kept, not replaced"
check 'git -C "$BOOT/CloneA" status --porcelain | grep -q "^ M Notes/note.md"' "…and shows in the panel as an ordinary local change"
check '[ -f "$BOOT/CloneA/mine.md" ]' "a file that exists only in the vault is left alone"
check 'git -C "$BOOT/CloneA" status --porcelain | grep -q "^?? mine.md"' "…and is simply untracked"
check '[ -f "$BOOT/CloneA/Notes/unicode nøte.md" ]' "the repository's OTHER files are checked out (unicode and spaces included)"
check '[ -z "$(git -C "$BOOT/CloneA" status --porcelain -- "Notes/unicode nøte.md")" ]' "…and are clean, not reported as changes"
check '! git -C "$BOOT/CloneA" status --porcelain | grep -q "^ D "' "nothing is left looking deleted"
check '[ ! -e "$BOOT/CloneA/.trash" ]' "nothing is moved into the vault trash"
check '[ ! -e "$CA_RT/clone-tmp" ]' "no temporary clone directory is left behind"
check '[ "$(git -C "$BOOT/CloneA" rev-parse --abbrev-ref "@{upstream}" 2>/dev/null)" = "origin/$MAIN_BRANCH" ]' "the branch tracks the remote, so pull and push work"
check 'grep -q "native-git-bridge/runtime/" "$BOOT/CloneA/.git/info/exclude"' "the clone writes the runtime exclude"
# Taking the repository's version afterwards is the per-file discard the panel
# already has — with the diff visible first, instead of a blind choice.
breq "$CA_RT" "r-20260806T104002Z-cln02" "$CA_TOKEN" discard-file "$CA_PID" '{"path":"Notes/note.md","protectedPaths":[]}'
brun >/dev/null
check '[ "$(cat "$BOOT/CloneA/Notes/note.md")" != "local version" ]' "discarding one file takes the repository's version for it"

newvault "$BOOT/CloneC"
CC_RT="$BOOT/CloneC/.obsidian/plugins/native-git-bridge/runtime"
echo "only here" > "$BOOT/CloneC/mine.md"
brun >/dev/null
CC_TOKEN="$(jq -r .token "$CC_RT/pairing.json")"; CC_PID="$(jq -r .profileId "$CC_RT/pairing.json")"
breq "$CC_RT" "r-20260806T106000Z-cln04" "$CC_TOKEN" clone-into-vault "$CC_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
RES="$CC_RT/results/r-20260806T106000Z-cln04.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "with nothing in the way the clone just works"
check '[ -z "$(jq -r .data.collisions "$RES")" ]' "…and reports no overlap"
check '[ -f "$BOOT/CloneC/Notes/note.md" ]' "the repository's files are checked out"
check '[ -f "$BOOT/CloneC/mine.md" ]' "the vault's own file is still there"
check '[ -z "$(git -C "$BOOT/CloneC" status --porcelain -- Notes)" ]' "the checked-out files are clean"
breq "$CC_RT" "r-20260806T106001Z-cln05" "$CC_TOKEN" clone-into-vault "$CC_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
check 'jq -e ".error.code == \"REPO_EXISTS\"" "$CC_RT/results/r-20260806T106001Z-cln05.json" >/dev/null' "cloning over an existing repository is refused"
breq "$CC_RT" "r-20260806T106002Z-cln06" "$CC_TOKEN" clone-into-vault "$CC_PID" '{"url":"file:///nonexistent/nope.git"}'
brun >/dev/null
check 'jq -e ".error.code == \"REPO_EXISTS\"" "$CC_RT/results/r-20260806T106002Z-cln06.json" >/dev/null' "…before the URL is even used"

echo "# phase 7: init + set-remote ends up exactly where a clone would"
# The question a user actually asks: if I create a repository here and then
# point it at my existing remote, do I get the same thing as cloning? Only if
# the local side has no history of its own — and the two paths must then be
# indistinguishable.
newvault "$BOOT/PathClone"
newvault "$BOOT/PathInit"
for V in PathClone PathInit; do
  mkdir -p "$BOOT/$V/Notes"
  echo "local version" > "$BOOT/$V/Notes/note.md"   # exists in the repository too
  echo "only here" > "$BOOT/$V/mine.md"
done
brun >/dev/null
PC_RT="$BOOT/PathClone/.obsidian/plugins/native-git-bridge/runtime"
PI_RT="$BOOT/PathInit/.obsidian/plugins/native-git-bridge/runtime"
PC_TOKEN="$(jq -r .token "$PC_RT/pairing.json")"; PC_PID="$(jq -r .profileId "$PC_RT/pairing.json")"
PI_TOKEN="$(jq -r .token "$PI_RT/pairing.json")"; PI_PID="$(jq -r .profileId "$PI_RT/pairing.json")"
breq "$PC_RT" "r-20260806T108000Z-pc01" "$PC_TOKEN" clone-into-vault "$PC_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
breq "$PI_RT" "r-20260806T108001Z-pi01" "$PI_TOKEN" init-repo "$PI_PID" '{"branch":"scratch","initialCommit":false}'
brun >/dev/null
breq "$PI_RT" "r-20260806T108002Z-pi02" "$PI_TOKEN" set-remote "$PI_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
RES="$PI_RT/results/r-20260806T108002Z-pi02.json"
check '[ "$(jq -r .data.remoteReachable "$RES")" = "true" ]' "set-remote reports whether the remote could be reached"
check 'jq -er ".data.remoteBranches" "$RES" | grep -q .' "…and which branches it already has"
check '[ "$(jq -r .data.localCommits "$RES")" = "false" ]' "…and that this side has no history yet"
breq "$PI_RT" "r-20260806T108003Z-pi03" "$PI_TOKEN" adopt-remote "$PI_PID" '{}'
brun >/dev/null
check 'jq -e ".ok == true" "$PI_RT/results/r-20260806T108003Z-pi03.json" >/dev/null' "adopt-remote takes the remote's history"
# Now compare the two vaults in every way that matters.
check '[ "$(git -C "$BOOT/PathClone" rev-parse HEAD)" = "$(git -C "$BOOT/PathInit" rev-parse HEAD)" ]' "same commit"
check '[ "$(git -C "$BOOT/PathClone" symbolic-ref --short HEAD)" = "$(git -C "$BOOT/PathInit" symbolic-ref --short HEAD)" ]' "same branch (the init branch name is replaced by the remote's)"
check '[ "$(git -C "$BOOT/PathClone" rev-parse --abbrev-ref "@{upstream}")" = "$(git -C "$BOOT/PathInit" rev-parse --abbrev-ref "@{upstream}")" ]' "same upstream, so pull and push work in both"
check '[ "$(git -C "$BOOT/PathClone" status --porcelain | sort)" = "$(git -C "$BOOT/PathInit" status --porcelain | sort)" ]' "same status: the local version kept as a change, the local-only file untracked"
check '[ "$(cd "$BOOT/PathClone" && find . -path ./.git -prune -o -path ./.obsidian -prune -o -type f -print | sort)" = "$(cd "$BOOT/PathInit" && find . -path ./.git -prune -o -path ./.obsidian -prune -o -type f -print | sort)" ]' "same files on disk"

echo "# phase 7: a repository that already has its own commits cannot just take a remote's"
newvault "$BOOT/PathOwn"
echo "mine" > "$BOOT/PathOwn/note.md"
brun >/dev/null
PO_RT="$BOOT/PathOwn/.obsidian/plugins/native-git-bridge/runtime"
PO_TOKEN="$(jq -r .token "$PO_RT/pairing.json")"; PO_PID="$(jq -r .profileId "$PO_RT/pairing.json")"
breq "$PO_RT" "r-20260806T109000Z-po01" "$PO_TOKEN" init-repo "$PO_PID" '{"branch":"main","initialCommit":true,"message":"e2e: own history"}'
brun >/dev/null
breq "$PO_RT" "r-20260806T109001Z-po02" "$PO_TOKEN" set-remote "$PO_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
check '[ "$(jq -r .data.localCommits "$PO_RT/results/r-20260806T109001Z-po02.json")" = "true" ]' "set-remote reports that this side has its own history"
breq "$PO_RT" "r-20260806T109002Z-po03" "$PO_TOKEN" adopt-remote "$PO_PID" '{}'
brun >/dev/null
RES="$PO_RT/results/r-20260806T109002Z-po03.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "adopt-remote refuses rather than creating unrelated histories"
check 'jq -er ".error.message" "$RES" | grep -qi "unrelated"' "…and names the problem"
check '[ "$(git -C "$BOOT/PathOwn" rev-list --count HEAD)" = "1" ]' "…and changes nothing"

echo "# phase 7: the vault ends up shaped exactly like the remote"
# The requirement in plain terms: after attaching a repository, the top level of
# the vault is what the remote has plus .git — no scratch folder, no leftovers,
# nothing hidden away — and it does not matter which of the two ways was used.
git init -q --bare "$ROOT/shape.git"
git clone -q "$ROOT/shape.git" "$ROOT/shape-seed" 2>/dev/null
git -C "$ROOT/shape-seed" config user.email e2e@example.com
git -C "$ROOT/shape-seed" config user.name E2E
git -C "$ROOT/shape-seed" checkout -qb main
mkdir -p "$ROOT/shape-seed/.obsidian" "$ROOT/shape-seed/.trash" \
         "$ROOT/shape-seed/Private/Hidden" "$ROOT/shape-seed/Projects/Archive"
echo '{"remote":1}' > "$ROOT/shape-seed/.obsidian/app.json"
echo '["git"]'      > "$ROOT/shape-seed/.obsidian/community-plugins.json"
echo trashed        > "$ROOT/shape-seed/.trash/old-note.md"
echo secret         > "$ROOT/shape-seed/Private/Hidden/mem.md"
echo spec           > "$ROOT/shape-seed/Projects/Archive/spec.md"
printf '.obsidian/workspace*\n' > "$ROOT/shape-seed/.gitignore"
git -C "$ROOT/shape-seed" add -A
git -C "$ROOT/shape-seed" commit -qm "vault shape"
git -C "$ROOT/shape-seed" push -q origin main
WANT=".git .gitignore .obsidian .trash Private Projects"

# A vault as Obsidian really leaves it: config files, a workspace, plugin files.
realvault() { # $1 dir
  mkdir -p "$1/.obsidian/plugins/native-git-bridge/runtime" "$1/Projects"
  echo '{"local":1}'    > "$1/.obsidian/app.json"
  echo '["a","b"]'      > "$1/.obsidian/community-plugins.json"
  echo '{"main":"..."}' > "$1/.obsidian/workspace.json"
  echo "local build"    > "$1/.obsidian/plugins/native-git-bridge/main.js"
  echo "my new note"    > "$1/Projects/today.md"
  printf '{"createdAt":"%s","bootstrap":true}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$1/.obsidian/plugins/native-git-bridge/runtime/claim.json"
}
toplevel() { (cd "$1" && ls -a | grep -v '^\.$' | grep -v '^\.\.$' | sort | tr '\n' ' ' | sed 's/ $//'); }

realvault "$BOOT/ShapeClone"
realvault "$BOOT/ShapeInit"
brun >/dev/null
SC_RT="$BOOT/ShapeClone/.obsidian/plugins/native-git-bridge/runtime"
SI_RT="$BOOT/ShapeInit/.obsidian/plugins/native-git-bridge/runtime"
SC_TOKEN="$(jq -r .token "$SC_RT/pairing.json")"; SC_PID="$(jq -r .profileId "$SC_RT/pairing.json")"
SI_TOKEN="$(jq -r .token "$SI_RT/pairing.json")"; SI_PID="$(jq -r .profileId "$SI_RT/pairing.json")"
breq "$SC_RT" "r-20260806T111000Z-sc01" "$SC_TOKEN" clone-into-vault "$SC_PID" "{\"url\":\"file://$ROOT/shape.git\"}"
brun >/dev/null
breq "$SI_RT" "r-20260806T111001Z-si01" "$SI_TOKEN" init-repo "$SI_PID" '{"branch":"whatever","initialCommit":false}'
brun >/dev/null
breq "$SI_RT" "r-20260806T111002Z-si02" "$SI_TOKEN" set-remote "$SI_PID" "{\"url\":\"file://$ROOT/shape.git\"}"
brun >/dev/null
breq "$SI_RT" "r-20260806T111003Z-si03" "$SI_TOKEN" adopt-remote "$SI_PID" '{}'
brun >/dev/null
check '[ "$(toplevel "$BOOT/ShapeClone")" = "$WANT" ]' "after cloning, the vault top level is exactly the remote's plus .git"
check '[ "$(toplevel "$BOOT/ShapeInit")" = "$WANT" ]' "after init + set-remote + adopt, the same"
check '[ "$(toplevel "$BOOT/ShapeClone")" = "$(toplevel "$BOOT/ShapeInit")" ]' "the two ways are indistinguishable"
check '[ ! -e "$BOOT/ShapeClone/.tmp" ] && [ ! -e "$BOOT/ShapeClone/.trash/clone-"* ] 2>/dev/null || [ -z "$(ls -d "$BOOT/ShapeClone/.trash/clone-"* 2>/dev/null)" ]' "no scratch folder and nothing dropped into the trash"
check '[ "$(cat "$BOOT/ShapeClone/.trash/old-note.md")" = "trashed" ]' "the trash holds what the REMOTE tracked there, nothing else"
# The vault's own files survive; only what exists on both sides is a change.
check 'git -C "$BOOT/ShapeClone" status --porcelain | grep -q "^ M .obsidian/app.json"' "a config file that exists on both sides is a local change"
check 'git -C "$BOOT/ShapeClone" status --porcelain | grep -q "^?? Projects/today.md"' "a note written before the clone is kept, untracked"
check '[ -f "$BOOT/ShapeClone/.obsidian/workspace.json" ]' "a file the remote gitignores is left alone"
check '[ -f "$BOOT/ShapeClone/Private/Hidden/mem.md" ] && [ -f "$BOOT/ShapeClone/Projects/Archive/spec.md" ]' "the repository's own folders are all checked out"
check '[ "$(git -C "$BOOT/ShapeClone" rev-parse HEAD)" = "$(git -C "$BOOT/ShapeInit" rev-parse HEAD)" ]' "…on the same commit either way"

echo "# phase 7: re-cloning a vault that already has a repository"
# The old repository may hold commits that exist nowhere else, so it is set
# aside, never deleted — and only after the new clone has actually succeeded.
newvault "$BOOT/ReClone"
mkdir -p "$BOOT/ReClone/Notes"
echo "local version" > "$BOOT/ReClone/Notes/note.md"
echo "only here" > "$BOOT/ReClone/mine.md"
brun >/dev/null
RC_RT="$BOOT/ReClone/.obsidian/plugins/native-git-bridge/runtime"
RC_TOKEN="$(jq -r .token "$RC_RT/pairing.json")"; RC_PID="$(jq -r .profileId "$RC_RT/pairing.json")"
breq "$RC_RT" "r-20260806T112000Z-rc01" "$RC_TOKEN" init-repo "$RC_PID" '{"branch":"scratch","initialCommit":true,"message":"e2e: history of its own"}'
brun >/dev/null
OLD_HEAD="$(git -C "$BOOT/ReClone" rev-parse HEAD)"
breq "$RC_RT" "r-20260806T112001Z-rc02" "$RC_TOKEN" clone-into-vault "$RC_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
check 'jq -e ".error.code == \"REPO_EXISTS\"" "$RC_RT/results/r-20260806T112001Z-rc02.json" >/dev/null' "without asking, an existing repository is still never replaced"
# A clone that FAILS must leave the existing repository exactly where it is.
breq "$RC_RT" "r-20260806T112002Z-rc03" "$RC_TOKEN" clone-into-vault "$RC_PID" '{"url":"file:///nonexistent/nope.git","replaceExisting":true}'
brun >/dev/null
check 'jq -e ".error.code == \"GIT_FAILED\"" "$RC_RT/results/r-20260806T112002Z-rc03.json" >/dev/null' "a failing re-clone fails"
check '[ "$(git -C "$BOOT/ReClone" rev-parse HEAD)" = "$OLD_HEAD" ]' "…and the existing repository is untouched"
check '[ -z "$(ls -d "$RC_RT"/previous-git-* 2>/dev/null)" ]' "…and nothing was set aside"
breq "$RC_RT" "r-20260806T112003Z-rc04" "$RC_TOKEN" clone-into-vault "$RC_PID" "{\"url\":\"file://$ROOT/remote.git\",\"replaceExisting\":true}"
brun >/dev/null
RES="$RC_RT/results/r-20260806T112003Z-rc04.json"
PREV="$(jq -r .data.previousGit "$RES")"
check 'jq -e ".ok == true" "$RES" >/dev/null' "asked explicitly, the re-clone runs"
check 'printf %s "$PREV" | grep -Eq "^previous-git-[0-9]{8}T[0-9]{6}Z$"' "the result names where the old repository went"
check '[ -d "$RC_RT/$PREV" ] && [ -f "$RC_RT/$PREV.json" ]' "the old repository and its manifest are in the runtime folder"
check '[ "$(git --git-dir="$RC_RT/$PREV" rev-parse HEAD)" = "$OLD_HEAD" ]' "the old history is intact and readable"
check '[ "$(jq -r .branch "$RC_RT/$PREV.json")" = "scratch" ]' "the manifest records the branch it was on"
check '[ "$(jq -r .commits "$RC_RT/$PREV.json")" -ge 1 ]' "…how many commits it had"
check '[ "$(jq -r .sizeKb "$RC_RT/$PREV.json")" -gt 0 ]' "…and how much disk it uses, so the plugin can say so"
check 'git -C "$BOOT/ReClone" remote add previous "$RC_RT/$PREV" && git -C "$BOOT/ReClone" fetch -q previous && git -C "$BOOT/ReClone" rev-parse --verify -q previous/scratch >/dev/null' "the old history can be attached to the new repository as a remote"
# And the new repository behaves exactly like any other clone.
check '[ "$(cat "$BOOT/ReClone/Notes/note.md")" = "local version" ]' "the vault's own file version is kept"
check 'git -C "$BOOT/ReClone" status --porcelain | grep -q "^ M Notes/note.md"' "…shown as a local change"
check '[ -f "$BOOT/ReClone/mine.md" ]' "a file that exists only in the vault is untouched"
check '[ "$(git -C "$BOOT/ReClone" rev-parse HEAD)" != "$OLD_HEAD" ]' "the new history is the remote's"

echo "# phase 7: a remote whose HEAD points at a branch it does not have"
# `git init --bare` writes HEAD -> master; pushing only `main` leaves that HEAD
# dangling. Plain `git clone` gives up here and leaves an unusable repository.
git init -q --bare "$ROOT/stale.git"
git clone -q "$ROOT/stale.git" "$ROOT/stale-seed" 2>/dev/null
git -C "$ROOT/stale-seed" config user.email e2e@example.com
git -C "$ROOT/stale-seed" config user.name E2E
git -C "$ROOT/stale-seed" checkout -qb only-this
echo content > "$ROOT/stale-seed/file.md"
git -C "$ROOT/stale-seed" add -A
git -C "$ROOT/stale-seed" commit -qm "stale head"
git -C "$ROOT/stale-seed" push -q origin only-this
newvault "$BOOT/StaleHead"
SH_RT="$BOOT/StaleHead/.obsidian/plugins/native-git-bridge/runtime"
brun >/dev/null
SH_TOKEN="$(jq -r .token "$SH_RT/pairing.json")"; SH_PID="$(jq -r .profileId "$SH_RT/pairing.json")"
breq "$SH_RT" "r-20260806T110000Z-sh01" "$SH_TOKEN" clone-into-vault "$SH_PID" "{\"url\":\"file://$ROOT/stale.git\"}"
brun >/dev/null
RES="$SH_RT/results/r-20260806T110000Z-sh01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "the clone picks the only branch there is"
check '[ "$(jq -r .data.branch "$RES")" = "only-this" ]' "…and reports it"
check '[ -f "$BOOT/StaleHead/file.md" ]' "…and the files are actually checked out"
check '[ "$(git -C "$BOOT/StaleHead" rev-parse --abbrev-ref "@{upstream}")" = "origin/only-this" ]' "…with an upstream, so pull and push work"

echo "# phase 7: a repository created inside another paired vault"
# VaultA from phase 6 is a repository; a vault inside it bootstraps its own.
newvault "$MULTI/VaultA/Inner"
IN_RT="$MULTI/VaultA/Inner/.obsidian/plugins/native-git-bridge/runtime"
echo inner > "$MULTI/VaultA/Inner/note.md"
NGB_CONFIG="$MCONF/config" NGB_SCAN_ROOTS="$MULTI" bash "$RUNNER" >/dev/null
IN_TOKEN="$(jq -r .token "$IN_RT/pairing.json" 2>/dev/null || true)"
IN_PID="$(jq -r .profileId "$IN_RT/pairing.json" 2>/dev/null || true)"
check '[ -n "$IN_TOKEN" ]' "a vault inside another vault's repository can pair for bootstrap"
breq "$IN_RT" "r-20260806T107000Z-nst01" "$IN_TOKEN" init-repo "$IN_PID" '{"branch":"main"}'
NGB_CONFIG="$MCONF/config" NGB_SCAN_ROOTS="$MULTI" bash "$RUNNER" >/dev/null
check 'jq -e ".ok == true" "$IN_RT/results/r-20260806T107000Z-nst01.json" >/dev/null' "init-repo works inside another repository"
check 'grep -qxF "/Inner/" "$MULTI/VaultA/.git/info/exclude"' "the new repository is excluded from the outer one immediately"
check '! git -C "$MULTI/VaultA" status --porcelain | grep -q "Inner"' "…so the outer repository never offers its files"

# =============================================================================
# phase 8: installing with no network at all
# =============================================================================
# Every build copies the Termux scripts into the plugin folder, so the vault on
# the device already carries them. bootstrap.sh must then work from that copy
# without a URL, without NGB_VERSION, and without touching the network — which
# is also the only way to install while GitHub is unreachable.

echo "# phase 8: bootstrap.sh takes the installer from the folder it lives in"
PLUGDIR="$ROOT/vault/.obsidian/plugins/native-git-bridge/termux"
mkdir -p "$PLUGDIR"
cp "$SCRIPT_DIR/native-git-bridge/termux/bootstrap.sh" "$PLUGDIR/"
check '[ -f "$SCRIPT_DIR/native-git-bridge/termux/install.sh" ] && [ -f "$SCRIPT_DIR/native-git-bridge/termux/native-git-bridge-runner.sh" ]' "install.sh and the runner ship inside the plugin folder"
check '[ ! -d "$SCRIPT_DIR/termux" ]' "the scripts live in the plugin folder only — no second copy to drift"
# Stand-ins for the two scripts: the real installer refuses to run outside
# Termux, and what is under test here is which files bootstrap picks and with
# which arguments — not the install itself.
printf '#!/usr/bin/env bash\necho "INSTALLER ARGS: $*"\n' > "$PLUGDIR/install.sh"
printf '#!/usr/bin/env bash\necho runner\n' > "$PLUGDIR/native-git-bridge-runner.sh"
OUT="$(bash "$PLUGDIR/bootstrap.sh" "$ROOT/vault" 2>&1)"
check 'printf %s "$OUT" | grep -q "INSTALLER ARGS: $ROOT/vault"' "running the copy needs no arguments beyond the vault, and no network"
check 'printf %s "$OUT" | grep -q "Taking the Native Git Bridge installer from $PLUGDIR"' "…and it says where it took the files from"
check '! printf %s "$OUT" | grep -qi "download"' "…without downloading anything"
# NGB_BASE_URL as a plain directory: the documented way when the script is piped.
OUT="$(cat "$PLUGDIR/bootstrap.sh" | NGB_BASE_URL="$PLUGDIR" bash -s -- "$ROOT/vault" 2>&1)"
check 'printf %s "$OUT" | grep -q "INSTALLER ARGS: $ROOT/vault"' "NGB_BASE_URL may be a plain directory path, not only a URL"
OUT="$(cat "$PLUGDIR/bootstrap.sh" | NGB_BASE_URL="file://$PLUGDIR" bash -s -- "$ROOT/vault" 2>&1)"
check 'printf %s "$OUT" | grep -q "INSTALLER ARGS: $ROOT/vault"' "…or a file:// URL"
# A folder that was copied incompletely must say so instead of running half of it.
mkdir -p "$ROOT/half"
cp "$PLUGDIR/bootstrap.sh" "$ROOT/half/"
printf 'not a script\n' > "$ROOT/half/install.sh"
printf '#!/usr/bin/env bash\n' > "$ROOT/half/native-git-bridge-runner.sh"
OUT="$(NGB_BASE_URL="$ROOT/half" bash "$ROOT/half/bootstrap.sh" "$ROOT/vault" 2>&1 || true)"
check 'printf %s "$OUT" | grep -q "does not look like a script"' "a truncated or wrong file is refused, not executed"

# ---------------------------------------------------------------------------
# phase 9: getting OUT of states the plugin used to be unable to leave.
#
# Two dead ends were reported from a real device, and both are here because
# neither is reproducible by reading the code:
#   * a file staged inside a directory that was excluded from sparse checkout
#     AFTERWARDS. `sparse-checkout reapply` takes the file off disk and leaves
#     the index entry, git reports `AD`, the safety gate blocks every commit,
#     push and sync, and every repair the plugin offered was a no-op.
#   * an unfinished rebase, which the panel could not even see.
# ---------------------------------------------------------------------------
P9="$ROOT/p9"
P9CONF="$ROOT/conf-p9"
mkdir -p "$P9" "$P9CONF"
p9run() { NGB_CONFIG="$P9CONF/config" NGB_SCAN_ROOTS="$P9" bash "$RUNNER" "$@"; }

echo "# phase 9: a staged file inside a directory that became sparse-excluded"
git init -q --bare "$P9/remote.git"
git clone -q "$P9/remote.git" "$P9/vault" 2>/dev/null
cd "$P9/vault"
git config user.email test@example.com
git config user.name Test
mkdir -p Notes "Private/Mem"
echo "note" > Notes/note.md
git add -A && git commit -qm "initial" && git push -q origin HEAD
P9_RT="$P9/vault/.obsidian/plugins/native-git-bridge/runtime"
mkdir -p "$P9_RT/requests"
echo ".obsidian/plugins/native-git-bridge/runtime/" >> .git/info/exclude
P9_TOKEN="p9-token"
cat > "$P9CONF/config" <<CONF
NGB_REPO_DIR="$P9/vault"
NGB_TOKEN="$P9_TOKEN"
NGB_RUNTIME_DIR="$P9_RT"
CONF
p9req() { # $1 id, $2 action, $3 args
  local args="${3:-}"; [ -z "$args" ] && args='{}'
  cat > "$P9_RT/requests/$1.json" <<REQ
{"protocolVersion":1,"id":"$1","token":"$P9_TOKEN","action":"$2","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","timeoutSeconds":300,"args":$args}
REQ
}
P9PROT='["Private/Mem"]'

# Reproduce the state exactly: stage the file first, exclude the directory
# second. This ORDER is the whole bug; doing it the other way round never
# produces an index entry.
echo "handoff" > "Private/Mem/handoff.md"
git add "Private/Mem/handoff.md"
git sparse-checkout set --no-cone '/*' '!Private/Mem/' 2>/dev/null
git sparse-checkout reapply 2>/dev/null
check '[ ! -e "Private/Mem/handoff.md" ]' "the staged file is gone from the worktree after a sparse reapply"
# The shape that made this hard to diagnose: because sparse-checkout sets
# skip-worktree, git does NOT look at the worktree and reports a plain "A ",
# not "AD". So the index says "added", the disk says nothing at all, and the
# panel showed "added" twice with no hint that there was no file.
check 'git status --porcelain=v1 -- Private/Mem | grep -q "^A  "' "git reports a bare A: skip-worktree hides the missing file"
check 'git ls-files -v -- Private/Mem | grep -q "^S "' "…because the entry carries the skip-worktree bit"
p9req "r-20260807T090000Z-p9saf1" verify-sparse-safety "{\"protectedPaths\":$P9PROT}"
p9run >/dev/null
RES="$P9_RT/results/r-20260807T090000Z-p9saf1.json"
check 'jq -er ".data.statusProtected" "$RES" | grep -q "Private/Mem/handoff.md"' "the safety check sees it"
check 'jq -er ".data.stagedProtected" "$RES" | grep -q "^A.*handoff.md"' "…and so does the staged diff, which is why the gate blocks"

# The same accident WITHOUT skip-worktree (the file was removed by hand rather
# than by a sparse reapply) is the AD the parser now has to read correctly.
mkdir -p "Private/Mem"   # sparse checkout removed the directory itself
echo "loose" > "Private/Mem/loose.md"
# `-c core.sparseCheckout=false` for this ONE call, rather than `git add
# --sparse`: that flag only exists from git 2.35, so a fallback chain would run
# a different branch on the developer's git than on CI's, and the untested one
# would be CI's. Turning the guard off for a single invocation behaves the same
# on every version.
git -c core.sparseCheckout=false add "Private/Mem/loose.md"
git update-index --no-skip-worktree "Private/Mem/loose.md" 2>/dev/null || true
rm -f "Private/Mem/loose.md"
check 'git status --porcelain=v1 -- Private/Mem | grep -q "^AD "' "a staged addition whose file was deleted by hand is AD"
git update-index --force-remove "Private/Mem/loose.md" 2>/dev/null || true

echo "# phase 9: the commit is blocked, and deleting files cannot unblock it"
p9req "r-20260807T090001Z-p9cmt1" commit "{\"message\":\"e2e: blocked\",\"protectedPaths\":$P9PROT}"
p9run >/dev/null
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$P9_RT/results/r-20260807T090001Z-p9cmt1.json" >/dev/null' "commit is blocked by the sparse gate"
check '[ ! -e "Private/Mem/handoff.md" ]' "there is no file to delete: the old repair could only ever move zero files"

echo "# phase 9: unstage-protected clears the index entry, and only that"
p9req "r-20260807T090002Z-p9uns1" unstage-protected "{\"paths\":[\"Private/Mem/handoff.md\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
RES="$P9_RT/results/r-20260807T090002Z-p9uns1.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "unstage-protected ok"
check '[ "$(jq -r .data.unstagedProtectedCount "$RES")" = "1" ]' "it reports what it actually removed"
check '! git ls-files --cached -- "Private/Mem/handoff.md" | grep -q .' "the index entry is gone"
check '[ -z "$(git status --porcelain=v1 -- Private/Mem)" ]' "the protected path no longer shows as a change"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head"' "fresh status rides along"

echo "# phase 9: …so the commit that was blocked now goes through"
echo "more" >> Notes/note.md
p9req "r-20260807T090003Z-p9cmt2" commit "{\"message\":\"e2e: unblocked\",\"protectedPaths\":$P9PROT}"
p9run >/dev/null
check 'jq -e ".ok == true" "$P9_RT/results/r-20260807T090003Z-p9cmt2.json" >/dev/null' "commit succeeds once the index entry is gone"
check '! git log -1 --name-only --format= | grep -q "Private/Mem"' "and the protected path is NOT in that commit"

echo "# phase 9: unstage-protected is not a general bypass"
p9req "r-20260807T090004Z-p9uns2" unstage-protected "{\"paths\":[\"Notes/note.md\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$P9_RT/results/r-20260807T090004Z-p9uns2.json" >/dev/null' "a path that is NOT protected is refused"
check 'git ls-files --cached -- Notes/note.md | grep -q .' "…and its index entry is untouched"
p9req "r-20260807T090005Z-p9uns3" unstage-protected "{\"paths\":[\"../outside.md\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$P9_RT/results/r-20260807T090005Z-p9uns3.json" >/dev/null' "a traversal path is refused"
p9req "r-20260807T090005Z-p9uns6" unstage-protected '{"paths":["Private/Mem/x.md"],"protectedPaths":[]}'
p9run >/dev/null
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$P9_RT/results/r-20260807T090005Z-p9uns6.json" >/dev/null' "an empty protectedPaths list is refused: it IS the permission model"

# The two guards depend on git parsing the path the same way in both commands,
# and it does not: `ls-files`/`ls-tree` take a PATHSPEC, `update-index` takes a
# literal path. Both guards therefore match the exact index entry, so neither a
# glob nor a directory can pass as something it is not.
mkdir -p "Private/Mem/Deep"
echo "deep" > "Private/Mem/Deep/inner.md"
git -c core.sparseCheckout=false add "Private/Mem/Deep/inner.md"
p9req "r-20260807T090008Z-p9uns7" unstage-protected "{\"paths\":[\"Private/Mem/*\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
RES="$P9_RT/results/r-20260807T090008Z-p9uns7.json"
check '[ "$(jq -r ".ok" "$RES")" != "true" ] || [ "$(jq -r .data.unstagedProtectedCount "$RES")" = "0" ]' "a glob never counts as a removal it did not make"
check 'git ls-files --cached -- "Private/Mem/Deep/inner.md" | grep -q .' "…and nothing was removed by it"
p9req "r-20260807T090009Z-p9uns8" unstage-protected "{\"paths\":[\"Private/Mem/Deep\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
RES="$P9_RT/results/r-20260807T090009Z-p9uns8.json"
check '[ "$(jq -r .data.unstagedProtectedCount "$RES")" = "0" ]' "a DIRECTORY is not reported as an entry that was removed"
check 'git ls-files --cached -- "Private/Mem/Deep/inner.md" | grep -q .' "…and its children keep their index entries"
p9req "r-20260807T090009Z-p9uns9" unstage-protected "{\"paths\":[\"Private/Mem/Deep/inner.md\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
check '[ "$(jq -r .data.unstagedProtectedCount "$P9_RT/results/r-20260807T090009Z-p9uns9.json")" = "1" ]' "the nested file itself is removed when named exactly"
check '! git ls-files --cached -- "Private/Mem/Deep/inner.md" | grep -q .' "…and it is gone from the index"
rm -rf "Private/Mem/Deep"

# The constraint that makes the action safe: a protected path that IS in HEAD
# would become a staged DELETION, which is the accident this plugin exists for.
git sparse-checkout disable 2>/dev/null
mkdir -p "Private/Mem"
echo "committed" > "Private/Mem/tracked.md"
git add "Private/Mem/tracked.md" && git commit -qm "e2e: protected file in HEAD"
echo "edited" >> "Private/Mem/tracked.md"
git add "Private/Mem/tracked.md"
p9req "r-20260807T090006Z-p9uns4" unstage-protected "{\"paths\":[\"Private/Mem/tracked.md\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$P9_RT/results/r-20260807T090006Z-p9uns4.json" >/dev/null' "a protected path that is tracked in HEAD is refused"
check 'git ls-files --cached -- "Private/Mem/tracked.md" | grep -q .' "…and nothing was removed from the index"
check '[ -e "Private/Mem/tracked.md" ]' "…and the file is still on disk"

echo "# phase 9: unstage-protected is idempotent"
p9req "r-20260807T090007Z-p9uns5" unstage-protected "{\"paths\":[\"Private/Mem/handoff.md\"],\"protectedPaths\":$P9PROT}"
p9run >/dev/null
RES="$P9_RT/results/r-20260807T090007Z-p9uns5.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "re-running it on an already-cleared path is not an error"
check '[ "$(jq -r .data.unstagedProtectedCount "$RES")" = "0" ]' "…and it says it removed nothing"

echo "# phase 9: an unfinished rebase is visible, and has both exits"
git reset -q --hard HEAD
git checkout -q -b side
echo "side" > Notes/note.md && git commit -qam "e2e: side edit"
git checkout -q -
echo "trunk" > Notes/note.md && git commit -qam "e2e: trunk edit"
git checkout -q side
git rebase master >/dev/null 2>&1 || git rebase main >/dev/null 2>&1 || true
check 'git status | grep -qi "rebase"' "a conflicting rebase is genuinely in progress"
p9req "r-20260807T090010Z-p9reb1" status
p9run >/dev/null
RES="$P9_RT/results/r-20260807T090010Z-p9reb1.json"
check '[ "$(jq -r .data.rebaseInProgress "$RES")" = "true" ]' "status reports the rebase, which the panel had no way to see before"
p9req "r-20260807T090011Z-p9reb2" continue-rebase
p9run >/dev/null
check 'jq -e ".error.code == \"CONFLICT\"" "$P9_RT/results/r-20260807T090011Z-p9reb2.json" >/dev/null' "continue is refused while a file is still conflicted (it would open an editor)"
check 'jq -er ".error.message" "$P9_RT/results/r-20260807T090011Z-p9reb2.json" | grep -q "still conflicted"' "…and says why"
p9req "r-20260807T090012Z-p9reb3" abort-rebase
p9run >/dev/null
check 'jq -e ".ok == true" "$P9_RT/results/r-20260807T090012Z-p9reb3.json" >/dev/null' "abort-rebase ok"
check '! git status | grep -qi "rebase in progress"' "the rebase state directory is gone"
check '[ "$(jq -r .data.rebaseInProgress "$P9_RT/results/r-20260807T090012Z-p9reb3.json")" = "false" ]' "…and the result says so"
p9req "r-20260807T090013Z-p9reb4" abort-rebase
p9run >/dev/null
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$P9_RT/results/r-20260807T090013Z-p9reb4.json" >/dev/null' "aborting when there is no rebase is a clear refusal, not a crash"

echo "# phase 9: a rebase that CAN be continued, is"
echo "base" > Notes/note.md && git commit -qam "e2e: rebase base"
git checkout -q -b side2
echo "own line" > Notes/other.md && git add Notes/other.md && git commit -qm "e2e: side2 commit"
git checkout -q side
echo "trunk again" > Notes/third.md && git add Notes/third.md && git commit -qm "e2e: side moves on"
git checkout -q side2
git rebase side >/dev/null 2>&1 || true
if git status | grep -qi "rebase in progress"; then
  p9req "r-20260807T090014Z-p9reb5" continue-rebase
  p9run >/dev/null
  check 'jq -e ".ok == true" "$P9_RT/results/r-20260807T090014Z-p9reb5.json" >/dev/null' "continue-rebase completes a rebase with nothing left to resolve"
else
  # A clean rebase finishes by itself; the interesting assertion is then that
  # the runner does not claim there is something to continue.
  p9req "r-20260807T090014Z-p9reb5" continue-rebase
  p9run >/dev/null
  check 'jq -e ".error.code == \"BAD_REQUEST\"" "$P9_RT/results/r-20260807T090014Z-p9reb5.json" >/dev/null' "a rebase that already finished cleanly reports nothing to continue"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
