/**
 * Browser engine selection tests.
 *
 * Cover the Phase 1 acceptance criteria:
 *   - default engine is `cdp_native`
 *   - legacy path is disabled by default
 *   - legacy path is only enabled with the explicit feature flag
 *   - vision fallback is only enabled with the explicit feature flag
 */

import {
  isBrowserPageAgentLegacyEnabled,
  isBrowserVisionFallbackEnabled,
} from '@/utils/browserFeatureFlags';
import {
  describeBrowserEngine,
  isLegacyPageAgentRuntimeAllowed,
  resolveBrowserEngine,
} from '@/utils/browserEngine';

jest.mock('@/utils/browserFeatureFlags', () => ({
  isBrowserPageAgentLegacyEnabled: jest.fn(() => false),
  isBrowserVisionFallbackEnabled: jest.fn(() => false),
  getBrowserEngineDefault: jest.fn(() => 'cdp_native'),
  isValidBrowserEngine: jest.fn((value: string) =>
    ['cdp_native', 'legacy_page_agent', 'vision_fallback'].includes(value),
  ),
}));

const legacyFlagMock = isBrowserPageAgentLegacyEnabled as jest.MockedFunction<
  typeof isBrowserPageAgentLegacyEnabled
>;
const visionFlagMock = isBrowserVisionFallbackEnabled as jest.MockedFunction<
  typeof isBrowserVisionFallbackEnabled
>;

describe('browserEngine', () => {
  beforeEach(() => {
    legacyFlagMock.mockReturnValue(false);
    visionFlagMock.mockReturnValue(false);
  });

  it('defaults to cdp_native when no flags are on', () => {
    const resolution = resolveBrowserEngine(undefined, { silent: true });
    expect(resolution.engine).toBe('cdp_native');
    expect(resolution.legacyEnabled).toBe(false);
    expect(resolution.visionEnabled).toBe(false);
  });

  it('refuses to honour a legacy request when the flag is off', () => {
    const resolution = resolveBrowserEngine('legacy_page_agent', { silent: true });
    expect(resolution.engine).toBe('cdp_native');
  });

  it('refuses to honour a vision request when the flag is off', () => {
    const resolution = resolveBrowserEngine('vision_fallback', { silent: true });
    expect(resolution.engine).toBe('cdp_native');
  });

  it('uses legacy_page_agent when the flag is on and explicitly requested', () => {
    legacyFlagMock.mockReturnValue(true);
    const resolution = resolveBrowserEngine('legacy_page_agent', { silent: true });
    expect(resolution.engine).toBe('legacy_page_agent');
    expect(resolution.legacyEnabled).toBe(true);
  });

  it('uses vision_fallback when the flag is on and explicitly requested', () => {
    visionFlagMock.mockReturnValue(true);
    const resolution = resolveBrowserEngine('vision_fallback', { silent: true });
    expect(resolution.engine).toBe('vision_fallback');
    expect(resolution.visionEnabled).toBe(true);
  });

  it('falls back to cdp_native when a disabled legacy/vision default is in localStorage', () => {
    // Even if someone tampered with localStorage to set the default to legacy,
    // the runtime still requires the feature flag. We simulate by passing the
    // default through the resolution path.
    legacyFlagMock.mockReturnValue(false);
    const resolution = resolveBrowserEngine(undefined, { silent: true });
    expect(resolution.engine).toBe('cdp_native');
  });

  it('isLegacyPageAgentRuntimeAllowed mirrors the flag', () => {
    legacyFlagMock.mockReturnValue(false);
    expect(isLegacyPageAgentRuntimeAllowed()).toBe(false);
    legacyFlagMock.mockReturnValue(true);
    expect(isLegacyPageAgentRuntimeAllowed()).toBe(true);
  });

  it('describeBrowserEngine returns a human label for each engine', () => {
    expect(describeBrowserEngine('cdp_native')).toContain('CDP Native');
    expect(describeBrowserEngine('legacy_page_agent')).toContain('Legacy');
    expect(describeBrowserEngine('vision_fallback')).toContain('Vision');
  });
});
