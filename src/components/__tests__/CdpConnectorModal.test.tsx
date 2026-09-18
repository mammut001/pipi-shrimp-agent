/**
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { CdpConnectorModal, LINUX_CHROME_DEBUG_COMMAND } from '../CdpConnectorModal';

describe('CdpConnectorModal Linux debug launch flags', () => {
  afterEach(() => {
    cleanup();
  });

  it('exports hardened Linux Chrome debug command string with sandbox flags', () => {
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--remote-debugging-port=9222');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--remote-debugging-address=127.0.0.1');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--no-sandbox');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--disable-dev-shm-usage');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--enable-unsafe-swiftshader');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--user-data-dir="$HOME/.config/pipi-shrimp/chrome-debug-profile"');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--no-first-run');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('--no-default-browser-check');
    expect(LINUX_CHROME_DEBUG_COMMAND).toContain('about:blank');
  });

  it('renders hardened Linux command when switching to manual mode', async () => {
    await act(async () => {
      render(<CdpConnectorModal onClose={jest.fn()} />);
    });

    const manualModeButton = screen.getByText('如何手动开启调试模式？');
    await act(async () => {
      fireEvent.click(manualModeButton);
    });

    const linuxLabel = screen.getByText('Linux (终端)');
    expect(linuxLabel).toBeTruthy();

    const commandBlock = screen.getByText((content) =>
      content.includes('--remote-debugging-port=9222') &&
      content.includes('--no-sandbox') &&
      content.includes('--disable-dev-shm-usage')
    );
    expect(commandBlock).toBeTruthy();
    expect(commandBlock.textContent).toBe(LINUX_CHROME_DEBUG_COMMAND);
  });
});
