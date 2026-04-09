/**
 * MainLayout - Primary application layout component
 *
 * Three-column layout:
 * - Left: Sidebar (300px, fixed)
 * - Center: Main content (flex-grow, white background)
 * - Right: Optional Artifact preview (future feature)
 */

import React from 'react';
import { useUIStore } from '@/store';
import { Sidebar, AgentPanel, NotificationToast, FileDropOverlay, ChromeConnectPrompt } from '@/components';

/**
 * Props for MainLayout component
 */
interface MainLayoutProps {
  /** Child components to render in the main content area */
  children: React.ReactNode;
  /** Whether to show the sidebar (default: true) */
  showSidebar?: boolean;
  /** Override whether the right panel should render */
  showRightPanel?: boolean;
  /** Optional custom content for the right panel */
  rightPanelContent?: React.ReactNode;
  /** Optional custom width for the right panel */
  rightPanelWidthClassName?: string;
}

/**
 * Main application layout with sidebar and content area
 */
export function MainLayout({
  children,
  showSidebar = true,
  showRightPanel,
  rightPanelContent,
  rightPanelWidthClassName = 'w-[320px]',
}: MainLayoutProps) {
  const { sidebarVisible, rightPanelVisible } = useUIStore();
  const shouldShowSidebar = showSidebar && sidebarVisible;
  const shouldShowRightPanel = showRightPanel ?? rightPanelVisible;

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* Global file drop overlay (appears on drag-enter anywhere in the app) */}
      <FileDropOverlay />

      {/* Toast Notifications */}
      <NotificationToast />

      {/* Chrome connect prompt (shown for complex browser tasks) */}
      <ChromeConnectPrompt />

      {/* Left Sidebar */}
      {shouldShowSidebar && (
        <aside className="w-[300px] flex-shrink-0 border-r border-gray-200 bg-white">
          <Sidebar />
        </aside>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {children}
      </main>

      {/* Right Agent Panel */}
      {shouldShowRightPanel && (
        <aside className={`${rightPanelWidthClassName} flex-shrink-0 border-l border-gray-200 bg-gray-50 overflow-y-auto`}>
          {rightPanelContent ?? <AgentPanel />}
        </aside>
      )}
    </div>
  );
}

export default MainLayout;
