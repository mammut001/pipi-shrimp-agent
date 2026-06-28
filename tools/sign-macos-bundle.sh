#!/usr/bin/env bash
# Ad-hoc sign a macOS .app so Gatekeeper shows "unverified developer"
# instead of the misleading "damaged" error from a broken linker signature.
set -euo pipefail

APP_PATH="${1:?Usage: sign-macos-bundle.sh path/to/App.app}"
APP_NAME="$(basename "$APP_PATH")"
WORK_DIR="$(mktemp -d)"
CLEAN_APP="${WORK_DIR}/${APP_NAME}"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# Strip Finder metadata that makes codesign fail with "damaged" on other Macs.
ditto --norsrc --noextattr "$APP_PATH" "$CLEAN_APP"
codesign --force --deep --sign - --options runtime "$CLEAN_APP"
codesign --verify --deep --strict --verbose=2 "$CLEAN_APP"

rm -rf "$APP_PATH"
ditto "$CLEAN_APP" "$APP_PATH"

echo "Signed: $APP_PATH"