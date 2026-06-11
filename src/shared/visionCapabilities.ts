import type { ProviderName } from './providers';
import type { VisionCapability } from '@/types/vision';

const DEFAULT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const VISION_CAPABILITY_REGISTRY: VisionCapability[] = [
  {
    providerId: 'anthropic',
    modelIdPattern: /claude-(3|3\.5|3\.7|4|5|fable|mythos|opus|sonnet|haiku)/i,
    supportsVision: true,
    acceptedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    maxImagesPerRequest: 20,
    maxBytesPerImage: 5 * 1024 * 1024,
    maxTotalBytes: 30 * 1024 * 1024,
    encoding: ['base64'],
    notes: 'Anthropic vision via image content blocks',
  },
  {
    providerId: 'openai',
    modelIdPattern: /gpt-(4o|4\.1|4-vision|4\.5|5|5\.4|5\.5)/i,
    supportsVision: true,
    acceptedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    maxImagesPerRequest: 10,
    maxBytesPerImage: 20 * 1024 * 1024,
    maxTotalBytes: 40 * 1024 * 1024,
    encoding: ['base64', 'remote_url'],
  },
  {
    providerId: 'openai-compatible',
    modelIdPattern: /gpt-(4o|4\.1|4-vision|4\.5|5|5\.4|5\.5|vision)/i,
    supportsVision: true,
    acceptedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    maxImagesPerRequest: 10,
    maxBytesPerImage: 20 * 1024 * 1024,
    maxTotalBytes: 40 * 1024 * 1024,
    encoding: ['base64', 'remote_url'],
  },
  {
    providerId: 'openai-compatible',
    modelIdPattern: /deepseek-chat|deepseek-coder|deepseek-reasoner|deepseek-r1|deepseek-v3|deepseek-r1/i,
    supportsVision: false,
    acceptedMimeTypes: [],
    maxImagesPerRequest: 0,
    maxBytesPerImage: 0,
    maxTotalBytes: 0,
    encoding: [],
  },
  {
    providerId: 'deepseek',
    modelIdPattern: /deepseek-chat|deepseek-coder|deepseek-reasoner|deepseek-r1|deepseek-v3|deepseek-r1/i,
    supportsVision: false,
    acceptedMimeTypes: [],
    maxImagesPerRequest: 0,
    maxBytesPerImage: 0,
    maxTotalBytes: 0,
    encoding: [],
  },
  {
    providerId: 'minimax',
    modelIdPattern: /abab|MiniMax-Text|MiniMax-M/i,
    supportsVision: true,
    acceptedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    maxImagesPerRequest: 10,
    maxBytesPerImage: 20 * 1024 * 1024,
    maxTotalBytes: 40 * 1024 * 1024,
    encoding: ['base64', 'remote_url'],
    notes: 'MiniMax supports vision on newer models like MiniMax-M3 via OpenAI format.',
  },
];

function matchesCapability(capability: VisionCapability, modelId: string): boolean {
  if (capability.modelIdPattern instanceof RegExp) {
    capability.modelIdPattern.lastIndex = 0;
    return capability.modelIdPattern.test(modelId);
  }

  return capability.modelIdPattern === modelId;
}

export function lookupVisionCapability(
  providerId: ProviderName | string,
  modelId: string,
): VisionCapability | null {
  for (const capability of VISION_CAPABILITY_REGISTRY) {
    if (capability.providerId !== providerId) {
      continue;
    }
    if (matchesCapability(capability, modelId)) {
      return capability;
    }
  }

  return null;
}

export function supportsVision(
  providerId: ProviderName | string,
  modelId: string,
): boolean {
  return lookupVisionCapability(providerId, modelId)?.supportsVision ?? false;
}
