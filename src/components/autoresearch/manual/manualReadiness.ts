import { isAbsoluteOrHomePath } from '@/services/autoresearch/pathInput';

export interface ManualSetupDraft {
  setupForm: {
    mode: 'local' | 'ssh';
    host: string;
    user: string;
    port: number;
    authMode: 'agent' | 'password' | 'key';
    password?: string;
    keyPath?: string;
    remoteWorkDir: string;
  };
  experimentDir: string;
  metric: string;
  baselineInvalid: boolean;
  connectionTestStatus: 'idle' | 'testing' | 'success' | 'error';
  providerReady: boolean;
}

export interface ManualSetupReadiness {
  sectionStatus: {
    provider: boolean;
    runtime: boolean;
    workspace: boolean;
    targetProject: boolean;
    metric: boolean;
    envCheck: boolean;
  };
  rawSectionStatus: {
    provider: string;
    runtime: string;
    workspace: string;
    targetProject: string;
    metric: string;
    envCheck: string;
  };
  completedCount: number;
  missingIds: string[];
  firstMissingId: string | null;
}

export function getManualSetupReadiness(draft: ManualSetupDraft): ManualSetupReadiness {
  const getSectionStatus = (section: string): string => {
    switch (section) {
      case 'provider':
        return draft.providerReady ? 'completed' : 'missing';
      case 'runtime':
        if (draft.setupForm.mode === 'local') return 'completed';
        if (draft.setupForm.mode === 'ssh') {
          const hostValid = Boolean((draft.setupForm.host || '').trim());
          const userValid = Boolean((draft.setupForm.user || '').trim());
          let authValid = true;
          if (draft.setupForm.authMode === 'password') {
            authValid = Boolean(draft.setupForm.password);
          } else if (draft.setupForm.authMode === 'key') {
            authValid = Boolean(draft.setupForm.keyPath);
          }
          return (hostValid && userValid && authValid) ? 'completed' : 'missing';
        }
        return 'missing';
      case 'workspace':
        return (draft.setupForm.remoteWorkDir || '').trim().length > 0
          && isAbsoluteOrHomePath(draft.setupForm.remoteWorkDir)
          ? 'completed'
          : 'missing';
      case 'targetProject':
        return (draft.experimentDir || '').trim().length > 0
          && isAbsoluteOrHomePath(draft.experimentDir)
          ? 'completed'
          : 'missing';
      case 'metric':
        const metricValid = (draft.metric || '').trim().length > 0;
        return (metricValid && !draft.baselineInvalid) ? 'completed' : 'missing';
      case 'envCheck':
        if (draft.connectionTestStatus === 'success') return 'completed';
        if (draft.connectionTestStatus === 'testing') return 'testing';
        if (draft.connectionTestStatus === 'error') return 'failed';
        return 'notTested';
      default:
        return 'completed';
    }
  };

  const sectionStatus = {
    provider: getSectionStatus('provider') === 'completed',
    runtime: getSectionStatus('runtime') === 'completed',
    workspace: getSectionStatus('workspace') === 'completed',
    targetProject: getSectionStatus('targetProject') === 'completed',
    metric: getSectionStatus('metric') === 'completed',
    envCheck: getSectionStatus('envCheck') === 'completed',
  };

  const rawSectionStatus = {
    provider: getSectionStatus('provider'),
    runtime: getSectionStatus('runtime'),
    workspace: getSectionStatus('workspace'),
    targetProject: getSectionStatus('targetProject'),
    metric: getSectionStatus('metric'),
    envCheck: getSectionStatus('envCheck'),
  };

  const requiredItems = [
    { id: 'provider', ready: sectionStatus.provider },
    { id: 'runtime', ready: sectionStatus.runtime },
    { id: 'workspace', ready: sectionStatus.workspace },
    { id: 'targetProject', ready: sectionStatus.targetProject },
    { id: 'metric', ready: sectionStatus.metric },
    { id: 'envCheck', ready: sectionStatus.envCheck },
  ];

  const completedCount = requiredItems.filter((item) => item.ready).length;
  const missingItems = requiredItems.filter((item) => !item.ready);
  const firstMissingId = missingItems[0]?.id || null;

  return {
    sectionStatus,
    rawSectionStatus,
    completedCount,
    missingIds: missingItems.map(item => item.id),
    firstMissingId,
  };
}

export interface ManualNextAction {
  labelKey: string;
  actionType: 'start' | 'provider' | 'runtime' | 'workspace' | 'targetProject' | 'metric' | 'envCheck';
  disabled: boolean;
}

export function getManualSetupNextAction(
  readiness: ManualSetupReadiness,
  connectionTestStatus: 'idle' | 'testing' | 'success' | 'error'
): ManualNextAction {
  const firstMissingId = readiness.firstMissingId;
  if (!firstMissingId) {
    return {
      labelKey: 'autoresearch.manual.start',
      actionType: 'start',
      disabled: false,
    };
  }

  if (firstMissingId === 'provider') {
    return {
      labelKey: 'autoresearch.manual.action.openProviderConfig',
      actionType: 'provider',
      disabled: false,
    };
  }
  if (firstMissingId === 'runtime') {
    return {
      labelKey: 'autoresearch.manual.action.fillRuntime',
      actionType: 'runtime',
      disabled: false,
    };
  }
  if (firstMissingId === 'workspace') {
    return {
      labelKey: 'autoresearch.manual.action.fillWorkspace',
      actionType: 'workspace',
      disabled: false,
    };
  }
  if (firstMissingId === 'targetProject') {
    return {
      labelKey: 'autoresearch.manual.action.fillTargetProject',
      actionType: 'targetProject',
      disabled: false,
    };
  }
  if (firstMissingId === 'metric') {
    return {
      labelKey: 'autoresearch.manual.action.fillMetric',
      actionType: 'metric',
      disabled: false,
    };
  }
  if (firstMissingId === 'envCheck') {
    if (connectionTestStatus === 'testing') {
      return {
        labelKey: 'autoresearch.connectionTesting',
        actionType: 'envCheck',
        disabled: true,
      };
    } else {
      return {
        labelKey: 'autoresearch.manual.action.testEnv',
        actionType: 'envCheck',
        disabled: false,
      };
    }
  }

  return {
    labelKey: 'autoresearch.manual.start',
    actionType: 'start',
    disabled: false,
  };
}
