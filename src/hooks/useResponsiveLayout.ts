/**
 * useResponsiveLayout - Centralized responsive viewport helpers for the main shell.
 *
 * Returns tiered layout flags based on window.innerWidth. The thresholds are
 * tuned to the MainLayout geometry (expanded sidebar 300px, default right
 * panel 320px, comfortable chat main column >= ~768px / max-w-3xl):
 *
 *   < 720px   xs  — phone-class, sidebar is forced to the 68px rail and the
 *                   right panel is hidden. Only the main content area fits.
 *   < 1388px  sm  — small / typical laptop viewport. Sidebar can stay
 *                   expanded (300px) but a right panel (~320px) would shrink
 *                   the chat main column below 768px and squeeze the
 *                   `max-w-3xl` content into the middle. The right panel is
 *                   force-hidden unless the page explicitly opts in via
 *                   `showRightPanel` (e.g. Workflow, AutoResearch).
 *   >= 1388px md  — full layout (sidebar + main + optional right panel).
 *
 * `forceHideRightPanel` is the recommended flag to feed into
 * `shouldShowRightPanel`: it leaves the user-explicit `rightPanelVisible`
 * toggle intact (the user can still re-open the panel via the toggle handle
 * in <main> on a wider window) but prevents the panel from rendering when
 * there simply isn't enough room.
 *
 * `forceCollapseSidebar` is the recommended flag for the sidebar. On `xs` the
 * expanded sidebar (300px) would consume almost the entire viewport so we
 * always force the 68px rail there.
 */

import { useEffect, useState } from 'react';

export type LayoutTier = 'xs' | 'sm' | 'md';

export interface ResponsiveLayout {
  /** Current layout tier based on viewport width. */
  tier: LayoutTier;
  /** Convenience: viewport is in the cramped `xs` band (<720px). */
  isCompact: boolean;
  /** Convenience: viewport is below the comfortable `md` band (<1180px). */
  isSmall: boolean;
  /** The right panel should be automatically hidden to keep the main column usable. */
  forceHideRightPanel: boolean;
  /** The sidebar should be automatically collapsed to its 68px rail form. */
  forceCollapseSidebar: boolean;
  /** Raw viewport width — exposed for callers that need to compute custom breakpoints. */
  width: number;
}

// Breakpoint chosen so the chat main column can stay >= 768px (max-w-3xl) when
// the right AgentPanel (~320px) is shown alongside the expanded sidebar
// (~300px): 300 + 320 + 768 = 1388. Below this width the right panel is
// auto-hidden so the chat content keeps a comfortable line length instead of
// being squeezed into the middle of a too-narrow main column.
const MD_BREAKPOINT = 1388;
const XS_BREAKPOINT = 720;

const computeLayout = (width: number): ResponsiveLayout => {
  const tier: LayoutTier = width < XS_BREAKPOINT ? 'xs' : width < MD_BREAKPOINT ? 'sm' : 'md';
  return {
    tier,
    isCompact: tier === 'xs',
    isSmall: tier === 'sm' || tier === 'xs',
    forceHideRightPanel: tier !== 'md',
    forceCollapseSidebar: tier === 'xs',
    width,
  };
};

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = useState<ResponsiveLayout>(() => {
    if (typeof window === 'undefined') {
      return computeLayout(MD_BREAKPOINT + 1);
    }
    return computeLayout(window.innerWidth);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setLayout(computeLayout(window.innerWidth));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return layout;
}

export default useResponsiveLayout;
