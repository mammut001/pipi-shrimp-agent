/**
 * Draggable floating wrapper for SwarmPanel — free positioning with
 * localStorage persistence (safe-storage helpers).
 *
 * Extracted from ChatBrowserWorkspaceShell (AG-15).
 */

import { useEffect, useRef, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { SwarmPanel } from './SwarmPanel';
import { safeGetJSON, safeSetJSON } from '@/utils/safeStorage';

const SWARM_PANEL_POS_KEY = 'swarm-panel-position';

export function SwarmPanelDraggable() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ offsetX: number; offsetY: number } | null>(null);

  // Restore saved position on mount
  useEffect(() => {
    const panel = containerRef.current;
    if (!panel) return;
    // AUDIT-FIX [fix-22#1] — Use the safe-storage helper for the read
    // path; quota / SecurityError fall through to the default bottom-right
    // position which the panel already starts with.
    const saved = safeGetJSON<{ x: number; y: number }>(SWARM_PANEL_POS_KEY);
    if (saved.value) {
      const { x, y } = saved.value;
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      panel.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      panel.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
  }, []);

  const handleMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    // Only drag from the header drag-handle area (data-drag-handle attribute)
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
    e.preventDefault();

    const panel = containerRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    dragState.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current || !panel) return;
      let x = ev.clientX - dragState.current.offsetX;
      let y = ev.clientY - dragState.current.offsetY;
      // Clamp within viewport
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    const onMouseUp = () => {
      dragState.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Persist final position via the safe-storage helper so quota
      // errors don't crash the listener teardown path.
      if (panel) {
        const rect = panel.getBoundingClientRect();
        safeSetJSON(SWARM_PANEL_POS_KEY, { x: rect.left, y: rect.top });
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // AUDIT-FIX [fix-19#1] — Last-line-of-defence cleanup. If the component
  // unmounts mid-drag (e.g. the user navigates away or the panel
  // disappears) the document listeners above would leak. We mirror the
  // `mouseup` cleanup here as a safety net.
  useEffect(() => {
    return () => {
      // We can't reference the inner onMouseUp / onMouseMove (they live in
      // the closure above), but the drag state itself can be reset so any
      // subsequent callback is a no-op until the user starts a new drag.
      dragState.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed bottom-4 right-4 z-40 w-[460px]"
      onMouseDown={handleMouseDown}
      data-testid="swarm-panel-draggable"
    >
      <SwarmPanel />
    </div>
  );
}

export default SwarmPanelDraggable;
