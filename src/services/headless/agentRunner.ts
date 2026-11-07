import { getSessionHandle } from '@/core/runtime';
import type { ToolCallParams, TokenUsage } from '@/core/types';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import type { ExecutionModeId } from '@/services/executionMode';
import { StreamingToolExecutor } from '@/services/StreamingToolExecutor';
import { partitionToolsByMetadata, toolNamesRequireWorkspace } from '@/services/tools/toolMetadata';
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
import {
  appendCompletionLedgerEntry,
  buildCompletionRepairMessage,
  buildRepairUserMessage,
  buildStallNudge,
  detectStall,
  estimateCostUsd,
  evaluateCompletion,
  parseDeliveryReport,
  renderCompletionLedgerMarkdown,
  runAcceptanceCommands,
  type CompletionContract,
  type CompletionLedger,
  type CompletionRecord,
} from '@/services/completion';
import { CompletionRejectedError } from '@/services/completion/errors';

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
  noTools?: boolean;
  maxToolRounds?: number;
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
  /**
   * Optional rewrite of parsed tool arguments after JSON.parse and before
   * execution. AutoResearch uses this to map original experimentDir paths
   * onto the iteration code checkout.
   */
  rewriteToolArguments?: (
    args: Record<string, unknown>,
    toolName: string,
  ) => Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  completion?: CompletionContract;
  completionWorkDir?: string;
  completionPermissionMode?: PermissionMode;
  completionExecutionMode?: ExecutionModeId | string;
  completionToolSource?: ToolExecutionSource;
  /** Model config id trail for stronger-model retry + ledger. First entry is the primary model. */
  completionModelTrail?: string[];
  /** Retry acceptance failures on the next model config in the trail. */
  completionRetryOnModelTrail?: boolean;
  /** Per-million-token pricing used for the completion ledger cost estimate. */
  completionPricing?: { inputPerMillion?: number; outputPerMillion?: number };
  /** Persist the completion ledger markdown (workflow run file writer). */
  completionPersistLedger?: (markdown: string) => Promise<void> | void;
}

export interface HeadlessAgentRunnerResult {
  finalText: string;
  finalReasoning: string;
  tokenUsage?: TokenUsage;
  toolBudgetSummary: ToolBudgetSummary;
  completion?: CompletionRecord;
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

  let needsWorkDir = tools.some((tool) => tool.name === 'get_current_workspace');
  if (!needsWorkDir) {
    try {
      needsWorkDir = await toolNamesRequireWorkspace(tools.map((tool) => tool.name));
    } catch {
      // Metadata is a safety hint. If the registry cannot be queried, fail
      // closed by resolving a workspace rather than guessing that none is needed.
      needsWorkDir = tools.length > 0;
    }
  }

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

function applyToolArgumentRewrite(
  tool: ToolCallParams,
  rewrite?: HeadlessAgentRunnerInput['rewriteToolArguments'],
): ToolCallParams {
  if (!rewrite) {
    return tool;
  }
  try {
    const parsed = JSON.parse(tool.arguments || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return tool;
    }
    const next = rewrite(parsed as Record<string, unknown>, tool.name);
    return { ...tool, arguments: JSON.stringify(next) };
  } catch {
    return tool;
  }
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
  rewriteToolArguments?: HeadlessAgentRunnerInput['rewriteToolArguments'],
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
    if (rewriteToolArguments && parsedArguments && typeof parsedArguments === 'object') {
      parsedArguments = rewriteToolArguments(parsedArguments, tool.name);
    }

    executableTools.push({
      id: tool.id,
      name: tool.name,
      arguments: parsedArguments,
    });
  }

