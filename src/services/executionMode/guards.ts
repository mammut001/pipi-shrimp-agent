/**
 * Execution-mode → tool-execution guards.
 *
 * Maps the 6-mode dropdown to the 4-mode PermissionMode that preToolUseHooks
 * already understands, and adds outer-level enforcement for behavior the
 * underlying hook system cannot express on its own (e.g. Ask mode blocking
 * all file writes / shell / browser unless explicitly confirmed).
 */

import {
  getExecutionMode,
  type ExecutionModeId,
  type ExecutionModeProfile,
} from './registry';
import type { PermissionMode } from '@/services/tools/toolExecutionPolicy';

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'path_exists',
  'search_files',
  'glob_search',
  'grep_files',
]);

const SHELL_TOOLS = new Set([
  'execute_command',
  'run_in_terminal',
  'bash',
  'exec',
  'shell',
]);

const SSH_TOOLS = new Set([
  'ssh_exec',
  'ssh_read_file',
  'ssh_upload_file',
]);

const BROWSER_MUTATION_TOOLS = new Set([
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_press_key',
  'browser_wait',
]);

const FILE_WRITE_TOOLS = new Set([
  'write_file',
  'create_directory',
  'edit_file',
  'delete_file',
]);

/**
 * Translate the 6-mode id → the 4-mode PermissionMode that preToolUseHooks
 * is already designed to consume. Returning the underlying PermissionMode
 * keeps the hook pipeline intact while letting us treat the new modes as a
 * user-facing surface.
 */
export function resolvePermissionMode(modeId: ExecutionModeId | string | null | undefined): PermissionMode {
  return getExecutionMode(modeId).permissionMode;
}

/**
 * Whether a given tool should be allowed to run at all under the supplied
 * execution mode, ignoring preToolUseHooks. This is the "outer guard" used
 * by Ask mode and Plan mode where the hook layer alone is not sufficient.
 */
export function isToolAllowedForMode(
  modeId: ExecutionModeId | string | null | undefined,
  toolName: string,
): boolean {
  const profile = getExecutionMode(modeId);
  return isToolAllowedForProfile(profile, toolName);
}

export function isToolAllowedForProfile(
  profile: ExecutionModeProfile,
  toolName: string,
): boolean {
  switch (profile.allowedToolPolicy) {
    case 'none':
      return false;
    case 'read-only':
      return READ_ONLY_TOOLS.has(toolName);
    case 'edit':
      // Read + write/edit, but no shell, no browser mutation, no SSH.
      if (READ_ONLY_TOOLS.has(toolName)) return true;
      if (FILE_WRITE_TOOLS.has(toolName)) return true;
      if (SHELL_TOOLS.has(toolName)) return false;
      if (SSH_TOOLS.has(toolName)) return false;
      if (BROWSER_MUTATION_TOOLS.has(toolName)) return false;
      // Unknown / future tool: be conservative.
      return false;
    case 'shell':
      if (READ_ONLY_TOOLS.has(toolName)) return true;
      if (FILE_WRITE_TOOLS.has(toolName)) return true;
      if (SHELL_TOOLS.has(toolName)) return true;
      // SSH, browser mutation, and MCP tools are still gated by the
      // per-tool approval policy — they aren't blanket-allowed in the
      // shell-only Agent / Multitask modes.
      if (SSH_TOOLS.has(toolName)) return false;
      if (BROWSER_MUTATION_TOOLS.has(toolName)) return false;
      return true;
    case 'full':
      return true;
    default:
      return false;
  }
}

/**
 * Whether the mode requires an explicit confirmation to be selected by the
 * user. Used by the dropdown to gate Bypass behind a one-time warning.
 */
export function modeRequiresWarning(modeId: ExecutionModeId | string | null | undefined): boolean {
  return getExecutionMode(modeId).requiresWarning;
}

/**
 * Whether the mode is "advanced" (rendered under a separator + section label
 * in the dropdown). Used to push Bypass visually down.
 */
export function isAdvancedMode(modeId: ExecutionModeId | string | null | undefined): boolean {
  return getExecutionMode(modeId).isAdvanced;
}

/**
 * Whether the mode is the default for new sessions.
 */
export function isDefaultMode(modeId: ExecutionModeId | string | null | undefined): boolean {
  return getExecutionMode(modeId).isDefault;
}
