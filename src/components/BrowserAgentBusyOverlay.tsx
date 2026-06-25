import { t } from '@/i18n';

interface BrowserAgentBusyOverlayProps {
  className?: string;
  stripeSize?: 'sm' | 'md';
}

/**
 * Blocks human interaction on the embedded browser viewport while the agent
 * is driving browser tools. Uses pointer-events on the overlay itself so
 * clicks never reach the synced Chrome surface underneath.
 */
export function BrowserAgentBusyOverlay({
  className = '',
  stripeSize = 'md',
}: BrowserAgentBusyOverlayProps) {
  const stripeClass = stripeSize === 'sm'
    ? 'bg-[length:24px_24px] opacity-30'
    : 'bg-[length:36px_36px] opacity-20';

  return (
    <div
      className={`absolute inset-0 z-50 pointer-events-auto cursor-not-allowed flex flex-col items-center justify-center bg-black/35 select-none overflow-hidden ${className}`}
      role="status"
      aria-live="polite"
      aria-label={t('browser.doNotOperate')}
      onWheel={(event) => event.preventDefault()}
      onTouchMove={(event) => event.preventDefault()}
    >
      <div
        className={`absolute inset-0 pointer-events-none bg-[linear-gradient(45deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] animate-stripes ${stripeClass}`}
      />
      <div className="z-10 flex flex-col items-center gap-1 pointer-events-none px-4 text-center">
        <div className="flex items-center gap-2 bg-slate-900/90 text-white text-xs font-medium px-4 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-slate-700">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping" />
          <span>{t('browserMiniPreview.agentRunning')}</span>
        </div>
        <p className="text-[11px] font-medium text-white/90 drop-shadow-sm">
          {t('browser.doNotOperate')}
        </p>
      </div>
    </div>
  );
}

export default BrowserAgentBusyOverlay;