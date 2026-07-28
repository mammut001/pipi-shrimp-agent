import { runChatTurn } from '@/core/QueryEngine';
import type { ToolCallParams, TokenUsage } from '@/core/types';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import type { ExecutionModeId } from '@/services/executionMode';
import { StreamingToolExecutor, partitionTools } from '@/services/StreamingToolExecutor';
import type { ToolExecutionSource, PermissionMode } from '@/services/tools/toolExecutionPolicy';
import { useSettingsStore } from '@/store';
import {
  appendToolBudgetEntries,
  createToolBudgetSummary,
  getToolBudgetSummaryFromUnknown,
  withToolBudgetSummary,
  type ToolBudgetSummary,
} from '@/services/tools/toolBudget';
import { DEFAULT_AGENT_SETTINGS } from '@/types/settings';

const WORKSPACE_SENSITIVE_TOOLS = new Set([
  'get_current_workspace',
  'read_file',
  'write_file',
  'create_directory',
  'path_exists',
  'list_files',
  'search_files',
  'glob_search',
  'grep_files',
  'execute_command',
  'compile_typst_file',
  'render_typst_to_pdf',
]);

type HeadlessMessage = {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCallParams[];
  tool_call_id?: string;
};

export interface HeadlessAgentRunnerInput {
  sessionId: string;
  initialMessages: HeadlessMessage[];
  systemPrompt: string;
  /**
   * Project Folder for the headless run (the user's repo). Tools
   * execute commands and read / write project files relative to this
   * folder. Two-folder model: this is the legacy `workDir` semantics,
   * but the *system prompt* now also receives a separate PiPi Output
   * Folder for memory / core.md lookups.
   */
  workDir?: string;
  /**
   * PiPi Output Folder for the headless run. App-owned root for
   * `.pipi-shrimp/` metadata, generated docs, and memory. Optional —
   * headless runs without one fall back to the legacy project-root
   * memory layout.
   */
  pipiOutputDir?: string;
  agentConfig?: ResolvedAgentConfig;
  allowedTools?: string[];
  toolExecutionSource?: ToolExecutionSource;
  /**
   * Permission mode for tool execution. When set to 'bypass', tools like
   * execute_command, write_file, etc. are auto-approved without a confirmation
   * modal. This is essential for autonomous headless runs (e.g. AutoResearch)
   * where no UI is available to approve tool calls.
   *
   * Defaults to 'bypass' when toolExecutionSource is 'autoresearch_phase',
   * and 'standard' otherwise.
   */
  permissionMode?: PermissionMode;
  executionMode?: ExecutionModeId | string;
  resolveWorkDir?: () => Promise<string | null>;
  onWorkDirResolved?: (workDir: string) => Promise<void> | void;
  onTextDelta?: (chunk: string) => void;
  onReasoningDelta?: (chunk: string) => void;
  onStatus?: (message: string) => void;
  onToolSummary?: (toolName: string, preview: string) => void;
  onAssistantMessage?: (text: string) => Promise<void> | void;
  onToolCall?: (call: { id: string; name: string; arguments: string }) => Promise<void> | void;
  onToolResult?: (call: { id: string; name: string; result: string; durationMs: number }) => Promise<void> | void;
  allowToolExecution?: (call: { id: string; name: string; arguments: string }) => { allowed: boolean; reason?: string };
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HeadlessAgentRunnerResult {
  finalText: string;
  finalReasoning: string;
  tokenUsage?: TokenUsage;
  toolBudgetSummary: ToolBudgetSummary;
}

function buildAllowedToolsSystemPrompt(basePrompt: string, allowedTools: string[]): string {
  const allowedSet = new Set(allowedTools);
  const hardRules = [
    '## Tool Lane Constraints',
    `- HARD RULE: you may call only these tools in this run: ${allowedTools.join(', ')}.`,
  ];

  if (!allowedSet.has('list_files')) {
    if (allowedSet.has('execute_command')) {
      hardRules.push('- HARD RULE: do not call list_files. It is disabled in this lane. Use execute_command with `ls -la` or `ls -la <path>` instead.');
    } else if (allowedSet.has('ssh_exec')) {
      hardRules.push('- HARD RULE: do not call list_files. It is disabled in this lane. Use ssh_exec with `ls -la` or `ls -la <path>` instead.');
    } else {
      hardRules.push('- HARD RULE: do not call list_files. It is disabled in this lane.');
    }
  }

  return `${basePrompt}\n\n${hardRules.join('\n')}`;
}

function previewToolResult(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    return '(empty result)';
  }

  return normalized.length > 200
    ? `${normalized.slice(0, 200)}…`
    : normalized;
}

function toolResultContent(toolName: string, content: string, errorMessage?: string): string {
  if (content) {
    return content;
  }
  if (errorMessage) {
    return `Error: ${errorMessage}`;
  }
  return JSON.stringify({
    error: true,
    error_kind: 'transient_failure',
    tool: toolName,
    message: `Tool execution failed: ${toolName}`,
    cause: 'No tool result content or error message was returned.',
  });
}

