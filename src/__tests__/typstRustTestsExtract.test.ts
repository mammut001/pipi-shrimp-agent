/**
 * AG-30: source guards for the mechanical extract of the inline
 * `#[cfg(test)] mod tests { .. }` block out of `src-tauri/src/utils/typst.rs`
 * into `src-tauri/src/utils/typst/tests.rs` (basic compile tests) and
 * `src-tauri/src/utils/typst/tests/template_examples.rs` (template
 * inline-example compile tests).
 *
 * Keeps every file under the 500 LOC watch line, asserts typst.rs carries no
 * test bodies any more, and that all 8 tests (1 ignored) still exist exactly
 * once across the two test files.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};

const TYPST_RS = 'src-tauri/src/utils/typst.rs';
const TESTS_RS = 'src-tauri/src/utils/typst/tests.rs';
const TEMPLATES_RS = 'src-tauri/src/utils/typst/tests/template_examples.rs';

const testNames = (src: string) =>
  [...src.matchAll(/#\[test\]\s*(?:#\[ignore[^\]]*\]\s*)?fn (\w+)\(/g)].map((m) => m[1]);

const BASIC = [
  'test_compile_typst_file_simple',
  'test_compile_typst_file_with_package',
  'test_compile_typst_file_with_local_include',
];
const TEMPLATES = [
  'test_compile_grotesk_cv_inline_example',
  'test_compile_basic_resume_inline_example',
  'test_compile_calligraphics_inline_example',
  'test_compile_fallback_resume_inline_example_chinese',
  'test_compile_nabcv_inline_example_local',
];

describe('AG-30 utils/typst.rs test-module extract guards', () => {
  it('typst.rs and both test files are under 500 LOC', () => {
    expect(loc(TYPST_RS)).toBeLessThan(500);
    expect(loc(TESTS_RS)).toBeLessThan(500);
    expect(loc(TEMPLATES_RS)).toBeLessThan(500);
  });

  it('typst.rs declares the test module as a file module and has no test bodies', () => {
    const typst = read(TYPST_RS);
    expect(typst.trimEnd().endsWith('#[cfg(test)]\nmod tests;')).toBe(true);
    expect(typst).not.toContain('#[test]');
    expect(typst).not.toMatch(/mod tests \{/);
  });

  it('test files keep the original imports and nest template examples under tests', () => {
    const tests = read(TESTS_RS);
    const templates = read(TEMPLATES_RS);
    expect(tests).toMatch(/^use super::\*;$/m);
    expect(tests).toMatch(/^use std::io::Write;$/m);
    expect(tests).toMatch(/^mod template_examples;$/m);
    expect(templates).toMatch(/^use super::\*;$/m);
  });

  it('all 8 tests exist exactly once, split basic vs template examples', () => {
    expect(testNames(read(TESTS_RS))).toEqual(BASIC);
    expect(testNames(read(TEMPLATES_RS))).toEqual(TEMPLATES);
    expect(read(TEMPLATES_RS)).toContain(
      '#[ignore = "local Typst smoke for nabcv; requires bundled templates and local font installation"]',
    );
  });
});
