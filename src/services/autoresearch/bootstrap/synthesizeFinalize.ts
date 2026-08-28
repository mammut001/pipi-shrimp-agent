import type { Recipe } from '@/components/autoresearch/bootstrapRecipePrompt';
import { getKnownScaffoldTemplateManifest } from '@/services/tools/autoresearchBootstrap/tsTools/scaffoldGenerate';
import { finalizeBootstrapPlan } from '@/services/tools/autoresearchBootstrap/tsTools/bootstrapFinalize';
import type {
  AutoResearchBootstrapResult,
  ConversationalTemplateId,
  ScaffoldTemplateId,
} from './types';

export const HOST_SYNTHESIZED_BOOTSTRAP_FINALIZE_WARNING =
  'Host synthesized bootstrap_finalize from the guided recipe because the agent did not call the tool.';

function isUsableWorkDir(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 && trimmed !== '.' && trimmed !== './';
}

function mapTaskType(taskType: Recipe['researchGoal']['taskType']): ConversationalTemplateId {
  switch (taskType) {
    case 'beat_baseline':
      return 'beat-baseline';
    case 'ablation':
      return 'ablation';
    case 'from_scratch':
      return 'from-scratch';
    case 'reproduce_paper':
    default:
      return 'reproduce-paper';
  }
}

/**
 * Host finalize only reuses an explicit recipe/fallback workDir.
 * Do not join folderName onto a parent — that invents a new project path.
 */
export function resolveHostFinalizeWorkDir(
  recipe: Recipe,
  fallbackWorkDir?: string,
): string {
  if (isUsableWorkDir(recipe.workspace.workDir)) {
    return recipe.workspace.workDir.trim();
  }
  if (isUsableWorkDir(fallbackWorkDir)) {
    return fallbackWorkDir!.trim();
  }
  return '';
}

export function canSynthesizeBootstrapFinalize(recipe: Recipe, fallbackWorkDir?: string): boolean {
  return resolveHostFinalizeWorkDir(recipe, fallbackWorkDir).length > 0
    && recipe.researchGoal.goalText.trim().length > 0
    && recipe.baselineAndMetric.primaryMetric.trim().length > 0;
}

export function synthesizeBootstrapFinalizeFromRecipe(
  recipe: Recipe,
  fallbackWorkDir?: string,
): AutoResearchBootstrapResult | null {
  const workDir = resolveHostFinalizeWorkDir(recipe, fallbackWorkDir);
  if (!canSynthesizeBootstrapFinalize(recipe, fallbackWorkDir)) {
    return null;
  }

  const primaryMetric = recipe.baselineAndMetric.primaryMetric.trim();
  const successCriteria = (recipe.baselineAndMetric.successCriteria || '').trim()
    || `Improve ${primaryMetric} relative to the recipe baseline.`;
  const baselineValue = Number.parseFloat(recipe.baselineAndMetric.baselineValue || '');
  const templateId: ScaffoldTemplateId = 'python-ml-baseline';
  const manifest = getKnownScaffoldTemplateManifest(templateId);

  try {
    const result = finalizeBootstrapPlan({
      researchGoal: recipe.researchGoal.goalText.trim(),
      successCriteria,
      primaryMetric,
      secondaryMetrics: [],
      papers: [],
      baselines: [
        {
          name: 'recipe-baseline',
          task: recipe.researchGoal.taskType,
          dataset: 'user-provided',
          reportedMetrics: [
            {
              name: primaryMetric,
              value: Number.isFinite(baselineValue) && baselineValue >= 0 ? baselineValue : 0,
            },
          ],
          method: {
            summary: 'Baseline supplied by the guided recipe.',
          },
          reproducibility: {
            hasOfficialCode: false,
          },
        },
      ],
      scaffold: {
        templateId,
        workDir,
        language: manifest.language,
        entryCommand: manifest.entryCommand,
        vars: {
          project_name: recipe.workspace.folderName.trim() || 'autoresearch-bootstrap',
          research_goal: recipe.researchGoal.goalText.trim(),
          success_criteria: successCriteria,
          primary_metric: primaryMetric,
        },
        files: manifest.files.map((file) => ({
          path: file.output,
          purpose: file.purpose,
        })),
      },
      gitInitialized: true,
      conversationalTemplateId: mapTaskType(recipe.researchGoal.taskType),
    });
    return {
      ...result,
      warnings: [
        ...result.warnings,
        HOST_SYNTHESIZED_BOOTSTRAP_FINALIZE_WARNING,
      ],
    };
  } catch {
    return null;
  }
}
