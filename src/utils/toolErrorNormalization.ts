import { t } from '@/i18n';

export interface NormalizedToolError {
  isStructuredError: boolean;
  kind: 'no_project_folder' | 'permission_denied' | 'confirmation_required' | 'tool_disabled' | 'generic_error';
  title: string;
  userMessage: string;
  noOpNotice?: string;
  actionLabel?: string;
  actionKind?: 'select_project_folder';
  rawDetails?: string;
}

export const NO_PROJECT_FOLDER_PATTERN = /No Project Folder is bound to this session/i;

/**
 * Normalizes tool execution errors (especially JSON payloads returned by preflight checks)
 * into localized, user-facing structured error descriptions.
 */
export function normalizeStructuredToolError(
  rawContent: string,
  locale?: string,
): NormalizedToolError | null {
  if (!rawContent || typeof rawContent !== 'string') {
    return null;
  }

  const trimmed = rawContent.trim();

  // Try parsing structured JSON error
  let parsed: any = null;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
  }

  const isNoProjectFolder =
    NO_PROJECT_FOLDER_PATTERN.test(trimmed) ||
    (parsed && (
      NO_PROJECT_FOLDER_PATTERN.test(parsed.message || '') ||
      NO_PROJECT_FOLDER_PATTERN.test(parsed.cause || '') ||
      (parsed.error_kind === 'permission_denied' && NO_PROJECT_FOLDER_PATTERN.test(parsed.message || ''))
    ));

  if (isNoProjectFolder) {
    const isZh = locale ? locale.startsWith('zh') : t('common.save') !== 'Save';
    return {
      isStructuredError: true,
      kind: 'no_project_folder',
      title: isZh ? '未绑定项目文件夹' : 'No Project Folder Bound',
      userMessage: isZh
        ? '当前会话还没有绑定项目文件夹。请先选择项目文件夹，再执行读取、写入或命令操作。'
        : 'No Project Folder is bound to this session. Please select a Project Folder before reading, writing, or executing commands.',
      noOpNotice: isZh
        ? '（未执行任何文件或命令操作）'
        : '(No file or command operation was performed)',
      actionLabel: isZh ? '选择项目文件夹' : 'Select Project Folder',
      actionKind: 'select_project_folder',
      rawDetails: trimmed,
    };
  }

  if (parsed && (parsed.error === true || parsed.is_error === true || parsed.error_kind)) {
    const isZh = locale ? locale.startsWith('zh') : t('common.save') !== 'Save';
    if (parsed.error_kind === 'confirmation_required' || parsed.error === 'confirmation_required') {
      return {
        isStructuredError: true,
        kind: 'confirmation_required',
        title: isZh ? '需要用户确认' : 'Confirmation Required',
        userMessage: parsed.message || (isZh ? '该操作需要用户授权后方可执行。' : 'This action requires explicit user confirmation.'),
        rawDetails: trimmed,
      };
    }
    if (parsed.error_kind === 'permission_denied' || parsed.error === 'permission_denied') {
      return {
        isStructuredError: true,
        kind: 'permission_denied',
        title: isZh ? '权限不足' : 'Permission Denied',
        userMessage: parsed.message || (isZh ? '没有足够的权限执行此工具操作。' : 'Permission denied to execute this tool operation.'),
        rawDetails: trimmed,
      };
    }
    return {
      isStructuredError: true,
      kind: 'generic_error',
      title: isZh ? '工具执行失败' : 'Tool Execution Failed',
      userMessage: parsed.message || parsed.cause || trimmed,
      rawDetails: trimmed,
    };
  }

  return null;
}
