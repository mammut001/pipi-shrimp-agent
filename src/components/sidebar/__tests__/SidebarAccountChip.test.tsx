/**
 * @jest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { create } from 'zustand';

type SelectorHook<T> = {
  (): T;
  <U>(selector: (state: T) => U): U;
  getState: () => T;
  setState: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void;
};

function createMockHook<T extends Record<string, unknown>>(
  initializer: Parameters<typeof create<T>>[0],
): SelectorHook<T> {
  const store = create<T>(initializer);
  const hook = ((selector?: (state: T) => unknown) => (
    selector ? store(selector) : store()
  )) as SelectorHook<T>;
  hook.getState = store.getState;
  hook.setState = store.setState;
  return hook;
}

const mockSetActiveConfig = jest.fn();
const mockAddNotification = jest.fn();

const mockUseSettingsStore = createMockHook(() => ({
  apiConfigs: [
    {
      id: 'cfg-deepseek',
      name: 'DeepSeek',
      provider: 'openai-compatible',
      model: 'deepseek-flash',
      apiKey: 'sk-test',
    },
    {
      id: 'cfg-minimax',
      name: 'MiniMax',
      provider: 'minimax',
      model: 'MiniMax-M1',
      apiKey: 'sk-test-2',
    },
  ],
  activeConfigId: 'cfg-deepseek',
  setActiveConfig: mockSetActiveConfig,
}));

const mockUseUIStore = createMockHook(() => ({
  settingsOpen: false,
  addNotification: mockAddNotification,
}));

jest.mock('@/store', () => ({
  useSettingsStore: mockUseSettingsStore,
  useUIStore: Object.assign(
    (selector?: (state: unknown) => unknown) => (
      selector ? mockUseUIStore(selector as (s: never) => unknown) : mockUseUIStore()
    ),
    {
      getState: mockUseUIStore.getState,
      setState: mockUseUIStore.setState,
    },
  ),
}));

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/shared/providers', () => ({
  getProvider: (name: string) => ({ label: name === 'openai-compatible' ? 'OpenAI Compatible' : name }),
}));

import {
  SIDEBAR_ACCOUNT_CHIP_TEST_ID,
  SIDEBAR_ACCOUNT_PICKER_TEST_ID,
  SidebarAccountChip,
} from '../SidebarAccountChip';

describe('SidebarAccountChip', () => {
  beforeEach(() => {
    mockSetActiveConfig.mockClear();
    mockAddNotification.mockClear();
    mockUseSettingsStore.setState({
      apiConfigs: [
        {
          id: 'cfg-deepseek',
          name: 'DeepSeek',
          provider: 'openai-compatible',
          model: 'deepseek-flash',
          apiKey: 'sk-test',
        },
        {
          id: 'cfg-minimax',
          name: 'MiniMax',
          provider: 'minimax',
          model: 'MiniMax-M1',
          apiKey: 'sk-test-2',
        },
      ],
      activeConfigId: 'cfg-deepseek',
      setActiveConfig: mockSetActiveConfig,
    });
    mockUseUIStore.setState({
      settingsOpen: false,
      addNotification: mockAddNotification,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a clickable chip with chevron affordance and opens the account picker', () => {
    render(<SidebarAccountChip />);

    const chip = screen.getByTestId(SIDEBAR_ACCOUNT_CHIP_TEST_ID);
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.getAttribute('aria-haspopup')).toBe('listbox');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('DeepSeek')).toBeTruthy();
    expect(screen.queryByTestId(SIDEBAR_ACCOUNT_PICKER_TEST_ID)).toBeNull();

    fireEvent.click(chip);

    expect(chip.getAttribute('aria-expanded')).toBe('true');
    const picker = screen.getByTestId(SIDEBAR_ACCOUNT_PICKER_TEST_ID);
    expect(picker).toBeTruthy();
    expect(screen.getByTestId('sidebar-account-option-cfg-deepseek')).toBeTruthy();
    expect(screen.getByTestId('sidebar-account-option-cfg-minimax')).toBeTruthy();
  });

  it('switches active config when another account is chosen', () => {
    render(<SidebarAccountChip />);
    fireEvent.click(screen.getByTestId(SIDEBAR_ACCOUNT_CHIP_TEST_ID));
    fireEvent.click(screen.getByTestId('sidebar-account-option-cfg-minimax'));

    expect(mockSetActiveConfig).toHaveBeenCalledWith('cfg-minimax');
    expect(mockAddNotification).toHaveBeenCalledWith(
      'success',
      expect.stringContaining('MiniMax'),
    );
    expect(screen.queryByTestId(SIDEBAR_ACCOUNT_PICKER_TEST_ID)).toBeNull();
  });

  it('opens Settings from manage action and when no configs exist', () => {
    render(<SidebarAccountChip />);
    fireEvent.click(screen.getByTestId(SIDEBAR_ACCOUNT_CHIP_TEST_ID));
    fireEvent.click(screen.getByTestId('sidebar-account-manage-settings'));
    expect(mockUseUIStore.getState().settingsOpen).toBe(true);
    expect(screen.queryByTestId(SIDEBAR_ACCOUNT_PICKER_TEST_ID)).toBeNull();

    cleanup();
    mockUseUIStore.setState({ settingsOpen: false, addNotification: mockAddNotification });
    mockUseSettingsStore.setState({
      apiConfigs: [],
      activeConfigId: null,
      setActiveConfig: mockSetActiveConfig,
    });

    render(<SidebarAccountChip />);
    fireEvent.click(screen.getByTestId(SIDEBAR_ACCOUNT_CHIP_TEST_ID));
    expect(mockUseUIStore.getState().settingsOpen).toBe(true);
    expect(screen.queryByTestId(SIDEBAR_ACCOUNT_PICKER_TEST_ID)).toBeNull();
  });

  it('closes the picker on Escape', () => {
    render(<SidebarAccountChip />);
    fireEvent.click(screen.getByTestId(SIDEBAR_ACCOUNT_CHIP_TEST_ID));
    expect(screen.getByTestId(SIDEBAR_ACCOUNT_PICKER_TEST_ID)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId(SIDEBAR_ACCOUNT_PICKER_TEST_ID)).toBeNull();
  });
});
