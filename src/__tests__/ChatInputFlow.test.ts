jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));
jest.mock('@/utils/browserIntentDetector', () => ({
  detectBrowserIntent: jest.fn(),
  detectGenericBrowserTask: jest.fn(),
}));
import {
  decideChatInputSubmission,
  resolveChatTargetSessionId,
  shouldClearDraftAfterBrowserWorkflow,
  shouldDismissBrowserIntentConfirm,
} from '@/components/chatInputFlow';
import { quickCheckBrowserIntent } from '@/utils/chatBrowserBridge';

describe('ChatInput send flow', () => {
  it('routes browser-looking prompts to a confirmation step instead of sending immediately', () => {
    const decision = decideChatInputSubmission({
      input: '帮我看看这个网页怎么优化',
      isStreaming: false,
      isSubmitting: false,
      isBrowserIntent: () => true,
    });

    expect(decision).toEqual({
      type: 'confirm-browser',
      message: '帮我看看这个网页怎么优化',
    });
  });

  it('keeps normal messages on the regular send path', () => {
    const decision = decideChatInputSubmission({
      input: '请帮我总结这个方案',
      isStreaming: false,
      isSubmitting: false,
      isBrowserIntent: () => false,
    });

    expect(decision).toEqual({
      type: 'send-regular',
      message: '请帮我总结这个方案',
    });
  });

  it('creates a default session id when the current session is missing', async () => {
    const startSession = jest.fn().mockResolvedValue('new-session-1');

    await expect(resolveChatTargetSessionId(null, startSession)).resolves.toBe('new-session-1');
    expect(startSession).toHaveBeenCalledTimes(1);
  });

  it('only clears draft state after a browser workflow is successfully handed off', () => {
    expect(shouldClearDraftAfterBrowserWorkflow(false)).toBe(false);
    expect(shouldClearDraftAfterBrowserWorkflow(true)).toBe(true);
  });

  it('dismisses browser confirmation only after the draft changes', () => {
    expect(shouldDismissBrowserIntentConfirm('打开网页', '打开网页')).toBe(false);
    expect(shouldDismissBrowserIntentConfirm('打开网页', '打开网页看一下')).toBe(true);
    expect(shouldDismissBrowserIntentConfirm(null, '任意内容')).toBe(false);
  });
  it('does not treat shell commands with file paths as browser intents', () => {
    expect(quickCheckBrowserIntent('运行 wc -l src/services/autoresearch/loopEngine.ts')).toBe(false);
    expect(quickCheckBrowserIntent('run wc -l src/services/autoresearch/loopEngine.ts')).toBe(false);
  });

  it('keeps explicit browser commands working', () => {
    expect(quickCheckBrowserIntent('/browser open github.com')).toBe(true);
    expect(quickCheckBrowserIntent('open github.com')).toBe(true);
  });
});
