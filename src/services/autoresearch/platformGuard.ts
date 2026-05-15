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
