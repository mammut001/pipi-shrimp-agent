import type {
  BrowserActionPolicyContext,
  BrowserActionPolicyRisk,
  BrowserActionPolicyVerdict,
} from '@/utils/browserActionPolicy';

export interface BrowserPendingActionApproval {
  id: string;
  taskId: string;
  taskRunToken: number;
  actionType: string;
  summary: string;
  riskLevel: BrowserActionPolicyRisk;
  createdAt: number;
}

type ApprovalResolver = (approved: boolean) => void;

const approvalResolvers = new Map<string, ApprovalResolver>();

export function summarizeBrowserActionApproval(
  verdict: BrowserActionPolicyVerdict,
  context: BrowserActionPolicyContext,
): Pick<BrowserPendingActionApproval, 'actionType' | 'summary' | 'riskLevel'> {
  const reason = verdict.reason.trim();
  const summary = reason.length > 200 ? `${reason.slice(0, 197)}...` : reason;
  return {
    actionType: String(context.actionName),
    summary: summary || 'Sensitive browser action',
    riskLevel: verdict.riskLevel,
  };
}

export function createBrowserActionApprovalId(): string {
  return `browser-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function waitForBrowserActionApproval(input: {
  id: string;
  signal?: AbortSignal;
  isStillValid: () => boolean;
}): Promise<boolean> {
  if (!input.isStillValid()) {
    return Promise.resolve(false);
  }
  if (input.signal?.aborted) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const settle = (approved: boolean) => {
      approvalResolvers.delete(input.id);
      resolve(approved);
    };

    approvalResolvers.set(input.id, settle);

    if (input.signal) {
      const onAbort = () => settle(false);
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function resolveBrowserActionApproval(id: string, approved: boolean): boolean {
  const resolver = approvalResolvers.get(id);
  if (!resolver) {
    return false;
  }
  resolver(approved);
  return true;
}

export function cancelAllPendingBrowserActionApprovals(): void {
  for (const [id, resolver] of approvalResolvers.entries()) {
    resolver(false);
    approvalResolvers.delete(id);
  }
}

export function hasPendingBrowserActionApprovalResolver(id: string): boolean {
  return approvalResolvers.has(id);
}

/** Test-only helper to reset resolver state between cases. */
export function resetBrowserActionApprovalStateForTests(): void {
  approvalResolvers.clear();
}