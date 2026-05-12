import { buildMetricTimeline, type AutoResearchMetricPoint } from '@/services/autoresearch/metricTimeline';
import { formatError } from '@/services/autoresearch/errors';
import { t } from '@/i18n';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { AutoResearchMetricChart } from './AutoResearchMetricChart';

interface AutoResearchDashboardMetricCardProps {
  run: AutoResearchRunRecord;
  points?: AutoResearchMetricPoint[];
  className?: string;
}

export function AutoResearchDashboardMetricCard({
  run,
  points,
  className = '',
}: AutoResearchDashboardMetricCardProps) {
  let resolvedPoints = points;
  let renderError: string | null = null;

  if (!resolvedPoints) {
    try {
      resolvedPoints = buildMetricTimeline(run);
    } catch (error) {
      renderError = formatError(error);
    }
  }

  return (
    <section className={`rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8f8375]">{t('autoresearch.detail.metricHistory')}</p>
          <p className="mt-2 text-sm text-[#655a4f]">
            {run.config.metric || 'metric'} · {run.config.direction === 'lower' ? t('autoresearch.lowerIsBetter') : t('autoresearch.higherIsBetter')}
          </p>
        </div>
      </div>

      {renderError ? (
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {renderError}
        </div>
      ) : (
        <AutoResearchMetricChart
          run={run}
          points={resolvedPoints}
          variant="light"
          className="mt-4"
        />
      )}
    </section>
  );
}

export default AutoResearchDashboardMetricCard;
