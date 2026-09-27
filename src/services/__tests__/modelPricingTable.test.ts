import { describe, expect, it } from '@jest/globals';
import { isPricingTableStale, parsePricingTimestamp } from '../modelPricingTable';

const meta = (updatedAt: string) => ({
  source: 'openrouter/api/v1/models',
  updated_at: updatedAt,
  count: 1,
  active_count: 1,
  retained_count: 0,
});

describe('model pricing table staleness', () => {
  it('parses the backend timestamp with its UTC offset', () => {
    expect(parsePricingTimestamp('2026-09-23 20:34:28+0800'))
      .toBe(Date.parse('2026-09-23T12:34:28Z'));
  });

  it('refreshes tables older than a week, or with no usable timestamp', () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    expect(isPricingTableStale(meta('2026-09-23 20:34:28+0800'), now)).toBe(false);
    expect(isPricingTableStale(meta('2026-09-19 00:00:00+0000'), now)).toBe(true);
    expect(isPricingTableStale(meta('not a date'), now)).toBe(true);
    expect(isPricingTableStale(null, now)).toBe(true);
  });
});
