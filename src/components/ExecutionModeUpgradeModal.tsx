/**
 * Shown when an Ask-mode request needs tools.
 *
 * The UI exposes the three-mode product model: Ask / Plan / Danger. The
 * existing UI-store resolver still emits the historical `agent` / `bypass`
 * compatibility signals; the execution-mode normalizer maps those to Plan /
 * Danger until the persisted migration window closes.
 */

import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { t } from '@/i18n';
import type { AskModeToolNeedReason } from '@/services/executionMode/askModeToolNeed';
import { DangerWarningDialog } from './chatInput/ExecutionModeDropdown';
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
  const visible = useUIStore((state) => state.executionModeUpgradeVisible);
  const reason = useUIStore((state) => state.executionModeUpgradeReason);
  const messagePreview = useUIStore((state) => state.executionModeUpgradeMessagePreview);
  const resolve = useUIStore((state) => state.resolveExecutionModeUpgradePrompt);
  const [pendingDanger, setPendingDanger] = useState(false);

  useEffect(() => {
    if (!visible) setPendingDanger(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resolve('cancel');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, resolve]);

  if (!visible) return null;

  const dangerProfile = EXECUTION_MODES.find((profile) => profile.id === 'danger');

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
          <h3 id="execution-mode-upgrade-title" className="text-sm font-semibold text-gray-900">
            {t('executionMode.upgrade.title')}
          </h3>
          <p id="execution-mode-upgrade-body" className="mt-2 text-[12px] leading-relaxed text-gray-600">
            {t(bodyKeyForReason(reason) as 'executionMode.upgrade.body.general')}
          </p>
          {messagePreview && (
            <p className="mt-3 line-clamp-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
              {messagePreview}
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
            {t('executionMode.upgrade.hint')}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => resolve('cancel')}
              data-testid="execution-mode-upgrade-cancel"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('executionMode.upgrade.cancel')}
            </button>
            <button
              type="button"
              onClick={() => resolve('agent')}
              data-testid="execution-mode-upgrade-plan"
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] font-medium text-blue-700 hover:bg-blue-100"
            >
              {t('executionMode.plan.label')}
            </button>
            <button
              type="button"
              onClick={() => setPendingDanger(true)}
              data-testid="execution-mode-upgrade-danger"
              className="rounded-lg bg-rose-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-rose-700"
            >
              {t('executionMode.danger.label')}
            </button>
          </div>
        </div>
      </div>

      {pendingDanger && dangerProfile && (
        <DangerWarningDialog
          profile={dangerProfile}
          onCancel={() => setPendingDanger(false)}
          onConfirm={() => {
            setPendingDanger(false);
            resolve('bypass');
          }}
        />
      )}
    </>
  );
}

export default ExecutionModeUpgradeModal;
