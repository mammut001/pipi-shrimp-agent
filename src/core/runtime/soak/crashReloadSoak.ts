/**
 * GPT soak knife 2 — crash / reload soak (kill mid-tool → reopen → hydrate → follow-up).
 *
 * Headless path: Manual D barriers + InMemoryMessageDb simulate process death
 * (runtime released without cancel/terminalize; orphans remain on disk) then
 * hydrate terminalize + follow-up history checks. No SessionRuntime rewrite,
 * no Playwright, no OTel, no durable half-tool resume.
 *
 * Live Tauri kill/reopen steps: docs/soak-crash-reload.md
 */
import {
  getSessionHandle,
  getSessionRuntimeForTests,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../SessionRuntime';
import {
  clearRuntimeTraceSink,
  getRuntimeTraceEvents,
} from '../RuntimeTraceSink';
import { createManualDBarrier, awaitCondition } from '../__tests__/manualDBarrier';
import { harnessSessionEvents } from '../__tests__/manualDProductHarness';
import {
  listOrphanToolCalls,
  terminalizeInterruptedMessages,
} from '../../../store/chat/scrubDanglingToolCalls';
import { buildApiMessages, messageToDb } from '../../../utils/chatHelpers';
import { createMessage } from '../../../types/chat';
import type { Message, ToolCall } from '../../../types/chat';
import {
  InMemoryMessageDb,
  apiHasSuccessfulToolOutcome,
  hasTerminalMarker,
  makeSession,
} from '../../../store/chat/__tests__/cancellationPersistenceTestUtils';
import { writeSoakFailureBundle } from './failureBundle';
import type {
  CrashReloadAssertionFailure,
  CrashReloadInvariantName,
  CrashReloadIterationResult,
  CrashReloadRunOptions,
  CrashReloadRunSummary,
} from './types';

function pushFail(
  failures: CrashReloadAssertionFailure[],
  invariant: CrashReloadInvariantName | 'setup' | 'scenario',
  message: string,
): void {
  failures.push({ invariant, message });
}

function midWaitHistory(
  label: string,
  toolCall: ToolCall,
  iteration: number,
  offset: number,
): Message[] {
  const user = createMessage('user', label);
  user.timestamp = iteration * 100 + offset;
  const assistant = createMessage('assistant', `calling ${toolCall.name}`);
  assistant.timestamp = iteration * 100 + offset + 1;
  assistant.tool_calls = [toolCall];
  return [user, assistant];
}

/**
 * One crash/reload soak iteration:
 * 1. Dual-session Manual D: A + B enter waiting_tool
 * 2. Persist mid-tool orphan histories to DB (pre-crash durable rows)
 * 3. Kill A mid-tool: release A runtime WITHOUT cancel/terminalize
 * 4. B still waiting → submit succeeds (no cross-session cancel)
 * 5. Reopen A from DB → hydrate interrupted terminalize
 * 6. Follow-up buildApiMessages: interrupted marker, no orphan tool_calls, no success resume
 */
export async function runCrashReloadSoakIteration(
  iteration: number,
  sessionPrefix = 'crash-reload',
): Promise<CrashReloadIterationResult> {
  const failures: CrashReloadAssertionFailure[] = [];
  const sessionA = `${sessionPrefix}-a-${iteration}`;
  const sessionB = `${sessionPrefix}-b-${iteration}`;
  const reqA = `crash-req-a-${iteration}`;
  const reqB = `crash-req-b-${iteration}`;
  const toolCallA: ToolCall = {
    id: reqA,
    name: 'test_barrier_tool',
    arguments: JSON.stringify({ barrier_id: `crash-a-${iteration}` }),
  };
  const toolCallB: ToolCall = {
    id: reqB,
    name: 'test_barrier_tool',
    arguments: JSON.stringify({ barrier_id: `crash-b-${iteration}` }),
  };

  clearRuntimeTraceSink();
  releaseSessionRuntimeForTests(sessionA);
  releaseSessionRuntimeForTests(sessionB);

  const db = new InMemoryMessageDb();
  let historyA: Message[] = [];
  let historyB: Message[] = [];
  let orphanCount = -1;

  try {
    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);
    const runtimeA = getSessionRuntimeForTests(sessionA)!;
    const runtimeB = getSessionRuntimeForTests(sessionB)!;

    const gateA = createManualDBarrier();
    const gateB = createManualDBarrier();

    const turnA = runtimeA.startTurn();
    const turnB = runtimeB.startTurn();
    runtimeA.markWaitingTool(turnA);
    runtimeB.markWaitingTool(turnB);

    // Persist mid-tool orphans BEFORE kill (what Chat would have written while waiting).
    historyA = midWaitHistory(`crash A iter=${iteration}`, toolCallA, iteration, 0);
    historyB = midWaitHistory(`crash B iter=${iteration}`, toolCallB, iteration, 10);
    db.seed(sessionA, historyA);
    db.seed(sessionB, historyB);

    // Prove DB still has orphans pre-hydrate (crash left them durable).
    if (listOrphanToolCalls(db.loadMessages(sessionA)).length === 0) {
      pushFail(failures, 'hydrate_terminalizes_orphans', 'pre-kill DB A expected orphans');
    }

    // Manual D contract: waitFor tool id list === tool_calls[].id === submit result id === req*.
    const waitAPromise = (async () => {
      await gateA.wait();
      return runtimeA.getToolResultChannel().waitFor(
        reqA,
        [reqA],
        { turnId: turnA },
      );
    })().then(
      (results) => ({ ok: true as const, results }),
      (err: unknown) => ({
        ok: false as const,
        name: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );

    const waitBPromise = (async () => {
      await gateB.wait();
      return runtimeB.getToolResultChannel().waitFor(
        reqB,
        [reqB],
        { turnId: turnB },
      );
    })();

    if (handleA.getState() !== 'waiting_tool' || handleB.getState() !== 'waiting_tool') {
      pushFail(
        failures,
        'setup',
        `expected both waiting_tool; A=${handleA.getState()} B=${handleB.getState()}`,
      );
    }

    gateA.release();
    gateB.release();
    await awaitCondition(
      () => runtimeA.getToolResultChannel().listPendingRequestIds().includes(reqA)
        && runtimeB.getToolResultChannel().listPendingRequestIds().includes(reqB),
      'both channels pending before kill',
    );

    // --- KILL mid-tool on A: drop runtime without cancel/terminalize ---
    releaseSessionRuntimeForTests(sessionA);
    // Abandoned wait must not hang the iteration (channel gone with runtime).
    void waitAPromise;

    // DB still has raw orphans (no cancel notice) — process death, not Stop.
    const postKillA = db.loadMessages(sessionA);
    if (listOrphanToolCalls(postKillA).length === 0) {
      pushFail(failures, 'hydrate_terminalizes_orphans', 'post-kill DB A lost orphans unexpectedly');
    }
    if (hasTerminalMarker(postKillA, 'interrupted') || hasTerminalMarker(postKillA, 'user_cancel')) {
      pushFail(
        failures,
        'no_orphan_resume_as_success',
        'post-kill DB A already has cancel/interrupted notice — kill must not terminalize',
      );
    }

    // B must still succeed after A kill (no cross-session cancel).
    const bAccepted = submitSessionToolResults(
      sessionB,
      reqB,
      [{ id: reqB, content: 'b-ok-after-a-kill' }],
      turnB,
    );
    if (bAccepted !== true) {
      pushFail(failures, 'no_cross_session_contamination', `B submit rejected after A kill (${bAccepted})`);
    } else {
      try {
        const bResults = await waitBPromise;
        if (
          JSON.stringify(bResults)
          !== JSON.stringify([{ id: reqB, content: 'b-ok-after-a-kill' }])
        ) {
          pushFail(
            failures,
            'no_cross_session_contamination',
            `B results mismatch after A kill: ${JSON.stringify(bResults)}`,
          );
        }
        // Product-shaped B history: mid-wait + matching tool result
        historyB = [
          ...historyB,
          {
            id: `msg-crash-b-result-${iteration}`,
            role: 'user',
            content: `__TOOL_RESULT__:${reqB}:b-ok-after-a-kill`,
            tool_call_id: reqB,
            timestamp: iteration * 100 + 20,
          },
        ];
        db.seed(sessionB, historyB);
      } catch (err) {
        pushFail(
          failures,
          'no_cross_session_contamination',
          `B wait failed after A kill: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // --- REOPEN / HYDRATE A (and B) from DB ---
    const reloadedA = db.loadMessages(sessionA);
    const reloadedB = db.loadMessages(sessionB);
    const store = {
      sessions: [
        makeSession(sessionA, reloadedA),
        makeSession(sessionB, reloadedB),
      ],
    };

    // Hydrate path equivalent: interrupted terminalize (not user_cancel).
    const hydratedA = terminalizeInterruptedMessages(store.sessions[0].messages, {
      kind: 'interrupted',
      now: iteration * 100 + 50,
    });
    if (!hydratedA.changed) {
      pushFail(
        failures,
        'hydrate_terminalizes_orphans',
        'hydrate did not change A history (expected scrub + interrupted notice)',
      );
    }
    historyA = hydratedA.messages;
    orphanCount = listOrphanToolCalls(historyA).length;
    if (orphanCount !== 0) {
      pushFail(
        failures,
        'hydrate_terminalizes_orphans',
        `A still has ${orphanCount} orphans after hydrate`,
      );
    }
    if (!hasTerminalMarker(historyA, 'interrupted')) {
      pushFail(
        failures,
        'hydrate_terminalizes_orphans',
        'A missing interrupted notice after hydrate',
      );
    }

    // Persist hydrate result (single batch — mirrors db_save_messages).
    if (hydratedA.notice) {
      const toPersist = [
        ...hydratedA.scrubbedById.values(),
        hydratedA.notice,
      ].map((m) => messageToDb(m, sessionA));
      db.saveMessages(toPersist);
    }

    // Idempotent second hydrate
    const again = terminalizeInterruptedMessages(db.loadMessages(sessionA), {
      kind: 'interrupted',
      now: iteration * 100 + 51,
    });
    if (again.changed) {
      pushFail(
        failures,
        'hydrate_terminalizes_orphans',
        'second hydrate changed A again (expected idempotent)',
      );
    }

    // B must not gain A's interrupted notice / contamination.
    historyB = db.loadMessages(sessionB);
    if (hasTerminalMarker(historyB, 'interrupted') || hasTerminalMarker(historyB, 'user_cancel')) {
      pushFail(
        failures,
        'no_cross_session_contamination',
        'B history contaminated with cancel/interrupted notice from A crash',
      );
    }
    if (listOrphanToolCalls(historyB).length !== 0) {
      pushFail(
        failures,
        'no_cross_session_contamination',
        `B has orphans after A crash/hydrate: ${listOrphanToolCalls(historyB).map((o) => o.toolCall.id).join(',')}`,
      );
    }

    // --- FOLLOW-UP: next turn history must not resume orphan as success ---
    const api = buildApiMessages(historyA);
    if (api.some((m) => Boolean(m.tool_calls?.length))) {
      pushFail(
        failures,
        'follow_up_no_orphan_tool_calls',
        'follow-up API history still has tool_calls (orphan resume risk)',
      );
    }
    if (!api.some((m) => (
      typeof m.content === 'string'
      && m.content.includes('Tool run interrupted before completion')
      && m.content.includes('test_barrier_tool')
    ))) {
      pushFail(
        failures,
        'follow_up_no_orphan_tool_calls',
        'follow-up API history missing interrupted marker for test_barrier_tool',
      );
    }
    if (apiHasSuccessfulToolOutcome(api, reqA, 'ok')) {
      pushFail(
        failures,
        'no_orphan_resume_as_success',
        'follow-up API presents crashed tool as successful outcome',
      );
    }

    // Fresh A runtime after reopen can start a new turn (no stuck ownership).
    const reopenedA = getSessionHandle(sessionA);
    const reopenedRuntime = getSessionRuntimeForTests(sessionA)!;
    const followTurn = reopenedRuntime.startTurn();
    reopenedRuntime.markWaitingTool(followTurn);
    const followReq = `crash-follow-${iteration}`;
    const followToolId = followReq;
    const waitFollow = reopenedRuntime.getToolResultChannel().waitFor(
      followReq,
      [followToolId],
      { turnId: followTurn },
    );
    if (!reopenedA.isTurnActive(followTurn) || reopenedA.getState() !== 'waiting_tool') {
      pushFail(
        failures,
        'scenario',
        `reopened A follow-up bad state: active=${reopenedA.isTurnActive(followTurn)} state=${reopenedA.getState()}`,
      );
    }
    // Stale pre-crash turnId must discard
    const stale = submitSessionToolResults(
      sessionA,
      followReq,
      [{ id: followToolId, content: 'stale-pre-crash' }],
      turnA,
    );
    if (stale !== false) {
      pushFail(
        failures,
        'no_orphan_resume_as_success',
        `stale pre-crash turnId accepted after reopen (${stale})`,
      );
    }
    const followOk = submitSessionToolResults(
      sessionA,
      followReq,
      [{ id: followToolId, content: 'follow-ok' }],
      followTurn,
    );
    if (followOk !== true) {
      pushFail(failures, 'scenario', `follow-up submit rejected (${followOk})`);
    } else {
      try {
        await waitFollow;
      } catch (err) {
        pushFail(
          failures,
          'scenario',
          `follow-up wait failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Trace: B never cancelled; A may show runtime_released / no tool_cancelled required
    // (kill ≠ Stop — no cancel path).
    // MUST filter via e.context.sessionId (RuntimeTraceEvent has no top-level sessionId;
    // checking e.sessionId false-greens — always undefined).
    const events = getRuntimeTraceEvents();
    const bEvents = harnessSessionEvents(events, sessionB);
    const bCancelled = bEvents.some((e) => (
      e.type === 'tool_cancelled' || e.type === 'turn_cancelling'
    ));
    if (bCancelled) {
      pushFail(
        failures,
        'no_cross_session_contamination',
        'B received cancel/cancelling traces after A kill',
      );
    }

    const result: CrashReloadIterationResult = {
      ok: failures.length === 0,
      iteration,
      sessionA,
      sessionB,
      failures,
      orphanCount,
      historyA,
      historyB,
    };

    releaseSessionRuntimeForTests(sessionA);
    releaseSessionRuntimeForTests(sessionB);
    return result;
  } catch (err) {
    pushFail(
      failures,
      'setup',
      `crash-reload iteration threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    releaseSessionRuntimeForTests(sessionA);
    releaseSessionRuntimeForTests(sessionB);
    return {
      ok: false,
      iteration,
      sessionA,
      sessionB,
      failures,
      orphanCount,
      historyA,
      historyB,
    };
  }
}

export function resolveCrashReloadSoakIterations(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const fromEnv = process.env.PIPI_CRASH_RELOAD_SOAK_ITERS ?? process.env.PIPI_SOAK_ITERS;
  if (fromEnv) {
    const n = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 20;
}

/**
 * Loop crash/reload soak iterations; dump failure bundle on break (default stopOnFailure).
 */
export async function runCrashReloadSoak(
  options: CrashReloadRunOptions = {},
): Promise<CrashReloadRunSummary> {
  const iterations = resolveCrashReloadSoakIterations(options.iterations);
  const stopOnFailure = options.stopOnFailure !== false;
  const sessionPrefix = options.sessionPrefix ?? 'crash-reload';
  const runIteration = options.runIteration ?? runCrashReloadSoakIteration;

  const results: CrashReloadIterationResult[] = [];
  const failureBundleDirs: string[] = [];
  let failedAt: number | undefined;
  let iterationsCompleted = 0;

  for (let i = 1; i <= iterations; i += 1) {
    const result = await runIteration(i, sessionPrefix);
    results.push(result);
    iterationsCompleted = i;

    if (!result.ok) {
      if (failedAt === undefined) failedAt = i;
      try {
        const bundle = writeSoakFailureBundle({
          artifactRoot: options.artifactRoot,
          iteration: i,
          sessionA: result.sessionA,
          sessionB: result.sessionB,
          failures: result.failures,
          assertionMessage: result.failures.map((f) => `[${f.invariant}] ${f.message}`).join('\n'),
        });
        failureBundleDirs.push(bundle.dir);
      } catch (bundleErr) {
        failureBundleDirs.push(
          `bundle-write-failed:${bundleErr instanceof Error ? bundleErr.message : String(bundleErr)}`,
        );
      }
      releaseSessionRuntimeForTests(result.sessionA);
      releaseSessionRuntimeForTests(result.sessionB);
      if (stopOnFailure) break;
    }
  }

  return {
    ok: failedAt === undefined,
    iterationsRequested: iterations,
    iterationsCompleted,
    failedAt,
    failureBundleDir: failureBundleDirs[0],
    failureBundleDirs: failureBundleDirs.length > 0 ? failureBundleDirs : undefined,
    results,
  };
}
