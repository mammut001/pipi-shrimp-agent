import { describe, expect, it } from '@jest/globals';
import { buildAutoResearchToolCatalog } from '@/services/autoresearch/toolCatalog';

describe('buildAutoResearchToolCatalog', () => {
  it('returns only local tools in local mode', () => {
    expect(buildAutoResearchToolCatalog({ mode: 'local' })).toEqual([
      'get_current_workspace',
      'execute_command',
      'read_file',
      'write_file',
      'create_directory',
    ]);
  });

  it('returns only ssh tools in ssh mode', () => {
    expect(buildAutoResearchToolCatalog({ mode: 'ssh' })).toEqual([
      'get_current_workspace',
      'ssh_exec',
      'ssh_read_file',
      'ssh_upload_file',
    ]);
  });
});