import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store/settingsStore';
import { resolveWindowsShellProfile } from '@/utils/windowsShellProfile';

const SUPPORTED_PLATFORMS = new Set(['macos', 'linux']);
type AutoResearchPlatformTarget = Pick<SshConfig, 'mode' | 'remoteWorkDir' | 'authMode'>;

function fallbackPlatform(): string {
  const platformValue = typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '';
  if (platformValue.includes('mac')) {
    return 'macos';
  }
  if (platformValue.includes('linux')) {
    return 'linux';
  }
  if (platformValue.includes('win')) {
    return 'windows';
  }
  return platformValue || 'unknown';
}

export async function resolvePlatform(): Promise<string> {
  return fallbackPlatform();
}

function buildWindowsSupportMessage(target?: AutoResearchPlatformTarget): string {
  if (target?.mode === 'ssh' && target.authMode === 'password') {
    return 'AutoResearch on Windows requires the Terminal shell profile to be WSL when using SSH password auth.';
  }

  return 'AutoResearch on Windows requires the Terminal shell profile to be WSL for local runs. SSH password auth also requires WSL. Open Settings -> Terminal and switch the Windows shell profile to WSL.';
}

export async function assertSupportedPlatform(target?: AutoResearchPlatformTarget): Promise<void> {
  const current = await resolvePlatform();
  if (SUPPORTED_PLATFORMS.has(current)) {
    return;
  }

  if (current !== 'windows') {
    throw new Error('AutoResearch supports macOS and Linux only');
  }

  const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;
  const shellResolution = resolveWindowsShellProfile(windowsShellProfile, target?.remoteWorkDir);

  if (target?.mode === 'ssh') {
    if (target.authMode === 'password' && shellResolution.resolved !== 'wsl') {
      throw new Error(buildWindowsSupportMessage(target));
    }
    return;
  }

  if (shellResolution.resolved === 'wsl') {
    return;
  }

  throw new Error(buildWindowsSupportMessage(target));
}

export function setAutoResearchPlatformError(message: string): void {
  useAutoResearchStore.getState().setError(message);
}
