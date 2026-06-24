import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderKnownScaffoldTemplate } from '../tsTools/scaffoldGenerate';

const FIXTURE_ROOT = path.join(
  process.cwd(),
  'src/services/tools/autoresearchBootstrap/__tests__/__fixtures__/python-ml-baseline-rendered',
);

describe('renderKnownScaffoldTemplate', () => {
  it('renders the python baseline scaffold deterministically', () => {
    const vars = {
      project_name: 'test-project',
      research_goal: 'Improve test accuracy',
      success_criteria: 'Beat the baseline by at least 1 point.',
      primary_metric: 'accuracy',
      baseline_name: 'ResNet50',
      dataset_name: 'CIFAR10',
      train_command: 'python3 train.py',
      eval_command: 'python3 eval.py',
      requirements_extra: 'torch',
      node_eval_command: 'npx tsx index.ts',
    };

    const rendered = renderKnownScaffoldTemplate({
      templateId: 'python-ml-baseline',
      workDir: '/tmp/test-project',
      vars,
    });

    const firstPass = rendered.renderedFiles.map((file) => ({ path: file.path, content: file.content }));
    const secondPass = renderKnownScaffoldTemplate({
      templateId: 'python-ml-baseline',
      workDir: '/tmp/test-project',
      vars,
    }).renderedFiles.map((file) => ({ path: file.path, content: file.content }));

    expect(firstPass).toEqual(secondPass);

    for (const file of rendered.renderedFiles) {
      const expectedPath = path.join(FIXTURE_ROOT, file.path);
      const expectedContent = readFileSync(expectedPath, 'utf8');
      expect(file.content.replace(/\r\n/g, '\n').trimEnd()).toBe(expectedContent.replace(/\r\n/g, '\n').trimEnd());
    }
  });
});