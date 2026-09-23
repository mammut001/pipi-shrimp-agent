/**
 * Preview-mode shell — workspace toolbar + conversation column + file preview.
 *
 * Extracted from ChatBrowserWorkspaceShell (AG-15 PR2). Chat column is
 * passed as `chat` so the panel can be reused in split/normal layouts.
 */

import type { ReactNode } from 'react';
import { MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS } from '@/layout/edgeToggleGutter';
import { ChatWorkspaceModeToggle } from './ChatWorkspaceModeToggle';
import {
  SessionWorkspacePreviewPane,
  workspacePreviewChrome,
} from './SessionWorkspacePreview';
import { t } from '@/i18n';

export interface PreviewWorkspaceShellProps {
  workspaceMode: 'chat' | 'preview';
  canPreview: boolean;
  onWorkspaceModeChange: (mode: 'chat' | 'preview') => void;
  workDir: string | null;
  selectedFilePath: string | null;
  selectedContent: string;
  fileLoading: boolean;
  fileError: string | null;
  onRevealPath: (path: string) => Promise<void>;
  chat: ReactNode;
}

export function PreviewWorkspaceShell({
  workspaceMode,
  canPreview,
  onWorkspaceModeChange,
  workDir,
  selectedFilePath,
  selectedContent,
  fileLoading,
  fileError,
  onRevealPath,
  chat,
}: PreviewWorkspaceShellProps) {
  return (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-col ${workspacePreviewChrome.shellBg}`}
      data-testid="preview-workspace-shell"
    >
      <div
        className={`${workspacePreviewChrome.toolbar} pl-4 ${MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS} py-3`}
        data-testid="preview-workspace-toolbar"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className={workspacePreviewChrome.eyebrow}>{t('chat.workspaceView')}</p>
            <p className={workspacePreviewChrome.secondaryText}>
              {t('chat.workspaceViewDescription')}
            </p>
          </div>

          <ChatWorkspaceModeToggle
            mode={workspaceMode}
            canPreview={canPreview}
            onChange={onWorkspaceModeChange}
          />
        </div>
      </div>
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex w-[420px] min-w-[360px] max-w-[460px] flex-col border-r border-[#e9e9e7] bg-[#fbfbfa] shadow-[inset_-1px_0_0_rgba(255,255,255,0.6)]">
          <div className="border-b border-[#e9e9e7] bg-[#fbfbfa]/92 px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,0.72)]">
            <p className={workspacePreviewChrome.eyebrow}>{t('chat.conversationPanel')}</p>
            <p className={workspacePreviewChrome.secondaryText}>
              {t('chat.conversationPanelDescription')}
            </p>
          </div>
          <div className="flex-1 min-h-0 min-w-0">{chat}</div>
        </div>

        <div className={`flex-1 min-w-0 ${workspacePreviewChrome.shellBg}`}>
          <SessionWorkspacePreviewPane
            workDir={workDir}
            selectedFilePath={selectedFilePath}
            selectedContent={selectedContent}
            fileLoading={fileLoading}
            fileError={fileError}
            onRevealPath={onRevealPath}
          />
        </div>
      </div>
    </div>
  );
}

export default PreviewWorkspaceShell;
