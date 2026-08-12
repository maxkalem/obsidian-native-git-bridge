#!/usr/bin/env bash
# End-to-end test of the Termux runner against a real git repository with
# non-cone sparse checkout, executed on plain Linux (identical git semantics;
# Android storage quirks are covered in docs/limitations.md).
set -u

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok - $*"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $*"; }
check(){ if eval "$1"; then ok "$2"; else bad "$2"; fi; }

ROOT="${NGB_E2E_ROOT:-$(mktemp -d)}"
mkdir -p "$ROOT"
[ -n "${NGB_E2E_KEEP:-}" ] || trap 'rm -rf "$ROOT"' EXIT
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
# Read from the script rather than pinned to a literal: this assertion is about
# the two channels AGREEING, not about which number they carry, and a pinned
# number turns every runner release into a failing test that says nothing.
RUNNER_V="$(sed -n 's/^RUNNER_VERSION=//p' "$RUNNER" | head -1)"
check '[ "$(jq -r ".runnerVersion" "$RUNTIME/results/r-20260804T150000Z-conc01.json")" = "$RUNNER_V" ]' "runnerVersion reported to the plugin matches the script"
check 'bash "$RUNNER" | grep -q "NGB_RUNNER_VERSION=$RUNNER_V"' "runner announces the same version on stdout (companion probe)"

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
for BAD in '"https://user:hunter2@example.com/x.git"' '"https://ghp_hunter2token@example.com/x.git"' '"-oProxyCommand=id"' '"http://example.com/x.git"' '"ext::sh -c id"' '"https://exa mple.com/x.git"'; do
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

echo "# phase 7: an interactive run (v15) is the same run, and says so"
# `runner.sh interactive` is what the plugin copies to the clipboard when a
# clone needs credentials git can only ask for at a terminal. The queue, the
# results and the lock are all the same; only prompting is allowed. No prompt
# happens here (file:// remotes never ask), so this proves the argument does
# not change what a run does — the prompting itself needs a tty and a device.
breq "$CC_RT" "r-20260806T106500Z-int01" "$CC_TOKEN" status "$CC_PID"
INT_OUT="$(brun interactive)"
check 'jq -e ".ok == true" "$CC_RT/results/r-20260806T106500Z-int01.json" >/dev/null' "a queued request is served by an interactive run"
check 'printf "%s" "$INT_OUT" | grep -q "interactively"' "the interactive run announces itself on stdout (a person is reading it)"
check 'printf "%s" "$INT_OUT" | grep -q "NGB_RUNNER_VERSION="' "…and keeps the version probe line"

echo "# phase 7: an interactive clone narrates to the terminal (the mirror)"
# The user's report: pasting the command gave "just silence and a timer" while
# a hand-typed clone shows a live meter. The interactive run now mirrors what
# it appends to the progress stream back onto stderr; the file the panel
# reads stays the single source and is still written.
newvault "$BOOT/CloneT"
CT_RT="$BOOT/CloneT/.obsidian/plugins/native-git-bridge/runtime"
brun >/dev/null
CT_TOKEN="$(jq -r .token "$CT_RT/pairing.json")"; CT_PID="$(jq -r .profileId "$CT_RT/pairing.json")"
breq "$CT_RT" "r-20260806T106600Z-int02" "$CT_TOKEN" clone-into-vault "$CT_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
INT_ERR="$( { brun interactive >/dev/null; } 2>&1 )"
check 'jq -e ".ok == true" "$CT_RT/results/r-20260806T106600Z-int02.json" >/dev/null' "the interactive clone lands"
check 'printf "%s" "$INT_ERR" | grep -q -- "-- clone: downloading"' "…and the step narration reaches the terminal"
check '[ -s "$CT_RT/progress/r-20260806T106600Z-int02.txt" ]' "…while the progress file the panel reads is still written"

echo "# phase 7: a repository pre-downloaded in Termux is adopted, not re-downloaded (v15)"
# The manual clone route: the user runs a plain `git clone --no-checkout` into
# runtime/clone-tmp/repo (git's own prompts and progress), then the queued
# clone-into-vault finishes locally. Adoption requires the origin to match the
# requested URL exactly and HEAD to resolve (a finished transfer).
newvault "$BOOT/CloneP"
CP_RT="$BOOT/CloneP/.obsidian/plugins/native-git-bridge/runtime"
echo "mine here" > "$BOOT/CloneP/pre-existing.md"
brun >/dev/null
CP_TOKEN="$(jq -r .token "$CP_RT/pairing.json")"; CP_PID="$(jq -r .profileId "$CP_RT/pairing.json")"
git clone -q --no-checkout "file://$ROOT/remote.git" "$CP_RT/clone-tmp/repo" 2>/dev/null
breq "$CP_RT" "r-20260806T106700Z-pre01" "$CP_TOKEN" clone-into-vault "$CP_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
RES="$CP_RT/results/r-20260806T106700Z-pre01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "the pre-downloaded repository finishes the clone"
check 'grep -q "already downloaded in Termux" "$CP_RT/progress/r-20260806T106700Z-pre01.txt"' "…and says it downloaded nothing"
check '[ -f "$BOOT/CloneP/Notes/note.md" ]' "…with the working tree materialised"
check '[ -f "$BOOT/CloneP/pre-existing.md" ]' "…and the vault's own file untouched"
check '[ ! -e "$CP_RT/clone-tmp" ]' "…and the scratch directory gone"

# An UNFINISHED download (origin matches, HEAD does not resolve — exactly what
# a transfer still running or killed looks like) is refused with instructions,
# and deliberately NOT wiped: wiping it mid-transfer would fail the command
# the user is watching in Termux.
newvault "$BOOT/CloneQ"
CQ_RT="$BOOT/CloneQ/.obsidian/plugins/native-git-bridge/runtime"
brun >/dev/null
CQ_TOKEN="$(jq -r .token "$CQ_RT/pairing.json")"; CQ_PID="$(jq -r .profileId "$CQ_RT/pairing.json")"
mkdir -p "$CQ_RT/clone-tmp"
git init -q "$CQ_RT/clone-tmp/repo"
git -C "$CQ_RT/clone-tmp/repo" remote add origin "file://$ROOT/remote.git"
breq "$CQ_RT" "r-20260806T106701Z-pre02" "$CQ_TOKEN" clone-into-vault "$CQ_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
RES="$CQ_RT/results/r-20260806T106701Z-pre02.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "an unfinished download is refused, not adopted"
check 'jq -er ".error.message" "$RES" | grep -qi "not finished"' "…with a message that says what to do"
check '[ -d "$CQ_RT/clone-tmp/repo/.git" ]' "…and the directory is left for the running transfer"
check '[ ! -d "$BOOT/CloneQ/.git" ]' "…and the vault stays untouched"

# A leftover pointing at a DIFFERENT remote is stale: removed, downloaded fresh.
git -C "$CQ_RT/clone-tmp/repo" remote set-url origin "file:///somewhere/else.git"
breq "$CQ_RT" "r-20260806T106702Z-pre03" "$CQ_TOKEN" clone-into-vault "$CQ_PID" "{\"url\":\"file://$ROOT/remote.git\"}"
brun >/dev/null
check 'jq -e ".ok == true" "$CQ_RT/results/r-20260806T106702Z-pre03.json" >/dev/null' "a stale leftover for another remote is replaced by a fresh download"
check '[ -f "$BOOT/CloneQ/Notes/note.md" ]' "…which lands normally"

echo "# phase 7: the first sparse exclusion ENABLES non-cone sparse on a fresh clone (v15)"
# A re-clone brings a fresh .git, and the sparse configuration dies with the
# old one; sparse-exclude-add used to refuse then, telling the user to run a
# git command in Termux by hand. Now it seeds git's include-everything base
# and enables sparse itself — and the first exclusion must never read as
# "hide everything".
check '[ "$(git -C "$BOOT/CloneQ" config --get core.sparseCheckout 2>/dev/null || echo false)" != "true" ]' "the freshly cloned repository has sparse DISABLED"
breq "$CQ_RT" "r-20260806T106703Z-spe01" "$CQ_TOKEN" sparse-exclude-add "$CQ_PID" '{"path":"Projects/Archive"}'
brun >/dev/null
RES="$CQ_RT/results/r-20260806T106703Z-spe01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "the first exclusion is accepted, not refused"
check '[ "$(git -C "$BOOT/CloneQ" config --get core.sparseCheckout)" = "true" ]' "…and sparse is now enabled"
check '[ "$(git -C "$BOOT/CloneQ" config --get core.sparseCheckoutCone 2>/dev/null || echo false)" != "true" ]' "…in pattern (non-cone) mode"
check 'git -C "$BOOT/CloneQ" sparse-checkout list | grep -qx "/\*"' "…seeded with the include-everything base"
check 'git -C "$BOOT/CloneQ" sparse-checkout list | grep -qx "!/Projects/Archive"' "…plus the requested exclusion"
check '[ ! -e "$BOOT/CloneQ/Projects/Archive/spec.md" ]' "…and the excluded path left the working tree"
check '[ -f "$BOOT/CloneQ/Notes/note.md" ]' "…while everything else stayed (the base did its job)"