function buildDisallowedToolResult(toolName: string, allowedTools: Set<string>): string {
  const allowedList = [...allowedTools].join(', ');
  return JSON.stringify({
    error: true,
    error_kind: 'tool_disabled',
    tool: toolName,
    message: `Tool "${toolName}" is disabled for this AutoResearch run. Allowed tools: ${allowedList}`,
    cause: `Allowed tools: ${allowedList}`,
  });
}

function buildBlockedToolResult(toolName: string, reason: string): string {
  return JSON.stringify({
    error: true,
    error_kind: 'tool_disabled',
    tool: toolName,
    message: reason,
    cause: reason,
  });
}

async function ensureHeadlessWorkDir(
  currentWorkDir: string | undefined,
  tools: ToolCallParams[],
  resolveWorkDir: HeadlessAgentRunnerInput['resolveWorkDir'],
  onWorkDirResolved: HeadlessAgentRunnerInput['onWorkDirResolved'],
): Promise<string | undefined> {
  if (currentWorkDir) {
    return currentWorkDir;
  }

  const needsWorkDir = tools.some((tool) => WORKSPACE_SENSITIVE_TOOLS.has(tool.name));
  if (!needsWorkDir || !resolveWorkDir) {
    return currentWorkDir;
  }

  const resolvedWorkDir = await resolveWorkDir();
  if (resolvedWorkDir) {
    await onWorkDirResolved?.(resolvedWorkDir);
    return resolvedWorkDir;
  }

  return currentWorkDir;
}

async function executeToolBatch(
  tools: ToolCallParams[],
  executor: StreamingToolExecutor,
  sessionId: string,
  workDir: string | undefined,
  source: ToolExecutionSource,
  allowedTools?: Set<string>,
  allowToolExecution?: HeadlessAgentRunnerInput['allowToolExecution'],
  permissionMode?: PermissionMode,
  executionMode?: ExecutionModeId | string,
): Promise<Array<{ id: string; name: string; content: string; durationMs: number }>> {
  const manualResults: Array<{ id: string; name: string; content: string; durationMs: number }> = [];
  const executableTools: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

  for (const tool of tools) {
    const toolGate = allowToolExecution?.({
      id: tool.id,
      name: tool.name,
      arguments: tool.arguments,
    });
    if (toolGate && !toolGate.allowed) {
      manualResults.push({
        id: tool.id,
        name: tool.name,
        content: buildBlockedToolResult(tool.name, toolGate.reason || `Tool "${tool.name}" is blocked.`),
        durationMs: 0,
      });
      continue;
    }

    if (allowedTools && !allowedTools.has(tool.name)) {
      manualResults.push({
        id: tool.id,
        name: tool.name,
        content: buildDisallowedToolResult(tool.name, allowedTools),
        durationMs: 0,
      });
      continue;
    }

    if (tool.name === 'get_current_workspace') {
      manualResults.push({
        id: tool.id,
        name: tool.name,
        content: workDir
          ? JSON.stringify({ work_dir: workDir, message: `Current working directory: ${workDir}` })
          : JSON.stringify({ error: true, message: 'No working directory is currently bound.' }),
        durationMs: 0,
      });
      continue;
    }

    let parsedArguments: Record<string, unknown> = {};
    try {
      parsedArguments = JSON.parse(tool.arguments) as Record<string, unknown>;
    } catch {
      parsedArguments = {};
    }

    executableTools.push({
      id: tool.id,
      name: tool.name,
      arguments: parsedArguments,
    });
  }

  const { concurrent, serial } = partitionTools(executableTools);
  const results: Array<{ id: string; name: string; content: string; durationMs: number }> = [...manualResults];

  if (concurrent.length > 0) {
    const batchResult = await executor.executeBatch(concurrent, {
      sessionId,
      workDir,
      source,
      permissionMode,
      executionMode,
      allowedTools: allowedTools ? [...allowedTools] : undefined,
    });

    for (const result of batchResult.results) {
      const request = concurrent.find((candidate) => candidate.id === result.id);
      const content = toolResultContent(request?.name ?? 'unknown', result.content, result.error_message);
      results.push({
        id: result.id,
        name: request?.name ?? 'unknown',
        content,
        durationMs: result.execution_time_ms ?? batchResult.totalExecutionTime,
      });
    }
  }

  for (const request of serial) {
    const startedAt = Date.now();
    const batchResult = await executor.executeBatch([request], {
      sessionId,
      workDir,
      source,
      permissionMode,
      executionMode,
      allowedTools: allowedTools ? [...allowedTools] : undefined,
    });
    const result = batchResult.results[0];
    const content = toolResultContent(request.name, result?.content ?? '', result?.error_message);
    results.push({
      id: request.id,
      name: request.name,
      content,
      durationMs: result?.execution_time_ms ?? (Date.now() - startedAt),
    });
  }

  return results;
}

