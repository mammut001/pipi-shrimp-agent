/**
 * AG-26 (step toward <500): source guards for the mechanical extract of
 * `src-tauri/src/tools/autoresearch_bootstrap/mod.rs` into two child modules:
 *   - `scaffold_template.rs` — scaffold template tables + rendering helpers
 *   - `paper_tools.rs` — pdf_read / paper_extract_meta / baseline_extract /
 *     arxiv_search tool executors + arXiv Atom parsing
 *
 * mod.rs is now under the 800 LOC hard limit; the new modules are under 500.
 * The serde model types, scaffold path safety check, git init, finalize and
 * the `execute_tool` dispatcher stay in mod.rs.
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
const STAYING_ITEMS = [
  'struct PaperReference',
  'struct ExtractedBaseline',
  'struct TemplateDefinition',
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
  it('mod.rs is under 800 LOC and the new child modules are under 500 LOC', () => {
    expect(loc('mod.rs')).toBeLessThan(800);
    expect(loc('scaffold_template.rs')).toBeLessThan(500);
    expect(loc('paper_tools.rs')).toBeLessThan(500);
  });

  it('declares both child modules with static, explicit imports', () => {
    const mod = read('mod.rs');
    expect(mod).toMatch(/^mod paper_tools;$/m);
    expect(mod).toMatch(/^mod scaffold_template;$/m);
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
  });

  it('types, path safety, git init, finalize and the dispatcher stay in mod.rs', () => {
    const mod = read('mod.rs');
    for (const item of STAYING_ITEMS) {
      expect(defines(mod, item)).toBe(true);
    }
    for (const tool of ['pdf_read', 'paper_extract_meta', 'baseline_extract', 'arxiv_search', 'scaffold_generate', 'git_init_workdir', 'bootstrap_finalize']) {
      expect(mod).toContain(`"${tool}" => Some(`);
    }
  });

  it('keeps representative error strings verbatim in the moved code', () => {
    const paper = read('paper_tools.rs');
    expect(paper).toContain('arxiv_search requires query');
    expect(paper).toContain('arxiv_search failed: {error}');
    expect(paper).toContain('Failed to read arXiv response: {error}');
    expect(paper).toContain('https://export.arxiv.org/api/query?search_query=all:{}&start=0&max_results={}');
  });
});