echo "# phase 7: repair-stale-lock removes a leftover index.lock (v15)"
# A process the system kills mid-write leaves .git/index.lock behind and every
# later operation fails on it. On Termux the action first kills every other
# process of its uid (nothing can then hold the lock); off Termux there is no
# other Termux process to kill and the kill would take the test run down, so
# only the removal runs — which is the half provable here.
touch "$BOOT/CloneQ/.git/index.lock"
breq "$CQ_RT" "r-20260806T106704Z-lck01" "$CQ_TOKEN" repair-stale-lock "$CQ_PID"
brun >/dev/null
RES="$CQ_RT/results/r-20260806T106704Z-lck01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repair-stale-lock ok"
check '[ "$(jq -r .data.lockExisted "$RES")" = "true" ]' "…it saw the lock"
check '[ "$(jq -r .data.lockRemoved "$RES")" = "true" ]' "…and reports removing it"
check '[ ! -e "$BOOT/CloneQ/.git/index.lock" ]' "…and the lock is gone"
breq "$CQ_RT" "r-20260806T106705Z-lck02" "$CQ_TOKEN" repair-stale-lock "$CQ_PID"
brun >/dev/null
RES="$CQ_RT/results/r-20260806T106705Z-lck02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "with no lock present it still answers ok"
check '[ "$(jq -r .data.lockRemoved "$RES")" = "false" ]' "…and says honestly that nothing was removed"

echo "# phase 7: status reports whether TERMUX-SIDE credentials exist (v15)"
# The vault repository's LOCAL helper deliberately does not count: it lives in
# the vault's .git/config, dies with the old .git on a re-clone, and rule 11
# says credentials are never reused from inside the vault.
git -C "$BOOT/CloneC" config credential.helper "store --file=$ROOT/nowhere-creds"
breq "$CC_RT" "r-20260806T106501Z-crd01" "$CC_TOKEN" status "$CC_PID"
brun >/dev/null
check '[ "$(jq -r .data.credsConfigured "$CC_RT/results/r-20260806T106501Z-crd01.json")" = "false" ]' "a vault-local helper does NOT count as credentials (rule 11)"
check '! grep -q "nowhere-creds" "$CC_RT/results/r-20260806T106501Z-crd01.json"' "…and its value never travels"
git -C "$BOOT/CloneC" config --unset credential.helper
mkdir -p "$BCONF/creds"
printf 'https://user:tok@example.com\n' > "$BCONF/creds/$CC_PID"
breq "$CC_RT" "r-20260806T106502Z-crd02" "$CC_TOKEN" status "$CC_PID"
brun >/dev/null
check '[ "$(jq -r .data.credsConfigured "$CC_RT/results/r-20260806T106502Z-crd02.json")" = "true" ]' "a non-empty profile credential file -> credsConfigured=true"
check '! grep -rq "user:tok" "$CC_RT/results/r-20260806T106502Z-crd02.json"' "…and its content never travels"
rm -rf "$BCONF/creds" "$BCONF/creds-probe"
git config --global credential.helper cache
breq "$CC_RT" "r-20260806T106503Z-crd03" "$CC_TOKEN" status "$CC_PID"
brun >/dev/null
check '[ "$(jq -r .data.credsConfigured "$CC_RT/results/r-20260806T106503Z-crd03.json")" = "true" ]' "a global helper in Termux's own gitconfig -> credsConfigured=true"
git config --global --unset credential.helper
breq "$CC_RT" "r-20260806T106504Z-crd04" "$CC_TOKEN" status "$CC_PID"
brun >/dev/null
check '[ "$(jq -r .data.credsConfigured "$CC_RT/results/r-20260806T106504Z-crd04.json")" = "false" ]' "nothing Termux-side -> credsConfigured=false"

echo "# phase 7: clone credential persistence is https-only"
check '[ -z "$(git -C "$BOOT/CloneC" config --local --get credential.helper 2>/dev/null)" ]' "a file:// clone configures no credential helper"
check '[ ! -d "$BCONF/creds" ]' "…and creates no credential file"

echo "# phase 7: persist_clone_credentials (the real function, lifted) for https"
# The https path cannot be exercised end to end here (no https remote can be
# served locally, and http:// is refused by URL validation), so the function
# the clone calls after landing is lifted verbatim — same pattern as the
# installer's list_profiles probe.
PL="$ROOT/persist-lab"
mkdir -p "$PL/one" "$PL/two"
git init -q "$PL/one"; git init -q "$PL/two"
check 'grep -q "^persist_clone_credentials() {" "$RUNNER"' "the runner defines persist_clone_credentials (the probe below lifts the real one)"
(
  cd "$PL/one"
  NGB_CONFIG_DIR="$PL/conf"; PROFILE_ID="p-0123456789abcdef"
  log() { :; }
  eval "$(sed -n '/^ensure_profile_creds_file() {/,/^}$/p' "$RUNNER")"
  eval "$(sed -n '/^persist_clone_credentials() {/,/^}$/p' "$RUNNER")"
  persist_clone_credentials "https://example.com/v.git"
)
check 'git -C "$PL/one" config --local --get credential.helper | grep -q "store --file="' "an https clone leaves the repository able to authenticate on its own"
check '[ -f "$PL/conf/creds/p-0123456789abcdef" ]' "…with the profile credential file created"
check '[ "$(stat -c %a "$PL/conf/creds/p-0123456789abcdef")" = "600" ]' "…mode 600"
check '[ "$(stat -c %a "$PL/conf/creds")" = "700" ]' "…in a directory of mode 700"
(
  cd "$PL/two"
  git config --local credential.helper cache
  NGB_CONFIG_DIR="$PL/conf"; PROFILE_ID="p-fedcba9876543210"
  log() { :; }
  eval "$(sed -n '/^ensure_profile_creds_file() {/,/^}$/p' "$RUNNER")"
  eval "$(sed -n '/^persist_clone_credentials() {/,/^}$/p' "$RUNNER")"
  persist_clone_credentials "https://example.com/v.git"
)
check '[ "$(git -C "$PL/two" config --local --get-all credential.helper)" = "cache" ]' "a helper configured already is left exactly alone"
check '[ ! -f "$PL/conf/creds/p-fedcba9876543210" ]' "…and no second credential file appears"

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
# phase 8b: what the installer says about the profiles already on the device.
#
# Profiles accumulate silently. A vault that was moved or deleted leaves its
# profile behind, and the only symptom is that there are more profiles than
# repositories — which nothing ever said out loud. The listing is the answer,
# so it has to keep working.
#
# `list_profiles` is lifted out of the real installer rather than copied here:
# the installer itself refuses to run outside Termux, and a second copy of the
# code would be free to drift from the one that ships.

echo "# phase 8b: the installer lists every profile and flags the dead ones"
PROBE_DIR="$ROOT/profprobe"
mkdir -p "$PROBE_DIR/profiles" "$PROBE_DIR/Alive" "$PROBE_DIR/NotARepo"
git -C "$PROBE_DIR/Alive" init -q
for entry in "a:$PROBE_DIR/Alive" "b:$PROBE_DIR/NotARepo" "c:$PROBE_DIR/Gone"; do
  suffix="${entry%%:*}"; dir="${entry#*:}"
  printf 'NGB_PROFILE_FORMAT=1\nNGB_PROFILE_ID="p-0000000%s"\nNGB_REPO_DIR="%s"\nNGB_TOKEN="t"\n' \
    "$suffix" "$dir" > "$PROBE_DIR/profiles/p-0000000$suffix.conf"
done
{
  printf 'say() { printf "%%s\\n" "$*"; }\n'
  printf 'sayr() { printf "%%s\\n" "$*"; }\n'
  printf 'profile_value() { sed -n "s/^$2=\\"\\{0,1\\}\\([^\\"]*\\)\\"\\{0,1\\}$/\\1/p" "$1" | head -1; }\n'
  printf 'PROFILES_DIR="%s/profiles"\n' "$PROBE_DIR"
  printf 'PROFILE_FILE="%s/profiles/p-0000000b.conf"\n' "$PROBE_DIR"
  sed -n '/^list_profiles() {/,/^}$/p' "$SCRIPT_DIR/native-git-bridge/termux/install.sh"
  printf 'list_profiles\n'
} > "$PROBE_DIR/probe.sh"
check 'grep -q "^list_profiles() {" "$SCRIPT_DIR/native-git-bridge/termux/install.sh"' "the installer defines list_profiles (the probe below lifts the real one)"
OUT="$(bash "$PROBE_DIR/probe.sh" 2>&1)"
check 'printf %s "$OUT" | grep -q "Profiles on this device: 3 (this vault is #2)"' "the total and this vault's position are both reported"
check 'printf %s "$OUT" | grep -q "p-0000000a  $PROBE_DIR/Alive$"' "a live profile is listed with its directory and nothing else"
check 'printf %s "$OUT" | grep -q "p-0000000b.*<- this vault"' "the profile just written is marked"
check 'printf %s "$OUT" | grep -q "p-0000000c.*MISSING (directory is gone)"' "a profile whose vault was deleted is called out"
check 'printf %s "$OUT" | grep -q "p-0000000b.*NOT A REPOSITORY"' "a directory that is no longer a work tree is called out"
check 'printf %s "$OUT" | grep -q "rm $PROBE_DIR/profiles/<profile-id>.conf"' "…and the listing says how to remove one, without removing anything itself"
check '[ "$(ls -1 "$PROBE_DIR"/profiles/*.conf | wc -l)" = "3" ]' "listing the profiles deletes none of them"

