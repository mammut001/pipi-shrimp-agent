import { describe, expect, it } from '@jest/globals';
import {
  buildResumeDeliveryNotes,
  containsRawSvgXml,
  findResumePlaceholderMetrics,
  normalizeResumeTemplateMarkdown,
  RESUME_BASIC_QUESTIONNAIRE,
  RESUME_BILINGUAL_MODES,
  RESUME_CHINESE_ACTION_VERBS,
  RESUME_CHINESE_SECTION_TITLES,
  RESUME_CONTENT_QUESTIONNAIRE,
  RESUME_ENGLISH_SECTION_TITLES,
  shouldRenderResumeTemplateCarousel,
  shouldSkipResumeTemplateSelection,
} from '../resumeFlow';

describe('resume flow contracts', () => {
  it('normalizes incomplete resume template fences so chat rendering can still trigger the carousel', () => {
    expect(normalizeResumeTemplateMarkdown('Please choose\n```resume-templates')).toContain('```resume-templates\n[]\n```');
  });

  it('keeps the two-step questionnaire contract explicit', () => {
    expect(RESUME_BASIC_QUESTIONNAIRE.title).toBe('Resume — Basic Info');
    expect(RESUME_BASIC_QUESTIONNAIRE.fields.map((field) => field.id)).toEqual([
      'language',
      'name',
      'title',
      'email',
      'phone',
      'location',
      'linkedin',
      'github',
    ]);
    expect(RESUME_CONTENT_QUESTIONNAIRE.fields.map((field) => field.id)).toEqual([
      'education',
      'experience',
      'projects',
      'skills',
    ]);
  });

  it('tracks the language and bullet style rules used by the skill', () => {
    expect(RESUME_ENGLISH_SECTION_TITLES).toEqual(['Summary', 'Experience', 'Projects', 'Education', 'Skills']);
    expect(RESUME_CHINESE_SECTION_TITLES).toEqual(['个人信息', '教育背景', '工作经历', '项目经历', '专业技能']);
    expect(RESUME_BILINGUAL_MODES).toEqual(['single mixed document', 'separate Chinese/English sections']);
    expect(RESUME_CHINESE_ACTION_VERBS).toEqual(['主导', '负责', '设计', '优化', '落地', '提升', '降低']);
  });

  it('detects placeholder metrics and resume-specific rendering branches', () => {
    expect(findResumePlaceholderMetrics('Improved conversion by [X%] with a team of [N].')).toEqual(['[X%]', '[N]']);
    expect(shouldRenderResumeTemplateCarousel('resume-templates')).toBe(true);
    expect(shouldRenderResumeTemplateCarousel('resume')).toBe(true);
    expect(shouldSkipResumeTemplateSelection('basic-resume')).toBe(true);
    expect(shouldSkipResumeTemplateSelection(null)).toBe(false);
  });

  it('flags raw svg/xml payloads and keeps fallback notes honest', () => {
    expect(containsRawSvgXml('<?xml version="1.0"?><svg viewBox="0 0 10 10"></svg>')).toBe(true);
    expect(containsRawSvgXml('✅ Resume generated successfully.')).toBe(false);

    const notes = buildResumeDeliveryNotes({
      usedFallbackTemplate: true,
      content: 'Reduced latency by [X%] for [N] users.',
    });
    expect(notes[0]).toContain('compatibility issue');
    expect(notes[0]).not.toContain('generated successfully using the brilliant-cv template');
    expect(notes[1]).toContain('[X%], [N]');
  });
});