/**
 * PageState formatting tests.
 *
 * Cover the Phase 4 acceptance criteria:
 *   - max 24 elements by default
 *   - backend_node_id is included in the prompt output
 *   - long labels/selectors are truncated
 */

import { formatBrowserPageStateForPrompt, resolveBrowserActionTarget } from '@/utils/browserPageStateModel';
import type { BrowserPageState } from '@/types/browserPageState';

const generatePageState = (count: number): BrowserPageState => {
  const elements = Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    backend_node_id: index + 1000,
    frame_id: 'root',
    role: index % 2 === 0 ? 'button' : 'link',
    name: index === 0 ? 'A very long button label that should be truncated to fit the model prompt budget'.padEnd(200, '.') : `Element ${index}`,
    tag_name: 'button',
    bounds: null,
    is_visible: true,
    is_clickable: true,
    is_editable: false,
    selector_hint: index === 0 ? 'a'.repeat(150) : null,
    text_hint: null,
    href: null,
    input_type: null,
  }));

  return {
    url: 'https://example.com/page',
    title: 'Example',
    navigation_id: 'nav-1',
    frame_count: 1,
    warnings: [],
    screenshot: null,
    elements,
  };
};

describe('browserPageStateFormatting', () => {
  it('caps the default element list at 24 entries', () => {
    const pageState = generatePageState(60);
    const formatted = formatBrowserPageStateForPrompt(pageState);
    const elementLines = formatted.split('\n').filter((line) => line.startsWith('- [id='));
    expect(elementLines).toHaveLength(24);
    expect(formatted).toContain('36 more elements omitted');
  });

  it('honours a custom maxElements', () => {
    const pageState = generatePageState(60);
    const formatted = formatBrowserPageStateForPrompt(pageState, 5);
    const elementLines = formatted.split('\n').filter((line) => line.startsWith('- [id='));
    expect(elementLines).toHaveLength(5);
    expect(formatted).toContain('55 more elements omitted');
  });

  it('includes backend_node_id in the rendered line', () => {
    const pageState = generatePageState(1);
    const formatted = formatBrowserPageStateForPrompt(pageState);
    expect(formatted).toContain('backend_node_id=1000');
  });

  it('truncates extremely long labels and selectors', () => {
    const pageState = generatePageState(1);
    const formatted = formatBrowserPageStateForPrompt(pageState);
    // Truncation marker
    expect(formatted).toContain('...');
    // Long selector hint is shortened.
    expect(formatted).not.toContain('a'.repeat(150));
  });

  it('handles zero elements gracefully', () => {
    const formatted = formatBrowserPageStateForPrompt(generatePageState(0));
    expect(formatted).toContain('Interactive Elements:');
    expect(formatted).toContain('none');
  });
});

describe('resolveBrowserActionTarget', () => {
  it('prefers backend_node_id when present', () => {
    const state = generatePageState(3);
    const target = resolveBrowserActionTarget(state, { backend_node_id: 1001 });
    expect(target?.backendNodeId).toBe(1001);
    expect(target?.elementId).toBe(2);
  });

  it('falls back to id when backend_node_id is missing', () => {
    const state = generatePageState(3);
    const target = resolveBrowserActionTarget(state, { id: 2 });
    expect(target?.elementId).toBe(2);
    expect(target?.backendNodeId).toBe(1001);
  });

  it('returns null when no id is provided', () => {
    const state = generatePageState(3);
    const target = resolveBrowserActionTarget(state, {});
    expect(target).toBeNull();
  });
});
