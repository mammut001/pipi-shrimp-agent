/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  BootstrapChatStartedPanels,
  BootstrapConfirmationPanel,
  BootstrapDeveloperConsole,
  BootstrapErrorPanel,
  BootstrapHandoffBanner,
  BootstrapReadySummaryCard,
} from '../BootstrapChatStartedPanels';
import type { AutoResearchBootstrapResult } from '@/services/autoresearch/bootstrap/types';
import type { AutoResearchLifecycleLock } from '@/services/autoresearch/runLock';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
  convertOldLanguageCode: (code: string) => (code === 'en' ? 'en-US' : 'zh-CN'),
}));

function createMockReadyResult(status: AutoResearchBootstrapResult['status'] = 'ready'): AutoResearchBootstrapResult {
  return {
    status,
    createdAt: '2026-09-23T01:00:00.000Z',
    warnings: [],
    unresolvedQuestions: ['Need clarification on epochs?'],
    plan: {
      researchGoal: 'Classification experiment',
      successCriteria: 'Val accuracy > 0.92',
      primaryMetric: 'val_acc',
      direction: 'higher',
      baselines: [],
      scaffold: {
        workDir: '/experiments/model-run',
        files: [],
      },
    },
  };
}

describe('BootstrapChatStartedPanels', () => {
  const idleLock: AutoResearchLifecycleLock = {
    locked: false,
    loopState: 'idle',
    activeRun: null,
    reason: null,
  };

  const activeLock: AutoResearchLifecycleLock = {
    locked: true,
    loopState: 'running',
    activeRun: null,
    reason: 'AutoResearch is still running.',
  };

  beforeEach(() => {
    cleanup();
  });

  describe('BootstrapReadySummaryCard', () => {
    it('renders ready summary and start button (bootstrap-start-handoff)', () => {
      const readyResult = createMockReadyResult('ready');
      const onStartHandoff = jest.fn();
      const onChangeIterations = jest.fn();

      render(
        <BootstrapReadySummaryCard
          readyResult={readyResult}
          handoffSummary={null}
          iterations={25}
          onChangeIterations={onChangeIterations}
          lifecycleLock={idleLock}
          onStartHandoff={onStartHandoff}
        />,
      );

      const startButton = screen.getByTestId('bootstrap-start-handoff');
      expect(startButton).toBeInTheDocument();
      expect(screen.queryByTestId('bootstrap-handoff-lock-hint')).toBeNull();

      fireEvent.click(startButton);
      expect(onStartHandoff).toHaveBeenCalledWith(readyResult, 25);
    });

    it('renders lock hint when lifecycle is locked (bootstrap-handoff-lock-hint)', () => {
      const readyResult = createMockReadyResult('ready');
      render(
        <BootstrapReadySummaryCard
          readyResult={readyResult}
          handoffSummary={null}
          iterations={10}
          onChangeIterations={jest.fn()}
          lifecycleLock={activeLock}
          onStartHandoff={jest.fn()}
        />,
      );

      expect(screen.getByTestId('bootstrap-start-handoff')).toBeInTheDocument();
      expect(screen.getByTestId('bootstrap-handoff-lock-hint')).toBeInTheDocument();
      expect(screen.getByTestId('bootstrap-handoff-lock-hint').textContent).toContain('AutoResearch is still running');
    });

    it('returns null when result is not ready or handoff has completed', () => {
      const { container, rerender } = render(
        <BootstrapReadySummaryCard
          readyResult={createMockReadyResult('needs_user_confirmation')}
          handoffSummary={null}
          iterations={10}
          onChangeIterations={jest.fn()}
          lifecycleLock={idleLock}
          onStartHandoff={jest.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();

      rerender(
        <BootstrapReadySummaryCard
          readyResult={createMockReadyResult('ready')}
          handoffSummary="val_acc · /experiments/model-run"
          iterations={10}
          onChangeIterations={jest.fn()}
          lifecycleLock={idleLock}
          onStartHandoff={jest.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('BootstrapConfirmationPanel', () => {
    it('renders confirmation panel and handles back to recipe (bootstrap-confirmation-panel)', () => {
      const onBackToRecipe = jest.fn();
      render(
        <BootstrapConfirmationPanel
          readyResult={createMockReadyResult('needs_user_confirmation')}
          handoffSummary={null}
          onBackToRecipe={onBackToRecipe}
        />,
      );

      const panel = screen.getByTestId('bootstrap-confirmation-panel');
      expect(panel).toBeInTheDocument();
      expect(panel.textContent).toContain('Need clarification on epochs?');

      const backButton = screen.getByText('autoresearch.bootstrap.backToRecipe');
      fireEvent.click(backButton);
      expect(onBackToRecipe).toHaveBeenCalledTimes(1);
    });

    it('returns null when result is not needs_user_confirmation', () => {
      const { container } = render(
        <BootstrapConfirmationPanel
          readyResult={createMockReadyResult('ready')}
          handoffSummary={null}
          onBackToRecipe={jest.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('BootstrapHandoffBanner', () => {
    it('renders handoff summary text when present', () => {
      render(<BootstrapHandoffBanner handoffSummary="loss · ~/project-1" />);
      expect(screen.getByText(/loss · ~\/project-1/)).toBeInTheDocument();
    });

    it('returns null when handoffSummary is null', () => {
      const { container } = render(<BootstrapHandoffBanner handoffSummary={null} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('BootstrapErrorPanel', () => {
    it('renders error panel with retry and back buttons when missingFinalize (retry-bootstrap, back-to-recipe-from-error)', () => {
      const onRetryBootstrap = jest.fn();
      const onBackToRecipe = jest.fn();

      render(
        <BootstrapErrorPanel
          error="Bootstrap agent did not invoke bootstrap_finalize."
          missingFinalize={true}
          isStreaming={false}
          onRetryBootstrap={onRetryBootstrap}
          onBackToRecipe={onBackToRecipe}
        />,
      );

      expect(screen.getByTestId('bootstrap-error-panel')).toBeInTheDocument();
      const retryBtn = screen.getByTestId('retry-bootstrap');
      const backBtn = screen.getByTestId('back-to-recipe-from-error');

      fireEvent.click(retryBtn);
      expect(onRetryBootstrap).toHaveBeenCalledTimes(1);

      fireEvent.click(backBtn);
      expect(onBackToRecipe).toHaveBeenCalledTimes(1);
    });

    it('hides retry actions when isStreaming is true', () => {
      render(
        <BootstrapErrorPanel
          error="Interrupted"
          missingFinalize={true}
          isStreaming={true}
          onRetryBootstrap={jest.fn()}
          onBackToRecipe={jest.fn()}
        />,
      );

      expect(screen.getByTestId('bootstrap-error-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('retry-bootstrap')).toBeNull();
      expect(screen.queryByTestId('back-to-recipe-from-error')).toBeNull();
    });
  });

  describe('BootstrapDeveloperConsole', () => {
    it('renders console logs and controls', () => {
      const onStopBootstrap = jest.fn();
      const onBackToRecipe = jest.fn();

      const { rerender } = render(
        <BootstrapDeveloperConsole
          isStreaming={true}
          stoppedByUser={false}
          error={null}
          readyResult={null}
          agentLogs="Line 1\nLine 2"
          setupPhaseInput={{
            bootstrapKind: 'conversational',
            bootstrapStreaming: true,
            bootstrapReady: false,
            startingRun: false,
            error: null,
          }}
          onStopBootstrap={onStopBootstrap}
          onBackToRecipe={onBackToRecipe}
        />,
      );

      expect(screen.getByText(/Line 1/)).toBeInTheDocument();
      const stopButton = screen.getByText('autoresearch.bootstrap.stop');
      fireEvent.click(stopButton);
      expect(onStopBootstrap).toHaveBeenCalledTimes(1);

      rerender(
        <BootstrapDeveloperConsole
          isStreaming={false}
          stoppedByUser={false}
          error={null}
          readyResult={null}
          agentLogs="Finished"
          setupPhaseInput={{
            bootstrapKind: 'conversational',
            bootstrapStreaming: false,
            bootstrapReady: false,
            startingRun: false,
            error: null,
          }}
          onStopBootstrap={onStopBootstrap}
          onBackToRecipe={onBackToRecipe}
        />,
      );

      const backButton = screen.getByText(/autoresearch.bootstrap.backToRecipe/);
      fireEvent.click(backButton);
      expect(onBackToRecipe).toHaveBeenCalledTimes(1);
    });
  });

  describe('BootstrapChatStartedPanels (Composite)', () => {
    it('smoke renders all testids across started panels simultaneously', () => {
      render(
        <BootstrapChatStartedPanels
          readyResult={createMockReadyResult('needs_user_confirmation')}
          handoffSummary={null}
          iterations={50}
          onChangeIterations={jest.fn()}
          lifecycleLock={activeLock}
          onStartHandoff={jest.fn()}
          onBackToRecipe={jest.fn()}
          error="Failed to finalize: missing bootstrap_finalize"
          missingFinalize={true}
          isStreaming={false}
          onRetryBootstrap={jest.fn()}
          stoppedByUser={false}
          agentLogs="Bootstrapping..."
          setupPhaseInput={{
            bootstrapKind: 'conversational',
            bootstrapStreaming: false,
            bootstrapReady: false,
            startingRun: false,
            error: 'Failed to finalize: missing bootstrap_finalize',
          }}
          onStopBootstrap={jest.fn()}
        />,
      );

      expect(screen.getByTestId('bootstrap-confirmation-panel')).toBeInTheDocument();
      expect(screen.getByTestId('bootstrap-error-panel')).toBeInTheDocument();
      expect(screen.getByTestId('retry-bootstrap')).toBeInTheDocument();
      expect(screen.getByTestId('back-to-recipe-from-error')).toBeInTheDocument();
      expect(screen.getByText('autoresearch.bootstrap.developerConsole')).toBeInTheDocument();
    });
  });
});
