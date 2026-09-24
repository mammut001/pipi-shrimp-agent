import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(async () => undefined),
}));

jest.mock('../browserActionClient', () => ({
  clickBrowserElement: jest.fn(async () => 'clicked'),
  pressBrowserKey: jest.fn(async () => 'pressed'),
  scrollBrowser: jest.fn(async () => 'scrolled'),
  typeIntoBrowserElement: jest.fn(async () => 'typed'),
  waitForBrowser: jest.fn(async () => 'waited'),
}));

jest.mock('../browserPageStateClient', () => ({
  getBrowserPageState: jest.fn(async () => null),
  getBrowserText: jest.fn(async () => 'body text'),
}));

jest.mock('../browserPageStateModel', () => ({
  describeBrowserActionTarget: jest.fn(() => 'button "Continue"'),
  resolveBrowserActionTarget: jest.fn(() => ({
    elementId: 7,
    backendNodeId: 88,
    navigationId: 'nav-1',
  })),
}));

jest.mock('../browserSessionClient', () => ({
  navigateBrowserPage: jest.fn(async () => 'navigated'),
}));

import type { BrowserPageState } from '../../types/browserPageState';
import type { ParsedActionEnvelope } from '../browserAgentActionSchema';
import {
  pressBrowserKey,
  typeIntoBrowserElement,
} from '../browserActionClient';
import { executeBrowserActionEnvelope } from '../browserActionExecutor';

const pressBrowserKeyMock = pressBrowserKey as jest.MockedFunction<typeof pressBrowserKey>;
const typeIntoBrowserElementMock = typeIntoBrowserElement as jest.MockedFunction<typeof typeIntoBrowserElement>;

describe('browser action executor', () => {
  beforeEach(() => {
    pressBrowserKeyMock.mockClear();
    typeIntoBrowserElementMock.mockClear();
  });

  it('executes input_text and the requested Enter key press', async () => {
    const pageState = {
      url: 'https://example.com',
      navigation_id: 'nav-1',
      elements: [{}],
    } as unknown as BrowserPageState;
    const envelope: ParsedActionEnvelope = {
      actionName: 'input_text',
      payload: {
        id: 7,
        text: 'Search terms',
        press_enter: true,
      },
    };
    const messages: string[] = [];

    const feedback = await executeBrowserActionEnvelope({
      envelope,
      pageState,
      log: (_level, message) => messages.push(message),
    });

    expect(typeIntoBrowserElementMock).toHaveBeenCalledWith({
      elementId: 7,
      backendNodeId: 88,
      navigationId: 'nav-1',
    }, 'Search terms');
    expect(pressBrowserKeyMock).toHaveBeenCalledWith('Enter');
    expect(feedback).toMatchObject({
      actionName: 'input_text',
      success: true,
      targetLabel: 'button "Continue"',
      elementCount: 1,
      errorMessage: 'typed; pressed Enter',
    });
    expect(messages).toContain('[NativeAgent] Pressing Enter after input into button "Continue"');
  });
});
