import React, { useRef, useCallback } from 'react';
import { ExecutionModeDropdown } from './ExecutionModeDropdown';
import { ExecutionModeDropdownErrorBoundary } from './ExecutionModeDropdownErrorBoundary';
import { SessionGoalPopover } from './SessionGoalPopover';
import { MCPChatButton, MCPDropdown } from '@/components/mcp';
import { t } from '@/i18n';
import type { ExecutionModeId } from '@/services/executionMode';
import {
  COMPOSER_STOP_BUSY_HINT_TEST_ID,
  COMPOSER_SEND_CONTROL_TEST_ID,
  COMPOSER_STOP_CONTROL_TEST_ID,
  type ComposerSendStopAffordance,
} from '@/store/chat/chatSelectors';

export interface ComposerActionToolbarProps {
  /** Visual density */
  density?: 'default' | 'compact';
  /** Optional container class name override */
  actionRowClassName?: string;
  /** Optional button class name override */
  actionButtonClassName?: string;
  /** Optional icon class name override */
  actionIconClassName?: string;

  // File selection
  /** Ref to the file input element */
  fileInputRef?: React.RefObject<HTMLInputElement>;
  /** Callback when files are selected */
  onFileSelection: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  /** Optional click handler for the add-image button (defaults to triggering file input click) */
  onAddImageClick?: () => void;

  // Execution mode
  /** Currently selected execution mode ID */
  selectedExecutionModeId: ExecutionModeId;
  /** Callback to change execution mode */
  onSelectExecutionMode: (modeId: ExecutionModeId) => void;

  // Session goal popover wiring
  /** Whether the goal popover is open */
  goalPopoverOpen: boolean;
  /** Callback when goal popover open state changes */
  onGoalPopoverOpenChange: (open: boolean) => void;
  /** Currently bound session goal */
  sessionGoal: string;
  /** Draft text in the goal input */
  goalInputText: string;
  /** Callback when goal draft text changes */
  onGoalInputChange: (text: string) => void;
  /** Whether an active session exists */
  hasSession: boolean;
  /** Callback to clear the session goal */
  onClearGoal: () => void;
  /** Callback to save the session goal */
  onSaveGoal: (trimmed: string) => void;

  // MCP / settings
  /** Callback to open settings from MCP dropdown */
  onOpenSettings?: () => void;

  // Open folder
  /** Callback to reveal folder in Finder */
  onOpenFolder: () => void | Promise<void>;

  // Send / Stop controls
  /** Whether the stop button should be shown instead of send */
  showStopControl: boolean;
  /** Affordance data for send/stop presentation */
  sendStopAffordance?: ComposerSendStopAffordance;
  /** Whether the controls are disabled (e.g. while submitting or streaming) */
  isDisabled: boolean;
  /** Whether there is valid content to send */
  canSend: boolean;
  /** Callback to send message */
  onSend: () => void | Promise<void>;
  /** Callback to stop generation */
  onStop: () => void | Promise<void>;
}

/**
 * ComposerActionToolbar - Bottom action row for chat input:
 * execution mode dropdown, goal popover, MCP controls, image upload,
 * open-in-finder, and Send/Stop toggle button.
 */
