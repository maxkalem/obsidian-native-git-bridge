# Release engineering

## One source of truth, three install paths

`manifest.json` and `styles.css` are edited at the repository **root** only (the layout the community-plugins review expects). Every `npm run build` copies them into `native-git-bridge/` next to the freshly bundled `main.js`, and CI fails when the committed copies differ from the build. The result: a manual copy of `native-git-bridge/`, a BRAT install from a release, and a community-plugins install all ship byte-identical files. Never edit the files inside `native-git-bridge/` by hand; they are build output.

The Termux scripts live in `native-git-bridge/termux/` and are edited there — they are **not** build output and there is no second copy. That is deliberate: it is the folder users copy into their vault, so a device that has the plugin already has everything needed to install or update the runner with no network at all. The release workflow attaches the three files from that folder, so the asset names on a release are unchanged.

`package-lock.json` is committed so `npm ci` pins the toolchain: without it, an esbuild patch release would change `main.js` bytes and turn the CI freshness check into noise.

## Version fields (all must move together)

| File | Field | Consumer |
|------|-------|----------|
| `manifest.json`<br>(root; synced to `native-git-bridge/` by the build) | `version` | Obsidian (must equal the release tag) |
| `package.json` | `version` | npm scripts / CI consistency check |
| `versions.json` | new <br>`"x.y.z": "minAppVersion"`<br> entry | Obsidian update mechanism (the build fails if the manifest version is missing here) |
| `native-git-bridge/termux/native-git-bridge-runner.sh` | `RUNNER_VERSION` | handshake (bump only when the runner changes) |
| `src/constants.ts` | `RUNNER_MIN_VERSION` | handshake (bump **only** when the plugin cannot work with the older runner) |
| `companion/app/build.gradle.kts` | (none) | derived automatically from the root `manifest.json` (`versionName` = release version, `versionCode` = major×10000 + minor×100 + patch); nothing to bump by hand |

The `build-plugin` workflow fails if the first three disagree.

The two handshake numbers move for different reasons, and confusing them is how everyone is forced to reinstall for nothing. `RUNNER_VERSION` goes up whenever the runner script changes at all, because a number is never reused and the developer's own device may already carry that one. `RUNNER_MIN_VERSION` goes up only when the plugin genuinely cannot work with the older runner — a new argument an old runner would reject, or a changed result it cannot read. A runner that only changes how it does something it already did leaves the minimum alone.

A brand new action needs neither: name it in `ACTION_MIN_RUNNER` instead, and the plugin refuses that one action on an older runner with a message naming the version, while everything else keeps working.

## Cutting a release

1. Bump the version fields above; run `npm test`, `npm run test:e2e`, `npm run build`, then **commit the regenerated `native-git-bridge/` files** (the freshness check rejects a tag whose committed artifacts are stale).
2. Commit, then tag with the bare version (Obsidian convention, no `v` prefix): `git tag 0.5.0 && git push origin main 0.5.0`.
3. The `release` workflow verifies tag == manifest version, re-runs both test suites, builds the plugin and the companion APKs, and creates a **draft** GitHub release with `main.js`, `manifest.json`, `styles.css`, the Termux scripts and the APKs attached. Review and publish the draft.

## Publishing to the community directory (one-time)

The current process goes through the directory itself, not a PR:

1. Publish the draft GitHub release the workflow created (a draft does not count; the tag must equal the root `manifest.json` version, no `v` prefix, with `main.js`, `manifest.json`, `styles.css` as binary assets. The release workflow already attaches them).
2. Sign in at <https://community.obsidian.md> with an Obsidian account, link the GitHub account that owns this repository.
3. Plugins → **New plugin** → enter the repository URL → agree to the developer policies → Submit.
4. The automated review reads `manifest.json` from HEAD of the default branch and lists anything to fix; address feedback by pushing fixes and cutting a new release with an incremented version.

After acceptance, users install from within Obsidian and receive every new GitHub release automatically; no resubmission needed.

Honest caveat for this plugin: it is Android-only by nature (Termux + companion APK). Say so prominently in the README before submitting, and expect review questions about desktop behaviour (`isDesktopOnly` is `false` because the plugin loads fine on desktop, it just has nothing to bridge to).

## Companion APK signing

Without a keystore, the release carries `git-bridge-companion-DEBUG-SIGNATURE.apk`: installable, but signed with a FRESH debug key on every CI run, so Android refuses to update-install it across releases (uninstall/reinstall each time). With a keystore configured, the release carries only the properly signed `git-bridge-companion.apk`, and updates install over the previous version. To set it up:

1. Create a keystore once, locally: `keytool -genkeypair -v -keystore ngb-release.jks -alias ngb -keyalg RSA -keysize 2048 -validity 10000`
2. Add repository **secrets**: `NGB_KEYSTORE_BASE64` (`base64 -w0 ngb-release.jks`), `NGB_KEYSTORE_PASSWORD`, `NGB_KEY_ALIAS`, `NGB_KEY_PASSWORD`.
3. Add repository **variable** `NGB_HAS_KEYSTORE=true` (gates the signing step, so forks without secrets do not fail).

Rejected alternative, the Termux approach: Termux signs its GitHub builds with a PUBLIC test key committed to the repository (`testkey_untrusted.jks`), which makes all GitHub builds update-compatible without secrets, at the price that anyone can forge an installable "update" (their README warns about this loudly). For the companion this trade-off is unacceptable: it holds the RUN_COMMAND permission, so a forged update would mean command execution inside the user's Termux. A private keystore costs five minutes and closes this.

Keep the keystore private and back it up: Android updates install only when the new APK is signed with the same key as the installed one. Personal devices that already run the debug APK must uninstall it before switching to the signed one (different signature). This is standard Android behaviour, not a bridge limitation.

## Before tagging: the checks worth running by hand

CI runs all of this too, but a release is the one path where finding out afterwards is expensive.

```
# the version fields agree
jq -r .version manifest.json package.json native-git-bridge/manifest.json
jq -r --arg v "$(jq -r .version manifest.json)" '.[$v]' versions.json   # == minAppVersion
jq -r '.version, .packages."".version' package-lock.json               # CI does not check this one

# the runner handshake moves as a pair
grep -m1 '^RUNNER_VERSION=' native-git-bridge/termux/native-git-bridge-runner.sh
grep -n 'RUNNER_MIN_VERSION' src/constants.ts

# the committed artifacts match a fresh build
npm run build && git status --porcelain -- main.js styles.css native-git-bridge/

# and the suites
npm test && npm run test:e2e
```

One thing no machine checks, and it was wrong once: LF line endings on the three Termux scripts, `file native-git-bridge/termux/*.sh`. A CRLF checkout of those dies on Android with `$'\r': command not found`.

Three things go stale first and none of them is checked by a machine: the runner version table in [protocol.md](protocol.md), the test counts in [submission.md](submission.md), and `package-lock.json`. The lockfile was correct as of 0.6.2, saying 0.6.2 and GPL-3.0-only; it had been wrong on both counts one release earlier.

## What CI cannot verify

There is no Android device or emulator in CI. The workflows prove that the APKs build and that the plugin passes its suites on Linux; RUN_COMMAND forwarding, storage permissions, and the Termux round trip can only be verified on a device (the companion's setup checklist exists for exactly that).
