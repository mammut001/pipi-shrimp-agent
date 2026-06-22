export interface Recipe {
  researchGoal: {
    goalText: string;
    taskType: 'reproduce_paper' | 'beat_baseline' | 'ablation' | 'from_scratch';
    source?: 'template' | 'user';
  };
  references: Record<string, never>; // Managed by importedFiles
  baselineAndMetric: {
    primaryMetric: string;
    direction: 'higher' | 'lower';
    baselineValue?: string;
    successCriteria?: string;
  };
  workspace: {
    workDir: string;
    folderName: string;
  };
  verification: {
    commands: string[];
  };
  outputContract: {
    includeMetrics: boolean;
    includeArtifacts: boolean;
    includeCommandsRun: boolean;
    includeFailureReason: boolean;
    includeRemainingRisks: boolean;
  };
}

interface PromptContext {
  projectFolder?: string;
  pipiOutputDir?: string;
  contextFiles?: string[];
}

export function buildBootstrapPromptFromRecipe(recipe: Recipe, context?: PromptContext): string {
  const parts: string[] = [];
  parts.push('# AUTORESEARCH BOOTSTRAP REQUEST');

  // 1. Research Goal
  parts.push(`## Research Goal
- **Task Type**: ${recipe.researchGoal.taskType}
- **Goal/Intent**: ${recipe.researchGoal.goalText.trim()}`);

  // 2. References
  const refFiles = context?.contextFiles || [];
  const refListStr = refFiles.length > 0
    ? refFiles.map((file) => `- Reference File: ${file}`).join('\n')
    : '- No attached reference files.';
  parts.push(`## References
${refListStr}
- **Instruction**: Read all attached references fully using appropriate tools (e.g. read_file or pdf_read) before summarizing or acting on their contents. Do not assume or invent details.`);

  // 3. Baseline & Metric
  const baselineValStr = recipe.baselineAndMetric.baselineValue ? `\n- **Baseline Value**: ${recipe.baselineAndMetric.baselineValue}` : '';
  const successCriteriaStr = recipe.baselineAndMetric.successCriteria ? `\n- **Success Criteria**: ${recipe.baselineAndMetric.successCriteria}` : '';
  parts.push(`## Baseline & Metric
- **Primary Metric**: ${recipe.baselineAndMetric.primaryMetric}
- **Direction**: Optimize towards ${recipe.baselineAndMetric.direction === 'higher' ? 'higher (maximize)' : 'lower (minimize)'} values.${baselineValStr}${successCriteriaStr}`);

  // 4. Workspace
  parts.push(`## Workspace
- **Workspace Dir**: ${recipe.workspace.workDir || 'Not specified'}
- **Scaffold Folder Name**: ${recipe.workspace.folderName || 'Not specified'}`);

  // 5. Verification
  const verifyCmds = recipe.verification.commands.length > 0
    ? recipe.verification.commands.map((cmd) => `- Verification command: \`${cmd}\``).join('\n')
    : '- No verification commands specified.';
  parts.push(`## Verification
${verifyCmds}`);

  // 6. Output Contract
  const contractParts: string[] = [];
  if (recipe.outputContract.includeMetrics) {
    contractParts.push('- Include evaluation metrics in the final summary.');
  }
  if (recipe.outputContract.includeArtifacts) {
    contractParts.push('- Include created artifacts list in the final report.');
  }
  if (recipe.outputContract.includeCommandsRun) {
    contractParts.push('- Log and list all execution/verification commands run.');
  }
  if (recipe.outputContract.includeFailureReason) {
    contractParts.push('- Document any failures and the root cause.');
  }
  if (recipe.outputContract.includeRemainingRisks) {
    contractParts.push('- Highlight remaining risks and future experiments proposed.');
  }
  if (contractParts.length === 0) {
    contractParts.push('- Produce standard final report summary.');
  }
  parts.push(`## Output Contract
${contractParts.join('\n')}`);

  return parts.join('\n\n');
}
