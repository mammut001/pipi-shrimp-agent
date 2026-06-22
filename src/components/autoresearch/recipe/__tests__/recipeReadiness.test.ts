import { describe, expect, it } from '@jest/globals';
import { getRecipeReadiness, getRecipeNextAction, isGoalPlaceholder } from '../recipeReadiness';

describe('recipeReadiness tests', () => {
  const dummyRecipe = {
    researchGoal: {
      goalText: 'Train a model to recognize hand written digits.',
      taskType: 'from_scratch',
      source: 'user',
    },
    baselineAndMetric: {
      primaryMetric: 'accuracy',
    },
    workspace: {
      workDir: '/path/to/project',
    },
  };

  it('checks if a goal is a template placeholder', () => {
    const placeholder = 'I want to start an AutoResearch task. Please guide me through setting up goals, papers, baselines, and workspace scaffolding.';
    expect(isGoalPlaceholder(placeholder, 'template')).toBe(true);
    expect(isGoalPlaceholder(placeholder, 'user')).toBe(false);
    expect(isGoalPlaceholder('Custom user goal text', 'template')).toBe(false);
  });

  it('computes completed/missing readiness on valid recipe', () => {
    const readiness = getRecipeReadiness(dummyRecipe);
    expect(readiness.isFormValid).toBe(true);
    expect(readiness.sectionStatus.goal).toBe('completed');
    expect(readiness.sectionStatus.baseline).toBe('completed');
    expect(readiness.sectionStatus.workspace).toBe('completed');
    expect(readiness.requiredCount).toBe(3);
    expect(readiness.missingKeys.length).toBe(0);
  });

  it('identifies missing fields in state calculation', () => {
    const brokenRecipe = {
      researchGoal: {
        goalText: '',
        taskType: 'from_scratch',
      },
      baselineAndMetric: {
        primaryMetric: '',
      },
      workspace: {
        workDir: '',
      },
    };
    const readiness = getRecipeReadiness(brokenRecipe);
    expect(readiness.isFormValid).toBe(false);
    expect(readiness.sectionStatus.goal).toBe('missing');
    expect(readiness.sectionStatus.baseline).toBe('missing');
    expect(readiness.sectionStatus.workspace).toBe('missing');
    expect(readiness.requiredCount).toBe(0);
    expect(readiness.missingKeys).toContain('missingGoal');
    expect(readiness.missingKeys).toContain('missingMetric');
    expect(readiness.missingKeys).toContain('missingWorkspace');
  });

  it('determines next actions based on missing statuses', () => {
    const emptyGoalRecipe = {
      ...dummyRecipe,
      researchGoal: { goalText: '', taskType: 'ablation' },
    };
    const action1 = getRecipeNextAction(getRecipeReadiness(emptyGoalRecipe));
    expect(action1.section).toBe('goal');
    expect(action1.labelKey).toBe('autoresearch.recipe.confirmResearchGoalFirst');

    const emptyMetricRecipe = {
      ...dummyRecipe,
      baselineAndMetric: { primaryMetric: '' },
    };
    const action2 = getRecipeNextAction(getRecipeReadiness(emptyMetricRecipe));
    expect(action2.section).toBe('baseline');
    expect(action2.labelKey).toBe('autoresearch.recipe.action.fillMetric');

    const emptyWorkspaceRecipe = {
      ...dummyRecipe,
      workspace: { workDir: '' },
    };
    const action3 = getRecipeNextAction(getRecipeReadiness(emptyWorkspaceRecipe));
    expect(action3.section).toBe('workspace');
    expect(action3.labelKey).toBe('autoresearch.recipe.action.selectWorkspace');
  });
});
