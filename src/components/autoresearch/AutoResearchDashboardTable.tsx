import { useEffect, useMemo, useState } from 'react';
import { buildIterationSummaries, type AutoResearchIterationSummary } from '@/services/autoresearch/metricTimeline';
import { formatError } from '@/services/autoresearch/errors';
import { t } from '@/i18n';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { AutoResearchIterationTable } from './AutoResearchIterationTable';

interface AutoResearchDashboardTableProps {
  run: AutoResearchRunRecord;
  summaries?: AutoResearchIterationSummary[];
  selectedIteration?: number | null;
  onSelectIteration?: (iteration: number) => void;
  className?: string;
}

export function AutoResearchDashboardTable({
  run,
  summaries: providedSummaries,
  selectedIteration,
  onSelectIteration,
  className = '',
}: AutoResearchDashboardTableProps) {
  const [internalSelectedIteration, setInternalSelectedIteration] = useState<number | null>(selectedIteration ?? null);

  useEffect(() => {
    if (selectedIteration !== undefined) {
      setInternalSelectedIteration(selectedIteration ?? null);
    }
  }, [selectedIteration]);

  const { summaries, renderError } = useMemo(() => {
    if (providedSummaries) {
      return { summaries: providedSummaries, renderError: null as string | null };
    }

    try {
      return {
        summaries: buildIterationSummaries(run),
        renderError: null as string | null,
      };
    } catch (error) {
      return {
        summaries: [] as AutoResearchIterationSummary[],
        renderError: formatError(error),
      };
    }
  }, [providedSummaries, run]);

  useEffect(() => {
    if (selectedIteration === undefined && internalSelectedIteration === null && summaries.length > 0) {
      setInternalSelectedIteration(summaries[summaries.length - 1].iteration);
    }
  }, [internalSelectedIteration, selectedIteration, summaries]);

  const effectiveSelectedIteration = selectedIteration ?? internalSelectedIteration;

  const handleSelectIteration = (iteration: number) => {
    if (selectedIteration === undefined) {
      setInternalSelectedIteration(iteration);
    }
    onSelectIteration?.(iteration);
  };

  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-4 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{t('autoresearch.detail.iterationsTitle')}</p>
          <p className="mt-2 text-sm text-gray-700">{t('autoresearch.detail.iterationsSubtitle')}</p>
        </div>
      </div>

      {renderError ? (
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {renderError}
        </div>
      ) : summaries.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white/70 px-4 py-6 text-sm text-gray-500">
          {t('autoresearch.detail.noIterations')}
        </div>
      ) : (
        <AutoResearchIterationTable
          run={run}
          summaries={summaries}
          selectedIteration={effectiveSelectedIteration}
          onSelectIteration={handleSelectIteration}
          variant="light"
          className="mt-4"
        />
      )}
    </section>
  );
}

export default AutoResearchDashboardTable;
