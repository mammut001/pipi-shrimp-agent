/**
 * AG-25 source guards: preserve the verbatim inline-test move and the
 * order-preserving extraction of built-in registration blocks.
 *
 * ToolMetadata flags feed execution policy and concurrency, so family
 * modules are pinned to their registration sequence and all relevant files
 * stay below 500 LOC.
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
const BUILTIN_FS_RS = 'src-tauri/src/tools/registry/builtin_fs.rs';
const BUILTIN_SEARCH_RS = 'src-tauri/src/tools/registry/builtin_search.rs';
const BUILTIN_COMMAND_RS = 'src-tauri/src/tools/registry/builtin_command.rs';
const BUILTIN_BOOTSTRAP_RS = 'src-tauri/src/tools/registry/builtin_bootstrap.rs';

const TESTS = [
  'bootstrap_llm_tool_requires_provider_context',
  'scaffold_generate_executes_through_contextual_registry_path',
  'registry_registers_glob_and_grep_tools',
  'execute_with_context_consumes_approval_once_with_matching_session',
  'modern_single_tool_path_still_executes_read_file',
  'write_file_uses_bound_work_dir_for_relative_paths',
  'test_barrier_tool_runtime_metadata_is_cancellable_and_concurrent',
];

describe('AG-25 registry extraction guards', () => {
  it('registry.rs, registration modules, and tests.rs are all under 500 LOC', () => {
    for (const file of [REGISTRY_RS, BUILTIN_FS_RS, BUILTIN_SEARCH_RS, BUILTIN_COMMAND_RS, BUILTIN_BOOTSTRAP_RS, TESTS_RS]) {
      expect(loc(file)).toBeLessThan(500);
    }
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

  it('the registry API and registration orchestration stay in registry.rs', () => {
    const src = read(REGISTRY_RS);
    expect(src).toMatch(/^pub struct ToolRegistry \{/m);
    expect(src).toMatch(/^pub fn register_builtin_tools\(registry: &mut ToolRegistry\) \{/m);
    expect(src).toMatch(/^fn register_bootstrap_tool\(/m);
    for (const fn of ['execute_with_context', 'is_concurrency_safe', 'is_read_only', 'get_anthropic_tools_schema', 'get_openai_tools_schema']) {
      expect(src).toMatch(new RegExp(`pub (async )?fn ${fn}\\(`));
    }
    expect(read(TESTS_RS)).not.toMatch(/fn register_builtin_tools\(/);
  });

  it('static family modules retain the original ToolMetadata registration order', () => {
    const src = read(REGISTRY_RS);
    const fsSource = read(BUILTIN_FS_RS);
    const search = read(BUILTIN_SEARCH_RS);
    const command = read(BUILTIN_COMMAND_RS);
    const bootstrap = read(BUILTIN_BOOTSTRAP_RS);

    for (const name of ['builtin_fs', 'builtin_search', 'builtin_command', 'builtin_bootstrap']) {
      expect(src).toContain(`mod ${name};`);
    }
    expect(src).toMatch(
      /builtin_fs::register_filesystem_tools\(registry\);\s*builtin_search::register_search_files\(registry\);\s*builtin_command::register_command_tools\(registry\);\s*builtin_search::register_glob_and_grep\(registry\);\s*builtin_bootstrap::register_bootstrap_tools\(registry\);\s*\/\/ --- test_barrier_tool/,
    );

    const registered = (source: string) =>
      [...source.matchAll(/registry\.register\(\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(registered(fsSource)).toEqual([
      'read_file', 'write_file', 'list_files', 'create_directory', 'path_exists',
    ]);
    expect(registered(search)).toEqual(['search_files', 'glob_search', 'grep_files']);
    expect(registered(command)).toEqual([
      'execute_command', 'ssh_exec', 'ssh_upload_file', 'ssh_read_file',
    ]);
    expect(command).toMatch(/^use super::super::handler_output_from_execute_code;$/m);
    expect(
      [...bootstrap.matchAll(/register_bootstrap_tool\(\s*registry,\s*"([^"]+)"/g)]
        .map((match) => match[1]),
    ).toEqual([
      'pdf_read', 'paper_extract_meta', 'baseline_extract', 'arxiv_search',
      'scaffold_generate', 'git_init_workdir', 'bootstrap_finalize',
    ]);

    expect(src.match(/\.await\b/g)).toHaveLength(1);
    for (const source of [fs, search, command, bootstrap]) {
      expect(source).not.toMatch(/\.await\b/);
    }
  });
});
