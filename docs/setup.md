# Setup guide (Android)

What you install, in order: **Termux** (runs real git), the **Git Bridge Companion** app (forwards triggers to Termux), and the **plugin** (the UI in Obsidian). Nothing runs in the background at any point; Termux executes a one-shot script only when you invoke a command in Obsidian.

## Prerequisites

- An Obsidian vault on shared storage (e.g. `/storage/emulated/0/MyVault`). It does **not** have to be a git repository yet — since plugin 0.6.1 the plugin can create one or clone one into it (see *Step 3c*). Sparse checkout is supported but not required.
- Termux from **F-Droid** (the Play Store build is deprecated and its RUN_COMMAND behaviour differs).

## Step 1: Termux

Get it from the official site <https://termux.dev>, which lists the supported download sources. In practice the **F-Droid build** (<https://f-droid.org/packages/com.termux/>). Avoid the Play Store build: it is deprecated. Open Termux once so it initializes its home directory.

Note: the companion app never installs anything itself. It can only open F-Droid or the download page for you. Installing an APK would require `REQUEST_INSTALL_PACKAGES` on an app that already holds the Termux RUN_COMMAND permission, which is not a trade this project makes.

## Step 2: Companion app

Install `git-bridge-companion.apk` from the GitHub release (or, if the release carries only `git-bridge-companion-DEBUG-SIGNATURE.apk`, take that one: it works, but future updates will require uninstalling it first). Open it: it shows a three-step checklist.

1. *Termux installed*: detected automatically.
2. *Run commands in Termux environment*: tap to grant the Android permission.
3. *Round trip*: verified automatically after step 3 below (the app triggers the runner through the real RUN_COMMAND path and shows a green checkmark when a result comes back).

All three checkmarks must be green before the bridge can work.

## Step 3: one pasted line in Termux

```
curl -fsSL https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest/download/bootstrap.sh | bash -s -- "/storage/emulated/0/<YourVault>"
```

(You can omit the path; the installer scans shared storage for vaults that are git repositories and asks if it finds several.)

Better: copy the command from the plugin (Settings → Copy command & open Termux) or from the companion app's step 3. Those versions are **pinned to the release you are running**, so the runner they install is exactly the one your plugin build was tested against. The command above tracks the newest release instead, and neither fetches from the `main` branch, which is the development state and may be mid-change.

The installer requests storage access (accept the Android dialog), installs git/jq/openssh, marks the repo as `safe.directory` if needed (asks first), enables `allow-external-apps` (required for the companion), configures authentication for this repository non-interactively, installs the runner to `~/.config/native-git-bridge/runner.sh`, writes a profile for this vault (`~/.config/native-git-bridge/profiles/<id>.conf`, mode 600, with a token of its own), excludes the runtime folder from git locally, runs a ping self-test, and drops a one-shot `pairing.json` that the plugin imports and deletes on its next start.

Authentication stays entirely in Termux and is configured **per repository**, so two vaults can use two different accounts: an existing PAT via credential helper, a token in the remote URL (the installer offers to move it into this repository's own credential file, mode 600), or an SSH key (generated automatically for SSH remotes; on a device that already has one, the installer offers a separate key for this vault and sets `core.sshCommand` locally). Add the printed public key to your git host. No credential ever reaches the plugin, a result file or any log.

When the installer configures the repository's own credential file, it writes TWO local `credential.helper` lines: an empty value first, then the file. The empty value is what makes the file authoritative — helpers accumulate across scopes and the first that answers wins, so without it a global helper (gh's, for instance) would answer ahead of this repository's own credentials. The global configuration itself is never touched.

### GitHub OAuth instead of a PAT

Termux has no OAuth of its own, but the **GitHub CLI** is packaged (`pkg install gh`) and its login is a real OAuth **device flow**: it prints a one-time code, you approve it at <https://github.com/login/device> in the phone's browser, and no local port is opened — which is the same "nothing listens, nothing runs in the background" property the bridge itself keeps.

```
pkg install gh
gh auth login        # HTTPS, then "Login with a web browser"
gh auth setup-git    # git now authenticates through `gh auth git-credential`
```

Afterwards the runner's `fetch` and `push` work non-interactively, which is what it needs (it never answers a prompt). The token is stored in `~/.config/gh/hosts.yml` — Termux has no keyring, so gh falls back to a plain file with restrictive permissions — and it stays in Termux like every other credential here. Revoke it at <https://github.com/settings/applications>; unlike a fine-grained PAT it has no expiry date to be surprised by.

Two things to know before choosing this route:

