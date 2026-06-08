import { useLayoutEffect, useRef, useCallback } from 'react';
import { moveBrowserSurface, setEmbeddedSurfaceVisibility } from '@/utils/browserCommands';
import { useBrowserAgentStore } from '@/store';
import { useAutoResearchStore } from '@/store/autoresearchStore';

interface BrowserSurfaceViewportProps {
  mode: 'mini' | 'expanded';
  className?: string;
  emptyState?: React.ReactNode;
}

export function BrowserSurfaceViewport({
  mode,
  className,
  emptyState,
}: BrowserSurfaceViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const { isWindowOpen, presentationMode } = useBrowserAgentStore();
  const autoResearchSetupVisible = useAutoResearchStore((state) => state.showSetupModal);

  // This viewport is "active" only when isWindowOpen AND our mode matches presentationMode
  const isActive = isWindowOpen && presentationMode === mode && !autoResearchSetupVisible;

  const clearRetry = useCallback(() => {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  const syncBounds = useCallback(async (): Promise<boolean> => {
    const element = containerRef.current;
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      // Dimensions not ready yet — caller should retry
      return false;
    }

    const bounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const lastBounds = lastBoundsRef.current;
    if (
      lastBounds
      && lastBounds.x === bounds.x
      && lastBounds.y === bounds.y
      && lastBounds.width === bounds.width
      && lastBounds.height === bounds.height
    ) {
      return true;
    }

    lastBoundsRef.current = bounds;
    await moveBrowserSurface(mode, bounds).catch(() => {});

    return true;
  }, [mode]);

  useLayoutEffect(() => {
    clearRetry();

    if (!isActive) {
      lastBoundsRef.current = null;
      // This mode is not the active one — hide the native surface
      void setEmbeddedSurfaceVisibility(false).catch(() => {});
      return;
    }

    let rafId = 0;

    // Schedule sync after RAF (layout settled)
    const scheduleSync = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(async () => {
        const ok = await syncBounds();
        if (!ok) {
          // Div has no size yet — retry after a short delay
          clearRetry();
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            scheduleSync();
          }, 50);
        }
      });
    };

    scheduleSync();

    const resizeObserver = new ResizeObserver(() => {
      scheduleSync();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', scheduleSync);

    return () => {
      clearRetry();
      cancelAnimationFrame(rafId);
      lastBoundsRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleSync);
      // Hide on unmount / mode-switch
      void setEmbeddedSurfaceVisibility(false).catch(() => {});
    };
  // Re-run whenever the active state changes (isWindowOpen OR presentationMode changed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  return (
    <div ref={containerRef} className={className}>
      {!isWindowOpen && emptyState}
    </div>
  );
}

export default BrowserSurfaceViewport;
