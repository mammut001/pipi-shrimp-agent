/**
 * CDP Store - Manages Chrome DevTools Protocol connection state
 *
 * Independent Zustand store for CDP connection management.
 * Does not pollute browserAgentStore.
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

import { useBrowserObservabilityStore } from './browserObservabilityStore';

type CdpStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type AttachFailureReason =
  | 'chrome_needs_restart'
  | 'debug_port_unavailable'
  | 'connect_failed'
  | 'unknown';

let monitorRefCount = 0;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

export interface BrowserConnectionStatePayload {
  connected: boolean;
  launch_mode: string | null;
  health_status: string;
  health_failures: number;
  health_last_transition_at_ms: number;
  websocket_url: string | null;
  current_url: string | null;
  last_error: string | null;
  target_id: string | null;
  session_id: string | null;
  last_activity_at_ms: number;
  idle_timeout_ms: number;
}

interface CdpState {
  status: CdpStatus;
  errorMessage: string | null;
  connectionState: BrowserConnectionStatePayload | null;
  attachFailureReason: AttachFailureReason | null;
  lastSyncedAt: number | null;
  setupConnectionMonitor: () => () => void;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  launchChromeAndConnect: () => Promise<boolean>;
  syncConnectionState: () => Promise<BrowserConnectionStatePayload | null>;
}

const inferAttachFailureReason = (message: string | null): AttachFailureReason | null => {
  if (!message) {
    return null;
  }

  if (message.includes('CHROME_NEEDS_RESTART')) {
    return 'chrome_needs_restart';
  }

  if (message.includes('9222') || message.includes('调试端点') || message.includes('debugging endpoint')) {
    return 'debug_port_unavailable';
  }

  const lowerMessage = message.toLowerCase();
  // Check for various connection failure patterns
  if (
    lowerMessage.includes('connect') ||
    lowerMessage.includes('连接') ||
    lowerMessage.includes('connection refused') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('network unreachable') ||
    lowerMessage.includes('timed out')
  ) {
    return 'connect_failed';
  }

  return 'unknown';
};

const fetchConnectionState = async (): Promise<BrowserConnectionStatePayload | null> => {
  try {
    return await invoke<BrowserConnectionStatePayload>('get_browser_connection_state');
  } catch {
    return null;
  }
};

const toCdpStatus = (
  connectionState: BrowserConnectionStatePayload | null,
  previousStatus: CdpStatus,
): CdpStatus => {
  if (!connectionState) {
    return previousStatus === 'connecting' ? 'connecting' : 'disconnected';
  }

  if (connectionState.connected) {
    return 'connected';
  }

  if (connectionState.health_status === 'connecting' || connectionState.health_status === 'reconnecting') {
    return 'connecting';
  }

  if (previousStatus === 'connecting' && !connectionState.last_error) {
    return 'connecting';
  }

  if (connectionState.health_status === 'failed' || connectionState.last_error) {
    return 'error';
  }

  return 'disconnected';
};

export const useCdpStore = create<CdpState>((set, get) => {
  const runConnectAttempt = async ({
    recordCommand,
    transient,
  }: {
    recordCommand: boolean;
    transient: boolean;
  }): Promise<{ connected: boolean; errorMessage?: string }> => {
    const startedAt = Date.now();
    const observability = useBrowserObservabilityStore.getState();
    const commandId = recordCommand
      ? observability.startCommand({
          method: 'connect_browser',
          summary: transient ? 'Polling for Chrome debug endpoint' : 'Attach to existing Chrome debug target',
          source: 'frontend',
        })
      : null;

    try {
      await invoke('connect_browser');
      const connectionState = await get().syncConnectionState();
      set({
        status: 'connected',
        errorMessage: null,
        attachFailureReason: null,
        connectionState,
      });

      if (commandId) {
        observability.finishCommand(commandId, {
          status: 'success',
          durationMs: Date.now() - startedAt,
          source: 'frontend',
        });
      }

      return { connected: true };
    } catch (error) {
      const errorMessage = String(error);
      if (!transient) {
        set({
          status: 'error',
          errorMessage,
          attachFailureReason: inferAttachFailureReason(errorMessage),
        });
      }

      if (commandId) {
        observability.finishCommand(commandId, {
          status: 'error',
          durationMs: Date.now() - startedAt,
          error: errorMessage,
          source: 'frontend',
        });
      }

      return { connected: false, errorMessage };
    }
  };

  return {
    status: 'disconnected',
    errorMessage: null,
    connectionState: null,
    attachFailureReason: null,
    lastSyncedAt: null,

    setupConnectionMonitor: () => {
      monitorRefCount += 1;

      if (!monitorInterval) {
        void get().syncConnectionState();
        monitorInterval = setInterval(() => {
          void get().syncConnectionState();
        }, 1500);
      }

      return () => {
        monitorRefCount = Math.max(0, monitorRefCount - 1);
        if (monitorRefCount === 0 && monitorInterval) {
          clearInterval(monitorInterval);
          monitorInterval = null;
        }
      };
    },

    syncConnectionState: async () => {
      const connectionState = await fetchConnectionState();
      if (!connectionState) {
        set((state) => ({
          status: state.status === 'connecting' ? 'connecting' : 'disconnected',
        }));
        return null;
      }

      set((state) => ({
        connectionState,
        lastSyncedAt: Date.now(),
        status: toCdpStatus(connectionState, state.status),
        errorMessage: connectionState.last_error ?? (connectionState.connected ? null : state.errorMessage),
        attachFailureReason: inferAttachFailureReason(connectionState.last_error),
      }));

      return connectionState;
    },

    connect: async () => {
      set({
        status: 'connecting',
        errorMessage: null,
        attachFailureReason: null,
      });

      const attempt = await runConnectAttempt({ recordCommand: true, transient: false });
      return attempt.connected;
    },

    disconnect: async () => {
      const startedAt = Date.now();
      const observability = useBrowserObservabilityStore.getState();
      const commandId = observability.startCommand({
        method: 'disconnect_browser',
        summary: 'Detach from current Chrome debug session',
        source: 'frontend',
      });

      set({
        status: 'disconnected',
        errorMessage: null,
        connectionState: null,
        attachFailureReason: null,
        lastSyncedAt: Date.now(),
      });

      try {
        await invoke('disconnect_browser');
        observability.finishCommand(commandId, {
          status: 'success',
          durationMs: Date.now() - startedAt,
          source: 'frontend',
        });
      } catch (error) {
        const errorMessage = String(error);
        set({
          status: 'error',
          errorMessage,
          attachFailureReason: inferAttachFailureReason(errorMessage),
        });
        observability.finishCommand(commandId, {
          status: 'error',
          durationMs: Date.now() - startedAt,
          error: errorMessage,
          source: 'frontend',
        });
      }
    },

    launchChromeAndConnect: async () => {
      const observability = useBrowserObservabilityStore.getState();
      const startedAt = Date.now();
      const commandId = observability.startCommand({
        method: 'launch_chrome_debug',
        summary: 'Launch Chrome with remote debugging enabled',
        source: 'frontend',
      });

      set({
        status: 'connecting',
        errorMessage: null,
        attachFailureReason: null,
      });

      try {
        await invoke('launch_chrome_debug');
        observability.finishCommand(commandId, {
          status: 'success',
          durationMs: Date.now() - startedAt,
          source: 'frontend',
        });
      } catch (error) {
        const msg = String(error);
        observability.finishCommand(commandId, {
          status: 'error',
          durationMs: Date.now() - startedAt,
          error: msg,
          source: 'frontend',
        });

        if (msg.includes('CHROME_NEEDS_RESTART')) {
          set({
            status: 'error',
            errorMessage:
              'Chrome 当前正在运行但未开启调试端口。\n\n请按以下步骤操作：\n1. 完全退出 Chrome（菜单 → 退出 Google Chrome）\n2. 再次点击「连接 Chrome」',
            attachFailureReason: 'chrome_needs_restart',
          });
        } else {
          set({
            status: 'error',
            errorMessage: msg,
            attachFailureReason: inferAttachFailureReason(msg),
          });
        }
        return false;
      }

      const connectionState = await get().syncConnectionState();
      if (connectionState?.connected) {
        return true;
      }

      set({
        status: 'error',
        errorMessage: connectionState?.last_error ?? 'Chrome 已启动，但未能建立 CDP 连接',
        attachFailureReason: inferAttachFailureReason(connectionState?.last_error ?? null),
      });
      return false;
    },
  };
});
