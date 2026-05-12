import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { formatMetricValue } from '@/services/autoresearch/metricTimeline';
import { buildAutoResearchModelDisplayFromSnapshot } from '@/services/autoresearch/modelDisplay';

interface AutoResearchRunChipsProps {
  run: AutoResearchRunRecord;
  className?: string;
}

interface ChipItem {
  id: string;
  label: string;
  accent?: boolean;
}

function stringifyChipValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return null;
}

function truncateValue(value: string, maxLength = 56): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getPrimaryChip(run: AutoResearchRunRecord): ChipItem | null {
  const candidateRecord = run as AutoResearchRunRecord & {
    task?: unknown;
    command?: unknown;
  };

  const candidate = stringifyChipValue(candidateRecord.command)
    ?? stringifyChipValue(candidateRecord.task)
    ?? stringifyChipValue(run.title);

  if (!candidate) {
    return null;
  }

  return {
    id: 'primary',
    label: truncateValue(candidate),
    accent: true,
  };
}

export function AutoResearchRunChips({ run, className = '' }: AutoResearchRunChipsProps) {
  const primaryChip = getPrimaryChip(run);
  const baselineLabel = typeof run.config.baseline === 'number'
    ? formatMetricValue(run.config.baseline)
    : null;
  const modelDisplay = buildAutoResearchModelDisplayFromSnapshot(run.config.configSnapshot);

  const chips: ChipItem[] = [
    primaryChip,
    stringifyChipValue(run.config.metric) ? { id: 'metric', label: `metric=${run.config.metric}` } : null,
    stringifyChipValue(run.config.iterations) ? { id: 'iterations', label: `max_iterations=${run.config.iterations}` } : null,
    baselineLabel ? { id: 'baseline', label: `baseline=${baselineLabel}` } : null,
    stringifyChipValue(run.config.direction) ? { id: 'direction', label: `direction=${run.config.direction}` } : null,
    { id: 'model', label: `model=${truncateValue(modelDisplay.modelLabel, 36)}` },
    { id: 'provider', label: `provider=${truncateValue(modelDisplay.providerLabel, 40)}` },
    stringifyChipValue(run.config.configSnapshot.configName) ? { id: 'config', label: `config=${truncateValue(run.config.configSnapshot.configName, 40)}` } : null,
  ].filter((chip): chip is ChipItem => chip !== null);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className={chip.accent
            ? 'rounded-full border border-[#c9dfd5] bg-[#e5f1ec] px-3 py-1 text-xs font-medium text-[#21685a]'
            : 'rounded-full border border-[#e3d8cb] bg-[#f7f2eb] px-3 py-1 text-xs text-[#6b5f52] transition-colors hover:bg-white'
          }
          title={chip.label}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

export default AutoResearchRunChips;