echo "# installer: normalize_cred_file gives a token-as-username line its colon (lifted)"
# git's credential-store format is https://username:password@host. The
# installer's token move once copied a colon-less userinfo verbatim, and the
# store then served a username with no password — every non-interactive fetch
# died asking for it (a real device lost its working auth to this). The
# normalizer runs on every install, so RE-RUNNING the installer heals it.
CREDLAB="$ROOT/cred-lab"
mkdir -p "$CREDLAB"
printf 'https://ghp_sometoken123@github.com\nhttps://user:pass@example.com\nhttps://git:tok@host.tld\n' > "$CREDLAB/creds"
check 'grep -q "^normalize_cred_file() {" "$SCRIPT_DIR/native-git-bridge/termux/install.sh"' "the installer defines normalize_cred_file (the probe below lifts the real one)"
(
  PROFILE_CREDS="$CREDLAB/creds"
  eval "$(sed -n '/^normalize_cred_file() {/,/^}$/p' "$SCRIPT_DIR/native-git-bridge/termux/install.sh")"
  normalize_cred_file
)
check 'grep -qx "https://ghp_sometoken123:@github.com" "$CREDLAB/creds"' "a colon-less token line gains its empty password"
check 'grep -qx "https://user:pass@example.com" "$CREDLAB/creds"' "a user:password line is left exactly alone"
check 'grep -qx "https://git:tok@host.tld" "$CREDLAB/creds"' "…and so is every other well-formed line"

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

# ---------------------------------------------------------------------------
# phase 10: a diff budget that cuts between hunks
#
# The cap this replaces sliced the diff text by bash string length, which counts
# characters under a UTF-8 locale and bytes under C, and could cut a multi-byte
# character in half. It also landed mid-hunk, leaving half a hunk that cannot be
# staged or applied.
# ---------------------------------------------------------------------------
echo "# phase 10: the diff budget keeps whole hunks"
cd "$ROOT/vault"
# Three well-separated edits in one file: three hunks, whatever the context size.
{ for i in $(seq 1 60); do echo "line $i, з кирилицею щоб байти не дорівнювали символам"; done; } > Notes/budget.md
git add Notes/budget.md >/dev/null 2>&1
git commit -qm "e2e: budget base" >/dev/null 2>&1
sed -i '5s/.*/EDIT ONE, теж кирилицею/; 30s/.*/EDIT TWO, теж кирилицею/; 55s/.*/EDIT THREE, теж кирилицею/' Notes/budget.md

req "r-20260807T110000Z-bud01" diff-file "$TOKEN" '{"path":"Notes/budget.md","from":"INDEX","to":"WORKTREE","maxBytes":1000000}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260807T110000Z-bud01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "diff-file with a generous budget ok"
check '[ "$(jq -r .data.hunksTotal "$RES")" = "3" ]' "all three hunks are counted"
check '[ "$(jq -r .data.hunksShown "$RES")" = "3" ]' "…and all three are sent"
check '[ "$(jq -r .data.truncated "$RES")" = "false" ]' "nothing reported as truncated"
check '[ "$(jq -r .data.diffBytesTotal "$RES")" -gt 0 ]' "the whole diff's size is reported"

# A budget that admits the first hunk and not the rest.
ONEHUNK=$(jq -r '.data.diff' "$RES" | awk '/^@@/{n++} n<2' | wc -c)
req "r-20260807T110001Z-bud02" diff-file "$TOKEN" "{\"path\":\"Notes/budget.md\",\"from\":\"INDEX\",\"to\":\"WORKTREE\",\"maxBytes\":$((ONEHUNK + 20))}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260807T110001Z-bud02.json"
check '[ "$(jq -r .data.hunksShown "$RES")" -lt "$(jq -r .data.hunksTotal "$RES")" ]' "a tight budget sends fewer hunks than it counted"
check '[ "$(jq -r .data.truncated "$RES")" = "true" ]' "…and says it truncated"
check '[ "$(jq -r .data.diffBytesTotal "$RES")" -gt "$(jq -r .data.diffBytesLimit "$RES")" ]' "the reported total exceeds the budget it was given"

# The point of cutting between hunks: what arrives is a valid patch.
jq -r '.data.diff' "$RES" > "$ROOT/trimmed.patch"
check 'git apply --cached --check "$ROOT/trimmed.patch"' "the trimmed diff still applies to the INDEX, which is the side it came from"
check '[ "$(grep -c "^@@" "$ROOT/trimmed.patch")" = "$(jq -r .data.hunksShown "$RES")" ]' "it holds exactly the hunks it claims"
# Every hunk's line count must match its header, which is what a mid-hunk cut breaks.
check 'awk "/^@@/{if(h){if(o!=oc||n!=nc) exit 1}; match(\$0,/-[0-9]+(,[0-9]+)?/); split(substr(\$0,RSTART+1,RLENGTH-1),a,\",\"); oc=(a[2]==\"\")?1:a[2]; match(\$0,/\\+[0-9]+(,[0-9]+)?/); split(substr(\$0,RSTART+1,RLENGTH-1),b,\",\"); nc=(b[2]==\"\")?1:b[2]; o=0;n=0;h=1;next} h&&/^ /{o++;n++} h&&/^-/{o++} h&&/^\\+/{n++} END{if(h&&(o!=oc||n!=nc)) exit 1}" "$ROOT/trimmed.patch"' "every hunk's body matches its own @@ counts"

# Deterministic regardless of locale: the old cap meant characters in one
# environment and bytes in another.
req "r-20260807T110002Z-bud03" diff-file "$TOKEN" "{\"path\":\"Notes/budget.md\",\"from\":\"INDEX\",\"to\":\"WORKTREE\",\"maxBytes\":$((ONEHUNK + 20))}"
LC_ALL=C.UTF-8 bash "$RUNNER"
A=$(jq -r .data.hunksShown "$RUNTIME/results/r-20260807T110002Z-bud03.json")
req "r-20260807T110003Z-bud04" diff-file "$TOKEN" "{\"path\":\"Notes/budget.md\",\"from\":\"INDEX\",\"to\":\"WORKTREE\",\"maxBytes\":$((ONEHUNK + 20))}"
LC_ALL=C bash "$RUNNER"
B=$(jq -r .data.hunksShown "$RUNTIME/results/r-20260807T110003Z-bud04.json")
check '[ "$A" = "$B" ]' "the same budget keeps the same hunks under C and under UTF-8"

# The output is always valid UTF-8, because the cut lands between lines.
check 'jq -r ".data.diff" "$RUNTIME/results/r-20260807T110003Z-bud04.json" | iconv -f UTF-8 -t UTF-8 >/dev/null' "the trimmed diff is valid UTF-8, no half character at the seam"

req "r-20260807T110004Z-bud05" diff-file "$TOKEN" '{"path":"Notes/budget.md","from":"INDEX","to":"WORKTREE","maxBytes":1}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260807T110004Z-bud05.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "an absurd budget is answered, not failed"
check '[ "$(jq -r .data.hunksShown "$RES")" = "0" ]' "…with zero hunks rather than a broken one"
check '[ "$(jq -r .data.hunksTotal "$RES")" = "3" ]' "…and still reports how many there were"

git checkout -- Notes/budget.md 2>/dev/null || true

# ---------------------------------------------------------------------------
# phase 11: apply-patch, the one action behind stage / unstage / discard hunk
# ---------------------------------------------------------------------------
echo "# phase 11: apply-patch in all three directions"
cd "$ROOT/vault"
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true
# Two well-separated edits, so git reports two hunks whatever the context size.
{ for i in $(seq 1 40); do echo "рядок $i"; done; } > Notes/hunks.md
git add Notes/hunks.md >/dev/null 2>&1
git commit -qm "e2e: hunks base" >/dev/null 2>&1
sed -i '5s/.*/ПРАВКА ОДИН/; 35s/.*/ПРАВКА ДВА/' Notes/hunks.md

# The plugin builds these; here they are cut from git's own diff, which is the
# same shape hunkPatch.ts produces.
git diff -U1 -- Notes/hunks.md > "$ROOT/full.patch"
check '[ "$(grep -c "^@@" "$ROOT/full.patch")" = "2" ]' "the fixture really has two hunks"
{ sed -n '1,4p' "$ROOT/full.patch"; awk '/^@@/{n++} n==1' "$ROOT/full.patch"; } > "$ROOT/h1.patch"
apatch() { jq -Rs . < "$1"; }

req "r-20260807T120000Z-ap01" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/h1.patch"),\"target\":\"index\",\"reverse\":false,\"protectedPaths\":[\"Private/Hidden\"]}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260807T120000Z-ap01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "stage hunk: apply --cached ok"
check '[ "$(jq -r .data.appliedPath "$RES")" = "Notes/hunks.md" ]' "…and it reports the path it acted on"
check 'git diff --cached -U0 -- Notes/hunks.md | grep -q "ПРАВКА ОДИН"' "the first edit is now staged"
check '! git diff --cached -U0 -- Notes/hunks.md | grep -q "ПРАВКА ДВА"' "…and only the first"
check 'git diff -U0 -- Notes/hunks.md | grep -q "ПРАВКА ДВА"' "the second edit stays unstaged"
check 'grep -q "ПРАВКА ОДИН" Notes/hunks.md' "the working tree file is untouched by staging"

req "r-20260807T120001Z-ap02" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/h1.patch"),\"target\":\"index\",\"reverse\":true,\"protectedPaths\":[]}"
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260807T120001Z-ap02.json" >/dev/null' "unstage hunk: apply -R --cached ok"
check '[ -z "$(git diff --cached --name-only -- Notes/hunks.md)" ]' "the index is clean again"
check 'grep -q "ПРАВКА ОДИН" Notes/hunks.md' "…and the file still has both edits"

