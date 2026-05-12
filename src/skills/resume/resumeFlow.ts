import type { QuestionnaireField } from '@/types/ui';

export const RESUME_ENGLISH_SECTION_TITLES = [
  'Summary',
  'Experience',
  'Projects',
  'Education',
  'Skills',
] as const;

export const RESUME_CHINESE_SECTION_TITLES = [
  '个人信息',
  '教育背景',
  '工作经历',
  '项目经历',
  '专业技能',
] as const;

export const RESUME_BILINGUAL_MODES = [
  'single mixed document',
  'separate Chinese/English sections',
] as const;

export const RESUME_CHINESE_ACTION_VERBS = [
  '主导',
  '负责',
  '设计',
  '优化',
  '落地',
  '提升',
  '降低',
] as const;

export const RESUME_BASIC_QUESTIONNAIRE_FIELDS: QuestionnaireField[] = [
  { id: 'language', label: 'Resume Language', type: 'select', options: ['English', '中文', 'Bilingual'], required: true },
  { id: 'name', label: 'Full Name', type: 'text', required: true },
  { id: 'title', label: 'Target Job Title', type: 'text', required: false },
  { id: 'email', label: 'Email', type: 'text', required: false },
  { id: 'phone', label: 'Phone', type: 'text', required: false },
  { id: 'location', label: 'City, Country', type: 'text', required: false },
  { id: 'linkedin', label: 'LinkedIn URL', type: 'text', required: false },
  { id: 'github', label: 'GitHub URL', type: 'text', required: false },
];

export const RESUME_CONTENT_QUESTIONNAIRE_FIELDS: QuestionnaireField[] = [
  { id: 'education', label: 'Education (school, degree, dates, GPA)', type: 'textarea', required: false },
  { id: 'experience', label: 'Work Experience (company, role, dates, what you did)', type: 'textarea', required: false },
  { id: 'projects', label: 'Projects (name, tech stack, description)', type: 'textarea', required: false },
  { id: 'skills', label: 'Skills (languages, frameworks, tools)', type: 'textarea', required: false },
];

export const RESUME_BASIC_QUESTIONNAIRE = {
  title: 'Resume — Basic Info',
  description: "Let's start with your contact details. Leave blank if not applicable.",
  fields: RESUME_BASIC_QUESTIONNAIRE_FIELDS,
} as const;

export const RESUME_CONTENT_QUESTIONNAIRE = {
  title: 'Resume — Content',
  description: "Now the meat of your resume. Rough notes are fine — I'll polish them.",
  fields: RESUME_CONTENT_QUESTIONNAIRE_FIELDS,
} as const;

const PLACEHOLDER_METRIC_PATTERN = /\[(?:N|X%|Y%|Z%|X|Y|Z)\]/g;

/**
 * Normalize resume-templates code blocks to a consistent multi-line format.
 * Handles both inline formats (```resume-templates[...]```) and
 * multi-line formats (```resume-templates\n[...]\n```).
 *
 * Uses proper code block boundary detection instead of simple string includes
 * to avoid false positives when payload content contains ``` sequences.
 */
export function normalizeResumeTemplateMarkdown(content: string): string {
  // Phase 1: Normalize common single-line variants to multi-line format first
  let normalized = content.replace(
    /```resume-templates\s*(\[[\s\S]*?\])\s*```/g,
    '\n```resume-templates\n$1\n```\n',
  );

  normalized = normalized.replace(
    /```resume-templates\s*(\[[\s\S]*?\])\s*$/gm,
    '\n```resume-templates\n$1\n```\n',
  );

  normalized = normalized.replace(/```resume-templates\s*$/gm, '\n```resume-templates\n[]\n```');

  // Phase 2: Verify we have a complete, well-formed code block
  const fence = '```resume-templates';
  const openingIndex = normalized.indexOf(fence);
  if (openingIndex === -1) {
    return normalized;
  }

  const afterOpening = normalized.slice(openingIndex + fence.length);

  // Find closing fence - must be at start of line (with possible leading whitespace)
  // This avoids false positives when ``` appears in payload content
  const closingMatch = afterOpening.match(/^[ \t]*```\s*$/m);

  if (closingMatch) {
    // We have a valid, complete code block - return as-is
    return normalized;
  }

  // No valid closing fence found - block is incomplete or malformed
  const firstTripleBacktick = afterOpening.indexOf('```');
  const payload = firstTripleBacktick >= 0
    ? afterOpening.slice(0, firstTripleBacktick).trim()
    : afterOpening.trim();

  const normalizedPayload = payload.startsWith('[') ? payload : '[]';

  const prefix = normalized.slice(0, openingIndex).trimEnd();
  return prefix + '\n\n```resume-templates\n' + normalizedPayload + '\n```\n';
}

export function shouldRenderResumeTemplateCarousel(language: string): boolean {
  return language === 'resume-templates' || language === 'resume';
}

export function shouldSkipResumeTemplateSelection(selectedTemplateId: string | null | undefined): boolean {
  return Boolean(selectedTemplateId);
}

export function findResumePlaceholderMetrics(content: string): string[] {
  return Array.from(new Set(content.match(PLACEHOLDER_METRIC_PATTERN) ?? []));
}

export function containsRawSvgXml(content: string): boolean {
  return /<\?xml[\s\S]*?>|<svg[\s>]|<\/svg>/i.test(content);
}

export function buildResumeDeliveryNotes(options: {
  usedFallbackTemplate?: boolean;
  content?: string;
}): string[] {
  const notes: string[] = [];
  const placeholderMetrics = findResumePlaceholderMetrics(options.content ?? '');

  if (options.usedFallbackTemplate) {
    notes.push(
      'The original template had a compatibility issue, so I used a built-in fallback template. The content is identical — only the visual style is simpler.',
    );
  }

  if (placeholderMetrics.length > 0) {
    notes.push(
      `I used placeholders for some metrics you didn't specify. Please replace ${placeholderMetrics.join(', ')} with your actual numbers before sending the resume.`,
    );
  }

  return notes;
}