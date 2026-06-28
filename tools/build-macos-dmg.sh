#!/usr/bin/env bash
# Build a macOS DMG with the standard app -> Applications drag target.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="${1:-$ROOT_DIR/src-tauri/target/release/bundle/macos/pipi-shrimp-agent.app}"
VERSION="$(python3 -c "import json; print(json.load(open('$ROOT_DIR/src-tauri/tauri.conf.json'))['version'])")"
ARCH="$(uname -m | sed 's/arm64/aarch64/')"
DMG_PATH="${2:-$ROOT_DIR/src-tauri/target/release/bundle/dmg/pipi-shrimp-agent_${VERSION}_${ARCH}.dmg}"
VOLICON="$ROOT_DIR/src-tauri/icons/dmg-volicon.icns"
CREATE_DMG="$ROOT_DIR/tools/create-dmg.sh"
STAGE="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT

bash "$ROOT_DIR/tools/sign-macos-bundle.sh" "$APP_PATH"

cp -R "$APP_PATH" "$STAGE/pipi-shrimp-agent.app"
mkdir -p "$(dirname "$DMG_PATH")"
rm -f "$DMG_PATH"

bash "$CREATE_DMG" \
  --volname "pipi-shrimp-agent" \
  --volicon "$VOLICON" \
  --window-pos 200 120 \
  --window-size 660 400 \
  --icon-size 128 \
  --icon "pipi-shrimp-agent.app" 180 170 \
  --hide-extension "pipi-shrimp-agent.app" \
  --app-drop-link 480 170 \
  --skip-jenkins \
  "$DMG_PATH" \
  "$STAGE"

xattr -cr "$DMG_PATH"
echo "Built: $DMG_PATH"