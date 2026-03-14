/**
 * App - Main application component
 *
 * Handles routing between Chat and Workflow pages via uiStore.currentView.
 * Settings is shown as a modal overlay when triggered from sidebar.
 */

import { useEffect } from 'react';
import { useSettingsStore, useChatStore, useUIStore } from '@/store';
import { Chat, Settings, Workflow, Skill } from '@/pages';

/**
 * Main application component
 */
export default function App() {
  const { apiConfig, getApiConfig } = useSettingsStore();
  const { init: initChat } = useChatStore();
  const { settingsOpen, toggleSettings, currentView } = useUIStore();

  // Load settings on mount
  useEffect(() => {
    const init = async () => {
      try {
        await getApiConfig();
        await initChat();
      } catch (error) {
        console.error('Failed to initialize:', error);
      }
    };

    init();
  }, [getApiConfig, initChat]);

  // If no API key, auto-open settings modal
  useEffect(() => {
    if (!apiConfig?.apiKey && !settingsOpen) {
      toggleSettings();
    }
  }, [apiConfig, settingsOpen, toggleSettings]);

  // Render active page (each page includes MainLayout with Sidebar)
  return (
    <>
      {currentView === 'chat' ? <Chat /> : currentView === 'workflow' ? <Workflow /> : <Skill />}
      {settingsOpen && <Settings />}
    </>
  );
}
