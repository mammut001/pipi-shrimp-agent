/**
 * @jest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type { ManualSetupReadiness } from '@/types/autoresearch';

jest.mock('@/i18n', () => ({
  t: (key: string) => {
    const dict: Record<string, string> = {
      'common.error': '失败',
      'autoresearch.manual.action.testEnv': '先测试运行环境',
      'autoresearch.manual.action.envCheckFailed': '环境检查失败，重新测试',
      'autoresearch.manual.finalBlocker': '只差最后一步：请先运行环境检查，确认测试命令可正常执行。',
      'autoresearch.manual.envCheck': '运行环境检查',
    };
    return dict[key] || key;
  },
  getCurrentLocale: () => 'zh-CN',
}));

jest.mock('../AutoResearchSetupPhaseChip', () => ({
  AutoResearchSetupPhaseChip: () => React.createElement('div', { 'data-testid': 'setup-phase-chip' }),
}));

import { ManualCockpitPanel } from '../manual/ManualCockpitPanel';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderCockpit(props: any) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(React.createElement(ManualCockpitPanel, props));
  });

  return container;
}

describe('ManualCockpitPanel', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
  });

  const baseReadiness: ManualSetupReadiness = {
    isReady: false,
    completedCount: 5,
    totalCount: 6,
    firstMissingId: 'envCheck',
    missingFields: ['envCheck'],
    missingLabels: ['运行环境检查'],
    sectionStatus: {
      provider: true,
      runtime: true,
      workspace: true,
      targetProject: true,
      metric: true,
      envCheck: false,
    },
  };

  it('renders idle envCheck state as pending with testEnv action', () => {
    const container = renderCockpit({
      readiness: baseReadiness,
      connectionTestStatus: 'idle',
      providerReady: true,
      isStarting: false,
      loopState: 'idle',
      activeRunStatus: 'idle',
      setupError: null,
      onToggleSettings: jest.fn(),
      handleStart: jest.fn(),
      handleTestConnection: jest.fn(),
      setActiveSection: jest.fn(),
    });

    expect(container.textContent).toContain('5 / 6');
    expect(container.textContent).toContain('先测试运行环境');
    expect(container.textContent).toContain('只差最后一步');
  });

  it('renders failed envCheck state with error badge and retry action', () => {
    const container = renderCockpit({
      readiness: baseReadiness,
      connectionTestStatus: 'error',
      providerReady: true,
      isStarting: false,
      loopState: 'idle',
      activeRunStatus: 'idle',
      setupError: null,
      onToggleSettings: jest.fn(),
      handleStart: jest.fn(),
      handleTestConnection: jest.fn(),
      setActiveSection: jest.fn(),
    });

    expect(container.textContent).toContain('环境检查失败，重新测试');
    expect(container.textContent).toContain('失败');
    expect(container.textContent).toContain('!');
  });
});
