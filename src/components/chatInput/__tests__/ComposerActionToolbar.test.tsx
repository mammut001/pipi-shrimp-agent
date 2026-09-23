/**
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComposerActionToolbar } from '../ComposerActionToolbar';
import {
  COMPOSER_SEND_CONTROL_TEST_ID,
  COMPOSER_STOP_CONTROL_TEST_ID,
  COMPOSER_STOP_BUSY_HINT_TEST_ID,
} from '@/store/chat/chatSelectors';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (code: string) => code,
}));

jest.mock('@/components/mcp', () => ({
  MCPChatButton: () => <div data-testid="mock-mcp-chat-button" />,
  MCPDropdown: ({ onOpenSettings }: { onOpenSettings?: () => void }) => (
    <button data-testid="mock-mcp-dropdown" onClick={onOpenSettings}>
      mcp-dropdown
    </button>
  ),
}));

jest.mock('../ExecutionModeDropdown', () => ({
  ExecutionModeDropdown: () => <div data-testid="mock-execution-mode-dropdown" />,
}));

jest.mock('../ExecutionModeDropdownErrorBoundary', () => ({
  ExecutionModeDropdownErrorBoundary: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../SessionGoalPopover', () => ({
  SessionGoalPopover: () => <div data-testid="mock-session-goal-popover" />,
}));

describe('ComposerActionToolbar', () => {
  const onFileSelection = jest.fn();
  const onAddImageClick = jest.fn();
  const onSelectExecutionMode = jest.fn();
  const onGoalPopoverOpenChange = jest.fn();
  const onGoalInputChange = jest.fn();
  const onClearGoal = jest.fn();
  const onSaveGoal = jest.fn();
  const onOpenFolder = jest.fn();
  const onOpenSettings = jest.fn();
  const onSend = jest.fn();
  const onStop = jest.fn();

  const defaultProps = {
    onFileSelection,
    onAddImageClick,
    selectedExecutionModeId: 'ask' as const,
    onSelectExecutionMode,
    goalPopoverOpen: false,
    onGoalPopoverOpenChange,
    sessionGoal: '',
    goalInputText: '',
    onGoalInputChange,
    hasSession: true,
    onClearGoal,
    onSaveGoal,
    onOpenSettings,
    onOpenFolder,
    showStopControl: false,
    isDisabled: false,
    canSend: true,
    onSend,
    onStop,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('send vs stop exclusivity', () => {
    it('renders only the send control when showStopControl is false', () => {
      render(<ComposerActionToolbar {...defaultProps} showStopControl={false} />);

      expect(screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeNull();
    });

    it('renders only the stop control when showStopControl is true', () => {
      render(<ComposerActionToolbar {...defaultProps} showStopControl={true} />);

      expect(screen.getByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeNull();
    });

    it('calls onStop when stop control is clicked', () => {
      render(<ComposerActionToolbar {...defaultProps} showStopControl={true} />);

      fireEvent.click(screen.getByTestId(COMPOSER_STOP_CONTROL_TEST_ID));
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('send disabled states', () => {
    it('disables send button when canSend is false (empty input)', () => {
      render(<ComposerActionToolbar {...defaultProps} canSend={false} />);

      const sendBtn = screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);

      fireEvent.click(sendBtn);
      expect(onSend).not.toHaveBeenCalled();
    });

    it('disables send button when isDisabled is true even if canSend is true', () => {
      render(<ComposerActionToolbar {...defaultProps} canSend={true} isDisabled={true} />);

      const sendBtn = screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);

      fireEvent.click(sendBtn);
      expect(onSend).not.toHaveBeenCalled();
    });

    it('enables send button and calls onSend when canSend is true and not disabled', () => {
      render(<ComposerActionToolbar {...defaultProps} canSend={true} isDisabled={false} />);

      const sendBtn = screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(false);

      fireEvent.click(sendBtn);
      expect(onSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('file, open-folder, and image buttons', () => {
    it('calls onOpenFolder when open-folder button is clicked', () => {
      render(<ComposerActionToolbar {...defaultProps} />);

      fireEvent.click(screen.getByTestId('composer-open-folder-button'));
      expect(onOpenFolder).toHaveBeenCalledTimes(1);
    });

    it('calls onAddImageClick when add-image button is clicked', () => {
      render(<ComposerActionToolbar {...defaultProps} />);

      fireEvent.click(screen.getByTestId('composer-add-image-button'));
      expect(onAddImageClick).toHaveBeenCalledTimes(1);
    });

    it('triggers onFileSelection when file input changes', () => {
      render(<ComposerActionToolbar {...defaultProps} />);

      const fileInput = screen.getByTestId('composer-file-input');
      fireEvent.change(fileInput, { target: { files: [] } });
      expect(onFileSelection).toHaveBeenCalledTimes(1);
    });

    it('triggers onOpenSettings when MCP settings is clicked', () => {
      render(<ComposerActionToolbar {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mock-mcp-dropdown'));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('busy hint when showStop + busyHintKey', () => {
    it('renders busy hint when showStop is true and busyHintKey is provided', () => {
      render(
        <ComposerActionToolbar
          {...defaultProps}
          showStopControl={true}
          sendStopAffordance={{
            showStop: true,
            primaryAction: 'stop',
            sendPrimary: false,
            stopReason: 'streaming',
            stopTitleKey: 'chat.stopStreaming',
            sendTitleKey: 'chat.send',
            stopTestId: COMPOSER_STOP_CONTROL_TEST_ID,
            sendTestId: COMPOSER_SEND_CONTROL_TEST_ID,
            busyHintKey: 'chat.stopBusyHint',
          }}
        />,
      );

      const hint = screen.getByTestId(COMPOSER_STOP_BUSY_HINT_TEST_ID);
      expect(hint).toBeTruthy();
      expect(hint.textContent).toBe('chat.stopBusyHint');
    });

    it('does not render busy hint when showStop is true but busyHintKey is null', () => {
      render(
        <ComposerActionToolbar
          {...defaultProps}
          showStopControl={true}
          sendStopAffordance={{
            showStop: true,
            primaryAction: 'stop',
            sendPrimary: false,
            stopReason: 'streaming',
            stopTitleKey: 'chat.stopStreaming',
            sendTitleKey: 'chat.send',
            stopTestId: COMPOSER_STOP_CONTROL_TEST_ID,
            sendTestId: COMPOSER_SEND_CONTROL_TEST_ID,
            busyHintKey: null,
          }}
        />,
      );

      expect(screen.queryByTestId(COMPOSER_STOP_BUSY_HINT_TEST_ID)).toBeNull();
    });

    it('does not render busy hint when showStop is false even if busyHintKey is provided', () => {
      render(
        <ComposerActionToolbar
          {...defaultProps}
          showStopControl={false}
          sendStopAffordance={{
            showStop: false,
            primaryAction: 'send',
            sendPrimary: true,
            stopReason: null,
            stopTitleKey: 'chat.stop',
            sendTitleKey: 'chat.send',
            stopTestId: COMPOSER_STOP_CONTROL_TEST_ID,
            sendTestId: COMPOSER_SEND_CONTROL_TEST_ID,
            busyHintKey: 'chat.stopBusyHint',
          }}
        />,
      );

      expect(screen.queryByTestId(COMPOSER_STOP_BUSY_HINT_TEST_ID)).toBeNull();
    });
  });
});
