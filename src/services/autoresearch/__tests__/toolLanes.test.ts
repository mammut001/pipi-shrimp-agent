import { describe, expect, it } from '@jest/globals';

import {
  buildAutoResearchToolLaneError,
  classifyAutoResearchToolPhase,
  getAutoResearchAllowedToolsForPhase,
  isAutoResearchToolLaneTransitionAllowed,
} from '@/services/autoresearch/toolLanes';

describe('toolLanes', () => {
  it('narrows allowed tools by phase and execution target', () => {
    expect(getAutoResearchAllowedToolsForPhase({ mode: 'local' }, 'READ_CONTEXT')).toEqual([
      'get_current_workspace',
      'read_file',
    ]);
    expect(getAutoResearchAllowedToolsForPhase({ mode: 'local' }, 'EDIT_CODE')).toEqual([
      'get_current_workspace',
      'execute_command',
      'read_file',
      'write_file',
    ]);
    expect(getAutoResearchAllowedToolsForPhase({ mode: 'ssh' }, 'RUN_EXPERIMENT')).toEqual([
      'get_current_workspace',
      'ssh_exec',
      'ssh_read_file',
    ]);
  });

  it('blocks backward transitions once the iteration reaches parsing', () => {
    expect(classifyAutoResearchToolPhase({
      currentPhase: 'READ_CONTEXT',
      toolName: 'write_file',
      isExperimentRun: false,
      config: { mode: 'local' },
    })).toBe('EDIT_CODE');

    expect(classifyAutoResearchToolPhase({
      currentPhase: 'RUN_EXPERIMENT',
      toolName: 'read_file',
      isExperimentRun: false,
      config: { mode: 'local' },
    })).toBe('PARSE_METRICS');

    expect(isAutoResearchToolLaneTransitionAllowed('RUN_EXPERIMENT', 'PARSE_METRICS')).toBe(true);
    expect(isAutoResearchToolLaneTransitionAllowed('PARSE_METRICS', 'EDIT_CODE')).toBe(false);
    expect(buildAutoResearchToolLaneError('write_file', 'PARSE_METRICS', ['get_current_workspace', 'read_file'])).toContain('write_file');
  });
});