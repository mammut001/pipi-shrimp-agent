/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SshConfig } from '@/store/autoresearchStore';
import {
  SetupChecklistCard,
  SetupExperimentGoalCard,
  SetupModalHeader,
  SetupRunTargetCard,
} from '@/components/autoResearchSetup/AutoResearchSetupModalSections';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
  convertOldLanguageCode: (code: string) => (code === 'en' ? 'en-US' : 'zh-CN'),
}));

jest.mock('@/components/autoresearch/BootstrapChatView', () => ({
  BootstrapChatView: () => createElement('div', { 'data-testid': 'bootstrap-chat' }, 'bootstrap'),
}));

const baseForm: SshConfig = {
  mode: 'local',
  host: '',
  user: 'root',
  keyPath: '',
  port: 22,
  remoteWorkDir: '~/autoresearch',
  authMode: 'agent',
  password: '',
};

const emptyHints = {
  host: null,
  user: null,
  password: null,
  keyPath: null,
  workdir: null,
  experimentDir: null,
  metric: null,
  baseline: null,
};

describe('AutoResearchSetupModalSections', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('SetupModalHeader renders tabs and fires close/select', () => {
    const onClose = jest.fn();
    const onSelectTab = jest.fn();
    act(() => {
      root.render(
        createElement(SetupModalHeader, {
          lockMessage: 'locked-now',
          setupLocked: false,
          activeTab: 'conversational',
          onClose,
          onSelectTab,
        }),
      );
    });
    expect(container.textContent).toContain('locked-now');
    expect(container.textContent).toContain('autoresearch.tabs.guided');
    expect(container.textContent).toContain('autoresearch.tabs.manual');

    const closeBtn = container.querySelector('[aria-label="Close setup modal"]') as HTMLButtonElement;
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const manualBtn = container.querySelector('#autoresearch-setup-tab-btn-manual') as HTMLButtonElement;
    act(() => {
      manualBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith('advanced');
  });

  it('SetupRunTargetCard toggles local/ssh and shows workdir', () => {
    const setForm = jest.fn();
    act(() => {
      root.render(
        createElement(SetupRunTargetCard, {
          form: baseForm,
          setForm,
          fieldHints: emptyHints,
          setupLocked: false,
          isStarting: false,
          onWorkDirChange: () => undefined,
          onPathInputKeyDown: () => undefined,
          onPickWorkDir: () => undefined,
        }),
      );
    });
    expect(container.textContent).toContain('autoresearch.card.runTarget');
    expect(container.querySelector('input[aria-label="AutoResearch workdir"]')).toBeTruthy();

    const sshBtn = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === 'autoresearch.mode.ssh',
    );
    expect(sshBtn).toBeTruthy();
    act(() => {
      sshBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setForm).toHaveBeenCalled();
  });

  it('SetupRunTargetCard renders SSH host fields when mode=ssh', () => {
    act(() => {
      root.render(
        createElement(SetupRunTargetCard, {
          form: { ...baseForm, mode: 'ssh', host: 'box', user: 'ubuntu' },
          setForm: () => undefined,
          fieldHints: { ...emptyHints, host: 'host required' },
          setupLocked: false,
          isStarting: false,
          onWorkDirChange: () => undefined,
          onPathInputKeyDown: () => undefined,
          onPickWorkDir: () => undefined,
        }),
      );
    });
    expect(container.textContent).toContain('host required');
    expect(container.textContent).toContain('autoresearch.field.host');
    expect(container.textContent).toContain('autoresearch.field.userAuth');
  });

  it('SetupExperimentGoalCard shows prefill + reset', () => {
    const onReset = jest.fn();
    act(() => {
      root.render(
        createElement(SetupExperimentGoalCard, {
          prefillSource: 'last-used',
          experimentDir: '/exp',
          metric: 'val_loss',
          direction: 'lower',
          maxIter: 50,
          baselineInput: '',
          fieldHints: emptyHints,
          setupLocked: false,
          isStarting: false,
          onResetToDefaults: onReset,
          onExperimentDirChange: () => undefined,
          onPathInputKeyDown: () => undefined,
          onPickExperimentDir: () => undefined,
          onMetricChange: () => undefined,
          onDirectionChange: () => undefined,
          onMaxIterChange: () => undefined,
          onBaselineChange: () => undefined,
        }),
      );
    });
    expect(container.textContent).toContain('autoresearch.prefillLastUsed');
    const resetBtn = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === 'autoresearch.resetToDefaults',
    );
    expect(resetBtn).toBeTruthy();
    act(() => {
      resetBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('SetupChecklistCard shows readiness, summary, and settings action', () => {
    const onOpenSettings = jest.fn();
    act(() => {
      root.render(
        createElement(SetupChecklistCard, {
          form: baseForm,
          experimentDir: '/exp',
          metric: 'acc',
          direction: 'higher',
          maxIter: 10,
          providerReady: false,
          workdirReady: true,
          experimentDirReady: true,
          metricReady: true,
          sshReady: true,
          submitError: 'boom',
          isStarting: false,
          setupLocked: false,
          onOpenSettings,
        }),
      );
    });
    expect(container.textContent).toContain('autoresearch.card.setupChecklist');
    expect(container.textContent).toContain('boom');
    expect(container.textContent).toContain('autoresearch.summaryTitle');
    const settingsBtn = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === 'autoresearch.action.openSettings',
    );
    expect(settingsBtn).toBeTruthy();
    act(() => {
      settingsBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
