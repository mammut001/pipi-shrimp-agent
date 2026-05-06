import { useChatStore, useUIStore } from '@/store';

export const NEW_CHAT_SKIP_PROJECT_PICKER_STORAGE_KEY = 'ai-agent-skip-project-picker';

function shouldSkipProjectPicker(): boolean {
  return localStorage.getItem(NEW_CHAT_SKIP_PROJECT_PICKER_STORAGE_KEY) === 'true';
}

export async function startNewChatFlow(source: string): Promise<string | null> {
  useUIStore.getState().setCurrentView('chat');

  let selectedProjectId: string | null | undefined;
  if (shouldSkipProjectPicker()) {
    selectedProjectId = null;
  } else {
    selectedProjectId = await useUIStore.getState().showNewChatProjectPicker(source);
    if (selectedProjectId === undefined) {
      return null;
    }
  }

  const sessionId = await useChatStore.getState().startSession(selectedProjectId);
  useChatStore.getState().selectSession(sessionId);
  return sessionId;
}
