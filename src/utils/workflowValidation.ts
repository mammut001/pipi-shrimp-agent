/**
 * Workflow Operations Validation Helper
 *
 * Utility functions to validate workflow CRUD operations and state consistency.
 * Use these for manual QA testing of workflow rename/delete/select functionality.
 */

import { useWorkflowStore } from '../store/workflowStore';
import { invoke } from '@tauri-apps/api/core';

export interface WorkflowValidation {
  isValid: boolean;
  issues: string[];
  recommendations: string[];
}

/**
 * Validate workflow store state consistency.
 */
export function validateWorkflowState(): WorkflowValidation {
  const state = useWorkflowStore.getState();
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check selected run exists
  if (state.selectedRunId) {
    const selected = state.workflowRuns.find(r => r.id === state.selectedRunId);
    if (!selected) {
      issues.push(`Selected run ${state.selectedRunId} not found in workflowRuns list`);
      recommendations.push('Clear selectedRunId when run is deleted');
    }
  }

  // Check for duplicate IDs
  const ids = state.workflowRuns.map(r => r.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    issues.push(`Duplicate workflow run IDs found: ${duplicates.join(', ')}`);
    recommendations.push('Ensure unique IDs when creating runs');
  }

  // Check run titles are not empty
  const emptyTitles = state.workflowRuns.filter(r => !r.title.trim());
  if (emptyTitles.length > 0) {
    issues.push(`${emptyTitles.length} runs have empty titles`);
    recommendations.push('Validate run titles on creation/update');
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}

/**
 * Validate workflow filesystem consistency.
 * Checks that run directories exist for runs that have them.
 */
export async function validateWorkflowFilesystem(): Promise<WorkflowValidation> {
  const state = useWorkflowStore.getState();
  const issues: string[] = [];
  const recommendations: string[] = [];

  for (const run of state.workflowRuns) {
    if (run.runDirectory) {
      try {
        await invoke('read_dir', { path: run.runDirectory });
      } catch (error) {
        issues.push(`Run "${run.title}" directory missing: ${run.runDirectory}`);
        recommendations.push('Ensure run directories are created when runs are created');
      }
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}

/**
 * Test workflow rename operation.
 * Renames the first run temporarily, validates, then restores.
 */
export async function testWorkflowRename(): Promise<WorkflowValidation> {
  const store = useWorkflowStore.getState();
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (store.workflowRuns.length === 0) {
    issues.push('No workflow runs to test rename');
    return { isValid: false, issues, recommendations };
  }

  const originalRun = store.workflowRuns[0];
  const originalTitle = originalRun.title;
  const tempTitle = `Rename Test ${Date.now()}`;

  try {
    // Rename
    store.renameWorkflowRun(originalRun.id, tempTitle);
    const renamed = store.workflowRuns.find(r => r.id === originalRun.id);

    // Validate rename
    if (!renamed) {
      issues.push('Run disappeared after rename');
      recommendations.push('Ensure run remains in list after rename');
    } else if (renamed.title !== tempTitle) {
      issues.push(`Rename failed: expected "${tempTitle}", got "${renamed.title}"`);
      recommendations.push('Update run title in store during rename');
    }

    // Check filesystem (if run has a directory)
    if (originalRun.runDirectory) {
      const fsValidation = await validateWorkflowFilesystem();
      issues.push(...fsValidation.issues);
      recommendations.push(...fsValidation.recommendations);
    }

    // Restore original name
    store.renameWorkflowRun(originalRun.id, originalTitle);

  } catch (error) {
    issues.push(`Workflow rename test failed: ${error}`);
    recommendations.push('Fix rename operation implementation');
    // Attempt to restore
    try { store.renameWorkflowRun(originalRun.id, originalTitle); } catch { /* ignore */ }
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}

/**
 * Test workflow delete operation.
 * Creates a run via addWorkflowRun, deletes it, checks cleanup.
 */
export async function testWorkflowDelete(): Promise<WorkflowValidation> {
  const store = useWorkflowStore.getState();
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Create a test run using addWorkflowRun
  const testId = `test-run-${Date.now()}`;
  const testTitle = 'Test Run Delete';

  try {
    store.addWorkflowRun({
      id: testId,
      title: testTitle,
      projectGoal: 'Test goal',
      status: 'idle',
      startTime: Date.now(),
      agents: [],
    });

    const created = store.workflowRuns.find(r => r.id === testId);
    if (!created) {
      issues.push('Failed to create test run for deletion');
      return { isValid: false, issues, recommendations };
    }

    // Delete run
    store.deleteWorkflowRun(testId);

    // Validate deletion
    const stillExists = store.workflowRuns.find(r => r.id === testId);
    if (stillExists) {
      issues.push('Run still exists in store after deletion');
      recommendations.push('Remove run from store during delete');
    }

    // Check filesystem cleanup
    const fsValidation = await validateWorkflowFilesystem();
    issues.push(...fsValidation.issues);
    recommendations.push(...fsValidation.recommendations);

  } catch (error) {
    issues.push(`Workflow delete test failed: ${error}`);
    recommendations.push('Fix delete operation implementation');
    // Cleanup
    try { store.deleteWorkflowRun(testId); } catch { /* ignore */ }
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}

/**
 * Log workflow state for debugging.
 */
export function logWorkflowState(): void {
  const state = useWorkflowStore.getState();
  console.group('Workflow State Debug');
  console.log('Selected Run:', state.selectedRunId);
  console.log('Runs:', state.workflowRuns.map(r => `${r.id}: ${r.title} (${r.runDirectory || 'no dir'})`));
  console.log('Is Running:', state.isRunning, '| Agent:', state.currentRunningAgentId);
  console.groupEnd();

  const validation = validateWorkflowState();
  if (!validation.isValid) {
    console.warn('State Issues:', validation.issues);
    console.info('Recommendations:', validation.recommendations);
  }
}

// Make available globally for console debugging
if (typeof window !== 'undefined') {
  (window as any).validateWorkflowState = validateWorkflowState;
  (window as any).validateWorkflowFilesystem = validateWorkflowFilesystem;
  (window as any).testWorkflowRename = testWorkflowRename;
  (window as any).testWorkflowDelete = testWorkflowDelete;
  (window as any).logWorkflowState = logWorkflowState;
}