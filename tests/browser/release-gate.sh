#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

run_step() {
  echo
  echo ">>> $*"
  "$@"
}

run_step npm exec tsc -- --noEmit --pretty false
run_step npm test -- --runInBand \
  src/__tests__/BrowserDebugPanel.test.ts \
  src/__tests__/browserDebugSnapshotCache.test.ts \
  src/__tests__/browserObservabilityWiring.test.ts \
  src/__tests__/browserPageStateModel.test.ts \
  src/__tests__/nativeBrowserAgent.test.ts
run_step cargo test --manifest-path src-tauri/Cargo.toml --test browser_page_state_fixtures
run_step cargo test --manifest-path src-tauri/Cargo.toml build_page_state_capture_preserves_viewport_and_screenshot
run_step cargo test --manifest-path src-tauri/Cargo.toml test_snapshot_cache_hit_miss_and_evict_events_are_recorded

if [[ "${RUN_LIVE_BROWSER_TESTS:-0}" == "1" ]]; then
  run_step cargo test --manifest-path src-tauri/Cargo.toml --test browser_live_actions -- --ignored --nocapture
else
  echo
  echo ">>> Skipping ignored live browser tests. Set RUN_LIVE_BROWSER_TESTS=1 to include them."
fi