- `gh auth setup-git` writes a **global** credential helper, so it also applies to any repository that has no local one. If a second vault belongs to a different account, give that one its own credential file (the installer does this) rather than relying on gh.
- gh answers for the **active** account on a host. With several GitHub accounts on one device, `gh auth switch` changes it for everything at once, so per-vault PATs (or per-vault SSH keys via `core.sshCommand`) remain the way to keep two accounts apart.

Git Credential Manager, the usual OAuth helper on desktop, has no Android build and is not an option here.

### Installing without a network

The Termux scripts live in the plugin folder, so the folder you put in the vault already carries them:

```
<vault>/.obsidian/plugins/native-git-bridge/
  main.js  manifest.json  styles.css
  termux/bootstrap.sh  termux/install.sh  termux/native-git-bridge-runner.sh
```

Copy that folder to the device and run, in Termux:

```
bash "/storage/emulated/0/<YourVault>/.obsidian/plugins/native-git-bridge/termux/bootstrap.sh" "/storage/emulated/0/<YourVault>"
```

`bootstrap.sh` takes `install.sh` and the runner from the directory it is started from, so there is nothing to download, no version to pass and nothing that depends on GitHub being reachable. The plugin shows this exact command under *Settings → Install without a network* (and as *Copy offline command* in the setup guide) as soon as the repository path is set, because Termux addresses the vault by its absolute path. Both buttons also bring Termux to the front, ready for the paste.

If you prefer to pipe the script instead of running it, the source has to be named explicitly, since a piped script cannot know where it came from:

```
curl -fsSL "file:///storage/emulated/0/<YourVault>/.obsidian/plugins/native-git-bridge/termux/bootstrap.sh" \
  | NGB_BASE_URL="/storage/emulated/0/<YourVault>/.obsidian/plugins/native-git-bridge/termux" bash -s -- "/storage/emulated/0/<YourVault>"
```

**`NGB_BASE_URL`** is where the three scripts come from. It accepts an `https://` URL (a release, a mirror), a `file://` URL, or a plain directory path — on a device, that is the plugin's own `termux` folder inside the vault. It overrides everything else; without it, the order is: the folder the script lives in, then the release matching `NGB_VERSION`, then the newest release.

This is also how to update the runner when the plugin arrived through vault sync but GitHub is unreachable: the new scripts came with it, so the offline command installs exactly the runner this plugin build expects.

## Step 3b: more than one vault on the device

Each vault is a repository of its own and gets its own profile, its own token and its own runtime folder. One runner drains them all, so you never have to switch anything.

- **Easiest**: open the second vault in Obsidian and use *Settings → Native Git Bridge → Profile for this vault → Pair this vault* (also in the setup guide and the command palette). The plugin writes a pairing request into its runtime folder and wakes the runner; Termux checks that the vault really is a git repository of its own, generates a token there, and answers. Nothing secret leaves Termux.
- **Or** run the install command again with the second vault's path. That also configures authentication for it and prints what it did. Re-running the installer for a vault that already has a profile keeps its token.

A vault opened **inside** another vault's repository (`Main/` and `Main/Projects/ABCproject/`) works too. The installer adds `/<relative path>/` to the **outer** repository's `.git/info/exclude` — device-local, never synced, no tracked file touched — so the outer repository stops offering the inner vault's files. The runner re-checks this on every run. Each side's operations stay inside its own repository.

An existing single-vault setup is migrated automatically the first time the new runner runs: the old `config` becomes a profile with the **same token** (no re-pairing) and is kept as `config.legacy`.

If you move a vault to another folder, the runner finds it again by the marker it left in the runtime folder and keeps the profile. If a vault is deleted, its profile stays behind and is reported as broken; it is never re-pointed at some other repository.

Because a deleted vault leaves its profile behind, profiles can outnumber the repositories actually on the device, and nothing in the vault would show that. The installer therefore ends by listing every profile it can see — how many there are, which one belongs to the vault you just installed for, and, for each, the directory it points at with a note when that directory is gone or is no longer a git work tree. It deletes nothing: a profile carries that vault's token, so removing one is `rm ~/.config/native-git-bridge/profiles/<id>.conf` and your decision.

## Step 3c: a vault that is not a repository yet

*Settings → Native Git Bridge → Repository for this vault → **Set up repository***, also in the setup guide and the command palette. It looks at what the vault actually is and offers only the steps that apply:

