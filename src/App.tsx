/**
 * App - Main application component
 *
 * Handles routing between Chat and Workflow pages via uiStore.currentView.
 * Settings is shown as a modal overlay when triggered from sidebar.
 */

import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSettingsStore, useChatStore, useUIStore } from '@/store';
import { Chat, Settings, Workflow, Skill } from '@/pages';
import { BrowserPanel } from '@/components/BrowserPanel';

/**
 * Main application component
 */
export default function App() {
  const { getApiConfig } = useSettingsStore();
  const { init: initChat, cleanup: cleanupChat } = useChatStore();
  const { settingsOpen, currentView } = useUIStore();

  // Load settings on mount, then show window once fully initialized.
  // Window starts hidden (visible: false in tauri.conf.json) to avoid the
  // white-screen flash while the JS bundle is parsing and React is mounting.
  useEffect(() => {
    const init = async () => {
      try {
        await getApiConfig();
        await initChat();
      } catch (error) {
        console.error('Failed to initialize:', error);
      } finally {
        // Always show the window — even if init partially failed, a blank/error
        // UI is better than a window that never appears.
        await getCurrentWindow().show();
      }
    };

    init();

    // Cleanup event listeners on unmount
    return () => {
      cleanupChat();
    };
  }, [getApiConfig, initChat, cleanupChat]);

  // Render active page (each page includes MainLayout with Sidebar)
  return (
    <>
      {currentView === 'chat' ? <Chat /> : currentView === 'workflow' ? <Workflow /> : currentView === 'browser' ? <BrowserPanel /> : <Skill />}
      {settingsOpen && <Settings />}
    </>
  );
}