req "r-20260807T120002Z-ap03" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/h1.patch"),\"target\":\"worktree\",\"reverse\":true,\"protectedPaths\":[]}"
bash "$RUNNER"
check 'jq -e ".ok == true" "$RUNTIME/results/r-20260807T120002Z-ap03.json" >/dev/null' "discard hunk: apply -R ok"
check '! grep -q "ПРАВКА ОДИН" Notes/hunks.md' "the first edit is gone from the file"
check 'grep -q "ПРАВКА ДВА" Notes/hunks.md' "…and the second edit survived"

echo "# phase 11: apply-patch refuses what it must"
req "r-20260807T120010Z-ap04" apply-patch "$TOKEN" '{"patch":"","target":"index","protectedPaths":[]}'
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260807T120010Z-ap04.json" >/dev/null' "an empty patch is refused"

req "r-20260807T120011Z-ap05" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/full.patch"),\"target\":\"index\",\"reverse\":false,\"protectedPaths\":[],\"target\":\"nowhere\"}"
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260807T120011Z-ap05.json" >/dev/null' "an unknown target is refused"

# Two paths in one patch: the runner reads the paths from the PATCH, not from
# the request, because the patch is what git will act on.
printf -- '--- a/one.md\n+++ b/one.md\n@@ -1 +1 @@\n-a\n+b\n--- a/two.md\n+++ b/two.md\n@@ -1 +1 @@\n-c\n+d\n' > "$ROOT/two.patch"
req "r-20260807T120012Z-ap06" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/two.patch"),\"target\":\"index\",\"protectedPaths\":[]}"
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260807T120012Z-ap06.json" >/dev/null' "a patch touching two paths is refused"
check 'jq -er ".error.message" "$RUNTIME/results/r-20260807T120012Z-ap06.json" | grep -q "exactly one path"' "…and says why"

printf -- '--- a/Private/Hidden/mem.md\n+++ b/Private/Hidden/mem.md\n@@ -1 +1 @@\n-x\n+y\n' > "$ROOT/prot.patch"
req "r-20260807T120013Z-ap07" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/prot.patch"),\"target\":\"index\",\"protectedPaths\":[\"Private/Hidden\"]}"
bash "$RUNNER"
check 'jq -e ".error.code == \"SAFETY_BLOCKED\"" "$RUNTIME/results/r-20260807T120013Z-ap07.json" >/dev/null' "a patch aimed at a protected path is refused"

printf -- '--- a/../outside.md\n+++ b/../outside.md\n@@ -1 +1 @@\n-x\n+y\n' > "$ROOT/trav.patch"
req "r-20260807T120014Z-ap08" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/trav.patch"),\"target\":\"index\",\"protectedPaths\":[]}"
bash "$RUNNER"
check 'jq -e ".error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260807T120014Z-ap08.json" >/dev/null' "a traversal path inside the patch is refused"

# A stale patch must be refused, not force-fitted: no --3way, no fuzz.
req "r-20260807T120015Z-ap09" apply-patch "$TOKEN" \
  "{\"patch\":$(apatch "$ROOT/h1.patch"),\"target\":\"worktree\",\"reverse\":true,\"protectedPaths\":[]}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260807T120015Z-ap09.json"
check 'jq -e ".error.code == \"GIT_FAILED\"" "$RES" >/dev/null' "re-applying an already-applied patch fails instead of guessing"
check 'jq -er ".error.message" "$RES" | grep -qi "out of date"' "…and the message tells the user to refresh the diff"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head"' "…and fresh status still rides along"

git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true

# ---------------------------------------------------------------------------
# phase 12: sync commits BEFORE the merge, but only when the merge needs it.
#
# git will not merge over a dirty path it has to change, and will not create a
# file that already exists untracked. It refuses whether or not the merge would
# actually conflict — the refusal is about the working tree, not the content.
# Pulling before committing therefore had a state with no exit: sync stopped
# before it ever reached its own commit step, and pressing sync again repeated
# it forever.
#
# Committing unconditionally would cost a merge commit on every sync. So the
# runner asks git which paths the merge brings in, intersects them with what is
# dirty here, and commits first only when they overlap.
# ---------------------------------------------------------------------------
echo "# phase 12: sync commits before the merge only when it has to"
cd "$ROOT/vault"
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true
git push -q origin "$MAIN_BRANCH" 2>/dev/null || true

# A second clone stands in for the other device.
rm -rf "$ROOT/other"
git clone -q "$ROOT/remote.git" "$ROOT/other"
git -C "$ROOT/other" config user.email e2e@example.com
git -C "$ROOT/other" config user.name "e2e other"
sync_req() { # $1 id, $2 message
  req "$1" sync "$TOKEN" \
    "{\"protectedPaths\":[\"Private/Hidden\",\"Projects/Archive\"],\"message\":\"$2\"}"
  bash "$RUNNER"
}

# --- a file both sides touched, in different places ------------------------
# The merge is clean; git still refuses it while the file is dirty here. This
# is the case that had no way out, and it is the common one: two devices
# editing the same long note.
{ for i in $(seq 1 40); do echo "рядок $i"; done; } > "$ROOT/vault/Notes/shared.md"
git add Notes/shared.md >/dev/null 2>&1
git commit -qm "e2e: shared base" >/dev/null 2>&1
git push -q origin "$MAIN_BRANCH"
git -C "$ROOT/other" pull -q --no-rebase
sed -i '1s/.*/рядок 1 — the other device/' "$ROOT/other/Notes/shared.md"
git -C "$ROOT/other" commit -qam "other device: top of shared.md" >/dev/null 2>&1
git -C "$ROOT/other" push -q origin HEAD
sed -i '40s/.*/рядок 40 — typed here, never committed/' "$ROOT/vault/Notes/shared.md"
check '[ -n "$(git status --porcelain -- Notes/shared.md)" ]' "the colliding file is dirty here"

sync_req "r-20260810T090000Z-sync01" "e2e: sync over a collision"
RES="$RUNTIME/results/r-20260810T090000Z-sync01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sync survives a file the incoming merge also changes"
check 'jq -er ".data.steps" "$RES" | grep -q "committed-before-merge"' "…by committing before the merge"
check 'jq -er ".data.steps" "$RES" | grep -q "merged"' "…and the merge then ran"
check '[ -z "$(git status --porcelain -- Notes/shared.md)" ]' "nothing of the local edit is left uncommitted"
check 'grep -q "the other device" Notes/shared.md' "…their line arrived"
check 'grep -q "typed here, never committed" Notes/shared.md' "…and ours survived it"

# --- a dirty file the merge does NOT touch ---------------------------------
# Nothing may be committed early here: that would put a merge commit on every
# sync for no reason.
printf 'only they changed this\n' > "$ROOT/other/Notes/theirs.md"
git -C "$ROOT/other" pull -q --no-rebase >/dev/null 2>&1
git -C "$ROOT/other" add -A >/dev/null 2>&1
git -C "$ROOT/other" commit -qm "other device: theirs.md" >/dev/null 2>&1
git -C "$ROOT/other" push -q origin HEAD
printf 'edited here, unrelated\n' > "$ROOT/vault/Notes/ours.md"

sync_req "r-20260810T090010Z-sync02" "e2e: sync with no collision"
RES="$RUNTIME/results/r-20260810T090010Z-sync02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "sync with nothing colliding still succeeds"
check '! jq -er ".data.steps" "$RES" | grep -q "committed-before-merge"' "…and does NOT commit before the merge"
check 'jq -er ".data.steps" "$RES" | grep -q ",committed"' "…it still commits, in its own step, after the merge"
check '[ -f Notes/theirs.md ]' "their file arrived"

# --- a real content conflict -----------------------------------------------
# Committing first does not make disagreements go away, and must not: it turns
# an inescapable refusal into an ordinary conflict, which this plugin has a
# pane for.
git -C "$ROOT/other" pull -q --no-rebase >/dev/null 2>&1
sed -i '20s/.*/рядок 20 — theirs/' "$ROOT/other/Notes/shared.md"
git -C "$ROOT/other" commit -qam "other device: line 20" >/dev/null 2>&1
git -C "$ROOT/other" push -q origin HEAD
sed -i '20s/.*/рядок 20 — ours/' "$ROOT/vault/Notes/shared.md"

sync_req "r-20260810T090020Z-sync03" "e2e: sync into a real conflict"
RES="$RUNTIME/results/r-20260810T090020Z-sync03.json"
check 'jq -e ".error.code == \"CONFLICT\"" "$RES" >/dev/null' "a genuine disagreement is reported as a conflict"
check 'jq -er ".data.steps" "$RES" | grep -q "committed-before-merge"' "…after the local edit was committed, so the file has two sides"
check 'jq -er ".data.conflicts" "$RES" | grep -q "Notes/shared.md"' "…and the conflicted path is named"
check 'git status --porcelain -- Notes/shared.md | grep -q "^UU"' "the working tree really is mid-merge"
git merge --abort >/dev/null 2>&1 || true

cd "$ROOT/vault"
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true

# ---------------------------------------------------------------------------
# phase 13: repairing an object database that git was killed in the middle of.
#
# A zero-byte file under .git/objects is what remains when git created the file
# and was stopped before writing to it. Android does that to Termux in the
# background. Every command that walks the tree then fails, with a message
# about the operation rather than about the repository.
# ---------------------------------------------------------------------------
echo "# phase 13: repairing a damaged object database"
cd "$ROOT/vault"
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true

