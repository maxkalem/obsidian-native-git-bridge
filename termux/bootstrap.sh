#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - one-line Termux bootstrap.
#
# Usage (inside Termux), normally copied from the plugin or the companion app,
# which pin it to their own version so the runner always matches them:
#   curl -fsSL https://github.com/maxkalem/obsidian-native-git-bridge/releases/download/<version>/bootstrap.sh | bash -s -- "/storage/emulated/0/<YourVault>"
#
# Release assets are used on purpose: the `main` branch is the development
# state and may be mid-change, while a release is a tested, immutable set.
set -eu

REPO="https://github.com/maxkalem/obsidian-native-git-bridge"

# Where to fetch install.sh and the runner from. Priority:
#  1. NGB_BASE_URL   — explicit override (testing, forks, air-gapped mirrors);
#  2. the release this script itself came from (NGB_VERSION, set by the caller
#     or substituted below), so all three files come from ONE release;
#  3. the newest release.
if [ -n "${NGB_BASE_URL:-}" ]; then
  BASE="$NGB_BASE_URL"
elif [ -n "${NGB_VERSION:-}" ]; then
  BASE="$REPO/releases/download/$NGB_VERSION"
else
  BASE="$REPO/releases/latest/download"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "-- Downloading Native Git Bridge installer from $BASE ..."
if ! curl -fsSL "$BASE/native-git-bridge-runner.sh" -o "$TMP/native-git-bridge-runner.sh" ||
   ! curl -fsSL "$BASE/install.sh" -o "$TMP/install.sh"; then
  echo "ERROR: could not download the installer from $BASE" >&2
  echo "       Check the network, or pick a release manually: $REPO/releases" >&2
  exit 1
fi

# Sanity check: a 404 page or a truncated download must not be executed.
if ! head -n 1 "$TMP/install.sh" | grep -q '^#!'; then
  echo "ERROR: the downloaded installer does not look like a script (wrong URL?)." >&2
  exit 1
fi

exec bash "$TMP/install.sh" "$@"
