import { describe, expect, it } from '@jest/globals';

import { canAutoApproveTool, isLegacyChatOnlyTool } from '../toolExecutionPolicy';

describe('toolExecutionPolicy', () => {
  it('Bypass mode auto-approves normal project-scoped tools', () => {
    // Read / write / shell / terminal all auto-approve in Bypass.
    expect(canAutoApproveTool('bypass', 'read_file')).toBe(true);
    expect(canAutoApproveTool('bypass', 'write_file')).toBe(true);
    expect(canAutoApproveTool('bypass', 'execute_command')).toBe(true);
    expect(canAutoApproveTool('bypass', 'run_in_terminal')).toBe(true);
  });

  it('Bypass mode still requires confirmation for SSH / MCP / agent tools', () => {
    // These tool families target remote systems or external surfaces
    // that the hard safety hooks cannot generically classify as safe,
    // so the user-facing permission gate stays in place even in Bypass.
    expect(canAutoApproveTool('bypass', 'ssh_exec')).toBe(false);
    expect(canAutoApproveTool('bypass', 'ssh_upload_file')).toBe(false);
    expect(canAutoApproveTool('bypass', 'ssh_exec', { source: 'autoresearch_phase' })).toBe(true);
    expect(canAutoApproveTool('bypass', 'ssh_upload_file', { source: 'autoresearch_phase' })).toBe(true);
    expect(canAutoApproveTool('bypass', 'mcp__filesystem__write_file')).toBe(false);
    expect(canAutoApproveTool('bypass', 'agent_tool')).toBe(false);
  });

  it('Bypass mode auto-approves browser tools', () => {
    // Browser tools auto-approve in Bypass mode for smooth browser automation.
    expect(canAutoApproveTool('bypass', 'browser_click')).toBe(true);
    expect(canAutoApproveTool('bypass', 'browser_navigate')).toBe(true);
  });

  it('routes registry-backed tools away from legacy execute_tool', () => {
    expect(isLegacyChatOnlyTool('read_file')).toBe(false);
    expect(isLegacyChatOnlyTool('write_file')).toBe(false);
    expect(isLegacyChatOnlyTool('execute_command')).toBe(false);
    expect(isLegacyChatOnlyTool('glob_search')).toBe(false);
  });

  it('keeps browser and typst tools on the legacy chat-only path', () => {
    expect(isLegacyChatOnlyTool('browser_click')).toBe(true);
    expect(isLegacyChatOnlyTool('compile_typst_file')).toBe(true);
    expect(isLegacyChatOnlyTool('Skill')).toBe(true);
  });

  it('keeps auto-edits limited to the safe allowlist', () => {
    expect(canAutoApproveTool('auto-edits', 'write_file')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'create_directory')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'get_current_workspace')).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'execute_command')).toBe(false);
    expect(canAutoApproveTool('auto-edits', 'ssh_read_file')).toBe(false);
  });

  it('auto-approves browser mutation tools in Agent mode when browser intent is explicit', () => {
    expect(canAutoApproveTool('auto-edits', 'browser_navigate', { browserIntent: true })).toBe(true);
    expect(canAutoApproveTool('auto-edits', 'browser_navigate', { browserIntent: false })).toBe(false);
    expect(canAutoApproveTool('auto-edits', 'execute_command', { browserIntent: true })).toBe(false);
  });
});
