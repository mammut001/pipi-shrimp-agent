import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  RESUME_TEMPLATE_IDS,
  RESUME_TEMPLATE_REGISTRY,
} from '../templateRegistry';

function readDeclaredTemplateIds(): string[] {
  const skillPath = path.join(process.cwd(), 'src/skills/resume/SKILL.md');
  const skillContent = readFileSync(skillPath, 'utf8');
  const section = skillContent.split('**Available templates**')[1] ?? '';
  const matches = Array.from(section.matchAll(/^\| `([^`]+)` \|/gm));
  return matches.map((match) => match[1]);
}

describe('resume template registry', () => {
  it('contains every template declared in SKILL.md', () => {
    expect(RESUME_TEMPLATE_IDS).toEqual(readDeclaredTemplateIds());
  });

  it('uses runtime preview assets that exist in public/resume-previews', () => {
    for (const template of RESUME_TEMPLATE_REGISTRY) {
      const relativePreviewPath = template.previewPath.replace(/^\//, '');
      const absolutePreviewPath = path.join(process.cwd(), 'public', relativePreviewPath);
      expect(existsSync(absolutePreviewPath)).toBe(true);
    }
  });

  it('marks brilliant-cv as fallback-prone and keeps the other built-ins in the registry', () => {
    expect(RESUME_TEMPLATE_REGISTRY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'basic-resume', stability: 'stable' }),
        expect.objectContaining({ id: 'calligraphics', stability: 'stable' }),
        expect.objectContaining({ id: 'nabcv', stability: 'stable' }),
        expect.objectContaining({ id: 'grotesk-cv', stability: 'advanced' }),
        expect.objectContaining({ id: 'brilliant-cv', stability: 'fallback-prone' }),
      ]),
    );
  });
});