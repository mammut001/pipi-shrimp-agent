import { invokeRustAPIStream } from '@/core/streamAdapter';
import {
  formatAgentConfigValidationError,
  getAgentConfigDiagnostics,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from './agentConfig';
import { extractErrorDetails } from '@/utils/errorFormat';

export interface ResolvedChatRequestOptions {
  messages: Array<Record<string, unknown>>;
  systemPrompt: string;
  sessionId: string;
  allowBrowserTools?: boolean;
  noTools?: boolean;
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
    sessionId: string;
    apiFormat?: string;
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
  const base = sanitizeEndpoint(config.baseUrl);
  const suffix = config.apiFormat === 'anthropic'
    ? '/v1/messages'
    : '/chat/completions';

  if (!base) {
    return suffix;
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

  return {
    params: {
      messages: options.messages,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl || '',
      systemPrompt: options.systemPrompt,
      noTools: options.noTools,
      allowBrowserTools: options.allowBrowserTools,
      sessionId: options.sessionId,
      apiFormat: config.apiFormat || undefined,
    },
    diagnostics,
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