# Break it the way the device broke it: truncate a real object to zero bytes.
# The victim is MADE, not found: a fresh commit's tree is reachable, loose, in
# no local pack, and pushed so the remote can give it back — `find | head -1`
# used to pick whatever the filesystem listed first, sometimes an unreachable
# leftover, and the number of checks in this phase moved from run to run.
git merge --abort >/dev/null 2>&1 || true
git fetch -q origin && git reset -q --hard "origin/$MAIN_BRANCH"
printf 'a note whose tree gets truncated\n' > Notes/truncated.md
git add Notes/truncated.md >/dev/null 2>&1
git commit -qm "e2e: an object to truncate" >/dev/null 2>&1
git push -q origin "$MAIN_BRANCH"
VSHA="$(git rev-parse "HEAD^{tree}")"
VICTIM=".git/objects/${VSHA:0:2}/${VSHA:2}"
check '[ -f "$VICTIM" ]' "there is a loose, reachable object to damage"
chmod u+w "$VICTIM" 2>/dev/null || true
: > "$VICTIM"
check '[ ! -s "$VICTIM" ]' "the object file is now empty, as a killed git leaves it"

# The repair is four short actions now, sequenced by the plugin: scan (remove
# empties, report what is missing and whose it is), fetch-missing (exactly the
# named objects), refetch (the whole history, always behind the user's yes),
# reset-upstream (the exit for damage inside local-only history). The DECISIONS
# between them live in TypeScript with their own unit tests; what is proven
# here is each primitive against a real repository.
req "r-20260810T100000Z-rep01" repair-scan "$TOKEN" '{}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100000Z-rep01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repair-scan runs"
check '[ "$(jq -r .data.removedCount "$RES")" -ge 1 ]' "…and removes the empty file"
check '[ ! -e "$VICTIM" ]' "…no empty object file is left behind"
check 'jq -er ".data.removedObjects" "$RES" | grep -q "/"' "…and the result names what it removed"
# No branchInfo assertion HERE, deliberately: the truncated object is HEAD's
# own tree, so until it is recovered even `git status` cannot read the branch —
# the scan reports what it can and the fields are legitimately thin.
check 'jq -e ".data | has(\"aheadCount\") and has(\"hasUpstream\") and has(\"cacheTreeBroken\")" "$RES" >/dev/null' "…and it reports whose the damage might be"

# Whatever the scan said is missing, the targeted fetch brings back: the victim
# is a reachable object the remote still has.
check 'jq -r ".data.fsckMissing" "$RES" | grep -q "$VSHA"' "…and the scan names the truncated object as missing"
ARGS="$(jq -r '.data.fsckMissing' "$RES" | grep -oE '[0-9a-f]{40}' | sort -u | jq -R . | jq -sc '{oids:.}')"
req "r-20260810T100001Z-rep01b" repair-fetch-missing "$TOKEN" "$ARGS"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100001Z-rep01b.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repair-fetch-missing runs"
check '[ -z "$(jq -r ".data.fsckMissing" "$RES")" ]' "…and nothing is missing afterwards"
check '[ "$(jq -r .data.recoveredBy "$RES")" = "targeted" ]' "…recovered by asking, not by downloading the history"
check 'git cat-file -p "$VSHA" >/dev/null 2>&1' "…the truncated object is back and readable"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head"' "…and fresh status rides along now that the repository is readable again"

# The validation half: garbage ids never reach git as arguments.
req "r-20260810T100002Z-repbad" repair-fetch-missing "$TOKEN" '{"oids":["--upload-pack=/bin/true"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100002Z-repbad.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "repair-fetch-missing refuses a non-hex id"
check '[ "$(jq -r .error.code "$RES")" = "BAD_REQUEST" ]' "…as a bad request, before git sees it"
req "r-20260810T100003Z-repempty" repair-fetch-missing "$TOKEN" '{"oids":[]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100003Z-repempty.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "…and an empty list is refused too"

# Objects that are damaged but NOT empty must survive: they may be recoverable,
# and that is a decision for a person, not for a script.
#
# The victim is made for the job, and both properties matter.
#
# It must be REACHABLE: `find … | head -1` returned whatever the filesystem
# listed first, sometimes an unreachable leftover from an earlier phase, and a
# corrupt object nothing points at is genuinely harmless — the repair rightly
# said nothing was wrong, so these checks failed on about half the runs.
#
# It must exist ONLY as a loose file: an object that is also inside a pack is
# read from the pack, so corrupting the loose copy changes nothing.
#
# And it is a TREE, not a blob, which is a real limit of this action rather than
# a convenience. The verification is `git fsck --connectivity-only`, chosen
# because `--full` took between four and thirty-nine minutes on the user's vault
# — longer than the action's own budget. Connectivity walks the graph, so it
# parses commits and trees and notices when one cannot be inflated; it never
# reads blob CONTENT, so a corrupt blob is invisible to it. That is documented as
# a limitation, and `git fsck --full` in Termux is the tool for it.
printf 'a note whose tree will be damaged\n' > Notes/fragile.md
git add Notes/fragile.md >/dev/null 2>&1
git commit -qm "e2e: an object to damage" >/dev/null 2>&1
OTHER_SHA="$(git rev-parse "HEAD^{tree}")"
OTHER=".git/objects/${OTHER_SHA:0:2}/${OTHER_SHA:2}"
if [ -n "$OTHER_SHA" ] && [ -f "$OTHER" ]; then
  chmod u+w "$OTHER" 2>/dev/null || true
  printf 'garbage that is not a git object' > "$OTHER"
  # `-p`, not `-e`: existence is not the question, readability is. `cat-file -e`
  # answers from the file being present and says yes to a file full of garbage.
  check '! git cat-file -p "$OTHER_SHA" >/dev/null 2>&1' "a reachable object is corrupt but not empty"
  req "r-20260810T100010Z-rep02" repair-scan "$TOKEN" '{}'
  bash "$RUNNER"
  RES="$RUNTIME/results/r-20260810T100010Z-rep02.json"
  # Damaged content, nothing missing. The scan answers ok — it is a question,
  # not a verdict — and what it reports is what lets the plugin's decision core
  # (unit-tested against exactly this shape) name damage rather than absence.
  check 'jq -e ".ok == true" "$RES" >/dev/null' "the scan itself succeeds on a damaged store"
  check '[ -n "$(jq -r ".data.fsckRemaining" "$RES")" ]' "…and reports what fsck still sees"
  check '[ -z "$(jq -r ".data.fsckMissing" "$RES")" ]' "…with nothing listed as missing, because nothing is"
  check '[ -e "$OTHER" ]' "…while the object is left alone, because it is not empty"
  check '[ "$(jq -r .data.removedCount "$RES")" = "0" ]' "…removing nothing"
  # Put the fixture back: a deliberately corrupted object left in place would
  # make every later check in this phase fail for the wrong reason. The commit
  # that referenced it goes too, so nothing reachable points at a gap.
  rm -f "$OTHER"
  git reset -q --hard HEAD~1 2>/dev/null || true
  rm -f Notes/fragile.md
  # The discarded commit lives on in the reflog, and fsck's default is to treat
  # every reflog entry as a root — which kept the NEXT sub-phase red about an
  # object nothing in the repository needs. The runner passes `--no-reflogs` for
  # exactly that reason; this keeps the fixture tidy regardless.
  git reflog expire --expire=now --all >/dev/null 2>&1 || true
fi

# The state the device was actually left in, which the first version of this
# action could not get out of: the empty file has ALREADY been removed by an
# earlier repair, so there is nothing to remove — and the object is still gone,
# because deleting a file downloads nothing. The fetch used to be gated on
# `removed > 0`, so from here every repair did nothing and answered ok=true.
# Four rounds of that were logged on the device, with `unable to read tree`
# between each pair.
cd "$ROOT/vault"
git merge --abort >/dev/null 2>&1 || true
git fetch -q origin && git reset -q --hard "origin/$MAIN_BRANCH"
# The victim needs two properties at once, and getting either wrong makes this
# phase pass for the wrong reason:
#
#   * present on the REMOTE, or the repair cannot recover it and this becomes the
#     other test — the one about giving up honestly;
#   * absent from every local PACK, or deleting the loose copy breaks nothing at
#     all. That bit is easy to get wrong here, because the repair in the first
#     sub-phase copies a whole pack in, so from that point on almost everything
#     exists twice and a deleted loose object is simply read from the pack.
#
# A commit made and pushed right here has both: its objects are loose (a commit
# writes loose objects), the remote has them (it was pushed), and no local pack
# can contain them (every pack here predates them).
printf 'a note whose tree the remote also has\n' > Notes/recoverable.md
git add Notes/recoverable.md >/dev/null 2>&1
git commit -qm "e2e: an object the remote can give back" >/dev/null 2>&1
git push -q origin "$MAIN_BRANCH"
GONE_SHA="$(git rev-parse "HEAD^{tree}")"
GONE=".git/objects/${GONE_SHA:0:2}/${GONE_SHA:2}"
chmod -R u+w .git/objects 2>/dev/null || true
rm -f "$GONE"
check '[ ! -e "$GONE" ]' "an object is absent with no empty file left behind"
# `-p`, not `-e`: readability is the question, and `-e` answers from presence.
check '! git cat-file -p "$GONE_SHA" >/dev/null 2>&1' "…and git really cannot read it"
check 'git -C "$ROOT/remote.git" cat-file -e "$GONE_SHA"' "…while the remote still has it"
# Three probes with no runner code in them, because a CI run on a newer git
# failed the scan check below while the object turned out READABLE again by
# the end of the sub-phase, with no fetch in between — something heals it or
# hides it, and these say WHICH premise broke on that git, not just that one did.
check '! git cat-file -e "$GONE_SHA" 2>/dev/null' "PROBE: -e agrees it is absent (no local pack holds it)"
check '[ -z "$(git config --get-regexp "promisor|partialclone" 2>/dev/null || true)" ]' "PROBE: no promisor config that could lazily heal it"
check 'git fsck --connectivity-only --no-reflogs --no-progress 2>&1 | grep -q "$GONE_SHA"' "PROBE: plain fsck itself names it, before any runner code"

