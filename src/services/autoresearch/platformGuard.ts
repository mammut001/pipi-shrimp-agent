import { useAutoResearchStore } from '@/store/autoresearchStore';

const SUPPORTED_PLATFORMS = new Set(['macos', 'linux']);

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
  try {
    const moduleName = '@tauri-apps/api/os';
    const api = await import(moduleName);
    if (typeof api.platform === 'function') {
      return String(await api.platform());
    }
  } catch {
    // Fall through to browser platform detection. Tauri v2 no longer ships
    // this module in every app setup, but AutoResearch still needs a guard.
  }
  return fallbackPlatform();
}

export async function assertSupportedPlatform(): Promise<void> {
  const current = await resolvePlatform();
  if (!SUPPORTED_PLATFORMS.has(current)) {
    throw new Error('AutoResearch supports macOS and Linux only');
  }
}

export function setAutoResearchPlatformError(message: string): void {
  useAutoResearchStore.getState().setError(message);
}
