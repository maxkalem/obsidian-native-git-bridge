# Git Bridge Companion (thin transponder)

A ~100-line Android app whose only job is to let Obsidian trigger the Native
Git Bridge runner in Termux. All control, safety checks and configuration live
in the Obsidian plugin; this app has no UI, no settings and no state.

Flow: Obsidian plugin writes `runtime/requests/<id>.json` → opens
`nativegitbridge://run` → this app forwards a RUN_COMMAND intent to Termux with
the **fixed** script path `~/.config/native-git-bridge/runner.sh` → the runner
drains the request queue, writes results, exits. The URI carries no command
content and no token; a malicious link can at most make the runner check an
empty queue.

## Build

Without a local Android SDK: push this repo to GitHub — the workflow in
`.github/workflows/build-companion.yml` builds `app-debug.apk` as an artifact.

Locally: open `companion/` in Android Studio, or `gradle assembleDebug`
(JDK 17, Android SDK 34).

## One-time setup on the phone

1. Install the APK (enable "install unknown apps" for your file manager).
2. Android Settings → Apps → Git Bridge Companion → Permissions → Additional
   permissions → allow "Run commands in Termux environment".
3. In Termux: `mkdir -p ~/.termux && echo "allow-external-apps=true" >> ~/.termux/termux.properties`,
   then restart Termux. (The plugin installer prints this too.)
4. In Obsidian → Native Git Bridge settings → Android integration type →
   "Companion app intent".

Security notes: the app declares only `com.termux.permission.RUN_COMMAND`; it
cannot read the vault, the network, or storage. It never executes anything but
the fixed runner path, and the runner itself enforces the pairing token and
action allow-list.
