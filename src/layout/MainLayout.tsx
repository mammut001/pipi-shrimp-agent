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
import { Sidebar } from '@/components';

/**
 * Props for MainLayout component
 */
interface MainLayoutProps {
  /** Child components to render in the main content area */
  children: React.ReactNode;
  /** Whether to show the sidebar (default: true) */
  showSidebar?: boolean;
}

/**
 * Main application layout with sidebar and content area
 */
export function MainLayout({ children, showSidebar = true }: MainLayoutProps) {
  const { sidebarVisible } = useUIStore();
  const shouldShowSidebar = showSidebar && sidebarVisible;

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
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
    </div>
  );
}

export default MainLayout;
