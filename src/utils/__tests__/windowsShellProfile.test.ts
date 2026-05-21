import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  applyWindowsShellProfileToArgsJson,
  convertWindowsPathToWsl,
  detectPathKind,
  resolveWindowsShellProfile,
  withWindowsShellProfileArgs,
} from '@/utils/windowsShellProfile';

describe('windowsShellProfile utilities', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        platform: 'Win32',
        userAgent: 'Windows NT 10.0',
      },
      configurable: true,
    });
  });

  it('resolves Auto to PowerShell for Windows paths', () => {
    expect(resolveWindowsShellProfile('auto', 'C:\\Users\\Payton\\project')).toMatchObject({
      isWindows: true,
      resolved: 'powershell',
      pathKind: 'windows',
    });
  });

  it('resolves Auto to WSL for WSL paths', () => {
    expect(resolveWindowsShellProfile('auto', '/home/payton/project')).toMatchObject({
      isWindows: true,
      resolved: 'wsl',
      pathKind: 'wsl',
    });
  });

  it('detects WSL UNC paths and converts Windows paths', () => {
    expect(detectPathKind('\\\\wsl$\\Ubuntu\\home\\payton\\project')).toBe('wsl');
    expect(convertWindowsPathToWsl('C:\\Users\\Payton\\project')).toBe('/mnt/c/Users/Payton/project');
    expect(convertWindowsPathToWsl('\\\\wsl$\\Ubuntu\\home\\payton\\project')).toBe('/home/payton/project');
  });

  it('injects windowsShellProfile into execute_command args only', () => {
    expect(withWindowsShellProfileArgs('read_file', { path: 'README.md' }, 'wsl')).toEqual({
      path: 'README.md',
    });
    expect(withWindowsShellProfileArgs('execute_command', { command: 'npm test' }, 'wsl')).toEqual({
      command: 'npm test',
      windowsShellProfile: 'wsl',
    });
    expect(
      applyWindowsShellProfileToArgsJson('execute_command', '{"command":"npm test"}', 'powershell'),
    ).toBe('{"command":"npm test","windowsShellProfile":"powershell"}');
  });
});
