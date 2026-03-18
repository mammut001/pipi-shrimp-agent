/**
 * Browser Agent Store - Zustand state management for PageAgent
 * Handles agent lifecycle, state, and execution
 */

import { create } from 'zustand';
import { PageAgent, type PageAgentCore, type AgentStatus, type AgentActivity, type HistoricalEvent } from 'page-agent';
import { useSettingsStore } from './settingsStore';
import { getPageAgentConfig } from '../utils/pageAgentConfig';

export type BrowserAgentStatus = 'uninitialized' | 'idle' | 'running' | 'completed' | 'error';

interface BrowserAgentState {
  // State
  status: BrowserAgentStatus;
  agent: PageAgentCore | null;
  logs: string[];
  currentUrl: string;
  error: string | null;

  // Actions
  initializeAgent: () => Promise<void>;
  executeTask: (task: string) => Promise<void>;
  stopTask: () => void;
  setUrl: (url: string) => void;
  clearLogs: () => void;
}

const addLog = (logs: string[], message: string): string[] => {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return [...logs, `[${timestamp}] ${message}`];
};

export const useBrowserAgentStore = create<BrowserAgentState>((set, get) => ({
  status: 'uninitialized',
  agent: null,
  logs: [],
  currentUrl: '',
  error: null,

  initializeAgent: async () => {
    try {
      const config = useSettingsStore.getState().getActiveConfig();
      const pageAgentConfig = getPageAgentConfig(config);

      if (!pageAgentConfig) {
        set({ error: 'Please configure your API settings first', status: 'error' });
        return;
      }

      // Create new PageAgent instance
      const agent = new PageAgent({
        ...pageAgentConfig,
        language: 'zh-CN',
        maxSteps: 40,
        stepDelay: 0.4,
      });

      // Set up event listeners
      agent.addEventListener('statuschange', () => {
        const statusMap: Record<AgentStatus, BrowserAgentStatus> = {
          idle: 'idle',
          running: 'running',
          completed: 'completed',
          error: 'error',
        };
        set({ status: statusMap[agent.status] });
      });

      agent.addEventListener('activity', ((event: CustomEvent<AgentActivity>) => {
        const activity = event.detail;
        const logs = get().logs;

        switch (activity.type) {
          case 'thinking':
            set({ logs: addLog(logs, '🤔 思考中...') });
            break;
          case 'executing':
            set({ logs: addLog(logs, `🔧 执行: ${activity.tool}`) });
            break;
          case 'executed':
            set({ logs: addLog(logs, `✅ 完成: ${activity.tool}`) });
            break;
          case 'retrying':
            set({ logs: addLog(logs, `🔄 重试 (${activity.attempt}/${activity.maxAttempts})`) });
            break;
          case 'error':
            set({ logs: addLog(logs, `❌ 错误: ${activity.message}`) });
            break;
        }
      }) as EventListener);

      agent.addEventListener('historychange', ((event: CustomEvent<HistoricalEvent[]>) => {
        const history = event.detail;
        const lastEvent = history[history.length - 1];

        if (lastEvent?.type === 'step') {
          const logs = get().logs;
          set({
            logs: addLog(logs, `📝 Step ${lastEvent.stepIndex + 1}: ${lastEvent.action.name}`)
          });
        }
      }) as EventListener);

      set({ agent, status: 'idle', error: null });
      set({ logs: addLog(get().logs, '✅ PageAgent 初始化成功') });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, status: 'error' });
      set({ logs: addLog(get().logs, `❌ 初始化失败: ${errorMessage}`) });
    }
  },

  executeTask: async (task: string) => {
    const { agent, status } = get();

    if (!agent) {
      set({ logs: addLog(get().logs, '❌ Agent 未初始化') });
      return;
    }

    if (status === 'running') {
      set({ logs: addLog(get().logs, '⚠️ 任务正在执行中') });
      return;
    }

    try {
      set({ logs: addLog(get().logs, `🚀 开始执行: ${task}`), status: 'running' });

      const result = await agent.execute(task);

      if (result.success) {
        set({ logs: addLog(get().logs, '✅ 任务完成') });
      } else {
        set({ logs: addLog(get().logs, `❌ 任务失败: ${result.data}`), status: 'error' });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ logs: addLog(get().logs, `❌ 执行错误: ${errorMessage}`), status: 'error' });
    }
  },

  stopTask: () => {
    const { agent } = get();
    if (agent) {
      agent.stop();
      set({ logs: addLog(get().logs, '⏹️ 任务已停止') });
    }
  },

  setUrl: (url: string) => {
    set({ currentUrl: url });
  },

  clearLogs: () => {
    set({ logs: [] });
  },
}));
