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

import { useEffect, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSettingsStore, useChatStore, useUIStore } from '@/store';
import { setupBrowserObservabilityWiring } from '@/store/browserObservabilityWiring';
import { useSwarmStore } from '@/store/swarmStore';
import { initializeTelegramStore } from '@/store/telegramStore';
import { ChatBrowserWorkspaceShell } from '@/components/ChatBrowserWorkspaceShell';
import { useKeyboardShortcuts, KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal';
import { AutoResearchSetupModal } from '@/components/AutoResearchSetupModal';

// Lazy-load heavy pages so they don't bloat the initial bundle
const Settings = lazy(() => import('@/pages/Settings'));
const Workflow = lazy(() => import('@/pages/Workflow'));
const Skill = lazy(() => import('@/pages/Skill'));

function DeprecatedBrowserViewFallback() {
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const setBrowserDockMode = useUIStore((state) => state.setBrowserDockMode);
  const focusChatPane = useUIStore((state) => state.focusChatPane);

  useEffect(() => {
    console.warn('Deprecated browser view requested. Redirecting to chat workspace.');
    setBrowserDockMode('split');
    focusChatPane();
    setCurrentView('chat');
  }, [focusChatPane, setBrowserDockMode, setCurrentView]);

  return <ChatBrowserWorkspaceShell />;
}

/**
 * Main application component
 */
export default function App() {
  const { getApiConfig } = useSettingsStore();
  const { init: initChat } = useChatStore();
  const settingsOpen = useUIStore((state) => state.settingsOpen);
  const currentView = useUIStore((state) => state.currentView);
  const initSwarm = useSwarmStore((s) => s.init);

  // Keyboard shortcuts handler
  const { showShortcuts, setShowShortcuts } = useKeyboardShortcuts();

  // Load critical state first, then show the window once the app can render.
  // Window starts hidden (visible: false in tauri.conf.json) to avoid the
  // white-screen flash while the JS bundle is parsing and React is mounting.
  useEffect(() => {
    let disposed = false;
    let cleanupBrowserObservability: (() => void) | null = null;

    const startBackgroundInitialization = () => {
      // Wrap in Promise.resolve().then() to safely handle functions that may
      // return void, throw synchronously, or return a rejected Promise.
      // Direct `fn().catch()` would throw if fn returns void (not a Promise).
      Promise.resolve().then(() => initializeTelegramStore()).catch((error) => {
        console.warn('Telegram background initialization failed:', error);
      });

      Promise.resolve().then(() => initSwarm()).catch((error) => {
        console.warn('Swarm background initialization failed:', error);
      });

      try {
        const cleanup = setupBrowserObservabilityWiring();
        if (disposed) {
          cleanup();
          return;
        }
        cleanupBrowserObservability = cleanup;
      } catch (error) {
        console.error('Browser observability wiring failed:', error);
      }
    };

    const init = async () => {
      try {
        await getApiConfig();
        await initChat();
      } catch (error) {
        console.error('Failed to initialize critical app state:', error);
      } finally {
        if (disposed) {
          return;
        }

        try {
          // Always show the window — even if init partially failed, a blank/error
          // UI is better than a window that never appears.
          await getCurrentWindow().show();
        } catch (error) {
          console.error('Failed to show main window after initialization:', error);
        }

        if (!disposed) {
          startBackgroundInitialization();
        }
      }
    };

    void init();

    return () => {
      disposed = true;
      cleanupBrowserObservability?.();
    };
  }, [getApiConfig, initChat, initSwarm]);

  // Render active page based on currentView
  // Note: 'browser' view is deprecated - browser is now a dock mode in chat view
  const renderMainContent = () => {
    switch (currentView) {
      case 'workflow':
        return <Workflow />;
      case 'skill':
        return <Skill />;
      case 'browser':
        return <DeprecatedBrowserViewFallback />;
      case 'chat':
      default:
        return <ChatBrowserWorkspaceShell />;
    }
  };

  return (
    <>
      <Suspense fallback={null}>
        {renderMainContent()}
        {settingsOpen && <Settings />}
      </Suspense>

      {/* Keyboard shortcuts modal */}
      <KeyboardShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* AutoResearch setup modal */}
      <AutoResearchSetupModal />
    </>
  );
}
