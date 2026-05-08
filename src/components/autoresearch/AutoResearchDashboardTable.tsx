import { useEffect, useMemo, useState } from 'react';
import { buildIterationSummaries, type AutoResearchIterationSummary } from '@/services/autoresearch/metricTimeline';
import { formatError } from '@/services/autoresearch/errors';
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
    <section className={`rounded-[16px] border border-white/10 bg-[#1a1a1a] p-4 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Iterations</p>
          <p className="mt-2 text-sm text-white/55">Compact benchmark deltas for each candidate run.</p>
        </div>
      </div>

      {renderError ? (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {renderError}
        </div>
      ) : summaries.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/50">
          No iterations recorded yet.
        </div>
      ) : (
        <AutoResearchIterationTable
          run={run}
          summaries={summaries}
          selectedIteration={effectiveSelectedIteration}
          onSelectIteration={handleSelectIteration}
          variant="dashboard"
          className="mt-4"
        />
      )}
    </section>
  );
}

export default AutoResearchDashboardTable;