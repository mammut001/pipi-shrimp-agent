/**
 * @jest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type { Message } from '@/types/chat';

const mockSetArtifactId = jest.fn();
const mockSetAgentPanelTab = jest.fn();
const useUIStore = Object.assign(jest.fn(), {
  getState: () => ({
    setArtifactId: mockSetArtifactId,
    setAgentPanelTab: mockSetAgentPanelTab,
  }),
});

jest.mock('@/store', () => ({
  useUIStore,
}));

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/services/vision/imageAttachments', () => ({
  buildImageDataUrl: () => 'data:image/png;base64,abc',
}));

jest.mock('../ResumeTemplateCarousel', () => {
  const ReactRuntime = require('react');
  const Component = ({ dataJson }: { dataJson?: string }) =>
    ReactRuntime.createElement('div', { 'data-testid': 'resume-carousel' }, dataJson || '');
  return {
    __esModule: true,
    default: Component,
    ResumeTemplateCarousel: Component,
  };
});

jest.mock('react-markdown', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true,
    default: ({ components, children }: { components?: Record<string, unknown>; children?: React.ReactNode }) => {
      const text = String(children ?? '');
      const codeMatch = /```([a-zA-Z0-9_-]+)\n([\s\S]*?)```/m.exec(text);
      if (codeMatch) {
        const language = codeMatch[1];
        const codeContent = codeMatch[2].replace(/\n$/, '');
        const codeRenderer = (components as { code?: (props: { className?: string; children?: React.ReactNode }) => React.ReactNode } | undefined)?.code;
        if (typeof codeRenderer === 'function') {
          return ReactRuntime.createElement(
            ReactRuntime.Fragment,
            null,
            codeRenderer({
              className: `language-${language}`,
              children: codeContent,
            }),
          );
        }
      }
      return ReactRuntime.createElement('div', null, children);
    },
  };
});

jest.mock('../LazyCodeBlock', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => ReactRuntime.createElement('pre', null, children),
  };
});

jest.mock('../ChatImage', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true,
    ChatImage: ({ alt }: { alt: string }) => ReactRuntime.createElement('div', { 'data-testid': 'chat-image' }, alt),
  };
});

import { ChatMessage } from '../ChatMessage';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function renderMessage(message: Message, props: Partial<{ isStreaming: boolean }> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(React.createElement(ChatMessage, { message, ...props }));
    await Promise.resolve();
    await Promise.resolve();
  });

  return container;
}

describe('ChatMessage resume rendering', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockSetArtifactId.mockReset();
    mockSetAgentPanelTab.mockReset();
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
  });

  it('normalizes a resume-templates fence and renders the carousel path', async () => {
    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Please choose\n```resume-templates',
      timestamp: Date.now(),
    };

    const container = await renderMessage(message);
    expect(container.querySelector('[data-testid="resume-carousel"]')?.textContent).toBe('[]');
  });

  it('renders svg blocks through ChatImage instead of leaving raw svg/xml in the message body', async () => {
    const message: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: '```svg\n<?xml version="1.0"?><svg viewBox="0 0 10 10"></svg>\n```',
      timestamp: Date.now(),
    };

    const container = await renderMessage(message);
    expect(container.querySelector('[data-testid="chat-image"]')?.textContent).toBe('SVG Preview');
    expect(container.textContent).not.toContain('<svg');
    expect(container.textContent).not.toContain('<?xml');
  });

  it('renders a single reasoning block without emoji noise and stays collapsed after streaming ends', async () => {
    const message: Message = {
      id: 'msg-3',
      role: 'assistant',
      content: Array.from({ length: 10 }, (_, index) => `Answer chunk ${index + 1}`).join(' '),
      reasoning: Array.from({ length: 50 }, (_, index) => `Reasoning chunk ${index + 1}`).join('\n'),
      timestamp: Date.now(),
    };

    const container = await renderMessage(message, { isStreaming: false });
    const reasoningBlocks = container.querySelectorAll('[data-testid="reasoning-block"]');
    const reasoningContent = container.querySelector('[data-testid="reasoning-content"]');

    expect(reasoningBlocks).toHaveLength(1);
    expect(reasoningBlocks[0]?.hasAttribute('open')).toBe(false);
    expect(reasoningContent?.textContent).toContain('Reasoning chunk 1');
    expect(container.textContent).not.toContain('💭');
    expect(container.textContent).not.toContain('☁️');
  });
});