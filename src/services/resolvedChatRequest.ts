import { invokeRustAPIStream } from '@/core/streamAdapter';
import {
  formatAgentConfigValidationError,
  getAgentConfigDiagnostics,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from './agentConfig';
import {
  buildProviderExecutionCapabilities,
  resolveProviderRequestHint,
  type ProviderExecutionCapabilities,
} from '@/services/llm/capabilities';
import {
  DEFAULT_CONTEXT_BUDGET_LIMITS,
  pruneMessagesForBudget,
  pruneTextForBudget,
  type ContextBudgetOptions,
} from './context/contextBudget';
import { extractErrorDetails } from '@/utils/errorFormat';

export interface ResolvedChatRequestOptions {
  messages: Array<Record<string, unknown>>;
  systemPrompt: string;
  sessionId: string;
  allowBrowserTools?: boolean;
  noTools?: boolean;
  allowedTools?: string[];
  contextBudget?: ContextBudgetOptions;
  responseFormat?: { type: 'json_object' };
}

export interface ResolvedChatRequestDiagnostics {
  selectedConfigName: string;
  selectedProvider: string;
  selectedModel: string;
  apiFormat: string;
  hasApiKey: boolean;
  hasBaseURL: boolean;
  adapterName: string;
  endpointHost: string | null;
  endpointPreview: string;
  authorizationHeaderPresent: boolean;
  estimatedContextChars: number;
  contextWasPruned: boolean;
  droppedContextCount: number;
  droppedContextReasons: string[];
}

export interface ResolvedChatRequestBuildResult {
  params: {
    messages: Array<Record<string, unknown>>;
    apiKey: string;
    model: string;
    baseUrl: string;
    systemPrompt: string;
    noTools?: boolean;
    allowBrowserTools?: boolean;
    allowedTools?: string[];
    sessionId: string;
    provider?: string;
    apiFormat?: string;
    providerCapabilities?: ProviderExecutionCapabilities;
    responseFormat?: { type: 'json_object' };
  };
  diagnostics: ResolvedChatRequestDiagnostics;
}

export interface ResolvedChatConnectionResult {
  latencyMs: number;
  diagnostics: ResolvedChatRequestDiagnostics;
}

export interface ResolvedChatConnectionError extends Error {
  diagnostics: ResolvedChatRequestDiagnostics;
  httpCode?: string;
  requestId?: string;
}

function sanitizeEndpoint(endpoint: string): string {
  return endpoint
    .split('?')[0]
    .split('#')[0]
    .replace(/\/+$/, '');
}

function getEndpointHost(endpoint: string): string | null {
  if (!endpoint) {
    return null;
  }

  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

export function buildEndpointPreview(config: ResolvedAgentConfig): string {
  let base = sanitizeEndpoint(config.baseUrl);
  const suffix = config.apiFormat === 'anthropic'
    ? '/v1/messages'
    : '/chat/completions';

  if (!base) {
    return suffix;
  }

  // The Anthropic endpoint is always <host>/v1/messages. If the base URL
  // already carries a trailing "/v1" (the conventional Anthropic default),
  // strip it so the preview does not show a doubled "/v1/v1/messages" path.
  // This mirrors the Rust helper `build_anthropic_url`.
  if (config.apiFormat === 'anthropic' && base.endsWith('/v1')) {
    base = base.slice(0, -3);
  }

  return base.endsWith(suffix)
    ? base
    : `${base}${suffix}`;
}

export function getResolvedChatDiagnostics(
  config: ResolvedAgentConfig,
): ResolvedChatRequestDiagnostics {
  const baseDiagnostics = getAgentConfigDiagnostics(config);
  const endpointPreview = buildEndpointPreview(config);

  return {
    ...baseDiagnostics,
    apiFormat: config.apiFormat || '',
    endpointHost: getEndpointHost(endpointPreview),
    endpointPreview,
    estimatedContextChars: 0,
    contextWasPruned: false,
    droppedContextCount: 0,
    droppedContextReasons: [],
  };
}

export function buildResolvedChatRequest(
  config: ResolvedAgentConfig,
  options: ResolvedChatRequestOptions,
): ResolvedChatRequestBuildResult {
  const issues = validateResolvedAgentConfig(config);
  if (issues.length > 0) {
    throw new Error(formatAgentConfigValidationError(config, issues));
  }

  const diagnostics = getResolvedChatDiagnostics(config);
  if (config.apiFormat === 'openai' && !diagnostics.authorizationHeaderPresent) {
    throw new Error(
      `Agent API config invalid: selected config '${config.name}' would send an empty Authorization header.`,
    );
  }

  const systemPromptBudget = pruneTextForBudget(
    options.systemPrompt,
    options.contextBudget?.strict ? 40_000 : 60_000,
    'system prompt',
  );
  const budgetedMessages = pruneMessagesForBudget(options.messages, {
    ...options.contextBudget,
    maxChars: Math.max(
      4_000,
      (options.contextBudget?.maxChars ?? DEFAULT_CONTEXT_BUDGET_LIMITS.maxChars) - systemPromptBudget.estimatedChars,
    ),
  });
  const droppedContextReasons = [
    ...systemPromptBudget.droppedReasons,
    ...budgetedMessages.droppedReasons,
  ];
  const estimatedContextChars = systemPromptBudget.estimatedChars + budgetedMessages.estimatedChars;
  const contextWasPruned = systemPromptBudget.wasPruned || budgetedMessages.wasPruned;
  const droppedContextCount = budgetedMessages.droppedCount + (systemPromptBudget.wasPruned ? 1 : 0);

  return {
    params: {
      messages: budgetedMessages.messages,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl || '',
      systemPrompt: systemPromptBudget.text,
      noTools: options.noTools,
      allowBrowserTools: options.noTools ? false : options.allowBrowserTools,
      allowedTools: options.allowedTools?.length ? [...options.allowedTools] : undefined,
      sessionId: options.sessionId,
      provider: resolveProviderRequestHint(config.provider, config.apiFormat),
      apiFormat: config.apiFormat || undefined,
      providerCapabilities: buildProviderExecutionCapabilities({
        provider: config.provider,
        apiFormat: config.apiFormat,
        model: config.model,
      }),
      responseFormat: options.responseFormat,
    },
    diagnostics: {
      ...diagnostics,
      estimatedContextChars,
      contextWasPruned,
      droppedContextCount,
      droppedContextReasons,
    },
  };
}

export async function testResolvedChatConnection(
  config: ResolvedAgentConfig,
  sessionId = `api-test-${Date.now()}`,
): Promise<ResolvedChatConnectionResult> {
  const request = buildResolvedChatRequest(config, {
    messages: [{ role: 'user', content: 'Connection test. Reply with OK.' }],
    systemPrompt: 'You are a connection test. Reply with OK only.',
    sessionId,
    allowBrowserTools: false,
    noTools: true,
  });

  console.info('[API Test] Resolved config', {
    selectedConfigName: request.diagnostics.selectedConfigName,
    selectedProvider: request.diagnostics.selectedProvider,
    selectedModel: request.diagnostics.selectedModel,
    apiFormat: request.diagnostics.apiFormat,
    hasApiKey: request.diagnostics.hasApiKey,
    hasBaseURL: request.diagnostics.hasBaseURL,
    endpointHost: request.diagnostics.endpointHost,
    authorizationHeaderPresent: request.diagnostics.authorizationHeaderPresent,
    apiKeyLength: request.params.apiKey?.length ?? 0,
    apiKeyPreview: request.params.apiKey
      ? `${request.params.apiKey.substring(0, 4)}...${request.params.apiKey.substring(request.params.apiKey.length - 4)}`
      : '<empty>',
    baseUrl: request.params.baseUrl,
  });

  const startedAt = Date.now();

  try {
    for await (const _chunk of invokeRustAPIStream(request.params)) {
      // Drain the stream until completion.
    }

    return {
      latencyMs: Date.now() - startedAt,
      diagnostics: request.diagnostics,
    };
  } catch (error) {
    const details = extractErrorDetails(error);
    const connectionError = new Error(details.message) as ResolvedChatConnectionError;
    connectionError.name = 'ResolvedChatConnectionError';
    connectionError.diagnostics = request.diagnostics;
    connectionError.httpCode = details.httpCode;
    connectionError.requestId = details.requestId;
    throw connectionError;
  }
}
