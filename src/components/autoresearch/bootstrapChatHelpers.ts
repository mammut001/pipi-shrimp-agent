import type { ExtractedBaseline } from '@/services/autoresearch/bootstrap/types';
import type { SshConfig } from '@/store/autoresearchStore';
import { type Recipe } from './bootstrapRecipePrompt';

/** Shared copy for tests + UI when headless turn omits bootstrap_finalize. */
export const BOOTSTRAP_MISSING_FINALIZE_MESSAGE =
  'Bootstrap agent finished but did not produce a bootstrap_finalize result.';

function guessMetricDirection(metricName: string): 'higher' | 'lower' {
  const lowered = metricName.toLowerCase();
  if (['loss', 'error', 'perplexity', 'wer', 'cer', 'latency', 'time'].some((token) => lowered.includes(token))) {
    return 'lower';
  }
  return 'higher';
}

function isExplicitMetricDirection(value: unknown): value is 'higher' | 'lower' {
  return value === 'higher' || value === 'lower';
}

/**
 * AUDIT-FIX [R5-08]: Prefer explicit bootstrap plan / recipe direction end-to-end.
 * Only fall back to metric-name guessing when both omit a direction — never override
 * an explicit plan value with a guess (or with a stale recipe default).
 */
export function resolveBootstrapMetricDirection(options: {
  planDirection?: unknown;
  recipeDirection?: unknown;
  primaryMetric: string;
}): 'higher' | 'lower' {
  if (isExplicitMetricDirection(options.planDirection)) {
    return options.planDirection;
  }
  if (isExplicitMetricDirection(options.recipeDirection)) {
    return options.recipeDirection;
  }
  return guessMetricDirection(options.primaryMetric);
}

export function resolveBaselineValue(baselines: ExtractedBaseline[], primaryMetric: string): number | null {
  const normalizedMetric = primaryMetric.trim().toLowerCase();
  for (const baseline of baselines) {
    for (const metric of baseline.reportedMetrics) {
      if (metric.name.trim().toLowerCase() === normalizedMetric) {
        return metric.value;
      }
    }
  }
  return baselines[0]?.reportedMetrics[0]?.value ?? null;
}

export function resolveBootstrapRemoteWorkDir(sshConfig: SshConfig, workDir: string): string {
  const remoteRoot = (sshConfig.remoteWorkDir || '~/autoresearch').trim().replace(/[\\/]+$/, '');
  const trimmed = workDir.trim().replace(/[\\/]+$/, '');
  if (!trimmed) {
    return remoteRoot;
  }
  if (trimmed === remoteRoot || trimmed.startsWith(`${remoteRoot}/`)) {
    return trimmed;
  }

  const folderName = trimmed.split(/[\\/]/).filter(Boolean).pop() || '';
  const isGenericTemp = !folderName || /^(tmp|temp|temporary)/i.test(folderName) || folderName.startsWith('autoresearch-');

  if (remoteRoot !== '~/autoresearch' || isGenericTemp) {
    return remoteRoot;
  }

  return `${remoteRoot}/${folderName}`;
}

export function createDefaultRecipe(sshConfig?: SshConfig): Recipe {
  return {
    researchGoal: {
      goalText: 'I want to start an AutoResearch task. Please guide me through setting up goals, papers, baselines, and workspace scaffolding.',
      taskType: 'reproduce_paper',
      source: 'template',
    },
    references: {},
    baselineAndMetric: {
      primaryMetric: 'accuracy',
      direction: 'higher',
      baselineValue: '0.85',
      successCriteria: 'Match or exceed the target baseline metric.',
    },
    workspace: {
      workDir: sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir || '' : '',
      folderName: 'bootstrap-project',
    },
    verification: {
      commands: ['pytest'],
    },
    outputContract: {
      includeMetrics: true,
      includeArtifacts: true,
      includeCommandsRun: true,
      includeFailureReason: true,
      includeRemainingRisks: true,
    },
  };
}
