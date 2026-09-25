/**
 * AG-26: source guards for mechanical extracts from
 * `src-tauri/src/tools/autoresearch_bootstrap/mod.rs`:
 *   - `scaffold_template.rs` — scaffold tables + rendering helpers
 *   - `paper_tools.rs` — PDF/paper/baseline/arXiv executors + parsing
 *   - `types.rs` — bootstrap data models and their deserialize helper
 *   - `tests.rs` — the existing inline tests, moved without changes
 *
 * mod.rs is now below the <500 LOC target. Public execution contexts,
 * scaffold path safety, git init, finalize and the dispatcher stay in mod.rs.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DIR = 'src-tauri/src/tools/autoresearch_bootstrap';
const read = (rel: string) => fs.readFileSync(path.join(ROOT, DIR, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};

const SCAFFOLD_ITEMS = [
  'const PYTHON_REQUIRED_VARS',
  'const PYTHON_TEMPLATE_FILES',
  'const NODE_REQUIRED_VARS',
  'const NODE_TEMPLATE_FILES',
  'const PYTHON_TEMPLATE',
  'const NODE_TEMPLATE',
  'fn normalize_template_id',
  'fn template_definition',
  'fn normalize_project_name',
  'fn normalize_scaffold_vars',
  'fn render_value',
  'fn render_template_string',
  'fn render_known_scaffold_template',
];
const PAPER_ITEMS = [
  'fn extract_arxiv_tag',
  'fn parse_arxiv_atom_feed',
  'async fn execute_pdf_read_tool',
  'async fn execute_paper_extract_meta_tool',
  'fn parse_baseline_envelope',
  'async fn execute_baseline_extract_tool',
  'async fn execute_arxiv_search_tool',
];
const TYPE_ITEMS = [
  'struct PaperReference',
  'struct ReportedMetric',
  'struct BaselineMethod',
  'fn deserialize_optional_json_map',
  'struct Reproducibility',
  'struct ExtractedBaseline',
  'struct ScaffoldFile',
  'struct ScaffoldPlan',
  'struct BootstrapPlan',
  'struct AutoResearchBootstrapResult',
  'struct TemplateFileSource',
  'struct TemplateDefinition',
  'struct RenderedScaffoldFile',
  'struct ScaffoldRenderResult',
  'trait IfEmptyThen',
];
const STAYING_ITEMS = [
  'struct BootstrapProviderContext',
  'struct BootstrapExecutionContext',
  'fn is_safe_scaffold_relative_path',
  'async fn execute_scaffold_generate_tool',
  'async fn execute_git_init_workdir_tool',
  'async fn execute_bootstrap_finalize_tool',
  'async fn run_json_bootstrap_inference',
  'pub async fn execute_tool',
];

const defines = (src: string, item: string) =>
  new RegExp(`^(pub(\\(super\\))? )?${item.replace(/ /g, '\\s+')}\\b`, 'm').test(src);

describe('AG-26 autoresearch_bootstrap/mod.rs extract guards', () => {
  it('mod.rs is under 500 LOC and all extracted modules are under 500 LOC', () => {
    expect(loc('mod.rs')).toBeLessThan(500);
    expect(loc('scaffold_template.rs')).toBeLessThan(500);
    expect(loc('paper_tools.rs')).toBeLessThan(500);
    expect(loc('types.rs')).toBeLessThan(500);
    expect(loc('tests.rs')).toBeLessThan(500);
  });

  it('declares child modules with static, explicit imports', () => {
    const mod = read('mod.rs');
    expect(mod).toMatch(/^mod paper_tools;$/m);
    expect(mod).toMatch(/^mod scaffold_template;$/m);
    expect(mod).toMatch(/^mod types;$/m);
    expect(mod).toMatch(/^use types::\{/m);
    expect(mod).not.toMatch(/^use types::\*;/m);
    expect(mod).toMatch(/^#\[cfg\(test\)\]\nmod tests;$/m);
    expect(mod).toMatch(/^use paper_tools::\{/m);
    expect(mod).toMatch(/^use scaffold_template::\{normalize_scaffold_vars, render_known_scaffold_template\};$/m);
    for (const file of ['scaffold_template.rs', 'paper_tools.rs']) {
      expect(read(file)).toMatch(/^use super::\{/m);
      expect(read(file)).not.toMatch(/use super::\*/);
    }
  });

  it('moved items live only in their new module', () => {
    const mod = read('mod.rs');
    const scaffold = read('scaffold_template.rs');
    const paper = read('paper_tools.rs');
    for (const item of SCAFFOLD_ITEMS) {
      expect(defines(scaffold, item)).toBe(true);
      expect(defines(mod, item)).toBe(false);
      expect(defines(paper, item)).toBe(false);
    }
    for (const item of PAPER_ITEMS) {
      expect(defines(paper, item)).toBe(true);
      expect(defines(mod, item)).toBe(false);
      expect(defines(scaffold, item)).toBe(false);
    }
    const types = read('types.rs');
    for (const item of TYPE_ITEMS) {
      expect(defines(types, item)).toBe(true);
      expect(defines(mod, item)).toBe(false);
      expect(defines(scaffold, item)).toBe(false);
      expect(defines(paper, item)).toBe(false);
    }
  });

  it('public contexts, path safety, git init, finalize and the dispatcher stay in mod.rs', () => {
    const mod = read('mod.rs');
    for (const item of STAYING_ITEMS) {
      expect(defines(mod, item)).toBe(true);
    }
    for (const tool of ['pdf_read', 'paper_extract_meta', 'baseline_extract', 'arxiv_search', 'scaffold_generate', 'git_init_workdir', 'bootstrap_finalize']) {
      expect(mod).toContain(`"${tool}" => Some(`);
    }
  });

  it('keeps the existing Rust tests in the extracted test module', () => {
    const mod = read('mod.rs');
    const tests = read('tests.rs');
    expect(defines(tests, 'fn grounds_metric_tokens_from_source_text')).toBe(true);
    expect(defines(tests, 'fn renders_python_scaffold_with_required_files')).toBe(true);
    expect(mod).not.toContain('fn grounds_metric_tokens_from_source_text');
    expect(mod).not.toContain('fn renders_python_scaffold_with_required_files');
  });

  it('keeps representative error strings verbatim in the moved code', () => {
    const paper = read('paper_tools.rs');
    expect(paper).toContain('arxiv_search requires query');
    expect(paper).toContain('arxiv_search failed: {error}');
    expect(paper).toContain('Failed to read arXiv response: {error}');
    expect(paper).toContain('https://export.arxiv.org/api/query?search_query=all:{}&start=0&max_results={}');
  });
});
