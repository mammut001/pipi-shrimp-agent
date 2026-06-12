/**
 * defaultTemplate unit tests
 *
 * The default prompt template is the single source of truth for how the
 * agent learns about the Workspace Folder vs Context Files distinction.
 * These tests guard the wording so a future refactor can't silently
 * regress the product semantics.
 */

import { describe, it, expect } from '@jest/globals';
import { createDefaultTemplate } from '@/services/prompt/defaultTemplate';

describe('defaultTemplate Workspace Folder section', () => {
  it('labels the working directory section as "Workspace Folder"', () => {
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection).toBeDefined();
    expect(workdirSection?.label).toBe('Workspace Folder');
  });

  it('uses the "Workspace Folder" heading in the rendered content', () => {
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection?.content).toContain('## Workspace Folder');
    expect(workdirSection?.content).toContain('{{workDir}}');
  });

  it('forbids writes outside the workspace unless explicitly asked', () => {
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection?.content).toMatch(/Do NOT write outside the Workspace Folder/);
  });

  it('tells the agent to resolve relative paths against the Workspace Folder', () => {
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection?.content).toMatch(/Resolve all relative tool paths against the Workspace Folder/);
  });
});

describe('defaultTemplate Context Files section', () => {
  it('labels the working files section as "Context Files"', () => {
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-working-files');
    expect(section).toBeDefined();
    expect(section?.label).toBe('Context Files');
  });

  it('describes context files as references, not workspace', () => {
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-working-files');
    expect(section?.content).toContain('## Context Files');
    expect(section?.content).toMatch(/explicit references/i);
  });

  it('warns the agent not to assume a context file parent is the workspace', () => {
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-working-files');
    expect(section?.content).toMatch(/Do not assume a Context File's parent folder is the Workspace Folder/);
  });

  it('still interpolates {{workingFilesList}} for backwards compatibility', () => {
    // Custom prompt templates may reference the same variable name. We keep
    // it as a stable contract even though the section now calls the files
    // "Context Files" in user-facing copy.
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-working-files');
    expect(section?.content).toContain('{{workingFilesList}}');
  });
});
