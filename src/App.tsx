/**
 * App - Main application component
 *
 * Handles routing between Chat and Settings pages based on API configuration.
 * Settings is shown as a modal overlay when triggered from sidebar.
 */

import { useEffect, useState } from 'react';
import { useSettingsStore, useChatStore, useUIStore } from '@/store';
import { Chat, Settings } from '@/pages';

/**
 * Main application component
 */
export default function App() {
  const { apiConfig, getApiConfig } = useSettingsStore();
  const { init: initChat } = useChatStore();
  const { settingsOpen, toggleSettings } = useUIStore();
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    const init = async () => {
      try {
        await getApiConfig();
        await initChat();
      } catch (error) {
        console.error('Failed to initialize:', error);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [getApiConfig, initChat]);

  // If no API key, auto-open settings modal
  // NOTE: This must be before any conditional return to comply with React's Rules of Hooks
  useEffect(() => {
    if (!isLoading && !apiConfig?.apiKey && !settingsOpen) {
      toggleSettings();
    }
  }, [isLoading, apiConfig, settingsOpen, toggleSettings]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Show Chat page with Settings modal overlay
  return (
    <>
      <Chat />
      {settingsOpen && <Settings />}
    </>
  );
}
