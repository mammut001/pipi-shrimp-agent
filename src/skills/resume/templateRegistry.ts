export type ResumeTemplateComplexity = 'simple' | 'medium' | 'advanced';
export type ResumeTemplateStability = 'stable' | 'advanced' | 'fallback-prone';

export interface ResumeTemplateDefinition {
  id: string;
  name: string;
  description: string;
  complexity: ResumeTemplateComplexity;
  bestFor: string[];
  previewPath: string;
  packageName: string;
  packageVersion: string;
  requiresFiles: string[];
  supportsChinese: boolean;
  stability: ResumeTemplateStability;
}

export const RESUME_TEMPLATE_REGISTRY: ResumeTemplateDefinition[] = [
  {
    id: 'basic-resume',
    name: 'Basic Resume',
    description: 'Clean single-column layout. Great for software engineers and new grads.',
    complexity: 'simple',
    bestFor: ['Most users', 'Tech roles', 'New grads'],
    previewPath: '/resume-previews/basic-resume.png',
    packageName: 'basic-resume',
    packageVersion: '0.2.9',
    requiresFiles: ['resume.typ'],
    supportsChinese: true,
    stability: 'stable',
  },
  {
    id: 'calligraphics',
    name: 'Calligraphics',
    description: 'Elegant two-column design with artistic flair. Strong fit for polished creative resumes.',
    complexity: 'medium',
    bestFor: ['Two-column designs', 'Creative professionals', 'Styled resumes'],
    previewPath: '/resume-previews/calligraphics.png',
    packageName: 'calligraphics',
    packageVersion: '1.0.0',
    requiresFiles: ['resume.typ'],
    supportsChinese: true,
    stability: 'stable',
  },
  {
    id: 'nabcv',
    name: 'Nabcv',
    description: 'TOML-driven sidebar layout with structured data sections and profile links.',
    complexity: 'medium',
    bestFor: ['Data-driven resumes', 'Structured content', 'TOML-first editing'],
    previewPath: '/resume-previews/nabcv.png',
    packageName: 'nabcv',
    packageVersion: '0.1.0',
    requiresFiles: ['cv.toml', 'resume.typ'],
    supportsChinese: true,
    stability: 'stable',
  },
  {
    id: 'grotesk-cv',
    name: 'Grotesk CV',
    description: 'Modern sans-serif style with warm tones and a richer metadata-driven layout.',
    complexity: 'advanced',
    bestFor: ['Modern layout', 'Custom branding', 'Detailed metadata'],
    previewPath: '/resume-previews/grotesk-cv.png',
    packageName: 'grotesk-cv',
    packageVersion: '1.0.5',
    requiresFiles: ['info.toml', 'resume.typ'],
    supportsChinese: true,
    stability: 'advanced',
  },
  {
    id: 'brilliant-cv',
    name: 'Brilliant CV',
    description: 'Polished multi-file layout with strong visual finish, but the most failure-prone API surface.',
    complexity: 'advanced',
    bestFor: ['Polished visual design', 'Detailed modules', 'International roles'],
    previewPath: '/resume-previews/brilliant-cv.png',
    packageName: 'brilliant-cv',
    packageVersion: '3.3.0',
    requiresFiles: [
      'metadata.toml',
      'resume.typ',
      'modules_en/experience.typ',
      'modules_en/education.typ',
      'modules_en/skills.typ',
    ],
    supportsChinese: true,
    stability: 'fallback-prone',
  },
];

export const RESUME_TEMPLATE_IDS = RESUME_TEMPLATE_REGISTRY.map((template) => template.id);

export function getResumeTemplateDefinition(templateId: string): ResumeTemplateDefinition | undefined {
  return RESUME_TEMPLATE_REGISTRY.find((template) => template.id === templateId);
}