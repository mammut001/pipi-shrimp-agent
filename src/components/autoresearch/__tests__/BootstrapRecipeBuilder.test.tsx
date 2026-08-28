/** @jest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { BootstrapRecipeBuilder } from '../BootstrapRecipeBuilder';
import { buildBootstrapPromptFromRecipe, type Recipe } from '../bootstrapRecipePrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
}));

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: jest.fn(),
}));

const recipe: Recipe = {
  researchGoal: {
    goalText: 'Exceed the baseline accuracy of the model',
    taskType: 'beat_baseline',
    source: 'user',
  },
  references: {},
  baselineAndMetric: {
    primaryMetric: 'accuracy',
    direction: 'higher',
    baselineValue: '0.82',
    successCriteria: 'Consistent 85% accuracy',
  },
  workspace: {
    workDir: '/workspace/test',
    folderName: 'my-exp-folder',
  },
  verification: {
    commands: ['pytest tests/', 'npm test'],
  },
  outputContract: {
    includeMetrics: true,
    includeArtifacts: true,
    includeCommandsRun: false,
    includeFailureReason: true,
    includeRemainingRisks: false,
  },
};

describe('buildBootstrapPromptFromRecipe', () => {
  it('compiles the structured recipe into the AutoResearch bootstrap prompt', () => {
    const prompt = buildBootstrapPromptFromRecipe(recipe, {
      contextFiles: ['/workspace/test/paper.pdf'],
    });

    expect(prompt).toContain('# AUTORESEARCH BOOTSTRAP REQUEST');
    expect(prompt).toContain('## Research Goal');
    expect(prompt).toContain('Exceed the baseline accuracy of the model');
    expect(prompt).toContain('## References');
    expect(prompt).toContain('/workspace/test/paper.pdf');
    expect(prompt).toContain('## Baseline & Metric');
    expect(prompt).toContain('accuracy');
    expect(prompt).toContain('## Workspace');
    expect(prompt).toContain('/workspace/test');
    expect(prompt).toContain('## Verification');
    expect(prompt).toContain('pytest tests/');
    expect(prompt).toContain('## Output Contract');
  });

  it('does not mix normal chat-mode or bypass instructions into the recipe compiler', () => {
    const prompt = buildBootstrapPromptFromRecipe(recipe);
    expect(prompt).not.toContain('Bypass');
    expect(prompt).not.toContain('EXECUTION MODE');
  });
});

describe('BootstrapRecipeBuilder', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = jest.fn();
  const onSend = jest.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onChange.mockReset();
    onSend.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  function renderBuilder(value: Recipe = recipe) {
    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={value}
          onChange={onChange}
          onSend={onSend}
        />,
      );
    });
  }

  it('renders the six recipe sections and cockpit actions', () => {
    renderBuilder();
    const text = container.textContent || '';
    expect(text).toContain('autoresearch.recipe.researchGoal');
    expect(text).toContain('autoresearch.recipe.references');
    expect(text).toContain('autoresearch.recipe.baselineAndMetric');
    expect(text).toContain('autoresearch.recipe.workspace');
    expect(text).toContain('autoresearch.recipe.verification');
    expect(text).toContain('autoresearch.recipe.outputContract');
    expect(text).toContain('autoresearch.recipe.previewPrompt');
  });

  it('removes the advanced Prompt-block editor from the AutoResearch surface', () => {
    renderBuilder();
    const text = container.textContent || '';
    expect(text).not.toContain('autoresearch.recipe.advancedTitle');
    expect(text).not.toContain('chat.blockComposerTitle');
    expect(container.innerHTML).not.toContain('Block Task Composer');
  });

  it('sends only the structured recipe prompt', () => {
    renderBuilder();
    const startButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('autoresearch.recipe.startScaffolding'),
    );
    expect(startButton).toBeTruthy();

    act(() => startButton!.click());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]?.[0]).toContain('# AUTORESEARCH BOOTSTRAP REQUEST');
  });

  it('disables start when a required field is missing', () => {
    renderBuilder({
      ...recipe,
      workspace: { ...recipe.workspace, workDir: '' },
    });
    const disabledButtons = Array.from(container.querySelectorAll('button[disabled]'));
    expect(disabledButtons.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('autoresearch.recipe.action.selectWorkspace');
  });

  it('opens the prompt preview from the structured recipe', () => {
    renderBuilder();
    const preview = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('autoresearch.recipe.previewPrompt'),
    );
    expect(preview).toBeTruthy();
    act(() => preview!.click());
    expect(container.innerHTML).toContain('autoresearch.recipe.copyPrompt');
    expect(container.textContent).toContain('# AUTORESEARCH BOOTSTRAP REQUEST');
  });
});
