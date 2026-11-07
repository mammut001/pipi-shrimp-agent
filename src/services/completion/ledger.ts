export interface CompletionLedgerEntry {
  status: 'pass' | 'failed';
  repairs: number;
  reasons: string[];
  modelTrail: string[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null | undefined;
  acceptanceCommands: string[];
  timestamp: number;
}

export interface CompletionLedger {
  entries: CompletionLedgerEntry[];
  totals: {
    turns: number;
    repairs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
  };
}

const MAX_LEDGER_ENTRIES = 200;

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing?: { inputPerMillion?: number; outputPerMillion?: number } | null,
): number | null {
  if (!pricing || typeof pricing.inputPerMillion !== 'number' || typeof pricing.outputPerMillion !== 'number') {
    return null;
  }
  return round6((inputTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion);
}

export function appendCompletionLedgerEntry(
  ledger: CompletionLedger | undefined,
  entry: Omit<CompletionLedgerEntry, 'timestamp'> & { timestamp?: number },
): CompletionLedger {
  const base: CompletionLedger = ledger ?? {
    entries: [],
    totals: { turns: 0, repairs: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null },
  };
  const full: CompletionLedgerEntry = { ...entry, timestamp: entry.timestamp ?? Date.now() };
  const entries = [...base.entries, full].slice(-MAX_LEDGER_ENTRIES);
  const totals = {
    turns: entries.length,
    repairs: entries.reduce((sum, item) => sum + item.repairs, 0),
    inputTokens: entries.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: entries.reduce((sum, item) => sum + item.outputTokens, 0),
    estimatedCostUsd: null as number | null,
  };
  let cost: number | null = 0;
  for (const item of entries) {
    if (item.estimatedCostUsd === null || item.estimatedCostUsd === undefined) {
      cost = null;
      break;
    }
    cost += item.estimatedCostUsd;
  }
  totals.estimatedCostUsd = cost === null ? null : round6(cost);
  return { entries, totals };
}

export function renderCompletionLedgerMarkdown(ledger: CompletionLedger): string {
  const lines = [
    '# Completion Ledger',
    '',
    `- turns: ${ledger.totals.turns}`,
    `- repairs: ${ledger.totals.repairs}`,
    `- input_tokens: ${ledger.totals.inputTokens}`,
    `- output_tokens: ${ledger.totals.outputTokens}`,
    `- estimated_cost_usd: ${ledger.totals.estimatedCostUsd ?? 'unknown'}`,
    '',
  ];
  for (const entry of ledger.entries) {
    lines.push(
      `## ${new Date(entry.timestamp).toLocaleString()} · ${entry.status} · repairs=${entry.repairs}`,
      `- models: ${entry.modelTrail.join(' -> ') || '(unknown)'}`,
      `- tokens: ${entry.inputTokens} in / ${entry.outputTokens} out · cost_usd=${entry.estimatedCostUsd ?? 'unknown'}`,
      `- acceptance: ${entry.acceptanceCommands.join(' | ') || '(none)'}`,
      entry.reasons.length > 0 ? `- reasons: ${entry.reasons.join('; ')}` : '- reasons: (none)',
      '',
    );
  }
  return lines.join('\n');
}
