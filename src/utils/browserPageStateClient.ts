import { invoke } from '@tauri-apps/api/core';

import type { BrowserPageState } from '@/types/browserPageState';

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