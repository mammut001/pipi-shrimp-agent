/**
 * Browser surface viewport (embedded WebView).
 *
 * The viewport is a *display / manual-handoff* surface for the user, NOT the
 * agent runtime. When the agent is running we deliberately stop syncing the
 * native WebView bounds to avoid the move/resize storms that used to cause UI
 * jank. This module is the single source of truth for that lock.
 *
 * Feature flags:
 *   PIPI_BROWSER_LOCK_SURFACE_WHILE_RUNNING — disable continuous sync while
 *     the agent is running. Defaults to true.
 */

import { useLayoutEffect, useRef, useCallback } from 'react';
import { moveBrowserSurface } from '@/utils/browserCommands';
import { useBrowserAgentStore } from '@/store';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { isBrowserLockSurfaceWhileRunningEnabled } from '@/utils/browserFeatureFlags';

interface BrowserSurfaceViewportProps {
  mode: 'mini' | 'expanded';
  className?: string;
  emptyState?: React.ReactNode;
}

type SurfaceBounds = { x: number; y: number; width: number; height: number };

const SURFACE_SYNC_DEBOUNCE_MS = 120;
const SURFACE_SYNC_RETRY_MS = 200;
const MAX_SYNC_RETRIES = 12;

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

/**
 * The lock is engaged while the agent is running AND the feature flag is on.
 * Even when locked we still allow an initial "first sync" and explicit
 * manual refresh (mode switch), so the user can collapse/expand the surface
 * before kicking off a task.
 */
function shouldLockSurface(): boolean {
  if (!isBrowserLockSurfaceWhileRunningEnabled()) {
    return false;
  }
  const { status } = useBrowserAgentStore.getState();
  return status === 'running' || status === 'ready_for_agent' || status === 'inspecting';
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
  const retryCountRef = useRef(0);
  const initialSyncRef = useRef(true);
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

  const syncBounds = useCallback(async (force = false): Promise<boolean> => {
    const element = containerRef.current;
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      // Dimensions not ready yet — caller should retry.
      return false;
    }

    const bounds = normalizeBounds(rect);
    const lastBounds = lastBoundsRef.current;
    if (!force && lastBounds && boundsEqual(lastBounds, bounds)) {
      return true;
    }

    // Respect the surface lock. We still log so debugging surface sync issues
    // is straightforward.
    if (shouldLockSurface() && !force) {
      // eslint-disable-next-line no-console
      console.info('[BrowserSurface] sync skipped because agent running');
      return true;
    }

    lastBoundsRef.current = bounds;
    await moveBrowserSurface(mode, bounds).catch((error) => {
      // eslint-disable-next-line no-console
      console.info(`[BrowserSurface] move failed: ${error?.message ?? error}`);
    });
    if (force || !initialSyncRef.current) {
      // Already logged on the failure path; only log success when the bounds
      // actually changed.
      // eslint-disable-next-line no-console
      console.info(`[BrowserSurface] sync ${lastBounds ? 'updated' : 'init'} (${mode})`);
    }
    return true;
  }, [mode]);

  useLayoutEffect(() => {
    clearRetry();
    clearDebounce();

    if (!isActive) {
      lastBoundsRef.current = null;
      initialSyncRef.current = true;
      retryCountRef.current = 0;
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
          if (retryCountRef.current >= MAX_SYNC_RETRIES) {
            // eslint-disable-next-line no-console
            console.info('[BrowserSurface] sync giving up after retry cap');
            retryCountRef.current = 0;
            return;
          }
          retryCountRef.current += 1;
          clearRetry();
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            scheduleSync();
          }, SURFACE_SYNC_RETRY_MS);
        } else {
          retryCountRef.current = 0;
          if (initialSyncRef.current) {
            initialSyncRef.current = false;
          }
        }
      });
    };

    const scheduleSync = () => {
      clearDebounce();
      debounceRef.current = setTimeout(runSync, SURFACE_SYNC_DEBOUNCE_MS);
    };

    scheduleSync();

    const resizeObserver = new ResizeObserver(() => {
      // ResizeObserver fires very frequently during resize. The lock above
      // gates most of these while the agent is running, but we still want
      // the latest bounds to be applied once the user releases the resize.
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
      initialSyncRef.current = true;
      retryCountRef.current = 0;
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
