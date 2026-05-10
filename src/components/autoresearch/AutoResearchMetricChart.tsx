import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { t } from '@/i18n';
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
  variant?: 'light' | 'dashboard';
}

const chartWidth = 640;
const chartHeight = 260;
const padding = { top: 24, right: 28, bottom: 42, left: 58 };

function markerColor(decision: AutoResearchMetricPoint['decision'], variant: 'light' | 'dashboard'): string {
  switch (decision) {
    case 'baseline':
      return '#0f766e';
    case 'keep':
      return variant === 'dashboard' ? '#ffd75a' : '#16a34a';
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

const lightTheme = {
  wrapperClassName: 'rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4',
  titleClassName: 'text-[#2f251a]',
  eyebrowClassName: 'text-[#8f8375]',
  subtitleClassName: 'text-[#6f665c]',
  badgeClassName: 'rounded-xl bg-white px-3 py-2 text-right text-xs text-[#5c5247] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]',
  directionBadgeClassName: 'rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#6f665c] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]',
  plotBg: '#ffffff',
  axisLine: '#d8cfc1',
  gridLine: '#f1ede6',
  axisText: '#8a7f72',
  line: '#2563eb',
  bestOutline: '#16a34a',
  pointBorder: '#ffffff',
  emptyBg: 'rgba(255,255,255,0.7)',
  emptyBorder: '#d8cfc1',
  emptyText: '#8a7f72',
  legendTextClassName: 'text-[#6f665c]',
  keepGuide: 'transparent',
};

const dashboardTheme = {
  wrapperClassName: 'rounded-[16px] border border-white/10 bg-[#171717] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]',
  titleClassName: 'text-[#f4f4f4]',
  eyebrowClassName: 'text-white/40',
  subtitleClassName: 'text-white/55',
  badgeClassName: 'rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-right text-xs text-white/78',
  directionBadgeClassName: 'rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/70',
  plotBg: '#1a1a1a',
  axisLine: 'rgba(255,255,255,0.10)',
  gridLine: 'rgba(255,255,255,0.08)',
  axisText: 'rgba(255,255,255,0.42)',
  line: '#b8c7e8',
  bestOutline: '#ffd75a',
  pointBorder: '#171717',
  emptyBg: 'rgba(255,255,255,0.03)',
  emptyBorder: 'rgba(255,255,255,0.10)',
  emptyText: 'rgba(255,255,255,0.55)',
  legendTextClassName: 'text-white/60',
  keepGuide: 'rgba(255,215,90,0.18)',
};

export function AutoResearchMetricChart({
  run,
  points: providedPoints,
  className = '',
  variant = 'light',
}: AutoResearchMetricChartProps) {
  const theme = variant === 'dashboard' ? dashboardTheme : lightTheme;
  const points = providedPoints ?? buildMetricTimeline(run);
  const numericPoints = points.filter((point): point is AutoResearchMetricPoint & { value: number } => typeof point.value === 'number');
  const nonNumericPoints = points.filter((point) => point.value === null && !point.isBaseline);
  const bestPoint = getBestMetricPoint(points);
  const baselinePoint = points.find((point) => point.isBaseline && typeof point.value === 'number');
  const metricName = run.config.metric || points[0]?.metricName || 'metric';
  const directionLabel = run.config.direction === 'higher' ? t('autoresearch.higherIsBetter') : t('autoresearch.lowerIsBetter');

  if (numericPoints.length === 0) {
    return (
      <div data-variant={variant} className={`${theme.wrapperClassName} ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${theme.eyebrowClassName}`}>{t('autoresearch.detail.metricHistory')}</p>
            <h4 className={`mt-1 text-base font-semibold ${theme.titleClassName}`}>{metricName}</h4>
          </div>
          <span className={theme.directionBadgeClassName}>
            {directionLabel}
          </span>
        </div>
        <div
          className="mt-4 flex h-40 items-center justify-center rounded-xl border border-dashed text-sm"
          style={{
            borderColor: theme.emptyBorder,
            background: theme.emptyBg,
            color: theme.emptyText,
          }}
        >
          {t('autoresearch.detail.noParsedMetricPoints')}
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
  const baselineY = baselinePoint && typeof baselinePoint.value === 'number'
    ? yForValue(baselinePoint.value, minValue, maxValue)
    : null;

  return (
    <div data-variant={variant} className={`${theme.wrapperClassName} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${theme.eyebrowClassName}`}>{t('autoresearch.detail.metricHistory')}</p>
          <h4 className={`mt-1 text-base font-semibold ${theme.titleClassName}`}>{metricName}</h4>
          <p className={`mt-1 text-xs ${theme.subtitleClassName}`}>
            {directionLabel}
            {baselinePoint ? ` · ${t('autoresearch.detail.baseline').toLowerCase()} ${formatMetricValue(baselinePoint.value)}` : ''}
          </p>
        </div>
        <div className={theme.badgeClassName}>
          <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${theme.eyebrowClassName}`}>{t('autoresearch.detail.best')}</p>
          <p className={`mt-0.5 font-mono text-sm font-semibold ${theme.titleClassName}`}>
            {bestPoint?.value !== null && bestPoint?.value !== undefined ? formatMetricValue(bestPoint.value) : 'N/A'}
          </p>
          <p className={`text-[10px] ${theme.subtitleClassName}`}>{t('autoresearch.detail.iterationAxis')} {bestPoint?.iteration ?? 'N/A'}</p>
        </div>
      </div>

      <svg className="mt-4 h-auto w-full overflow-visible" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${metricName} metric history`}>
        <rect x={padding.left} y={padding.top} width={chartWidth - padding.left - padding.right} height={chartHeight - padding.top - padding.bottom} rx="10" fill={theme.plotBg} />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight - padding.bottom} stroke={theme.axisLine} />
        <line x1={padding.left} y1={chartHeight - padding.bottom} x2={chartWidth - padding.right} y2={chartHeight - padding.bottom} stroke={theme.axisLine} />
        {[minValue, (minValue + maxValue) / 2, maxValue].map((value) => {
          const y = yForValue(value, minValue, maxValue);
          return (
            <g key={value}>
              <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke={theme.gridLine} />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" fill={theme.axisText} className="text-[11px]">
                {formatMetricValue(value)}
              </text>
            </g>
          );
        })}
        {variant === 'dashboard' && plottedPoints.filter(({ point }) => point.decision === 'keep' && !point.isBaseline).map(({ point, x }) => (
          <line
            key={`keep-guide-${point.iteration}`}
            x1={x}
            y1={padding.top}
            x2={x}
            y2={chartHeight - padding.bottom}
            stroke={theme.keepGuide}
            strokeDasharray="4 6"
          />
        ))}
        {baselineY !== null && (
          <g>
            <line x1={padding.left} y1={baselineY} x2={chartWidth - padding.right} y2={baselineY} stroke="#0f766e" strokeDasharray="6 5" opacity="0.7" />
            <text x={chartWidth - padding.right} y={baselineY - 8} textAnchor="end" fill="#0f766e" className="text-[11px] font-semibold">
              {t('autoresearch.detail.baseline').toLowerCase()}
            </text>
          </g>
        )}
        {plottedPoints.length > 1 && (
          <polyline points={polyline} fill="none" stroke={theme.line} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {nonNumericPoints.map((point) => {
          const x = xForIteration(point.iteration, minIteration, maxIteration);
          const y = chartHeight - padding.bottom + 18;
          const color = markerColor(point.decision, variant);
          return (
            <g key={`empty-${point.iteration}`}>
              <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} stroke={color} strokeWidth="2" />
              <line x1={x + 5} y1={y - 5} x2={x - 5} y2={y + 5} stroke={color} strokeWidth="2" />
            </g>
          );
        })}
        {plottedPoints.map(({ point, x, y }) => {
          const color = markerColor(point.decision, variant);
          return (
            <g key={`point-${point.iteration}`}>
              {point.isBestSoFar && !point.isBaseline && (
                <circle cx={x} cy={y} r="9" fill="none" stroke={theme.bestOutline} strokeWidth="2" />
              )}
              <circle cx={x} cy={y} r={point.isBaseline ? 6 : 5} fill={color} stroke={theme.pointBorder} strokeWidth="2" />
              <text x={x} y={chartHeight - padding.bottom + 28} textAnchor="middle" fill={theme.axisText} className="text-[11px]">
                {point.iteration}
              </text>
            </g>
          );
        })}
        <text x={(chartWidth + padding.left - padding.right) / 2} y={chartHeight - 6} textAnchor="middle" fill={theme.axisText} className="text-[11px]">
          {t('autoresearch.detail.iterationAxis')}
        </text>
      </svg>

      <div className={`mt-3 flex flex-wrap gap-2 text-[11px] ${theme.legendTextClassName}`}>
        {[
          [t('autoresearch.detail.baseline').toLowerCase(), '#0f766e'],
          [variant === 'dashboard' ? t('autoresearch.detail.keepBreakthrough') : 'keep', variant === 'dashboard' ? '#ffd75a' : '#16a34a'],
          [t('autoresearch.detail.discard'), '#d97706'],
          [t('autoresearch.detail.failedNoMetric'), '#dc2626'],
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
