/**
 * App - Main application component
 *
 * Handles routing between Chat, Workflow, and Skill pages via uiStore.currentView.
 * Browser is no longer a full-page route - it's now a dockable workspace surface.
 * See browser-docked-layout-design.md for details.
 *
 * Layout model:
 * - 'workflow' -> renders Workflow page
 * - 'skill' -> renders Skill page
 * - 'chat' -> renders ChatBrowserWorkspaceShell (handles split layout)
 * - 'browser' -> DEPRECATED, redirects to 'chat' with dock mode
 */

import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSettingsStore, useChatStore, useUIStore } from '@/store';
import { Settings, Workflow, Skill } from '@/pages';
import { ChatBrowserWorkspaceShell } from '@/components/ChatBrowserWorkspaceShell';

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

  // Render active page based on currentView
  // Note: 'browser' view is deprecated - browser is now a dock mode in chat view
  const renderMainContent = () => {
    switch (currentView) {
      case 'workflow':
        return <Workflow />;
      case 'skill':
        return <Skill />;
      case 'browser':
        // Deprecated: redirect to chat with browser visible
        return <ChatBrowserWorkspaceShell />;
      case 'chat':
      default:
        return <ChatBrowserWorkspaceShell />;
    }
  };

  return (
    <>
      {renderMainContent()}
      {settingsOpen && <Settings />}
    </>
  );
}
