/** @jest-environment jsdom */

import React, { useState } from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  setLocale: jest.fn(),
  addLocaleChangeListener: jest.fn(() => jest.fn()),
  getSupportedLocales: () => [{ value: 'en-US', label: 'English', flag: 'US' }],
  convertOldLanguageCode: (code: string) => (code === 'en' ? 'en-US' : 'zh-CN'),
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
}));

jest.mock('../BootstrapChatView', () => ({
  BootstrapChatView: ({ onReady }: { onReady?: () => void; sshConfig?: any }) => {
    const [value, setValue] = useState('');
    return (
      <div>
        <input
          data-testid="bootstrap-input"
          value={value}
          onChange={(event) => setValue((event.target as HTMLInputElement).value)}
        />
        <button data-testid="bootstrap-ready" onClick={onReady}>ready</button>
      </div>
    );
  },
}));

jest.mock('../AdvancedWorkdirSetup', () => ({
  AdvancedWorkdirSetup: () => {
    const [value, setValue] = useState('');
    return (
      <div>
        <input
          data-testid="advanced-input"
          value={value}
          onChange={(event) => setValue((event.target as HTMLInputElement).value)}
        />
      </div>
    );
  },
}));

import { AutoResearchTabs } from '../AutoResearchTabs';

describe('AutoResearchTabs', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('preserves tab state while switching views', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(<AutoResearchTabs />);
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const conversationalButton = buttons.find((button) => button.textContent === 'autoresearch.tabs.conversational');
    const advancedButton = buttons.find((button) => button.textContent === 'autoresearch.tabs.advanced');
    const bootstrapInput = container.querySelector('[data-testid="bootstrap-input"]') as HTMLInputElement;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

    act(() => {
      nativeInputValueSetter.call(bootstrapInput, 'goal');
      bootstrapInput.dispatchEvent(new Event('input', { bubbles: true }));
      bootstrapInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    act(() => {
      advancedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const advancedInput = container.querySelector('[data-testid="advanced-input"]') as HTMLInputElement;
    act(() => {
      nativeInputValueSetter.call(advancedInput, 'workdir');
      advancedInput.dispatchEvent(new Event('input', { bubbles: true }));
      advancedInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    act(() => {
      conversationalButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect((container.querySelector('[data-testid="bootstrap-input"]') as HTMLInputElement).value).toBe('goal');

    act(() => {
      advancedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect((container.querySelector('[data-testid="advanced-input"]') as HTMLInputElement).value).toBe('workdir');
  });
});