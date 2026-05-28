import { safeInvokeOrNull } from '@/utils/safeInvoke';

export async function resolveFallbackTerminalCwd(): Promise<string | undefined> {
  if (process.env.NODE_ENV !== 'development') {
    return undefined;
  }

  const projectRoot = await safeInvokeOrNull<string>('get_project_root', {}, {
    source: 'terminal.resolveProjectRoot',
  });
  return projectRoot || undefined;
}
