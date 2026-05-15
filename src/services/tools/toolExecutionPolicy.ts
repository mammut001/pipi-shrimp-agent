export type ToolExecutionSource =
  | 'assistant_tool_call'
  | 'user_requested_command'
  | 'autoresearch_phase'
  | 'headless_agent'
  | 'workflow_agent'
  | 'manual_terminal'
  | 'unknown';

export type PermissionMode = 'standard' | 'auto-edits' | 'bypass' | 'plan-only';

export type ToolPolicyPreviewDecision = 'allowed' | 'awaiting_confirmation' | 'rejected';

export interface ToolPolicyPreviewResult {
  toolCallId: string;
  toolName: string;
  decision: ToolPolicyPreviewDecision;
  reason?: string;
  approvalToken?: string;
}

export const DEFAULT_TOOL_EXECUTION_SOURCE: ToolExecutionSource = 'unknown';

const PIPELINE_SINGLE_INVOKE_TOOL_NAMES = new Set([
  'write_file',
  'create_directory',
  'execute_command',
]);

const AUTO_EDIT_SAFE_TOOLS = new Set([
  'read_file',
  'list_files',
  'path_exists',
  'search_files',
  'glob_search',
  'grep_files',
  'write_file',
  'create_directory',
]);

const BROWSER_MUTATION_TOOLS = new Set([
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_press_key',
  'browser_wait',
]);

const HIGH_RISK_TOOLS = new Set([
  'execute_command',
  'ssh_exec',
  'ssh_upload_file',
  'agent_tool',
  'run_in_terminal',
]);

export function isPipelineSingleInvokeTool(toolName: string): boolean {
  return PIPELINE_SINGLE_INVOKE_TOOL_NAMES.has(toolName);
}

export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}

export function isSshTool(toolName: string): boolean {
  return toolName === 'ssh_exec'
    || toolName === 'ssh_read_file'
    || toolName === 'ssh_upload_file';
}

export function isBrowserMutationTool(toolName: string): boolean {
  return BROWSER_MUTATION_TOOLS.has(toolName);
}

export function isCommandExecutionTool(toolName: string): boolean {
  return toolName === 'execute_command'
    || toolName === 'ssh_exec'
    || toolName === 'run_in_terminal'
    || toolName === 'bash'
    || toolName === 'exec'
    || toolName === 'shell';
}

export function isHighRiskToolName(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName)
    || isMcpTool(toolName)
    || isBrowserMutationTool(toolName);
}

export function canAutoApproveTool(
  permissionMode: PermissionMode,
  toolName: string,
): boolean {
  if (permissionMode === 'bypass') {
    return !isHighRiskToolName(toolName)
      && !isSshTool(toolName)
      && !isMcpTool(toolName)
      && !isBrowserMutationTool(toolName)
      && toolName !== 'agent_tool';
  }

  if (permissionMode !== 'auto-edits') {
    return false;
  }

  if (isHighRiskToolName(toolName) || isSshTool(toolName)) {
    return false;
  }

  return AUTO_EDIT_SAFE_TOOLS.has(toolName);
}
