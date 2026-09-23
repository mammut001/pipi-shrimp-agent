import React from 'react';
import { SessionFolderChip } from './SessionFolderChip';
import { t } from '@/i18n';

// Check if running inside Tauri
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

export interface SessionFolderBarProps {
  /** The currently active session, or null if no session is open */
  currentSession: { id: string } | null;
  /** Current project directory path, if bound */
  projectDir?: string | null;
  /** Current PiPi output directory path, if bound */
  pipiOutputDir?: string | null;
  /** Which folder kind is currently performing a bind/clear operation, if any */
  isBindingFolder?: 'project' | 'output' | null;
  /** Explicit binding state for the project folder */
  isBindingProject?: boolean;
  /** Explicit binding state for the output folder */
  isBindingOutput?: boolean;
  /** Callback to bind or change the project directory */
  onBindProject: () => void | Promise<void | string | null | undefined>;
  /** Callback to clear the project directory */
  onClearProject: () => void | Promise<void | string | null | undefined>;
  /** Callback to bind or change the PiPi output directory */
  onBindOutput: () => void | Promise<void | string | null | undefined>;
  /** Callback to clear the PiPi output directory */
  onClearOutput: () => void | Promise<void | string | null | undefined>;
  /** Whether the terminal panel is currently visible */
  terminalPanelVisible?: boolean;
  /** Callback to toggle the terminal panel */
  onToggleTerminal?: () => void;
  /** Whether to show the terminal button (defaults to isTauri) */
  showTerminal?: boolean;
}

/**
 * SessionFolderBar - renders the two-folder chips (Project and PiPi Output)
 * along with the terminal toggle button when a session is active.
 */
export function SessionFolderBar({
  currentSession,
  projectDir,
  pipiOutputDir,
  isBindingFolder,
  isBindingProject,
  isBindingOutput,
  onBindProject,
  onClearProject,
  onBindOutput,
  onClearOutput,
  terminalPanelVisible = false,
  onToggleTerminal,
  showTerminal = isTauri,
}: SessionFolderBarProps) {
  if (!currentSession) {
    return null;
  }

  const projectBinding = isBindingProject ?? (isBindingFolder === 'project');
  const outputBinding = isBindingOutput ?? (isBindingFolder === 'output');

  return (
    <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap" data-testid="session-folder-bar">
      <SessionFolderChip
        kind="project"
        value={projectDir ?? null}
        isBinding={projectBinding}
        onBind={onBindProject}
        onClear={onClearProject}
      />
      <SessionFolderChip
        kind="output"
        value={pipiOutputDir ?? null}
        isBinding={outputBinding}
        onBind={onBindOutput}
        onClear={onClearOutput}
      />

      {/* Terminal toggle button */}
      {showTerminal && (
        <button
          onClick={onToggleTerminal}
          data-testid="terminal-toggle-button"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full
                     border text-xs transition-all duration-150
                     ${terminalPanelVisible
                       ? 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'
                       : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                     }`}
          title={terminalPanelVisible ? t('chat.hideTerminal') : t('chat.showTerminal')}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {t('chat.terminal')}
        </button>
      )}
    </div>
  );
}
