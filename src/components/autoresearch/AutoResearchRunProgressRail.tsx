import { t } from '@/i18n';
import type { AutoResearchRunPhase } from '@/services/autoresearch/history';
import type { LoopState } from '@/store/autoresearchStore';

export type MainRunPhase =
  | 'PREFLIGHT'
  | 'RUN_EXPERIMENT'
  | 'PARSE_METRICS'
  | 'DECIDE_NEXT'
  | 'DONE'
  | 'FAILED';

export function normalizeToMainRunPhase(phase?: string | null): MainRunPhase {
  switch (phase) {
    case 'INIT':
    case 'READ_CONTEXT':
    case 'PLAN_HYPOTHESIS':
    case 'PREFLIGHT':
      return 'PREFLIGHT';
    case 'EDIT_CODE':
    case 'RUN_EXPERIMENT':
      return 'RUN_EXPERIMENT';
    case 'PARSE_METRICS':
      return 'PARSE_METRICS';
    case 'REFLECT':
    case 'DECIDE_NEXT':
      return 'DECIDE_NEXT';
    case 'FAILED':
      return 'FAILED';
    case 'DONE':
      return 'DONE';
    default:
      return 'PREFLIGHT';
  }
}

export function formatRunPhaseLabel(phase?: string | null): string {
  const mainPhase = normalizeToMainRunPhase(phase);
  switch (mainPhase) {
    case 'PREFLIGHT':
      return t('autoresearch.phase.preflight');
    case 'RUN_EXPERIMENT':
      return t('autoresearch.phase.run_experiment');
    case 'PARSE_METRICS':
      return t('autoresearch.phase.parse_metrics');
    case 'DECIDE_NEXT':
      return t('autoresearch.phase.decide_next');
    case 'DONE':
      return t('autoresearch.phase.done');
    case 'FAILED':
      return t('autoresearch.phase.failed');
    default:
      return phase || 'Preflight';
  }
}

interface AutoResearchRunProgressRailProps {
  currentIteration?: number;
  maxIterations?: number;
  phase?: AutoResearchRunPhase | string | null;
  loopState?: LoopState | null;
  className?: string;
}

export function AutoResearchRunProgressRail({
  currentIteration = 1,
  maxIterations = 1,
  phase = 'PREFLIGHT',
  loopState = 'running',
  className = '',
}: AutoResearchRunProgressRailProps) {
  const mainPhase = normalizeToMainRunPhase(phase);

  const steps: Array<{ id: MainRunPhase; title: string }> = [
    { id: 'PREFLIGHT', title: t('autoresearch.phase.preflight') },
    { id: 'RUN_EXPERIMENT', title: t('autoresearch.phase.run_experiment') },
    { id: 'PARSE_METRICS', title: t('autoresearch.phase.parse_metrics') },
    { id: 'DECIDE_NEXT', title: t('autoresearch.phase.decide_next') },
    { id: mainPhase === 'FAILED' ? 'FAILED' : 'DONE', title: mainPhase === 'FAILED' ? t('autoresearch.phase.failed') : t('autoresearch.phase.done') },
  ];

  const phaseOrder: Record<MainRunPhase, number> = {
    PREFLIGHT: 0,
    RUN_EXPERIMENT: 1,
    PARSE_METRICS: 2,
    DECIDE_NEXT: 3,
    DONE: 4,
    FAILED: 4,
  };

  const currentIndex = phaseOrder[mainPhase] ?? 0;

  return (
    <aside
      data-testid="autoresearch-run-progress-rail"
      className={`rounded-[24px] border border-gray-200 bg-white p-5 ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
            {t('autoresearch.runProgress')}
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {t('autoresearch.iterationProgress', { current: currentIteration || 1, total: maxIterations || 1 })}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            loopState === 'paused'
              ? 'border border-amber-200 bg-amber-50 text-amber-700'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              loopState === 'paused' ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'
            }`}
          />
          {loopState === 'paused' ? t('autoresearch.loopStatePaused') : t('autoresearch.loopStateRunning')}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const status = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
          const isFailed = step.id === 'FAILED' && index === currentIndex;

          return (
            <div key={step.id} className="flex items-center gap-3">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  isFailed
                    ? 'bg-rose-600 text-white'
                    : status === 'done'
                      ? 'bg-[#0f766e] text-white'
                      : status === 'current'
                        ? 'bg-gray-900 text-white ring-2 ring-emerald-500/40'
                        : 'bg-gray-200 text-gray-500'
                }`}
              >
                {status === 'done' ? '✓' : index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    isFailed
                      ? 'text-rose-600 font-semibold'
                      : status === 'current'
                        ? 'font-semibold text-gray-900'
                        : status === 'done'
                          ? 'text-gray-700'
                          : 'text-gray-400'
                  }`}
                >
                  {step.title}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export interface AutoResearchRunPhaseChipProps {
  currentIteration?: number;
  maxIterations?: number;
  phase?: string | null;
  loopState?: string | null;
  className?: string;
}

export function AutoResearchRunPhaseChip({
  currentIteration = 1,
  maxIterations = 1,
  phase = 'PREFLIGHT',
  loopState = 'running',
  className = '',
}: AutoResearchRunPhaseChipProps) {
  const mainPhase = normalizeToMainRunPhase(phase);
  const phaseLabel = formatRunPhaseLabel(phase);
  const isPaused = loopState === 'paused';
  const isFailed = mainPhase === 'FAILED';

  return (
    <span
      data-testid="autoresearch-run-phase-chip"
      data-phase={mainPhase}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        isFailed
          ? 'border-rose-300 bg-rose-50 text-rose-700'
          : isPaused
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      } ${className}`.trim()}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isFailed
            ? 'bg-rose-500'
            : isPaused
              ? 'bg-amber-500'
              : 'bg-emerald-400 animate-pulse'
        }`}
      />
      <span>
        {t('autoresearch.iterationProgress', { current: currentIteration || 1, total: maxIterations || 1 })} • {phaseLabel}
      </span>
    </span>
  );
}

export default AutoResearchRunProgressRail;
