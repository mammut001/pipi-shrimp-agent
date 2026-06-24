import React from 'react';

import { t } from '@/i18n';
import { useBrowserAgentStore } from '@/store/browserAgentStore';

export function BrowserActionApprovalPrompt(): React.ReactElement | null {
  const pending = useBrowserAgentStore((state) => state.pendingBrowserActionApproval);
  const approveBrowserAction = useBrowserAgentStore((state) => state.approveBrowserAction);
  const rejectBrowserAction = useBrowserAgentStore((state) => state.rejectBrowserAction);

  if (!pending) {
    return null;
  }

  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950"
      data-testid="browser-action-approval-prompt"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
        {t('browserAgent.approval.title')}
      </p>
      <p className="mt-1 text-xs text-amber-900">{t('browserAgent.approval.description')}</p>
      <p className="mt-2 text-xs text-amber-950">
        <span className="font-medium">{pending.actionType}</span>
        {pending.summary ? `: ${pending.summary}` : null}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => approveBrowserAction(pending.id)}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          data-testid="browser-action-approval-allow"
        >
          {t('browserAgent.approval.allow')}
        </button>
        <button
          type="button"
          onClick={() => rejectBrowserAction(pending.id)}
          className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          data-testid="browser-action-approval-deny"
        >
          {t('browserAgent.approval.deny')}
        </button>
      </div>
    </div>
  );
}

export default BrowserActionApprovalPrompt;