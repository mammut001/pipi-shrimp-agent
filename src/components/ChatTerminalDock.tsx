/**
 * Chat terminal dock — resizable PTY strip mounted under ChatInput.
 *
 * Extracted from ChatBrowserWorkspaceShell (AG-15). Mounts the PTY only
 * while visible; hiding with display:none left xterm attached to a
 * 0-height box (gray dot, black screen, no echo).
 */

import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { useUIStore } from '@/store';
import { TerminalPanel } from './TerminalPanel';
import { workspacePreviewChrome } from './SessionWorkspacePreview';

/** Clamp terminal dock height to the shell's historical 100–600px band. */
export function clampTerminalPanelHeight(height: number): number {
  return Math.max(100, Math.min(600, height));
}

export interface ChatTerminalDockProps {
  /** Session project/work dir (or fallback) forwarded to the PTY. */
  cwd?: string;
}

export function ChatTerminalDock({ cwd }: ChatTerminalDockProps) {
  const terminalPanelVisible = useUIStore((s) => s.terminalPanelVisible);
  const terminalPanelHeight = useUIStore((s) => s.terminalPanelHeight);
  const setTerminalPanelHeight = useUIStore((s) => s.setTerminalPanelHeight);
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);

  const handleTerminalDragStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = terminalPanelHeight;
      const onMouseMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setTerminalPanelHeight(clampTerminalPanelHeight(startHeight + delta));
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [terminalPanelHeight, setTerminalPanelHeight],
  );

  if (!terminalPanelVisible) return null;

  return (
    <>
      <div
        className={workspacePreviewChrome.terminalDivider}
        onMouseDown={handleTerminalDragStart}
        data-testid="chat-terminal-dock-divider"
      >
        <span className={workspacePreviewChrome.terminalDividerThumb} />
      </div>
      <div
        className="flex-shrink-0 overflow-hidden"
        style={{ height: terminalPanelHeight }}
        data-testid="chat-terminal-dock"
      >
        <TerminalPanel
          key={cwd ?? '__no_cwd__'}
          cwd={cwd}
          onClose={toggleTerminalPanel}
        />
      </div>
    </>
  );
}

export default ChatTerminalDock;
