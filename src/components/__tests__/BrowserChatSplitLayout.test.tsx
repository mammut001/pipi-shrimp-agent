/**
 * @jest-environment jsdom
 *
 * AG-15: BrowserChatSplitLayout focus flex ratios.
 */

import React from 'react';
import { afterEach, describe, expect, it } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';

import { BrowserChatSplitLayout } from '../BrowserChatSplitLayout';

describe('BrowserChatSplitLayout', () => {
  afterEach(() => {
    cleanup();
  });

  it('enlarges the browser pane when focus is browser', () => {
    render(
      React.createElement(BrowserChatSplitLayout, {
        browserSplitFocus: 'browser',
        browser: React.createElement('div', null, 'browser'),
        chat: React.createElement('div', null, 'chat'),
      }),
    );
    expect(screen.getByTestId('browser-chat-split-browser').className).toContain('flex-[3]');
    expect(screen.getByTestId('browser-chat-split-chat').className).toContain('flex-[2]');
  });

  it('enlarges the chat pane when focus is chat', () => {
    render(
      React.createElement(BrowserChatSplitLayout, {
        browserSplitFocus: 'chat',
        browser: React.createElement('div', null, 'browser'),
        chat: React.createElement('div', null, 'chat'),
      }),
    );
    expect(screen.getByTestId('browser-chat-split-browser').className).toContain('flex-[2]');
    expect(screen.getByTestId('browser-chat-split-chat').className).toContain('flex-[3]');
  });
});
