#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cat <<EOF
Real Browser Surface Runner

Primary release gate:
	npm run test:browser-gate

Manual smoke checklist:
	${ROOT_DIR}/tests/browser/smoke-sites.md

Benchmark checklist:
	${ROOT_DIR}/tests/browser/benchmark-checklist.md

Ignored live-browser Rust tests:
	RUN_LIVE_BROWSER_TESTS=1 bash ${ROOT_DIR}/tests/browser/release-gate.sh
EOF
