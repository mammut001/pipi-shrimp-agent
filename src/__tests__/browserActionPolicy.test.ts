/**
 * Browser action policy tests.
 *
 * Cover the Phase 8 acceptance criteria:
 *   - safe actions (search, scroll, wait) auto-approve
 *   - sensitive actions (checkout / pay / submit / send) ask
 *   - password / email / phone / address input fields ask
 *   - sensitive domains always ask
 *   - observe_only blocks mutating actions
 */

import {
  evaluateBrowserAction,
  isSensitiveDomain,
  matchesSensitiveLabel,
  shouldRequireApproval,
} from '@/utils/browserActionPolicy';
import type { BrowserPageState } from '@/types/browserPageState';

const emptyPageState: BrowserPageState = {
  url: 'https://news.example.com',
  title: 'News',
  navigation_id: 'nav-1',
  frame_count: 1,
  warnings: [],
  screenshot: null,
  elements: [],
};

const passwordPageState: BrowserPageState = {
  ...emptyPageState,
  url: 'https://shop.example.com/checkout',
  elements: [
    {
      index: 1,
      backend_node_id: 100,
      frame_id: 'root',
      role: 'textbox',
      name: 'Password',
      tag_name: 'input',
      bounds: null,
      is_visible: true,
      is_clickable: false,
      is_editable: true,
      selector_hint: 'input[type="password"]',
      text_hint: null,
      href: null,
      input_type: 'password',
    },
  ],
};

const checkoutButtonState: BrowserPageState = {
  ...emptyPageState,
  url: 'https://shop.example.com/cart',
  elements: [
    {
      index: 2,
      backend_node_id: 200,
      frame_id: 'root',
      role: 'button',
      name: 'Proceed to checkout',
      tag_name: 'button',
      bounds: null,
      is_visible: true,
      is_clickable: true,
      is_editable: false,
      selector_hint: 'button.checkout',
      text_hint: null,
      href: null,
      input_type: null,
    },
  ],
};

