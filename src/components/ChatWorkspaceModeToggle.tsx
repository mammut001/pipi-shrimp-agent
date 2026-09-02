import { t } from '@/i18n';
import { workspacePreviewChrome } from './SessionWorkspacePreview';

export type ChatWorkspaceMode = 'chat' | 'preview';

export interface ChatWorkspaceModeToggleProps {
  mode: ChatWorkspaceMode;
  canPreview: boolean;
  onChange: (mode: ChatWorkspaceMode) => void;
}

export function ChatWorkspaceModeToggle({
  mode,
  canPreview,
  onChange,
}: ChatWorkspaceModeToggleProps) {
  return (
    <div
      className={workspacePreviewChrome.segmented}
      data-testid="chat-workspace-mode-toggle"
      role="group"
      aria-label={`${t('nav.chat')} / ${t('common.preview')}`}
    >
      <button
        type="button"
        aria-pressed={mode === 'chat'}
        onClick={() => onChange('chat')}
        className={`${workspacePreviewChrome.segmentedButton} ${
          mode === 'chat'
            ? workspacePreviewChrome.segmentedButtonActive
            : workspacePreviewChrome.segmentedButtonInactive
        }`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
        </svg>
        {t('nav.chat')}
      </button>
      <button
        type="button"
        aria-pressed={mode === 'preview'}
        onClick={() => canPreview && onChange('preview')}
        disabled={!canPreview}
        className={`${workspacePreviewChrome.segmentedButton} ${
          mode === 'preview'
            ? workspacePreviewChrome.segmentedButtonActive
            : workspacePreviewChrome.segmentedButtonInactiveDisabled
        }`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6h13M9 5h13M3 5h.01M3 11h.01M3 17h.01" />
        </svg>
        {t('common.preview')}
      </button>
    </div>
  );
}
