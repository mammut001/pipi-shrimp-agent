/**
 * defaultTemplate unit tests
 *
 * The default prompt template is the single source of truth for how the
 * agent learns about the Project Folder vs PiPi Output Folder vs
 * Context Files distinction. These tests guard the wording so a future
 * refactor can't silently regress the product semantics.
 */

import { describe, it, expect } from '@jest/globals';
import { createDefaultTemplate } from '@/services/prompt/defaultTemplate';

describe('defaultTemplate Project Folder section', () => {
  it('labels the working directory section as "Project Folder"', () => {
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection).toBeDefined();
    expect(workdirSection?.label).toBe('Project Folder');
  });

  it('uses the "Project Folder" heading in the rendered content', () => {
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection?.content).toContain('## Project Folder');
    expect(workdirSection?.content).toContain('{{workDir}}');
  });

  it('keeps the relative-path resolution rule for the Project Folder', () => {
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection?.content).toMatch(/Resolve all relative tool paths against the Project Folder/);
  });

  it('forbids writing generated artifacts into the Project Folder', () => {
    // Two-folder model: docs / memory / scratch files MUST land in
    // the PiPi Output Folder, not the user's repo. The prompt must
    // spell this out so the agent doesn't accidentally drop a
    // `.pipi-shrimp/` directory into the project.
    const template = createDefaultTemplate();
    const workdirSection = template.sections.find((section) => section.id === 'session-workdir');
    expect(workdirSection?.content).toMatch(
      /Do NOT write generated docs, memory, or scratch files into the Project Folder/,
    );
  });
});

describe('defaultTemplate PiPi Output Folder section', () => {
  it('exposes a session-pipi-output-folder section', () => {
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-pipi-output-folder');
    expect(section).toBeDefined();
    expect(section?.label).toBe('PiPi Output Folder');
  });

  it('describes the PiPi Output Folder as the app-owned output root', () => {
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-pipi-output-folder');
    expect(section?.content).toContain('## PiPi Output Folder');
    expect(section?.content).toContain('{{pipiOutputDir}}');
    expect(section?.content).toMatch(/app-owned output root/i);
  });

  it('tells the agent to write generated docs into the PiPi Output Folder', () => {
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-pipi-output-folder');
    expect(section?.content).toMatch(
      /Generated docs, memory, and chat outputs MUST land in the PiPi Output Folder/,
    );
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
    // Two-folder model wording update — the warning now references the
    // "Project Folder" (the user's repo) rather than the legacy
    // "Workspace Folder" label, so the agent doesn't confuse a
    // Context File's parent with the Project Folder.
    expect(section?.content).toMatch(/Do not assume a Context File's parent folder is the Project Folder/);
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

describe('defaultTemplate Document System section', () => {
  it('points generated docs at the PiPi Output Folder, not the Project Folder', () => {
    // The Document System rules must reflect the two-folder split:
    // docs land under the PiPi Output Folder, not the user's repo.
    const template = createDefaultTemplate();
    const section = template.sections.find((candidate) => candidate.id === 'session-docs-system');
    expect(section?.content).toContain('{{pipiOutputDir}}');
    expect(section?.content).toMatch(/PiPi Output Folder.*\.pipi-shrimp\/docs/i);
  });
});
