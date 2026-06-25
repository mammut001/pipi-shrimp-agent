import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useUIStore } from '@/store/uiStore';
import { BROWSER_TOOL_NAMES } from './browserTools';

/** Agent is actively driving the embedded browser surface. */
const BROWSER_AGENT_BLOCKING_STATUSES = new Set([
  'running',
  'opening',
  'inspecting',
  'ready_for_agent',
]);

/** Chat agent browser tools that are executing (or about to). */
const ACTIVE_BROWSER_TOOL_BLOCKING_STATUSES = new Set([
  'running',
  'approved',
]);

/** Earlier pipeline states still deserve the marquee hint. */
const ACTIVE_BROWSER_TOOL_MARQUEE_STATUSES = new Set([
  'validating',
  'running',
  'approved',
]);

export type BrowserMarqueeSnapshot = {
  browserStatus: string;
  taskProgress: Array<{ label: string; status: string }>;
  permissionQueue: Array<{ toolName: string }>;
};

export function readBrowserMarqueeSnapshot(): BrowserMarqueeSnapshot {
  const browserState = useBrowserAgentStore.getState();
  const uiState = useUIStore.getState();
  return {
    browserStatus: browserState.status,
    taskProgress: uiState.taskProgress.map((step) => ({
      label: step.label,
      status: step.status,
    })),
    permissionQueue: uiState.permissionQueue.map((request) => ({
      toolName: request.toolName,
    })),
  };
}

function hasActiveBrowserTool(
  taskProgress: BrowserMarqueeSnapshot['taskProgress'],
  statuses: Set<string>,
): boolean {
  return taskProgress.some(
    (step) => BROWSER_TOOL_NAMES.includes(step.label) && statuses.has(step.status),
  );
}

/** True while automation is running and the browser surface should be input-blocked. */
export function isBrowserInputBlocked(snapshot = readBrowserMarqueeSnapshot()): boolean {
  if (BROWSER_AGENT_BLOCKING_STATUSES.has(snapshot.browserStatus)) {
    return true;
  }

  if (hasActiveBrowserTool(snapshot.taskProgress, ACTIVE_BROWSER_TOOL_BLOCKING_STATUSES)) {
    return true;
  }

  return false;
}

/**
 * True while the browser chrome should show the animated marquee border.
 * Slightly broader than input blocking so users see the hint during validation.
 */
export function isBrowserMarqueeActive(snapshot = readBrowserMarqueeSnapshot()): boolean {
  if (isBrowserInputBlocked(snapshot)) {
    return true;
  }

  return hasActiveBrowserTool(snapshot.taskProgress, ACTIVE_BROWSER_TOOL_MARQUEE_STATUSES);
}