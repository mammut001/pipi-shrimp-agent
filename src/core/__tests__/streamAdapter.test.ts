import { invokeRustAPIStream } from '../streamAdapter';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn(),
}));

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>;
const mockListen = listen as jest.MockedFunction<typeof listen>;

describe('streamAdapter (invokeRustAPIStream)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListen.mockResolvedValue(jest.fn());
  });

  it('throws AbortError immediately when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const stream = invokeRustAPIStream({
      messages: [],
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'http://localhost',
      systemPrompt: 'test prompt',
      sessionId: 'session-pre-aborted',
      signal: controller.signal,
    });

    await expect(stream.next()).rejects.toThrow('Streaming request aborted');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('aborts pending stream and cleans up when AbortSignal fires', async () => {
    const unlistenFn = jest.fn();
    mockListen.mockResolvedValue(unlistenFn);
    mockInvoke.mockReturnValue(new Promise(() => {})); // Never resolves

    const controller = new AbortController();
    const stream = invokeRustAPIStream({
      messages: [],
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'http://localhost',
      systemPrompt: 'test prompt',
      sessionId: 'session-abort-mid-stream',
      signal: controller.signal,
    });

    const streamPromise = (async () => {
      const results = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }
      return results;
    })();

    // Allow generator to start and register listeners
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(streamPromise).rejects.toThrow('Streaming request aborted');
    expect(unlistenFn).toHaveBeenCalled();
  });

  it('times out and cleans up on inactivity timeout', async () => {
    const unlistenFn = jest.fn();
    mockListen.mockResolvedValue(unlistenFn);
    mockInvoke.mockReturnValue(new Promise(() => {})); // Never resolves

    const stream = invokeRustAPIStream({
      messages: [],
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'http://localhost',
      systemPrompt: 'test prompt',
      sessionId: 'session-idle-timeout',
      timeoutMs: 50,
    });

    const streamPromise = (async () => {
      const results = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }
      return results;
    })();

    await expect(streamPromise).rejects.toThrow('Streaming call stalled — no events for 0.05s');
    expect(unlistenFn).toHaveBeenCalled();
  });

  it('allows a long response (e.g. 125s response) to settle successfully without timing out when timeoutMs is 300s', async () => {
    const unlistenFn = jest.fn();
    mockListen.mockResolvedValue(unlistenFn);

    let resolveInvoke!: (res: any) => void;
    mockInvoke.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    const stream = invokeRustAPIStream({
      messages: [],
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'http://localhost',
      systemPrompt: 'test prompt',
      sessionId: 'session-long-response',
      timeoutMs: 300_000,
    });

    const streamPromise = (async () => {
      const results = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }
      return results;
    })();

    await new Promise((resolve) => setTimeout(resolve, 50));
    resolveInvoke({ content: 'Goal evaluation completed after 125s' });

    const chunks = await streamPromise;
    expect(chunks).toEqual([
      { type: 'api_response_complete', response: { content: 'Goal evaluation completed after 125s' } },
    ]);
    expect(unlistenFn).toHaveBeenCalled();
  });
  it('registers listeners, filters foreign sessions, streams events, and cleans up', async () => {
    type CapturedEvent = { payload: Record<string, string> };
    const handlers = new Map<string, (event: CapturedEvent) => void>();
    const unlistenFns = [jest.fn(), jest.fn(), jest.fn()];
    let listenerIndex = 0;

    mockListen.mockImplementation((async (event: string, handler: unknown) => {
      handlers.set(event, handler as (event: CapturedEvent) => void);
      return unlistenFns[listenerIndex++]!;
    }) as typeof listen);

    const emit = (event: string, payload: Record<string, string>) => {
      handlers.get(event)?.({ payload });
    };
    mockInvoke.mockImplementation((async () => {
      emit('claude-token', { session_id: 'other-session', content: 'ignore me' });
      emit('claude-token', { session_id: 'stream-session', content: 'answer' });
      emit('claude-reasoning', { session_id: 'stream-session', content: 'thinking' });
      emit('claude-tool-use', {
        session_id: 'stream-session',
        tool_call_id: 'call-1',
        name: 'Bash',
        arguments: '{"command":"pwd"}',
      });
      return { content: 'done' };
    }) as unknown as typeof invoke);

    const params = {
      messages: [],
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://api.example.com',
      systemPrompt: 'test prompt',
      sessionId: 'stream-session',
    };
    const chunks: unknown[] = [];
    for await (const chunk of invokeRustAPIStream(params)) {
      chunks.push(chunk);
    }

    expect(mockListen).toHaveBeenNthCalledWith(1, 'claude-token', expect.any(Function));
    expect(mockListen).toHaveBeenNthCalledWith(2, 'claude-reasoning', expect.any(Function));
    expect(mockListen).toHaveBeenNthCalledWith(3, 'claude-tool-use', expect.any(Function));
    expect(mockInvoke).toHaveBeenCalledWith('send_claude_sdk_chat_streaming', params);
    expect(chunks).toEqual([
      { type: 'text_delta', content: 'answer' },
      { type: 'reasoning_delta', content: 'thinking' },
      { type: 'tool_call', tool: { id: 'call-1', name: 'Bash', arguments: '{"command":"pwd"}' } },
      { type: 'api_response_complete', response: { content: 'done' } },
    ]);
    expect(unlistenFns.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
  });

});
