#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/autoresearch-local-smoke.XXXXXX")"
EXPERIMENT_DIR="$TMP_ROOT/experiment"
WORKDIR="$TMP_ROOT/autoresearch-work"
RESULTS_DIR="$TMP_ROOT/smoke-results"
TS_LOG="$RESULTS_DIR/ts-smoke.log"
RUST_CMD_LOG="$RESULTS_DIR/rust-command.log"
RUST_DANGER_LOG="$RESULTS_DIR/rust-danger.log"
RUST_FILE_LOG="$RESULTS_DIR/rust-file.log"
RUST_PATH_LOG="$RESULTS_DIR/rust-path.log"

cleanup() {
  local status=$?
  trap - EXIT
  if [[ $status -eq 0 ]]; then
    rm -rf "$TMP_ROOT"
    printf 'AUTO_RESEARCH_SMOKE_PASS\n'
  else
    printf 'AUTO_RESEARCH_SMOKE_FAIL tmp_root=%s\n' "$TMP_ROOT" >&2
  fi
  exit $status
}
trap cleanup EXIT

mkdir -p "$EXPERIMENT_DIR" "$WORKDIR" "$RESULTS_DIR"

printf 'AUTO_RESEARCH_SMOKE_START tmp_root=%s\n' "$TMP_ROOT"

cat <<'PY' > "$EXPERIMENT_DIR/run_experiment.py"
import json
from pathlib import Path

Path('metrics.json').write_text(json.dumps({
    'metricName': 'cv_accuracy',
    'metricValue': 0.9751,
    'status': 'IMPROVED',
    'hypothesis': 'cache fold preprocessing',
}, indent=2))

print('experiment complete')
PY

cat <<'MD' > "$EXPERIMENT_DIR/README.md"
# AutoResearch Local Smoke

This fixture exists only for the manual local smoke path.
MD

cat <<'MD' > "$EXPERIMENT_DIR/AUTORESEARCH.md"
# Smoke Notes

Goal: verify the local AutoResearch validation path without relying on VS Code task output.
MD

command -v pnpm >/dev/null 2>&1 || {
  printf 'pnpm is required for the local smoke script.\n' >&2
  exit 1
}

command -v cargo >/dev/null 2>&1 || {
  printf 'cargo is required for the local smoke script.\n' >&2
  exit 1
}

export AUTORESEARCH_SMOKE_ROOT="$TMP_ROOT"
export AUTORESEARCH_SMOKE_EXPERIMENT_DIR="$EXPERIMENT_DIR"
export AUTORESEARCH_SMOKE_WORKDIR="$WORKDIR"
export AUTORESEARCH_SMOKE_RESULTS_DIR="$RESULTS_DIR"

cd "$ROOT_DIR"

pnpm test -- --runTestsByPath \
  src/services/autoresearch/__tests__/localSmoke.test.ts \
  src/services/autoresearch/__tests__/metricsSchema.test.ts \
  src/services/autoresearch/__tests__/runDir.test.ts \
  src/services/headless/__tests__/agentRunner.test.ts \
  --runInBand 2>&1 | tee "$TS_LOG"

# Jest prints console.log as an indented line under a "console.log" header, e.g.
# "      AUTO_RESEARCH_TS_SMOKE_PASS" — not necessarily at column 0. Also accept a
# bare marker file written by the smoke test when present.
if [[ -f "$RESULTS_DIR/AUTO_RESEARCH_TS_SMOKE_PASS" ]]; then
  :
elif grep -qE '[[:space:]]*AUTO_RESEARCH_TS_SMOKE_PASS[[:space:]]*$' "$TS_LOG"; then
  :
else
  printf 'Missing AUTO_RESEARCH_TS_SMOKE_PASS marker in %s\n' "$TS_LOG" >&2
  exit 1
fi
[[ -s "$RESULTS_DIR/metrics-valid.json" ]]
[[ -s "$RESULTS_DIR/metrics-invalid.json" ]]
[[ -s "$RESULTS_DIR/parse-output.log" ]]
[[ -s "$RESULTS_DIR/smoke-summary.txt" ]]
grep -q 'run_status=completed' "$RESULTS_DIR/smoke-summary.txt"
grep -q 'iteration_status=IMPROVED' "$RESULTS_DIR/smoke-summary.txt"
grep -q 'Current AutoResearch uses sessionId as runId.' "$RESULTS_DIR/parse-output.log"

# Use --lib + fully-qualified test names. Plain function-name filters with
# `--exact` match 0 tests because Rust registers them as
# `commands::<mod>::tests::<fn>` (not bare `<fn>`).
run_rust_smoke_test() {
  local filter="$1"
  local log_file="$2"
  shift 2
  cargo test --manifest-path src-tauri/Cargo.toml --lib "$filter" -- --exact "$@" 2>&1 | tee "$log_file"
  # Fail fast if the filter resolved to zero tests (common when names drift).
  if grep -qE 'running 0 tests' "$log_file"; then
    printf 'Rust smoke filter matched 0 tests: %s\n' "$filter" >&2
    exit 1
  fi
  if ! grep -qE 'test result: ok\.' "$log_file"; then
    printf 'Rust smoke test did not report ok: %s\n' "$filter" >&2
    exit 1
  fi
}

run_rust_smoke_test \
  'commands::code::tests::execute_bash_for_tool_returns_sanitized_structured_response' \
  "$RUST_CMD_LOG" \
  --nocapture
grep '^SMOKE_COMMAND_RESULT_JSON=' "$RUST_CMD_LOG" | tail -n 1 | sed 's/^SMOKE_COMMAND_RESULT_JSON=//' > "$RESULTS_DIR/command-result.json"
[[ -s "$RESULTS_DIR/command-result.json" ]]
grep -q '"sanitized":true' "$RESULTS_DIR/command-result.json"
grep -q '"status":"succeeded"' "$RESULTS_DIR/command-result.json"
if grep -q 'sk-test-secret' "$RESULTS_DIR/command-result.json"; then
  printf 'command-result.json still contains the raw bearer token\n' >&2
  exit 1
fi
if grep -q 'sk-abc12345' "$RESULTS_DIR/command-result.json"; then
  printf 'command-result.json still contains the raw API key\n' >&2
  exit 1
fi

run_rust_smoke_test \
  'commands::code::tests::execute_bash_for_tool_rejects_dangerous_commands' \
  "$RUST_DANGER_LOG"
run_rust_smoke_test \
  'commands::file::tests::write_file_rejects_paths_outside_bound_work_dir' \
  "$RUST_FILE_LOG"
run_rust_smoke_test \
  'commands::path_security::tests::test_dangerous_commands' \
  "$RUST_PATH_LOG"