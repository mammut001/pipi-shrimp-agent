import type { ComposerBlock } from './types';

interface PromptContext {
  projectFolder?: string;
  pipiOutputDir?: string;
  contextFiles?: string[];
}

export function buildPromptFromBlocks(blocks: ComposerBlock[], context?: PromptContext): string {
  const parts: string[] = [];

  parts.push('# TASK SPECIFICATION');

  // Process blocks in the order they are stored/reordered
  for (const block of blocks) {
    switch (block.type) {
      case 'intent': {
        const intentLabels: Record<string, string> = {
          question: 'Ask a Question',
          plan: 'Make a Plan',
          debug: 'Debug a Bug',
          implement: 'Implement Feature',
          refactor: 'Refactor Code',
          test: 'Write Tests',
          document: 'Write Documentation',
          run_command: 'Run Command',
          autoresearch: 'AutoResearch Task',
        };

        const detailsStr = block.detail.trim() ? `\n- **Goal/Details**: ${block.detail.trim()}` : '';
        parts.push(`## INTENT\n- **Type**: ${intentLabels[block.intentType] || block.intentType}${detailsStr}`);
        break;
      }

      case 'mode': {
        const modeId = block.executionMode;
        let instruction = '';
        if (modeId === 'ask') {
          instruction = 'Answer directly. Do not use tools.';
        } else if (modeId === 'plan') {
          instruction = 'Inspect read-only if needed. Do not edit files or run commands. Produce a structured plan.';
        } else if (modeId === 'debug') {
          instruction = 'Reproduce → diagnose → minimal fix → verify.';
        } else if (modeId === 'agent') {
          instruction = 'Implement normally. Ask for risky/out-of-scope actions.';
        } else if (modeId === 'bypass') {
          instruction = 'Proceed with normal project-scoped tools without repeated approvals, but hard safety checks still apply.';
        }

        parts.push(`## EXECUTION MODE\n- **Mode**: ${modeId.toUpperCase()}\n- **Instruction**: ${instruction}`);
        break;
      }

      case 'context': {
        const contextParts: string[] = [];
        
        // Scope
        const scopeLabels: Record<string, string> = {
          whole_project: 'Whole Project',
          selected_files: 'Selected Files/Paths',
          current_folder: 'Current Folder',
          manual_paths: 'Manual Paths/Symbols',
        };
        contextParts.push(`- **Scope**: ${scopeLabels[block.scope] || block.scope}`);

        // Folder structure (strict matching rules)
        const projFolder = block.projectFolder || context?.projectFolder;
        if (projFolder) {
          contextParts.push(`- **Project Folder (Source/Code/CWD)**: ${projFolder}`);
        }

        const outputFolder = context?.pipiOutputDir;
        if (outputFolder) {
          contextParts.push(`- **PiPi Output Folder (Outputs/Artifacts/Docs)**: ${outputFolder}`);
        }

        // Context references
        const refFiles = block.contextFiles || context?.contextFiles;
        if (refFiles && refFiles.length > 0) {
          contextParts.push(`- **Context Files (References)**: ${refFiles.join(', ')}`);
        }

        if (block.paths.length > 0) {
          contextParts.push(`- **Target Paths**: ${block.paths.join(', ')}`);
        }
        if (block.symbols.length > 0) {
          contextParts.push(`- **Target Symbols**: ${block.symbols.join(', ')}`);
        }
        if (block.notes?.trim()) {
          contextParts.push(`- **Context Notes**: ${block.notes.trim()}`);
        }

        if (contextParts.length > 0) {
          parts.push(`## CONTEXT\n${contextParts.join('\n')}`);
        }
        break;
      }

      case 'constraints': {
        const constraintParts: string[] = [];
        if (block.readOnly) {
          constraintParts.push('- **Read-Only Mode**: Do not make any edits or modify files. Analysis only.');
        }
        if (block.noBroadRefactor) {
          constraintParts.push('- **No Broad Refactoring**: Keep edits minimal and localized. Do not refactor surrounding code broadly.');
        }
        if (block.preservePublicApi) {
          constraintParts.push('- **Preserve Public API**: Preserve the existing public API signatures and types.');
        }
        if (block.noDestructiveCommands) {
          constraintParts.push('- **No Destructive Commands**: Do not run destructive commands (e.g. delete files, drop tables).');
        }
        if (block.maxFiles && block.maxFiles > 0) {
          constraintParts.push(`- **File Edit Limit**: Restrict changes to at most ${block.maxFiles} files.`);
        }
        if (block.maxToolRounds && block.maxToolRounds > 0) {
          constraintParts.push(`- **Efficiency Target**: Limit execution to at most ${block.maxToolRounds} tool interaction rounds.`);
        }
        if (block.language?.trim()) {
          constraintParts.push(`- **Language/Style**: ${block.language.trim()}`);
        }
        if (block.customConstraints && block.customConstraints.length > 0) {
          block.customConstraints.forEach((c) => {
            if (c.trim()) constraintParts.push(`- **Constraint**: ${c.trim()}`);
          });
        }

        if (constraintParts.length > 0) {
          parts.push(`## CONSTRAINTS\n${constraintParts.join('\n')}`);
        }
        break;
      }

      case 'output': {
        const outputParts: string[] = [];
        
        const typeLabels: Record<string, string> = {
          answer: 'Direct Answer / Explanation',
          plan: 'Structured Plan Document',
          patch: 'Code Patch (Diff)',
          test_report: 'Test execution / verification report',
          release_notes: 'Changelog / Release Notes',
          checklist: 'Post-implementation checklist',
          docs: 'Technical Documentation',
        };
        outputParts.push(`- **Primary Deliverable**: ${typeLabels[block.outputType] || block.outputType}`);

        if (block.includeFilesChanged) {
          outputParts.push('- **Requirement**: Provide a summary of all files changed.');
        }
        if (block.includeCommandsRun) {
          outputParts.push('- **Requirement**: List all commands executed during the task.');
        }
        if (block.includeRemainingRisks) {
          outputParts.push('- **Requirement**: Highlight any remaining risks or potential side-effects.');
        }
        if (block.includeManualQA) {
          outputParts.push('- **Requirement**: Include manual QA validation steps.');
        }
        if (block.customOutput?.trim()) {
          outputParts.push(`- **Details**: ${block.customOutput.trim()}`);
        }

        if (outputParts.length > 0) {
          parts.push(`## EXPECTED OUTPUT\n${outputParts.join('\n')}`);
        }
        break;
      }

      case 'verification': {
        const verifyParts: string[] = [];
        if (block.requireBuild) {
          verifyParts.push('- Ensure the project builds cleanly after changes.');
        }
        if (block.requireTests) {
          verifyParts.push('- Run the test suite to verify correctness.');
        }
        if (block.requireTypecheck) {
          verifyParts.push('- Verify there are no TypeScript compiler / typecheck errors.');
        }
        if (block.requireI18nCheck) {
          verifyParts.push('- Ensure all i18n keys are correctly synchronized.');
        }
        if (block.commands.length > 0) {
          block.commands.forEach((cmd) => {
            verifyParts.push(`- Execute verification command: \`${cmd}\``);
          });
        }
        if (block.customVerification?.trim()) {
          verifyParts.push(`- Custom Verification: ${block.customVerification.trim()}`);
        }

        if (verifyParts.length > 0) {
          parts.push(`## VERIFICATION STEPS\n${verifyParts.join('\n')}`);
        }
        break;
      }

      case 'safety': {
        const safetyParts: string[] = [];
        
        const modeLabels: Record<string, string> = {
          ask_on_risky: 'Prompt for approval on risky actions',
          no_destructive: 'Strictly prohibit destructive actions',
          bypass_normal_tools: 'Bypass approvals for normal tools (trust mode)',
        };
        safetyParts.push(`- **Approval Rule**: ${modeLabels[block.approvalMode] || block.approvalMode}`);

        if (block.forbiddenActions.length > 0) {
          block.forbiddenActions.forEach((act) => {
            if (act.trim()) safetyParts.push(`- **Prohibited Action**: ${act.trim()}`);
          });
        }

        const confirmBeforeItems: string[] = [];
        if (block.confirmBefore.delete) confirmBeforeItems.push('deleting files');
        if (block.confirmBefore.network) confirmBeforeItems.push('network requests');
        if (block.confirmBefore.external_write) confirmBeforeItems.push('writes outside workspace');
        if (block.confirmBefore.dependency_install) confirmBeforeItems.push('installing packages');

        if (confirmBeforeItems.length > 0) {
          safetyParts.push(`- **Confirm before**: ${confirmBeforeItems.join(', ')}`);
        }

        if (safetyParts.length > 0) {
          parts.push(`## SAFETY RULES\n${safetyParts.join('\n')}`);
        }
        break;
      }
    }
  }

  // Always append general rules at the end
  parts.push(
    `## GENERAL RULES\n- Do not claim files changed unless you changed them.\n- In Plan mode, read-only only.\n- In Ask mode, answer without tools.\n- In Bypass mode, normal project tools may run, but hard safety still applies.`
  );

  return parts.join('\n\n');
}
