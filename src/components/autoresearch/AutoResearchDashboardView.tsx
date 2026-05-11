import type { ReactNode } from 'react';
import { t } from '@/i18n';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { isDemoRun } from '@/services/autoresearch/demoRun';
import { AutoResearchRunChips } from './AutoResearchRunChips';
import { AutoResearchDashboardHeader } from './AutoResearchDashboardHeader';
import { AutoResearchDashboardMetricCard } from './AutoResearchDashboardMetricCard';
import { AutoResearchDashboardTable } from './AutoResearchDashboardTable';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';

function formatEventPhaseLabel(phase: AutoResearchRunRecord['events'][number]['phase']): string {
  return phase === 'reflection_parse_failed'
    ? t('autoresearch.reflectionParseFailed')
    : phase.replace(/_/g, ' ');
}

interface AutoResearchDashboardViewProps {
  run: AutoResearchRunRecord;
  onBack?: () => void;
  onClose?: () => void;
  onOpen?: () => void;
  onOpenFullReport?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

export function AutoResearchDashboardView({
  run,
  onBack,
  onClose,
  onOpen,
  onOpenFullReport,
  headerActions,
  className = '',
}: AutoResearchDashboardViewProps) {
  const demo = isDemoRun(run);

  return (
    <main className={`min-h-full bg-[radial-gradient(circle_at_top,rgba(184,199,232,0.16),transparent_38%),linear-gradient(180deg,#121212_0%,#101010_100%)] px-3 py-5 text-[#f4f4f4] sm:px-5 sm:py-8 lg:px-8 lg:py-10 ${className}`}>
      <div className="mx-auto max-w-[1160px]">
        <AutoResearchDashboardHeader
          run={run}
          onBack={onBack}
          onClose={onClose}
          onOpen={onOpen}
          onOpenFullReport={onOpenFullReport}
          headerActions={headerActions}
        />

        <section className="mt-6 rounded-[24px] border border-white/10 bg-[#151515]/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-5">
          {demo && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65">
              {t('autoresearch.detail.demoNotice')}
            </div>
          )}

          <AutoResearchRunChips run={run} className={demo ? 'mt-4' : ''} />

          <div className="mt-7 space-y-5 rounded-[16px] border border-white/10 bg-[#111111]/45 p-3 sm:p-4">
            <AutoResearchDashboardMetricCard run={run} />
            <AutoResearchDashboardTable run={run} />

            {run.events.length > 0 && (
              <section className="rounded-[16px] border border-white/10 bg-white/[0.03] p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-white/88">Recent Events</h2>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    {run.events.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {run.events.slice(-6).reverse().map((event) => (
                    <div key={event.id} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/70">
                      <span className="font-semibold text-white/90">{formatEventPhaseLabel(event.phase)}</span>
                      <span className="mx-2 text-white/20">·</span>
                      <span>{redactSensitiveText(event.message)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default AutoResearchDashboardView;
