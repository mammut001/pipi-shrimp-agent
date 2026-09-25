/**
 * Experiment detail panel for viewing selected experiment iterations and events.
 * Moved verbatim out of src/pages/AutoResearch.tsx (AG-27); state and handlers stay in the page.
 */

import { t } from '@/i18n';
import { useAutoResearchStore, getSelectedAutoResearchRun } from '@/store/autoresearchStore';

export function ExperimentDetailPanel() {
  const selectedRun = useAutoResearchStore(getSelectedAutoResearchRun);
  const selectedIdx = useAutoResearchStore(s => s.selectedExperiment);
  const entry = selectedRun && selectedIdx >= 0 ? selectedRun.iterations[selectedIdx] : null;

  if (!entry) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        {t('autoresearch.selectExperimentForDetails')}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 text-sm overflow-y-auto h-full">
      <h3 className="text-lg font-semibold text-gray-800">
        {t('autoresearch.experiment')} #{entry.index}
      </h3>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.hypothesis')}</label>
        <p className="text-gray-800 mt-1">{entry.hypothesis || t('autoresearch.emptyValue')}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.change')}</label>
        <p className="text-gray-700 mt-1 font-mono text-xs whitespace-pre-wrap">{entry.change || t('autoresearch.emptyValue')}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.result')}</label>
        <p className="mt-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {entry.status}
          </span>
          <span className="ml-2 text-gray-700">
            {entry.metricValue !== null && entry.metricValue !== undefined ? entry.metricValue : t('autoresearch.notAvailable')}
          </span>
          {entry.error && (
            <span className="ml-2 text-red-500 text-xs">({entry.error})</span>
          )}
        </p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.reasoning')}</label>
        <p className="text-gray-600 mt-1 whitespace-pre-wrap">{entry.reasoning || t('autoresearch.emptyValue')}</p>
      </div>
      {entry.artifactPaths && entry.artifactPaths.length > 0 && (
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider">Artifacts</label>
          <div className="mt-1 space-y-1">
            {entry.artifactPaths.slice(0, 8).map((artifactPath) => (
              <p key={artifactPath} className="text-xs text-gray-500 break-all font-mono">{artifactPath}</p>
            ))}
          </div>
        </div>
      )}
      {selectedRun && selectedRun.events.length > 0 && (
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider">Recent events</label>
          <div className="mt-1 space-y-1">
            {selectedRun.events.slice(-5).reverse().map((event) => (
              <p key={event.id} className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{event.phase}</span>
                <span className="text-gray-300"> · </span>
                {event.message}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="text-xs text-gray-400">
        {[entry.startedAt, entry.endedAt].filter(Boolean).join(' -> ')}
      </div>
    </div>
  );
}
