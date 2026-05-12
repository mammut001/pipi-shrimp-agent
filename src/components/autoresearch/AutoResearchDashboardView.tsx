import type { ReactNode } from 'react';
import { t } from '@/i18n';
import {
  buildAutoResearchLiveOutputFilename,
  formatAutoResearchEventDump,
  formatAutoResearchEventLine,
  getAutoResearchEventMetadataBadges,
} from '@/services/autoresearch/eventPresentation';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { isDemoRun } from '@/services/autoresearch/demoRun';
import { AutoResearchRunChips } from './AutoResearchRunChips';
import { AutoResearchDashboardHeader } from './AutoResearchDashboardHeader';
import { AutoResearchDashboardMetricCard } from './AutoResearchDashboardMetricCard';
import { AutoResearchDashboardTable } from './AutoResearchDashboardTable';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import { downloadTextFile, writeClipboardText } from '@/utils/clipboard';

function formatEventPhaseLabel(phase: AutoResearchRunRecord['events'][number]['phase']): string {
  return phase === 'reflection_parse_failed'
    ? t('autoresearch.reflectionParseFailed')
    : phase.replace(/_/g, ' ');
}

interface AutoResearchDashboardViewProps {
  run: AutoResearchRunRecord;
  liveOutput?: string;
  onBack?: () => void;
  onClose?: () => void;
  onOpen?: () => void;
  onOpenFullReport?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

export function AutoResearchDashboardView({
  run,
  liveOutput,
  onBack,
  onClose,
  onOpen,
  onOpenFullReport,
  headerActions,
  className = '',
}: AutoResearchDashboardViewProps) {
  const demo = isDemoRun(run);
  const displayedLiveOutput = liveOutput || run.liveOutputExcerpt || '';
  const recentEvents = run.events.slice(-6).reverse();
  const allEventLines = formatAutoResearchEventDump(run.events);

  const handleCopy = (text: string) => {
    void writeClipboardText(text).catch(() => undefined);
  };

  const handleDownload = () => {
    if (!displayedLiveOutput) {
      return;
    }
    downloadTextFile(buildAutoResearchLiveOutputFilename(run), displayedLiveOutput);
  };

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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(allEventLines)}
                      data-copy-target="recent-events-all"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/68 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      {t('autoresearch.recentEvents.copyAll')}
                    </button>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                      {run.events.length}
                    </span>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {recentEvents.map((event) => {
                    const metadataBadges = getAutoResearchEventMetadataBadges(event);
                    return (
                    <div key={event.id} className="group rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/70">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="font-semibold text-white/90">{formatEventPhaseLabel(event.phase)}</span>
                          <span className="mx-2 text-white/20">·</span>
                          <span>{redactSensitiveText(event.message)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(formatAutoResearchEventLine(event))}
                          data-copy-target="recent-event-line"
                          className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-white/58 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-white group-hover:opacity-100"
                          aria-label={t('autoresearch.recentEvents.copyOne')}
                          title={t('autoresearch.recentEvents.copyOne')}
                        >
                          {t('autoresearch.recentEvents.copyOne')}
                        </button>
                      </div>
                      {metadataBadges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {metadataBadges.map((badge) => (
                            <span key={`${event.id}-${badge}`} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/55">
                              {badge}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );})}
                </div>
              </section>
            )}

            {displayedLiveOutput && (
              <section className="rounded-[16px] border border-white/10 bg-[#0f1720] p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-white/88">Live Output</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(displayedLiveOutput)}
                      data-copy-target="live-output-copy"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/68 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      {t('autoresearch.liveOutput.copy')}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownload}
                      data-copy-target="live-output-download"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/68 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      {t('autoresearch.liveOutput.download')}
                    </button>
                  </div>
                </div>
                <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border border-white/8 bg-black/35 p-4 text-xs leading-5 text-green-300 whitespace-pre-wrap">
                  {redactSensitiveText(displayedLiveOutput)}
                </pre>
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default AutoResearchDashboardView;
