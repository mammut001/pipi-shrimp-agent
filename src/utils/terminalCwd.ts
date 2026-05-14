import { safeInvokeOrNull } from '@/utils/safeInvoke';

export async function resolveFallbackTerminalCwd(): Promise<string | undefined> {
  if (!import.meta.env.DEV) {
    return undefined;
  }

  const projectRoot = await safeInvokeOrNull<string>('get_project_root', {}, {
    source: 'terminal.resolveProjectRoot',
  });
  return projectRoot || undefined;
}
