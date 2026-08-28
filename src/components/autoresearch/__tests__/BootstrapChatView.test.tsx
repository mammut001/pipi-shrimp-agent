/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BootstrapChatView } from '../BootstrapChatView';
import { useBootstrapPlanStore } from '@/services/autoresearch/bootstrap/bootstrapPlanStore';
import { clearPersistedBootstrapSession } from '@/services/autoresearch/bootstrap/bootstrapSessionPersist';

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

const mockStartAutoResearchRun = jest.fn();
jest.mock('@/services/autoresearch/setupFlow', () => ({
  startAutoResearchRun: (...args: any[]) => mockStartAutoResearchRun(...args),
  logAutoResearchSetupFailure: jest.fn(() => 'failed'),
}));

jest.mock('../BootstrapRecipeBuilder', () => ({
  BootstrapRecipeBuilder: ({ onChange, recipe, onSend, disabled }: { onChange: (r: any) => void; recipe: any; onSend: (val: string) => void; disabled?: boolean }) => (
    <div>
      <span>Configure Task Recipe</span>
      <button data-testid="dirty-task" onClick={() => onChange({ ...recipe, researchGoal: { ...recipe.researchGoal, goalText: 'dirty' } })}>
        Make Dirty
      </button>
      <button data-testid="send-task" disabled={disabled} onClick={() => onSend('compiled prompt')}>
        Start Bootstrap Setup
      </button>
    </div>
  ),
}));

const mockRunHeadlessAgentTurn = jest.fn();
jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: unknown[]) => mockRunHeadlessAgentTurn(...args),
}));

