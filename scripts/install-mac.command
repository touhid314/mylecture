#!/bin/bash
# Installs (or updates) MyLecture on a Mac.
#
#   curl -fsSL https://raw.githubusercontent.com/touhid314/mylecture/main/scripts/install-mac.command | bash
#
# or double-click this file in Finder. It picks the build for this Mac's chip
# (Apple silicon or Intel), downloads it with curl, installs it into
# Applications and clears macOS's download quarantine flag, so MyLecture opens
# without the "unidentified developer" warning (the app is ad-hoc signed, not
# notarized).
#
# Options: --no-open (do not start MyLecture afterwards)
# Environment: MYLECTURE_ZIP_URL=<url> installs that zip instead of the newest build.
set -euo pipefail

REPO="touhid314/mylecture"
APP_NAME="MyLecture"
OPEN_AFTER=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_AFTER=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mMyLecture could not be installed: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS."

# Apple silicon reports arm64; a Terminal running under Rosetta reports x86_64
# but sysctl.proc_translated=1, so check that too.
arch="$(uname -m)"
if [ "${arch}" = "arm64" ] || [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ]; then
  ARCH="arm64"; CHIP="Apple silicon"
else
  ARCH="x64"; CHIP="Intel"
fi
say "Installing MyLecture for ${CHIP}..."

# The latest release's build for this chip. github.com/.../releases/latest
# redirects to the newest release's tag; unlike the GitHub API it is not rate
# limited (the API allows 60 requests an hour per address, which shared school
# or office networks can exceed). The API is only a fallback.
url="${MYLECTURE_ZIP_URL:-}"
if [ -z "${url}" ]; then
  latest="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" 2>/dev/null || true)"
  tag="${latest##*/tag/}"
  if [ -n "${latest}" ] && [ "${tag}" != "${latest}" ] && [ -n "${tag}" ]; then
    candidate="https://github.com/${REPO}/releases/download/${tag}/MyLecture-${tag#v}-mac-${ARCH}.zip"
    if curl -fsSIL -o /dev/null "${candidate}" 2>/dev/null; then url="${candidate}"; fi
  fi
fi
if [ -z "${url}" ]; then
  releases="$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${REPO}/releases?per_page=30")" \
    || fail "could not reach GitHub. Check your internet connection and try again."
  url="$(printf '%s' "$releases" | grep -o "\"browser_download_url\": *\"[^\"]*-mac-${ARCH}\.zip\"" | head -n 1 | sed -E 's/.*"(https[^"]+)"$/\1/')"
  [ -n "${url}" ] || fail "no Mac build for ${CHIP} was found."
fi
echo "Downloading $(basename "${url}")"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
# curl does not mark files as downloaded from the internet, so no quarantine.
curl -fL --progress-bar -o "${work}/app.zip" "${url}" || fail "the download did not finish. Try again."

say "Unpacking..."
# ditto keeps the app bundle's symlinks and code signature intact (unzip does not).
ditto -x -k "${work}/app.zip" "${work}/unpacked" || fail "the download is damaged. Try again."
src="$(find "${work}/unpacked" -maxdepth 2 -name "${APP_NAME}.app" -type d | head -n 1)"
[ -n "${src}" ] || fail "the download does not contain ${APP_NAME}.app."

# Install into /Applications, or ~/Applications when /Applications is not writable.
dest_dir="/Applications"
if [ ! -w "${dest_dir}" ]; then dest_dir="${HOME}/Applications"; mkdir -p "${dest_dir}"; fi
dest="${dest_dir}/${APP_NAME}.app"

# Quit a running copy before replacing it.
if pgrep -xq "${APP_NAME}"; then
  echo "Closing the running MyLecture..."
  osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xq "${APP_NAME}" || break; sleep 1; done
  pkill -x "${APP_NAME}" 2>/dev/null || true
fi

say "Installing into ${dest_dir}..."
rm -rf "${dest}"
ditto "${src}" "${dest}" || fail "could not copy MyLecture into ${dest_dir}."

# This is the step that removes the security warning.
xattr -cr "${dest}" 2>/dev/null || true

# Apple silicon only runs signed apps; re-apply the ad-hoc signature if needed.
if ! codesign --verify --deep "${dest}" >/dev/null 2>&1; then
  codesign --force --deep --sign - "${dest}" >/dev/null 2>&1 || fail "could not prepare MyLecture to run on this Mac."
fi

say "MyLecture is installed in ${dest_dir}."
if [ "${OPEN_AFTER}" = "1" ]; then
  echo "Opening MyLecture..."
  open "${dest}"
fi
echo "You can close this window."
