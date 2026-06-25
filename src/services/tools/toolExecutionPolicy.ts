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

/** Tools that still use legacy `execute_tool` (browser/Typst/Skill chat state). */
const LEGACY_CHAT_ONLY_TOOL_NAMES = new Set([
  'Skill',
  'render_typst_to_svg',
  'render_typst_to_pdf',
  'compile_typst_file',
  'get_current_workspace',
  'browser_navigate',
  'browser_get_page',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_get_text',
  'browser_screenshot',
  'browser_extract_content',
  'browser_press_key',
  'browser_wait',
]);

const AUTO_EDIT_SAFE_TOOLS = new Set([
  'read_file',
  'list_files',
  'path_exists',
  'search_files',
  'glob_search',
  'grep_files',
  'get_current_workspace',
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

export function isLegacyChatOnlyTool(toolName: string): boolean {
  return LEGACY_CHAT_ONLY_TOOL_NAMES.has(toolName);
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

export interface AutoApproveToolOptions {
  /** When true, browser mutation tools auto-approve in Agent (auto-edits) mode. */
  browserIntent?: boolean;
}

export function canAutoApproveTool(
  permissionMode: PermissionMode,
  toolName: string,
  options?: AutoApproveToolOptions,
): boolean {
  if (
    options?.browserIntent
    && isBrowserMutationTool(toolName)
    && (permissionMode === 'bypass' || permissionMode === 'auto-edits')
  ) {
    return true;
  }

  if (permissionMode === 'bypass') {
    // Bypass auto-approves normal project-scoped tools (read, write,
    // shell, terminal, and browser automation). It does NOT auto-approve
    // tools that touch remote systems, external MCP servers, or
    // agent-tool spawning — those keep their existing confirmation
    // gate because the hard safety hooks (dangerous-command /
    // path-validation) cannot express "is this safe" for them
    // generically. agent_tool in particular can spin up sub-agents
    // and team runs that the user should still explicitly approve.
    if (isSshTool(toolName)) return false;
    if (isMcpTool(toolName)) return false;
    if (toolName === 'agent_tool') return false;
    return true;
  }

  if (permissionMode !== 'auto-edits') {
    return false;
  }

  if (isHighRiskToolName(toolName) || isSshTool(toolName)) {
    return false;
  }

  return AUTO_EDIT_SAFE_TOOLS.has(toolName);
}
