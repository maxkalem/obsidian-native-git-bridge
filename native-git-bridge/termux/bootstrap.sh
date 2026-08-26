#!/data/data/com.termux/files/usr/bin/bash
# Native Git Bridge - one-line Termux bootstrap.
#
# Online (the usual way; the plugin and the companion app pin it to their own
# version so the runner always matches them):
#   curl -fsSL https://github.com/maxkalem/obsidian-native-git-bridge/releases/download/<version>/bootstrap.sh | bash -s -- "/storage/emulated/0/<YourVault>"
#
# Offline, from the copy that ships inside the plugin folder in your vault —
# no network, no GitHub, nothing to download:
#   bash "/storage/emulated/0/<YourVault>/.obsidian/plugins/native-git-bridge/termux/bootstrap.sh" "/storage/emulated/0/<YourVault>"
#
# Release assets are used on purpose for the online path: the `main` branch is
# the development state and may be mid-change, while a release is a tested,
# immutable set.
set -eu

REPO="https://github.com/maxkalem/obsidian-native-git-bridge"

# The directory this script was started from, when it was started from a FILE.
# Piped into bash (`curl … | bash`) there is no such directory, and BASH_SOURCE
# is either unset or "bash" — that is the signal to fall back to the network.
SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# Where to take install.sh and the runner from. Priority:
#  1. NGB_BASE_URL   — explicit override. A https:// URL, a file:// URL, or a
#     plain directory path: on a device the natural value is the plugin's own
#     termux folder inside the vault,
#     e.g. /storage/emulated/0/<Vault>/.obsidian/plugins/native-git-bridge/termux
#  2. the directory this script itself lives in, when it holds the other two
#     files — running the copy in your vault therefore needs no arguments and
#     no network at all;
#  3. the release this script came from (NGB_VERSION, set by the caller or by
#     the plugin), so all three files come from ONE release;
#  4. the newest release.
if [ -n "${NGB_BASE_URL:-}" ]; then
  BASE="$NGB_BASE_URL"
elif [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/install.sh" ] && [ -f "$SELF_DIR/native-git-bridge-runner.sh" ]; then
  BASE="$SELF_DIR"
elif [ -n "${NGB_VERSION:-}" ]; then
  BASE="$REPO/releases/download/$NGB_VERSION"
else
  BASE="$REPO/releases/latest/download"
fi

# A local directory is copied, not downloaded: curl cannot take a bare path,
# and on a device the files are usually already sitting in the vault.
case "$BASE" in
  file://*) BASE_DIR="${BASE#file://}" ;;
  /*)       BASE_DIR="$BASE" ;;
  *)        BASE_DIR="" ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Download one file with a SHORT progress bar: 20 cells, prefixed with the
# file's name and size. curl's own --progress-bar was tried and dropped — it
# is as wide as the terminal, and the two downloads stacked read as one wall
# of # with nothing saying what was downloaded or why twice (user report,
# 2026-08-26). Progress at all, rather than silence, stays for the original
# reason: on a slow connection a silent download reads as a hang, and this
# script is always watched by a person. Without a Content-Length the bar is
# skipped and the download narrates start and end only.
fetch_one() { # $1 file name
  if [ -n "$BASE_DIR" ]; then
    cp "$BASE_DIR/$1" "$TMP/$1"
    return $?
  fi
  local url="$BASE/$1" out="$TMP/$1" total got filled shown=-1 bar pid
  total="$(curl -fsLI -o /dev/null -w '%{content_length}' "$url" 2>/dev/null || printf '0')"
  case "$total" in ''|*[!0-9]*) total=0 ;; esac
  # Sizes are printed the way Termux's own apt prints them: SI kB, 1000 bytes
  # (apt says "[9,383 kB]"), not the 1024-byte KiB.
  if [ "$total" -le 0 ]; then
    printf -- '-- %s ... ' "$1"
    curl -fsSL "$url" -o "$out" || { printf 'FAILED\n'; return 1; }
    printf 'ok (%d kB)\n' "$(( $(wc -c < "$out") / 1000 ))"
    return 0
  fi
  curl -fsSL "$url" -o "$out" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    got="$(wc -c < "$out" 2>/dev/null || printf '0')"
    case "$got" in ''|*[!0-9]*) got=0 ;; esac
    filled=$(( got * 20 / total ))
    [ "$filled" -gt 20 ] && filled=20
    if [ "$filled" -ne "$shown" ]; then
      bar="$(printf '%*s' "$filled" '' | tr ' ' '#')$(printf '%*s' "$((20 - filled))" '' | tr ' ' '.')"
      printf -- '\r-- %s [%s] %d/%d kB' "$1" "$bar" "$(( got / 1000 ))" "$(( total / 1000 ))"
      shown=$filled
    fi
    sleep 0.2
  done
  if ! wait "$pid"; then
    printf '\n'
    return 1
  fi
  # The finish line replaces the bar instead of redrawing it full: a bar
  # exists to show progress, and a decorative 100% repaint said nothing
  # (user's correction, 2026-08-26). Trailing spaces erase the bar's leftovers.
  printf -- '\r-- %s ok (%d kB)                                \n' "$1" "$(( total / 1000 ))"
}

# A blank line and a rule before the first output: the command the user just
# pasted sits directly above, and without the break the narration reads as
# part of it (user request, 2026-08-26).
printf '\n--------------------\n'
if [ -n "$BASE_DIR" ]; then
  echo "-- Taking the Native Git Bridge installer from $BASE_DIR ..."
else
  echo "-- Downloading the Native Git Bridge installer from $BASE ..."
fi

if ! fetch_one native-git-bridge-runner.sh || ! fetch_one install.sh; then
  if [ -n "$BASE_DIR" ]; then
    echo "ERROR: install.sh and native-git-bridge-runner.sh were not found in $BASE_DIR" >&2
    echo "       That folder ships inside the plugin: <vault>/.obsidian/plugins/native-git-bridge/termux/" >&2
    echo "       Copy the plugin folder to the device again, or point NGB_BASE_URL at it." >&2
  else
    echo "ERROR: could not download the installer from $BASE" >&2
    echo "       Check the network, or run the copy in your vault instead:" >&2
    echo "       bash \"<vault>/.obsidian/plugins/native-git-bridge/termux/bootstrap.sh\" \"<vault>\"" >&2
  fi
  exit 1
fi

# Sanity check: a 404 page, a truncated download or the wrong file must not be
# executed. Applies to the local path too — a half-copied file looks the same.
if ! head -n 1 "$TMP/install.sh" | grep -q '^#!'; then
  echo "ERROR: the installer does not look like a script (wrong path or URL?)." >&2
  exit 1
fi
if ! head -n 1 "$TMP/native-git-bridge-runner.sh" | grep -q '^#!'; then
  echo "ERROR: the runner does not look like a script (wrong path or URL?)." >&2
  exit 1
fi

exec bash "$TMP/install.sh" "$@"
