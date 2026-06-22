/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { createRoot, type Root } from 'react-dom/client';
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

const mockStartAutoResearchRun = jest.fn();
jest.mock('@/services/autoresearch/setupFlow', () => ({
  startAutoResearchRun: (...args: any[]) => mockStartAutoResearchRun(...args),
  logAutoResearchSetupFailure: jest.fn(() => 'failed'),
}));

jest.mock('@/components/chatInput/BlockComposer', () => ({
  BlockComposer: ({ onSend, disabled }: { onSend: (val: string) => void; disabled?: boolean }) => (
    <div>
      <span>chat.blockComposerTitle</span>
      <button data-testid="send-task" disabled={disabled} onClick={() => onSend('compiled prompt')}>
        Send Task
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('renders presets and block composer title initially', () => {
    act(() => {
      root.render(<BootstrapChatView />);
    });
    const html = container.innerHTML;
    expect(html).toContain('autoresearch.bootstrap.title');
    expect(html).toContain('chat.blockComposerTitle');
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
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(container.textContent).toContain('Bootstrap agent finished but did not produce a bootstrap_finalize result.');
    expect(container.textContent).toContain('Failed');
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
});
