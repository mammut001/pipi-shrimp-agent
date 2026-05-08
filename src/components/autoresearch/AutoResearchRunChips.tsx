import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { formatMetricValue } from '@/services/autoresearch/metricTimeline';

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

  const chips: ChipItem[] = [
    primaryChip,
    stringifyChipValue(run.config.metric) ? { id: 'metric', label: `metric=${run.config.metric}` } : null,
    stringifyChipValue(run.config.iterations) ? { id: 'iterations', label: `max_iterations=${run.config.iterations}` } : null,
    baselineLabel ? { id: 'baseline', label: `baseline=${baselineLabel}` } : null,
    stringifyChipValue(run.config.direction) ? { id: 'direction', label: `direction=${run.config.direction}` } : null,
    stringifyChipValue(run.config.configSnapshot.model) ? { id: 'model', label: `model=${truncateValue(run.config.configSnapshot.model, 36)}` } : null,
    stringifyChipValue(run.config.configSnapshot.provider) ? { id: 'provider', label: `provider=${run.config.configSnapshot.provider}` } : null,
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
            ? 'rounded-full border border-[#d9c078]/35 bg-[#d9c078]/10 px-3 py-1 text-xs font-medium text-[#f3deb0]'
            : 'rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70 transition-colors hover:bg-white/[0.07]'
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