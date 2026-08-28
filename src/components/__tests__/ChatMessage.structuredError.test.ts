/**
 * @jest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type { Message } from '@/types/chat';

const mockSetSessionProjectDir = jest.fn();
const mockActiveSessionId = 'test-session-1';

jest.mock('@/store', () => ({
  useUIStore: Object.assign(jest.fn(), {
    getState: () => ({
      setArtifactId: jest.fn(),
      setAgentPanelTab: jest.fn(),
    }),
  }),
  useChatStore: Object.assign(jest.fn(), {
    getState: () => ({
      currentSessionId: mockActiveSessionId,
      setSessionProjectDir: mockSetSessionProjectDir,
    }),
  }),
}));

jest.mock('@/i18n', () => ({
  t: (key: string) => {
    const dict: Record<string, string> = {
      'common.save': '保存',
      'common.details': '详细诊断信息',
    };
    return dict[key] || key;
  },
  getCurrentLocale: () => 'zh-CN',
}));

jest.mock('@/services/vision/imageAttachments', () => ({
  buildImageDataUrl: () => 'data:image/png;base64,abc',
}));

jest.mock('../ResumeTemplateCarousel', () => ({
  __esModule: true,
  default: () => null,
  ResumeTemplateCarousel: () => null,
}));

jest.mock('react-markdown', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      ReactRuntime.createElement('div', null, children),
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

async function renderMessage(message: Message) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(React.createElement(ChatMessage, { message }));
    await Promise.resolve();
    await Promise.resolve();
  });

  return container;
}

describe('ChatMessage structured error card rendering', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockSetSessionProjectDir.mockReset();
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

  it('renders structured error card for assistant JSON error message with action button', async () => {
    const message: Message = {
      id: 'msg-err-1',
      role: 'assistant',
      content: JSON.stringify({
        error: true,
        error_kind: 'permission_denied',
        message: 'No Project Folder is bound to this session. Please select a Project Folder before reading or writing files.',
      }),
      timestamp: Date.now(),
    };

    const container = await renderMessage(message);
    expect(container.textContent).toContain('未绑定项目文件夹');
    expect(container.textContent).toContain('当前会话还没有绑定项目文件夹');
    expect(container.textContent).toContain('（未执行任何文件或命令操作）');

    const buttons = Array.from(container.querySelectorAll('button'));
    const selectFolderButton = buttons.find((b) => b.textContent?.includes('选择项目文件夹'));
    expect(selectFolderButton).toBeDefined();

    // Click button to verify triggering folder binding
    await act(async () => {
      selectFolderButton?.click();
    });
    expect(mockSetSessionProjectDir).toHaveBeenCalledWith('test-session-1');
  });

  it('renders structured error card for user tool result with missing project folder error', async () => {
    const rawError = JSON.stringify({
      error: true,
      error_kind: 'permission_denied',
      message: 'No Project Folder is bound to this session. Please select a Project Folder before reading or writing files.',
    });
    const message: Message = {
      id: 'msg-tool-1',
      role: 'user',
      content: `__TOOL_RESULT__:call_123:${rawError}`,
      timestamp: Date.now(),
    };

    const container = await renderMessage(message);
    expect(container.textContent).toContain('未绑定项目文件夹');
    expect(container.textContent).toContain('ID: call_123');
  });
});