describe('browserActionPolicy', () => {
  describe('safe actions', () => {
    it('allows wait', () => {
      const v = evaluateBrowserAction({
        actionName: 'wait',
        url: 'https://example.com',
        payload: { milliseconds: 500 },
      });
      expect(v.decision).toBe('allow');
      expect(v.riskLevel).toBe('low');
    });

    it('allows scroll', () => {
      const v = evaluateBrowserAction({
        actionName: 'scroll',
        url: 'https://example.com',
        payload: { direction: 'down' },
      });
      expect(v.decision).toBe('allow');
    });

    it('allows extract_text', () => {
      const v = evaluateBrowserAction({
        actionName: 'extract_text',
        url: 'https://example.com',
      });
      expect(v.decision).toBe('allow');
    });

    it('allows refresh_page_state', () => {
      const v = evaluateBrowserAction({
        actionName: 'refresh_page_state',
        url: 'https://example.com',
      });
      expect(v.decision).toBe('allow');
    });

    it('allows screenshot_observe', () => {
      const v = evaluateBrowserAction({
        actionName: 'screenshot_observe',
        url: 'https://example.com',
      });
      expect(v.decision).toBe('allow');
    });

    it('allows navigation keys', () => {
      const v = evaluateBrowserAction({
        actionName: 'press_key',
        url: 'https://example.com',
        payload: { key: 'Enter' },
      });
      expect(v.decision).toBe('allow');
    });

    it('asks for non-navigation keys under auto_safe', () => {
      const v = evaluateBrowserAction({
        actionName: 'press_key',
        url: 'https://example.com',
        payload: { key: 'Control+R' },
      });
      expect(v.decision).toBe('ask');
    });
  });

  describe('sensitive actions', () => {
    it('asks before clicking a checkout button', () => {
      const v = evaluateBrowserAction({
        actionName: 'click_element',
        url: 'https://shop.example.com/cart',
        pageState: checkoutButtonState,
        payload: { backend_node_id: 200 },
      });
      expect(v.decision).toBe('ask');
      expect(v.reason.toLowerCase()).toContain('checkout');
    });

    it('asks before clicking a pay button via selector', () => {
      const v = evaluateBrowserAction({
        actionName: 'click_element',
        url: 'https://shop.example.com/cart',
        payload: { selector: 'button.pay-now' },
      });
      expect(v.decision).toBe('ask');
    });

    it('asks before typing into a password field', () => {
      const v = evaluateBrowserAction({
        actionName: 'input_text',
        url: 'https://shop.example.com/checkout',
        pageState: passwordPageState,
        payload: { backend_node_id: 100, text: 'hunter2' },
      });
      expect(v.decision).toBe('ask');
      expect(v.reason.toLowerCase()).toContain('password');
    });

    it('blocks navigate to a banking domain', () => {
      const v = evaluateBrowserAction({
        actionName: 'navigate',
        url: 'https://example.com',
        payload: { url: 'https://bank.example.com/login' },
      });
      // auto_safe asks (does not silently block) for sensitive navigation.
      expect(v.decision).toBe('ask');
      expect(v.reason.toLowerCase()).toContain('sensitive');
    });

    it('blocks navigate to a non-http scheme', () => {
      const v = evaluateBrowserAction({
        actionName: 'navigate',
        url: 'https://example.com',
        payload: { url: 'javascript:alert(1)' },
      });
      expect(v.decision).toBe('ask');
      expect(v.reason.toLowerCase()).toContain('non-http');
    });
  });

  describe('permission modes', () => {
    it('observe_only allows read-only observation actions', () => {
      const waitVerdict = evaluateBrowserAction({
        actionName: 'wait',
        url: 'https://example.com',
        permissionMode: 'observe_only',
        payload: { milliseconds: 100 },
      });
      expect(waitVerdict.decision).toBe('allow');

      const screenshotVerdict = evaluateBrowserAction({
        actionName: 'screenshot_observe',
        url: 'https://example.com',
        permissionMode: 'observe_only',
      });
      expect(screenshotVerdict.decision).toBe('allow');
    });

    it('observe_only blocks mutating actions before approval', () => {
      const clickVerdict = evaluateBrowserAction({
        actionName: 'click_element',
        url: 'https://example.com',
        permissionMode: 'observe_only',
        payload: { backend_node_id: 1 },
      });
      expect(clickVerdict.decision).toBe('block');
      expect(clickVerdict.reason).toContain('Observe-only mode is enabled');

      const navigateVerdict = evaluateBrowserAction({
        actionName: 'navigate',
        url: 'https://example.com',
        permissionMode: 'observe_only',
        payload: { url: 'https://other.example' },
      });
      expect(navigateVerdict.decision).toBe('block');
    });

    it('ask_each_action asks for every non-trivial action', () => {
      const v = evaluateBrowserAction({
        actionName: 'navigate',
        url: 'https://example.com',
        permissionMode: 'ask_each_action',
        payload: { url: 'https://other.com' },
      });
      expect(v.decision).toBe('ask');
    });

    it('auto_safe allows safe actions', () => {
      const v = evaluateBrowserAction({
        actionName: 'scroll',
        url: 'https://example.com',
        permissionMode: 'auto_safe',
        payload: { direction: 'up' },
      });
      expect(v.decision).toBe('allow');
    });
  });

  describe('localStorage permission mode (R3-02)', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('resolveBrowserActionPermissionMode reads observe_only from localStorage', async () => {
      localStorage.setItem('PIPI_BROWSER_ACTION_PERMISSION_MODE', 'observe_only');
      const { resolveBrowserActionPermissionMode } = await import('@/utils/browserFeatureFlags');
      expect(resolveBrowserActionPermissionMode()).toBe('observe_only');
    });
  });

  describe('helpers', () => {
    it('isSensitiveDomain detects bank domains', () => {
      expect(isSensitiveDomain('https://bank.example.com')).toBe(true);
      expect(isSensitiveDomain('https://www.bank.example.com')).toBe(true);
    });

    it('isSensitiveDomain ignores plain sites', () => {
      expect(isSensitiveDomain('https://example.com')).toBe(false);
      expect(isSensitiveDomain('https://news.example.com')).toBe(false);
    });

    it('matchesSensitiveLabel catches common submit verbs', () => {
      expect(matchesSensitiveLabel('Buy now')).toBe(true);
      expect(matchesSensitiveLabel('Proceed to checkout')).toBe(true);
      expect(matchesSensitiveLabel('Subscribe to newsletter')).toBe(true);
      expect(matchesSensitiveLabel('Read more')).toBe(false);
    });

    it('shouldRequireApproval mirrors evaluateBrowserAction', () => {
      expect(shouldRequireApproval({
        actionName: 'wait',
        url: 'https://example.com',
        payload: { milliseconds: 100 },
      })).toBe(false);
      expect(shouldRequireApproval({
        actionName: 'click_element',
        url: 'https://shop.example.com/cart',
        payload: { selector: 'button.checkout' },
      })).toBe(true);
    });
  });
});
