import type { BrowserFailureSnapshot, BrowserSessionStatus, BrowserTaskEnvelope } from '@/types/browser';
import type { BrowserPageStateSnapshot } from '@/types/browserObservability';
import type {
  BrowserConnectionStatePayload,
  CdpStatus,
} from '@/store/browser/browserConnection';
import type { CdpRuntimeSnapshot } from '@/store/cdpRuntime';
import type { BrowserPanelTone } from '@/components/browserPanelModel';

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
};

export interface CdpBrowserDisplayStateArgs {
  cdpStatus: CdpStatus;
  connectionState: BrowserConnectionStatePayload | null;
  cdpRuntime: CdpRuntimeSnapshot;
  latestPageState: BrowserPageStateSnapshot | null;
  pendingTask: BrowserTaskEnvelope | null;
  browserCurrentUrl: string;
  browserStatus: BrowserSessionStatus;
  activeFailureSnapshot?: BrowserFailureSnapshot | null;
}

export interface CdpBrowserDisplayState {
  connected: boolean;
  connecting: boolean;
  observedUrl: string;
  targetUrl: string;
  displayUrl: string;
  pageTitle: string;
  hasObservedPage: boolean;
  hasRunnableTarget: boolean;
  launchMode: string;
  healthStatus: string;
  targetId: string;
  sessionId: string;
  taskText: string;
  taskStatus: CdpRuntimeSnapshot['taskStatus'];
  lastError: string;
  lastResult: string;
  lastFailedAction: string;
  tone: BrowserPanelTone;
  titleKey: string;
  descriptionKey: string;
}

export function resolveCdpBrowserDisplayState({
  cdpStatus,
  connectionState,
  cdpRuntime,
  latestPageState,
  pendingTask,
  browserCurrentUrl,
  browserStatus,
  activeFailureSnapshot,
}: CdpBrowserDisplayStateArgs): CdpBrowserDisplayState {
  const connected = cdpStatus === 'connected' || cdpRuntime.taskStatus === 'running' || cdpRuntime.taskStatus === 'completed';
  const connecting = cdpStatus === 'connecting';
  const observedUrl = firstNonEmpty(
    connectionState?.current_url,
    cdpRuntime.currentUrl,
    latestPageState?.url,
  );
  const targetUrl = firstNonEmpty(pendingTask?.targetUrl, browserCurrentUrl);
  const displayUrl = firstNonEmpty(observedUrl, targetUrl, activeFailureSnapshot?.url);
  const pageTitle = firstNonEmpty(latestPageState?.title);
  const hasObservedPage = Boolean(observedUrl);
  const hasRunnableTarget = Boolean(displayUrl);
  const lastError = firstNonEmpty(cdpRuntime.lastError, activeFailureSnapshot?.errorMessage);
  const lastResult = firstNonEmpty(cdpRuntime.lastResult);
  const lastFailedAction = firstNonEmpty(cdpRuntime.lastFailedAction, activeFailureSnapshot?.failedAction);
  const taskStatus = cdpRuntime.taskStatus;
  const taskText = firstNonEmpty(
    cdpRuntime.activeTaskLabel,
    pendingTask?.executionPrompt,
    pendingTask?.userIntent,
  );

  let tone: BrowserPanelTone = connected ? 'slate' : 'amber';
  let titleKey = connected
    ? 'browser.surface.externalChromeConnected'
    : 'browser.surface.externalChromeDisconnected';
  let descriptionKey = connected
    ? 'browser.surface.externalChromeControllerDescription'
    : 'browser.surface.noCdpSession';

  if (taskStatus === 'failed' || lastError) {
    tone = 'red';
    titleKey = 'browser.surface.cdpTaskFailed';
    descriptionKey = 'browser.surface.cdpTaskFailedDescription';
  } else if (connecting || taskStatus === 'running' || browserStatus === 'running') {
    tone = 'blue';
    titleKey = 'browser.guidance.runningTitle';
    descriptionKey = 'browser.guidance.runningDescription';
  } else if (taskStatus === 'completed' || lastResult) {
    tone = 'green';
    titleKey = 'browser.guidance.completedTitle';
    descriptionKey = 'browser.guidance.completedDescription';
  } else if (connected && hasObservedPage) {
    tone = 'green';
    titleKey = 'browser.surface.readyTitle';
    descriptionKey = 'browser.surface.readyDescription';
  } else if (connected && hasRunnableTarget) {
    tone = 'slate';
    titleKey = 'browser.surface.targetReadyTitle';
    descriptionKey = 'browser.surface.targetReadyDescription';
  } else if (connected) {
    titleKey = 'browser.surface.noChromePageTitle';
    descriptionKey = 'browser.surface.noChromePageDescription';
  } else if (!hasRunnableTarget) {
    titleKey = 'browser.surface.noChromePageTitle';
    descriptionKey = 'browser.surface.noChromePageDescription';
  }

  return {
    connected,
    connecting,
    observedUrl,
    targetUrl,
    displayUrl,
    pageTitle,
    hasObservedPage,
    hasRunnableTarget,
    launchMode: firstNonEmpty(connectionState?.launch_mode, cdpRuntime.launchMode),
    healthStatus: firstNonEmpty(connectionState?.health_status, cdpRuntime.healthStatus),
    targetId: firstNonEmpty(connectionState?.target_id),
    sessionId: firstNonEmpty(connectionState?.session_id),
    taskText,
    taskStatus,
    lastError,
    lastResult,
    lastFailedAction,
    tone,
    titleKey,
    descriptionKey,
  };
}
