/**
 * Canonical cancel / interrupt vocabulary for TaskStep UI + durable notices.
 * Spelling: `cancelled` (accept American `canceled` only when mapping).
 * Align Cancelling / Cancelled / Interrupted — do not invent parallel labels.
 */
import type { TaskStep } from '../../types/ui';

export const CANCEL_INTERRUPT_LABELS = {
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
} as const;

export type CancelInterruptLabelKind = keyof typeof CANCEL_INTERRUPT_LABELS;

/** Same kinds as durable cancel notices (`user_cancel` | `interrupted`). */
export type CancelNoticeKind = 'user_cancel' | 'interrupted';

export function formatCancelInterruptLabel(kind: CancelInterruptLabelKind): string {
  return CANCEL_INTERRUPT_LABELS[kind];
}

/** Map TaskStep cancel-related statuses onto display labels (null if unrelated). */
export function formatTaskStepCancelLabel(status: TaskStep['status']): string | null {
  if (status === 'cancelling' || status === 'cancelled') {
    return CANCEL_INTERRUPT_LABELS[status];
  }
  return null;
}

/** Notice kind → same terminal vocabulary family as TaskStep labels. */
export function formatCancelNoticeKindLabel(kind: CancelNoticeKind): string {
  return kind === 'user_cancel'
    ? CANCEL_INTERRUPT_LABELS.cancelled
    : CANCEL_INTERRUPT_LABELS.interrupted;
}

/** Normalize native/legacy spellings onto canonical `cancelled`. */
export function normalizeCancelledStatus(status: string | null | undefined): 'cancelled' | null {
  if (status === 'cancelled' || status === 'canceled') {
    return 'cancelled';
  }
  return null;
}

export function isCancelInterruptTaskStepStatus(status: TaskStep['status']): boolean {
  return status === 'cancelling' || status === 'cancelled';
}
