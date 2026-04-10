/**
 * KeyboardShortcutsModal - Display available keyboard shortcuts
 *
 * Shows when user presses ? key or clicks help button.
 */

import { useEffect, useCallback, useState } from 'react';
import { useUIStore } from '@/store';

interface Shortcut {
  key: string;
  description: string;
  category: 'navigation' | 'chat' | 'workflow' | 'general';
}

const shortcuts: Shortcut[] = [
  // Navigation
  { key: 'Cmd+N', description: 'New chat', category: 'navigation' },
  { key: 'Cmd+K', description: 'Search sessions', category: 'navigation' },
  { key: 'Cmd+,', description: 'Open settings', category: 'navigation' },

  // Chat
  { key: 'Enter', description: 'Send message', category: 'chat' },
  { key: 'Shift+Enter', description: 'New line in message', category: 'chat' },
  { key: 'Escape', description: 'Stop generation', category: 'chat' },

  // Workflow
  { key: 'Cmd+Enter', description: 'Run workflow', category: 'workflow' },
  { key: 'Delete', description: 'Delete selected agent', category: 'workflow' },

  // General
  { key: '?', description: 'Show keyboard shortcuts', category: 'general' },
  { key: 'Cmd+/', description: 'Toggle sidebar', category: 'general' },
];

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;

  const categories = ['navigation', 'chat', 'workflow', 'general'] as const;
  const categoryLabels: Record<typeof categories[number], string> = {
    navigation: 'Navigation',
    chat: 'Chat',
    workflow: 'Workflow',
    general: 'General',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {categories.map((category) => {
            const categoryShortcuts = shortcuts.filter((s) => s.category === category);
            if (categoryShortcuts.length === 0) return null;

            return (
              <div key={category} className="mb-4 last:mb-0">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {categoryLabels[category]}
                </h3>
                <div className="space-y-1">
                  {categoryShortcuts.map((shortcut) => (
                    <div
                      key={shortcut.key}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm text-gray-700">{shortcut.description}</span>
                      <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 border border-gray-200 rounded-md text-gray-600">
                        {shortcut.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Press <kbd className="px-1.5 py-0.5 text-xs font-mono bg-gray-200 border border-gray-300 rounded">?</kbd> to toggle this panel
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to handle global keyboard shortcuts
 */
export function useKeyboardShortcuts() {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { setCurrentView, toggleSidebar } = useUIStore();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if user is typing in an input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const isMeta = e.metaKey || e.ctrlKey;

    // Toggle shortcuts modal with ?
    if (e.key === '?' && !isMeta) {
      e.preventDefault();
      setShowShortcuts((prev) => !prev);
      return;
    }

    // Cmd+N - New chat
    if (isMeta && e.key === 'n') {
      e.preventDefault();
      setCurrentView('chat');
      return;
    }

    // Cmd+, - Settings
    if (isMeta && e.key === ',') {
      e.preventDefault();
      useUIStore.getState().toggleSettings();
      return;
    }

    // Cmd+/ - Toggle sidebar
    if (isMeta && e.key === '/') {
      e.preventDefault();
      toggleSidebar();
      return;
    }
  }, [setCurrentView, toggleSidebar]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { showShortcuts, setShowShortcuts, KeyboardShortcutsModal };
}

export default KeyboardShortcutsModal;
