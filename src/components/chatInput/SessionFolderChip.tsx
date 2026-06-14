/**
 * SessionFolderChip
 *
 * Two-folder model: each session has at most two distinct folder bindings,
 * and each is rendered with its own chip. This component knows nothing
 * about how the folder was bound; the caller passes the current value
 * and the bind/clear handlers.
 *
 * Kinds:
 *   - "project" → Project Folder (the user's repo). Tools run here.
 *   - "output"  → PiPi Output Folder. App-owned output root for
 *                 `.pipi-shrimp/`, docs, memory, AutoResearch artifacts.
 *
 * The two chips look the same; the only differences are the i18n label
 * and the accent color of the "open in Finder" hint.
 */

import { getWorkspaceDisplayName } from '@/services/workspace/sessionWorkspaceLabels';
import { t } from '@/i18n';

export type SessionFolderKind = 'project' | 'output';

export interface SessionFolderChipProps {
  kind: SessionFolderKind;
  value: string | null;
  isBinding: boolean;
  onBind: () => void | Promise<void | string | null | undefined>;
  onClear: () => void | Promise<void | string | null | undefined>;
  /**
   * Reveal a path in the OS file manager. Defaults to revealing the
   * bare `value`. The output chip overrides this to reveal the
   * `.pipi-shrimp` subfolder so the user lands on actual outputs.
   */
  onReveal?: (path: string) => void;
}

export function SessionFolderChip({
  kind,
  value,
  isBinding,
  onBind,
  onClear,
  onReveal,
}: SessionFolderChipProps) {
  const labelKey = kind === 'project' ? 'chat.projectFolder' : 'chat.pipiOutputFolder';
  const label = t(labelKey);
  const tooltip = t(
    kind === 'project' ? 'chat.projectFolderTooltip' : 'chat.pipiOutputFolderTooltip',
  );
  const setLabel = t(
    kind === 'project' ? 'chat.setProjectFolder' : 'chat.setPipiOutputFolder',
  );
  const testId = kind === 'project' ? 'project-folder-chip' : 'pipi-output-folder-chip';
  const emptyTestId = kind === 'project' ? 'project-folder-empty' : 'pipi-output-folder-empty';

  if (!value) {
    return (
      <button
        onClick={onBind}
        disabled={isBinding}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
                   border border-dashed border-gray-200
                   text-xs text-gray-400
                   hover:border-gray-300 hover:text-gray-600
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all duration-150"
        title={tooltip}
        data-testid={emptyTestId}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
          />
        </svg>
        {isBinding ? t('chat.binding') : setLabel}
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
                 bg-gray-100 border border-gray-200/80
                 text-xs text-gray-600
                 hover:bg-gray-50 transition-colors group"
      title={tooltip}
      data-testid={testId}
    >
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
        />
      </svg>

      <span className="truncate max-w-[180px]">
        {getWorkspaceDisplayName(value, value)}
      </span>

      <span
        className="hidden group-hover:inline text-gray-400 text-[10px] truncate max-w-[120px]"
        title={value}
      >
        {value}
      </span>

      <button
        onClick={() => onReveal?.(value)}
        className="text-gray-400 hover:text-blue-500 transition-colors ml-0.5"
        title={value}
        aria-label={t('chat.openSourceFolder')}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </button>

      <button
        onClick={onBind}
        disabled={isBinding}
        className="ml-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[10px] font-medium"
        title={t('chat.changeWorkDirectory')}
      >
        {isBinding ? t('chat.binding') : t('common.change')}
      </button>

      <button
        onClick={onClear}
        disabled={isBinding}
        className="text-gray-300 hover:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-0.5"
        title={t('chat.removeWorkDirectory')}
        aria-label={t('chat.removeWorkDirectory')}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
