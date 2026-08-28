/**
 * Execution-mode → tool-execution guards.
 *
 * Product-facing modes are Ask / Plan / Danger. Historical Debug / Agent /
 * Bypass ids are normalized before any tool-policy decision so old persisted
 * sessions remain loadable without keeping five user-facing modes alive.
 */

import {
  getDefaultExecutionMode,
  getExecutionMode,
  isExecutionModeId,
  normalizeExecutionModeId,
  type ActiveExecutionModeId,
  type ExecutionModeId,
  type ExecutionModeProfile,
} from './registry';
import type { PermissionMode } from '@/services/tools/toolExecutionPolicy';
import { PLAN_MODE_ALLOWED_TOOLS } from '@/services/planMode';
import { BROWSER_TOOL_NAMES, BROWSER_READ_ONLY_TOOLS } from '../browser/browserTools';

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

function dedupeTools(tools: Iterable<string>): string[] {
  return [...new Set(tools)];
}

export function resolvePermissionMode(
  modeId: ExecutionModeId | string | null | undefined,
): PermissionMode {
  return getExecutionMode(modeId).permissionMode;
}

type SessionModeSnapshot = {
  executionMode?: ExecutionModeId | string;
  permissionMode?: PermissionMode;
} | null | undefined;

/**
 * Resolve the effective three-mode id for a session.
 *
 * If an executionMode is present, it is authoritative. Known historical ids
 * are migrated; unknown/corrupt values collapse to Ask and never inherit a
 * more powerful legacy permissionMode by accident.
 */
export function resolveSessionExecutionModeId(
  session: SessionModeSnapshot,
): ActiveExecutionModeId {
  if (session && 'executionMode' in session && session.executionMode !== undefined && session.executionMode !== null) {
    if (isExecutionModeId(session.executionMode)) {
      return normalizeExecutionModeId(session.executionMode);
    }
    return getDefaultExecutionMode().id;
  }
  if (!session) {
    return getDefaultExecutionMode().id;
  }
  return executionModeFromPermissionMode(session.permissionMode);
}

/**
 * Conservative migration for rows that predate executionMode persistence.
 * `bypass` was already explicitly high-risk, so it maps to Danger. Standard
 * and auto-edits rows map to Plan rather than silently gaining Danger power.
 */
export function executionModeFromPermissionMode(
  permissionMode: PermissionMode | null | undefined,
): ActiveExecutionModeId {
  switch (permissionMode) {
    case 'plan-only':
      return 'plan';
    case 'bypass':
      return 'danger';
    case 'auto-edits':
    case 'standard':
      return 'plan';
    default:
      return getDefaultExecutionMode().id;
  }
}

export function hydrateSessionModes<T extends SessionModeSnapshot>(
  session: T,
): T & { executionMode: ActiveExecutionModeId; permissionMode: PermissionMode } {
  const executionMode = resolveSessionExecutionModeId(session);
  const permissionMode = resolvePermissionMode(executionMode);
  return {
    ...session,
    executionMode,
    permissionMode,
  };
}

export function isToolAllowedForMode(
  modeId: ExecutionModeId | string | null | undefined,
  toolName: string,
  allowBrowserTools?: boolean,
): boolean {
  return isToolAllowedForProfile(getExecutionMode(modeId), toolName, allowBrowserTools);
}

export function isToolAllowedForProfile(
  profile: ExecutionModeProfile,
  toolName: string,
  allowBrowserTools?: boolean,
): boolean {
  // Plan document persistence is app-side; exposing this pseudo-tool would
  // produce an "Unknown tool" at runtime.
  if (toolName === 'save_plan_doc') {
    return false;
  }

  const isBrowserTool = BROWSER_TOOL_NAMES.includes(toolName);
  if (isBrowserTool) {
    if (profile.allowedToolPolicy === 'full') return true;
    if (profile.allowedToolPolicy === 'none' || profile.allowedToolPolicy === 'plan') return false;
    if (profile.allowedToolPolicy === 'shell') return true;
    if (!allowBrowserTools) return false;
    if (profile.allowedToolPolicy === 'read-only' || profile.allowedToolPolicy === 'edit') {
      return BROWSER_READ_ONLY_TOOLS.has(toolName);
    }
    return true;
  }

  switch (profile.allowedToolPolicy) {
    case 'none':
      return false;
    case 'plan':
      return PLAN_MODE_ALLOWED_TOOLS.includes(toolName);
    case 'read-only':
      return READ_ONLY_TOOLS.has(toolName);
    case 'edit':
      if (READ_ONLY_TOOLS.has(toolName)) return true;
      if (FILE_WRITE_TOOLS.has(toolName)) return true;
      if (SHELL_TOOLS.has(toolName)) return false;
      if (SSH_TOOLS.has(toolName)) return false;
      if (BROWSER_MUTATION_TOOLS.has(toolName)) return false;
      return false;
    case 'shell':
      if (READ_ONLY_TOOLS.has(toolName)) return true;
      if (FILE_WRITE_TOOLS.has(toolName)) return true;
      if (SHELL_TOOLS.has(toolName)) return true;
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
 * Model-facing tool allowlist.
 * - Ask: empty catalog.
 * - Plan: concrete read-only catalog.
 * - Danger: undefined => full catalog; risky approval still flows through
 *   PermissionMode/pre-tool hooks.
 */
export function getAllowedToolsForMode(
  modeId: ExecutionModeId | string | null | undefined,
  allowBrowserTools?: boolean,
): string[] | undefined {
  const profile = getExecutionMode(modeId);

  let tools: string[] | undefined;
  switch (profile.allowedToolPolicy) {
    case 'none':
      return [];
    case 'plan':
      return [...PLAN_MODE_ALLOWED_TOOLS];
    case 'read-only':
      tools = dedupeTools(READ_ONLY_TOOLS);
      break;
    case 'edit':
      tools = dedupeTools([...READ_ONLY_TOOLS, ...FILE_WRITE_TOOLS]);
      break;
    case 'shell':
      tools = dedupeTools([
        ...READ_ONLY_TOOLS,
        ...FILE_WRITE_TOOLS,
        ...SHELL_TOOLS,
        ...BROWSER_TOOL_NAMES,
      ]);
      break;
    case 'full':
      return undefined;
    default:
      return undefined;
  }

  if (allowBrowserTools && tools) {
    if (profile.allowedToolPolicy === 'read-only' || profile.allowedToolPolicy === 'edit') {
      tools = dedupeTools([...tools, ...Array.from(BROWSER_READ_ONLY_TOOLS)]);
    } else if (profile.allowedToolPolicy === 'shell') {
      tools = dedupeTools([...tools, ...BROWSER_TOOL_NAMES]);
    }
  }

  return tools;
}

export function modeRequiresWarning(
  modeId: ExecutionModeId | string | null | undefined,
): boolean {
  return getExecutionMode(modeId).requiresWarning;
}

export function isAdvancedMode(
  modeId: ExecutionModeId | string | null | undefined,
): boolean {
  return getExecutionMode(modeId).isAdvanced;
}

export function isDefaultMode(
  modeId: ExecutionModeId | string | null | undefined,
): boolean {
  return getExecutionMode(modeId).isDefault;
}
