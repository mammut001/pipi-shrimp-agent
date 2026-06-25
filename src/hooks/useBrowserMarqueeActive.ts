import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useUIStore } from '@/store/uiStore';
import {
  isBrowserInputBlocked,
  isBrowserMarqueeActive,
  type BrowserMarqueeSnapshot,
} from '@/services/browser/browserMarqueeActive';

function useBrowserMarqueeSnapshot(): BrowserMarqueeSnapshot {
  const browserStatus = useBrowserAgentStore((state) => state.status);
  const taskProgress = useUIStore((state) => state.taskProgress);
  const permissionQueue = useUIStore((state) => state.permissionQueue);

  return {
    browserStatus,
    taskProgress: taskProgress.map((step) => ({
      label: step.label,
      status: step.status,
    })),
    permissionQueue: permissionQueue.map((request) => ({
      toolName: request.toolName,
    })),
  };
}

/**
 * True while the browser surface should show the running marquee border —
 * either the browser agent workflow is active, or the chat agent is executing
 * browser tools against the connected Chrome session.
 */
export function useBrowserMarqueeActive(): boolean {
  return isBrowserMarqueeActive(useBrowserMarqueeSnapshot());
}

/** True while pointer events on the browser viewport must be blocked. */
export function useBrowserInputBlocked(): boolean {
  return isBrowserInputBlocked(useBrowserMarqueeSnapshot());
}