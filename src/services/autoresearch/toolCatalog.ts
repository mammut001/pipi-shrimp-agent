import type { SshConfig } from '@/store/autoresearchStore';

type AutoResearchMode = Pick<SshConfig, 'mode'> | null | undefined;

export interface AutoResearchToolProfile {
  mode: 'local' | 'ssh';
  allowedTools: string[];
  commandTool: 'execute_command' | 'ssh_exec';
  readTool: 'read_file' | 'ssh_read_file';
  writeTool?: 'write_file';
  uploadTool?: 'ssh_upload_file';
}

function resolveMode(config?: AutoResearchMode): 'local' | 'ssh' {
  return config?.mode === 'local' ? 'local' : 'ssh';
}

export function buildAutoResearchToolCatalog(config?: AutoResearchMode): string[] {
  if (resolveMode(config) === 'local') {
    return [
      'get_current_workspace',
      'execute_command',
      'read_file',
      'write_file',
    ];
  }

  return [
    'get_current_workspace',
    'ssh_exec',
    'ssh_read_file',
    'ssh_upload_file',
  ];
}

export function getAutoResearchToolProfile(config?: AutoResearchMode): AutoResearchToolProfile {
  if (resolveMode(config) === 'local') {
    return {
      mode: 'local',
      allowedTools: buildAutoResearchToolCatalog({ mode: 'local' }),
      commandTool: 'execute_command',
      readTool: 'read_file',
      writeTool: 'write_file',
    };
  }

  return {
    mode: 'ssh',
    allowedTools: buildAutoResearchToolCatalog({ mode: 'ssh' }),
    commandTool: 'ssh_exec',
    readTool: 'ssh_read_file',
    uploadTool: 'ssh_upload_file',
  };
}

export function formatAutoResearchToolCatalog(config?: AutoResearchMode): string {
  return buildAutoResearchToolCatalog(config).join(', ');
}