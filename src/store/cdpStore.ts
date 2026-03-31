/**
 * CDP Store - Manages Chrome DevTools Protocol connection state
 *
 * Independent Zustand store for CDP connection management.
 * Does not pollute browserAgentStore.
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

type CdpStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface CdpState {
  status: CdpStatus;
  errorMessage: string | null;
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  launchChromeAndConnect: () => Promise<void>;
}

export const useCdpStore = create<CdpState>((set) => ({
  status: 'disconnected',
  errorMessage: null,

  connect: async () => {
    set({ status: 'connecting', errorMessage: null });
    try {
      await invoke('connect_browser');
      set({ status: 'connected', errorMessage: null });
    } catch (e: any) {
      set({ status: 'error', errorMessage: String(e) });
    }
  },

  disconnect: () => {
    set({ status: 'disconnected', errorMessage: null });
    // Note: chromiumoxide connection doesn't have explicit disconnect.
    // Just clear the BrowserController state via Rust command.
    invoke('disconnect_browser').catch(() => {});
  },

  launchChromeAndConnect: async () => {
    set({ status: 'connecting', errorMessage: null });
    try {
      // Step 1: Ask Rust to launch/verify Chrome with the debug port.
      // If Chrome is already running without the debug port, Rust returns
      // CHROME_NEEDS_RESTART — show a user-friendly message instead of crashing.
      await invoke('launch_chrome_debug');
    } catch (e: any) {
      const msg = String(e);
      if (msg.includes('CHROME_NEEDS_RESTART')) {
        set({
          status: 'error',
          errorMessage:
            'Chrome 当前正在运行但未开启调试端口。\n\n请按以下步骤操作：\n1. 完全退出 Chrome（菜单 → 退出 Google Chrome）\n2. 再次点击「连接 Chrome」',
        });
      } else {
        set({ status: 'error', errorMessage: msg });
      }
      return;
    }

    // Step 2: Poll until port 9222 is ready — fixed timeouts aren't reliable
    // because Chrome startup time varies. Try every second for up to 15s.
    const MAX_ATTEMPTS = 15;
    let lastError = '';
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        await invoke('connect_browser');
        set({ status: 'connected', errorMessage: null });
        return; // success — exit early
      } catch (e: any) {
        lastError = String(e);
        // keep trying
      }
    }

    // All attempts exhausted
    set({ status: 'error', errorMessage: `Chrome 启动超时，端口 9222 未就绪。\n${lastError}` });
  },
}));
