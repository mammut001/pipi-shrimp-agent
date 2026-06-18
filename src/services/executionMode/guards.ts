/**
 * Execution-mode → tool-execution guards.
 *
 * Maps the 5-mode dropdown (Ask / Plan / Debug / Agent / Bypass) to the
 * PermissionMode that preToolUseHooks already understands,
 * and adds outer-level enforcement for behavior the underlying hook
 * system cannot express on its own (e.g. Ask/Plan modes blocking every
 * tool, or Agent mode gating shell/exec behind user confirmation).
 */

import {
  getDefaultExecutionMode,
  getExecutionMode,
  isExecutionModeId,
  type ExecutionModeId,
  type ExecutionModeProfile,
} from './registry';
import type { PermissionMode } from '@/services/tools/toolExecutionPolicy';
import { PLAN_MODE_ALLOWED_TOOLS } from '@/services/planMode';

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
 * Translate the 5-mode id → the PermissionMode that preToolUseHooks
 * is already designed to consume. (In this codebase the 5-mode dropdown
 * happens to use the same vocabulary as the underlying PermissionMode,
 * with the only divergence being Bypass — but the mapping is still
 * useful for defensive lookup and for callers that hold a session's
 * `executionMode` as an opaque string.)
 */
export function resolvePermissionMode(modeId: ExecutionModeId | string | null | undefined): PermissionMode {
  return getExecutionMode(modeId).permissionMode;
}

type SessionModeSnapshot = {
  executionMode?: ExecutionModeId | string;
  permissionMode?: PermissionMode;
} | null | undefined;

/**
 * Resolve the effective 5-mode id for a session.
 *
 * New sessions persist `executionMode` explicitly. Legacy rows may only
 * have `permissionMode`; map those conservatively so Ask (the UI default)
 * does not silently inherit full Agent tool access.
 *
 * Invariant: if the `executionMode` field is present at all — even when
 * the string is not a known 5-mode id — we never fall through to the
 * legacy `permissionMode` map. A garbage `executionMode` value means
 * the row is corrupted; the safe behaviour is Ask, not "fall back to
 * whatever the legacy column says". This protects us from a buggy
 * migration that stamps `executionMode = "multitask"` (or any other
 * stale wording) and silently inherits Bypass tool access via the
 * `permissionMode` column.
 */
export function resolveSessionExecutionModeId(session: SessionModeSnapshot): ExecutionModeId {
  if (session && 'executionMode' in session && session.executionMode !== undefined && session.executionMode !== null) {
    if (isExecutionModeId(session.executionMode)) {
      return session.executionMode;
    }
    // Field present but invalid — treat as Ask rather than leaking
    // through the legacy permissionMode column.
    return getDefaultExecutionMode().id;
  }
  if (!session) {
    return getDefaultExecutionMode().id;
  }
  switch (session.permissionMode) {
    case 'plan-only':
      return 'plan';
    case 'bypass':
      return 'bypass';
    case 'auto-edits':
      return 'agent';
    case 'standard':
      return 'agent';
    default:
      return getDefaultExecutionMode().id;
  }
}

/**
 * Map a legacy PermissionMode row to the closest 5-mode id when the
 * composer dropdown was not persisted (pre-v8 DB rows, Telegram mirror).
 */
export function executionModeFromPermissionMode(
  permissionMode: PermissionMode | null | undefined,
): ExecutionModeId {
  switch (permissionMode) {
    case 'plan-only':
      return 'plan';
    case 'bypass':
      return 'bypass';
    case 'auto-edits':
      return 'agent';
    case 'standard':
      return 'agent';
    default:
      return getDefaultExecutionMode().id;
  }
}

/**
 * Normalize in-memory session mode fields so UI, chatActions, and tool
 * hooks always agree. Prefers the persisted `executionMode` when valid.
 */
export function hydrateSessionModes<T extends SessionModeSnapshot>(
  session: T,
): T & { executionMode: ExecutionModeId; permissionMode: PermissionMode } {
  const executionMode = resolveSessionExecutionModeId(session);
  const permissionMode = resolvePermissionMode(executionMode);
  return {
    ...session,
    executionMode,
    permissionMode,
  };
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
      // 'none' is reserved for the chat-only Ask mode (no tools at
      // all). Plan mode now uses the dedicated 'plan' policy so it
      // can keep read-only inspection + save_plan_doc available.
      return false;
    case 'plan':
      // Plan mode: read-only inspection + save_plan_doc. The exact
      // allowlist lives in PLAN_MODE_ALLOWED_TOOLS (single source of
      // truth — chatActions, preToolUseHooks and this guard all
      // consult it). Block every other tool: writes, edits, shell,
      // browser mutation, ssh, mcp__*, agent_tool.
      return PLAN_MODE_ALLOWED_TOOLS.includes(toolName);
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
      // SSH, browser mutation, MCP tools, and agent-tool spawning are
      // still gated by the per-tool approval policy — they aren't
      // blanket-allowed in the shell-only Agent mode. agent_tool can
      // spin up sub-agents and team runs that the user should still
      // explicitly approve.
      if (SSH_TOOLS.has(toolName)) return false;
      if (BROWSER_MUTATION_TOOLS.has(toolName)) return false;
      if (toolName.startsWith('mcp__')) return false;
      if (toolName === 'agent_tool') return false;
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
