import { invoke } from '@tauri-apps/api/core';

import {
  clickBrowserElement,
  pressBrowserKey,
  scrollBrowser,
  typeIntoBrowserElement,
  waitForBrowser,
} from './browserActionClient';
import { getBrowserPageState, getBrowserText } from './browserPageStateClient';
import {
  describeBrowserActionTarget,
  resolveBrowserActionTarget,
} from './browserPageStateModel';
import { navigateBrowserPage } from './browserSessionClient';
import type { BrowserPageState } from '../types/browserPageState';
import type { ParsedActionEnvelope } from './browserAgentActionSchema';

type AgentLogLevel = 'info' | 'success' | 'error' | 'warning';
type AgentLogger = (level: AgentLogLevel, message: string) => void;

interface ActionFeedback {
  success: boolean;
  actionName: string;
  targetLabel: string;
  url: string;
  navigationId: string;
  elementCount: number;
  errorCode?: string;
  errorMessage?: string;
}

const readNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const readString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
};

export const renderActionFeedback = (feedback: ActionFeedback): string => {
  const lines = [
    `Action result: ${feedback.success ? 'OK' : 'FAILED'}`,
    `- action: ${feedback.actionName}`,
    `- target: ${feedback.targetLabel || '(none)'}`,
    `- url: ${feedback.url}`,
    `- navigation_id: ${feedback.navigationId}`,
    `- visible_element_count: ${feedback.elementCount}`,
  ];
  if (!feedback.success) {
    lines.push(`- error_code: ${feedback.errorCode ?? 'unknown'}`);
    if (feedback.errorMessage) {
      lines.push(`- error_message: ${feedback.errorMessage}`);
    }
  }
  return lines.join('\n');
};

