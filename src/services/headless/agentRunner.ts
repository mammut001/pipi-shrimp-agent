import { runChatTurn } from '@/core/QueryEngine';
import type { ToolCallParams, TokenUsage } from '@/core/types';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { StreamingToolExecutor, partitionTools } from '@/services/StreamingToolExecutor';

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
  workDir?: string;
  agentConfig?: ResolvedAgentConfig;
  resolveWorkDir?: () => Promise<string | null>;
  onWorkDirResolved?: (workDir: string) => Promise<void> | void;
  onTextDelta?: (chunk: string) => void;
  onReasoningDelta?: (chunk: string) => void;
  onStatus?: (message: string) => void;
  onToolSummary?: (toolName: string, preview: string) => void;
  onAssistantMessage?: (text: string) => Promise<void> | void;
  onToolCall?: (call: { id: string; name: string; arguments: string }) => Promise<void> | void;
  onToolResult?: (call: { id: string; name: string; result: string; durationMs: number }) => Promise<void> | void;
  timeoutMs?: number;
}

export interface HeadlessAgentRunnerResult {
  finalText: string;
  finalReasoning: string;
  tokenUsage?: TokenUsage;
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

function toolResultContent(content: string, errorMessage?: string): string {
  if (content) {
    return content;
  }
  if (errorMessage) {
    return `Error: ${errorMessage}`;
  }
  return 'Error: tool execution failed';
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
): Promise<Array<{ id: string; name: string; content: string; durationMs: number }>> {
  const manualResults: Array<{ id: string; name: string; content: string; durationMs: number }> = [];
  const executableTools: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

  for (const tool of tools) {
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
    });

    for (const result of batchResult.results) {
      const request = concurrent.find((candidate) => candidate.id === result.id);
      const content = toolResultContent(result.content, result.error_message);
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
    });
    const result = batchResult.results[0];
    const content = toolResultContent(result?.content ?? '', result?.error_message);
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
  const engine = runChatTurn(
    input.sessionId,
    input.initialMessages,
    input.systemPrompt,
    input.workDir,
    false,
    input.agentConfig,
  );

  let currentWorkDir = input.workDir;
  let finalText = '';
  let finalReasoning = '';
  let assistantTurnBuffer = '';
  let tokenUsage: TokenUsage | undefined;

  for await (const event of engine) {
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
        );
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
        throw event.error;

      default:
        break;
    }
  }

  return {
    finalText,
    finalReasoning,
    tokenUsage,
  };
}
