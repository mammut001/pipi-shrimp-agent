import { AutoResearchBootstrapResultSchema, BootstrapPlanSchema } from '@/services/autoresearch/bootstrap/schema';
import type { AutoResearchBootstrapResult, BootstrapPlan } from '@/services/autoresearch/bootstrap/types';

export function finalizeBootstrapPlan(
  planInput: BootstrapPlan,
  createdAt = new Date().toISOString(),
): AutoResearchBootstrapResult {
  const plan = BootstrapPlanSchema.parse(planInput);
  const unresolvedQuestions: string[] = [];
  const warnings: string[] = [];

  if (plan.baselines.length < 1) {
    warnings.push('Keep at least one baseline before starting AutoResearch.');
  }
  if (plan.successCriteria.trim().length < 5) {
    warnings.push('Success criteria must be quantitative.');
  }
  if (!plan.gitInitialized) {
    warnings.push('Git initialization did not complete. The bootstrap can continue without it.');
  }

  const result: AutoResearchBootstrapResult = {
    status: unresolvedQuestions.length === 0 ? 'ready' : 'needs_user_confirmation',
    plan,
    warnings,
    unresolvedQuestions,
    createdAt,
    schemaVersion: 1,
  };

  return AutoResearchBootstrapResultSchema.parse(result);
}