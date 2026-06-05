/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { useSettingsStore } from '@/store/settingsStore';
import { assertSupportedPlatform } from '../platformGuard';

describe('assertSupportedPlatform', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  beforeEach(() => {
    useSettingsStore.setState({ windowsShellProfile: 'auto' });
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
  });

  it('allows macOS without extra shell requirements', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel', userAgent: 'Macintosh' },
      configurable: true,
    });

    await expect(assertSupportedPlatform({
      mode: 'local',
      remoteWorkDir: '/Users/demo/autoresearch',
      authMode: 'agent',
    })).resolves.toBeUndefined();
  });

  it('blocks Windows local runs when the shell profile does not resolve to WSL', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows NT' },
      configurable: true,
    });
    useSettingsStore.setState({ windowsShellProfile: 'powershell' });

    await expect(assertSupportedPlatform({
      mode: 'local',
      remoteWorkDir: 'D:\\WSL\\Ubuntu\\autoresearch',
      authMode: 'agent',
    })).rejects.toThrow('Terminal shell profile to be WSL');
  });

  it('allows Windows local runs when the shell profile resolves to WSL', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows NT' },
      configurable: true,
    });
    useSettingsStore.setState({ windowsShellProfile: 'wsl' });

    await expect(assertSupportedPlatform({
      mode: 'local',
      remoteWorkDir: 'D:\\WSL\\Ubuntu\\autoresearch',
      authMode: 'agent',
    })).resolves.toBeUndefined();
  });

  it('allows Windows SSH runs with agent auth even when PowerShell stays selected', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows NT' },
      configurable: true,
    });
    useSettingsStore.setState({ windowsShellProfile: 'powershell' });

    await expect(assertSupportedPlatform({
      mode: 'ssh',
      remoteWorkDir: '/srv/autoresearch',
      authMode: 'agent',
    })).resolves.toBeUndefined();
  });

  it('blocks Windows SSH password auth unless WSL is selected', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows NT' },
      configurable: true,
    });
    useSettingsStore.setState({ windowsShellProfile: 'powershell' });

    await expect(assertSupportedPlatform({
      mode: 'ssh',
      remoteWorkDir: '/srv/autoresearch',
      authMode: 'password',
    })).rejects.toThrow('SSH password auth');
  });
});
