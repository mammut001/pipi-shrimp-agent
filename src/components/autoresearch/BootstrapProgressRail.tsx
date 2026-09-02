import { t } from '@/i18n';
import type { BootstrapStep } from '@/services/autoresearch/bootstrap/types';

interface BootstrapProgressRailProps {
  currentStep: BootstrapStep;
  warnings?: string[];
}

export function BootstrapProgressRail({ currentStep, warnings = [] }: BootstrapProgressRailProps) {
  const stepLabels: Array<{ id: BootstrapStep; title: string; description: string }> = [
    { id: 'goal', title: t('autoresearch.bootstrap.step.goal.title'), description: t('autoresearch.bootstrap.step.goal.description') },
    { id: 'papers', title: t('autoresearch.bootstrap.step.papers.title'), description: t('autoresearch.bootstrap.step.papers.description') },
    { id: 'baselines', title: t('autoresearch.bootstrap.step.baselines.title'), description: t('autoresearch.bootstrap.step.baselines.description') },
    { id: 'metrics', title: t('autoresearch.bootstrap.step.metrics.title'), description: t('autoresearch.bootstrap.step.metrics.description') },
    { id: 'scaffold', title: t('autoresearch.bootstrap.step.scaffold.title'), description: t('autoresearch.bootstrap.step.scaffold.description') },
    { id: 'ready', title: t('autoresearch.bootstrap.step.ready.title'), description: t('autoresearch.bootstrap.step.ready.description') },
  ];

  const foundIndex = stepLabels.findIndex((step) => step.id === currentStep);
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;

  return (
    <aside className="rounded-[24px] border border-gray-200 bg-white p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">{t('autoresearch.bootstrap.progressTitle')}</p>
      <div className="mt-4 space-y-3">
        {stepLabels.map((step, index) => {
          const status = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
          return (
            <div key={step.id} className="flex gap-3">
              <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                status === 'done'
                  ? 'bg-[#0f766e] text-white'
                  : status === 'current'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-200 text-gray-500'
              }`}>
                {index + 1}
              </div>
              <div>
                <p className={`text-sm font-semibold ${status === 'todo' ? 'text-gray-500' : 'text-gray-900'}`}>{step.title}</p>
                <p className="text-xs text-gray-600">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
      {warnings.length > 0 && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          {warnings.join(' ')}
        </div>
      )}
    </aside>
  );
}

export default BootstrapProgressRail;
