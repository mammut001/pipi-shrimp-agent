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
import { buildAutoResearchModelDisplayFromSnapshot } from '@/services/autoresearch/modelDisplay';
import { AutoResearchRunChips } from './AutoResearchRunChips';
import { AutoResearchDashboardMetricCard } from './AutoResearchDashboardMetricCard';
import { AutoResearchDashboardTable } from './AutoResearchDashboardTable';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import {
  DocumentContentCard,
  DocumentDetailShell,
  DocumentMetadataSidebar,
  type DocumentMetadataSection,
} from '@/components/document';
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

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function formatDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortenRunId(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function getRunTitle(run: AutoResearchRunRecord): string {
  const candidateRecord = run as AutoResearchRunRecord & {
    task?: unknown;
    config?: AutoResearchRunRecord['config'] & { title?: unknown };
  };

  return safeString(run.title)
    ?? safeString(candidateRecord.task)
    ?? safeString(candidateRecord.config?.title)
    ?? 'Auto Research Run';
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8f8375]">{children}</h4>;
}

function KeyValueList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="space-y-2 text-[12px] leading-5">
      {items.map(([label, value]) => (
        <div key={label}>
          <p className="font-bold uppercase tracking-[0.14em] text-[#998c7e]">{label}</p>
          <div className="mt-0.5 break-words text-[#4f463d]">{value ?? 'N/A'}</div>
        </div>
      ))}
    </div>
  );
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
  const statusLabel = run.status === 'reflection_failed'
    ? t('autoresearch.statusReflectionFailed')
    : run.status.replace(/_/g, ' ');
  const modelDisplay = buildAutoResearchModelDisplayFromSnapshot(run.config.configSnapshot);
  const reflectionReason = run.status === 'reflection_failed'
    ? safeString(run.reason) ?? safeString(run.summary)
    : null;
  const subtitle = [
    shortenRunId(run.id),
    statusLabel,
    formatDate(run.createdAt),
    safeString(run.config.metric),
    run.config.direction === 'lower' ? t('autoresearch.lowerIsBetter') : t('autoresearch.higherIsBetter'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ');
  const sidebarSections: DocumentMetadataSection[] = [
    {
      label: 'Run',
      content: (
        <KeyValueList items={[
          ['Status', statusLabel],
          ['Run ID', run.id],
          ['Iterations', `${run.currentIteration}/${run.config.iterations}`],
          ['Metric', run.config.metric || 'N/A'],
          ['Direction', run.config.direction === 'lower' ? t('autoresearch.lowerIsBetter') : t('autoresearch.higherIsBetter')],
        ]} />
      ),
    },
    {
      label: 'Config',
      content: (
        <KeyValueList items={[
          ['Name', run.config.configSnapshot.configName || 'N/A'],
          ['Provider', modelDisplay.providerLabel],
          ['Model', modelDisplay.modelLabel],
          ['Workdir', run.config.workdir],
          ['Experiment Dir', run.config.experimentDir],
        ]} />
      ),
    },
  ];

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
    <DocumentDetailShell
      title={getRunTitle(run)}
      subtitle={subtitle}
      badge={demo ? t('autoresearch.detail.demo') : t('autoresearch.detail.autoResearch')}
      filename={run.id}
      backLabel={t('autoresearch.detail.backToRuns')}
      onBack={onBack}
      onOpen={onOpen}
      openLabel={t('autoresearch.detail.open')}
      onClose={onClose}
      headerActions={(
        <>
          {headerActions}
          {onOpenFullReport && (
            <button
              type="button"
              onClick={onOpenFullReport}
              className="rounded-xl border border-[#e7ded1] bg-white/90 px-3 py-2 text-[12px] font-medium text-[#6f665c] transition-colors hover:border-[#d8cfc1] hover:text-[#2f251a]"
            >
              {t('autoresearch.detail.fullReport')}
            </button>
          )}
        </>
      )}
      className={className}
      sidebar={(
        <DocumentMetadataSidebar
          createdAt={run.createdAt}
          updatedAt={run.updatedAt}
          path={run.config.experimentDir}
          tags={[
            statusLabel,
            run.config.metric || 'metric',
            modelDisplay.providerLabel,
            modelDisplay.modelLabel,
          ]}
          sections={sidebarSections}
        />
      )}
    >
      <DocumentContentCard>
        <div className="space-y-6">
          {demo && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-900">
              {t('autoresearch.detail.demoNotice')}
            </div>
          )}

          {reflectionReason && (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-500">
                {t('autoresearch.reflectionReason')}
              </p>
              <p className="mt-1">{redactSensitiveText(reflectionReason)}</p>
            </div>
          )}

          <div>
            <SectionHeading>Run Snapshot</SectionHeading>
            <AutoResearchRunChips run={run} className="mt-3" />
          </div>

          {run.summary && !reflectionReason && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-900">
              {redactSensitiveText(run.summary)}
            </div>
          )}

          <AutoResearchDashboardMetricCard run={run} />
          <AutoResearchDashboardTable run={run} />

          {run.events.length > 0 && (
            <section className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SectionHeading>Recent Events</SectionHeading>
                  <p className="mt-1 text-sm text-[#655a4f]">Recent execution notes, copied in the same report format used elsewhere.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(allEventLines)}
                    data-copy-target="recent-events-all"
                    className="rounded-full border border-[#e3d8cb] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b5f52] transition-colors hover:border-[#d4c7b8] hover:text-[#2f251a]"
                  >
                    {t('autoresearch.recentEvents.copyAll')}
                  </button>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[#998c7e]">
                    {run.events.length}
                  </span>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {recentEvents.map((event) => {
                  const metadataBadges = getAutoResearchEventMetadataBadges(event);
                  return (
                    <div key={event.id} className="group rounded-2xl border border-[#ebe4d9] bg-white px-3 py-3 text-sm text-[#5c5247] shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="font-semibold text-[#2f251a]">{formatEventPhaseLabel(event.phase)}</span>
                          <span className="mx-2 text-[#d3c8bb]">·</span>
                          <span>{redactSensitiveText(event.message)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(formatAutoResearchEventLine(event))}
                          data-copy-target="recent-event-line"
                          className="rounded-full border border-[#e3d8cb] bg-[#fbfaf7] px-2 py-0.5 text-[10px] font-medium text-[#7c7064] opacity-0 transition-opacity hover:bg-white hover:text-[#2f251a] group-hover:opacity-100"
                          aria-label={t('autoresearch.recentEvents.copyOne')}
                          title={t('autoresearch.recentEvents.copyOne')}
                        >
                          {t('autoresearch.recentEvents.copyOne')}
                        </button>
                      </div>
                      {metadataBadges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {metadataBadges.map((badge) => (
                            <span key={`${event.id}-${badge}`} className="rounded-full bg-[#f1eadf] px-2 py-0.5 text-[10px] text-[#7c7064]">
                              {badge}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {displayedLiveOutput && (
            <section className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SectionHeading>Live Output</SectionHeading>
                  <p className="mt-1 text-sm text-[#655a4f]">Streaming terminal context rendered on the same paper surface as the report.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(displayedLiveOutput)}
                    data-copy-target="live-output-copy"
                    className="rounded-full border border-[#e3d8cb] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b5f52] transition-colors hover:border-[#d4c7b8] hover:text-[#2f251a]"
                  >
                    {t('autoresearch.liveOutput.copy')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    data-copy-target="live-output-download"
                    className="rounded-full border border-[#e3d8cb] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b5f52] transition-colors hover:border-[#d4c7b8] hover:text-[#2f251a]"
                  >
                    {t('autoresearch.liveOutput.download')}
                  </button>
                </div>
              </div>
              <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border border-[#ebe4d9] bg-white p-4 text-xs leading-5 text-[#2f251a] whitespace-pre-wrap shadow-[inset_0_0_0_1px_rgba(241,237,230,0.9)]">
                {redactSensitiveText(displayedLiveOutput)}
              </pre>
            </section>
          )}
        </div>
      </DocumentContentCard>
    </DocumentDetailShell>
  );
}

export default AutoResearchDashboardView;
