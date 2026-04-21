/**
 * MainLayout - Primary application layout component
 *
 * Three-column layout:
 * - Left: Sidebar (300px, fixed)
 * - Center: Main content (flex-grow, white background)
 * - Right: Optional Artifact preview (future feature)
 */

import React, { lazy, Suspense } from 'react';
import { useUIStore } from '@/store';
import { useArtifactsStore } from '@/store/artifactsStore';
import { Sidebar, AgentPanel, NotificationToast, FileDropOverlay } from '@/components';
import { AppModeRail } from '@/components/AppModeRail';

// Lazy-loaded — rarely visible on first render
const ChromeConnectPrompt = lazy(() => import('@/components/ChromeConnectPrompt'));
const ArtifactsPanel = lazy(() => import('@/components/ArtifactsPanel'));

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
  const { sidebarVisible, rightPanelVisible, toggleSidebar } = useUIStore();
  const artifactsPanelOpen = useArtifactsStore((s) => s.panelOpen);
  const sidebarExpanded = showSidebar && sidebarVisible;
  const shouldShowRightPanel = showRightPanel ?? rightPanelVisible;
  const sidebarShellWidth = sidebarExpanded ? 300 : 68;

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* Global file drop overlay (appears on drag-enter anywhere in the app) */}
      <FileDropOverlay />

      {/* Toast Notifications */}
      <NotificationToast />

      {/* Chrome connect prompt (shown for complex browser tasks) */}
      <Suspense fallback={null}>
        <ChromeConnectPrompt />
      </Suspense>

      {/* Left Sidebar Shell — expanded sidebar or collapsed app rail */}
      <aside
        className={`relative flex-shrink-0 overflow-hidden border-r border-[#e9e9e7] bg-[#fbfbfa] transition-[width,box-shadow,background-color] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          sidebarExpanded
            ? 'shadow-[10px_0_30px_rgba(15,23,42,0.035)]'
            : 'shadow-[4px_0_18px_rgba(15,23,42,0.022)]'
        }`}
        style={{ width: sidebarShellWidth }}
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/70" />

        {showSidebar && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="absolute right-3 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-[#e7e5e1] bg-white/95 text-[#6f6e69] shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition-[background-color,color,box-shadow,transform,border-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:border-[#ddd8d0] hover:bg-white hover:text-[#37352f] hover:shadow-[0_12px_24px_rgba(15,23,42,0.12)] active:translate-y-0"
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg
              className={`h-4 w-4 transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarExpanded ? '' : 'rotate-180'}`}
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12.5 4.5L7 10l5.5 5.5" />
            </svg>
          </button>
        )}

        <div
          className={`absolute inset-0 origin-left transition-[opacity,transform,filter] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
            sidebarExpanded
              ? 'pointer-events-none -translate-x-4 scale-[0.985] opacity-0 blur-[1.5px]'
              : 'translate-x-0 scale-100 opacity-100 blur-0 delay-[90ms]'
          }`}
        >
          <AppModeRail />
        </div>

        <div
          className={`absolute inset-0 overflow-hidden origin-left transition-[opacity,transform,filter] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            sidebarExpanded
              ? 'translate-x-0 scale-100 opacity-100 blur-0 delay-[80ms]'
              : 'pointer-events-none translate-x-3 scale-[0.992] opacity-0 blur-[1.5px]'
          }`}
        >
          <Sidebar />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {children}
      </main>

      {/* Right Panel — Artifacts panel takes priority when open */}
      {artifactsPanelOpen && (
        <Suspense fallback={null}>
          <aside className="w-[400px] flex-shrink-0 border-l border-gray-200 bg-gray-50 overflow-hidden">
            <ArtifactsPanel />
          </aside>
        </Suspense>
      )}
      {!artifactsPanelOpen && shouldShowRightPanel && (
        <aside className={`${rightPanelWidthClassName} flex-shrink-0 overflow-y-auto border-l border-[#e9e9e7] bg-[#f7f6f3] shadow-[inset_1px_0_0_rgba(255,255,255,0.55)]`}>
          {rightPanelContent ?? <AgentPanel />}
        </aside>
      )}
    </div>
  );
}

export default MainLayout;
