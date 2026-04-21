import { runChatTurn } from '@/core/QueryEngine';
import type { ToolCallParams, TokenUsage } from '@/core/types';
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
  resolveWorkDir?: () => Promise<string | null>;
  onWorkDirResolved?: (workDir: string) => Promise<void> | void;
  onTextDelta?: (chunk: string) => void;
  onReasoningDelta?: (chunk: string) => void;
  onStatus?: (message: string) => void;
  onToolSummary?: (toolName: string, preview: string) => void;
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
  onToolSummary?: (toolName: string, preview: string) => void,
): Promise<Array<{ id: string; content: string }>> {
  const manualResults: Array<{ id: string; content: string }> = [];
  const executableTools: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

  for (const tool of tools) {
    if (tool.name === 'get_current_workspace') {
      manualResults.push({
        id: tool.id,
        content: workDir
          ? JSON.stringify({ work_dir: workDir, message: `Current working directory: ${workDir}` })
          : JSON.stringify({ error: true, message: 'No working directory is currently bound.' }),
      });
      onToolSummary?.(tool.name, previewToolResult(manualResults[manualResults.length - 1].content));
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
  const results: Array<{ id: string; content: string }> = [...manualResults];

  if (concurrent.length > 0) {
    const batchResult = await executor.executeBatch(concurrent, {
      sessionId,
      workDir,
    });

    for (const result of batchResult.results) {
      const request = concurrent.find((candidate) => candidate.id === result.id);
      const content = toolResultContent(result.content, result.error_message);
      results.push({ id: result.id, content });
      onToolSummary?.(request?.name ?? 'unknown', previewToolResult(content));
    }
  }

  for (const request of serial) {
    const batchResult = await executor.executeBatch([request], {
      sessionId,
      workDir,
    });
    const result = batchResult.results[0];
    const content = toolResultContent(result?.content ?? '', result?.error_message);
    results.push({ id: request.id, content });
    onToolSummary?.(request.name, previewToolResult(content));
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
  );

  let currentWorkDir = input.workDir;
  let finalText = '';
  let finalReasoning = '';
  let tokenUsage: TokenUsage | undefined;

  for await (const event of engine) {
    switch (event.type) {
      case 'text_delta':
        finalText += event.content;
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

        const results = await executeToolBatch(
          event.tools,
          executor,
          input.sessionId,
          currentWorkDir,
          input.onToolSummary,
        );
        event._resolveAll(results);
        break;
      }

      case 'tool_call_request': {
        currentWorkDir = await ensureHeadlessWorkDir(
          currentWorkDir,
          [event.tool],
          input.resolveWorkDir,
          input.onWorkDirResolved,
        );

        const [result] = await executeToolBatch(
          [event.tool],
          executor,
          input.sessionId,
          currentWorkDir,
          input.onToolSummary,
        );
        event._resolve(result?.content ?? 'Error: no result returned for tool');
        break;
      }

      case 'turn_complete':
        tokenUsage = event.tokenUsage;
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