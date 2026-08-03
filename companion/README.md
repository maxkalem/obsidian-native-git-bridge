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
2. Open the **Git Bridge Companion** app from the launcher and tap
   **Grant Termux permission** — the standard Android permission dialog
   appears; just tap Allow. (If a trigger arrives from Obsidian before the
   permission is granted, the app opens this screen by itself.)
   Fallback for OEMs that suppress the dialog: the "Open Android app settings"
   button → Permissions → Additional permissions.
3. Run the plugin's one-line install command in Termux (Copy button in the
   plugin settings) — it enables `allow-external-apps` and installs the runner.
4. In Obsidian → Native Git Bridge settings → Android integration type →
   "Companion app intent".

Security notes: the app declares only `com.termux.permission.RUN_COMMAND`; it
cannot read the vault, the network, or storage. It never executes anything but
the fixed runner path, and the runner itself enforces the pairing token and
action allow-list.
