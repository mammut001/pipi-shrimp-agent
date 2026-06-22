export const PLACEHOLDER_GOALS = [
  'I want to start an AutoResearch task. Please guide me through setting up goals, papers, baselines, and workspace scaffolding.',
  'I want to fully reproduce a paper. Please help me identify the paper claims, lock baselines, target primary metric, and construct scaffold files.',
  'I want to exceed an existing baseline on a known task. Please propose improvements, keep evaluations fair, and setup experiment workspace.',
  'I want to conduct ablation studies on an existing model or method. Please help me isolate ablation parameters, verify metrics, and bootstrap scaffolding.',
  'I want to start a brand new AutoResearch project from scratch. Please propose a concrete research objective and scaffold the project workspace.'
];

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
