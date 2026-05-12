/**
 * @jest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';

const mockSendMessage = jest.fn();
const mockSetSelectedResumeTemplate = jest.fn();
let chatState = {
  sendMessage: mockSendMessage,
  currentSessionId: 'session-1',
  isStreaming: false,
  streamingSessionId: null as string | null,
};
let uiState = {
  selectedResumeTemplates: {} as Record<string, string>,
  setSelectedResumeTemplate: mockSetSelectedResumeTemplate,
};

const useChatStore = jest.fn((selector: (state: typeof chatState) => unknown) => selector(chatState));
const useUIStore = jest.fn((selector: (state: typeof uiState) => unknown) => selector(uiState));

jest.mock('@/store', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => useChatStore(selector),
  useUIStore: (selector: (state: typeof uiState) => unknown) => useUIStore(selector),
}));

import { ResumeTemplateCarousel } from '../ResumeTemplateCarousel';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderCarousel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(React.createElement(ResumeTemplateCarousel));
  });

  return container;
}

describe('ResumeTemplateCarousel', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockSendMessage.mockReset();
    mockSetSelectedResumeTemplate.mockReset();
    chatState = {
      sendMessage: mockSendMessage,
      currentSessionId: 'session-1',
      isStreaming: false,
      streamingSessionId: null,
    };
    uiState = {
      selectedResumeTemplates: {},
      setSelectedResumeTemplate: mockSetSelectedResumeTemplate,
    };
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

  it('renders the registry-backed template cards when no template is selected', () => {
    const container = renderCarousel();
    const text = container.textContent ?? '';

    expect(text).toContain('Basic Resume');
    expect(text).toContain('Calligraphics');
    expect(text).toContain('Nabcv');
    expect(text).toContain('Grotesk CV');
    expect(text).toContain('Brilliant CV');
  });

  it('replaces the carousel with a confirmation banner when a template is already selected', () => {
    uiState = {
      selectedResumeTemplates: { 'session-1': 'basic-resume' },
      setSelectedResumeTemplate: mockSetSelectedResumeTemplate,
    };

    const container = renderCarousel();
    const text = container.textContent ?? '';

    expect(text).toContain('Resume template already selected');
    expect(text).toContain('Basic Resume');
    expect(text).not.toContain('Choose a Resume Template');
    expect(text).not.toContain('Use This Template');
  });
});