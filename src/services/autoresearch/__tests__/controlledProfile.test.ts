/**
 * AutoResearch controlled execution profile regression suite.
 *
 * PHASE 7 of the Mode Consistency + AutoResearch Execution audit.
 *
 * Core invariant: AutoResearch is NOT ordinary chat. It must not
 * inherit the current chat session's Ask mode and get blocked, and it
 * must not silently escalate to Bypass when the chat session happens
 * to be Bypass. The bridge between chat and AutoResearch is
 * `createAutoResearchSendMessage` (chatAdapter.ts) which always calls
 * `runHeadlessAgentTurn` with `toolExecutionSource: 'autoresearch_phase'`.
 *
 * These tests assert that contract end-to-end:
 *   1. AutoResearch does not inherit Ask from the chat session.
 *   2. AutoResearch does not silently inherit Bypass-dangerous
 *      permission from the chat session.
 *   3. AutoResearch passes `toolExecutionSource: 'autoresearch_phase'`
 *      to the headless agent runner on every turn.
 *   4. AutoResearch passes a non-AutoResearch-mode-shaped effective
 *      work dir (iteration codeDir) — never the user's bare repo cwd.
 *   5. Budget exhaustion marker + structured FAILED recovery action
 *      surface correctly.
 *   6. metricValue:null + status=FAILED + failReason is a valid
 *      outcome; the parser must not raise "metricValue <missing>".
 *   7. Recovery actions include `increase_tool_budget` when the
 *      failReason is budget-related.
 */

import { describe, expect, it } from '@jest/globals';

import type { AutoResearchRecoveryAction } from '../history';
import {
  parseMetricsArtifactPayload,
} from '../metricsSchema';

describe('AutoResearch controlled profile', () => {
  it('always runs headless turns with toolExecutionSource="autoresearch_phase"', async () => {
    // We re-import chatAdapter so we can read the contract the bridge
    // passes to runHeadlessAgentTurn without booting the full
    // AutoResearch store. The bridge is invoked indirectly through
    // createAutoResearchSendMessage; the source it passes is the
    // contract.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/autoresearch/chatAdapter.ts'),
      'utf8',
    );
    // Every call site that invokes runHeadlessAgentTurn must use the
    // AutoResearch source — never the chat-default AssistantToolCall.
    const callSites = source.match(/runHeadlessAgentTurn\([\s\S]*?\n\s+\}\);/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(1);
    for (const site of callSites) {
      expect(site).toMatch(/toolExecutionSource:\s*'autoresearch_phase'/);
    }

    const bootstrapSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/autoresearch/BootstrapChatView.tsx'),
      'utf8',
    );
    const bootstrapSites = bootstrapSource.match(/runHeadlessAgentTurn\([\s\S]*?\n\s+\}\);/g) ?? [];
    expect(bootstrapSites.length).toBeGreaterThanOrEqual(1);
    for (const site of bootstrapSites) {
      expect(site).toMatch(/toolExecutionSource:\s*'autoresearch_phase'/);
      expect(site).toMatch(/permissionMode:\s*'bypass'/);
      expect(site).toMatch(/executionMode:\s*'bypass'/);
    }
  });

  it('does not import or call the chat sendMessage path that respects Ask mode', async () => {
    // The bridge calls runHeadlessAgentTurn, NOT the chat sendMessage
    // store action that reads the 5-mode session via
    // resolveSessionExecutionModeId. If a future refactor routes
    // AutoResearch through chatStore.sendMessage, AutoResearch would
    // silently inherit Ask when the user is in Ask mode and never run.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/autoresearch/chatAdapter.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/useChatStore\.getState\(\)\.sendMessage/);
    expect(source).not.toMatch(/resolveSessionExecutionModeId/);
  });
});

