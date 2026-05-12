import type { AutoResearchRunEvent, AutoResearchRunRecord } from './history';

function readNumericMetadata(event: AutoResearchRunEvent, key: string): number | null {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatAutoResearchEventLine(event: AutoResearchRunEvent): string {
  return `[${event.timestamp}] [${event.phase}] ${event.message}`;
}

export function formatAutoResearchEventDump(events: AutoResearchRunEvent[]): string {
  return events.map(formatAutoResearchEventLine).join('\n');
}

export function getAutoResearchEventMetadataBadges(event: AutoResearchRunEvent): string[] {
  const toolBudgetUsed = readNumericMetadata(event, 'tool_budget_used');
  const toolBudgetMax = readNumericMetadata(event, 'tool_budget_max');
  const failedCalls = readNumericMetadata(event, 'failed_calls');
  const successfulCalls = readNumericMetadata(event, 'successful_calls');
  const badges: string[] = [];

  if (toolBudgetUsed !== null && toolBudgetMax !== null) {
    badges.push(`tool_budget_used=${toolBudgetUsed}/${toolBudgetMax}`);
  } else if (toolBudgetUsed !== null) {
    badges.push(`tool_budget_used=${toolBudgetUsed}`);
  }

  if (failedCalls !== null) {
    badges.push(`failed_calls=${failedCalls}`);
  }

  if (successfulCalls !== null) {
    badges.push(`successful_calls=${successfulCalls}`);
  }

  return badges;
}

export function buildAutoResearchLiveOutputFilename(run: AutoResearchRunRecord): string {
  const safeRunId = run.id.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const iteration = Math.max(run.currentIteration, 1);
  return `${safeRunId}-iter-${String(iteration).padStart(3, '0')}-live.log`;
}
