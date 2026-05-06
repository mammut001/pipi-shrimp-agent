export type VisionEncoding = 'base64' | 'remote_url';

export interface ImageAttachment {
  id: string;
  source: 'upload' | 'paste' | 'screenshot' | 'tool_output' | 'workflow';
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  encoding: VisionEncoding;
  data: string;
  origPath?: string;
  caption?: string;
  createdAt: number;
}

export interface VisionCapability {
  providerId: string;
  modelIdPattern: RegExp | string;
  supportsVision: boolean;
  acceptedMimeTypes: string[];
  maxImagesPerRequest: number;
  maxBytesPerImage: number;
  maxTotalBytes: number;
  encoding: VisionEncoding[];
  notes?: string;
}

export type VisionPolicy =
  | 'auto'
  | 'native_only'
  | 'transcribe_only'
  | 'ocr_only'
  | 'disabled';

export interface VisionTranscribeConfig {
  configId: string | null;
  modelHint?: string;
  maxOutputTokens?: number;
  systemPrompt?: string;
}

export interface VisionSettings {
  policy: VisionPolicy;
  transcribe: VisionTranscribeConfig;
  enableLocalOcr: boolean;
  ocrLanguages: string[];
}

export interface VisionDecision {
  strategy: 'native' | 'transcribe' | 'ocr' | 'placeholder' | 'reject';
  reason: string;
  capability?: VisionCapability;
  transcribedText?: string;
  warnings: string[];
}

export interface VisionPipelineInput {
  attachments: ImageAttachment[];
  primaryModel: { providerId: string; modelId: string; configId?: string };
  policy: VisionPolicy;
  transcribeConfig: VisionTranscribeConfig;
  enableLocalOcr: boolean;
  agentScope: 'chat' | 'workflow_agent' | 'skill';
  agentId?: string;
}

export type VisionContentBlock =
  | { type: 'image'; attachment: ImageAttachment }
  | { type: 'text'; text: string; from: 'user_caption' | 'transcribe' | 'ocr' | 'placeholder' };

export interface VisionPipelineResult {
  decision: VisionDecision;
  contentBlocks: VisionContentBlock[];
}

export const DEFAULT_VISION_SETTINGS: VisionSettings = {
  policy: 'auto',
  transcribe: {
    configId: null,
    maxOutputTokens: 1200,
  },
  enableLocalOcr: true,
  ocrLanguages: ['eng'],
};

export type WorkflowVisionPolicy = 'inherit' | VisionPolicy;
