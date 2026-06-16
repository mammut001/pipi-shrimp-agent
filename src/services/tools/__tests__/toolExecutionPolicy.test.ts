import { describe, expect, it } from '@jest/globals';

import { canAutoApproveTool } from '../toolExecutionPolicy';

describe('toolExecutionPolicy', () => {
  it('keeps bypass mode away from high-risk execution tools', () => {
    expect(canAutoApproveTool('bypass', 'execute_command')).toBe(false);
    expect(canAutoApproveTool('bypass', 'ssh_exec')).toBe(false);
    expect(canAutoApproveTool('bypass', 'mcp__filesystem__write_file')).toBe(false);
    expect(canAutoApproveTool('bypass', 'browser_click')).toBe(false);
    expect(canAutoApproveTool('bypass', 'agent_tool')).toBe(false);
    expect(canAutoApproveTool('bypass', 'read_file')).toBe(true);
  });

  it('keeps auto-edits limited to the safe allowlist', () => {
    expect(canAutoApproveTool('auto-edits', 'write_file')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'create_directory')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'get_current_workspace')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'execute_command')).toBe(false);
    expect(canAutoApproveTool('auto-edits', 'ssh_read_file')).toBe(false);
  });
});
