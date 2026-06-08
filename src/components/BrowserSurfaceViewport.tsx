import { useLayoutEffect, useRef, useCallback } from 'react';
import { moveBrowserSurface } from '@/utils/browserCommands';
import { useBrowserAgentStore } from '@/store';
import { useAutoResearchStore } from '@/store/autoresearchStore';

interface BrowserSurfaceViewportProps {
  mode: 'mini' | 'expanded';
  className?: string;
  emptyState?: React.ReactNode;
}

type SurfaceBounds = { x: number; y: number; width: number; height: number };

function normalizeBounds(rect: DOMRect): SurfaceBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function boundsEqual(a: SurfaceBounds, b: SurfaceBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function BrowserSurfaceViewport({
  mode,
  className,
  emptyState,
}: BrowserSurfaceViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsRef = useRef<SurfaceBounds | null>(null);
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

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
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

    const bounds = normalizeBounds(rect);
    const lastBounds = lastBoundsRef.current;
    if (lastBounds && boundsEqual(lastBounds, bounds)) {
      return true;
    }

    lastBoundsRef.current = bounds;
    await moveBrowserSurface(mode, bounds).catch(() => {});

    return true;
  }, [mode]);

  useLayoutEffect(() => {
    clearRetry();
    clearDebounce();

    if (!isActive) {
      lastBoundsRef.current = null;
      return;
    }

    let rafId = 0;
    let disposed = false;

    const runSync = () => {
      if (disposed) {
        return;
      }

      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(async () => {
        const ok = await syncBounds();
        if (!ok && !disposed) {
          clearRetry();
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            scheduleSync();
          }, 50);
        }
      });
    };

    const scheduleSync = () => {
      clearDebounce();
      debounceRef.current = setTimeout(runSync, 32);
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
      disposed = true;
      clearRetry();
      clearDebounce();
      cancelAnimationFrame(rafId);
      lastBoundsRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleSync);
    };
  // Re-run whenever the active state changes (isWindowOpen OR presentationMode changed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, clearDebounce, clearRetry, mode, syncBounds]);

  return (
    <div ref={containerRef} className={className}>
      {!isWindowOpen && emptyState}
    </div>
  );
}

export default BrowserSurfaceViewport;