export async function runHeadlessAgentTurn(
  input: HeadlessAgentRunnerInput,
): Promise<HeadlessAgentRunnerResult> {
  const executor = new StreamingToolExecutor({ timeoutMs: input.timeoutMs ?? 120_000 });
  const allowedTools = input.allowedTools?.length
    ? new Set(input.allowedTools)
    : undefined;
  const effectivePermissionMode: PermissionMode = input.permissionMode
    ?? (input.toolExecutionSource === 'autoresearch_phase' ? 'bypass' : 'standard');
  const effectiveExecutionMode: ExecutionModeId | string | undefined = input.executionMode
    ?? (effectivePermissionMode === 'bypass' ? 'bypass' : undefined);
  const toolExecutionSource = input.toolExecutionSource ?? 'headless_agent';
  const constrainedSystemPrompt = input.allowedTools?.length
    ? buildAllowedToolsSystemPrompt(input.systemPrompt, input.allowedTools)
    : input.systemPrompt;
  const turnDeadlineMs = input.timeoutMs ?? 120_000;

  const engine = runChatTurn(
    input.sessionId,
    input.initialMessages,
    constrainedSystemPrompt,
    input.workDir,
    false,
    input.agentConfig,
    {
      allowedTools: input.allowedTools,
    },
    input.pipiOutputDir,
  );

  let currentWorkDir = input.workDir;
  let finalText = '';
  let finalReasoning = '';
  let assistantTurnBuffer = '';
  let tokenUsage: TokenUsage | undefined;
  let toolBudgetSummary = createToolBudgetSummary(
    useSettingsStore.getState().agentSettings?.maxToolRounds ?? DEFAULT_AGENT_SETTINGS.maxToolRounds,
  );

  const turnDeadlineMs = input.timeoutMs ?? 120_000;
  let turnTimedOut = false;
  const timeoutId = setTimeout(() => { turnTimedOut = true; }, turnDeadlineMs);

  try {
    for await (const event of engine) {
      if (turnTimedOut) {
        throw new Error(`Headless agent turn timed out after ${turnDeadlineMs}ms`);
      }

      if (input.signal?.aborted) {
        throw new DOMException('Headless agent turn aborted', 'AbortError');
      }

      switch (event.type) {
      case 'text_delta':
        finalText += event.content;
        assistantTurnBuffer += event.content;
        input.onTextDelta?.(event.content);
        break;

      case 'reasoning_delta':
        finalReasoning += event.content;
        input.onReasoningDelta?.(event.content);
        break;

      case 'status_update':
        input.onStatus?.(event.message);
        break;

      case 'tool_batch_request': {
        currentWorkDir = await ensureHeadlessWorkDir(
          currentWorkDir,
          event.tools,
          input.resolveWorkDir,
          input.onWorkDirResolved,
        );

        for (const tool of event.tools) {
          await input.onToolCall?.({
            id: tool.id,
            name: tool.name,
            arguments: tool.arguments,
          });
        }

        const results = await executeToolBatch(
          event.tools,
          executor,
          input.sessionId,
          currentWorkDir,
          toolExecutionSource,
          allowedTools,
          input.allowToolExecution,
          effectivePermissionMode,
          effectiveExecutionMode,
        );
        toolBudgetSummary = appendToolBudgetEntries(
          toolBudgetSummary,
          results.map(({ name, content }) => ({ name, content })),
        );
        for (const result of results) {
          input.onToolSummary?.(result.name, previewToolResult(result.content));
          await input.onToolResult?.({
            id: result.id,
            name: result.name,
            result: result.content,
            durationMs: result.durationMs,
          });
        }
        event._resolveAll(results.map(({ id, content }) => ({ id, content })));
        break;
      }

      case 'tool_call_request': {
        currentWorkDir = await ensureHeadlessWorkDir(
          currentWorkDir,
          [event.tool],
          input.resolveWorkDir,
          input.onWorkDirResolved,
        );

        await input.onToolCall?.({
          id: event.tool.id,
          name: event.tool.name,
          arguments: event.tool.arguments,
        });

        const [result] = await executeToolBatch(
          [event.tool],
          executor,
          input.sessionId,
          currentWorkDir,
          toolExecutionSource,
          allowedTools,
          input.allowToolExecution,
          effectivePermissionMode,
        );
        if (result) {
          toolBudgetSummary = appendToolBudgetEntries(
            toolBudgetSummary,
            [{ name: result.name, content: result.content }],
          );
        }
        if (result) {
          input.onToolSummary?.(result.name, previewToolResult(result.content));
          await input.onToolResult?.({
            id: result.id,
            name: result.name,
            result: result.content,
            durationMs: result.durationMs,
          });
        }
        event._resolve(result?.content ?? 'Error: no result returned for tool');
        break;
      }

      case 'turn_complete':
        tokenUsage = event.tokenUsage;
        if (assistantTurnBuffer) {
          await input.onAssistantMessage?.(assistantTurnBuffer);
          assistantTurnBuffer = '';
        }
        break;

      case 'error':
        throw withToolBudgetSummary(
          event.error,
          getToolBudgetSummaryFromUnknown(event.error) ?? toolBudgetSummary,
        );

      default:
        break;
    }
  }

  return {
    finalText,
    finalReasoning,
    tokenUsage,
    toolBudgetSummary,
  };
}
