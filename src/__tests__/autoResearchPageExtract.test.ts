/**
 * AG-27 (step 1): source guards for the mechanical extract of setup
 * persistence helpers, ExperimentDetailPanel, and four presentational
 * sections (run controls, setup fields, empty state, run list) and the
 * existing AutoResearchView controller into `src/pages/autoResearch/`.
 *
 * AutoResearch.tsx and the extracted controller are both under 500 LOC.
 * The custom hook runs in AutoResearchView, preserving state ownership,
 * hook order, effect timing, and the original async boundaries.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DIR = 'src/pages';
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};
const HOOK_RE =
  /\b(use(?:State|Callback|Effect|Memo|Ref|Context|Reducer|LayoutEffect|AutoResearchStore|SettingsStore|AutoResearchLifecycleLock|AutoResearchViewController))\b(?:<[^()]*>)?\(/g;

const PAGE = `${DIR}/AutoResearch.tsx`;
const PARTS: Array<[string, string, boolean]> = [
  ['autoResearchSetupPersistence.ts', 'loadPersistedSetup', false],
  ['ExperimentDetailPanel.tsx', 'ExperimentDetailPanel', true],
  ['AutoResearchRunControls.tsx', 'AutoResearchRunControls', false],
  ['AutoResearchSetupFields.tsx', 'AutoResearchSetupFields', false],
  ['AutoResearchEmptyState.tsx', 'AutoResearchEmptyState', false],
  ['AutoResearchRunListView.tsx', 'AutoResearchRunListView', false],
];

describe('AG-27 AutoResearch page extract guards', () => {
  it('AutoResearch.tsx and every extracted file are under 500 LOC', () => {
    expect(loc(PAGE)).toBeLessThan(500);
    expect(loc(`${DIR}/autoResearch/useAutoResearchViewController.ts`)).toBeLessThan(500);
    for (const [name] of PARTS) {
      expect(loc(`${DIR}/autoResearch/${name}`)).toBeLessThan(500);
    }
  });

  it('the controller keeps AutoResearchView hook order and AutoResearch keeps its hook order', () => {
    const src = read(PAGE);
    const view = src.slice(
      src.indexOf('function AutoResearchView('),
      src.indexOf('\nexport function AutoResearch('),
    );
    const page = src.slice(src.indexOf('\nexport function AutoResearch('));
    const controller = read(`${DIR}/autoResearch/useAutoResearchViewController.ts`);
    const viewHooks = [...view.matchAll(HOOK_RE)].map((m) => m[1]);
    const controllerBody = controller.slice(controller.indexOf('  const {'));
    const controllerHooks = [...controllerBody.matchAll(HOOK_RE)].map((m) => m[1]);
    const pageHooks = [...page.matchAll(HOOK_RE)].map((m) => m[1]);
    expect(viewHooks).toEqual(['useAutoResearchViewController']);
    expect(controllerHooks).toEqual([
      'useAutoResearchStore',
      'useAutoResearchStore',
      'useAutoResearchStore',
      'useAutoResearchStore',
      'useAutoResearchStore',
      'useAutoResearchStore',
      'useSettingsStore',
      'useSettingsStore',
      'useSettingsStore',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useMemo',
      'useAutoResearchLifecycleLock',
      'useMemo',
      'useCallback',
      'useCallback',
      'useEffect',
      'useEffect',
      'useEffect',
      'useEffect',
      'useEffect',
      'useEffect',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
      'useCallback',
    ]);
    expect(pageHooks).toEqual(['useAutoResearchStore', 'useAutoResearchStore', 'useEffect']);
  });

  it('the page and controller use a static module boundary and preserve async counts', () => {
    const src = read(PAGE);
    const controller = read(`${DIR}/autoResearch/useAutoResearchViewController.ts`);
    expect(src).toContain("import { useAutoResearchViewController } from './autoResearch/useAutoResearchViewController';");
    expect(controller).not.toMatch(/\bimport\(|\brequire\(|\blazy\(/);
    expect(controller.match(/\basync\b/g)).toHaveLength(5);
    expect(controller.match(/\bawait\b/g)).toHaveLength(5);
  });

  it('the page statically imports and renders every extracted part', () => {
    const src = read(PAGE);
    const controller = read(`${DIR}/autoResearch/useAutoResearchViewController.ts`);
    expect(controller).toContain(
      "from './autoResearchSetupPersistence';",
    );
    expect(controller).toContain('loadPersistedSetup()');
    expect(controller).toContain('AUTORESEARCH_CONFIG_STORAGE_KEY');
    expect(src).not.toMatch(/\bimport\(|\brequire\(|\blazy\(/);
    for (const [file, name, _hasHooks] of PARTS) {
      if (file.endsWith('.ts')) continue;
      expect(src).toContain(`import { ${name} } from './autoResearch/${name}';`);
      expect(src).toMatch(new RegExp(`<${name}\\b`));
    }
    // intent-preserving shell pieces still inline
    expect(src).toContain('function AutoResearchView(');
    expect(src).toContain('export function AutoResearch(');
    expect(src).toMatch(/MainLayout/);
    expect(src).toMatch(/TerminalPanel/);
  });

  it('extracted presentational parts are typed, await-free, and only ExperimentDetailPanel keeps its existing store hooks', () => {
    for (const [file, name, allowsHooks] of PARTS) {
      const src = read(`${DIR}/autoResearch/${file}`);
      const hooks = [...src.matchAll(HOOK_RE)].map((m) => m[1]);
      if (allowsHooks) {
        expect(hooks).toEqual(['useAutoResearchStore', 'useAutoResearchStore']);
      } else {
        expect(hooks).toEqual([]);
      }
      expect(src).not.toMatch(/\bawait\b/);
      expect(src).not.toMatch(/\bimport\(|\brequire\(/);
      if (file.endsWith('.tsx')) {
        expect(src).toMatch(new RegExp(`export (?:function|const) ${name}\\b`));
        if (name !== 'ExperimentDetailPanel') {
          expect(src).toMatch(/Props\s*\{/);
        }
        expect(src.split(/export (?:function|const)/)[0]).not.toMatch(/:\s*any\b/);
      } else {
        expect(src).toMatch(new RegExp(`export (?:function|const) ${name}\\b`));
        expect(src).toContain('export const AUTORESEARCH_CONFIG_STORAGE_KEY');
      }
    }
  });
});
