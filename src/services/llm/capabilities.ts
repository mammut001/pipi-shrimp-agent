import type { ProviderName } from '@/shared/providers';

export type ProviderCapabilityRecommendation = 'reflection' | 'agent' | 'chat' | 'vision';
export type ProviderToolCallCapability = 'openai' | 'anthropic' | 'none';
export type ProviderCapabilityId = ProviderName | 'gemini';
export type ProviderRequestHint = 'anthropic' | 'openai' | 'minimax' | 'deepseek' | 'gemini';

export type ProviderExecutionCapabilities = {
  supportsThinking: boolean;
  supportsToolCalls: boolean;
  supportsStreaming: boolean;
  usesResponsesApi: boolean;
  requiresToolOrdering: boolean;
  thinkingBudget?: number;
  maxOutputTokens?: number;
};

export type ProviderCapability = {
  id: string;
  displayName: string;
  streaming: boolean;
  toolCalls: ProviderToolCallCapability;
  jsonMode: boolean;
  jsonSchema: boolean;
  vision: boolean;
  maxContextTokens: number;
  recommendedFor: ProviderCapabilityRecommendation[];
};

const UNKNOWN_PROVIDER_CAPABILITY: ProviderCapability = {
  id: 'unknown',
  displayName: 'Unknown',
  streaming: false,
  toolCalls: 'none',
  jsonMode: false,
  jsonSchema: false,
  vision: false,
  maxContextTokens: 0,
  recommendedFor: [],
};

const ANTHROPIC_THINKING_MODEL_PATTERN = /claude-3-7|claude-opus-4|claude-sonnet-4|claude-haiku-4/i;

const PROVIDER_CAPABILITIES: Record<ProviderCapabilityId, ProviderCapability> = {
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    streaming: true,
    toolCalls: 'anthropic',
    jsonMode: false,
    jsonSchema: false,
    vision: true,
    maxContextTokens: 200_000,
    recommendedFor: ['reflection', 'agent', 'chat', 'vision'],
  },
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    streaming: true,
    toolCalls: 'openai',
    jsonMode: true,
    jsonSchema: true,
    vision: true,
    maxContextTokens: 1_000_000,
    recommendedFor: ['agent', 'chat', 'vision'],
  },
  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    streaming: true,
    toolCalls: 'openai',
    jsonMode: true,
    jsonSchema: false,
    vision: false,
    maxContextTokens: 1_000_000,
    recommendedFor: ['reflection', 'agent', 'chat'],
  },
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    streaming: true,
    toolCalls: 'openai',
    jsonMode: true,
    jsonSchema: false,
    vision: false,
    maxContextTokens: 128_000,
    recommendedFor: ['reflection', 'agent', 'chat'],
  },
  'anthropic-compatible': {
    id: 'anthropic-compatible',
    displayName: 'Anthropic Compatible',
    streaming: true,
    toolCalls: 'anthropic',
    jsonMode: false,
    jsonSchema: false,
    vision: false,
    maxContextTokens: 200_000,
    recommendedFor: ['agent', 'chat'],
  },
  'openai-compatible': {
    id: 'openai-compatible',
    displayName: 'OpenAI Compatible',
    streaming: true,
    toolCalls: 'openai',
    jsonMode: true,
    jsonSchema: false,
    vision: false,
    maxContextTokens: 128_000,
    recommendedFor: ['agent', 'chat'],
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    streaming: true,
    toolCalls: 'openai',
    jsonMode: false,
    jsonSchema: false,
    vision: true,
    maxContextTokens: 1_000_000,
    recommendedFor: ['chat', 'vision'],
  },
};

export function getCapability(providerId: string | null | undefined): ProviderCapability {
  if (!providerId) {
    return { ...UNKNOWN_PROVIDER_CAPABILITY };
  }

  const resolved = PROVIDER_CAPABILITIES[providerId as ProviderCapabilityId];
  if (!resolved) {
    return {
      ...UNKNOWN_PROVIDER_CAPABILITY,
      id: providerId,
      displayName: providerId,
    };
  }

  return {
    ...resolved,
    recommendedFor: [...resolved.recommendedFor],
  };
}

export function listProviderCapabilities(): ProviderCapability[] {
  return Object.values(PROVIDER_CAPABILITIES).map((capability) => ({
    ...capability,
    recommendedFor: [...capability.recommendedFor],
  }));
}

export function resolveProviderRequestHint(
  providerId: string | null | undefined,
  apiFormat?: string | null,
): ProviderRequestHint {
  switch (providerId) {
    case 'anthropic':
    case 'anthropic-compatible':
      return 'anthropic';
    case 'minimax':
      return 'minimax';
    case 'deepseek':
      return 'deepseek';
    case 'gemini':
      return 'gemini';
    case 'openai':
    case 'openai-compatible':
      return 'openai';
    default:
      return apiFormat === 'anthropic' ? 'anthropic' : 'openai';
  }
}

export function buildProviderExecutionCapabilities(input: {
  provider: string | null | undefined;
  apiFormat?: string | null;
  model?: string | null;
}): ProviderExecutionCapabilities {
  const capability = getCapability(input.provider);
  const providerHint = resolveProviderRequestHint(input.provider, input.apiFormat);
  const normalizedModel = input.model?.trim() ?? '';
  const supportsThinking = providerHint === 'anthropic'
    && ANTHROPIC_THINKING_MODEL_PATTERN.test(normalizedModel);

  return {
    supportsThinking,
    supportsToolCalls: capability.toolCalls !== 'none',
    supportsStreaming: capability.streaming,
    usesResponsesApi: input.provider === 'gemini',
    requiresToolOrdering: false,
    thinkingBudget: supportsThinking ? 5000 : undefined,
    maxOutputTokens: input.provider === 'deepseek' ? 8192 : undefined,
  };
}