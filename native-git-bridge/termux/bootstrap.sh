#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - one-line Termux bootstrap.
# Usage (inside Termux):
#   curl -fsSL https://raw.githubusercontent.com/maxkalem/obsidian-native-git-bridge/main/termux/bootstrap.sh | bash -s -- "/storage/emulated/0/<YourVault>"
set -eu
BASE="${NGB_RAW_BASE:-https://raw.githubusercontent.com/maxkalem/obsidian-native-git-bridge/main}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "-- Downloading Native Git Bridge installer from $BASE ..."
curl -fsSL "$BASE/termux/native-git-bridge-runner.sh" -o "$TMP/native-git-bridge-runner.sh"
curl -fsSL "$BASE/termux/install.sh" -o "$TMP/install.sh"
exec bash "$TMP/install.sh" "$@"
