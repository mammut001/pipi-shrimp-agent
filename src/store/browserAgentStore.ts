/**
 * Browser Agent Store - Zustand state management for PageAgent
 *
 * Uses the second WebviewWindow approach:
 * - Browser window is opened separately via Tauri commands
 * - PageAgent runs in the browser window, not the React app
 * - Events are emitted from the browser window back to the main window
 */

import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from './settingsStore';
import {
  openBrowserWindow,
  closeBrowserWindow,
  executeAgentTask,
  getBrowserUrl,
  type AgentLog,
  type AgentTaskComplete,
} from '../utils/browserCommands';

export type BrowserAgentStatus = 'uninitialized' | 'idle' | 'running' | 'completed' | 'error';

interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'success' | 'error' | 'thinking';
}

interface BrowserAgentState {
  // State
  status: BrowserAgentStatus;
  isWindowOpen: boolean;
  logs: LogEntry[];
  currentUrl: string;
  error: string | null;
  screenshots: string[]; // base64 encoded screenshots

  // Actions
  openWindow: (url: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  executeTask: (task: string) => Promise<void>;
  stopTask: () => void;
  clearLogs: () => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  setupEventListeners: () => Promise<() => void>;
}

const formatTimestamp = (): string => {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
};

export const useBrowserAgentStore = create<BrowserAgentState>((set, get) => ({
  status: 'uninitialized',
  isWindowOpen: false,
  logs: [],
  currentUrl: '',
  error: null,
  screenshots: [],

  addLog: (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      message,
      level,
    };
    set((state) => ({
      logs: [...state.logs, entry],
    }));
  },

  setupEventListeners: async () => {
    const { addLog } = get();

    // Listen for agent log events from the browser window
    const unlistenLog = await listen<AgentLog>('agent_log', (event) => {
      const { level, message } = event.payload;
      console.log(`[BrowserAgent ${level}]`, message);
      addLog(level, message);
    });

    // Listen for task completion events
    const unlistenComplete = await listen<AgentTaskComplete>('agent_task_complete', (event) => {
      const { success, final_url, result } = event.payload;
      if (success) {
        addLog('success', `任务完成！最终URL: ${final_url}`);
        set({ status: 'completed' });
      } else {
        addLog('error', `任务失败: ${result}`);
        set({ status: 'error' });
      }
    });

    // Return cleanup function
    return () => {
      unlistenLog();
      unlistenComplete();
    };
  },

  openWindow: async (url: string) => {
    const { addLog } = get();

    try {
      // Validate URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('URL must start with http:// or https://');
      }

      addLog('info', `正在打开浏览器窗口: ${url}`);
      await openBrowserWindow(url);
      set({ isWindowOpen: true, currentUrl: url, status: 'idle', error: null });
      addLog('success', '浏览器窗口已打开');

      // Update URL periodically
      try {
        const currentUrl = await getBrowserUrl();
        set({ currentUrl });
      } catch {
        // Ignore errors when getting URL
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `打开窗口失败: ${errorMessage}`);
      set({ error: errorMessage, status: 'error' });
    }
  },

  closeWindow: async () => {
    const { addLog } = get();

    try {
      addLog('info', '正在关闭浏览器窗口');
      await closeBrowserWindow();
      set({ isWindowOpen: false, currentUrl: '', status: 'uninitialized' });
      addLog('info', '浏览器窗口已关闭');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `关闭窗口失败: ${errorMessage}`);
    }
  },

  executeTask: async (task: string) => {
    const { isWindowOpen, addLog, status } = get();

    if (!isWindowOpen) {
      addLog('error', '请先打开浏览器窗口');
      return;
    }

    if (status === 'running') {
      addLog('error', '任务正在执行中');
      return;
    }

    try {
      // Get config from settings
      const config = useSettingsStore.getState().getActiveConfig();
      if (!config?.apiKey) {
        addLog('error', '请先配置 API 设置');
        return;
      }

      addLog('info', `开始执行任务: ${task.substring(0, 50)}${task.length > 50 ? '...' : ''}`);
      set({ status: 'running' });

      await executeAgentTask(task, config.apiKey, config.model || 'MiniMax-Embedding-32G', {
        baseUrl: config.baseUrl,
      });

      // The browser window will emit completion events
      // We don't set status here as it will be updated by the event listener
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `执行失败: ${errorMessage}`);
      set({ status: 'error', error: errorMessage });
    }
  },

  stopTask: () => {
    // In the second window approach, stopping is handled differently
    // We could inject a script to stop the agent, but for now just log it
    const { addLog } = get();
    addLog('info', '停止任务功能正在开发中...');
  },

  clearLogs: () => {
    set({ logs: [] });
  },
}));