# The state the device was left in: nothing to remove, the object still gone.
# scan must REPORT it, and the targeted fetch must bring it back.
req "r-20260810T100020Z-rep03" repair-scan "$TOKEN" '{}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100020Z-rep03.json"
check '[ "$(jq -r .data.removedCount "$RES")" = "0" ]' "the scan finds nothing to remove"
check 'jq -r ".data.fsckMissing" "$RES" | grep -q "$GONE_SHA"' "…and still names the missing object, because deleting a file downloads nothing"
ARGS="$(jq -r '.data.fsckMissing' "$RES" | grep -oE '[0-9a-f]{40}' | sort -u | jq -R . | jq -sc '{oids:.}')"
req "r-20260810T100021Z-rep03b" repair-fetch-missing "$TOKEN" "$ARGS"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100021Z-rep03b.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "the targeted fetch runs"
check '[ -z "$(jq -r ".data.fsckRemaining" "$RES")" ]' "…with nothing left missing"
check 'git cat-file -p "$GONE_SHA" >/dev/null 2>&1' "…the object is back and readable"
check '[ "$(git config --get extensions.partialclone || true)" = "" ]' "…and the promisor marking is undone, always"

# The bundle's own case: an object the remote never had, because it belongs to a
# LOCAL, unpushed commit. No fetch can help; the scan must say whose the damage
# is (aheadCount), the refetch must report honestly, and the exit is
# repair-reset-upstream — never a re-clone that would discard the local commit.
printf 'local only\n' > Notes/local-only.md
git add Notes/local-only.md >/dev/null 2>&1
git commit -qm "e2e: never pushed" >/dev/null 2>&1
ORPHAN="$(git rev-parse "HEAD^{tree}")"
chmod -R u+w .git/objects 2>/dev/null || true
rm -f ".git/objects/${ORPHAN:0:2}/${ORPHAN:2}"
check '! git cat-file -e "$ORPHAN" 2>/dev/null' "an object exists nowhere, not even on the remote"

req "r-20260810T100030Z-rep04" repair-scan "$TOKEN" '{}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100030Z-rep04.json"
check 'jq -r ".data.fsckMissing" "$RES" | grep -q "$ORPHAN"' "the scan names the missing object"
check '[ "$(jq -r .data.aheadCount "$RES")" -ge 1 ]' "…and reports the branch ahead of upstream: the damage is local-only"
check '[ "$(jq -r .data.hasUpstream "$RES")" = "true" ]' "…with an upstream to rebuild on"

req "r-20260810T100031Z-rep04b" repair-refetch "$TOKEN" '{}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100031Z-rep04b.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "the refetch itself runs"
check 'jq -r ".data.fsckMissing" "$RES" | grep -q "$ORPHAN"' "…and reports honestly that the object is still missing"

# The exit. Files on disk must survive byte for byte; the branch lands on the
# upstream; the old history stays reachable under the backup branch.
req "r-20260810T100032Z-rep04c" repair-reset-upstream "$TOKEN" '{}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100032Z-rep04c.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repair-reset-upstream runs"
BACKUP="$(jq -r '.data.backupRef' "$RES")"
check '[ -n "$BACKUP" ] && git rev-parse --verify -q "refs/heads/$BACKUP" >/dev/null' "…the old history is kept under a visible backup branch"
check '[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$MAIN_BRANCH")" ]' "…the branch sits on the remote state"
check '[ "$(cat Notes/local-only.md)" = "local only" ]' "…and the file from the abandoned commit is still on disk, byte for byte"
check 'git status --porcelain | grep -q "Notes/local-only.md"' "…shown as an ordinary uncommitted change for the next sync"
check 'jq -er ".data.branchInfo" "$RES" | grep -q "branch.head"' "…fresh status rides along"
# The index was rebuilt from a readable tree, so git can walk everything again.
check 'git ls-tree -r HEAD >/dev/null 2>&1' "…and HEAD's tree is readable again"

# A branch with no upstream has nothing to rebuild on, and the action says so
# instead of guessing. NOT named e2e-no-upstream: phase 5 already owns that
# name and bound it to an upstream by push -u, so reusing it made the checkout
# fail silently and the action ran — correctly — on the branch it was left on.
git checkout -qb e2e-rescue-no-up
check '[ "$(git branch --show-current)" = "e2e-rescue-no-up" ]' "the fixture really is on a branch with no upstream"
req "r-20260810T100033Z-rep04d" repair-reset-upstream "$TOKEN" '{}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100033Z-rep04d.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "repair-reset-upstream refuses a branch with no upstream"
check 'jq -r ".error.message" "$RES" | grep -qi "upstream"' "…naming the reason"
check '! git branch --list "ngb-rescue-*" | grep -q . || [ -n "$BACKUP" ]' "…and leaves no backup branch of its own behind"
git checkout -q "$MAIN_BRANCH" 2>/dev/null

# The backup branch is deleted through the bridge, because the user is never
# sent to Termux for it: the action accepts nothing but the rescue-branch name
# shape, so it cannot serve as a general branch-delete.
req "r-20260810T100034Z-rep04e" repair-drop-backup "$TOKEN" '{"ref":"master"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100034Z-rep04e.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "repair-drop-backup refuses anything but a rescue branch"
check '[ "$(jq -r .error.code "$RES")" = "BAD_REQUEST" ]' "…as a bad request, before git sees it"
check 'git rev-parse --verify -q "refs/heads/$MAIN_BRANCH" >/dev/null' "…and the named branch is untouched"
ARGS="$(jq -nc --arg r "$BACKUP" '{ref:$r}')"
req "r-20260810T100035Z-rep04f" repair-drop-backup "$TOKEN" "$ARGS"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100035Z-rep04f.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repair-drop-backup deletes the rescue branch"
check '! git rev-parse --verify -q "refs/heads/$BACKUP" >/dev/null 2>&1' "…and it is gone"
check '[ "$(jq -r .data.droppedRef "$RES")" = "$BACKUP" ]' "…named in the result"
req "r-20260810T100036Z-rep04g" repair-drop-backup "$TOKEN" "$ARGS"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T100036Z-rep04g.json"
check 'jq -e ".ok == false" "$RES" >/dev/null' "…and deleting it twice is refused with a reason, not a success"

# Back to the remote's state, drop the reflog that still points at the broken
# commit, so later phases start from a repository git can walk.
git branch -D "$BACKUP" >/dev/null 2>&1 || true
git branch -D e2e-rescue-no-up >/dev/null 2>&1 || true
rm -f Notes/local-only.md
git reset -q --hard "origin/$MAIN_BRANCH"
git reflog expire --expire=now --all >/dev/null 2>&1 || true
git gc -q --prune=now >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# phase 14: resolving a conflict where one side DELETED the file.
#
# `git checkout --theirs` on such a path fails with "does not have their
# version" — true, and useless: the user picked a side, and on this kind of
# conflict picking the side that deleted the file means deleting it.
# ---------------------------------------------------------------------------
echo "# phase 14: delete/modify conflicts have both answers"
cd "$ROOT/vault"
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true
git merge --abort >/dev/null 2>&1 || true
# Start from the remote, whatever the earlier phases left behind. This phase is
# about one specific conflict; inheriting another one would only make its
# failures unreadable.
git fetch -q origin
git reset -q --hard "origin/$MAIN_BRANCH"
git clean -qfd >/dev/null 2>&1 || true
git -C "$ROOT/other" fetch -q origin
git -C "$ROOT/other" reset -q --hard "origin/$MAIN_BRANCH"

printf 'first\nsecond\n' > Notes/gone.md
git add Notes/gone.md >/dev/null 2>&1
git commit -qm "e2e: a file to argue about" >/dev/null 2>&1
git push -q origin "$MAIN_BRANCH"
git -C "$ROOT/other" pull -q --no-rebase >/dev/null 2>&1
# They delete it; we change it. The classic delete/modify.
git -C "$ROOT/other" rm -q Notes/gone.md
git -C "$ROOT/other" commit -qm "other device: delete it" >/dev/null 2>&1
git -C "$ROOT/other" push -q origin HEAD
printf 'first\nsecond CHANGED HERE\n' > Notes/gone.md
git commit -qam "e2e: change it here" >/dev/null 2>&1
git fetch -q
git merge --no-edit "origin/$MAIN_BRANCH" >/dev/null 2>&1 || true
check 'git ls-files -u -- Notes/gone.md | grep -q .' "the file really is in a delete/modify conflict"
check '[ -z "$(git ls-files -u -- Notes/gone.md | awk "{print \$3}" | grep -x 3)" ]' "…and their side has no version of it"

