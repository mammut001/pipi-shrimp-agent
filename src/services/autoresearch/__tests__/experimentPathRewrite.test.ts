import { describe, expect, it } from '@jest/globals';
import {
  mapExperimentFileToCheckout,
  rewriteAutoResearchToolArguments,
  rewriteEmbeddedExperimentPaths,
  rewriteExperimentPath,
} from '../experimentPathRewrite';

const experimentDir = '/tmp/harness-smoke';
const codeDir = '/Users/demo/autoresearch/runs/run-1/iter-001/code';

describe('rewriteExperimentPath', () => {
  it('maps the original experiment dir onto the iteration checkout', () => {
    expect(rewriteExperimentPath(experimentDir, experimentDir, codeDir)).toBe(codeDir);
    expect(rewriteExperimentPath(`${experimentDir}/run_experiment.py`, experimentDir, codeDir))
      .toBe(`${codeDir}/run_experiment.py`);
    expect(rewriteExperimentPath(`${experimentDir}/configs/baseline.yaml`, experimentDir, codeDir))
      .toBe(`${codeDir}/configs/baseline.yaml`);
  });

  it('leaves iteration checkout paths and unrelated paths unchanged', () => {
    expect(rewriteExperimentPath(`${codeDir}/train.py`, experimentDir, codeDir))
      .toBe(`${codeDir}/train.py`);
    expect(rewriteExperimentPath('/tmp/other/train.py', experimentDir, codeDir))
      .toBe('/tmp/other/train.py');
  });

  it('rewrites workspace-root experiment files when the checkout is nested under it', () => {
    const workspace = '/Users/demo/autoresearch';
    const nestedCode = `${workspace}/runs/run-1/iter-001/code`;
    const iterDir = `${workspace}/runs/run-1/iter-001`;
    expect(rewriteExperimentPath(`${workspace}/train.py`, workspace, nestedCode, iterDir))
      .toBe(`${nestedCode}/train.py`);
    expect(rewriteExperimentPath(`${nestedCode}/train.py`, workspace, nestedCode, iterDir))
      .toBe(`${nestedCode}/train.py`);
    expect(rewriteExperimentPath(`${iterDir}/hypothesis.md`, workspace, nestedCode, iterDir))
      .toBe(`${iterDir}/hypothesis.md`);
  });
});

describe('rewriteEmbeddedExperimentPaths', () => {
  it('rewrites experiment paths inside a command string', () => {
    expect(
      rewriteEmbeddedExperimentPaths(
        `python3 ${experimentDir}/run_experiment.py --out metrics.json`,
        experimentDir,
        codeDir,
      ),
    ).toBe(`python3 ${codeDir}/run_experiment.py --out metrics.json`);
  });

  it('does not rewrite a longer path that only shares a prefix', () => {
    expect(
      rewriteEmbeddedExperimentPaths(
        `python3 ${experimentDir}-2/run_experiment.py`,
        experimentDir,
        codeDir,
      ),
    ).toBe(`python3 ${experimentDir}-2/run_experiment.py`);
  });
});

describe('mapExperimentFileToCheckout', () => {
  it('rewrites files under a distinct experimentDir', () => {
    expect(mapExperimentFileToCheckout(`${experimentDir}/AUTORESEARCH.md`, experimentDir, codeDir))
      .toBe(`${codeDir}/AUTORESEARCH.md`);
  });

  it('falls back to codeDir/basename when prefix rewrite is skipped', () => {
    const workspace = '/Users/demo/autoresearch';
    const nestedCode = `${workspace}/runs/run-1/iter-001/code`;
    expect(mapExperimentFileToCheckout(`${workspace}/run_experiment.py`, workspace, nestedCode))
      .toBe(`${nestedCode}/run_experiment.py`);
  });
});

describe('rewriteAutoResearchToolArguments', () => {
  it('rewrites path, cwd, and command arguments', () => {
    const rewritten = rewriteAutoResearchToolArguments(
      {
        path: `${experimentDir}/train.py`,
        cwd: experimentDir,
        command: `python3 ${experimentDir}/run_experiment.py`,
      },
      { experimentDir, codeDir },
    );
    expect(rewritten).toEqual({
      path: `${codeDir}/train.py`,
      cwd: codeDir,
      command: `python3 ${codeDir}/run_experiment.py`,
    });
  });

  it('is a no-op without both dirs', () => {
    const args = { path: `${experimentDir}/train.py` };
    expect(rewriteAutoResearchToolArguments(args, { experimentDir })).toEqual(args);
    expect(rewriteAutoResearchToolArguments(args, { codeDir })).toEqual(args);
  });

  it('binds relative run_experiment.py onto the checkout and sets cwd', () => {
    const rewritten = rewriteAutoResearchToolArguments(
      {
        path: 'run_experiment.py',
        command: 'python3 run_experiment.py',
      },
      { experimentDir, codeDir },
    );
    expect(rewritten.path).toBe(`${codeDir}/run_experiment.py`);
    expect(rewritten.cwd).toBe(codeDir);
  });
});
