# Release engineering

## One source of truth, three install paths

`manifest.json` and `styles.css` are edited at the repository **root** only
(the layout the community-plugins review expects). Every `npm run build`
copies them into `native-git-bridge/` next to the freshly bundled `main.js`,
and CI fails when the committed copies differ from the build. The result: a
manual copy of `native-git-bridge/`, a BRAT install from a release, and a
community-plugins install all ship byte-identical files. Never edit the files
inside `native-git-bridge/` by hand — they are build output.

`package-lock.json` is committed so `npm ci` pins the toolchain: without it,
an esbuild patch release would change `main.js` bytes and turn the CI
freshness check into noise.

## Version fields (all must move together)

| File | Field | Consumer |
|------|-------|----------|
| `manifest.json` (root; synced to `native-git-bridge/` by the build) | `version` | Obsidian (must equal the release tag) |
| `package.json` | `version` | npm scripts / CI consistency check |
| `versions.json` | new `"x.y.z": "minAppVersion"` entry | Obsidian update mechanism (the build fails if the manifest version is missing here) |
| `native-git-bridge/termux/native-git-bridge-runner.sh` | `RUNNER_VERSION` | handshake (bump only when the runner changes) |
| `src/constants.ts` | `RUNNER_MIN_VERSION` | handshake (bump together with `RUNNER_VERSION`) |
| `companion/app/build.gradle.kts` | `versionCode` / `versionName` | Android (bump only when the companion changes) |

The `build-plugin` workflow fails if the first three disagree.

## Cutting a release

1. Bump the version fields above; run `npm test`, `npm run test:e2e`,
   `npm run build` — and **commit the regenerated `native-git-bridge/` files**
   (the freshness check rejects a tag whose committed artifacts are stale).
2. Commit, then tag with the bare version (Obsidian convention, no `v` prefix):
   `git tag 0.5.0 && git push origin main 0.5.0`.
3. The `release` workflow verifies tag == manifest version, re-runs both test
   suites, builds the plugin and the companion APKs, and creates a **draft**
   GitHub release with `main.js`, `manifest.json`, `styles.css`, the Termux
   scripts and the APKs attached. Review and publish the draft.

## Publishing to the community directory (one-time)

The current process goes through the directory itself, not a PR:

1. Publish the draft GitHub release the workflow created (a draft does not
   count; the tag must equal the root `manifest.json` version, no `v` prefix,
   with `main.js`, `manifest.json`, `styles.css` as binary assets — the
   release workflow already attaches them).
2. Sign in at <https://community.obsidian.md> with an Obsidian account, link
   the GitHub account that owns this repository.
3. Plugins → **New plugin** → enter the repository URL → agree to the
   developer policies → Submit.
4. The automated review reads `manifest.json` from HEAD of the default branch
   and lists anything to fix; address feedback by pushing fixes and cutting a
   new release with an incremented version.

After acceptance, users install from within Obsidian and receive every new
GitHub release automatically — no resubmission needed.

Honest caveat for this plugin: it is Android-only by nature (Termux +
companion APK). Say so prominently in the README before submitting, and expect
review questions about desktop behaviour (`isDesktopOnly` is `false` because
the plugin loads fine on desktop — it just has nothing to bridge to).

## Companion APK signing

Without a keystore, the release carries `git-bridge-companion-DEBUG-SIGNATURE.apk`:
installable, but signed with a FRESH debug key on every CI run, so Android
refuses to update-install it across releases (uninstall/reinstall each time).
With a keystore configured, the release carries only the properly signed
`git-bridge-companion.apk`, and updates install over the previous version. To
set it up:

1. Create a keystore once, locally:
   `keytool -genkeypair -v -keystore ngb-release.jks -alias ngb -keyalg RSA -keysize 2048 -validity 10000`
2. Add repository **secrets**: `NGB_KEYSTORE_BASE64` (`base64 -w0 ngb-release.jks`),
   `NGB_KEYSTORE_PASSWORD`, `NGB_KEY_ALIAS`, `NGB_KEY_PASSWORD`.
3. Add repository **variable** `NGB_HAS_KEYSTORE=true` (gates the signing step,
   so forks without secrets do not fail).

Rejected alternative — the Termux approach: Termux signs its GitHub builds
with a PUBLIC test key committed to the repository (`testkey_untrusted.jks`),
which makes all GitHub builds update-compatible without secrets, at the price
that anyone can forge an installable "update" (their README warns about this
loudly). For the companion this trade-off is unacceptable: it holds the
RUN_COMMAND permission, so a forged update would mean command execution inside
the user's Termux. A private keystore costs five minutes and closes this.

Keep the keystore private and back it up: Android updates install only when the
new APK is signed with the same key as the installed one. Personal devices that
already run the debug APK must uninstall it before switching to the signed one
(different signature). This is standard Android behaviour, not a bridge
limitation.

## What CI cannot verify

There is no Android device or emulator in CI. The workflows prove that the APKs
build and that the plugin passes its suites on Linux; RUN_COMMAND forwarding,
storage permissions, and the Termux round trip can only be verified on a
device (the companion's setup checklist exists for exactly that).
