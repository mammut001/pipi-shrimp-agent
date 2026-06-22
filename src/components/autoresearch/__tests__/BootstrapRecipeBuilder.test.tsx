/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
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

describe('buildBootstrapPromptFromRecipe Prompt Compiler', () => {
  const dummyRecipe: Recipe = {
    researchGoal: {
      goalText: 'Exceed the baseline accuracy of the model',
      taskType: 'beat_baseline',
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

  it('compiles correct markdown including all 6 sections', () => {
    const prompt = buildBootstrapPromptFromRecipe(dummyRecipe, {
      contextFiles: ['/workspace/test/paper.pdf'],
    });

    expect(prompt).toContain('# AUTORESEARCH BOOTSTRAP REQUEST');
    expect(prompt).toContain('## Research Goal');
    expect(prompt).toContain('**Task Type**: beat_baseline');
    expect(prompt).toContain('**Goal/Intent**: Exceed the baseline accuracy of the model');
    expect(prompt).toContain('## References');
    expect(prompt).toContain('Reference File: /workspace/test/paper.pdf');
    expect(prompt).toContain('## Baseline & Metric');
    expect(prompt).toContain('**Primary Metric**: accuracy');
    expect(prompt).toContain('**Baseline Value**: 0.82');
    expect(prompt).toContain('**Success Criteria**: Consistent 85% accuracy');
    expect(prompt).toContain('## Workspace');
    expect(prompt).toContain('**Workspace Dir**: /workspace/test');
    expect(prompt).toContain('**Scaffold Folder Name**: my-exp-folder');
    expect(prompt).toContain('## Verification');
    expect(prompt).toContain('Verification command: `pytest tests/`');
    expect(prompt).toContain('Verification command: `npm test`');
    expect(prompt).toContain('## Output Contract');
    expect(prompt).toContain('Include evaluation metrics');
    expect(prompt).toContain('Include created artifacts');
    expect(prompt).toContain('Document any failures and the root cause');
  });

  it('does not mention normal chat modes or bypass rules', () => {
    const prompt = buildBootstrapPromptFromRecipe(dummyRecipe);
    expect(prompt).not.toContain('Bypass');
    expect(prompt).not.toContain('EXECUTION MODE');
    expect(prompt).not.toContain('Answer directly. Do not use tools.');
  });
});

describe('BootstrapRecipeBuilder UI Component', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockRecipe: Recipe = {
    researchGoal: {
      goalText: 'Initial goal',
      taskType: 'reproduce_paper',
    },
    references: {},
    baselineAndMetric: {
      primaryMetric: 'accuracy',
      direction: 'higher',
    },
    workspace: {
      workDir: '/workspace/dir',
      folderName: 'my-project',
    },
    verification: {
      commands: [],
    },
    outputContract: {
      includeMetrics: true,
      includeArtifacts: false,
      includeCommandsRun: false,
      includeFailureReason: false,
      includeRemainingRisks: false,
    },
  };

  const mockOnChange = jest.fn();
  const mockOnSend = jest.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockOnChange.mockReset();
    mockOnSend.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('renders 6 recipe sections', () => {
    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={mockRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('autoresearch.recipe.researchGoal');
    expect(text).toContain('autoresearch.recipe.references');
    expect(text).toContain('autoresearch.recipe.baselineAndMetric');
    expect(text).toContain('autoresearch.recipe.workspace');
    expect(text).toContain('autoresearch.recipe.verification');
    expect(text).toContain('autoresearch.recipe.outputContract');
  });

  it('collapses and expands sections when clicking Edit/Collapse', () => {
    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={mockRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    // Renders collapsed summary cards by default initially (activeSection = null)
    expect(container.innerHTML).not.toContain('autoresearch.recipe.taskType');

    // Find the Edit button for Goal
    const buttons = Array.from(container.querySelectorAll('button'));
    const editGoalBtn = buttons.find(b => b.textContent === 'autoresearch.recipe.edit' && b.closest('.rounded-2xl')?.innerHTML.includes('autoresearch.recipe.researchGoal'));
    expect(editGoalBtn).toBeTruthy();

    // Expand Research Goal
    act(() => {
      editGoalBtn!.click();
    });
    expect(container.innerHTML).toContain('autoresearch.recipe.taskType');

    // Click collapse
    const collapseGoalBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'autoresearch.recipe.collapse');
    expect(collapseGoalBtn).toBeTruthy();
    act(() => {
      collapseGoalBtn!.click();
    });
    expect(container.innerHTML).not.toContain('autoresearch.recipe.taskType');
  });

  it('shows missing status when required fields are empty', () => {
    const invalidRecipe: Recipe = {
      ...mockRecipe,
      researchGoal: {
        goalText: '',
        taskType: 'reproduce_paper',
      },
    };

    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={invalidRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    // Check that goal section shows Missing status
    const elements = Array.from(container.querySelectorAll('span'));
    const missingBadge = elements.find(el => el.textContent === 'autoresearch.recipe.missing');
    expect(missingBadge).toBeTruthy();

    // Start button should be disabled
    const startBtn = container.querySelector('button[disabled]') as HTMLButtonElement;
    expect(startBtn).toBeTruthy();
    expect(startBtn.textContent).toContain('autoresearch.recipe.startScaffolding');
  });

  it('collapses and opens prompt preview modal', () => {
    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={mockRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    // Prompt preview modal should be hidden by default
    expect(container.innerHTML).not.toContain('autoresearch.recipe.copyPrompt');

    const previewBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('autoresearch.recipe.previewPrompt'));
    expect(previewBtn).toBeTruthy();

    // Open prompt preview modal
    act(() => {
      previewBtn!.click();
    });
    expect(container.innerHTML).toContain('autoresearch.recipe.copyPrompt');
    expect(container.innerHTML).toContain('autoresearch.recipe.close');
  });

  it('selects From scratch template and maps taskType formatting correctly', () => {
    const { formatTaskTypeLabel } = require('../BootstrapRecipeBuilder');
    expect(formatTaskTypeLabel('from_scratch', 'zh-CN')).toBe('从零开始');
    expect(formatTaskTypeLabel('from_scratch', 'en-US')).toBe('From scratch');
    expect(formatTaskTypeLabel('reproduce_paper', 'zh-CN')).toBe('复现论文');
    expect(formatTaskTypeLabel('beat_baseline', 'zh-CN')).toBe('超越基线');
    expect(formatTaskTypeLabel('ablation', 'zh-CN')).toBe('消融实验');
  });

  it('scaffoldFolderName exists but workspaceRoot missing -> section status is Missing and summary shows workspace root missing', () => {
    const missingWorkspaceRecipe: Recipe = {
      ...mockRecipe,
      workspace: {
        workDir: '',
        folderName: 'bootstrap-project',
      },
    };

    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={missingWorkspaceRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('autoresearch.recipe.workspaceRootMissing');
    
    const workspaceCard = container.querySelector('.rounded-2xl:nth-of-type(4)');
    expect(workspaceCard?.textContent).toContain('autoresearch.recipe.missing');
  });

  it('separates required and optional readiness status, and missing workspace disables Start and shows 2/3 required count', () => {
    const missingWorkspaceRecipe: Recipe = {
      ...mockRecipe,
      workspace: {
        workDir: '',
        folderName: 'my-project',
      },
    };

    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={missingWorkspaceRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('2 / 3');
    expect(text).toContain('autoresearch.recipe.requiredProgress');

    const startBtn = container.querySelector('button[disabled]') as HTMLButtonElement;
    expect(startBtn).toBeTruthy();
    expect(startBtn.textContent).toContain('autoresearch.recipe.startScaffolding');
  });

  it('detects template placeholder goal as placeholder (not completed) and disables Start button', () => {
    const placeholderRecipe: Recipe = {
      ...mockRecipe,
      researchGoal: {
        goalText: 'I want to start an AutoResearch task. Please guide me through setting up goals, papers, baselines, and workspace scaffolding.',
        taskType: 'reproduce_paper',
        source: 'template',
      },
    };

    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={placeholderRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('autoresearch.recipe.templateDefault');
    expect(text).toContain('2 / 3');

    const startBtn = container.querySelector('button[disabled]') as HTMLButtonElement;
    expect(startBtn).toBeTruthy();
  });

  it('clicking missing workspace action button expands Workspace section', () => {
    const missingWorkspaceRecipe: Recipe = {
      ...mockRecipe,
      workspace: {
        workDir: '',
        folderName: 'my-project',
      },
    };

    act(() => {
      root.render(
        <BootstrapRecipeBuilder
          recipe={missingWorkspaceRecipe}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );
    });

    expect(container.innerHTML).not.toContain('autoresearch.recipe.rootDir');

    const warningActionBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.includes('autoresearch.recipe.action.selectWorkspace')
    );
    expect(warningActionBtn).toBeTruthy();

    act(() => {
      warningActionBtn!.click();
    });

    expect(container.innerHTML).toContain('autoresearch.recipe.rootDir');
  });
});
