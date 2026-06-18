import { describe, expect, it } from '@jest/globals';

import { canAutoApproveTool } from '../toolExecutionPolicy';

describe('toolExecutionPolicy', () => {
  it('Bypass mode auto-approves normal project-scoped tools', () => {
    // Read / write / shell / terminal all auto-approve in Bypass.
    expect(canAutoApproveTool('bypass', 'read_file')).toBe(true);
    expect(canAutoApproveTool('bypass', 'write_file')).toBe(true);
    expect(canAutoApproveTool('bypass', 'execute_command')).toBe(true);
    expect(canAutoApproveTool('bypass', 'run_in_terminal')).toBe(true);
  });

  it('Bypass mode still requires confirmation for SSH / MCP / browser / agent tools', () => {
    // These tool families target remote systems or external surfaces
    // that the hard safety hooks cannot generically classify as safe,
    // so the user-facing permission gate stays in place even in Bypass.
    expect(canAutoApproveTool('bypass', 'ssh_exec')).toBe(false);
    expect(canAutoApproveTool('bypass', 'ssh_upload_file')).toBe(false);
    expect(canAutoApproveTool('bypass', 'mcp__filesystem__write_file')).toBe(false);
    expect(canAutoApproveTool('bypass', 'browser_click')).toBe(false);
    expect(canAutoApproveTool('bypass', 'browser_navigate')).toBe(false);
    expect(canAutoApproveTool('bypass', 'agent_tool')).toBe(false);
  });

  it('keeps auto-edits limited to the safe allowlist', () => {
    expect(canAutoApproveTool('auto-edits', 'write_file')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'create_directory')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'get_current_workspace')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'execute_command')).toBe(false);
    expect(canAutoApproveTool('auto-edits', 'ssh_read_file')).toBe(false);
  });
});
