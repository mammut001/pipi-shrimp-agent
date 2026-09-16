import { describe, expect, it } from '@jest/globals';
import {
  CANCEL_INTERRUPT_LABELS,
  formatCancelInterruptLabel,
  formatCancelNoticeKindLabel,
  formatTaskStepCancelLabel,
  isCancelInterruptTaskStepStatus,
  normalizeCancelledStatus,
} from '../cancelInterruptVocab';

describe('cancelInterruptVocab', () => {
  it('exposes unified Cancelling / Cancelled / Interrupted labels', () => {
    expect(CANCEL_INTERRUPT_LABELS).toEqual({
      cancelling: 'Cancelling',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted',
    });
    expect(formatCancelInterruptLabel('cancelling')).toBe('Cancelling');
    expect(formatCancelInterruptLabel('cancelled')).toBe('Cancelled');
    expect(formatCancelInterruptLabel('interrupted')).toBe('Interrupted');
  });

  it('maps notice kinds onto the same terminal vocabulary', () => {
    expect(formatCancelNoticeKindLabel('user_cancel')).toBe('Cancelled');
    expect(formatCancelNoticeKindLabel('interrupted')).toBe('Interrupted');
  });

  it('maps TaskStep cancel statuses and ignores unrelated ones', () => {
    expect(formatTaskStepCancelLabel('cancelling')).toBe('Cancelling');
    expect(formatTaskStepCancelLabel('cancelled')).toBe('Cancelled');
    expect(formatTaskStepCancelLabel('running')).toBeNull();
    expect(isCancelInterruptTaskStepStatus('cancelling')).toBe(true);
    expect(isCancelInterruptTaskStepStatus('cancelled')).toBe(true);
    expect(isCancelInterruptTaskStepStatus('failed')).toBe(false);
  });

  it('normalizes American canceled spelling to cancelled', () => {
    expect(normalizeCancelledStatus('cancelled')).toBe('cancelled');
    expect(normalizeCancelledStatus('canceled')).toBe('cancelled');
    expect(normalizeCancelledStatus('failed')).toBeNull();
  });
});
