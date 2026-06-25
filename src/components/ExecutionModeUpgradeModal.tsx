/**
 * Shown when the user sends a tool-requiring message while in Ask mode.
 * Offers one-click upgrade to Agent or Bypass, then the send flow continues.
 */

import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { t } from '@/i18n';
import type { AskModeToolNeedReason } from '@/services/executionMode/askModeToolNeed';
import { BypassWarningDialog } from './chatInput/ExecutionModeDropdown';
import { EXECUTION_MODES } from '@/services/executionMode';

function bodyKeyForReason(reason: AskModeToolNeedReason): string {
  switch (reason) {
    case 'browser':
      return 'executionMode.upgrade.body.browser';
    case 'workspace':
      return 'executionMode.upgrade.body.workspace';
    default:
      return 'executionMode.upgrade.body.general';
  }
}

export function ExecutionModeUpgradeModal() {
  const visible = useUIStore((s) => s.executionModeUpgradeVisible);
  const reason = useUIStore((s) => s.executionModeUpgradeReason);
  const messagePreview = useUIStore((s) => s.executionModeUpgradeMessagePreview);
  const resolve = useUIStore((s) => s.resolveExecutionModeUpgradePrompt);

  const [pendingBypass, setPendingBypass] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPendingBypass(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        resolve('cancel');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, resolve]);

  if (!visible) {
    return null;
  }

  const bypassProfile = EXECUTION_MODES.find((profile) => profile.id === 'bypass');

  return (
    <>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="execution-mode-upgrade-title"
        aria-describedby="execution-mode-upgrade-body"
        data-testid="execution-mode-upgrade-modal"
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      >
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
          <h3
            id="execution-mode-upgrade-title"
            className="text-sm font-semibold text-gray-900"
          >
            {t('executionMode.upgrade.title')}
          </h3>
          <p
            id="execution-mode-upgrade-body"
            className="mt-2 text-[12px] leading-relaxed text-gray-600"
          >
            {t(bodyKeyForReason(reason) as 'executionMode.upgrade.body.general')}
          </p>
          {messagePreview && (
            <p className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500 line-clamp-3">
              {messagePreview}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => resolve('cancel')}
              data-testid="execution-mode-upgrade-cancel"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {t('executionMode.upgrade.cancel')}
            </button>
            <button
              type="button"
              onClick={() => setPendingBypass(true)}
              data-testid="execution-mode-upgrade-bypass"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700 transition-colors hover:bg-rose-100"
            >
              {t('executionMode.upgrade.bypassButton')}
            </button>
            <button
              type="button"
              onClick={() => resolve('agent')}
              data-testid="execution-mode-upgrade-agent"
              className="rounded-lg bg-gray-900 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-gray-800"
            >
              {t('executionMode.upgrade.agentButton')}
            </button>
          </div>
        </div>
      </div>

      {pendingBypass && bypassProfile && (
        <BypassWarningDialog
          profile={bypassProfile}
          onCancel={() => setPendingBypass(false)}
          onConfirm={() => {
            setPendingBypass(false);
            resolve('bypass');
          }}
        />
      )}
    </>
  );
}

export default ExecutionModeUpgradeModal;
