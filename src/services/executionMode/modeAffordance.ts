/**
 * Danger / execution-mode defaults affordance.
 *
 * Pure copy + status metadata so the composer can explain:
 *  - new sessions default to Ask (no tools)
 *  - shell/writes need Danger
 *  - Danger enables tools but still confirms risky ops (not legacy Bypass)
 *
 * Does not change permission/security policy — UI/copy only.
 */

import type { TranslationKeys } from '@/i18n/types';
import {
  getDefaultExecutionMode,
  getExecutionMode,
  type ActiveExecutionModeId,
  type ExecutionModeId,
} from './registry';

export type ExecutionModeAffordance = {
  modeId: ActiveExecutionModeId;
  /** i18n key for the compact status hint under the mode control */
  hintKey: keyof TranslationKeys;
  /** Stable test id for the rendered hint */
  testId: string;
  /** True when this mode is the product default for new sessions */
  isDefault: boolean;
  /** True when shell / mutating tools may run (Danger only) */
  toolsActive: boolean;
  /** True when risky categories still go through approval gates */
  riskyApprovalsRemain: boolean;
};

const AFFORDANCE_BY_MODE: Readonly<Record<ActiveExecutionModeId, Omit<ExecutionModeAffordance, 'modeId'>>> =
  Object.freeze({
    ask: {
      hintKey: 'executionMode.affordance.ask',
      testId: 'execution-mode-affordance-ask',
      isDefault: true,
      toolsActive: false,
      riskyApprovalsRemain: true,
    },
    plan: {
      hintKey: 'executionMode.affordance.plan',
      testId: 'execution-mode-affordance-plan',
      isDefault: false,
      toolsActive: false,
      riskyApprovalsRemain: true,
    },
    danger: {
      hintKey: 'executionMode.affordance.danger',
      testId: 'execution-mode-affordance-danger',
      isDefault: false,
      toolsActive: true,
      riskyApprovalsRemain: true,
    },
  });

/**
 * Resolve the compact defaults / tools status affordance for a mode id
 * (including legacy aliases via getExecutionMode).
 */
export function getExecutionModeAffordance(
  modeId: ExecutionModeId | string | null | undefined,
): ExecutionModeAffordance {
  const profile = getExecutionMode(modeId);
  const base = AFFORDANCE_BY_MODE[profile.id];
  return {
    modeId: profile.id,
    ...base,
    // Keep isDefault aligned with registry so a future default change stays consistent.
    isDefault: profile.isDefault || getDefaultExecutionMode().id === profile.id,
  };
}

/** Greppable English summary used in docs / soak notes (not user-facing). */
export function describeExecutionModeAffordance(
  modeId: ExecutionModeId | string | null | undefined,
): string {
  const a = getExecutionModeAffordance(modeId);
  if (a.modeId === 'ask') {
    return 'default Ask: no tools; switch to Danger for shell/tools';
  }
  if (a.modeId === 'plan') {
    return 'Plan: read-only tools; Danger needed for shell/writes';
  }
  return 'Danger: tools/shell active; risky ops still confirm';
}
