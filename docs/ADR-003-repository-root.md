# ADR-003: The repository root is not always the vault root

Status: Accepted · Date: 2026-09-05 · Runner v18, plugin 0.6.8

## Context

Everything before this assumed one directory was both the git work tree and the Obsidian vault. Two arrangements have to work as well:

- **Repository above the vault.** `/project/.git` with the vault at `/project/docs`: a documentation vault inside a code repository.
- **Repository below the vault.** The vault at `/Main` with the repository at `/Main/project`: one folder of a larger vault is the synced repository, and the rest of the vault stays outside git.

The assumption was not localised, and its dangerous half was not about paths in the abstract. The plugin hands **repository-relative** paths, taken from git's output, straight to Obsidian's vault adapter, which is **vault-relative** by definition. While the two roots coincide the two strings are equal and nothing shows. With two roots, every one of those calls silently addresses a different real file and reports success: a restore writes a note next to the one it meant, a trash moves the wrong file, `.gitignore` is edited in the wrong directory.

The runtime directory had the same problem from the other side. The plugin computed it from the vault (`<config>/plugins/native-git-bridge/runtime`), the installer and the runner from the repository. With different roots the two halves queue in different directories, and the symptom is the worst one this project has: the installer's self-test passes while every request from the plugin times out.

And the bootstrap flow made both arrangements fail in the worst available way rather than with an error. `exists(".git")` at the vault root is false, so the plugin wrote a bootstrap claim, the runner paired the vault, and the first `init-repo` or `clone-into-vault` created a **second, nested repository** beside the real one.

## Decision

### 1. The wire stays repository-relative

Requests and results carry repository-relative paths exactly as before. Nothing in `protocol.md`'s path handling changes.

Rejected: vault-relative paths on the wire, with the runner prefixing them before git sees them. A repository file above the vault has no vault-relative name (`/project/src/main.ts` under a vault at `/project/docs` is `../src/main.ts`, and `..` is refused by both validators precisely because that is what they exist for), so the files the user wants to see in the panel would be unnameable. And the return direction is expensive: the runner would have to rewrite paths inside raw git output — porcelain status, sparse lists, `--name-status` with both sides of a rename, `diff --git`, `---`/`+++` headers, conflict listings. The protocol keeps that output raw and parses it in TypeScript so that bash stays small and auditable; a path prefix is not worth reversing that.

### 2. The conversion lives in the plugin, at the adapter boundary

One pure module, `src/git/repoRoot.ts`, no DOM, unit-tested: `toVault(repoPath)` answers the vault-relative path or `null` when the file lies outside the vault; `toRepo(vaultPath)` answers the repository-relative path or `null` when the file lies outside the repository. Both directions answer `null` because the two arrangements are not mirror images: with the vault inside the repository, repository files above the vault have no vault name; with the repository inside the vault, notes beside it have no repository name.

Every place where a git path meets the adapter — writes, trash, open, `exists` — goes through that boundary, and the two places that hand a vault path to the runner (the file-explorer menu and the active file) go through it the other way. Views, menus, hunk patches, sparse patterns and protected paths keep working on repository-relative strings; panel rows keep showing repository paths, because the user is reading a git panel. With one root the conversion is the identity function, which is why the assumption survived this long and why existing installations are unchanged.

A file with no vault name is still listed, diffed, staged and committed — all of that goes through the runner. Only opening or writing it from Obsidian is impossible, and the plugin says so rather than guessing.

### 3. The profile needs no new key