export async function executeBrowserActionEnvelope(args: {
  envelope: ParsedActionEnvelope;
  pageState: BrowserPageState | null;
  log: AgentLogger;
}): Promise<ActionFeedback> {
  const { envelope, pageState, log } = args;
  const { actionName, payload } = envelope;
  const base = {
    url: pageState?.url ?? '',
    navigationId: pageState?.navigation_id ?? '',
    actionName,
  };
  try {
    switch (actionName) {
      case 'wait': {
        const ms = readNumber(payload.milliseconds, 0) || Math.min(readNumber(payload.seconds, 3) * 1000, 10_000);
        log('info', `[NativeAgent] Waiting ${ms}ms`);
        await waitForBrowser({ seconds: ms / 1000 });
        return { ...base, success: true, targetLabel: `${ms}ms`, elementCount: pageState?.elements.length ?? 0 };
      }
      case 'wait_for_selector': {
        const selector = readString(payload.selector);
        log('info', `[NativeAgent] Waiting for: ${selector}`);
        try {
          await waitForBrowser({ selector });
          return { ...base, success: true, targetLabel: selector, elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: selector,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'selector_timeout',
            errorMessage: String(error),
          };
        }
      }
      case 'click_element': {
        const target = resolveBrowserActionTarget(pageState, payload);
        if (!target) {
          return {
            ...base,
            success: false,
            targetLabel: '',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'invalid_input',
            errorMessage: 'click payload missing id/backend_node_id/selector (or selector did not match page state)',
          };
        }
        const targetLabel = describeBrowserActionTarget(target);
        log('info', `[NativeAgent] Clicking ${targetLabel}`);
        try {
          const result = await clickBrowserElement(target);
          return { ...base, success: true, targetLabel, elementCount: pageState?.elements.length ?? 0, errorMessage: result };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'click_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'input_text': {
        const target = resolveBrowserActionTarget(pageState, payload);
        const text = readString(payload.text);
        if (!target || !text) {
          return {
            ...base,
            success: false,
            targetLabel: '',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'invalid_input',
            errorMessage: 'input_text payload missing target (id/backend_node_id/selector) or text',
          };
        }
        const targetLabel = describeBrowserActionTarget(target);
        const shouldPressEnter = payload.press_enter === true;
        log('info', `[NativeAgent] Typing: "${text.slice(0, 80)}" into ${targetLabel}`);
        try {
          const result = await typeIntoBrowserElement(target, text);
          // R3-10: form submit — wire press_enter to native pressBrowserKey('Enter')
          if (shouldPressEnter) {
            log('info', `[NativeAgent] Pressing Enter after input into ${targetLabel}`);
            try {
              await pressBrowserKey('Enter');
            } catch (enterError) {
              return {
                ...base,
                success: false,
                targetLabel,
                elementCount: pageState?.elements.length ?? 0,
                errorCode: 'press_enter_failed',
                errorMessage: String(enterError),
              };
            }
          }
          return {
            ...base,
            success: true,
            targetLabel,
            elementCount: pageState?.elements.length ?? 0,
            errorMessage: shouldPressEnter ? `${result}; pressed Enter` : result,
          };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'type_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'press_key': {
        const key = readString(payload.key, 'Enter');
        log('info', `[NativeAgent] Pressing key: ${key}`);
        try {
          await pressBrowserKey(key);
          return { ...base, success: true, targetLabel: key, elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: key,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'key_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'scroll': {
        const direction = readString(payload.direction, 'down');
        const pixels = readNumber(payload.pixels, 600);
        log('info', `[NativeAgent] Scrolling ${direction} ${pixels}px`);
        try {
          await scrollBrowser(direction, pixels);
          return { ...base, success: true, targetLabel: `${direction} ${pixels}px`, elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: `${direction} ${pixels}px`,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'scroll_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'navigate': {
        const url = readString(payload.url);
        if (!url) {
          return {
            ...base,
            success: false,
            targetLabel: '',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'invalid_input',
            errorMessage: 'navigate payload missing url',
          };
        }
        const waitSelector = readString(payload.wait_selector) || null;
        log(
          'info',
          `[NativeAgent] Navigating to: ${url}${waitSelector ? ` (wait_selector=${waitSelector})` : ''}`,
        );
        try {
          await navigateBrowserPage(url, waitSelector);
          return {
            ...base,
            success: true,
            targetLabel: waitSelector ? `${url} [wait:${waitSelector}]` : url,
            elementCount: pageState?.elements.length ?? 0,
            url,
          };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: waitSelector ? `${url} [wait:${waitSelector}]` : url,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'navigation_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'extract_text': {
        const maxLength = readNumber(payload.max_length, 3000);
        log('info', '[NativeAgent] Extracting page text');
        try {
          const pageText = await getBrowserText(maxLength);
          return {
            ...base,
            success: true,
            targetLabel: `${pageText.length} chars`,
            elementCount: pageState?.elements.length ?? 0,
            errorMessage: pageText,
          };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: 'extract_text',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'extract_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'refresh_page_state': {
        log('info', '[NativeAgent] Refreshing page state');
        try {
          await getBrowserPageState();
          return { ...base, success: true, targetLabel: 'refresh_page_state', elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: 'refresh_page_state',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'refresh_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'screenshot_observe': {
        log('info', '[NativeAgent] Capturing observation screenshot');
        try {
          await invoke<string>('browser_screenshot');
          return { ...base, success: true, targetLabel: 'screenshot_observe', elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: 'screenshot_observe',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'screenshot_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'done':
      case 'ask_user': {
        // Handled at the loop level.
        return { ...base, success: true, targetLabel: actionName, elementCount: pageState?.elements.length ?? 0 };
      }
      default: {
        return {
          ...base,
          success: false,
          targetLabel: actionName,
          elementCount: pageState?.elements.length ?? 0,
          errorCode: 'unknown_action',
          errorMessage: `Unknown action ${actionName}`,
        };
      }
    }
  } catch (error) {
    return {
      ...base,
      success: false,
      targetLabel: actionName,
      elementCount: pageState?.elements.length ?? 0,
      errorCode: 'exception',
      errorMessage: String(error),
    };
  }
}
