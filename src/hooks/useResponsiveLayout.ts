/**
 * useResponsiveLayout - Centralized responsive viewport helpers for the main shell.
 *
 * Returns tiered layout flags based on window.innerWidth. The thresholds are
 * tuned to the MainLayout geometry and keep the three-column shell available
 * on common 1280px laptop viewports while still protecting genuinely cramped
 * windows:
 *
 *   < 720px   xs  — phone-class, sidebar is forced to the 68px rail and the
 *                   right panel is hidden. Only the main content area fits.
 *   < 1180px  sm  — compact desktop / tablet viewport. The right panel is
 *                   auto-hidden to preserve usable main content width.
 *   >= 1180px md  — full layout (sidebar + main + optional right panel).
 *
 * `forceHideRightPanel` is the recommended flag to feed into
 * `shouldShowRightPanel`: it leaves the user-explicit `rightPanelVisible`
 * toggle intact on sufficiently wide viewports while preventing the panel
 * from rendering when there simply isn't enough room.
 *
 * `forceCollapseSidebar` is the recommended flag for the sidebar. On `xs` the
 * expanded sidebar would consume almost the entire viewport so we always
 * force the 68px rail there.
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

// Keep this aligned with MainLayout's documented responsive contract. The old
// 1388px threshold hid the right panel on 1280px laptop viewports, making
// AgentPanel and page-specific panels inaccessible even though the shell still
// has enough room to render them.
const MD_BREAKPOINT = 1180;
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
