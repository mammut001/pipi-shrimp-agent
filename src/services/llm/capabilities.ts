import type { ProviderName } from '@/shared/providers';

export type ProviderCapabilityRecommendation = 'reflection' | 'agent' | 'chat' | 'vision';
export type ProviderToolCallCapability = 'openai' | 'anthropic' | 'none';
export type ProviderCapabilityId = ProviderName | 'gemini';
export type ProviderRequestHint = 'anthropic' | 'openai' | 'minimax' | 'deepseek' | 'gemini';

export type ProviderExecutionCapabilities = {
  supportsThinking: boolean;
  supportsReasoning: boolean;
  supportsReasoningStream: boolean;
  supportsToolCalls: boolean;
  supportsToolOpenAI: boolean;
  supportsStreaming: boolean;
  supportsResponseFormat: boolean;
  supportsResponseFormatJsonSchema: boolean;
  supportsJsonMode: boolean;
  acceptsResponseFormat: boolean;
  acceptsReasoningParam: boolean;
  supportsVision: boolean;
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

const ANTHROPIC_THINKING_MODEL_PATTERN = /claude-3-7|claude-opus-4|claude-sonnet-4|claude-haiku-4|claude-5|claude-fable|claude-mythos/i;

function isDeepSeekReasoningModel(modelLower: string): boolean {
  return /reasoner|reasoning|(^|[-_.\s/])r1($|[-_.\s/])|v4/i.test(modelLower);
}

function isMiniMaxReasoningModel(modelLower: string): boolean {
  return /minimax-m[3-9]/i.test(modelLower) || modelLower.includes('reasoning');
}

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
    vision: true,
    maxContextTokens: 1_000_000,
    recommendedFor: ['reflection', 'agent', 'chat', 'vision'],
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
    jsonMode: false,
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
  const normalizedModel = input.model?.trim() ?? '';
  const modelLower = normalizedModel.toLowerCase();
  const providerId = input.provider ?? null;
  const providerHint = resolveProviderRequestHint(providerId, input.apiFormat);
  const supportsThinking = providerHint === 'anthropic'
    && ANTHROPIC_THINKING_MODEL_PATTERN.test(normalizedModel);
  const deepSeekReasoning = isDeepSeekReasoningModel(modelLower);
  const deepSeekSupportsToolCalls = Boolean(modelLower) && !deepSeekReasoning;
  const genericReasoning = modelLower.includes('reasoning');

  switch (providerId) {
    case 'anthropic':
      return {
        supportsThinking,
        supportsReasoning: supportsThinking,
        supportsReasoningStream: supportsThinking,
        supportsToolCalls: true,
        supportsToolOpenAI: false,
        supportsStreaming: true,
        supportsResponseFormat: false,
        supportsResponseFormatJsonSchema: false,
        supportsJsonMode: false,
        acceptsResponseFormat: false,
        acceptsReasoningParam: false,
        supportsVision: true,
        usesResponsesApi: false,
        requiresToolOrdering: false,
        thinkingBudget: supportsThinking ? 5000 : undefined,
      };
    case 'anthropic-compatible':
      return {
        supportsThinking,
        supportsReasoning: supportsThinking,
        supportsReasoningStream: supportsThinking,
        supportsToolCalls: true,
        supportsToolOpenAI: false,
        supportsStreaming: true,
        supportsResponseFormat: false,
        supportsResponseFormatJsonSchema: false,
        supportsJsonMode: false,
        acceptsResponseFormat: false,
        acceptsReasoningParam: false,
        supportsVision: false,
        usesResponsesApi: false,
        requiresToolOrdering: false,
        thinkingBudget: supportsThinking ? 5000 : undefined,
      };
    case 'openai': {
      const supportsToolCalls = !modelLower.includes('o1-preview') && !modelLower.includes('o1-mini');
      return {
        supportsThinking: false,
        supportsReasoning: false,
        supportsReasoningStream: false,
        supportsToolCalls,
        supportsToolOpenAI: true,
        supportsStreaming: true,
        supportsResponseFormat: true,
        supportsResponseFormatJsonSchema: true,
        supportsJsonMode: true,
        acceptsResponseFormat: true,
        acceptsReasoningParam: false,
        supportsVision: true,
        usesResponsesApi: false,
        requiresToolOrdering: false,
      };
    }
    case 'minimax': {
      const minimaxReasoning = isMiniMaxReasoningModel(modelLower);
      return {
        supportsThinking: false,
        supportsReasoning: minimaxReasoning,
        supportsReasoningStream: minimaxReasoning,
        supportsToolCalls: true,
        supportsToolOpenAI: true,
        supportsStreaming: true,
        supportsResponseFormat: true,
        supportsResponseFormatJsonSchema: false,
        supportsJsonMode: true,
        acceptsResponseFormat: true,
        acceptsReasoningParam: false,
        supportsVision: true,
        usesResponsesApi: false,
        requiresToolOrdering: false,
      };
    }
    case 'deepseek':
      return {
        supportsThinking: false,
        supportsReasoning: deepSeekReasoning,
        supportsReasoningStream: deepSeekReasoning,
        supportsToolCalls: deepSeekSupportsToolCalls,
        supportsToolOpenAI: deepSeekSupportsToolCalls,
        supportsStreaming: true,
        supportsResponseFormat: false,
        supportsResponseFormatJsonSchema: false,
        supportsJsonMode: true,
        acceptsResponseFormat: false,
        acceptsReasoningParam: false,
        supportsVision: false,
        usesResponsesApi: false,
        requiresToolOrdering: false,
        maxOutputTokens: 8192,
      };
    case 'gemini':
      return {
        supportsThinking: false,
        supportsReasoning: false,
        supportsReasoningStream: false,
        supportsToolCalls: true,
        supportsToolOpenAI: true,
        supportsStreaming: true,
        supportsResponseFormat: false,
        supportsResponseFormatJsonSchema: false,
        supportsJsonMode: false,
        acceptsResponseFormat: false,
        acceptsReasoningParam: false,
        supportsVision: true,
        usesResponsesApi: true,
        requiresToolOrdering: false,
      };
    case 'openai-compatible':
      return {
        supportsThinking: false,
        supportsReasoning: genericReasoning,
        supportsReasoningStream: false,
        supportsToolCalls: true,
        supportsToolOpenAI: true,
        supportsStreaming: true,
        supportsResponseFormat: false,
        supportsResponseFormatJsonSchema: false,
        supportsJsonMode: false,
        acceptsResponseFormat: false,
        acceptsReasoningParam: false,
        supportsVision: false,
        usesResponsesApi: false,
        requiresToolOrdering: false,
      };
    default:
      if (providerHint === 'anthropic') {
        return {
          supportsThinking,
          supportsReasoning: supportsThinking,
          supportsReasoningStream: supportsThinking,
          supportsToolCalls: true,
          supportsToolOpenAI: false,
          supportsStreaming: true,
          supportsResponseFormat: false,
          supportsResponseFormatJsonSchema: false,
          supportsJsonMode: false,
          acceptsResponseFormat: false,
          acceptsReasoningParam: false,
          supportsVision: false,
          usesResponsesApi: false,
          requiresToolOrdering: false,
          thinkingBudget: supportsThinking ? 5000 : undefined,
        };
      }

      return {
        supportsThinking: false,
        supportsReasoning: genericReasoning,
        supportsReasoningStream: false,
        supportsToolCalls: true,
        supportsToolOpenAI: true,
        supportsStreaming: true,
        supportsResponseFormat: false,
        supportsResponseFormatJsonSchema: false,
        supportsJsonMode: false,
        acceptsResponseFormat: false,
        acceptsReasoningParam: false,
        supportsVision: false,
        usesResponsesApi: false,
        requiresToolOrdering: false,
      };
  }
}