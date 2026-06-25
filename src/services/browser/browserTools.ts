/**
 * Browser tool name definitions.
 */

export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_get_page',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_get_text',
  'browser_screenshot',
  'browser_extract_content',
  'browser_press_key',
  'browser_wait',
];

export const BROWSER_READ_ONLY_TOOLS = new Set([
  'browser_get_page',
  'browser_get_text',
  'browser_screenshot',
  'browser_extract_content',
]);
