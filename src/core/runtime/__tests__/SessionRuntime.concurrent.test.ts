import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { EngineEvent } from '../../types';
import type { ToolResultChannel } from '../ToolResultChannel';
import type { RunChatTurnOptions } from '../queryLoop';

const runQueryEngineTurnMock = jest.fn();

jest.mock('../queryLoop', () => {
  const actual = jest.requireActual('../queryLoop') as Record<string, unknown>;
  return {
    ...actual,
    runQueryEngineTurn: (...args: unknown[]) => runQueryEngineTurnMock(...args),
  };
});

import {
  getSessionHandle,
  getSessionRuntimeForTests,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../SessionRuntime';

/**
 * Manual D barrier-style harness (pure TS, controllable promises).
 *
 * Two independent sessions:
 *   A starts a turn and waits on a tool request
 *   B starts a turn and waits on a tool request
 *   Cancel A while B is still waiting
 *   Assert: B remains active; A is terminal; late A result is discarded
 */
describe('SessionRuntime concurrent dual-session barrier', () => {
  const sessionA = 'barrier-session-a';
  const sessionB = 'barrier-session-b';

  beforeEach(() => {
    releaseSessionRuntimeForTests(sessionA);
    releaseSessionRuntimeForTests(sessionB);
    runQueryEngineTurnMock.mockReset();
  });

  it('cancel A while B waiting: B stays active, late A result discarded', async () => {
    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);
    const runtimeA = getSessionRuntimeForTests(sessionA)!;
    const runtimeB = getSessionRuntimeForTests(sessionB)!;

    const turnA = runtimeA.startTurn();
    const turnB = runtimeB.startTurn();
    runtimeA.markWaitingTool(turnA);
    runtimeB.markWaitingTool(turnB);

    // Controllable waiters (no real sleep) — each session owns its channel.
    const waitA = runtimeA.getToolResultChannel().waitFor(
      'req-a',
      ['tool-a'],
      { turnId: turnA },
    );
    const waitB = runtimeB.getToolResultChannel().waitFor(
      'req-b',
      ['tool-b'],
      { turnId: turnB },
    );

    expect(handleA.isTurnActive(turnA)).toBe(true);
    expect(handleB.isTurnActive(turnB)).toBe(true);
    expect(handleA.getState()).toBe('waiting_tool');
    expect(handleB.getState()).toBe('waiting_tool');

    // Cancel A while B is still waiting.
    handleA.cancelActiveTurn('Stop A');

    expect(handleA.isTurnActive(turnA)).toBe(false);
    expect(handleA.getState()).toBe('terminal');
    expect(handleB.isTurnActive(turnB)).toBe(true);
    expect(handleB.getState()).toBe('waiting_tool');

    await expect(waitA).rejects.toMatchObject({ name: 'AbortError' });

    // Late A result must discard only — no continuation.
    const lateAccepted = submitSessionToolResults(
      sessionA,
      'req-a',
      [{ id: 'tool-a', content: 'late-a' }],
      turnA,
    );
    expect(lateAccepted).toBe(false);

    // B can still complete normally.
    const bAccepted = submitSessionToolResults(
      sessionB,
      'req-b',
      [{ id: 'tool-b', content: 'b-done' }],
      turnB,
    );
    expect(bAccepted).toBe(true);
    await expect(waitB).resolves.toEqual([{ id: 'tool-b', content: 'b-done' }]);
    expect(handleB.isTurnActive(turnB)).toBe(true);
  });

  it('same-session supersede: prior turn terminal, new turn remains active', async () => {
    const handle = getSessionHandle(sessionA);
    const runtime = getSessionRuntimeForTests(sessionA)!;
    const turn1 = runtime.startTurn();
    runtime.markWaitingTool(turn1);
    const wait1 = runtime.getToolResultChannel().waitFor(
      'req-1',
      ['t1'],
      { turnId: turn1 },
    );

    const turn2 = runtime.startTurn();
    runtime.markWaitingTool(turn2);

    expect(handle.isTurnActive(turn1)).toBe(false);
    expect(handle.isTurnActive(turn2)).toBe(true);

    await expect(wait1).rejects.toMatchObject({ name: 'AbortError' });
    expect(
      submitSessionToolResults(sessionA, 'req-1', [{ id: 't1', content: 'stale' }], turn1),
    ).toBe(false);

    const wait2 = runtime.getToolResultChannel().waitFor(
      'req-2',
      ['t2'],
      { turnId: turn2 },
    );
    expect(
      submitSessionToolResults(sessionA, 'req-2', [{ id: 't2', content: 'fresh' }], turn2),
    ).toBe(true);
    await expect(wait2).resolves.toEqual([{ id: 't2', content: 'fresh' }]);
  });

  it('runTurn barrier: cancel A while B waits — A late event discarded, B continues', async () => {
    runQueryEngineTurnMock.mockImplementation(
      async function* (
        sessionId: string,
        _initialMessages: unknown,
        _systemPrompt: string,
        _projectRoot: string | undefined,
        _allowBrowserTools: boolean,
        _requestConfig: unknown,
        options: RunChatTurnOptions | undefined,
        _pipiOutputDir: string | undefined,
        toolResultChannel: ToolResultChannel,
        turnId?: string,
      ): AsyncGenerator<EngineEvent, void, unknown> {
        const requestId = `${sessionId}:req`;
        const toolId = `${sessionId}:tool`;
        options?.onWaitingTool?.();
        yield {
          type: 'tool_batch_request',
          requestId,
          tools: [{ id: toolId, name: 'execute_command', arguments: '{}' }],
        } as EngineEvent;

        let results;
        try {
          results = await toolResultChannel.waitFor(
            requestId,
            [toolId],
            { turnId, signal: options?.signal },
          );
        } catch (waitError) {
          // Mirror queryLoop: abort/cancel ends the turn without throwing.
          if (
            options?.signal?.aborted
            || (waitError instanceof DOMException && waitError.name === 'AbortError')
            || (waitError instanceof Error && waitError.name === 'AbortError')
          ) {
            return;
          }
          throw waitError;
        }
        options?.onToolsResolved?.();
        yield {
          type: 'text_delta',
          content: `done:${results[0]?.content ?? ''}`,
        } as EngineEvent;
        yield { type: 'turn_complete' } as EngineEvent;
      },
    );

    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);

    const eventsA: EngineEvent[] = [];
    const eventsB: EngineEvent[] = [];
    let turnA: string | undefined;
    let turnB: string | undefined;
    let aSawToolRequest = false;
    let bSawToolRequest = false;

    const runA = (async () => {
      for await (const event of handleA.runTurn({
        initialMessages: [],
        systemPrompt: 'a',
      })) {
        eventsA.push(event);
        if (event.turnId) turnA = event.turnId;
        if (event.type === 'tool_batch_request') {
          aSawToolRequest = true;
        }
      }
    })();

    const runB = (async () => {
      for await (const event of handleB.runTurn({
        initialMessages: [],
        systemPrompt: 'b',
      })) {
        eventsB.push(event);
        if (event.turnId) turnB = event.turnId;
        if (event.type === 'tool_batch_request') {
          bSawToolRequest = true;
        }
      }
    })();

    // Wait until both turns have emitted a tool request (entered waiting_tool).
    for (let i = 0; i < 50 && !(aSawToolRequest && bSawToolRequest); i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(aSawToolRequest).toBe(true);
    expect(bSawToolRequest).toBe(true);
    expect(turnA).toBeDefined();
    expect(turnB).toBeDefined();
    expect(handleA.getState()).toBe('waiting_tool');
    expect(handleB.getState()).toBe('waiting_tool');

    handleA.cancel('Stop A', turnA);
    expect(handleA.isTurnActive(turnA)).toBe(false);
    expect(handleB.isTurnActive(turnB)).toBe(true);

    // Late A submit must discard.
    expect(
      handleA.submitToolResults(
        `${sessionA}:req`,
        [{ id: `${sessionA}:tool`, content: 'late-a' }],
        turnA,
      ),
    ).toBe(false);

    // B continues.
    expect(
      handleB.submitToolResults(
        `${sessionB}:req`,
        [{ id: `${sessionB}:tool`, content: 'b-ok' }],
        turnB,
      ),
    ).toBe(true);

    await Promise.all([runA, runB]);

    expect(eventsA.some((e) => e.type === 'text_delta')).toBe(false);
    expect(eventsB.some((e) => e.type === 'text_delta' && (e as any).content === 'done:b-ok')).toBe(true);
    expect(handleB.getState()).toBe('idle');
  });
});
