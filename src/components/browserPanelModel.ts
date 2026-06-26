import type {
  BrowserAuthState,
  BrowserInspectionResult,
  BrowserSessionStatus,
} from '../types/browser';

export type BrowserPanelTone = 'slate' | 'blue' | 'green' | 'amber' | 'red';

export const browserPanelToneClasses: Record<
  BrowserPanelTone,
  { container: string; title: string; body: string; icon: string }
> = {
  slate: {
    container: 'border-gray-200 bg-gray-50',
    title: 'text-gray-900',
    body: 'text-gray-600',
    icon: 'bg-white text-gray-500',
  },
  blue: {
    container: 'border-blue-200 bg-blue-50',
    title: 'text-blue-900',
    body: 'text-blue-700',
    icon: 'bg-white text-blue-600',
  },
  green: {
    container: 'border-green-200 bg-green-50',
    title: 'text-green-900',
    body: 'text-green-700',
    icon: 'bg-white text-green-600',
  },
  amber: {
    container: 'border-amber-200 bg-amber-50',
    title: 'text-amber-900',
    body: 'text-amber-700',
    icon: 'bg-white text-amber-600',
  },
  red: {
    container: 'border-red-200 bg-red-50',
    title: 'text-red-900',
    body: 'text-red-700',
    icon: 'bg-white text-red-600',
  },
};

export function getBrowserPanelToneIcon(tone: BrowserPanelTone): string {
  switch (tone) {
    case 'green':
      return 'OK';
    case 'blue':
      return '...';
    case 'amber':
      return '!';
    case 'red':
      return 'X';
    default:
      return '.';
  }
}

export function getBrowserPanelLogColor(level: string): string {
  switch (level) {
    case 'success':
      return 'text-green-400';
    case 'error':
      return 'text-red-400';
    case 'warning':
    case 'thinking':
      return 'text-yellow-400';
    case 'info':
      return 'text-blue-400';
    default:
      return 'text-gray-300';
  }
}

