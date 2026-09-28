import zhCN from '@/i18n/locales/zh-CN';
import enUS from '@/i18n/locales/en-US';

/**
 * goalText is compared against these verbatim to detect an unedited template
 * opener (see isGoalPlaceholder). Both locales' translations are included so
 * detection stays correct regardless of which locale was active when the
 * opener text was generated vs. when it's later checked.
 */
const PLACEHOLDER_GOAL_KEYS = [
  'autoresearch.recipe.defaultGoalOpener',
  'autoresearch.bootstrap.card.reproduce.opener',
  'autoresearch.bootstrap.card.baseline.opener',
  'autoresearch.bootstrap.card.ablation.opener',
  'autoresearch.bootstrap.card.scratch.opener',
] as const;

export const PLACEHOLDER_GOALS = PLACEHOLDER_GOAL_KEYS.flatMap((key) => [zhCN[key], enUS[key]]);

export interface Recipe {
  researchGoal: {
    goalText: string;
    taskType: string;
    source?: string;
  };
  baselineAndMetric: {
    primaryMetric: string;
  };
  workspace: {
    workDir: string;
  };
}

export interface RecipeReadiness {
  sectionStatus: {
    goal: 'missing' | 'placeholder' | 'completed';
    references: 'optional';
    baseline: 'completed' | 'missing';
    workspace: 'completed' | 'missing';
    verification: 'optional';
    output: 'optional';
  };
  isFormValid: boolean;
  requiredCount: number;
  totalCount: number;
  missingKeys: ('missingGoal' | 'confirmResearchGoal' | 'missingMetric' | 'missingWorkspace')[];
}

export function isGoalPlaceholder(goalText: string, source?: string): boolean {
  if (!goalText) return false;
  return (!source || source === 'template') &&
    PLACEHOLDER_GOALS.some(p => p.trim() === goalText.trim());
}

export function getRecipeReadiness(recipe: Recipe): RecipeReadiness {
  const goalText = recipe?.researchGoal?.goalText || '';
  const goalSource = recipe?.researchGoal?.source;
  const isPlaceholder = isGoalPlaceholder(goalText, goalSource);
  
  const goalStatus: 'missing' | 'placeholder' | 'completed' = 
    goalText.trim().length === 0 ? 'missing' : (isPlaceholder ? 'placeholder' : 'completed');

  const baselineStatus: 'completed' | 'missing' = 
    (recipe?.baselineAndMetric?.primaryMetric || '').trim().length > 0 ? 'completed' : 'missing';

  const workspaceStatus: 'completed' | 'missing' = 
    (recipe?.workspace?.workDir || '').trim().length > 0 ? 'completed' : 'missing';

  const sectionStatus = {
    goal: goalStatus,
    references: 'optional' as const,
    baseline: baselineStatus,
    workspace: workspaceStatus,
    verification: 'optional' as const,
    output: 'optional' as const,
  };

  const isFormValid = goalStatus === 'completed' && baselineStatus === 'completed' && workspaceStatus === 'completed';

  const requiredList = [
    { key: 'goal', completed: goalStatus === 'completed' },
    { key: 'baseline', completed: baselineStatus === 'completed' },
    { key: 'workspace', completed: workspaceStatus === 'completed' },
  ];
  const requiredCount = requiredList.filter(item => item.completed).length;

  const totalList = [
    { key: 'goal', completed: goalStatus === 'completed' },
    { key: 'references', completed: true },
    { key: 'baseline', completed: baselineStatus === 'completed' },
    { key: 'workspace', completed: workspaceStatus === 'completed' },
    { key: 'verification', completed: true },
    { key: 'output', completed: true },
  ];
  const totalCount = totalList.filter(item => item.completed).length;

  const missingKeys: ('missingGoal' | 'confirmResearchGoal' | 'missingMetric' | 'missingWorkspace')[] = [];
  if (goalStatus === 'missing') {
    missingKeys.push('missingGoal');
  } else if (goalStatus === 'placeholder') {
    missingKeys.push('confirmResearchGoal');
  }
  if (baselineStatus === 'missing') {
    missingKeys.push('missingMetric');
  }
  if (workspaceStatus === 'missing') {
    missingKeys.push('missingWorkspace');
  }

  return {
    sectionStatus,
    isFormValid,
    requiredCount,
    totalCount,
    missingKeys,
  };
}

export interface RecipeNextAction {
  labelKey: string | null;
  section: string | null;
}

export function getRecipeNextAction(readiness: RecipeReadiness): RecipeNextAction {
  if (readiness.sectionStatus.goal !== 'completed') {
    return {
      labelKey: 'autoresearch.recipe.confirmResearchGoalFirst',
      section: 'goal',
    };
  }
  if (readiness.sectionStatus.baseline !== 'completed') {
    return {
      labelKey: 'autoresearch.recipe.action.fillMetric',
      section: 'baseline',
    };
  }
  if (readiness.sectionStatus.workspace !== 'completed') {
    return {
      labelKey: 'autoresearch.recipe.action.selectWorkspace',
      section: 'workspace',
    };
  }
  return {
    labelKey: null,
    section: null,
  };
}
