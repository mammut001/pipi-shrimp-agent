/**
 * @jest-environment jsdom
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useChatInputSubmission } from '../useChatInputSubmission';
import type { ComposerBlock } from '../blocks/types';

const mockQuickCheckBrowserIntent = jest.fn((msg: string) => msg.startsWith('browser:'));
const mockHandleChatBrowserWorkflow = jest.fn(async (_msg: string) => true);

jest.mock('@/utils/chatBrowserBridge', () => ({
  quickCheckBrowserIntent: (msg: string) => mockQuickCheckBrowserIntent(msg),
  handleChatBrowserWorkflow: (msg: string) => mockHandleChatBrowserWorkflow(msg),
}));

const mockClearDraftPair = jest.fn();
jest.mock('../draftPersistence', () => ({
  clearDraftPair: (...args: unknown[]) => mockClearDraftPair(...args),
}));

const mockSendMessage = jest.fn(async () => {});
jest.mock('@/store', () => ({
  useChatStore: (selector?: (s: any) => any) => {
    const state = {
      sendMessage: mockSendMessage,
    };
    return selector ? selector(state) : state;
  },
}));

describe('useChatInputSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuickCheckBrowserIntent.mockImplementation((msg: string) => msg.startsWith('browser:'));
    mockHandleChatBrowserWorkflow.mockImplementation(async () => true);
  });

  it('noops when empty and no attachments or meaningful blocks', async () => {
    const setInput = jest.fn();
    const setAttachments = jest.fn();
    const resetComposer = jest.fn();
    const onSend = jest.fn();
    const sendMessage = jest.fn();

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: '',
        setInput,
        attachments: [],
        setAttachments,
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer,
        composerOpen: false,
        composerBlocks: [],
        showStopControl: false,
        onSend,
        sendMessage,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();
  });

  it('clears draft on successful send path', async () => {
    let currentInput = 'Hello world';
    const setInput = jest.fn((val: any) => {
      currentInput = typeof val === 'function' ? val(currentInput) : val;
    });
    let currentAttachments: any[] = [{ id: 'a1' }];
    const setAttachments = jest.fn((val: any) => {
      currentAttachments = typeof val === 'function' ? val(currentAttachments) : val;
    });
    const resetComposer = jest.fn();
    const onSend = jest.fn();
    const sendMessage = jest.fn(async () => {});

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: currentInput,
        setInput,
        attachments: currentAttachments as any,
        setAttachments,
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer,
        composerOpen: false,
        composerBlocks: [],
        currentSessionId: 'sess-123',
        showStopControl: false,
        onSend,
        sendMessage,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSend).toHaveBeenCalledWith('Hello world');
    expect(sendMessage).toHaveBeenCalledWith('Hello world', 'sess-123', {
      attachments: [{ id: 'a1' }],
    });
    expect(setInput).toHaveBeenCalledWith('');
    expect(setAttachments).toHaveBeenCalledWith([]);
    expect(resetComposer).toHaveBeenCalled();
    expect(mockClearDraftPair).toHaveBeenCalledWith('draft_test');
    expect(mockClearDraftPair).toHaveBeenCalledWith('block_test');
  });

  it('preserves input on send failure', async () => {
    let currentInput = 'my precious prompt';
    const setInput = jest.fn((val: any) => {
      currentInput = typeof val === 'function' ? val(currentInput) : val;
    });
    let currentAttachments: any[] = [{ id: 'img-1' }];
    const setAttachments = jest.fn((val: any) => {
      currentAttachments = typeof val === 'function' ? val(currentAttachments) : val;
    });
    const resetComposer = jest.fn();
    const sendMessage = jest.fn(async () => {
      throw new Error('Network error');
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'my precious prompt',
        setInput,
        attachments: [{ id: 'img-1' }] as any,
        setAttachments,
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer,
        composerOpen: false,
        composerBlocks: [],
        showStopControl: false,
        sendMessage,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(sendMessage).toHaveBeenCalled();
    expect(setInput).toHaveBeenLastCalledWith('my precious prompt');
    expect(setAttachments).toHaveBeenLastCalledWith([{ id: 'img-1' }]);
    expect(result.current.isSubmitting).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it('browser confirm path sets browserIntentCandidate without sending', async () => {
    mockQuickCheckBrowserIntent.mockReturnValueOnce(true);
    const sendMessage = jest.fn();

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'browser: search weather',
        setInput: jest.fn(),
        attachments: [],
        setAttachments: jest.fn(),
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer: jest.fn(),
        composerOpen: false,
        composerBlocks: [],
        showStopControl: false,
        sendMessage,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.browserIntentCandidate).toBe('browser: search weather');
  });

  it('handleCancelBrowserIntent clears candidate and focuses textareaRef', async () => {
    mockQuickCheckBrowserIntent.mockReturnValueOnce(true);
    const mockFocus = jest.fn();
    const textareaRef = {
      current: {
        focus: mockFocus,
      } as any,
    };

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'browser: search weather',
        setInput: jest.fn(),
        attachments: [],
        setAttachments: jest.fn(),
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer: jest.fn(),
        composerOpen: false,
        composerBlocks: [],
        showStopControl: false,
        textareaRef,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(result.current.browserIntentCandidate).toBe('browser: search weather');

    act(() => {
      result.current.handleCancelBrowserIntent();
    });

    expect(result.current.browserIntentCandidate).toBeNull();
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  it('send-as-normal compiles when composerOpen', async () => {
    const sendMessage = jest.fn(async () => {});
    const setInput = jest.fn();
    const setAttachments = jest.fn();

    const blocks: ComposerBlock[] = [
      {
        id: 'intent-1',
        type: 'intent',
        detail: 'Build authentication module',
      } as any,
    ];

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'browser: intent candidate',
        setInput,
        attachments: [],
        setAttachments,
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer: jest.fn(),
        composerOpen: true,
        composerBlocks: blocks,
        projectDir: '/workspace/project',
        pipiOutputDir: '/workspace/output',
        showStopControl: false,
        sendMessage,
      }),
    );

    act(() => {
      result.current.setBrowserIntentCandidate('browser: intent candidate');
    });

    await act(async () => {
      await result.current.handleSendAsNormalMessage();
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [sentMsg] = sendMessage.mock.calls[0] as [string];
    expect(sentMsg).toContain('# TASK SPECIFICATION');
    expect(sentMsg).toContain('Build authentication module');
    expect(sentMsg).toContain('browser: intent candidate');
  });

  it('submits via onSend in callback-only mode without calling sendMessage', async () => {
    const onSend = jest.fn(async () => {});
    const sendMessage = jest.fn();
    const setInput = jest.fn();

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'custom callback message',
        setInput,
        attachments: [],
        setAttachments: jest.fn(),
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer: jest.fn(),
        composerOpen: false,
        composerBlocks: [],
        submitMode: 'callback-only',
        showStopControl: false,
        onSend,
        sendMessage,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSend).toHaveBeenCalledWith('custom callback message', []);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith('');
  });

  it('preserves input in callback-only mode if onSend rejects', async () => {
    const onSend = jest.fn(async () => {
      throw new Error('callback failed');
    });
    const setInput = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'custom callback message',
        setInput,
        attachments: [],
        setAttachments: jest.fn(),
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer: jest.fn(),
        composerOpen: false,
        composerBlocks: [],
        submitMode: 'callback-only',
        showStopControl: false,
        onSend,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSend).toHaveBeenCalled();
    expect(setInput).toHaveBeenLastCalledWith('custom callback message');
    expect(result.current.isSubmitting).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it('handleConfirmBrowserIntent calls handleChatBrowserWorkflow and clears draft if handled', async () => {
    mockHandleChatBrowserWorkflow.mockResolvedValueOnce(true);
    const setInput = jest.fn();

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'browser: scrape news',
        setInput,
        attachments: [],
        setAttachments: jest.fn(),
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer: jest.fn(),
        composerOpen: false,
        composerBlocks: [],
        showStopControl: false,
      }),
    );

    act(() => {
      result.current.setBrowserIntentCandidate('browser: scrape news');
    });

    await act(async () => {
      await result.current.handleConfirmBrowserIntent();
    });

    expect(mockHandleChatBrowserWorkflow).toHaveBeenCalledWith('browser: scrape news');
    expect(setInput).toHaveBeenCalledWith('');
  });

  it('handleConfirmBrowserIntent preserves input and candidate if workflow is unhandled', async () => {
    mockHandleChatBrowserWorkflow.mockResolvedValueOnce(false);
    const setInput = jest.fn();

    const { result } = renderHook(() =>
      useChatInputSubmission({
        input: 'browser: scrape news',
        setInput,
        attachments: [],
        setAttachments: jest.fn(),
        draftStorageKey: 'draft_test',
        blockDraftStorageKey: 'block_test',
        resetComposer: jest.fn(),
        composerOpen: false,
        composerBlocks: [],
        showStopControl: false,
      }),
    );

    act(() => {
      result.current.setBrowserIntentCandidate('browser: scrape news');
    });

    await act(async () => {
      await result.current.handleConfirmBrowserIntent();
    });

    expect(mockHandleChatBrowserWorkflow).toHaveBeenCalledWith('browser: scrape news');
    expect(setInput).toHaveBeenCalledWith('browser: scrape news');
    expect(result.current.browserIntentCandidate).toBe('browser: scrape news');
  });

  it('dismisses browserIntentCandidate when input changes away from candidate', () => {
    const { result, rerender } = renderHook(
      ({ input }) =>
        useChatInputSubmission({
          input,
          setInput: jest.fn(),
          attachments: [],
          setAttachments: jest.fn(),
          draftStorageKey: 'draft_test',
          blockDraftStorageKey: 'block_test',
          resetComposer: jest.fn(),
          composerOpen: false,
          composerBlocks: [],
          showStopControl: false,
        }),
      { initialProps: { input: 'browser: search' } },
    );

    act(() => {
      result.current.setBrowserIntentCandidate('browser: search');
    });
    expect(result.current.browserIntentCandidate).toBe('browser: search');

    // Input changed
    rerender({ input: 'something else' });
    expect(result.current.browserIntentCandidate).toBeNull();
  });
});
