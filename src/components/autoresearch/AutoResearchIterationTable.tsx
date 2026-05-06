import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import {
  buildIterationSummaries,
  formatMetricValue,
  type AutoResearchIterationDecision,
  type AutoResearchIterationSummary,
} from '@/services/autoresearch/metricTimeline';

interface AutoResearchIterationTableProps {
  run: AutoResearchRunRecord;
  summaries?: AutoResearchIterationSummary[];
  selectedIteration?: number | null;
  onSelectIteration?: (iteration: number) => void;
  className?: string;
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed || 'artifact';
}

function statusClassName(status: AutoResearchIterationDecision): string {
  const styles: Record<AutoResearchIterationDecision, string> = {
    baseline: 'bg-teal-50 text-teal-700 border-teal-100',
    keep: 'bg-green-50 text-green-700 border-green-100',
    discard: 'bg-amber-50 text-amber-700 border-amber-100',
    failed: 'bg-red-50 text-red-700 border-red-100',
    running: 'bg-blue-50 text-blue-700 border-blue-100',
    pending: 'bg-gray-50 text-gray-600 border-gray-100',
    no_metric: 'bg-stone-50 text-stone-600 border-stone-100',
  };
  return styles[status];
}

export function AutoResearchDecisionBadge({ status }: { status: AutoResearchIterationDecision }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClassName(status)}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function commitOrArtifactLabel(summary: AutoResearchIterationSummary): string {
  if (summary.commitHash) {
    return summary.commitHash.slice(0, 10);
  }
  const artifactPath = summary.artifactPaths?.[0];
  if (artifactPath) {
    return basename(artifactPath);
  }
  return summary.iteration === 0 ? 'baseline' : `#${summary.iteration}`;
}

export function AutoResearchIterationTable({
  run,
  summaries: providedSummaries,
  selectedIteration,
  onSelectIteration,
  className = '',
}: AutoResearchIterationTableProps) {
  const summaries = providedSummaries ?? buildIterationSummaries(run);

  return (
    <div className={`overflow-hidden rounded-2xl border border-[#ebe4d9] bg-white ${className}`}>
      <div className="border-b border-[#f1ede6] px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8f8375]">Iteration Summary</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#fbfaf7] text-[11px] uppercase tracking-[0.14em] text-[#8f8375]">
            <tr>
              <th className="px-4 py-2 font-semibold">Run</th>
              <th className="px-4 py-2 font-semibold">Commit/Artifact</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Change</th>
              <th className="px-4 py-2 text-right font-semibold">Impact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f1ede6]">
            {summaries.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-[#8a7f72]" colSpan={5}>No iterations recorded yet.</td>
              </tr>
            ) : summaries.map((summary) => {
              const selected = selectedIteration === summary.iteration;
              return (
                <tr
                  key={summary.iteration}
                  role={onSelectIteration ? 'button' : undefined}
                  tabIndex={onSelectIteration ? 0 : undefined}
                  onClick={() => onSelectIteration?.(summary.iteration)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      onSelectIteration?.(summary.iteration);
                    }
                  }}
                  className={`${onSelectIteration ? 'cursor-pointer' : ''} ${selected ? 'bg-[#f1eadf]/80' : 'hover:bg-[#fbfaf7]'}`}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[#6f665c]">
                    {summary.iteration === 0 ? 'Baseline' : `#${summary.iteration}`}
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-[#8a7f72]" title={commitOrArtifactLabel(summary)}>
                    {commitOrArtifactLabel(summary)}
                  </td>
                  <td className="px-4 py-3">
                    <AutoResearchDecisionBadge status={summary.status} />
                  </td>
                  <td className="max-w-[360px] px-4 py-3 text-[#4f463d]">
                    <span className="line-clamp-2">{summary.changeSummary}</span>
                    <span className="mt-1 block text-[11px] font-mono text-[#8a7f72]">
                      {summary.metricName}={formatMetricValue(summary.metricValue)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[#2f251a]">
                    {summary.impactLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AutoResearchIterationTable;