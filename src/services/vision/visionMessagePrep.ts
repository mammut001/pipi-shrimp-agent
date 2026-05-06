import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { useSettingsStore } from '@/store/settingsStore';
import { lookupVisionCapability } from '@/shared/visionCapabilities';
import type { ImageAttachment } from '@/types/vision';
import { describeImageAttachments } from './imageAttachments';

type VisionReadyMessage = Record<string, unknown> & {
  role?: string;
  content?: string;
  attachments?: unknown;
};

function coerceImageAttachments(value: unknown): ImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((attachment): attachment is ImageAttachment => (
    Boolean(attachment)
    && typeof attachment === 'object'
    && typeof (attachment as { mime?: unknown }).mime === 'string'
    && typeof (attachment as { data?: unknown }).data === 'string'
  ));
}

function buildFallbackText(reason: string, attachmentCount: number, description: string): string {
  return [
    '',
    `[Vision fallback] ${reason}.`,
    `[Vision fallback] ${attachmentCount} image attachment${attachmentCount > 1 ? 's were' : ' was'} not sent natively.`,
    `[Vision fallback] ${description}.`,
  ].join('\n');
}

export function prepareMessagesForVision(
  messages: VisionReadyMessage[],
  config: ResolvedAgentConfig,
): VisionReadyMessage[] {
  const settings = useSettingsStore.getState().visionSettings;
  const capability = lookupVisionCapability(config.provider, config.model);
  const nativeEnabled = settings.policy !== 'disabled' && settings.policy !== 'ocr_only' && settings.policy !== 'transcribe_only';
  const nativeSupported = nativeEnabled && capability?.supportsVision;
  const fallbackReason = settings.policy === 'disabled'
    ? 'Vision is disabled in settings'
    : settings.policy === 'ocr_only'
      ? 'Current policy forces OCR fallback'
      : settings.policy === 'transcribe_only'
        ? 'Current policy forces transcriber fallback'
        : `Model ${config.model} does not advertise native vision support`;

  return messages.map((message) => {
    const attachments = coerceImageAttachments(message.attachments);
    if (message.role !== 'user' || attachments.length === 0) {
      return message;
    }

    if (nativeSupported) {
      return message;
    }

    const content = typeof message.content === 'string' ? message.content : '';
    const description = describeImageAttachments(attachments);
    return {
      ...message,
      content: `${content}${buildFallbackText(fallbackReason, attachments.length, description)}`.trim(),
      attachments: undefined,
    };
  });
}
