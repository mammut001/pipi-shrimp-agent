import { describe, expect, it } from '@jest/globals';
import {
  buildToolBatchFailureHint,
  isPolicyToolFailureText,
  isRecoverableToolFailureText,
  isToolFailureText,
  shouldShortCircuitFailedToolBatch,
} from '../toolFailureClassification';

describe('toolFailureClassification', () => {
  it('detects generic tool failure prefixes', () => {
    expect(isToolFailureText('Error: something went wrong')).toBe(true);
    expect(isToolFailureText('permission denied')).toBe(true);
    expect(isToolFailureText('README contents')).toBe(false);
  });

  it('classifies policy and lane violations', () => {
    expect(isPolicyToolFailureText(
      'Error: Tool execution is disabled in Ask mode. Switch to Plan or Danger to run tools.',
    )).toBe(true);
    expect(isPolicyToolFailureText('Error: Blocked: Attempting to delete root filesystem')).toBe(true);
    expect(isPolicyToolFailureText('Error: Permission denied')).toBe(true);
    expect(isPolicyToolFailureText('Error: 权限已拒绝')).toBe(true);
    expect(isPolicyToolFailureText('Error: This tool is not allowed in Plan mode (read-only inspection and plan docs only).')).toBe(true);
    expect(isPolicyToolFailureText('Error: outside the allowed tool lane')).toBe(true);
  });

  it('treats missing files and bad arguments as recoverable operational failures', () => {
    const missingReadme = "Error: Failed to read file '/tmp/FocusApp/README.md': os error 2";
    expect(isPolicyToolFailureText(missingReadme)).toBe(false);
    expect(isRecoverableToolFailureText(missingReadme)).toBe(true);

    expect(isRecoverableToolFailureText("Error: Failed to read 'NOTICE.md': not found")).toBe(true);
    expect(isRecoverableToolFailureText('Error: invalid tool arguments')).toBe(true);
    expect(isRecoverableToolFailureText("Error: Missing 'path' argument for write_file")).toBe(true);
  });

  it('does not treat contextual permission errors as policy blocks', () => {
    const contextual = "Error: Failed to read '../secret.txt': permission denied";
    expect(isPolicyToolFailureText(contextual)).toBe(false);
    expect(isRecoverableToolFailureText(contextual)).toBe(true);
  });

  it('recognizes structured JSON tool failures', () => {
    const structured = JSON.stringify({
      error: true,
      error_kind: 'not_found',
      message: 'No such file or directory (os error 2)',
      tool: 'read_file',
      cause: 'No such file or directory (os error 2)',
    });
    expect(isToolFailureText(structured)).toBe(true);
    expect(isRecoverableToolFailureText(structured)).toBe(true);
    expect(shouldShortCircuitFailedToolBatch([structured])).toBe(false);
  });

  it('treats out-of-scope path errors as recoverable operational failures', () => {
    const outOfScope = "Error: Failed to read file '../FocusApp/README.md': Access denied: path '../FocusApp/README.md' is outside the bound work directory '/tmp/project'";
    expect(isPolicyToolFailureText(outOfScope)).toBe(false);
    expect(shouldShortCircuitFailedToolBatch([outOfScope])).toBe(false);
  });

  it('builds mode-aware failure hints', () => {
    expect(buildToolBatchFailureHint('bypass')).toMatch(/路径|项目文件夹/);
    expect(buildToolBatchFailureHint('bypass')).not.toMatch(/Ask 模式/);
    expect(buildToolBatchFailureHint('ask')).toMatch(/问答/);
  });

  it('treats confirmation_required and dangerous_command as policy blocks', () => {
    const confirmationRequired = JSON.stringify({
      error: true,
      error_kind: 'confirmation_required',
      message: 'Tool "ssh_exec" requires confirmation before execution.',
      tool: 'ssh_exec',
      cause: 'Tool "ssh_exec" requires confirmation before execution.',
    });
    const dangerousCommand = JSON.stringify({
      error: true,
      error_kind: 'dangerous_command',
      message: 'Blocked: Attempting to delete root filesystem',
      tool: 'execute_command',
      cause: 'Blocked: Attempting to delete root filesystem',
    });

    expect(isPolicyToolFailureText(confirmationRequired)).toBe(true);
    expect(isRecoverableToolFailureText(confirmationRequired)).toBe(false);
    expect(isPolicyToolFailureText(dangerousCommand)).toBe(true);
    expect(isRecoverableToolFailureText(dangerousCommand)).toBe(false);
    expect(shouldShortCircuitFailedToolBatch([confirmationRequired])).toBe(true);
  });

  it('short-circuits only all-policy batches', () => {
    expect(shouldShortCircuitFailedToolBatch([
      'Error: Tool execution is disabled in Ask mode. Switch to Plan or Danger to run tools.',
      'Error: Blocked: Attempting to delete root filesystem',
    ])).toBe(true);

    expect(shouldShortCircuitFailedToolBatch([
      "Error: Failed to read file '/tmp/FocusApp/README.md': os error 2",
    ])).toBe(false);

    expect(shouldShortCircuitFailedToolBatch([
      'Error: Tool execution is disabled in Ask mode. Switch to Plan or Danger to run tools.',
      "Error: Failed to read file '/tmp/FocusApp/README.md': os error 2",
    ])).toBe(false);
  });
});