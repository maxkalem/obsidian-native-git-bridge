# ADR-002: More than one repository per device

Status: Accepted · Date: 2026-08-06 · Runner v10, plugin 0.6.0

## Context

Until v9 the Termux side held exactly one repository: `~/.config/native-git-bridge/config` with one `NGB_REPO_DIR`, one `NGB_TOKEN`, one `NGB_RUNTIME_DIR`. Running `install.sh` for a second vault overwrote it, so the first vault's requests were never drained. The symptom is a silent TIMEOUT and "Runner has written here: NO" in the bridge check, which points at the wrong suspect.

Two situations have to work:

- **Sibling vaults.** `/storage/emulated/0/Main` and `/storage/emulated/0/Work`, unrelated repositories.
- **Nested vault.** `Main/` is a vault and a repository; `Main/Projects/ABCproject/` is opened as its own vault and is its own repository.

The constraint that shapes everything: per ADR-001 the companion app forwards a **fixed** runner path and no caller-supplied data, so the trigger cannot say which vault it is for. Adding a path or a command to the intent would give away the property that makes the transport safe.

## Decision

### 1. Profiles, one file each

`~/.config/native-git-bridge/profiles/<id>.conf`, mode 600, `KEY="value"` lines behind an `NGB_PROFILE_FORMAT=1` marker: repository directory, runtime directory, token. One file per profile rather than one file with repeated keys, because writes stay atomic (`tmp` + `mv`), removal is `rm`, and a damaged file cannot take the other vaults down.

Profile files are **parsed, never sourced**. The previous single config was sourced; with several files, one of them corrupt or tampered with, sourcing turns a data problem into code execution.

### 2. The runner drains every profile

One invocation collects the pending requests of all profiles into one list sorted by request id (ids embed a UTC timestamp, so that is chronological across vaults), then processes them one at a time behind a single-instance lock. The lock moved from the vault's runtime directory to the config directory, because it now guards work in several vaults.

A profile whose repository is missing is skipped, not fatal: its own queue is answered with `REPO_MISSING` so the plugin in that vault stops waiting, and the others are drained normally.

### 3. The profile is looked up, never sent

A request may carry `profileId`, an opaque `p-<hex>` string. The runner resolves it against the profiles it already knows and rejects anything else with `BAD_REQUEST`; it never accepts `repoDir` or any path pointing at a repository. The directory a request file was found in already implies its profile, so `profileId` is a second, cheap check rather than the mechanism.

### 4. One token per profile

Tokens are generated in Termux, one per profile. A token valid for profile A is rejected for profile B. Re-running the installer for an existing vault keeps that vault's token; it never shares one token across vaults, which is what the old "reuse the existing token" branch effectively did.

### 5. Nested vaults: exclude the inner repository from the outer one, in `.git/info/exclude`

Considered and rejected:

- **`.gitignore` in the outer repository.** It is a tracked file: it syncs to every device and every collaborator, most of whom do not have the inner vault at all. Editing it would also require an explicit confirmation naming the file (project rule). Wrong scope for a device-local situation.
- **A submodule.** It rewrites the outer repository's history, needs a remote for the inner repository, and the project has no submodule support anywhere — not in the status parser, not in the safety gate, not in the UI.
- **Sparse-checkout exclusion.** It would remove the folder from the working tree. The user wants to open that folder as a vault, so this is the opposite of the goal, and it would put the inner vault under the protection of the safety gate for no reason.
- **`.git/info/exclude` in the outer repository.** Device-local, never synced, never a tracked file, and exactly how the runtime directory is already handled. Chosen.

The installer writes the line and prints what it wrote where; the runner re-checks it on every run, so a vault paired from the plugin (without the installer) is covered too. The two repositories may still hold overlapping content — only the inner repository's own files stop appearing in the outer one's status.

### 6. Confinement is enforced, not assumed

`cd` alone decides which repository answers only as long as the inner `.git` exists. Each profile is therefore entered with `cd` **plus** `GIT_CEILING_DIRECTORIES` set to the repository's parent, and the runner verifies that `git rev-parse --show-toplevel` is the repository itself before executing anything. An inner vault that lost its `.git` fails with `REPO_MISSING` instead of quietly operating on the outer repository. The e2e suite proves this against real nested repositories.

### 7. Migration, relocation, adoption

- **Migration.** An existing single-repo config becomes a profile on the first run of the new runner, keeping its token, and is renamed `config.legacy` so it cannot happen twice. No current installation has to re-pair.
- **Relocation.** The runner writes `runtime/profile.json` into each vault. When a profile's recorded directory is no longer a work tree, an idle run scans shared storage for that marker and follows the vault, keeping id and token. A profile whose marker is nowhere to be found is treated as deleted and is never re-pointed at another repository.
- **Adoption.** A vault with no profile writes `runtime/claim.json` and wakes the runner. The runner honours a claim only for a directory that is a git work tree of its own, under the scan roots, with a claim younger than 15 minutes — and it generates the token itself. Nothing the claim contains is trusted, and no secret ever travels towards Termux. This is what lets a second vault pair without the installer.

Both scans run only when a profile is broken or the run has no work at all, so a normal operation never pays for a filesystem scan.

**Amendment (runner v11, plugin 0.6.1).** Repository bootstrap needs a profile before there is a repository, so a claim may carry `"bootstrap": true` and the runner then adopts a directory that is not a work tree. The profile it creates is in the `bootstrap` state and answers only the actions that create a repository; everything else gets `REPO_MISSING`. The alternative — requiring the installer for any new vault — was rejected because it puts a terminal between the user and the first thing they want to do, and the installer path remains available and unchanged.

## Consequences

- The plugin gains one device-local setting per vault (`profileId`) and sends it with every request.
- Results carry `profileId`; a vault adopts it when it has none and never replaces one it already has (that would be the plugin re-pointing itself at another repository).
- The bridge check answers a new question — *which profile serves this vault* — and "runner installed for a different vault" became "no profile for this vault", with the two ways to fix it.
- Credentials stay in Termux and are now configured per repository (`credential.helper store --file=…` or `core.sshCommand`), so two vaults can use two accounts. A pre-existing global helper still applies to repositories that have no local one; see limitations.md.
- Residual risk: an app with shared-storage write access can cause a profile to be created for a repository that is already on the device. It cannot choose the token or the path, and pairing alone neither fetches nor pushes. Documented in the threat model (T13).
