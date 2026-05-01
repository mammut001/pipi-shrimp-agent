import { describe, expect, it } from '@jest/globals';
import {
  appendBrowserResultToSystemPrompt,
  createBrowserResultMessages,
  mapBrowserResponseArtifacts,
} from '../chatBrowserHandoff';

describe('chatBrowserHandoff', () => {
  it('creates a minimal user message for browser result follow-up', () => {
    expect(createBrowserResultMessages('What changed?')).toEqual([{ role: 'user', content: 'What changed?' }]);
    expect(createBrowserResultMessages('')[0].content).toContain('浏览器获取到的数据');
  });

  it('adds browser result and optional workDir context to the system prompt', () => {
    const prompt = appendBrowserResultToSystemPrompt('base', 'original question', 'browser data', '/work');

    expect(prompt).toContain('base');
    expect(prompt).toContain('Your working directory: `/work`');
    expect(prompt).toContain('original question');
    expect(prompt).toContain('browser data');
  });

  it('maps response artifacts to persisted chat artifacts', () => {
    expect(mapBrowserResponseArtifacts([
      { type: 'svg', content: '<svg />', title: 'Diagram', language: 'svg' },
    ], () => 'artifact-id')).toEqual([
      { id: 'artifact-id', type: 'svg', content: '<svg />', title: 'Diagram', language: 'svg' },
    ]);
  });
});
