/**
 * Run control buttons for AutoResearch (pause, resume, stop, acknowledge).
 * Moved verbatim out of src/pages/AutoResearch.tsx (AG-27); state and handlers stay in the page.
 */

import { t } from '@/i18n';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import type { AutoResearchSelectedRunContext, LoopState } from '@/store/autoresearchStore';

export interface AutoResearchRunControlsProps {
  selectedRunContext: AutoResearchSelectedRunContext;
  loopState: LoopState;
  isPersistedPausedRun: boolean;
  displayRun: AutoResearchSelectedRunContext['run'];
  handlePause: () => void;
  handleResume: () => void;
  handleStop: () => void;
}

export function AutoResearchRunControls({
  selectedRunContext,
  loopState,
  isPersistedPausedRun,
  displayRun,
  handlePause,
  handleResume,
  handleStop,
}: AutoResearchRunControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {selectedRunContext.isActive && loopState === 'running' && (
        <>
          <button onClick={handlePause} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700 hover:bg-amber-100">
            {t('autoresearch.pause')}
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            {t('autoresearch.stop')}
          </button>
        </>
      )}
      {(loopState === 'paused' || isPersistedPausedRun) && (
        <>
          <button onClick={handleResume} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-[12px] font-medium text-green-700 hover:bg-green-100">
            {t('autoresearch.resume')}
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            {t('autoresearch.stop')}
          </button>
        </>
      )}
      {selectedRunContext.isActive && loopState === 'error' && displayRun?.status === 'reflection_failed' && (
        <>
          <button
            onClick={() => useAutoResearchStore.getState().acknowledgeReflectionFailure()}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] font-medium text-indigo-700 hover:bg-indigo-100"
          >
            {t('autoresearch.acknowledge')}
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            {t('autoresearch.stop')}
          </button>
        </>
      )}
    </div>
  );
}
