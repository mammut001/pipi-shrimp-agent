/**
 * AG-07: source guards for the modules extracted from
 * `src/utils/nativeBrowserAgent.ts` (line counts, static imports only,
 * observation await placement, public API).
 *
 * Split out of `nativeBrowserAgentExtract.test.ts` (test hygiene, no case
 * changes).
 */
import fs from 'fs';
import path from 'path';

describe('AG-07 source guards', () => {
  const utilsDir = path.join(__dirname, '..', 'utils');
  const read = (file: string) => fs.readFileSync(path.join(utilsDir, file), 'utf8');
  const lineCount = (file: string) => read(file).split('\n').length - 1;
  const newModules = [
    'nativeBrowserAgentOverlay.ts',
    'nativeBrowserAgentPrompt.ts',
    'nativeBrowserAgentRunState.ts',
    'nativeBrowserAgentObservation.ts',
    'nativeBrowserAgentTypes.ts',
  ];

  it('nativeBrowserAgent.ts is under 500 lines', () => {
    expect(lineCount('nativeBrowserAgent.ts')).toBeLessThan(500);
  });

  it.each(['nativeBrowserAgent.ts', ...newModules])('%s is < 500 lines with static imports only', (file) => {
    const source = read(file);
    expect(lineCount(file)).toBeLessThan(500);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('awaits captureStepObservation only inside the original light / PageState branch', () => {
    const source = read('nativeBrowserAgent.ts');
    expect(source.match(/captureStepObservation\(/g)).toHaveLength(1);
    expect(source).toMatch(
      /let observation: ObservationSnapshot \| null = null;\n\s*if \(desiredLevel === 'light' \|\| usePageStateFlow\) \{\n\s*observation = await captureStepObservation\(\{/,
    );
    expect(source).not.toMatch(/const observation = await captureStepObservation/);
  });

  it('keeps the public API of nativeBrowserAgent.ts', () => {
    const source = read('nativeBrowserAgent.ts');
    expect(source).toContain('export async function executeNativeBrowserTask(');
    expect(source).toContain('export async function removeBrowserAgentOverlay(');
    expect(source).toMatch(
      /export type \{\s*NativeAgentOptions,\s*NativeAgentRunSummary,\s*NativeAgentStepTiming,\s*\} from '\.\/nativeBrowserAgentTypes';/,
    );
  });
});
