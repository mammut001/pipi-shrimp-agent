import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { AutoResearchDashboardView } from './AutoResearchDashboardView';
import { AutoResearchDocumentReport } from './AutoResearchDocumentReport';

type DetailMode = 'dashboard' | 'document';

interface AutoResearchRunDetailDocumentProps {
  run?: AutoResearchRunRecord | null;
  liveOutput?: string;
  onBack?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

function shouldUseDemoFallback(run?: AutoResearchRunRecord | null): boolean {
  return !run;
}

export function AutoResearchRunDetailDocument({
  run,
  liveOutput,
  onBack,
  onOpen,
  onClose,
  headerActions,
  className = '',
}: AutoResearchRunDetailDocumentProps) {
  const usesDemoFallback = shouldUseDemoFallback(run);
  const effectiveRun = useMemo<AutoResearchRunRecord>(
    () => (usesDemoFallback ? createAutoResearchDemoRun() : run as AutoResearchRunRecord),
    [run, usesDemoFallback],
  );
  const [mode, setMode] = useState<DetailMode>('dashboard');

  useEffect(() => {
    setMode('dashboard');
  }, [effectiveRun.id]);

  if (mode === 'dashboard') {
    return (
      <AutoResearchDashboardView
        run={effectiveRun}
        liveOutput={usesDemoFallback ? effectiveRun.liveOutputExcerpt : liveOutput}
        onBack={onBack}
        onClose={onClose}
        onOpen={usesDemoFallback ? undefined : onOpen}
        onOpenFullReport={() => setMode('document')}
        headerActions={headerActions}
        className={className}
      />
    );
  }

  return (
    <AutoResearchDocumentReport
      run={effectiveRun}
      liveOutput={usesDemoFallback ? effectiveRun.liveOutputExcerpt : liveOutput}
      onBack={() => setMode('dashboard')}
      onOpen={usesDemoFallback ? undefined : onOpen}
      onClose={onClose}
      headerActions={headerActions}
      className={className}
    />
  );
}

export default AutoResearchRunDetailDocument;
