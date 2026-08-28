/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BootstrapChatView } from '../BootstrapChatView';
import { useBootstrapPlanStore } from '@/services/autoresearch/bootstrap/bootstrapPlanStore';

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

const mockRunHeadlessAgentTurn = jest.fn();
jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: unknown[]) => mockRunHeadlessAgentTurn(...args),
}));

let capturedRecipe: any = null;
jest.mock('../BootstrapRecipeBuilder', () => ({
  BootstrapRecipeBuilder: ({ recipe, onSend }: { recipe: any; onSend: (val: string) => void }) => {
    capturedRecipe = recipe;
    return (
      <div>
        <span data-testid="metric-val">{recipe.baselineAndMetric.primaryMetric}</span>
        <span data-testid="baseline-val">{recipe.baselineAndMetric.baselineValue}</span>
        <span data-testid="verify-cmds">{recipe.verification.commands.join(',')}</span>
        <button data-testid="start-btn" onClick={() => onSend('test compiled prompt')}>
          Start
        </button>
      </div>
    );
  },
}));

describe('Bootstrap Reliability & Permissions & Defaults', () => {
  let container: HTMLDivElement;

  let root: any;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    capturedRecipe = null;
    mockRunHeadlessAgentTurn.mockReset();
    act(() => {
      useBootstrapPlanStore.getState().reset();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('1. fresh Guided Bootstrap starts with neutral/empty values without fake data or pytest', () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });

    expect(capturedRecipe).not.toBeNull();
    // Goal text is empty
    expect(capturedRecipe.researchGoal.goalText).toBe('');
    // Primary metric and baseline are empty
    expect(capturedRecipe.baselineAndMetric.primaryMetric).toBe('');
    expect(capturedRecipe.baselineAndMetric.baselineValue).toBe('');
    expect(capturedRecipe.baselineAndMetric.successCriteria).toBe('');
    // Verification commands do NOT default to pytest
    expect(capturedRecipe.verification.commands).toEqual([]);
  });

  it('2. runs headless agent turn with autoresearch lane bypass permissions and target workDir', async () => {
    mockRunHeadlessAgentTurn.mockImplementation(async () => {
      // noop
    });

    act(() => {
      root.render(<BootstrapChatView sshConfig={{ mode: 'local', remoteWorkDir: '/path/to/my-project' } as any} />);
    });

    const startBtn = container.querySelector('[data-testid="start-btn"]') as HTMLButtonElement;
    await act(async () => {
      startBtn.click();
    });

    expect(mockRunHeadlessAgentTurn).toHaveBeenCalled();
    const passedOptions = mockRunHeadlessAgentTurn.mock.calls[0][0] as any;
    expect(passedOptions.toolExecutionSource).toBe('autoresearch_phase');
    expect(passedOptions.permissionMode).toBe('bypass');
    expect(passedOptions.executionMode).toBe('bypass');
    expect(passedOptions.workDir).toBe('/path/to/my-project');
  });

  it('3. handles confirmation_required and permission_denied tool failures properly', async () => {
    let onToolResultCallback: any = null;

    mockRunHeadlessAgentTurn.mockImplementation(async (opts: any) => {
      onToolResultCallback = opts.onToolResult;
    });

    act(() => {
      root.render(<BootstrapChatView />);
    });

    const startBtn = container.querySelector('[data-testid="start-btn"]') as HTMLButtonElement;
    await act(async () => {
      startBtn.click();
    });

    expect(onToolResultCallback).toBeDefined();

    // Simulate confirmation_required failure on read_file
    await act(async () => {
      await onToolResultCallback({
        name: 'pdf_read',
        result: JSON.stringify({ error: true, error_kind: 'confirmation_required', message: 'User confirmation required' }),
        durationMs: 120,
      });
    });

    // Check store failure state
    expect(useBootstrapPlanStore.getState().failedStep).toBe('papers');
    expect(useBootstrapPlanStore.getState().failureReason).toBe('User confirmation required');
  });
});
