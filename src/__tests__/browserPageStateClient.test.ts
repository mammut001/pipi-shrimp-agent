/**
 * Tests for browserPageStateClient wrappers.
 *
 * Verify that the new Tauri command wrappers call `invoke` with the
 * correct command names and pass through arguments as expected.
 */

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  getBrowserLightObservation,
  captureBrowserScreenshotOptions,
  getBrowserPageState,
  captureBrowserScreenshot,
} from '../utils/browserPageStateClient';

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('browserPageStateClient', () => {
  describe('getBrowserLightObservation', () => {
    it('invokes get_page_observation_light', async () => {
      const fake = {
        url: 'https://example.com',
        title: 'Example',
        navigation_id: 'nav-1',
        ready_state: 'complete',
        text_excerpt: 'hello',
        active_element: 'BODY',
        timestamp_ms: Date.now(),
      };
      mockInvoke.mockResolvedValueOnce(fake);

      const result = await getBrowserLightObservation();

      expect(mockInvoke).toHaveBeenCalledWith('get_page_observation_light');
      expect(result.url).toBe('https://example.com');
      expect(result.ready_state).toBe('complete');
    });
  });

  describe('captureBrowserScreenshotOptions', () => {
    it('invokes browser_screenshot_options with options', async () => {
      const fakeArtifact = {
        kind: 'base64_jpeg',
        value: 'abc123',
        format: 'jpeg',
        width: 960,
        height: 540,
        bytes: 12345,
      };
      mockInvoke.mockResolvedValueOnce(fakeArtifact);

      const opts = { format: 'jpeg' as const, quality: 70, max_width: 960 };
      const result = await captureBrowserScreenshotOptions(opts);

      expect(mockInvoke).toHaveBeenCalledWith('browser_screenshot_options', { options: opts });
      expect(result.width).toBe(960);
      expect(result.height).toBe(540);
      expect(result.bytes).toBe(12345);
    });

    it('invokes browser_screenshot_options with null when no options given', async () => {
      mockInvoke.mockResolvedValueOnce({
        kind: 'base64_jpeg',
        value: '',
        format: 'jpeg',
      });

      await captureBrowserScreenshotOptions();

      expect(mockInvoke).toHaveBeenCalledWith('browser_screenshot_options', { options: null });
    });
  });

  describe('existing wrappers still use correct invoke names', () => {
    it('getBrowserPageState invokes get_page_state', async () => {
      mockInvoke.mockResolvedValueOnce({
        url: '',
        title: '',
        navigation_id: '',
        frame_count: 0,
        elements: [],
        warnings: [],
      });
      await getBrowserPageState();
      expect(mockInvoke).toHaveBeenCalledWith('get_page_state');
    });

    it('captureBrowserScreenshot invokes browser_screenshot', async () => {
      mockInvoke.mockResolvedValueOnce('base64data');
      await captureBrowserScreenshot();
      expect(mockInvoke).toHaveBeenCalledWith('browser_screenshot');
    });
  });
});
