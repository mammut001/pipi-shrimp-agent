import { describe, expect, it } from '@jest/globals';

import type { NativeAgentOptions } from '../../../utils/nativeBrowserAgent';
import type {
  BrowserActionPolicyContext,
  BrowserActionPolicyVerdict,
} from '../../../utils/browserActionPolicy';
import type { BrowserPendingActionApproval } from '../browserActionApproval';
import {
  createBrowserCdpTaskRunner,
  type BrowserCdpTaskRunnerDependencies,
  type BrowserCdpTaskRunnerInput,
} from '../browserCdpTaskRunner';

describe('browser CDP task runner', () => {
  it('passes abort, permission, and guarded approval hooks to the native executor', async () => {
    let capturedOptions: NativeAgentOptions | undefined;
    let pendingApproval: BrowserPendingActionApproval | null = null;
    const signal = new AbortController().signal;
    const input = createInput({
      signal,
      bridge: {
        getPendingTaskId: () => 'task-42',
        getPendingApproval: () => pendingApproval,
        setPendingApproval: (approval) => { pendingApproval = approval; },
        setNativeRunStats: () => undefined,
      },
    });
    const dependencies: BrowserCdpTaskRunnerDependencies = {
      executeNativeBrowserTask: async (_task, _apiKey, _model, options) => {
        capturedOptions = options;
        return 'completed';
      },
      createBrowserActionApprovalId: () => 'approval-1',
      summarizeBrowserActionApproval: () => ({
        actionType: 'submit',
        summary: 'Confirm order',
        riskLevel: 'high',
      }),
      waitForBrowserActionApproval: async ({ signal: approvalSignal, isStillValid }) => (
        approvalSignal === signal && isStillValid()
      ),
    };

    const result = await createBrowserCdpTaskRunner(dependencies)(input);

    expect(result).toBe('completed');
    expect(capturedOptions?.signal).toBe(signal);
    expect(capturedOptions?.permissionMode).toBe('ask_each_action');
    expect(capturedOptions?.targetUrl).toBe('https://example.com');
    expect(capturedOptions?.approveAction).toEqual(expect.any(Function));

    const approvalVerdict: BrowserActionPolicyVerdict = {
      decision: 'ask',
      reason: 'Order submission requires confirmation',
      riskLevel: 'high',
    };
    const approvalContext: BrowserActionPolicyContext = {
      actionName: 'click_element',
      url: 'https://example.com',
    };
    const approved = await capturedOptions?.approveAction?.(approvalVerdict, approvalContext);

    expect(approved).toBe(true);
    expect(pendingApproval).toBeNull();
  });

  it('ignores stale approval and run-summary callbacks after stop', async () => {
    let capturedOptions: NativeAgentOptions | undefined;
    let pendingApproval: BrowserPendingActionApproval | null = null;
    let publishCount = 0;
    let isCurrentRun = true;
    const input = createInput({
      shouldAcceptTaskCompletion: () => isCurrentRun,
      bridge: {
        getPendingTaskId: () => 'task-42',
        getPendingApproval: () => pendingApproval,
        setPendingApproval: (approval) => { pendingApproval = approval; },
        setNativeRunStats: () => { publishCount += 1; },
      },
    });
    const dependencies: BrowserCdpTaskRunnerDependencies = {
      executeNativeBrowserTask: async (_task, _apiKey, _model, options) => {
        capturedOptions = options;
        return 'late result';
      },
      createBrowserActionApprovalId: () => 'approval-2',
      summarizeBrowserActionApproval: () => ({
        actionType: 'submit',
        summary: 'Confirm order',
        riskLevel: 'high',
      }),
      waitForBrowserActionApproval: async ({ isStillValid }) => isStillValid(),
    };

    await createBrowserCdpTaskRunner(dependencies)(input);
    isCurrentRun = false;

    const approvalVerdict: BrowserActionPolicyVerdict = {
      decision: 'ask',
      reason: 'Order submission requires confirmation',
      riskLevel: 'high',
    };
    const approvalContext: BrowserActionPolicyContext = {
      actionName: 'click_element',
      url: 'https://example.com',
    };
    expect(await capturedOptions?.approveAction?.(approvalVerdict, approvalContext)).toBe(false);
    capturedOptions?.onRunSummary?.({} as Parameters<NonNullable<NativeAgentOptions['onRunSummary']>>[0]);

    expect(pendingApproval).toBeNull();
    expect(publishCount).toBe(0);
  });
});

function createInput(overrides: Partial<BrowserCdpTaskRunnerInput> = {}): BrowserCdpTaskRunnerInput {
  const defaultBridge = {
    getPendingTaskId: () => 'task-42',
    getPendingApproval: () => null,
    setPendingApproval: () => undefined,
    setNativeRunStats: () => undefined,
  };

  return {
    task: 'Finish checkout',
    apiKey: 'test-api-key',
    model: 'test-model',
    baseUrl: 'https://api.example.com',
    targetUrl: 'https://example.com',
    signal: new AbortController().signal,
    permissionMode: 'ask_each_action',
    taskRunToken: 3,
    shouldAcceptTaskCompletion: () => true,
    onLog: () => undefined,
    publishRunSummary: true,
    bridge: defaultBridge,
    ...overrides,
  };
}