  const { concurrent, serial } = await partitionToolsByMetadata(executableTools);
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

async function getNextEngineEvent<T>(
  generator: AsyncGenerator<T, void, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<IteratorResult<T, void>> {
  if (signal?.aborted) {
    throw new DOMException('Headless agent turn aborted', 'AbortError');
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Headless agent turn timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const abortPromise = new Promise<never>((_, reject) => {
    if (signal) {
      abortListener = () => {
        reject(new DOMException('Headless agent turn aborted', 'AbortError'));
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
  });

  try {
    return await Promise.race([
      generator.next(),
      timeoutPromise,
      abortPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

export async function runHeadlessAgentTurn(
  input: HeadlessAgentRunnerInput,
): Promise<HeadlessAgentRunnerResult> {
  const executor = new StreamingToolExecutor({ timeoutMs: input.timeoutMs ?? 300_000 });
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
  const turnDeadlineMs = input.timeoutMs ?? 300_000;

  const turnAbortController = new AbortController();
  let onInputAbort: (() => void) | null = null;
  if (input.signal) {
    if (input.signal.aborted) {
      turnAbortController.abort();
    } else {
      onInputAbort = () => turnAbortController.abort();
      input.signal.addEventListener('abort', onInputAbort, { once: true });
    }
  }

  const sessionHandle = getSessionHandle(input.sessionId);
  const runOptions = {
    noTools: input.noTools ?? (input.allowedTools?.length === 0 ? true : undefined),
    allowedTools: input.allowedTools,
    maxToolRounds: input.maxToolRounds
      ?? useSettingsStore.getState().agentSettings?.maxToolRounds
      ?? DEFAULT_AGENT_SETTINGS.maxToolRounds,
    executionModeId: typeof effectiveExecutionMode === 'string' ? effectiveExecutionMode : undefined,
    signal: turnAbortController.signal,
    timeoutMs: input.timeoutMs,
  };

  let currentWorkDir = input.workDir;
  let finalText = '';
  let finalReasoning = '';
  let assistantTurnBuffer = '';
  let tokenUsage: TokenUsage | undefined;
  let toolBudgetSummary = createToolBudgetSummary(
    useSettingsStore.getState().agentSettings?.maxToolRounds ?? DEFAULT_AGENT_SETTINGS.maxToolRounds,
  );

  const startTime = Date.now();
  const toolSummaries: string[] = [];
  const toolNames: string[] = [];
  let toolRoundsUsed = 0;
  const maxToolRounds = runOptions.maxToolRounds
    ?? useSettingsStore.getState().agentSettings?.maxToolRounds
    ?? DEFAULT_AGENT_SETTINGS.maxToolRounds;
  let released = false;
  let activeAgentConfig = input.agentConfig;
  const modelTrail: string[] = [
    ...(input.completionModelTrail ?? []),
    ...(input.agentConfig?.configId ? [input.agentConfig.configId] : []),
  ].filter((item, index, arr) => item.trim().length > 0 && arr.indexOf(item) === index);
  let ledger: CompletionLedger | undefined;
  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;

  async function consumeTurn(
    initialMessages: HeadlessMessage[],
  ): Promise<void> {
    const engine = sessionHandle.runTurn({
      initialMessages,
      systemPrompt: constrainedSystemPrompt,
      projectRoot: input.workDir,
      allowBrowserTools: false,
      requestConfig: activeAgentConfig,
      options: runOptions,
      pipiOutputDir: input.pipiOutputDir,
    });
    try {
      while (true) {
        const remainingMs = turnDeadlineMs - (Date.now() - startTime);
        if (remainingMs <= 0) {
          turnAbortController.abort();
          throw new Error(`Headless agent turn timed out after ${turnDeadlineMs}ms`);
        }
        if (turnAbortController.signal.aborted) {
          throw new DOMException('Headless agent turn aborted', 'AbortError');
        }

        let step: IteratorResult<any, void>;
        try {
          step = await getNextEngineEvent(engine, Math.max(1, remainingMs), turnAbortController.signal);
        } catch (err) {
          turnAbortController.abort();
          throw err;
        }
        if (step.done) {
          break;
        }

        const event = step.value;

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
          const batchTools = (event.tools as ToolCallParams[]).map((tool: ToolCallParams) =>
            applyToolArgumentRewrite(tool, input.rewriteToolArguments),
          );
          currentWorkDir = await ensureHeadlessWorkDir(
            currentWorkDir,
            batchTools,
            input.resolveWorkDir,
            input.onWorkDirResolved,
          );

          for (const tool of batchTools) {
            await input.onToolCall?.({
              id: tool.id,
              name: tool.name,
              arguments: tool.arguments,
            });
          }

          try {
            const results = await executeToolBatch(
              batchTools,
              executor,
              input.sessionId,
              currentWorkDir,
              toolExecutionSource,
              allowedTools,
              input.allowToolExecution,
              effectivePermissionMode,
              effectiveExecutionMode,
              input.rewriteToolArguments,
            );
            toolBudgetSummary = appendToolBudgetEntries(
              toolBudgetSummary,
              results.map(({ name, content }) => ({ name, content })),
            );
            for (const result of results) {
              toolSummaries.push(`${result.name}: ${previewToolResult(result.content).slice(0, 300)}`);
              toolNames.push(result.name);
              input.onToolSummary?.(result.name, previewToolResult(result.content));
              await input.onToolResult?.({
                id: result.id,
                name: result.name,
                result: result.content,
                durationMs: result.durationMs,
              });
            }
            toolRoundsUsed += 1;
            sessionHandle.submitToolResults(
              event.requestId,
              results.map(({ id, content }) => ({ id, content })),
            );
          } catch (toolError) {
            const message = toolError instanceof Error ? toolError.message : String(toolError);
            sessionHandle.submitToolResults(
              event.requestId,
              batchTools.map((tool) => ({
                id: tool.id,
                content: `Error: ${message}`,
              })),
            );
            throw toolError;
          }
          break;
        }

        case 'tool_call_request': {
          const rewrittenTool = applyToolArgumentRewrite(event.tool, input.rewriteToolArguments);
          currentWorkDir = await ensureHeadlessWorkDir(
            currentWorkDir,
            [rewrittenTool],
            input.resolveWorkDir,
            input.onWorkDirResolved,
          );

          await input.onToolCall?.({
            id: rewrittenTool.id,
            name: rewrittenTool.name,
            arguments: rewrittenTool.arguments,
          });

          let result: { id: string; name: string; content: string; durationMs: number } | undefined;
          try {
            [result] = await executeToolBatch(
              [rewrittenTool],
              executor,
              input.sessionId,
              currentWorkDir,
              toolExecutionSource,
              allowedTools,
              input.allowToolExecution,
              effectivePermissionMode,
              effectiveExecutionMode,
              input.rewriteToolArguments,
            );
          } catch (toolError) {
            const message = toolError instanceof Error ? toolError.message : String(toolError);
            sessionHandle.submitToolResults(event.requestId, [{
              id: rewrittenTool.id,
              content: `Error: ${message}`,
            }]);
            throw toolError;
          }
          if (result) {
            toolBudgetSummary = appendToolBudgetEntries(
              toolBudgetSummary,
              [{ name: result.name, content: result.content }],
            );
            toolSummaries.push(`${result.name}: ${previewToolResult(result.content).slice(0, 300)}`);
            toolNames.push(result.name);
            toolRoundsUsed += 1;
            input.onToolSummary?.(result.name, previewToolResult(result.content));
            await input.onToolResult?.({
              id: result.id,
              name: result.name,
              result: result.content,
              durationMs: result.durationMs,
            });
          }
          sessionHandle.submitToolResults(event.requestId, [{
            id: rewrittenTool.id,
            content: result?.content ?? 'Error: no result returned for tool',
          }]);
          break;
        }

        case 'turn_complete':
          tokenUsage = event.tokenUsage;
          if (tokenUsage) {
            cumulativeInputTokens += tokenUsage.input_tokens ?? 0;
            cumulativeOutputTokens += tokenUsage.output_tokens ?? 0;
          }
          if (assistantTurnBuffer) {
            await input.onAssistantMessage?.(assistantTurnBuffer);
            assistantTurnBuffer = '';
          }
          break;

        case 'error': {
          const runtimeError = new Error(event.error);
          throw withToolBudgetSummary(
            runtimeError,
            getToolBudgetSummaryFromUnknown(event.error) ?? toolBudgetSummary,
          );
        }

        default:
          break;
        }
      }
    } finally {
      await engine.return?.().catch(() => {});
    }
  }

  function releaseTurnResources(): void {
    if (released) {
      return;
    }
    released = true;
    if (input.signal && onInputAbort) {
      input.signal.removeEventListener('abort', onInputAbort);
    }
    turnAbortController.abort();
  }

  function summarizeTools(): string {
    return toolSummaries.slice(-20).join('\n');
  }

  async function checkCompletion(text: string): Promise<{ pass: boolean; reasons: string[]; outputs: string[]; stallReasons: string[] }> {
    const contract = input.completion;
    if (!contract) {
      return { pass: true, reasons: [], outputs: [], stallReasons: [] };
    }
    const acceptanceResults = await runAcceptanceCommands(contract.acceptanceCommands, {
      workDir: input.completionWorkDir ?? currentWorkDir,
      permissionMode: input.completionPermissionMode ?? effectivePermissionMode,
      executionMode: typeof (input.completionExecutionMode ?? effectiveExecutionMode) === 'string'
        ? String(input.completionExecutionMode ?? effectiveExecutionMode)
        : undefined,
      toolExecutionSource: input.completionToolSource ?? toolExecutionSource,
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs,
    });
    const evaluation = evaluateCompletion(contract, { finalText: text, acceptanceResults });
    const parsed = parseDeliveryReport(text);
    const filesChanged = parsed.ok ? parsed.report.files_changed : [];
    const stall = detectStall({
      toolNames,
      filesChanged,
      toolRoundsUsed,
      toolRoundsMax: maxToolRounds,
    });
    const stallReasons = evaluation.pass ? [] : stall.reasons;
    return {
      pass: evaluation.pass,
      reasons: [...evaluation.reasons, ...stallReasons],
      outputs: acceptanceResults
        .filter((result) => result.status !== 'pass')
        .map((result) => `${result.command}\n${result.stdout}\n${result.stderr}\n${result.detail ?? ''}`.trim()),
      stallReasons,
    };
  }

  function completionRecord(repairs: number, reasons: string[]): CompletionRecord {
    return {
      status: 'pass',
      repairs,
      reasons,
      modelTrail: [...modelTrail],
      tokenUsage: {
        input_tokens: cumulativeInputTokens,
        output_tokens: cumulativeOutputTokens,
        model: tokenUsage?.model ?? activeAgentConfig?.model,
      },
      estimatedCostUsd: estimateCostUsd(cumulativeInputTokens, cumulativeOutputTokens, input.completionPricing),
    };
  }

  async function persistLedger(status: 'pass' | 'failed', repairs: number, reasons: string[]): Promise<void> {
    if (!input.completionPersistLedger) {
      return;
    }
    ledger = appendCompletionLedgerEntry(ledger, {
      status,
      repairs,
      reasons,
      modelTrail: [...modelTrail],
      inputTokens: cumulativeInputTokens,
      outputTokens: cumulativeOutputTokens,
      estimatedCostUsd: estimateCostUsd(cumulativeInputTokens, cumulativeOutputTokens, input.completionPricing),
      acceptanceCommands: (input.completion?.acceptanceCommands ?? []).map((item) => item.command),
    });
    try {
      await input.completionPersistLedger(renderCompletionLedgerMarkdown(ledger));
    } catch {
      // Ledger persistence is observability-only; never fail the turn.
    }
  }

  function switchToNextModel(): boolean {
    const currentId = activeAgentConfig?.configId;
    const currentIndex = currentId ? modelTrail.indexOf(currentId) : -1;
    const nextId = modelTrail[currentIndex + 1];
    if (!nextId || !input.onStatus) {
      return false;
    }
    const settings = useSettingsStore.getState();
    const nextConfig = settings.apiConfigs.find((item) => item.id === nextId);
    if (!nextConfig || !activeAgentConfig) {
      return false;
    }
    activeAgentConfig = {
      ...activeAgentConfig,
      configId: nextConfig.id,
      provider: nextConfig.provider,
      providerLabel: nextConfig.provider,
      apiKey: nextConfig.apiKey,
      hasApiKey: Boolean(nextConfig.apiKey),
      hasBaseUrl: Boolean(nextConfig.baseUrl),
      model: nextConfig.model,
      baseUrl: nextConfig.baseUrl || '',
      apiFormat: nextConfig.apiFormat || '',
    };
    input.onStatus(`验收失败，已切换到更强模型配置「${nextConfig.id}」重试。`);
    return true;
  }

  try {
    await consumeTurn(input.initialMessages);

    const contract = input.completion;
    if (!contract) {
      return {
        finalText,
        finalReasoning,
        tokenUsage,
        toolBudgetSummary,
      };
    }

    const firstCheck = await checkCompletion(finalText);
    if (firstCheck.pass) {
      await persistLedger('pass', 0, []);
      return {
        finalText,
        finalReasoning,
        tokenUsage,
        toolBudgetSummary,
        completion: completionRecord(0, []),
      };
    }

    const maxRepairs = Math.max(0, contract.maxRepairTurns);
    if (maxRepairs >= 1) {
      const stallNote = firstCheck.stallReasons.length > 0 ? `\n${buildStallNudge(firstCheck.stallReasons)}` : '';
      const repairMessage = buildCompletionRepairMessage({
        evaluation: { pass: false, reasons: firstCheck.reasons, failureKinds: [], detail: `${firstCheck.reasons.join('\n')}${stallNote}` },
        attempt: 1,
        maxAttempts: maxRepairs,
      });
      const failedText = finalText;
      finalText = '';
      assistantTurnBuffer = '';
      await consumeTurn([
        ...input.initialMessages,
        { role: 'assistant', content: failedText },
        {
          role: 'user',
          content: buildRepairUserMessage({
            assistantText: failedText,
            toolSummary: summarizeTools(),
            repairMessage,
          }),
        },
      ]);

      const secondCheck = await checkCompletion(finalText);
      if (secondCheck.pass) {
        await persistLedger('pass', 1, []);
        return {
          finalText,
          finalReasoning,
          tokenUsage,
          toolBudgetSummary,
          completion: completionRecord(1, []),
        };
      }

      const shouldTryStrongerModel = Boolean(
        input.completionRetryOnModelTrail ?? contract.retryOnStrongerModel,
      ) && secondCheck.reasons.some((reason) => reason.startsWith('acceptance_failed'));
      if (shouldTryStrongerModel && switchToNextModel()) {
        const retryText = finalText;
        finalText = '';
        assistantTurnBuffer = '';
        await consumeTurn([
          ...input.initialMessages,
          { role: 'assistant', content: retryText },
          {
            role: 'user',
            content: buildRepairUserMessage({
              assistantText: retryText,
              toolSummary: summarizeTools(),
              repairMessage: [
                '验收命令仍然失败，已为你切换到更强模型配置重试。',
                ...secondCheck.reasons.map((reason) => `- ${reason}`),
                '请用新模型重新检查实现并补齐缺失工作，然后重新输出完整正文和合法 [[DELIVERY]] 块。',
              ].join('\n'),
            }),
          },
        ]);
        const thirdCheck = await checkCompletion(finalText);
        if (thirdCheck.pass) {
          await persistLedger('pass', 2, []);
          return {
            finalText,
            finalReasoning,
            tokenUsage,
            toolBudgetSummary,
            completion: completionRecord(2, []),
          };
        }
        await persistLedger('failed', 2, thirdCheck.reasons);
        throw new CompletionRejectedError(thirdCheck.reasons, thirdCheck.outputs, {
          modelTrail: [...modelTrail],
          stalled: thirdCheck.stallReasons.length > 0,
        });
      }

      await persistLedger('failed', 1, secondCheck.reasons);
      throw new CompletionRejectedError(secondCheck.reasons, secondCheck.outputs, {
        modelTrail: [...modelTrail],
        stalled: secondCheck.stallReasons.length > 0,
      });
    }
    await persistLedger('failed', 0, firstCheck.reasons);
    throw new CompletionRejectedError(firstCheck.reasons, firstCheck.outputs, {
      modelTrail: [...modelTrail],
      stalled: firstCheck.stallReasons.length > 0,
    });
  } finally {
    releaseTurnResources();
  }
}
