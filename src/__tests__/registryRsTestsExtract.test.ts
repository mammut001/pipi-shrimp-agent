/**
 * AG-25 (step 1): source guards for the mechanical extract of the inline
 * `#[cfg(test)] mod tests { .. }` block at the end of
 * `src-tauri/src/tools/registry.rs` into the file module
 * `src-tauri/src/tools/registry/tests.rs`.
 *
 * registry.rs is security-sensitive (ToolMetadata flags feed execution policy
 * and concurrency) and still above the 800 LOC hard limit after this first
 * step (AG-25 stays open). These guards pin the test-module move, keep
 * tests.rs under the 500 LOC watch line, and assert the registry API and
 * builtin registration stay in registry.rs.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};

const REGISTRY_RS = 'src-tauri/src/tools/registry.rs';
const TESTS_RS = 'src-tauri/src/tools/registry/tests.rs';

const TESTS = [
  'bootstrap_llm_tool_requires_provider_context',
  'scaffold_generate_executes_through_contextual_registry_path',
  'registry_registers_glob_and_grep_tools',
  'execute_with_context_consumes_approval_once_with_matching_session',
  'modern_single_tool_path_still_executes_read_file',
  'write_file_uses_bound_work_dir_for_relative_paths',
  'test_barrier_tool_runtime_metadata_is_cancellable_and_concurrent',
];

describe('AG-25 registry.rs test-module extract guards', () => {
  it('registry.rs shrank below its 1304-line baseline and tests.rs is under 500 LOC', () => {
    expect(loc(REGISTRY_RS)).toBeLessThan(1100);
    expect(loc(TESTS_RS)).toBeLessThan(500);
  });

  it('registry.rs ends with the file-module declaration and has no test bodies', () => {
    const src = read(REGISTRY_RS);
    expect(src.endsWith('\n}\n\n#[cfg(test)]\nmod tests;\n')).toBe(true);
    expect(src).not.toMatch(/#\[(tokio::)?test\]/);
    expect(src).not.toMatch(/mod tests \{/);
    expect(src).not.toMatch(/fn make_request\b/);
  });

  it('tests.rs keeps the original imports, helper and all 7 tests in order', () => {
    const tests = read(TESTS_RS);
    expect(tests).toMatch(/^use super::\*;$/m);
    expect(tests).toMatch(/^use uuid::Uuid;$/m);
    expect(tests.match(/^fn make_request\(/gm)).toHaveLength(1);
    expect(tests).toContain('super::super::ToolExecutionSource::Unknown');
    const names = [...tests.matchAll(/#\[(?:tokio::)?test[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn (\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual(TESTS);
  });

  it('the registry API, bootstrap registration and builtin registration stay in registry.rs', () => {
    const src = read(REGISTRY_RS);
    expect(src).toMatch(/^pub struct ToolRegistry \{/m);
    expect(src).toMatch(/^pub fn register_builtin_tools\(registry: &mut ToolRegistry\) \{/m);
    expect(src).toMatch(/^fn register_bootstrap_tool\(/m);
    for (const fn of ['execute_with_context', 'is_concurrency_safe', 'is_read_only', 'get_anthropic_tools_schema', 'get_openai_tools_schema']) {
      expect(src).toMatch(new RegExp(`pub (async )?fn ${fn}\\(`));
    }
    expect(read(TESTS_RS)).not.toMatch(/fn register_builtin_tools\(/);
  });
});
