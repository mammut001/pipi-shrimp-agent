import { describe, it, expect } from '@jest/globals';
import {
  appendCompletionLedgerEntry,
  estimateCostUsd,
  renderCompletionLedgerMarkdown,
} from '@/services/completion/ledger';

describe('estimateCostUsd', () => {
  it('returns null when pricing is missing', () => {
    expect(estimateCostUsd(1000, 500, undefined)).toBeNull();
  });

  it('computes cost from per-million pricing', () => {
    const cost = estimateCostUsd(1_000_000, 1_000_000, { inputPerMillion: 3, outputPerMillion: 15 });
    expect(cost).toBeCloseTo(18, 10);
  });
});

describe('appendCompletionLedgerEntry', () => {
  it('builds totals from entries', () => {
    const ledger = appendCompletionLedgerEntry(undefined, {
      status: 'pass',
      repairs: 0,
      reasons: [],
      modelTrail: ['cfg-a'],
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.01,
      acceptanceCommands: [],
    });
    expect(ledger.totals.turns).toBe(1);
    expect(ledger.totals.inputTokens).toBe(1000);
    expect(ledger.totals.estimatedCostUsd).toBeCloseTo(0.01, 10);
  });

  it('cost is null if any entry lacks pricing', () => {
    const ledger = appendCompletionLedgerEntry(undefined, {
      status: 'failed',
      repairs: 1,
      reasons: ['empty_output'],
      modelTrail: [],
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: null,
      acceptanceCommands: [],
    });
    expect(ledger.totals.estimatedCostUsd).toBeNull();
  });

  it('caps entries at MAX_LEDGER_ENTRIES', () => {
    let ledger: undefined | ReturnType<typeof appendCompletionLedgerEntry> = undefined;
    for (let i = 0; i < 250; i += 1) {
      ledger = appendCompletionLedgerEntry(ledger, {
        status: 'pass',
        repairs: 0,
        reasons: [],
        modelTrail: [],
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0,
        acceptanceCommands: [],
      });
    }
    expect(ledger.entries.length).toBe(200);
    expect(ledger.totals.turns).toBe(200);
  });
});

describe('renderCompletionLedgerMarkdown', () => {
  it('produces a markdown document', () => {
    const ledger = appendCompletionLedgerEntry(undefined, {
      status: 'pass',
      repairs: 0,
      reasons: [],
      modelTrail: ['cfg-a'],
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.01,
      acceptanceCommands: ['pnpm test'],
    });
    const md = renderCompletionLedgerMarkdown(ledger);
    expect(md).toContain('Completion Ledger');
    expect(md).toContain('turns: 1');
    expect(md).toContain('pnpm test');
  });
});
