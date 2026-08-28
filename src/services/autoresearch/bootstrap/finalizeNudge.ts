/**
 * Pure helpers for AutoResearch guided bootstrap finalize requirement.
 * Used by BootstrapChatView and unit-tested without UI/headless mocks.
 */

export const BOOTSTRAP_FINALIZE_HARD_REQUIREMENT = `## HARD REQUIREMENT: bootstrap_finalize
- You MUST end this bootstrap by calling the tool \`bootstrap_finalize\` with a complete ready plan.
- Do not end with only prose, a summary, or a plan in markdown.
- If scaffold, metric, baseline, or workDir are still missing, call the remaining tools first, then \`bootstrap_finalize\`.
- Preferred last action of the turn: \`bootstrap_finalize\` with status="ready".`;

/** User message injected for a second headless turn when the first omitted finalize. */
export const BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE =
  'STOP and call bootstrap_finalize now. '
  + 'The only allowed tool in this turn is bootstrap_finalize. '
  + 'Do not call scaffold_generate, git_init_workdir, arxiv_search, or any other tool. '
  + 'Do not create a new folder. Do not invent a medical, UNet, or any other project. '
  + 'Reuse the recipe workDir, metric, baseline, and goal already provided. '
  + 'If something is missing, still call bootstrap_finalize with the best complete plan and list gaps in unresolvedQuestions.';

export const BOOTSTRAP_FINALIZE_NUDGE_ALLOWED_TOOLS = ['bootstrap_finalize'] as const;

export function buildBootstrapFinalizeNudgeUserMessage(workDir?: string): string {
  const trimmed = workDir?.trim();
  if (!trimmed) {
    return BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE;
  }
  return `${BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE} The scaffold.workDir MUST be "${trimmed}".`;
}

export function shouldRunBootstrapFinalizeNudge(
  readyResult: { status?: string } | null | undefined,
): boolean {
  return !readyResult || readyResult.status !== 'ready';
}

/**
 * Append the hard finalize requirement to the bootstrap system prompt once.
 */
export function buildBootstrapSystemPromptWithFinalizeRequirement(baseSystemPrompt: string): string {
  const base = baseSystemPrompt.trimEnd();
  if (base.includes('HARD REQUIREMENT: bootstrap_finalize')) {
    return base;
  }
  return `${base}\n\n${BOOTSTRAP_FINALIZE_HARD_REQUIREMENT}`;
}