describe('BootstrapChatView (Guided UI)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockStartAutoResearchRun.mockReset();
    mockRunHeadlessAgentTurn.mockReset();
    mockRunHeadlessAgentTurn.mockImplementation(async (input: { signal?: AbortSignal }) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (input.signal?.aborted) {
        throw new DOMException('Headless agent turn aborted', 'AbortError');
      }
    });
    useBootstrapPlanStore.getState().reset();
    clearPersistedBootstrapSession();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('renders presets and recipe builder title initially', () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });
    const html = container.innerHTML;
    expect(html).toContain('autoresearch.bootstrap.title');
    expect(html).toContain('Configure Task Recipe');
  });

  it('does not auto-start run when readyResult is loaded', async () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });

    // Start bootstrap to transition hasStarted to true
    await act(async () => {
      const btn = container.querySelector('[data-testid="send-task"]') as HTMLButtonElement;
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Simulate readyResult loaded in store
    act(() => {
      useBootstrapPlanStore.getState().setReadyResult({
        status: 'ready',
        createdAt: 'test-time-1',
        warnings: [],
        plan: {
          researchGoal: 'Goal text',
          successCriteria: 'Criteria text',
          primaryMetric: 'cv_accuracy',
          baselines: [],
          scaffold: {
            workDir: '/path/to/workdir',
            files: [],
          },
        },
      });
    });

    // Verify it renders the ready result title and iterations input
    const html = container.innerHTML;
    expect(html).toContain('autoresearch.bootstrap.readyTitle');
    
    // Auto start run should NOT be triggered
    expect(mockStartAutoResearchRun).not.toHaveBeenCalled();
  });

  it('shows warning when headless turn completes without bootstrap_finalize', async () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });

    await act(async () => {
      const btn = container.querySelector('[data-testid="send-task"]') as HTMLButtonElement;
      btn.click();
      // First turn + automatic finalize-nudge turn
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // End-of-turn nudge must run when first turn omits finalize
    expect(mockRunHeadlessAgentTurn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const nudgeCall = mockRunHeadlessAgentTurn.mock.calls
      .map((call) => (call as any[])[0])
      .find((input) => String(input?.initialMessages?.[0]?.content ?? '').includes('bootstrap_finalize now'));
    expect(nudgeCall).toBeTruthy();
    expect(nudgeCall.systemPrompt).toMatch(/HARD REQUIREMENT: bootstrap_finalize/);
    expect(nudgeCall.initialMessages?.[0]?.content).toMatch(/bootstrap_finalize/);

    expect(container.textContent).toContain('Bootstrap agent finished but did not produce a bootstrap_finalize result.');
    expect(container.textContent).toContain('Failed');
    // Recovery path: not a dead-end — Retry + Back to Recipe are offered
    expect(container.querySelector('[data-testid="retry-bootstrap"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="back-to-recipe-from-error"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Retry bootstrap|Back to Recipe/i);
  });

  it('retry bootstrap re-invokes headless agent with the same compiled prompt', async () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });

    await act(async () => {
      const btn = container.querySelector('[data-testid="send-task"]') as HTMLButtonElement;
      btn.click();
      // first turn + finalize nudge
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // 2 calls: primary + finalize nudge (still missing finalize)
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(2);
    expect((mockRunHeadlessAgentTurn.mock.calls[0] as any[])[0]?.initialMessages?.[0]?.content).toBe('compiled prompt');

    await act(async () => {
      const retry = container.querySelector('[data-testid="retry-bootstrap"]') as HTMLButtonElement;
      expect(retry).toBeTruthy();
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // Retry starts another primary+nudge pair
    expect(mockRunHeadlessAgentTurn.mock.calls.length).toBeGreaterThanOrEqual(4);
    const retryPrimary = (mockRunHeadlessAgentTurn.mock.calls[2] as any[])[0]?.initialMessages?.[0]?.content;
    expect(retryPrimary).toBe('compiled prompt');
  });

  it('shows Bootstrapping phase chip while streaming', async () => {
    const resolvers: Array<() => void> = [];
    mockRunHeadlessAgentTurn.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    });

    act(() => {
      root.render(<BootstrapChatView />);
    });

    await act(async () => {
      const btn = container.querySelector('[data-testid="send-task"]') as HTMLButtonElement;
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const chip = container.querySelector('[data-testid="autoresearch-setup-phase-chip"]');
    expect(chip?.getAttribute('data-phase')).toBe('bootstrapping');
    expect(chip?.getAttribute('aria-label')).toBe('AutoResearch phase: Bootstrapping');

    await act(async () => {
      // Resolve all pending headless turns (primary + optional nudge)
      while (resolvers.length > 0) {
        resolvers.shift()?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  });

  it('shows Bootstrap ready phase chip when readyResult exists', async () => {
    mockRunHeadlessAgentTurn.mockImplementation(async () => {
      useBootstrapPlanStore.getState().setReadyResult({
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
        warnings: [],
        unresolvedQuestions: [],
        schemaVersion: 1,
        plan: {
          researchGoal: 'Goal text',
          successCriteria: 'Criteria text',
          primaryMetric: 'cv_accuracy',
          secondaryMetrics: [],
          papers: [],
          baselines: [{
            name: 'Baseline',
            task: 'classification',
            dataset: 'CIFAR10',
            reportedMetrics: [{ name: 'cv_accuracy', value: 0.9 }],
            method: { summary: 'Test baseline' },
            reproducibility: { hasOfficialCode: false },
          }],
          scaffold: {
            templateId: 'python-ml-baseline',
            workDir: '/path/to/workdir',
            language: 'python',
            entryCommand: 'python3 run_experiment.py',
            vars: { project_name: 'test' },
            files: [{ path: 'run_experiment.py', purpose: 'entrypoint' }],
          },
          gitInitialized: true,
          conversationalTemplateId: 'from-scratch',
        },
      });
    });

    act(() => {
      root.render(<BootstrapChatView />);
    });

    await act(async () => {
      const btn = container.querySelector('[data-testid="send-task"]') as HTMLButtonElement;
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const chip = container.querySelector('[data-testid="autoresearch-setup-phase-chip"]');
    expect(chip?.getAttribute('data-phase')).toBe('bootstrap_ready');
    expect(chip?.getAttribute('aria-label')).toBe('AutoResearch phase: Bootstrap ready');
  });

  it('shows Failed phase chip when error exists', async () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });

    await act(async () => {
      const btn = container.querySelector('[data-testid="send-task"]') as HTMLButtonElement;
      btn.click();
      // primary turn + finalize nudge (~50ms each in default mock)
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const chip = container.querySelector('[data-testid="autoresearch-setup-phase-chip"]');
    expect(chip?.getAttribute('data-phase')).toBe('failed');
    expect(chip?.getAttribute('aria-label')).toBe('AutoResearch phase: Failed');
  });

  it('shows Stop bootstrap while streaming and marks stopped', async () => {
    let resolveTurn: (() => void) | undefined;
    mockRunHeadlessAgentTurn.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveTurn = resolve;
      });
    });

    act(() => {
      root.render(<BootstrapChatView />);
    });

    await act(async () => {
      const btn = container.querySelector('[data-testid="send-task"]') as HTMLButtonElement;
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const stopButton = Array.from(container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('Stop bootstrap'));
    expect(stopButton).toBeTruthy();

    await act(async () => {
      stopButton!.click();
      resolveTurn?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Bootstrap stopped by user');
    expect(container.textContent).toContain('Stopped');
  });

  it('confirms reset on template change if recipe is dirty', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => false);

    act(() => {
      root.render(<BootstrapChatView />);
    });

    // Make recipe dirty
    act(() => {
      const btn = container.querySelector('[data-testid="dirty-task"]') as HTMLButtonElement;
      btn.click();
    });

    // Find a template button
    const templates = Array.from(container.querySelectorAll('button'));
    const templateBtn = templates.find((btn) => btn.textContent?.includes('autoresearch.bootstrap.card.scratch.title'));
    expect(templateBtn).toBeTruthy();

    act(() => {
      templateBtn!.click();
    });

    // Since confirmSpy returned false, recipe should remain dirty, and window.confirm was called
    expect(confirmSpy).toHaveBeenCalled();
    
    // Now mock confirm to return true
    confirmSpy.mockImplementation(() => true);
    act(() => {
      templateBtn!.click();
    });
    // Should confirm and successfully update
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    
    confirmSpy.mockRestore();
  });

  it('renders selected template bar and expands templates grid when clicking Change Template', async () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });

    // Grid cards should render initially
    expect(container.innerHTML).toContain('autoresearch.bootstrap.card.scratch.title');
    expect(container.innerHTML).not.toContain('autoresearch.recipe.changeTemplate');

    // Click From Scratch template
    const scratchBtn = Array.from(container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('autoresearch.bootstrap.card.scratch.title'));
    expect(scratchBtn).toBeTruthy();

    act(() => {
      scratchBtn!.click();
    });

    // Grid should compress and show the template selection bar
    expect(container.innerHTML).toContain('autoresearch.recipe.changeTemplate');
    expect(container.innerHTML).not.toContain('autoresearch.bootstrap.card.scratch.title');

    // Click Change Template
    const changeTemplateBtn = Array.from(container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('autoresearch.recipe.changeTemplate'));
    expect(changeTemplateBtn).toBeTruthy();

    act(() => {
      changeTemplateBtn!.click();
    });

    // Should expand the template grid again
    expect(container.innerHTML).toContain('autoresearch.bootstrap.card.scratch.title');
  });

  it('restores guided Ready after remount so the user does not refill the recipe', async () => {
    const { persistBootstrapSession } = await import('@/services/autoresearch/bootstrap/bootstrapSessionPersist');
    persistBootstrapSession({
      version: 1,
      recipe: {
        researchGoal: {
          goalText: 'Reproduce digits baseline',
          taskType: 'reproduce_paper',
          source: 'user',
        },
        references: {},
        baselineAndMetric: {
          primaryMetric: 'cv_accuracy',
          direction: 'higher',
          baselineValue: '0.85',
          successCriteria: 'Match or exceed the target baseline metric.',
        },
        workspace: {
          workDir: '/tmp/digits',
          folderName: 'digits',
        },
        verification: { commands: ['pytest'] },
        outputContract: {
          includeMetrics: true,
          includeArtifacts: true,
          includeCommandsRun: true,
          includeFailureReason: true,
          includeRemainingRisks: true,
        },
      },
      recipeDirty: true,
      selectedTemplateId: 'reproduce-paper',
      templatesExpanded: false,
      hasStarted: true,
      readyResult: {
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
        warnings: [],
        unresolvedQuestions: [],
        schemaVersion: 1,
        plan: {
          researchGoal: 'Reproduce digits baseline',
          successCriteria: 'Match or exceed the target baseline metric.',
          primaryMetric: 'cv_accuracy',
          secondaryMetrics: [],
          papers: [],
          baselines: [{
            name: 'Baseline',
            task: 'classification',
            dataset: 'digits',
            reportedMetrics: [{ name: 'cv_accuracy', value: 0.9 }],
            method: { summary: 'Test' },
            reproducibility: { hasOfficialCode: false },
          }],
          scaffold: {
            templateId: 'python-ml-baseline',
            workDir: '/tmp/digits',
            language: 'python',
            entryCommand: 'python3 run_experiment.py',
            vars: { project_name: 'digits' },
            files: [{ path: 'train.py', purpose: 'train' }],
          },
          gitInitialized: true,
          conversationalTemplateId: 'reproduce-paper',
        },
      },
      currentStep: 'ready',
      observedTools: ['bootstrap_finalize'],
      warnings: [],
      iterations: 3,
      agentLogs: '[SYSTEM] restored\n',
      handoffSummary: null,
      lastCompiledPrompt: 'compiled prompt',
      missingFinalize: false,
      error: null,
    });

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    act(() => {
      root.render(<BootstrapChatView />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.innerHTML).toContain('autoresearch.bootstrap.readyTitle');
    expect(container.innerHTML).toContain('cv_accuracy');
    expect(mockStartAutoResearchRun).not.toHaveBeenCalled();
  });
});