`NGB_REPO_DIR` and `NGB_RUNTIME_DIR` already determine both roots between them: the runtime directory is always inside the vault (rule: the runtime is never synced, so it lives under the vault's configuration directory), the repository directory is the work tree. The runner derives the vault from the runtime path and stops deriving either from the other. The profile format stays at version 1.

### 4. The runner reports the offset

The plugin must not compute the offset from absolute paths of its own: its only absolute path is a hint the user typed. The runner knows both directories with certainty, so `status` — and therefore every mutating action's result — carries `vaultInRepo` or `repoInVault`, at most one non-empty. An absent field means the roots coincide, which is what every runner before v18 means by saying nothing, so `RUNNER_MIN_VERSION` stays where it was. The pairing file says the same thing once, so the plugin knows the layout before its first round trip.

### 5. `.gitignore` moves to the runner

With the repository root out of the vault's reach, the plugin cannot read or write the repository's `.gitignore` through the adapter. Three actions, `gitignore-list`, `gitignore-add`, `gitignore-remove`, mirror the three that already existed for `.git/info/exclude`, and the plugin routes `.gitignore` through them **always**, not only when the file is out of reach: two behaviours for one question is what the one-surface rule refuses elsewhere, and this removes the last direct write the plugin performed on a tracked file. The current list rides along with every status, so the file menu answers synchronously without a round trip to warm a cache.

### 6. Which route creates which arrangement

**Repository below the vault** is available from the plugin and from the installer. The plugin asks for the folder at **pairing**, not at "create" or "clone", because the repository directory is written into the profile the runner creates and the runner never re-points a profile on a request's say-so (ADR-002 §3). The claim carries `repoInVault`, a relative offset, which the runner validates in shape (no leading slash, no `..`, no empty or `.` segment, no quote or control character), resolves, and checks to stay under the vault — a segment can be a symlink. The folder must exist already (the plugin creates it inside its own vault before asking; adoption itself creates nothing), and it can be neither Obsidian's configuration directory nor anything inside it. One vault keeps one profile whatever the folder: a vault that already has a profile is never paired a second time to another folder.

**Repository above the vault** is available from the installer only: `bash install.sh /path/to/repository --vault /path/to/vault`. Reaching an ancestor from a claim would mean accepting "go up N levels", which lets a claim name directories the user never opened, up to the root of shared storage; that widens T13 in the threat model. In the installer the user types both paths at a terminal, so the trust model does not move. The installer's auto-detection offers vaults whose repository is an ancestor and names the repository for each; a repository below a vault cannot be detected, because nothing says which folder it would be.

What a claim may carry is therefore a relative, downward-only offset that is validated, never a repository path. ADR-002's two statements — the runner never accepts a repository path from a request, and nothing in a claim is trusted — both survive.

### 7. The trash

Obsidian's trash is `.trash` at the **vault** root, and `git add -A` stages it. The runner writes the exclusion at creation and cloning wherever the vault puts it (`.trash/`, `docs/.trash/`, or nothing when the vault sits above the repository), and the plugin writes the same line through `exclude-add` once per session for repositories set up before this. The trash is never moved: with the repository inside the vault a trashed repository file leaves the work tree, which git reports as a deletion, and that is the honest report.

## Consequences

- Three latent runner bugs became live the moment the roots differed, and were fixed with this: the runtime exclusion was written with a hard-coded path even when the runtime directory lay outside the repository (now skipped); the clone's "configuration directory tracked" warning kept only the first path segment, which named the whole vault when the vault was `docs/` (now strips the runtime suffix); and the relocation pass compared the recorded repository rather than the recorded vault, and now preserves the offset across a move, refusing to follow a move at all when the repository was outside its vault.
- With the repository below the vault, the plugin's own folder is outside the repository, so that repository no longer carries plugin updates between devices (`update.md`).
- With the vault inside the repository, repository files above the vault are listed and operable but not openable from Obsidian; the panel says so per row.
- The installer's self-test passing while the plugin times out is now a documented symptom with one cause: the profile's runtime directory is not the vault's (`troubleshooting.md`).
- Residual risk: unchanged from ADR-002. A forged claim can now also name a folder inside a vault the user already opened, and the runner will pair that folder instead of the vault root — still a directory on the device the attacker could already read, still no token of their choosing, still undone by deleting one profile file.
