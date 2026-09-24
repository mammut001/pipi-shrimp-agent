/**
 * AG-23 (step 1): source guards for the mechanical extract of the inline
 * `#[cfg(test)] mod tests { .. }` block (mid-file, before the LSP section) out
 * of `src-tauri/src/commands/code.rs` into the file module
 * `src-tauri/src/commands/code/tests.rs`.
 *
 * code.rs is still above the 800 LOC hard limit after this first step (AG-23
 * stays open); these guards pin the test-module move, keep tests.rs under the
 * 500 LOC watch line, and assert all 6 `#[tauri::command]` fns stay in code.rs.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};

const CODE_RS = 'src-tauri/src/commands/code.rs';
const TESTS_RS = 'src-tauri/src/commands/code/tests.rs';

const TESTS = [
  'execute_bash_for_tool_returns_structured_timeout_result',
  'execute_bash_for_tool_returns_sanitized_structured_response',
  'execute_bash_for_tool_rejects_dangerous_commands',
  'execute_python_session_times_out_on_no_sentinel',
  'python_session_persists_state_between_calls',
  'python_session_second_call_succeeds',
  'python_session_stderr_heavy_does_not_hang',
  'python_session_absolute_timeout_despite_continuous_stdout',
  'python_session_stderr_is_per_call_not_stale',
  'execute_python_infinite_loop_returns_timed_out',
  'execute_node_long_running_returns_timed_out',
];
const HELPERS = ['canonical_path_string', 'assert_cwd_matches', 'temp_work_dir'];
const COMMANDS = [
  'execute_bash',
  'execute_python',
  'execute_python_session',
  'close_python_session',
  'execute_node',
  'lsp_operation',
];

describe('AG-23 code.rs test-module extract guards', () => {
  it('code.rs shrank below its 1472-line baseline and tests.rs is under 500 LOC', () => {
    expect(loc(CODE_RS)).toBeLessThan(1100);
    expect(loc(TESTS_RS)).toBeLessThan(500);
  });

  it('code.rs declares the test module as a file module in place and has no test bodies', () => {
    const code = read(CODE_RS);
    expect(code).toMatch(/\n#\[cfg\(test\)\]\nmod tests;\n\n\/\/ =+ LSP \(Language Server Protocol\) Commands =+\n/);
    expect(code).not.toMatch(/#\[(tokio::)?test\]/);
    expect(code).not.toMatch(/mod tests \{/);
    for (const helper of HELPERS) {
      expect(code).not.toMatch(new RegExp(`fn ${helper}\\b`));
    }
  });

  it('tests.rs keeps the original imports, helpers and all 11 tests in order', () => {
    const tests = read(TESTS_RS);
    expect(tests).toMatch(/^use super::\*;$/m);
    expect(tests).toMatch(/^use std::path::\{Path, PathBuf\};$/m);
    expect(tests).toMatch(/^use uuid::Uuid;$/m);
    for (const helper of HELPERS) {
      expect(tests.match(new RegExp(`^fn ${helper}\\(`, 'gm'))).toHaveLength(1);
    }
    const names = [...tests.matchAll(/#\[(?:tokio::)?test[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn (\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual(TESTS);
  });

  it('all 6 tauri commands and the command-safety code stay in code.rs', () => {
    const code = read(CODE_RS);
    for (const name of COMMANDS) {
      expect(code).toMatch(new RegExp(`#\\[tauri::command\\]\\s*pub async fn ${name}\\(`));
    }
    expect(code).toMatch(/^fn check_command_safety\(/m);
    expect(code).toMatch(/^pub fn execute_bash_for_tool\(/m);
    expect(read(TESTS_RS)).not.toContain('#[tauri::command]');
  });
});