describe('AutoResearch budget exhaustion marker', () => {
  it('recognises the TOOL_BUDGET_EXHAUSTED marker constant', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/autoresearch/chatAdapter.ts'),
      'utf8',
    );
    expect(source).toMatch(/TOOL_BUDGET_EXHAUSTED_MARKER\s*=\s*['"]__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__['"]/);
  });

  it('emits a structured FAILED payload with null metricValue when budget exhausts', async () => {
    // The chatAdapter builds a JSON payload with metricValue:null +
    // status:FAILED + failReason when the tool budget runs out.
    // Use the base (legacy) schema so we don't need to populate
    // durationMs / startedAt / finishedAt — those are loop_engine /
    // bootstrap artefacts, not agent-emitted payloads.
    const payload = {
      metricName: 'loss',
      metricValue: null,
      status: 'FAILED' as const,
      failReason: 'tool budget exhausted before evaluation completed',
      hypothesis: 'tool budget exhausted before evaluation completed',
    };
    const result = parseMetricsArtifactPayload(payload);
    expect(result.error).toBeUndefined();
    expect(result.value?.status).toBe('FAILED');
    expect(result.value?.metricValue).toBeNull();
    expect(result.value?.failReason).toContain('tool budget exhausted');
  });
});

describe('AutoResearch recovery actions include increase_tool_budget for budget exhaustion', () => {
  it('the increase_tool_budget type is a valid AutoResearchRecoveryAction.type', () => {
    // Regression guard: when we extended the loopEngine to add the
    // 'increase_tool_budget' recovery action, the AutoResearchRecoveryAction
    // type union and the `isRecoveryActionType` guard must accept it.
    // Otherwise the loopEngine call to `completeIterationRecord({
    // recoveryActions: buildIterationRecoveryActions(...) })` would
    // fail TypeScript compilation.
    const action: AutoResearchRecoveryAction = {
      type: 'increase_tool_budget',
      supported: true,
      label: 'Increase tool budget or fix tool permission/confirmation settings.',
      reason: 'Tool budget exhausted before evaluation completed.',
    };
    expect(action.type).toBe('increase_tool_budget');
  });

  it('buildIterationRecoveryActions emits increase_tool_budget only for budget-exhausted fails', async () => {
    // The function lives inside loopEngine.ts and is not exported.
    // We read the source and assert the conditional that gates the
    // `increase_tool_budget` action on the failReason.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/autoresearch/loopEngine.ts'),
      'utf8',
    );
    // Must be gated on a tool-budget-exhaustion detector.
    expect(source).toMatch(/isToolBudgetExhaustedReason/);
    expect(source).toMatch(/type:\s*'increase_tool_budget'/);
    // Must NOT be emitted unconditionally for every FAILED status.
    // Otherwise the user would see "increase tool budget" on every
    // failed run, not just budget-related ones.
    // The `if (isToolBudgetExhaustedReason(options.failReason))` block
    // must wrap the `type: 'increase_tool_budget'` push.
    const blockPattern = /if\s*\(\s*isToolBudgetExhaustedReason\([\s\S]{0,200}type:\s*'increase_tool_budget'/;
    expect(source).toMatch(blockPattern);
  });
});

describe('AutoResearch work dir isolation', () => {
  it('chatAdapter builds effectiveWorkDir from iteration dir in local mode, not from chat session cwd', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/autoresearch/chatAdapter.ts'),
      'utf8',
    );
    // The contract: in local mode, effectiveWorkDir comes from
    // `currentRunDir?.iterDir || workDir` — never the bare chat session
    // cwd. This keeps AutoResearch reads/writes inside the iteration
    // workspace root so the agent can access both `code/` and the
    // sibling metrics/hypothesis files without escaping the sandbox.
    expect(source).toMatch(/effectiveWorkDir\s*=\s*store\.sshConfig\?\.mode\s*===\s*'local'/);
    expect(source).toMatch(/currentRunDir\?\.iterDir\s*\|\|\s*workDir/);
  });

  it('chatAdapter does NOT pass the chat session cwd to AutoResearch in any mode', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/autoresearch/chatAdapter.ts'),
      'utf8',
    );
    // The AutoResearch adapter must not pull cwd from
    // resolveSessionProjectDir or any chat-session-only helper.
    expect(source).not.toMatch(/getSessionProjectDir/);
    expect(source).not.toMatch(/resolveSessionProjectDir/);
  });
});
