import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import {
  buildMetricTimeline,
  formatMetricValue,
  getBestMetricPoint,
  type AutoResearchMetricPoint,
} from '@/services/autoresearch/metricTimeline';

interface AutoResearchMetricChartProps {
  run: AutoResearchRunRecord;
  points?: AutoResearchMetricPoint[];
  className?: string;
}

const chartWidth = 640;
const chartHeight = 260;
const padding = { top: 24, right: 28, bottom: 42, left: 58 };

function markerColor(decision: AutoResearchMetricPoint['decision']): string {
  switch (decision) {
    case 'baseline':
      return '#0f766e';
    case 'keep':
      return '#16a34a';
    case 'discard':
      return '#d97706';
    case 'failed':
      return '#dc2626';
    case 'running':
      return '#2563eb';
    case 'pending':
      return '#9ca3af';
    case 'no_metric':
    default:
      return '#6b7280';
  }
}

function normalizeRange(values: number[]): { min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) > 1e-9) {
    const pad = Math.abs(max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  }
  const pad = Math.max(Math.abs(max) * 0.01, 0.001);
  return { min: min - pad, max: max + pad };
}

function xForIteration(iteration: number, minIteration: number, maxIteration: number): number {
  const plotWidth = chartWidth - padding.left - padding.right;
  if (maxIteration === minIteration) {
    return padding.left + plotWidth / 2;
  }
  return padding.left + ((iteration - minIteration) / (maxIteration - minIteration)) * plotWidth;
}

function yForValue(value: number, minValue: number, maxValue: number): number {
  const plotHeight = chartHeight - padding.top - padding.bottom;
  return padding.top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight;
}

export function AutoResearchMetricChart({ run, points: providedPoints, className = '' }: AutoResearchMetricChartProps) {
  const points = providedPoints ?? buildMetricTimeline(run);
  const numericPoints = points.filter((point): point is AutoResearchMetricPoint & { value: number } => typeof point.value === 'number');
  const nonNumericPoints = points.filter((point) => point.value === null && !point.isBaseline);
  const bestPoint = getBestMetricPoint(points);
  const baselinePoint = points.find((point) => point.isBaseline && typeof point.value === 'number');
  const metricName = run.config.metric || points[0]?.metricName || 'metric';
  const directionLabel = run.config.direction === 'higher' ? 'higher is better' : 'lower is better';

  if (numericPoints.length === 0) {
    return (
      <div className={`rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4 ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8f8375]">Metric History</p>
            <h4 className="mt-1 text-base font-semibold text-[#2f251a]">{metricName}</h4>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#6f665c] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
            {directionLabel}
          </span>
        </div>
        <div className="mt-4 flex h-40 items-center justify-center rounded-xl border border-dashed border-[#d8cfc1] bg-white/70 text-sm text-[#8a7f72]">
          No parsed metric points yet.
        </div>
      </div>
    );
  }

  const maxIteration = Math.max(run.config.iterations, ...points.map((point) => point.iteration));
  const minIteration = Math.min(0, ...points.map((point) => point.iteration));
  const { min: minValue, max: maxValue } = normalizeRange(numericPoints.map((point) => point.value));
  const plottedPoints = numericPoints.map((point) => ({
    point,
    x: xForIteration(point.iteration, minIteration, maxIteration),
    y: yForValue(point.value, minValue, maxValue),
  }));
  const polyline = plottedPoints.map((item) => `${item.x},${item.y}`).join(' ');
  const baselineY = baselinePoint ? yForValue(baselinePoint.value, minValue, maxValue) : null;

  return (
    <div className={`rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8f8375]">Metric History</p>
          <h4 className="mt-1 text-base font-semibold text-[#2f251a]">{metricName}</h4>
          <p className="mt-1 text-xs text-[#6f665c]">
            {directionLabel}
            {baselinePoint ? ` · baseline ${formatMetricValue(baselinePoint.value)}` : ''}
          </p>
        </div>
        <div className="rounded-xl bg-white px-3 py-2 text-right text-xs text-[#5c5247] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#998c7e]">Best</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-[#2f251a]">
            {bestPoint?.value !== null && bestPoint?.value !== undefined ? formatMetricValue(bestPoint.value) : 'N/A'}
          </p>
          <p className="text-[10px] text-[#8a7f72]">iteration {bestPoint?.iteration ?? 'N/A'}</p>
        </div>
      </div>

      <svg className="mt-4 h-auto w-full overflow-visible" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${metricName} metric history`}>
        <rect x={padding.left} y={padding.top} width={chartWidth - padding.left - padding.right} height={chartHeight - padding.top - padding.bottom} rx="10" fill="#ffffff" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight - padding.bottom} stroke="#d8cfc1" />
        <line x1={padding.left} y1={chartHeight - padding.bottom} x2={chartWidth - padding.right} y2={chartHeight - padding.bottom} stroke="#d8cfc1" />
        {[minValue, (minValue + maxValue) / 2, maxValue].map((value) => {
          const y = yForValue(value, minValue, maxValue);
          return (
            <g key={value}>
              <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="#f1ede6" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="fill-[#8a7f72] text-[11px]">
                {formatMetricValue(value)}
              </text>
            </g>
          );
        })}
        {baselineY !== null && (
          <g>
            <line x1={padding.left} y1={baselineY} x2={chartWidth - padding.right} y2={baselineY} stroke="#0f766e" strokeDasharray="6 5" opacity="0.7" />
            <text x={chartWidth - padding.right} y={baselineY - 8} textAnchor="end" className="fill-[#0f766e] text-[11px] font-semibold">
              baseline
            </text>
          </g>
        )}
        {plottedPoints.length > 1 && (
          <polyline points={polyline} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {nonNumericPoints.map((point) => {
          const x = xForIteration(point.iteration, minIteration, maxIteration);
          const y = chartHeight - padding.bottom + 18;
          return (
            <g key={`empty-${point.iteration}`}>
              <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} stroke={markerColor(point.decision)} strokeWidth="2" />
              <line x1={x + 5} y1={y - 5} x2={x - 5} y2={y + 5} stroke={markerColor(point.decision)} strokeWidth="2" />
            </g>
          );
        })}
        {plottedPoints.map(({ point, x, y }) => {
          const color = markerColor(point.decision);
          return (
            <g key={`point-${point.iteration}`}>
              {point.isBestSoFar && !point.isBaseline && (
                <circle cx={x} cy={y} r="9" fill="none" stroke="#16a34a" strokeWidth="2" />
              )}
              <circle cx={x} cy={y} r={point.isBaseline ? 6 : 5} fill={color} stroke="#fff" strokeWidth="2" />
              <text x={x} y={chartHeight - padding.bottom + 28} textAnchor="middle" className="fill-[#8a7f72] text-[11px]">
                {point.iteration}
              </text>
            </g>
          );
        })}
        <text x={(chartWidth + padding.left - padding.right) / 2} y={chartHeight - 6} textAnchor="middle" className="fill-[#8a7f72] text-[11px]">
          iteration
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#6f665c]">
        {[
          ['baseline', '#0f766e'],
          ['keep', '#16a34a'],
          ['discard', '#d97706'],
          ['failed/no metric', '#dc2626'],
        ].map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default AutoResearchMetricChart;