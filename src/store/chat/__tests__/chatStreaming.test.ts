import { describe, expect, it } from '@jest/globals';
import {
  createStreamingAccumulator,
  detectStreamEnd,
  flushBuffer,
  handleStreamChunk,
  resolveStreamingOwnerSessionId,
  shouldFlushStreamingUpdate,
  STREAMING_TIMEOUT_MS,
  STREAMING_UI_THROTTLE_MS,
} from '../chatStreaming';
import type { EngineEvent } from '../../../core/types';

describe('chatStreaming', () => {
  it('keeps timeout and UI throttle constants explicit', () => {
    expect(STREAMING_TIMEOUT_MS).toBe(300_000);
    expect(STREAMING_UI_THROTTLE_MS).toBe(100);
  });

  it('decides when streaming content should flush to the UI', () => {
    expect(shouldFlushStreamingUpdate(1100, 1000)).toBe(true);
    expect(shouldFlushStreamingUpdate(1099, 1000)).toBe(false);
  });

  it('prefers the streaming owner session over the current UI session', () => {
    expect(resolveStreamingOwnerSessionId('streaming-session', 'current-session')).toBe('streaming-session');
    expect(resolveStreamingOwnerSessionId(null, 'current-session')).toBe('current-session');
    expect(resolveStreamingOwnerSessionId(null, null)).toBeNull();
  });

  it('accumulates text, reasoning and completion metadata across a normal stream', () => {
    const chunks: EngineEvent[] = [
      { type: 'text_delta', content: 'Hello ' },
      { type: 'reasoning_delta', content: 'step 1' },
      { type: 'text_delta', content: 'world' },
      { type: 'status_update', message: 'Working...' },
      { type: 'turn_complete', tokenUsage: { input_tokens: 3, output_tokens: 5, model: 'test-model' } },
    ];

    const state = chunks.reduce(handleStreamChunk, createStreamingAccumulator());

    expect(state.content).toBe('Hello world');
    expect(state.reasoning).toBe('step 1');
    expect(state.statusMessages).toEqual(['Working...']);
    expect(state.tokenUsage).toEqual({ input_tokens: 3, output_tokens: 5, model: 'test-model' });
  });

  it('flushes partial buffered content into display content and merged reasoning after interruption', () => {
    const state = handleStreamChunk(
      handleStreamChunk(createStreamingAccumulator(), { type: 'text_delta', content: '<think>internal</think>Visible answer' }),
      { type: 'reasoning_delta', content: 'extra reasoning' },
    );

    expect(flushBuffer(state)).toEqual({
      content: 'Visible answer',
      reasoning: 'extra reasoning\n\ninternal',
    });
  });

  it('handles out-of-order chunks without losing accumulated state', () => {
    const chunks: EngineEvent[] = [
      { type: 'reasoning_delta', content: 'first' },
      { type: 'text_delta', content: 'A' },
      { type: 'reasoning_delta', content: ' second' },
      { type: 'text_delta', content: 'B' },
    ];

    const state = chunks.reduce(handleStreamChunk, createStreamingAccumulator());

    expect(state.content).toBe('AB');
    expect(state.reasoning).toBe('first second');
  });

  it('detects terminal stream events', () => {
    expect(detectStreamEnd({ type: 'turn_complete' })).toBe(true);
    expect(detectStreamEnd({ type: 'api_response_complete', response: undefined })).toBe(true);
    expect(detectStreamEnd({ type: 'error', error: new Error('boom') })).toBe(true);
    expect(detectStreamEnd({ type: 'text_delta', content: 'still going' })).toBe(false);
  });
});