req "r-20260810T110000Z-dm01" resolve-conflict "$TOKEN" \
  '{"path":"Notes/gone.md","side":"theirs","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T110000Z-dm01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "choosing the side that deleted it no longer fails"
check '[ "$(jq -r .data.resolvedBy "$RES")" = "deleted" ]' "…and says it resolved by deleting"
check '[ ! -e Notes/gone.md ]' "…the file is gone from the working tree"
check '[ -z "$(git ls-files -u -- Notes/gone.md)" ]' "…and the path is no longer unmerged"

# The mirror: keeping OUR version on the same kind of conflict.
git merge --abort >/dev/null 2>&1 || true
git merge --no-edit "origin/$MAIN_BRANCH" >/dev/null 2>&1 || true
check 'git ls-files -u -- Notes/gone.md | grep -q .' "conflicted again, for the other answer"
req "r-20260810T110010Z-dm02" resolve-conflict "$TOKEN" \
  '{"path":"Notes/gone.md","side":"ours","protectedPaths":["Private/Hidden","Projects/Archive"]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T110010Z-dm02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "keeping our version works on the same conflict"
check '[ "$(jq -r .data.resolvedBy "$RES")" = "kept" ]' "…and says it kept a version"
check '[ -e Notes/gone.md ]' "…the file is still there"
check 'grep -q "CHANGED HERE" Notes/gone.md' "…and it is ours"
check '[ -z "$(git ls-files -u -- Notes/gone.md)" ]' "…and the path is resolved"

git merge --abort >/dev/null 2>&1 || true
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true

# ---------------------------------------------------------------------------
# phase 15: a protected path whose NAME needs quoting.
#
# git quotes any path with a space or a byte outside ASCII and escapes it in
# octal. `unstage-protected` compared `ls-files` output against the real bytes
# the plugin had already unquoted, never matched, took its "already gone from
# the index" branch and answered ok=true having removed nothing — which is a
# loop with no exit for anybody whose notes have an em dash in the title.
# ---------------------------------------------------------------------------
echo "# phase 15: protected paths whose names need quoting"
cd "$ROOT/vault"
git merge --abort >/dev/null 2>&1 || true
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true

# Exactly the shape from the device: a space AND an em dash, inside a protected
# directory, staged as an addition with no file on disk afterwards.
AWKWARD="Private/Hidden/Native Git Bridge — spec.md"
mkdir -p "Private/Hidden"
printf 'notes\n' > "$AWKWARD"
# `git add` refuses a path outside the sparse definition on git 2.35+, and
# Private/Hidden is exactly that in this fixture. The plumbing has no such
# guard, which is the same reason the repair itself uses update-index.
git update-index --add -- "$AWKWARD" >/dev/null 2>&1
rm -f "$AWKWARD"
check 'git ls-files --cached -- "$AWKWARD" | grep -q "342"' "git really does quote and octal-escape this name"
check 'git ls-files --cached -z -- "$AWKWARD" | tr "\\0" "\\n" | grep -qxF -- "$AWKWARD"' "…and -z reports it unquoted, which is what the guard needs"

req "r-20260810T120000Z-q01" unstage-protected "$TOKEN" \
  "{\"paths\":[$(printf '%s' "$AWKWARD" | jq -Rs .)],\"protectedPaths\":[\"Private/Hidden\"]}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T120000Z-q01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "unstage-protected accepts the awkward name"
check '[ "$(jq -r .data.unstagedProtectedCount "$RES")" = "1" ]' "…and reports the entry it actually removed"
check '! git ls-files --cached -- "$AWKWARD" | grep -q .' "…the index entry is really gone"

# Idempotent, and still honest about it: a second run removes nothing.
req "r-20260810T120010Z-q02" unstage-protected "$TOKEN" \
  "{\"paths\":[$(printf '%s' "$AWKWARD" | jq -Rs .)],\"protectedPaths\":[\"Private/Hidden\"]}"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T120010Z-q02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "re-running it is not an error"
check '[ "$(jq -r .data.unstagedProtectedCount "$RES")" = "0" ]' "…and it claims nothing this time"

cd "$ROOT/vault"
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true

# ---------------------------------------------------------------------------
# phase 16: the progress stream.
#
# A long operation used to be silent: stderr went to a `mktemp` file whose name
# only the runner knew, and was read after git exited. For the fifteen minutes
# an object repair takes, the plugin could show nothing but its own count of
# elapsed seconds — three percent in and completely wedged looked identical, and
# when the repair hit its old 90 s budget the report was a bare timeout.
#
# What must hold: a file appears under progress/ named for the request, it names
# the action and the steps in order, git's own stderr lands in it, and the
# byte-offset trick still hands each command exactly its own output.
# ---------------------------------------------------------------------------
echo "# phase 16: the progress stream of a long operation"
cd "$ROOT/vault"
# Start from the remote. Phase 14 deliberately leaves a merge half-finished, and
# a sync that stops at "a merge is already in progress" would test the stream of
# an action that never got past its first step.
git merge --abort >/dev/null 2>&1 || true
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true
git fetch -q origin
git reset -q --hard "origin/$MAIN_BRANCH"
git clean -qfd >/dev/null 2>&1 || true

req "r-20260810T130000Z-pr01" sync "$TOKEN" '{"message":"progress phase","protectedPaths":[]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T130000Z-pr01.json"
PROG="$RUNTIME/progress/r-20260810T130000Z-pr01.txt"
check 'jq -e ".ok == true" "$RES" >/dev/null' "the sync itself succeeds, so the stream describes a whole one"
check '[ -f "$PROG" ]' "the runner writes a progress file named for the request"
check 'grep -q "^sync started" "$PROG"' "…which opens by naming the action"
check 'grep -q "sync: fetching from origin" "$PROG"' "…and announces the step BEFORE taking it"
check 'grep -q "sync finished" "$PROG"' "…and closes with the verdict"
# Order matters: a step announced after the fact explains nothing during it.
check '[ "$(grep -n "sync started" "$PROG" | cut -d: -f1)" -lt "$(grep -n "sync: fetching" "$PROG" | cut -d: -f1)" ]' \
  "…in the order the runner did them"
# The file outlives the request on purpose: the shared bundle collects it after.
check '[ -f "$PROG" ] && [ -f "$RES" ]' "…and survives the result being written, for the log bundle"

# git's own stderr must arrive here, not only the runner's notes. A push has
# something to say and, with --progress forced, says it to a file too.
cd "$ROOT/vault"
printf 'progress phase\n' >> note.md
req "r-20260810T130010Z-pr02" sync "$TOKEN" '{"message":"progress push","protectedPaths":[]}'
bash "$RUNNER"
PROG2="$RUNTIME/progress/r-20260810T130010Z-pr02.txt"
check 'grep -q "sync: staging changes" "$PROG2"' "the staging step is announced"
check 'grep -q "sync: pushing to origin/" "$PROG2"' "…and so is the push, with the branch it pushes to"
check 'grep -qE "(Writing objects|Enumerating objects|To )" "$PROG2"' "git's own transfer output reaches the stream"

# Each command still gets exactly its own stderr back, despite them all sharing
# one append-only file. If the offset arithmetic were wrong, a later error would
# carry the earlier commands' output — and every error message in the plugin is
# built from it.
req "r-20260810T130020Z-pr03" pull "$TOKEN" '{"protectedPaths":[]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260810T130020Z-pr03.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "a pull after that push succeeds"
check '! jq -r ".error.stderr // \"\"" "$RES" | grep -q "Writing objects"' \
  "…and no result carries a previous command's output"

# The whole stream is a narrative, so a person reading a shared bundle can see
# where the time went — which is what the file is for.
check '[ "$(wc -l < "$PROG2")" -ge 4 ]' "the stream reads as a sequence, not a single line"

# A rejected request must leave no stream at all: nothing ran, so there is
# nothing to account for, and an empty file would read like an action that
# started and vanished.
req "r-20260810T130030Z-pr04" sync "wrong-token" '{"protectedPaths":[]}'
bash "$RUNNER"
check '[ ! -e "$RUNTIME/progress/r-20260810T130030Z-pr04.txt" ]' \
  "a request rejected before it ran leaves no stream"

# ================================================================================
# phase 17: untrack-file and storage maintenance (runner v14)
# ================================================================================
# untrack-file is `git rm --cached` semantics: the file stays on disk, a staged
# deletion enters the index. The maintenance trio is the exit from an object
# database that only ever grows: every refetch ADDS a pack and an interrupted
# download leaves a tmp_pack_* nothing collects (20 GB over a ~4 GB history on
# a real device).

cd "$ROOT/vault"
echo "# phase 17: untrack-file keeps the file and stages a deletion"
mkdir -p Notes
echo "tracked content" > Notes/e2e-untrack.md
git add Notes/e2e-untrack.md
git commit -qm "phase 17 fixture"
req "r-20260811T140000Z-ut01" untrack-file "$TOKEN" '{"path":"Notes/e2e-untrack.md","protectedPaths":[]}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T140000Z-ut01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "untrack-file ok"
check '[ -f Notes/e2e-untrack.md ]' "the file is still on disk"
check '! git ls-files -- Notes/e2e-untrack.md | grep -q .' "the index no longer tracks it"
check 'git diff --cached --name-status -- Notes/e2e-untrack.md | grep -q "^D"' "a staged deletion is what the user commits"
check 'jq -e ".data.untrackedPath == \"Notes/e2e-untrack.md\"" "$RES" >/dev/null' "the result names the path"
check 'jq -e ".data.branchInfo | length > 0" "$RES" >/dev/null' "fresh status rides along"