export function formatBrowserPanelLogTime(timestamp: string): string {
  if (timestamp.includes(':') && timestamp.length <= 8) {
    return timestamp;
  }

  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface BrowserPanelStatusInfo {
  tone: BrowserPanelTone;
  titleKey: string;
  descriptionKey: string;
}

export interface BrowserPanelTaskFlowState {
  status: BrowserSessionStatus;
  authState: BrowserAuthState;
  inspection: BrowserInspectionResult | null;
}

export interface BrowserPanelTaskFlowArgs {
  task: string;
  initialState: {
    isWindowOpen: boolean;
    status: BrowserSessionStatus;
  };
  getState: () => BrowserPanelTaskFlowState;
  inspectCurrentPage: () => Promise<void>;
  confirmLoginAndResume: () => Promise<void>;
  executeTask: (task: string) => Promise<void>;
}

export interface BrowserPanelTaskFlowResult {
  outcome: 'noop' | 'open_window_required' | 'executing' | 'needs_user_action' | 'blocked' | 'not_ready';
  finalStatus: BrowserSessionStatus;
  shouldClearTaskInput: boolean;
  executionPromise?: Promise<void>;
}

function mapStatusToOutcome(
  status: BrowserSessionStatus
): BrowserPanelTaskFlowResult['outcome'] {
  switch (status) {
    case 'waiting_user_resume':
    case 'needs_login':
      return 'needs_user_action';
    case 'blocked_auth':
    case 'blocked_captcha':
    case 'blocked_manual_step':
      return 'blocked';
    case 'running':
    case 'ready_for_agent':
      return 'executing';
    default:
      return 'not_ready';
  }
}

export function getBrowserPanelStatusInfo({
  isWindowOpen,
  status,
}: {
  isWindowOpen: boolean;
  status: BrowserSessionStatus;
}): BrowserPanelStatusInfo {
  if (!isWindowOpen) {
    return {
      tone: 'amber',
      titleKey: 'browser.guidance.openWindowTitle',
      descriptionKey: 'browser.guidance.openWindowDescription',
    };
  }

  switch (status) {
    case 'opening':
      return {
        tone: 'blue',
        titleKey: 'browser.guidance.openingTitle',
        descriptionKey: 'browser.guidance.openingDescription',
      };
    case 'idle':
    case 'uninitialized':
      return {
        tone: 'slate',
        titleKey: 'browser.guidance.idleTitle',
        descriptionKey: 'browser.guidance.idleDescription',
      };
    case 'inspecting':
      return {
        tone: 'blue',
        titleKey: 'browser.guidance.inspectingTitle',
        descriptionKey: 'browser.guidance.inspectingDescription',
      };
    case 'needs_login':
    case 'waiting_user_resume':
      return {
        tone: 'amber',
        titleKey: 'browser.guidance.needsLoginTitle',
        descriptionKey: 'browser.guidance.needsLoginDescription',
      };
    case 'ready_for_agent':
      return {
        tone: 'green',
        titleKey: 'browser.guidance.readyTitle',
        descriptionKey: 'browser.guidance.readyDescription',
      };
    case 'running':
      return {
        tone: 'blue',
        titleKey: 'browser.guidance.runningTitle',
        descriptionKey: 'browser.guidance.runningDescription',
      };
    case 'blocked_auth':
      return {
        tone: 'amber',
        titleKey: 'browser.guidance.blockedAuthTitle',
        descriptionKey: 'browser.guidance.blockedAuthDescription',
      };
    case 'blocked_captcha':
      return {
        tone: 'amber',
        titleKey: 'browser.guidance.blockedCaptchaTitle',
        descriptionKey: 'browser.guidance.blockedCaptchaDescription',
      };
    case 'blocked_manual_step':
      return {
        tone: 'amber',
        titleKey: 'browser.guidance.blockedManualStepTitle',
        descriptionKey: 'browser.guidance.blockedManualStepDescription',
      };
    case 'completed':
      return {
        tone: 'green',
        titleKey: 'browser.guidance.completedTitle',
        descriptionKey: 'browser.guidance.completedDescription',
      };
    case 'error':
      return {
        tone: 'red',
        titleKey: 'browser.guidance.errorTitle',
        descriptionKey: 'browser.guidance.errorDescription',
      };
    default:
      return {
        tone: 'slate',
        titleKey: 'browser.guidance.idleTitle',
        descriptionKey: 'browser.guidance.idleDescription',
      };
  }
}

export function getBrowserPanelPrimaryActionKey(status: BrowserSessionStatus): string {
  switch (status) {
    case 'waiting_user_resume':
    case 'needs_login':
      return 'browser.executeAfterLogin';
    case 'blocked_manual_step':
      return 'browser.executeAfterManualStep';
    case 'blocked_auth':
    case 'blocked_captcha':
      return 'browser.continueCheck';
    default:
      return 'browser.execute';
  }
}

export function isBrowserPanelTaskInputDisabled(status: BrowserSessionStatus): boolean {
  return status === 'running';
}

export async function runBrowserPanelTaskFlow({
  task,
  initialState,
  getState,
  inspectCurrentPage,
  confirmLoginAndResume,
  executeTask,
}: BrowserPanelTaskFlowArgs): Promise<BrowserPanelTaskFlowResult> {
  const trimmedTask = task.trim();
  if (!trimmedTask) {
    return {
      outcome: 'noop',
      finalStatus: initialState.status,
      shouldClearTaskInput: false,
    };
  }

  if (!initialState.isWindowOpen) {
    return {
      outcome: 'open_window_required',
      finalStatus: initialState.status,
      shouldClearTaskInput: false,
    };
  }

  let nextState = getState();

  if (nextState.status !== 'ready_for_agent') {
    await inspectCurrentPage();
    nextState = getState();

    if (
      nextState.status !== 'ready_for_agent'
      && nextState.authState === 'unknown'
      && nextState.inspection?.safeForAgent
    ) {
      await confirmLoginAndResume();
      nextState = getState();
    }

    if (nextState.status !== 'ready_for_agent') {
      return {
        outcome: mapStatusToOutcome(nextState.status),
        finalStatus: nextState.status,
        shouldClearTaskInput: false,
      };
    }
  }

  let executionPromise: Promise<void>;
  try {
    executionPromise = executeTask(trimmedTask);
  } catch {
    const failedState = getState();
    return {
      outcome: mapStatusToOutcome(failedState.status),
      finalStatus: failedState.status,
      shouldClearTaskInput: false,
    };
  }

  const afterExecuteState = getState();
  const started = afterExecuteState.status === 'running';

  return {
    outcome: started ? 'executing' : mapStatusToOutcome(afterExecuteState.status),
    finalStatus: afterExecuteState.status,
    shouldClearTaskInput: started,
    executionPromise,
  };
}
