import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { calculateRequestCost } from '@/utils/pricing';
import { getSessionTokenUsage } from '@/utils/chat';
import type { useChatStore, useSettingsStore } from '@/store';

type ChatStore = ReturnType<typeof useChatStore.getState>;
type SettingsStore = ReturnType<typeof useSettingsStore.getState>;

export interface SidebarSessionState {
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: Dispatch<SetStateAction<boolean>>;
  sessionToDelete: string | null;
  setSessionToDelete: Dispatch<SetStateAction<string | null>>;
  showBatchDeleteConfirm: boolean;
  setShowBatchDeleteConfirm: Dispatch<SetStateAction<boolean>>;
  renamingSessionId: string | null;
  setRenamingSessionId: Dispatch<SetStateAction<string | null>>;
  renameInput: string;
  setRenameInput: Dispatch<SetStateAction<string>>;
  isMultiSelectMode: boolean;
  setIsMultiSelectMode: Dispatch<SetStateAction<boolean>>;
  selectedSessions: Set<string>;
  setSelectedSessions: Dispatch<SetStateAction<Set<string>>>;
  ungroupedSessions: ChatStore['sessions'];
  filteredSessions: ChatStore['sessions'] | null;
  tokenUsageMap: Map<string, { input: number; output: number; total: number }>;
  sessionCostMap: Map<string, number>;
}

interface SidebarSessionStateOptions {
  sessions: ChatStore['sessions'];
  getSessionsByProject: ChatStore['getSessionsByProject'];
  apiConfigs: SettingsStore['apiConfigs'];
  activeApiConfig: SettingsStore['apiConfigs'][number] | null;
  getModelPricing: SettingsStore['getModelPricing'];
}

export function useSidebarSessionState({
  sessions,
  getSessionsByProject,
  apiConfigs,
  activeApiConfig,
  getModelPricing,
}: SidebarSessionStateOptions): SidebarSessionState {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());

  const ungroupedSessions = useMemo(
    () => [...getSessionsByProject(null)].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, getSessionsByProject],
  );

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(q) ||
        session.messages.some((message) => message.content.toLowerCase().includes(q)),
    );
  }, [sessions, searchQuery]);

  const tokenUsageMap = useMemo(() => {
    const map = new Map<string, { input: number; output: number; total: number }>();
    for (const session of sessions) {
      map.set(session.id, getSessionTokenUsage(session));
    }
    return map;
  }, [sessions]);

  const sessionCostMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      const usage = tokenUsageMap.get(session.id);
      if (!usage || usage.total === 0) continue;

      const matchingConfig = session.model
        ? apiConfigs.find((config) => config.model === session.model)
        : null;
      const fallbackConfig = matchingConfig || activeApiConfig || apiConfigs[0] || null;
      const model = session.model || fallbackConfig?.model;
      const provider = fallbackConfig?.modelProviderId || fallbackConfig?.provider;

      if (model && provider) {
        const pricing = getModelPricing(model, provider);
        if (pricing) {
          map.set(session.id, calculateRequestCost(usage.input, usage.output, pricing));
        }
      }
    }
    return map;
  }, [sessions, tokenUsageMap, apiConfigs, activeApiConfig, getModelPricing]);

  return {
    searchQuery,
    setSearchQuery,
    showDeleteConfirm,
    setShowDeleteConfirm,
    sessionToDelete,
    setSessionToDelete,
    showBatchDeleteConfirm,
    setShowBatchDeleteConfirm,
    renamingSessionId,
    setRenamingSessionId,
    renameInput,
    setRenameInput,
    isMultiSelectMode,
    setIsMultiSelectMode,
    selectedSessions,
    setSelectedSessions,
    ungroupedSessions,
    filteredSessions,
    tokenUsageMap,
    sessionCostMap,
  };
}
