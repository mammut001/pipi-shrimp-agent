import type { ReactNode } from 'react';
import { t } from '@/i18n';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { isDemoRun } from '@/services/autoresearch/demoRun';
import { AutoResearchRunChips } from './AutoResearchRunChips';
import { AutoResearchDashboardHeader } from './AutoResearchDashboardHeader';
import { AutoResearchDashboardMetricCard } from './AutoResearchDashboardMetricCard';
import { AutoResearchDashboardTable } from './AutoResearchDashboardTable';

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
          </div>
        </section>
      </div>
    </main>
  );
}

export default AutoResearchDashboardView;
