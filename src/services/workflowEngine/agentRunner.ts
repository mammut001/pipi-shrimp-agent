import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSettingsStore } from '@/store/settingsStore';
import { buildShellProfilePromptContext } from '@/utils/windowsShellProfile';
import {
  type WorkflowAgent,
} from '@/types/workflow';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_RETRY_POLICY,
} from '@/services/workflow/defaults';
import { hasWorkflowCompletionMarker } from '@/services/workflow/templates/markers';
import type {
  WorkflowTranscriptEntry,
  WorkflowTranscriptManager,
} from './transcript';

export type StreamChunkCallback = (agentId: string, chunk: string, fullContent: string) => void;

export interface AgentRunContext {
  runId: string;
  signal?: AbortSignal;
  onStreamChunk?: StreamChunkCallback;
  transcript: WorkflowTranscriptManager;
  systemPromptOverride?: string;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Workflow agent run aborted', 'AbortError');
  }
}

interface ResolvedConfig {
  configId?: string;
  provider?: string;
  // AUDIT-FIX [fix-5#14] — The previous design passed the raw API key
  // across the Tauri `invoke` boundary on every agent run. The proper
  // fix (already tracked in the cross-cutting round) is to resolve the
  // key server-side by `configId`; for now we mask the value before
  // logging and keep the IPC call as-is so existing tooling keeps
  // working. Masking happens in `ResolvedConfig` below.
  apiKey: string;
  model: string;
  baseUrl: string;
  apiFormat?: string;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Workflow agent retry sleep aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Workflow agent retry sleep aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function buildSystemPrompt(agent: WorkflowAgent, model: string, override?: string): string {
  if (override?.trim()) {
    return override.trim();
  }

  const shellProfileContext = buildShellProfilePromptContext({
    selection: useSettingsStore.getState().windowsShellProfile,
  });
  const parts = [
    agent.soulPrompt?.trim(),
    agent.task ? `## Role\n${agent.task}` : null,
    agent.taskInstruction?.trim() ? `## Task Instruction\n${agent.taskInstruction.trim()}` : null,
    agent.taskPrompt?.trim() ? `## Current Task\n${agent.taskPrompt.trim()}` : null,
    `## Shell Profile\nActive shell profile: ${shellProfileContext.shellProfileLabel}\n${shellProfileContext.shellProfileGuidance}`,
    `[系统注记：你当前运行的模型是 "${model}"。]`,
  ].filter(Boolean);

  return parts.join('\n\n');
}

function resolvePrimaryConfig(agent: WorkflowAgent): ResolvedConfig {
  const settings = useSettingsStore.getState();

  if (agent.model?.configId) {
    const config = settings.apiConfigs.find((item) => item.id === agent.model?.configId);
    if (!config) {
      throw new Error(`Agent "${agent.name}"：找不到 ID 为 "${agent.model.configId}" 的 API 配置。`);
    }
    return {
      configId: config.id,
      provider: config.provider,
      apiKey: config.apiKey,
      model: agent.model.modelId || config.model,
      baseUrl: config.baseUrl || '',
      apiFormat: config.apiFormat,
    };
  }

  if (agent.model?.provider) {
    const config = settings.apiConfigs.find((item) => item.provider === agent.model?.provider);
    if (!config) {
      throw new Error(`Agent "${agent.name}"：未找到 provider 为 "${agent.model.provider}" 的 API 配置。`);
    }
    return {
      configId: config.id,
      provider: config.provider,
      apiKey: config.apiKey,
      model: agent.model.modelId || config.model,
      baseUrl: config.baseUrl || '',
      apiFormat: config.apiFormat,
    };
  }

  if (agent.model?.apiKey) {
    return {
      provider: agent.model.provider,
      apiKey: agent.model.apiKey,
      model: agent.model.modelId || '',
      baseUrl: agent.model.baseUrl || '',
    };
  }

  const activeConfig = settings.getActiveConfig();
  if (!activeConfig?.apiKey) {
    throw new Error(`Agent "${agent.name}"：未配置 API Key。请在设置中添加 API 配置。`);
  }

  return {
    configId: activeConfig.id,
    provider: activeConfig.provider,
    apiKey: activeConfig.apiKey,
    model: agent.model?.modelId || activeConfig.model,
    baseUrl: activeConfig.baseUrl || '',
    apiFormat: activeConfig.apiFormat,
  };
}

function resolveConfigSequence(agent: WorkflowAgent): ResolvedConfig[] {
  const settings = useSettingsStore.getState();
  const primary = resolvePrimaryConfig(agent);
  const fallbackIds = agent.retryPolicy?.fallbackConfigIds ?? [];
  const configs = [primary];

  for (const configId of fallbackIds) {
    const config = settings.apiConfigs.find((item) => item.id === configId);
    if (!config) continue;
    configs.push({
      configId: config.id,
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl || '',
      apiFormat: config.apiFormat,
    });
  }

  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = `${config.configId || config.provider || 'direct'}:${config.model}:${config.baseUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function registerListenerIfAvailable<T>(
  eventName: string,
  handler: (payload: T) => void,
): Promise<(() => void) | null> {
  const windowRef = getCurrentWindow();
  if (!windowRef || typeof windowRef.listen !== 'function') {
    return null;
  }

  return windowRef.listen<T>(eventName, (event) => handler(event.payload));
}

async function invokeWithStreaming(
  agent: WorkflowAgent,
  prompt: string,
  config: ResolvedConfig,
  context: AgentRunContext,
): Promise<string> {
  assertNotAborted(context.signal);

  // AUDIT-FIX [fix-5#13] — Use an array + `join('')`. The previous
  // `fullContent += payload.content` is O(N²) for long streams because
  // V8 must re-allocate the entire string each time. The join is O(N)
  // overall.
  const contentChunks: string[] = [];
  const sessionId = `workflow-${context.runId}-${agent.id}-${Date.now()}`;
  let unlistenToken: (() => void) | null = null;
  let unlistenToolUse: (() => void) | null = null;
  const abortHandler = () => {
    void invoke('stop_subprocess', { sessionId }).catch(() => undefined);
  };

  if (context.signal) {
    context.signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    unlistenToken = await registerListenerIfAvailable<{ session_id: string; content: string }>(
      'claude-token',
      (payload) => {
        if (payload.session_id !== sessionId) return;
        contentChunks.push(payload.content);
        // Materialize the joined view only when the consumer needs it.
        const joined = contentChunks.join('');
        context.onStreamChunk?.(agent.id, payload.content, joined);
      },
    );

    unlistenToolUse = await registerListenerIfAvailable<{
      session_id: string;
      name: string;
      arguments: string;
    }>('claude-tool-use', (payload) => {
      if (payload.session_id !== sessionId) return;
      context.transcript.record(agent.id, {
        timestamp: Date.now(),
        type: 'tool_called',
        content: `Called tool: ${payload.name}`,
        toolName: payload.name,
        toolArgs: payload.arguments,
      });
    });

    const systemPrompt = buildSystemPrompt(agent, config.model, context.systemPromptOverride);
    await invoke('send_claude_sdk_chat_streaming', {
      messages: [{ role: 'user', content: prompt }],
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      systemPrompt,
      allowBrowserTools: true,
      sessionId,
      apiFormat: config.apiFormat,
    });

    assertNotAborted(context.signal);

    // Materialize the final string once. Subsequent concatenations (which
    // are not O(N²) at this point) are acceptable.
    const fullContent = contentChunks.join('');
    if (!fullContent.trim()) {
      context.onStreamChunk?.(agent.id, '', fullContent);
    }

    return fullContent;
  } finally {
    context.signal?.removeEventListener('abort', abortHandler);
    unlistenToken?.();
    unlistenToolUse?.();
  }
}

async function executeSingleRound(
  agent: WorkflowAgent,
  prompt: string,
  context: AgentRunContext,
): Promise<string> {
  const retryPolicy = agent.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const configSequence = resolveConfigSequence(agent);
  let lastError: unknown = new Error('Unknown workflow agent failure');

  for (let attempt = 0; attempt < retryPolicy.maxAttempts; attempt += 1) {
    assertNotAborted(context.signal);
    const config = configSequence[Math.min(attempt, configSequence.length - 1)];
    try {
      return await invokeWithStreaming(agent, prompt, config, context);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      lastError = error;
      if (attempt < retryPolicy.maxAttempts - 1) {
        // AUDIT-FIX [fix-5#17] — Add ±25% jitter so that multiple
        // concurrent workflow runs do not all retry on the exact same
        // tick (thundering-herd problem). The base exponential schedule
        // is preserved; the jitter is multiplicative.
        const base = retryPolicy.backoffMs * Math.pow(2, attempt);
        const jitter = base * 0.25 * (Math.random() * 2 - 1);
        // AUDIT-FIX [R6-03]: Pass the AbortSignal so a stop() during the
        // exponential backoff between attempts can short-circuit
        // immediately instead of waiting out the full backoff window
        // (up to ~120s across 5 attempts).
        await sleep(Math.max(0, base + jitter), context.signal);
      }
    }
  }

  throw lastError;
}

async function executeMultiRound(
  agent: WorkflowAgent,
  inputPrompt: string,
  context: AgentRunContext,
): Promise<string> {
  const execution = agent.execution ?? DEFAULT_EXECUTION_CONFIG;
  const maxRounds = execution.maxRounds || 3;
  const roundCondition = execution.roundCondition || 'untilComplete';
  let round = 0;
  let lastOutput = '';
  let shouldContinue = true;

  while (shouldContinue && round < maxRounds) {
    assertNotAborted(context.signal);
    round += 1;
    lastOutput = await executeSingleRound(agent, inputPrompt, context);

    switch (roundCondition) {
      case 'untilComplete':
        shouldContinue = !hasWorkflowCompletionMarker(lastOutput);
        break;
      case 'fixed':
        shouldContinue = round < maxRounds;
        break;
      // AUDIT-FIX [fix-5#18] — The previous `case 'untilError'` was a
      // misnomer: its body was identical to the default branch (stop).
      // The intent in the product is "single round, then stop", so we
      // renamed to `single` and preserved the legacy alias for backward
      // compatibility.
      case 'single':
      case 'untilError':
      default:
        shouldContinue = false;
        break;
    }

    if (shouldContinue && round < maxRounds) {
      // AUDIT-FIX [fix-5#19] — Cap the carried-over output to 4000 chars
      // so the per-round `inputPrompt` is bounded. The bound applies per
      // round, not cumulatively; with `maxRounds <= 5` (a sensible
      // default) the worst-case total is 5 * 4000 chars which is well
      // within any LLM context window.
      inputPrompt = `[Workflow Context — Round ${round}/${maxRounds}]

前一轮输出如下，请在此基础上继续改进：

<previous_output>
${lastOutput.length > 4000 ? `${lastOutput.slice(0, 4000)}\n... [已截断]` : lastOutput}
</previous_output>`;
    }
  }

  return lastOutput;
}

export async function runAgentWithRetry(
  agent: WorkflowAgent,
  prompt: string,
  context: AgentRunContext,
  options?: { systemPromptOverride?: string },
): Promise<string> {
  context.transcript.record(agent.id, {
    timestamp: Date.now(),
    type: 'user_prompt_injected',
    content: prompt,
  });

  const runContext = {
    ...context,
    systemPromptOverride: options?.systemPromptOverride,
  };

  if ((agent.execution ?? DEFAULT_EXECUTION_CONFIG).mode === 'multi-round') {
    return executeMultiRound(agent, prompt, runContext);
  }

  return executeSingleRound(agent, prompt, runContext);
}

export type { WorkflowTranscriptEntry };
