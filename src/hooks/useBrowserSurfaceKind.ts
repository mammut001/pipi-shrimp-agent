import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useCdpStore } from '@/store/cdpStore';
import {
  resolveBrowserSurfaceKind,
  type BrowserSurfaceKind,
  type BrowserSurfaceSnapshot,
} from '@/utils/browserSurfaceKind';

export function useBrowserSurfaceSnapshot(): BrowserSurfaceSnapshot {
  const cdpStatus = useCdpStore((state) => state.status);
  const pendingTaskExecutionMode = useBrowserAgentStore((state) => state.pendingTask?.executionMode ?? null);
  const isWindowOpen = useBrowserAgentStore((state) => state.isWindowOpen);
  const presentationMode = useBrowserAgentStore((state) => state.presentationMode);

  return {
    cdpStatus,
    pendingTaskExecutionMode,
    isWindowOpen,
    presentationMode,
  };
}

export function useBrowserSurfaceKind(): BrowserSurfaceKind {
  return resolveBrowserSurfaceKind(useBrowserSurfaceSnapshot());
}