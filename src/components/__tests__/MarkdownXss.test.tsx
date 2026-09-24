/** @jest-environment jsdom */

import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import type { Message } from '@/types/chat';

const mockSetArtifactId = jest.fn();
const mockSetAgentPanelTab = jest.fn();
const mockUseUIStore = Object.assign(jest.fn(), {
  getState: () => ({
    setArtifactId: mockSetArtifactId,
    setAgentPanelTab: mockSetAgentPanelTab,
  }),
});

jest.mock('@/store', () => ({ useUIStore: mockUseUIStore }));
jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/services/vision/imageAttachments', () => ({
  buildImageDataUrl: () => '',
}));

jest.mock('@/skills/resume/resumeFlow', () => ({
  normalizeResumeTemplateMarkdown: (content: string) => content,
  shouldRenderResumeTemplateCarousel: () => false,
}));


jest.mock('react-markdown', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      ReactRuntime.createElement('div', {
        dangerouslySetInnerHTML: { __html: String(children ?? '') },
      }),
  };
});

jest.mock('../ChatImage', () => ({
  ChatImage: () => null,
}));

jest.mock('../ArtifactsBadge', () => ({
  ArtifactsBadge: () => null,
}));

import { ChatMessage } from '../ChatMessage';
import { MarkdownDocumentPreview } from '../document/MarkdownDocumentPreview';

const maliciousMarkdown = [
  '<script>window.__xss = true</script>',
  '<img src="x" onerror="window.__xss = true">',
  '<a href="javascript:alert(1)">unsafe link</a>',
].join('');

function expectNoUnsafeMarkup(container: HTMLElement) {
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('[onerror]')).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
}

describe('Markdown XSS sanitization (TOP-15-14)', () => {
  it('sanitizes raw HTML and unsafe links in MarkdownDocumentPreview', () => {
    const { container } = render(<MarkdownDocumentPreview body={maliciousMarkdown} />);
    expectNoUnsafeMarkup(container);
  });

  it('sanitizes raw HTML and unsafe links in assistant ChatMessage', () => {
    const message: Message = {
      id: 'message-xss',
      role: 'assistant',
      content: maliciousMarkdown,
      timestamp: 1,
    };
    const { container } = render(<ChatMessage message={message} />);
    expectNoUnsafeMarkup(container);
  });
});