export function ComposerActionToolbar({
  density = 'default',
  actionRowClassName,
  actionButtonClassName,
  actionIconClassName,
  fileInputRef,
  onFileSelection,
  onAddImageClick,
  selectedExecutionModeId,
  onSelectExecutionMode,
  goalPopoverOpen,
  onGoalPopoverOpenChange,
  sessionGoal,
  goalInputText,
  onGoalInputChange,
  hasSession,
  onClearGoal,
  onSaveGoal,
  onOpenSettings,
  onOpenFolder,
  showStopControl,
  sendStopAffordance,
  isDisabled,
  canSend,
  onSend,
  onStop,
}: ComposerActionToolbarProps) {
  const internalFileInputRef = useRef<HTMLInputElement>(null);
  const resolvedFileInputRef = fileInputRef ?? internalFileInputRef;

  const isCompact = density === 'compact';
  const rowClass = actionRowClassName ?? (
    isCompact
      ? 'flex items-center gap-0.5 pr-1 pb-1.5 flex-wrap'
      : 'flex items-center gap-1 pr-2 pb-2 flex-wrap'
  );
  const buttonClass = actionButtonClassName ?? (
    isCompact
      ? 'p-1.5 rounded-md'
      : 'p-2 rounded-lg'
  );
  const iconClass = actionIconClassName ?? (isCompact ? 'h-4 w-4' : 'h-5 w-5');

  const resolvedAffordance: ComposerSendStopAffordance = sendStopAffordance ?? {
    showStop: showStopControl,
    primaryAction: showStopControl ? 'stop' : 'send',
    sendPrimary: !showStopControl,
    stopReason: showStopControl ? 'streaming' : null,
    stopTitleKey: 'chat.stop',
    sendTitleKey: 'chat.send',
    stopTestId: COMPOSER_STOP_CONTROL_TEST_ID,
    sendTestId: COMPOSER_SEND_CONTROL_TEST_ID,
    busyHintKey: null,
  };

  const handleImageButtonClick = useCallback(() => {
    if (onAddImageClick) {
      onAddImageClick();
    } else {
      resolvedFileInputRef.current?.click();
    }
  }, [onAddImageClick, resolvedFileInputRef]);

  return (
    <div className={rowClass} data-testid="composer-action-toolbar">
      <input
        ref={resolvedFileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="composer-file-input"
        onChange={(e) => { void onFileSelection(e); }}
      />

      {/* Execution mode dropdown */}
      <ExecutionModeDropdownErrorBoundary>
        <ExecutionModeDropdown
          selectedModeId={selectedExecutionModeId}
          onSelect={onSelectExecutionMode}
          disabled={isDisabled}
        />
      </ExecutionModeDropdownErrorBoundary>

      {/* Session goal popover */}
      <SessionGoalPopover
        open={goalPopoverOpen}
        onOpenChange={onGoalPopoverOpenChange}
        sessionGoal={sessionGoal}
        goalInputText={goalInputText}
        onGoalInputChange={onGoalInputChange}
        disabled={isDisabled}
        hasSession={hasSession}
        onClear={onClearGoal}
        onSave={onSaveGoal}
      />

      {/* MCP toggle button and dropdown */}
      <div className="relative">
        <MCPChatButton />
        <MCPDropdown
          onOpenSettings={onOpenSettings ?? (() => {})}
        />
      </div>

      {/* Add Image Button */}
      <button
        onClick={handleImageButtonClick}
        type="button"
        className={`${buttonClass} hover:bg-gray-200 text-gray-500 transition-colors`}
        title={t('chat.addImage')}
        aria-label={t('chat.addImage')}
        data-testid="composer-add-image-button"
      >
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {/* Open Folder Button */}
      <button
        onClick={() => { void onOpenFolder(); }}
        type="button"
        className={`${buttonClass} hover:bg-gray-200 text-gray-500 transition-colors`}
        title={t('chat.openChatFolder')}
        aria-label={t('chat.openChatFolder')}
        data-testid="composer-open-folder-button"
      >
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
      </button>

      {/* Busy hint when stop shown */}
      {showStopControl && resolvedAffordance.busyHintKey && (
        <span
          data-testid={COMPOSER_STOP_BUSY_HINT_TEST_ID}
          className="px-1 text-[10px] leading-snug text-gray-500 select-none"
          title={t(resolvedAffordance.busyHintKey)}
        >
          {t(resolvedAffordance.busyHintKey)}
        </span>
      )}

      {/* Send/Stop Button */}
      {showStopControl ? (
        <button
          onClick={() => { void onStop(); }}
          type="button"
          data-testid={resolvedAffordance.stopTestId}
          aria-label={t(resolvedAffordance.stopTitleKey)}
          title={t(resolvedAffordance.stopTitleKey)}
          className={`${buttonClass} bg-red-600 hover:bg-red-700 text-white transition-colors`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={iconClass}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      ) : (
        <button
          onClick={() => { void onSend(); }}
          type="button"
          disabled={isDisabled || !canSend}
          data-testid={resolvedAffordance.sendTestId}
          aria-label={t('chat.send')}
          title={t('chat.send')}
          className={`${buttonClass} bg-gray-900 hover:bg-gray-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={iconClass}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </button>
      )}
    </div>
  );
}
