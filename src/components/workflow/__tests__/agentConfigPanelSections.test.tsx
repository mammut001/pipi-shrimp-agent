/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { RoleModelHint, WorkflowAgent } from '@/types/workflow';
import {
  createAgentConfigFormData,
  type ConfigOption,
} from '../agentConfigPanelUi';
import {
  AgentConfigIdentityFields,
  AgentConfigModelSection,
  AgentConfigNotifySection,
  AgentConfigOutputRoutesSection,
  AgentConfigPanelSaveFooter,
} from '../agentConfigPanelSections';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
  convertOldLanguageCode: (code: string) => (code === 'en' ? 'en-US' : 'zh-CN'),
}));

const baseAgent = (overrides: Partial<WorkflowAgent> = {}): WorkflowAgent => ({
  id: 'agent-1',
  name: 'Writer',
  position: { x: 0, y: 0 },
  status: 'idle',
  outputRoutes: [],
  execution: { mode: 'single' },
  role: 'writer',
  notifyOnComplete: [],
  retryPolicy: { maxAttempts: 3, backoffMs: 1500, fallbackConfigIds: [] },
  visionPolicy: 'inherit',
  ...overrides,
});

describe('agentConfigPanelSections', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

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

  it('AgentConfigIdentityFields renders name/role and updates role via select', () => {
    const setField = jest.fn();
    const formData = createAgentConfigFormData(baseAgent({ name: 'Alpha', role: 'writer' }));

    act(() => {
      root.render(
        createElement(AgentConfigIdentityFields, {
          formData,
          setField,
        }),
      );
    });

    expect(container.textContent).toContain('workflow.agentName');
    expect(container.textContent).toContain('workflow.agentRole');
    const select = container.querySelector('select');
    expect(select).toBeTruthy();
    act(() => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      proto.call(select!, 'developer');
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setField).toHaveBeenCalledWith('role', 'developer');
  });

  it('AgentConfigModelSection shows apply recommendation and fires callback', () => {
    const applyRecommendedModel = jest.fn();
    const setFormData = jest.fn();
    const setField = jest.fn();
    const formData = createAgentConfigFormData(baseAgent());
    const roleHint: RoleModelHint = {
      role: 'writer',
      preferredProviders: ['anthropic'],
      preferredModelKeywords: ['claude'],
      reason: 'workflow.roleRecommendation',
    };
    const configOptions: ConfigOption[] = [
      { id: 'cfg-1', label: 'Claude (anthropic)', provider: 'anthropic', model: 'claude-3' },
    ];

    act(() => {
      root.render(
        createElement(AgentConfigModelSection, {
          formData,
          setFormData,
          setField,
          roleHint,
          configOptions,
          modelOptions: ['claude-3'],
          apiConfigs: [{ id: 'cfg-1', provider: 'anthropic', model: 'claude-3' }],
          applyRecommendedModel,
        }),
      );
    });

    expect(container.textContent).toContain('workflow.modelConfig');
    expect(container.textContent).toContain('workflow.applyRecommendation');
    const button = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('workflow.applyRecommendation'),
    );
    expect(button).toBeTruthy();
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(applyRecommendedModel).toHaveBeenCalledTimes(1);
  });

  it('AgentConfigNotifySection shows empty message when no other agents', () => {
    const formData = createAgentConfigFormData(baseAgent());
    act(() => {
      root.render(
        createElement(AgentConfigNotifySection, {
          formData,
          setFormData: jest.fn(),
          otherAgents: [],
        }),
      );
    });
    expect(container.textContent).toContain('workflow.notifyOnCompleteEmpty');
  });

  it('AgentConfigOutputRoutesSection shows warning, route label, and remove', () => {
    const onRemoveRoute = jest.fn();
    const otherAgents = [baseAgent({ id: 'agent-2', name: 'Developer', role: 'developer' })];

    act(() => {
      root.render(
        createElement(AgentConfigOutputRoutesSection, {
          agentId: 'agent-1',
          otherAgents,
          outputRoutes: [
            {
              id: 'route-1',
              condition: 'onComplete',
              targetAgentId: 'agent-2',
            },
          ],
          missingRouteMarkers: ['DONE'],
          newRoute: {
            condition: 'onComplete',
            keyword: '',
            keywordMode: 'includes',
            targetAgentId: '',
          },
          setNewRoute: jest.fn(),
          isRunning: false,
          onAddRoute: jest.fn(),
          onRemoveRoute,
        }),
      );
    });

    expect(container.textContent).toContain('workflow.missingOutputRouteWarning');
    expect(container.textContent).toContain('workflow.missingOutputRouteHint');
    expect(container.textContent).toContain('Developer');
    const removeBtn = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === '×');
    expect(removeBtn).toBeTruthy();
    act(() => {
      removeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRemoveRoute).toHaveBeenCalledWith('agent-1', 'route-1');
  });

  it('AgentConfigPanelSaveFooter fires onSave', () => {
    const onSave = jest.fn();
    act(() => {
      root.render(createElement(AgentConfigPanelSaveFooter, { embedded: false, onSave }));
    });
    expect(container.textContent).toContain('workflow.save');
    const button = container.querySelector('button');
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
