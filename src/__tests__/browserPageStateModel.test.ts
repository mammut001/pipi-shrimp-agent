import type { BrowserPageState } from '@/types/browserPageState';
import {
  describeBrowserElementForAgent,
  formatBrowserPageStateForPrompt,
  resolveBrowserActionTarget,
} from '@/utils/browserPageStateModel';

const pageState: BrowserPageState = {
  url: 'https://example.com/login',
  title: 'Sign in',
  navigation_id: 'nav-1',
  frame_count: 1,
  warnings: ['cross_origin_iframe_partial'],
  screenshot: null,
  elements: [
    {
      index: 7,
      backend_node_id: 88,
      frame_id: 'root',
      role: 'button',
      name: 'Continue with Google',
      tag_name: 'button',
      bounds: null,
      is_visible: true,
      is_clickable: true,
      is_editable: false,
      selector_hint: 'button[data-provider="google"]',
      text_hint: null,
      href: null,
      input_type: null,
    },
  ],
};

describe('browserPageStateModel', () => {
  it('formats PageState prompt output with stable targeting fields', () => {
    const text = formatBrowserPageStateForPrompt(pageState);

    expect(text).toContain('URL: https://example.com/login');
    expect(text).toContain('Warnings: cross_origin_iframe_partial');
    expect(text).toContain('[id=7 backend_node_id=88]');
  });

  it('describes elements with role, label, and selector hints', () => {
    const description = describeBrowserElementForAgent(pageState.elements[0]);

    expect(description).toContain('button');
    expect(description).toContain('Continue with Google');
    expect(description).toContain('selector=button[data-provider="google"]');
  });

  it('maps legacy ids to backend_node_id for action execution', () => {
    expect(resolveBrowserActionTarget(pageState, { id: 7 })).toEqual({
      elementId: 7,
      backendNodeId: 88,
      navigationId: 'nav-1',
    });

    expect(resolveBrowserActionTarget(pageState, { backend_node_id: 88 })).toEqual({
      elementId: 7,
      backendNodeId: 88,
      navigationId: 'nav-1',
    });
  });
});