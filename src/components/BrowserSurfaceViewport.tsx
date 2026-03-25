import { useLayoutEffect, useRef } from 'react';
import { moveBrowserSurface, setEmbeddedSurfaceVisibility } from '@/utils/browserCommands';
import { useBrowserAgentStore } from '@/store';

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
  const { isWindowOpen } = useBrowserAgentStore();

  useLayoutEffect(() => {
    if (!isWindowOpen) {
      void setEmbeddedSurfaceVisibility(false).catch(() => {});
      return;
    }

    let rafId = 0;

    const syncBounds = async () => {
      const element = containerRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        await setEmbeddedSurfaceVisibility(false).catch(() => {});
        return;
      }

      await moveBrowserSurface(mode, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch(() => {});
    };

    const scheduleSync = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        void syncBounds();
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
    window.addEventListener('scroll', scheduleSync, true);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('scroll', scheduleSync, true);
      void setEmbeddedSurfaceVisibility(false).catch(() => {});
    };
  }, [isWindowOpen, mode]);

  return (
    <div ref={containerRef} className={className}>
      {!isWindowOpen && emptyState}
    </div>
  );
}

export default BrowserSurfaceViewport;
