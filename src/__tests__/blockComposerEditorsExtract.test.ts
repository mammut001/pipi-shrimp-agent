/**
 * AG-29: source guards for the mechanical extract of the createBlock factory and
 * seven per-type block editors (intent / context / mode / constraints / output /
 * verification / safety) out of `src/components/chatInput/BlockComposer.tsx`
 * into `src/components/chatInput/blocks/`.
 *
 * The editors are presentational: they own no hooks and no state. All seven
 * useState hooks, the updateBlock useCallback and the preview Escape useEffect
 * stay in BlockComposer in the same order, and the temp-input maps + setters
 * are passed down as typed props. Static imports only.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DIR = 'src/components/chatInput';
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};

const SHELL = `${DIR}/BlockComposer.tsx`;
const FACTORY = `${DIR}/blocks/createComposerBlock.ts`;
const EDITORS: Array<[string, string, string[]]> = [
  ['context', 'ContextBlockEditor', ['newPaths', 'setNewPaths', 'newSymbols', 'setNewSymbols']],
  ['constraints', 'ConstraintsBlockEditor', ['newConstraints', 'setNewConstraints']],
  ['output', 'OutputBlockEditor', []],
  ['verification', 'VerificationBlockEditor', ['newVerifications', 'setNewVerifications']],
  ['safety', 'SafetyBlockEditor', ['newForbiddens', 'setNewForbiddens']],
  ['intent', 'IntentBlockEditor', []],
  ['mode', 'ModeBlockEditor', []],
];
const HOOK_RE = /\b(use(?:State|Callback|Effect|Memo|Ref|Context|Reducer|LayoutEffect))\b(?:<[^()]*>)?\(/g;

describe('AG-29 BlockComposer editor extract guards', () => {
  it('BlockComposer.tsx and every extracted file are under the 500 LOC component limit', () => {
    expect(loc(SHELL)).toBeLessThan(500);
    expect(loc(FACTORY)).toBeLessThan(500);
    for (const [, name] of EDITORS) {
      expect(loc(`${DIR}/blocks/${name}.tsx`)).toBeLessThan(500);
    }
  });

  it('BlockComposer keeps its hooks in the original count and order', () => {
    const hooks = [...read(SHELL).matchAll(HOOK_RE)].map((m) => m[1]);
    expect(hooks).toEqual([
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useState',
      'useCallback',
      'useEffect',
    ]);
  });

  it('BlockComposer statically imports the factory and editors and renders each editor under its type guard', () => {
    const src = read(SHELL);
    expect(src).toContain("import { createComposerBlock } from './blocks/createComposerBlock';");
    expect(src).toContain(
      '  const createBlock = (type: BlockType): ComposerBlock => createComposerBlock(type, defaultMode);',
    );
    expect(src).not.toMatch(/\bimport\(|\brequire\(|\blazy\(/);
    for (const [type, name, extra] of EDITORS) {
      expect(src).toContain(`import { ${name} } from './blocks/${name}';`);
      const props = ['block={block}', 'index={index}', 'updateBlock={updateBlock}', ...extra.map((p) => `${p}={${p}}`)];
      const re = new RegExp(
        `\\{block\\.type === '${type}' && \\(\\s*<${name}\\s+${props.map((p) => p.replace(/[{}]/g, '\\$&')).join('\\s+')}\\s*/>\\s*\\)\\}`,
      );
      expect(src).toMatch(re);
    }
    // Block labels, picker toolbar and preview stay in the shell; editors are extracted.
    expect(src).not.toMatch(/<select\s+value={block\.intentType}/);
    expect(src).not.toContain("['ask', 'plan', 'debug', 'agent', 'bypass']");
    expect(src).toContain("onClick={() => addBlock('safety')}");
    expect(src).toContain('<pre className="whitespace-pre-wrap">{compiledPrompt}</pre>');
  });

  it('extracted editors are hook-free, typed, and contain no async code', () => {
    for (const [, name] of EDITORS) {
      const src = read(`${DIR}/blocks/${name}.tsx`);
      expect(src.match(HOOK_RE)).toBeNull();
      expect(src).toMatch(new RegExp(`export function ${name}\\(`));
      expect(src).toMatch(new RegExp(`export interface ${name}Props \\{`));
      expect(src).toContain('updateBlock: (index: number, updated: ComposerBlock) => void;');
      expect(src.split(`export function ${name}(`)[0]).not.toMatch(/:\s*any\b/);
      expect(src).not.toMatch(/\bawait\b|\basync\b|\bimport\(|\brequire\(/);
    }
    const factory = read(FACTORY);
    expect(factory).toMatch(
      /export function createComposerBlock\(type: BlockType, defaultMode: ExecutionModeId\): ComposerBlock \{/,
    );
    expect(factory).toContain('const id = `block-${Math.random().toString(36).substring(2, 9)}`;');
  });
});
