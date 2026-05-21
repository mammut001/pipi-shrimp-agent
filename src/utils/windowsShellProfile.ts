import type { WindowsShellProfile } from '@/types/settings';

export type WindowsShellPathKind = 'windows' | 'wsl' | 'unknown';

export interface WindowsShellResolution {
  isWindows: boolean;
  selection: WindowsShellProfile;
  resolved: 'powershell' | 'wsl' | 'default';
  pathKind: WindowsShellPathKind;
  reason: string;
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform = navigator.platform?.toLowerCase() ?? '';
  const userAgent = navigator.userAgent?.toLowerCase() ?? '';
  return platform.includes('win') || userAgent.includes('windows');
}

export function detectPathKind(input?: string | null): WindowsShellPathKind {
  const value = (input ?? '').trim();
  if (!value) return 'unknown';

  const lower = value.toLowerCase();
  if (lower.startsWith('\\\\wsl$\\') || lower.startsWith('\\\\wsl.localhost\\')) {
    return 'wsl';
  }
  if (value.startsWith('/')) {
    return 'wsl';
  }
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return 'windows';
  }
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    return 'windows';
  }
  return 'unknown';
}

export function resolveWindowsShellProfile(
  selection: WindowsShellProfile,
  workDir?: string | null,
  cwd?: string | null,
): WindowsShellResolution {
  const isWindows = isWindowsPlatform();
  const targetPath = (cwd ?? workDir ?? '').trim();
  const pathKind = detectPathKind(targetPath);

  if (!isWindows) {
    return {
      isWindows,
      selection,
      resolved: 'default',
      pathKind,
      reason: 'Non-Windows platform detected.',
    };
  }

  if (selection === 'powershell') {
    return {
      isWindows,
      selection,
      resolved: 'powershell',
      pathKind,
      reason: 'User selected PowerShell.',
    };
  }

  if (selection === 'wsl') {
    return {
      isWindows,
      selection,
      resolved: 'wsl',
      pathKind,
      reason: 'User selected WSL.',
    };
  }

  if (pathKind === 'wsl') {
    return {
      isWindows,
      selection,
      resolved: 'wsl',
      pathKind,
      reason: 'Auto-selected WSL for a WSL/Linux workspace path.',
    };
  }

  return {
    isWindows,
    selection,
    resolved: 'powershell',
    pathKind,
    reason: 'Auto-selected PowerShell for a Windows workspace path.',
  };
}

export function formatShellProfileLabel(resolution: WindowsShellResolution): string {
  if (!resolution.isWindows) {
    return 'Default shell';
  }
  const name = resolution.resolved === 'wsl' ? 'WSL' : 'PowerShell';
  const suffix = resolution.selection === 'auto' ? 'Auto' : 'Selected';
  return `${name} (${suffix})`;
}

export function convertWindowsPathToWsl(path: string): string | null {
  let value = path.trim();
  if (!value) return null;

  if (value.startsWith('\\\\?\\')) {
    value = value.slice(4);
  }

  const wslShareMatch = value.match(/^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)\\(.*)$/i);
  if (wslShareMatch) {
    const remainder = wslShareMatch[2];
    const converted = remainder.replace(/\\/g, '/');
    return `/${converted}`;
  }

  const driveMatch = value.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }

  if (value.startsWith('/')) {
    return value;
  }

  return null;
}

export function buildShellProfilePromptContext(input: {
  selection: WindowsShellProfile;
  workDir?: string | null;
  cwd?: string | null;
}): { shellProfileLabel: string; shellProfileGuidance: string } {
  const resolution = resolveWindowsShellProfile(input.selection, input.workDir, input.cwd);
  const label = formatShellProfileLabel(resolution);

  if (!resolution.isWindows) {
    return {
      shellProfileLabel: label,
      shellProfileGuidance: 'Non-Windows platform: keep the existing shell behavior for command execution.',
    };
  }

  if (resolution.resolved === 'powershell') {
    return {
      shellProfileLabel: label,
      shellProfileGuidance: [
        'Use PowerShell for Windows commands, npm/cargo workflows, and Tauri Windows builds.',
        'Use WSL only when the user explicitly selects WSL, the workspace is inside WSL, or the command requires a Unix shell.',
        'Do not mix PowerShell and WSL installs or build artifacts in the same workspace.',
      ].join(' '),
    };
  }

  return {
    shellProfileLabel: label,
    shellProfileGuidance: [
      'Use WSL for bash/Linux workflows.',
      'Windows Tauri builds should run in PowerShell unless the user explicitly chose WSL.',
      'Do not mix WSL and PowerShell installs or build artifacts in the same workspace.',
    ].join(' '),
  };
}

export function withWindowsShellProfileArgs(
  toolName: string,
  args: Record<string, unknown>,
  selection: WindowsShellProfile,
): Record<string, unknown> {
  if (toolName !== 'execute_command') {
    return args;
  }
  if (args.windowsShellProfile === selection) {
    return args;
  }
  return {
    ...args,
    windowsShellProfile: selection,
  };
}

export function applyWindowsShellProfileToArgsJson(
  toolName: string,
  rawArgs: string,
  selection: WindowsShellProfile,
): string {
  if (toolName !== 'execute_command') {
    return rawArgs;
  }
  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
    if (parsed.windowsShellProfile === selection) {
      return rawArgs;
    }
    return JSON.stringify({ ...parsed, windowsShellProfile: selection });
  } catch {
    return rawArgs;
  }
}
