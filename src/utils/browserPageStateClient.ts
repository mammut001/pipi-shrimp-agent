import { invoke } from '@tauri-apps/api/core';

import type { BrowserPageState } from '@/types/browserPageState';
import type { LightObservation, ScreenshotArtifact, ScreenshotOptions } from '@/types/browserObservability';

export async function getBrowserSemanticTree(): Promise<string> {
  return invoke<string>('get_semantic_tree');
}

export async function getBrowserPageState(): Promise<BrowserPageState> {
  return invoke<BrowserPageState>('get_page_state');
}

export async function getBrowserText(maxLength = 3000): Promise<string> {
  return invoke<string>('browser_get_text', { maxLength });
}

export async function captureBrowserScreenshot(): Promise<string> {
  return invoke<string>('browser_screenshot');
}

export async function extractBrowserContent(): Promise<string> {
  return invoke<string>('browser_extract_content');
}

export async function getCurrentBrowserUrl(): Promise<string> {
  return invoke<string>('cdp_execute_script', {
    script: '(function() { return window.location.href; })()',
  });
}

/**
 * Cheap page observation (URL/title/readyState/text excerpt/active element).
 * Dramatically cheaper than a full PageState — the agent loop calls this
 * every step when the observation level is "light".
 */
export async function getBrowserLightObservation(): Promise<LightObservation> {
  return invoke<LightObservation>('get_page_observation_light');
}

/**
 * Capture a screenshot with explicit format/quality/max_width options.
 * Returns a ScreenshotArtifact with the base64-encoded image, actual
 * pixel dimensions, and byte count.
 */
export async function captureBrowserScreenshotOptions(
  options?: ScreenshotOptions,
): Promise<ScreenshotArtifact> {
  return invoke<ScreenshotArtifact>('browser_screenshot_options', { options: options ?? null });
}