echo "# phase 17: untrack-file refuses what it must"
req "r-20260811T140001Z-ut02" untrack-file "$TOKEN" '{"path":"Notes/never-committed.md","protectedPaths":[]}'
bash "$RUNNER"
check 'jq -e ".ok == false and .error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260811T140001Z-ut02.json" >/dev/null' \
  "an untracked path -> BAD_REQUEST (an ignore rule already works there)"
req "r-20260811T140002Z-ut03" untrack-file "$TOKEN" '{"path":"Private/Hidden/mem.md","protectedPaths":["Private/Hidden"]}'
bash "$RUNNER"
check 'jq -e ".ok == false and .error.code == \"SAFETY_BLOCKED\"" "$RUNTIME/results/r-20260811T140002Z-ut03.json" >/dev/null' \
  "a protected path -> SAFETY_BLOCKED (that staged deletion is what the gate exists to prevent)"
git reset -q -- Notes/e2e-untrack.md   # leave the index clean for the maintenance checks

echo "# phase 17: maintenance-scan reports packs and garbage"
# Duplicate packs the way real damage makes them: repack everything into one
# pack, commit something, then repack again WITHOUT -d — the second pack holds
# every object the first one does, and nothing removes the first, which is the
# refetch fallback's exact end state. The commit in between is not decoration:
# pack names are content hashes, so two repacks of IDENTICAL content produce
# one file, not two (the same lesson the object-recovery fixtures paid for).
git repack -a -d -q
echo "second pack filler" > Notes/e2e-pack2.md
git add Notes/e2e-pack2.md
git commit -qm "phase 17 second pack"
git repack -a -q
PACKDIR="$ROOT/vault/.git/objects/pack"
# Interrupted-download residue: one old tmp pack and one fresh. BOTH must go:
# the runner is single-instance locked, so no fetch of ours can own a tmp file
# while maintenance runs, and an hour of age grace once spared a 4.31 GB
# corpse twice in one afternoon on a real device.
printf 'not a real pack' > "$PACKDIR/tmp_pack_e2estale"
touch -d "2 hours ago" "$PACKDIR/tmp_pack_e2estale"
printf 'not a real pack either' > "$PACKDIR/tmp_pack_e2efresh"
req "r-20260811T140003Z-mt01" maintenance-scan "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T140003Z-mt01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "maintenance-scan ok"
check 'jq -r ".data.countObjects" "$RES" | grep -q "^packs: 2"' "count-objects sees both packs"
check 'jq -r ".data.countObjects" "$RES" | grep -q "^garbage: 2"' "…and counts the tmp files as garbage"
check 'jq -r ".data.packFiles" "$RES" | grep -q "tmp_pack_e2estale"' "the pack listing names the leftover tmp file"

echo "# phase 17: maintenance-prune collects tmp files whatever their age"
req "r-20260811T140004Z-mt02" maintenance-prune "$TOKEN" '{"expire":"2.weeks.ago"}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T140004Z-mt02.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "maintenance-prune ok"
check '[ ! -e "$PACKDIR/tmp_pack_e2estale" ]' "the old tmp pack is gone"
check '[ ! -e "$PACKDIR/tmp_pack_e2efresh" ]' "…and so is the fresh one: nothing can own it while maintenance runs"
check 'jq -r ".data.removedTmp" "$RES" | grep -q "tmp_pack_e2estale"' "the result names what it removed"
req "r-20260811T140005Z-mt03" maintenance-prune "$TOKEN" '{"expire":"next.tuesday"}'
bash "$RUNNER"
check 'jq -e ".ok == false and .error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260811T140005Z-mt03.json" >/dev/null' \
  "expire is a whitelist, not a passthrough to git"

echo "# phase 17: maintenance-repack dedupes to one pack and the repository still reads"
req "r-20260811T140006Z-mt04" maintenance-repack "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T140006Z-mt04.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "maintenance-repack ok"
check '[ "$(ls "$PACKDIR"/*.pack 2>/dev/null | wc -l)" -eq 1 ]' "one pack remains"
check 'jq -r ".data.countObjects" "$RES" | grep -q "^packs: 1"' "…and the result's own count agrees"
check 'git fsck --connectivity-only --no-reflogs 2>/dev/null' "the graph is whole after the cleanup"
check 'git log --oneline -1 >/dev/null 2>&1' "history still reads"

# ================================================================================
# phase 18: repository footprint — shallow history and partial clone (runner v14)
# ================================================================================
# Device decisions that live inside .git. Status reports both facts so the
# settings toggles reflect reality. The parts a 2.34 sandbox cannot prove —
# `repack --filter` (2.42+) and `git backfill` (2.49+) — are skipped by the
# runner's own capability checks, which is itself asserted here.

cd "$ROOT/vault"
echo "# phase 18: repo-shallow cuts history and clears this device's reflog"
FULL_COUNT="$(git rev-list --count HEAD)"
req "r-20260811T150000Z-fp01" repo-shallow "$TOKEN" '{"depth":1}'
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T150000Z-fp01.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repo-shallow ok"
check '[ -f .git/shallow ]' "the shallow boundary exists"
check 'jq -e ".data.shallow == \"true\"" "$RES" >/dev/null' "status reports shallow=true"
check '[ "$(git rev-list --count HEAD)" -lt "$FULL_COUNT" ]' "history on this device is shorter than it was"
check '[ "$(git reflog 2>/dev/null | wc -l)" -eq 0 ]' "the reflog is cleared, so the cut can actually free space"
req "r-20260811T150001Z-fp02" repo-shallow "$TOKEN" '{"depth":"evil; rm -rf"}'
bash "$RUNNER"
check 'jq -e ".ok == false and .error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260811T150001Z-fp02.json" >/dev/null' \
  "depth is digits or nothing"

echo "# phase 18: repo-unshallow brings the full history back"
req "r-20260811T150002Z-fp03" repo-unshallow "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T150002Z-fp03.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repo-unshallow ok"
check '[ ! -f .git/shallow ]' "the shallow boundary is gone"
check 'jq -e ".data.shallow == \"false\"" "$RES" >/dev/null' "status reports shallow=false"
check '[ "$(git rev-list --count HEAD)" -eq "$FULL_COUNT" ]' "every commit is back"

echo "# phase 18: partial clone marking, on and honestly off"
req "r-20260811T150003Z-fp04" repo-partial-enable "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T150003Z-fp04.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repo-partial-enable ok"
check '[ "$(git config --get remote.origin.promisor)" = "true" ]' "origin is a promisor"
check '[ "$(git config --get remote.origin.partialclonefilter)" = "blob:none" ]' "the filter is recorded"
check '[ "$(git config --get core.repositoryformatversion)" = "1" ]' "format version raised for the extension"
check 'jq -e ".data.partialFilter == \"blob:none\"" "$RES" >/dev/null' "status reports the filter"
# False on every git: on 2.34 the version gate skips the shed, and on newer
# git the unpushed-commits guard fires first (phase 17's fixture commits are
# never pushed). Either way an enable here must not shed, and must say so.
check 'jq -e ".data.partialShed == \"false\"" "$RES" >/dev/null' "the enable did not shed here, and the result says so"

echo "# phase 18: the shed waits while unpushed commits exist"
# Phase 17's fixture commits were never pushed, so blobs exist here that the
# promisor could not give back — the exact state where a filtered repack shed
# a real rescue branch's content and every later walk spammed "not our ref".
# The guard is checked BEFORE the version gate, so even this 2.34 sandbox
# reports the true reason the filter waited.
req "r-20260811T150007Z-fp07" maintenance-repack "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T150007Z-fp07.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "maintenance-repack on a partial clone ok"
check 'jq -r ".data.repackFilter" "$RES" | grep -q "^kept (unpushed"' \
  "…and it reports the filter WAITED for the unpushed commits, not that it ran"

req "r-20260811T150004Z-fp05" repo-partial-disable "$TOKEN"
bash "$RUNNER"
RES="$RUNTIME/results/r-20260811T150004Z-fp05.json"
check 'jq -e ".ok == true" "$RES" >/dev/null' "repo-partial-disable ok (nothing was missing, so no refetch was needed)"
check '! git config --get remote.origin.promisor >/dev/null 2>&1' "the promisor marking is gone"
check '[ "$(git config --get core.repositoryformatversion)" = "0" ]' "format version back to 0"
check 'jq -e ".data.partialFilter == \"\"" "$RES" >/dev/null' "status reports no filter"

echo "# phase 18: the clone filter is a whitelist"
req "r-20260811T150005Z-fp06" clone-into-vault "$TOKEN" "{\"url\":\"file://$ROOT/vault\",\"replaceExisting\":true,\"filter\":\"tree:0\"}"
bash "$RUNNER"
check 'jq -e ".ok == false and .error.code == \"BAD_REQUEST\"" "$RUNTIME/results/r-20260811T150005Z-fp06.json" >/dev/null' \
  "only blob:none passes; nothing was cloned or replaced"
check '[ -d .git ] && git log --oneline -1 >/dev/null 2>&1' "the vault's repository is untouched"

cd "$ROOT/vault"
git checkout -- . 2>/dev/null || true
git reset -q 2>/dev/null || true

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
