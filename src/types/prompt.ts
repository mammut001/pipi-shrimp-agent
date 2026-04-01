/**
 * Prompt system type definitions
 */

export interface PromptSection {
  id: string;
  label: string;
  order: number;
  cacheable: boolean;
  enabled: boolean;
  content: string;
  category: 'default' | 'override' | 'agent' | 'custom' | 'session' | 'append';
  description?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  sections: PromptSection[];
  createdAt: number;
  updatedAt: number;
  isDefault: boolean;
}

export interface PromptBuildResult {
  systemPrompt: string;
  sections: PromptSection[];
  tokenEstimate: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface PromptSectionTokenInfo {
  sectionId: string;
  label: string;
  tokens: number;
  percentage: number;
}
