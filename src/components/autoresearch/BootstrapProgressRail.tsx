import { t } from '@/i18n';
import type { BootstrapStep } from '@/services/autoresearch/bootstrap/types';

const STEP_LABELS: Array<{ id: BootstrapStep; title: string; description: string }> = [
  { id: 'goal', title: t('autoresearch.bootstrap.step.goal.title'), description: t('autoresearch.bootstrap.step.goal.description') },
  { id: 'papers', title: t('autoresearch.bootstrap.step.papers.title'), description: t('autoresearch.bootstrap.step.papers.description') },
  { id: 'baselines', title: t('autoresearch.bootstrap.step.baselines.title'), description: t('autoresearch.bootstrap.step.baselines.description') },
  { id: 'metrics', title: t('autoresearch.bootstrap.step.metrics.title'), description: t('autoresearch.bootstrap.step.metrics.description') },
  { id: 'scaffold', title: t('autoresearch.bootstrap.step.scaffold.title'), description: t('autoresearch.bootstrap.step.scaffold.description') },
  { id: 'ready', title: t('autoresearch.bootstrap.step.ready.title'), description: t('autoresearch.bootstrap.step.ready.description') },
];

interface BootstrapProgressRailProps {
  currentStep: BootstrapStep;
  failedStep?: BootstrapStep | null;
  failureReason?: string | null;
  warnings?: string[];
  onRetry?: () => void;
}

export function BootstrapProgressRail({
  currentStep,
  failedStep = null,
  failureReason = null,
  warnings = [],
  onRetry,
}: BootstrapProgressRailProps) {
  const currentIndex = STEP_LABELS.findIndex((step) => step.id === currentStep);

  return (
    <aside className="rounded-[24px] border border-gray-200 bg-white p-5 min-w-0 max-w-full">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">{t('autoresearch.bootstrap.progressTitle')}</p>
      <div className="mt-4 space-y-3">
        {STEP_LABELS.map((step, index) => {
          const isFailed = failedStep === step.id;
          const status = isFailed
            ? 'failed'
            : index < currentIndex
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'todo';

          return (
            <div key={step.id} className="space-y-1.5 min-w-0">
              <div className="flex gap-3 min-w-0">
                <div className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  status === 'failed'
                    ? 'bg-rose-600 text-white'
                    : status === 'done'
                      ? 'bg-[#0f766e] text-white'
                      : status === 'current'
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-200 text-gray-500'
                }`}>
                  {status === 'failed' ? '!' : index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold truncate ${
                    status === 'failed'
                      ? 'text-rose-700'
                      : status === 'todo'
                        ? 'text-gray-500'
                        : 'text-gray-900'
                  }`}>{step.title}</p>
                  <p className="text-xs text-gray-600 break-words">{step.description}</p>
                </div>
              </div>
              {isFailed && failureReason && (
                <div className="ml-9 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 break-words">
                  <p className="font-medium">{failureReason}</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-2 inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 transition-colors"
                    >
                      {t('common.retry') || '重试'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {warnings.length > 0 && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800 break-words">
          {warnings.join(' ')}
        </div>
      )}
    </aside>
  );
}

export default BootstrapProgressRail;
