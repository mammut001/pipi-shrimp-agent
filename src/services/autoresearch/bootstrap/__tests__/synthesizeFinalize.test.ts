import { describe, expect, it } from '@jest/globals';
import type { Recipe } from '@/components/autoresearch/bootstrapRecipePrompt';
import {
  HOST_SYNTHESIZED_BOOTSTRAP_FINALIZE_WARNING,
  canSynthesizeBootstrapFinalize,
  resolveHostFinalizeWorkDir,
  synthesizeBootstrapFinalizeFromRecipe,
} from '../synthesizeFinalize';

function recipe(overrides: Partial<{
  workDir: string;
  folderName: string;
  goalText: string;
  primaryMetric: string;
  baselineValue: string;
  successCriteria: string;
  taskType: Recipe['researchGoal']['taskType'];
}> = {}): Recipe {
  return {
    researchGoal: {
      goalText: overrides.goalText ?? 'Beat the digits baseline.',
      taskType: overrides.taskType ?? 'beat_baseline',
      source: 'user',
    },
    references: {},
    baselineAndMetric: {
      primaryMetric: overrides.primaryMetric ?? 'cv_accuracy',
      direction: 'higher',
      baselineValue: overrides.baselineValue ?? '0.91',
      successCriteria: overrides.successCriteria ?? 'Exceed 0.91 cv_accuracy on the held-out split.',
    },
    workspace: {
      workDir: overrides.workDir ?? '/tmp/harness-smoke',
      folderName: overrides.folderName ?? 'harness-smoke',
    },
    verification: { commands: ['python3 run_experiment.py'] },
    outputContract: {
      includeMetrics: true,
      includeArtifacts: true,
      includeCommandsRun: true,
      includeFailureReason: true,
      includeRemainingRisks: true,
    },
  };
}

describe('synthesizeBootstrapFinalizeFromRecipe', () => {
  it('requires an explicit workDir and does not invent a folder from folderName', () => {
    expect(canSynthesizeBootstrapFinalize(recipe({ workDir: '' }))).toBe(false);
    expect(resolveHostFinalizeWorkDir(recipe({ workDir: '' }), '/tmp')).toBe('/tmp');
    expect(resolveHostFinalizeWorkDir(recipe({ workDir: '', folderName: 'unet' }))).toBe('');
    expect(canSynthesizeBootstrapFinalize(recipe({ workDir: '.' }))).toBe(false);
  });

  it('builds a real ready bootstrap_finalize payload from the recipe', () => {
    const result = synthesizeBootstrapFinalizeFromRecipe(recipe());
    expect(result).not.toBeNull();
    expect(result?.status).toBe('ready');
    expect(result?.plan.scaffold.workDir).toBe('/tmp/harness-smoke');
    expect(result?.plan.primaryMetric).toBe('cv_accuracy');
    expect(result?.plan.baselines).toHaveLength(1);
    expect(result?.plan.baselines[0]?.reportedMetrics[0]?.value).toBe(0.91);
    expect(result?.warnings).toContain(HOST_SYNTHESIZED_BOOTSTRAP_FINALIZE_WARNING);
    expect(result?.unresolvedQuestions).toEqual([]);
  });

  it('returns null when the recipe is missing a goal or metric', () => {
    expect(synthesizeBootstrapFinalizeFromRecipe(recipe({ goalText: '   ' }))).toBeNull();
    expect(synthesizeBootstrapFinalizeFromRecipe(recipe({ primaryMetric: '' }))).toBeNull();
  });
});
