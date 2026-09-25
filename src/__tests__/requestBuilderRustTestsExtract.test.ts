/**
 * AG-33: source guards for the mechanical extracts from
 * `src-tauri/src/claude/http/request_builder.rs` into its file modules.
 *
 * request_builder.rs is now under the <500 LOC target after extracting artifact detection and
 * OpenAI history helpers. Asserts it carries no test bodies and that all 10
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
const ARTIFACTS_RS = 'src-tauri/src/claude/http/request_builder/artifacts.rs';
const OPENAI_HISTORY_RS = 'src-tauri/src/claude/http/request_builder/openai_history.rs';

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

describe('AG-33 request_builder module extract guards', () => {
  it('request_builder.rs and extracted modules stay under 500 LOC', () => {
    expect(loc(BUILDER_RS)).toBeLessThan(500);
    expect(loc(TESTS_RS)).toBeLessThan(500);
    expect(loc(ARTIFACTS_RS)).toBeLessThan(500);
    expect(loc(OPENAI_HISTORY_RS)).toBeLessThan(500);
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
      'estimate_request_input_tokens',
    ]) {
      expect(builder).toMatch(new RegExp('^pub fn ' + name + '\\(', 'm'));
    }
    expect(builder).toMatch(/^pub use self::artifacts::detect_artifacts;$/m);
  });

  it('keeps artifact and OpenAI history helpers in static sibling modules', () => {
    const builder = read(BUILDER_RS);
    const artifacts = read(ARTIFACTS_RS);
    const openaiHistory = read(OPENAI_HISTORY_RS);
    expect(builder).toMatch(/^mod artifacts;$/m);
    expect(builder).toMatch(/^mod openai_history;$/m);
    expect(artifacts).toContain('static ARTIFACT_CODE_REGEX');
    expect(artifacts).toContain('static ARTIFACT_HTML_REGEX');
    expect(artifacts).toContain('static ARTIFACT_MERMAID_REGEX');
    expect(artifacts).toMatch(/^pub fn detect_artifacts\(/m);
    expect(openaiHistory).toMatch(/^pub\(super\) fn build_openai_user_content\(/m);
    expect(openaiHistory).toMatch(/^pub\(super\) fn sanitize_openai_history_messages\(/m);
    expect(openaiHistory).toMatch(/^fn remove_hidden_reasoning_fields\(/m);
    expect(openaiHistory).toMatch(/^fn sanitize_assistant_message_for_openai_record\(/m);
    expect(builder).not.toMatch(/fn (?:build_openai_user_content|sanitize_openai_history_messages|remove_hidden_reasoning_fields|sanitize_assistant_message_for_openai_record)\(/);
  });

  it('leaves API-key header builders and sanitization in request_builder.rs', () => {
    const builder = read(BUILDER_RS);
    for (const text of [
      'pub fn build_anthropic_headers(',
      'pub fn build_openai_headers(',
      'fn sanitize_header_value(',
      'message: "Invalid API key header".to_string()',
      'message: "Invalid bearer token".to_string()',
    ]) {
      expect(builder).toContain(text);
    }
  });
});