- **Pair first.** Termux has to know the vault before it can do anything in it. Pairing works before the repository exists: the plugin marks its pairing request accordingly, and until a repository is there the profile can answer nothing except "create one" and "clone one".
- **Create a repository here.** Choose the default branch (`main` by default), and decide whether to make a first commit of everything the vault already holds. The plugin's runtime folder is excluded automatically, and a repository created inside another paired vault is excluded from that outer repository straight away.
- **Clone an existing repository into this vault.** The vault normally already holds files (`.obsidian/` at least), which a plain `git clone` refuses. The plugin clones without a checkout, moves the repository in, and then writes out only the files the vault does **not** have. Nothing you already had is overwritten: the files that exist on both sides keep your version and appear in the panel as ordinary local changes, so you can open each diff and either commit yours or discard it to take the repository's. Files that exist only in the vault are left alone and are simply untracked.

- **Re-clone from a remote.** For a repository that is broken, points at the wrong place, or whose history you no longer want. Your notes are treated exactly as in a normal clone, and the repository being replaced is **set aside, not deleted**: it lands in the plugin's runtime folder with its history intact, and the plugin reminds you once a day that it is using disk until you either delete it or say "stop reminding". Nothing is disturbed unless the new clone succeeds first.
- **Add or change the remote.** For a repository that has none, or one pointing at the wrong place. The plugin checks what the remote already contains and says what that means: an empty remote is ready for your first push; a remote with content offers *Get the repository's content*, which lands in exactly the state cloning would have produced (your files kept, the rest checked out around them). If this vault **also** has commits of its own, the two histories are unrelated — git will refuse to merge them, so the plugin says so at once and points at the two deliberate ways out rather than pretending.

A URL that carries a password is refused with a message rather than accepted: credentials belong in Termux (credential helper, SSH key, or `gh auth login`), never in a request file inside the vault. Accepted forms are `https://…`, `ssh://…`, `git@host:owner/repo.git` and `file:///absolute/path` for a local copy.

A clone of a private https remote asks for those credentials once, in Termux: the plugin copies a plain `git clone` command to the clipboard and opens Termux, you paste it and answer git's username/token prompts at the terminal — with git's own progress meter — and then press Continue back in Obsidian, which moves the downloaded repository into the vault without a second download. What you enter is saved for this repository, so everything after the clone runs without asking. SSH remotes skip this — a key never prompts — and a re-clone of a repository whose credentials are already configured runs entirely through the companion, as before.

## Step 4: the plugin

1. Copy the `native-git-bridge` folder to `<YourVault>/.obsidian/plugins/native-git-bridge/` (it must contain `main.js`, `manifest.json`, `styles.css`).
2. Restart Obsidian → Settings → Community plugins → enable **Native Git Bridge**.
3. Open the plugin settings and **Enable on this device** (the enable flag is device-local by design). The pairing token imports automatically.
4. If your vault uses sparse checkout, review **Protected paths**: directories excluded by sparse checkout that must never be committed as deletions.

## Step 5: verify

Run *Native Git Bridge: Status* from the command palette or the sidebar panel. The first round trip confirms the whole chain. If nothing comes back, run *Native Git Bridge: Check bridge*. It diagnoses locally (runner never ran here / outdated runner / stuck requests) without waiting for a timeout.

Once status works, everything else does too. Tapping a changed file opens its diff in a pane (a staged row shows `HEAD → staged`, an unstaged row `staged → working tree`). The two buttons on the right of the operation strip switch the file list between **list and tree layout** and open the **repository history**, where commits expand into their changed files and each file opens the diff that commit introduced. The repository history opens beside the status panel in the sidebar (it belongs to the whole repository); a diff, a file's history and a conflict open as tabs, because they are about one file and need the width. Conflicted files are marked with a warning icon and open conflict resolution (see [troubleshooting.md](troubleshooting.md#conflict-merge-conflicts)).

Long-pressing (or right-clicking) a row, a folder or a group header opens the Git menu for that target; on a single file it also offers **Open file history**, a panel that lists the commits that touched the file, says what each did to it, shows the file as it was at a commit (the eye button on the commit), and can restore the whole file or one block of it. The command palette entries (*Show diff for current file*, *Show history for current file*, *Show current file at a commit*, *Restore current file from a commit*) open the same two panels — there is one surface per question, not a modal variant per entry point.

Worth a look in the settings: wrap long diff lines, show invisible characters, show raw conflict markers, an optional auto-refresh interval for the status panel (off by default, since each refresh wakes Termux), and **custom colours** for the diff and conflict panes (off by default; switching it on reveals pickers for light and dark separately). Line wrapping, whitespace glyphs and the colours apply to all three file views — the diff pane, the diffs inside the file-history panel, and the conflict pane — and take effect immediately, without a Termux round trip.

Also see: [troubleshooting.md](troubleshooting.md), [update.md](update.md).
