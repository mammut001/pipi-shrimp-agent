/**
 * AG-33 (step 1): source guards for the mechanical extract of the inline
 * `#[cfg(test)] mod tests { .. }` block out of
 * `src-tauri/src/claude/http/request_builder.rs` into the file module
 * `src-tauri/src/claude/http/request_builder/tests.rs`.
 *
 * request_builder.rs is now under the 800 LOC hard limit (target: <500 in a
 * follow-up step). Asserts it carries no test bodies any more and that all 10
 * tests + the `sample_message` helper exist exactly once in tests.rs.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};

const BUILDER_RS = 'src-tauri/src/claude/http/request_builder.rs';
const TESTS_RS = 'src-tauri/src/claude/http/request_builder/tests.rs';

const TESTS = [
  'detects_artifacts_from_code_html_and_mermaid',
  'formats_tool_calls_for_openai_and_anthropic',
  'formats_image_attachments_for_anthropic_and_openai',
  'builds_provider_specific_urls_and_headers',
  'sanitizes_openai_history_keeps_reasoning_content_without_request_params',
  'preserves_assistant_reasoning_content_for_deepseek_tool_continuation',
  'keeps_assistant_reasoning_content_even_when_supports_reasoning_false',
  'builds_deepseek_openai_body_with_tools_and_tool_choice',
  'builds_minimax_m3_body_with_reasoning_split',
  'builds_openai_body_with_strict_tools_when_supported',
];

describe('AG-33 request_builder.rs test-module extract guards', () => {
  it('request_builder.rs is under 800 LOC and tests.rs under 500 LOC', () => {
    expect(loc(BUILDER_RS)).toBeLessThan(800);
    expect(loc(TESTS_RS)).toBeLessThan(500);
  });

  it('request_builder.rs declares the test module as a file module and has no test bodies', () => {
    const builder = read(BUILDER_RS);
    expect(builder.trimEnd().endsWith('#[cfg(test)]\nmod tests;')).toBe(true);
    expect(builder).not.toContain('#[test]');
    expect(builder).not.toMatch(/mod tests \{/);
    expect(builder).not.toMatch(/fn sample_message\b/);
  });

  it('tests.rs keeps the parent glob import, the helper and all 10 tests in order', () => {
    const tests = read(TESTS_RS);
    expect(tests).toMatch(/^use super::\*;$/m);
    expect(tests.match(/^fn sample_message\(/gm)).toHaveLength(1);
    const names = [...tests.matchAll(/#\[test\]\s*fn (\w+)\(/g)].map((m) => m[1]);
    expect(names).toEqual(TESTS);
  });

  it('public request_builder API used by claude/http/mod.rs stays in request_builder.rs', () => {
    const builder = read(BUILDER_RS);
    for (const name of [
      'build_anthropic_body',
      'build_openai_body',
      'build_anthropic_headers',
      'build_openai_headers',
      'format_messages_for_anthropic',
      'format_messages_for_openai',
      'detect_artifacts',
      'estimate_request_input_tokens',
    ]) {
      expect(builder).toMatch(new RegExp(`^pub fn ${name}\\(`, 'm'));
    }
  });
});
