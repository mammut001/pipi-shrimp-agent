/**
 * Execution-mode → tool-execution guards.
 *
 * Maps the 5-mode dropdown (Ask / Plan / Debug / Agent / Bypass) to the
 * 4-mode PermissionMode that preToolUseHooks already understands,
 * and adds outer-level enforcement for behavior the underlying hook
 * system cannot express on its own (e.g. Ask/Plan modes blocking every
 * tool, or Agent mode gating shell/exec behind user confirmation).
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
  'get_current_workspace',
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
 * Translate the 4-mode id → the 4-mode PermissionMode that preToolUseHooks
 * is already designed to consume. (In this codebase the 4-mode dropdown
 * happens to use the same vocabulary as the underlying PermissionMode,
 * with the only divergence being Bypass — but the mapping is still
 * useful for defensive lookup and for callers that hold a session's
 * `executionMode` as an opaque string.)
 */
export function resolvePermissionMode(modeId: ExecutionModeId | string | null | undefined): PermissionMode {
  return getExecutionMode(modeId).permissionMode;
}

/**
 * Whether a given tool should be allowed to run at all under the supplied
 * execution mode, ignoring preToolUseHooks. This is the "outer guard" used
 * by Plan mode (which the hook layer alone cannot fully block) and by
 * modes that whitelist a subset of tool families.
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
      // 'none' covers both Plan mode (read-only plan output) and the
      // chat-only Ask mode (no tools at all). The downstream caller
      // distinguishes Ask vs Plan via the 6-mode id; here we just
      // return false for any tool name.
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
      // shell-only Agent mode.
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
