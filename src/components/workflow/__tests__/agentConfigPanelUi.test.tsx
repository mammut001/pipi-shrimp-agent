/**
 * @jest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  ROLE_LABEL_KEYS,
  getMissingExplicitRouteMarkers,
  buildModelOptions,
  buildConfigOptions,
  createAgentConfigFormData,
  resolveRecommendedModelSelection,
  formatOutputRouteConditionLabel,
  TopologyRunningLockBanner,
  AgentConfigPanelChromeHeader,
} from '../agentConfigPanelUi';
import type { RouteCondition, WorkflowAgentRole, RoleModelHint, WorkflowAgent } from '@/types/workflow';
import { DEFAULT_EXECUTION_CONFIG, DEFAULT_RETRY_POLICY } from '@/services/workflow/defaults';

describe('agentConfigPanelUi', () => {
  let mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  function render(ui: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      root.render(ui);
    });

    return { container, root };
  }

  describe('ROLE_LABEL_KEYS', () => {
    it('defines role label mapping for all workflow roles', () => {
      expect(ROLE_LABEL_KEYS.planner).toBe('workflow.role.custom');
      expect(ROLE_LABEL_KEYS.writer).toBe('workflow.role.writer');
      expect(ROLE_LABEL_KEYS.developer).toBe('workflow.role.coder');
      expect(ROLE_LABEL_KEYS.qa).toBe('workflow.role.tester');
      expect(ROLE_LABEL_KEYS.reviewer).toBe('workflow.role.reviewer');
      expect(ROLE_LABEL_KEYS.security).toBe('workflow.role.security');
      expect(ROLE_LABEL_KEYS.devops).toBe('workflow.role.devops');
      expect(ROLE_LABEL_KEYS['goal-evaluator']).toBe('workflow.role.goal-evaluator');
      expect(ROLE_LABEL_KEYS.custom).toBe('workflow.role.custom');
    });
  });

  describe('getMissingExplicitRouteMarkers', () => {
    it('returns empty array when no markers are declared', () => {
      const missing = getMissingExplicitRouteMarkers({
        taskPrompt: 'A simple task without markers',
        taskInstruction: 'Do the job',
        soulPrompt: 'Helpful assistant',
        outputRoutes: [],
      });
      expect(missing).toEqual([]);
    });

    it('returns missing markers when declared in prompts but no matching route keyword exists', () => {
      const missing = getMissingExplicitRouteMarkers({
        taskPrompt: 'If complete output [[ROUTE_NEXT_STEP]] or [[PASS]]',
        taskInstruction: 'Output [[REVISE]] if needed',
        soulPrompt: '',
        outputRoutes: [
          { condition: 'outputContains', keyword: '[[PASS]]' },
        ],
      });
      expect(missing).toContain('[[WORKFLOW:ROUTE_NEXT_STEP]]');
      expect(missing).toContain('[[WORKFLOW:REVISE]]');
      expect(missing).not.toContain('[[WORKFLOW:PASS]]');
    });

    it('normalizes tokens and matches despite alias or format variance in outputContains routes', () => {
      const missing = getMissingExplicitRouteMarkers({
        taskPrompt: 'Emit [[GOAL_COMPLETE]] when done',
        taskInstruction: '',
        soulPrompt: '',
        outputRoutes: [
          { condition: 'outputContains', keyword: '<PASS>' },
        ],
      });
      expect(missing).toEqual([]);
    });

    it('ignores non-outputContains routes when calculating matching keywords', () => {
      const missing = getMissingExplicitRouteMarkers({
        taskPrompt: 'Emit [[ESCALATE]] on error',
        outputRoutes: [
          { condition: 'onError', keyword: '[[ESCALATE]]' },
          { condition: 'always' },
        ],
      });
      expect(missing).toEqual(['[[WORKFLOW:ESCALATE]]']);
    });
  });

  describe('buildModelOptions', () => {
    it('returns empty array if effectiveProvider is falsy', () => {
      const options = buildModelOptions({
        effectiveProvider: '',
        selectedConfig: null,
        apiConfigs: [],
        availableModels: {},
      });
      expect(options).toEqual([]);
    });

    it('collects and deduplicates models from selectedConfig, same-provider apiConfigs, availableModels, and defaults', () => {
      const options = buildModelOptions({
        effectiveProvider: 'openai',
        selectedConfig: { model: 'gpt-4o' },
        apiConfigs: [
          { provider: 'openai', model: 'gpt-4o-mini' },
          { provider: 'anthropic', model: 'claude-3-5-sonnet' },
        ],
        availableModels: {
          openai: ['gpt-4o', 'o1-preview'],
        },
      });

      expect(options).toContain('gpt-4o');
      expect(options).toContain('gpt-4o-mini');
      expect(options).toContain('o1-preview');
      expect(options).not.toContain('claude-3-5-sonnet');
      // Verify deduplication
      const gpt4oCount = options.filter((m) => m === 'gpt-4o').length;
      expect(gpt4oCount).toBe(1);
    });
  });

  describe('buildConfigOptions', () => {
    it('maps apiConfigs into formatted config options', () => {
      const configs = [
        { id: 'cfg-1', name: 'OpenAI Primary', provider: 'openai', model: 'gpt-4o' },
        { id: 'cfg-2', name: 'Anthropic Team', provider: 'anthropic', model: 'claude-3-5-sonnet' },
      ];

      const options = buildConfigOptions(configs);
      expect(options).toEqual([
        {
          id: 'cfg-1',
          label: 'OpenAI Primary (openai)',
          provider: 'openai',
          model: 'gpt-4o',
        },
        {
          id: 'cfg-2',
          label: 'Anthropic Team (anthropic)',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
        },
      ]);
    });
  });

  describe('createAgentConfigFormData', () => {
    it('returns sensible defaults when agent is null or undefined', () => {
      const data = createAgentConfigFormData(null);
      expect(data).toEqual({
        name: '',
        task: '',
        taskPrompt: '',
        taskInstruction: '',
        soulPrompt: '',
        execution: DEFAULT_EXECUTION_CONFIG,
        role: 'custom',
        configId: '',
        provider: '',
        modelId: '',
        notifyOnComplete: [],
        retryPolicy: DEFAULT_RETRY_POLICY,
      });
    });

    it('populates form data from an existing agent and normalizes legacy roles', () => {
      const agent: Partial<WorkflowAgent> = {
        name: 'Backend Dev',
        task: 'Implement auth',
        taskPrompt: 'Write login handlers',
        taskInstruction: 'Follow project conventions',
        soulPrompt: 'You are an expert coder',
        execution: { mode: 'multi-round', maxRounds: 5, roundCondition: 'untilComplete' },
        role: 'coder' as any, // legacy role normalized to developer
        model: {
          configId: 'cfg-99',
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        notifyOnComplete: ['agent-reviewer'],
        retryPolicy: {
          maxAttempts: 4,
          backoffMs: 2000,
          fallbackConfigIds: ['cfg-backup'],
        },
      };

      const data = createAgentConfigFormData(agent);
      expect(data.name).toBe('Backend Dev');
      expect(data.task).toBe('Implement auth');
      expect(data.taskPrompt).toBe('Write login handlers');
      expect(data.taskInstruction).toBe('Follow project conventions');
      expect(data.soulPrompt).toBe('You are an expert coder');
      expect(data.execution).toEqual({ mode: 'multi-round', maxRounds: 5, roundCondition: 'untilComplete' });
      expect(data.role).toBe('developer'); // normalized from 'coder'
      expect(data.configId).toBe('cfg-99');
      expect(data.provider).toBe('openai');
      expect(data.modelId).toBe('gpt-4o');
      expect(data.notifyOnComplete).toEqual(['agent-reviewer']);
      expect(data.retryPolicy).toEqual({
        maxAttempts: 4,
        backoffMs: 2000,
        fallbackConfigIds: ['cfg-backup'],
      });
    });

    it('merges default retry policy when agent retry policy is partially specified', () => {
      const agent: Partial<WorkflowAgent> = {
        name: 'Tester',
        role: 'qa',
        retryPolicy: { maxAttempts: 5, backoffMs: 1500 },
      };

      const data = createAgentConfigFormData(agent);
      expect(data.retryPolicy.maxAttempts).toBe(5);
      expect(data.retryPolicy.fallbackConfigIds).toEqual([]);
    });
  });

  describe('resolveRecommendedModelSelection', () => {
    const configOptions = [
      { id: 'cfg-anthropic', provider: 'anthropic', model: 'claude-3-5-sonnet' },
      { id: 'cfg-openai', provider: 'openai', model: 'gpt-4o' },
    ];
    const availableModels = {
      anthropic: ['claude-3-opus', 'claude-3-5-sonnet-20241022'],
      openai: ['gpt-4o', 'gpt-4o-mini'],
    };

    it('returns null if roleHint is null or undefined', () => {
      const res = resolveRecommendedModelSelection({
        roleHint: null,
        configOptions,
        availableModels,
      });
      expect(res).toBeNull();
    });

    it('resolves recommended model matching preferred provider and keyword', () => {
      const roleHint: RoleModelHint = {
        role: 'developer',
        preferredProviders: ['anthropic', 'openai'],
        preferredModelKeywords: ['sonnet', 'claude-3-5'],
        reason: 'Recommended for coding',
      };

      const res = resolveRecommendedModelSelection({
        roleHint,
        configOptions,
        availableModels,
      });

      expect(res).not.toBeNull();
      expect(res?.configId).toBe('cfg-anthropic');
      expect(res?.provider).toBe('anthropic');
      expect(res?.modelId).toBe('claude-3-5-sonnet-20241022');
    });

    it('falls back to first model if no keyword matches', () => {
      const roleHint: RoleModelHint = {
        role: 'writer',
        preferredProviders: ['openai'],
        preferredModelKeywords: ['non-existent-keyword'],
        reason: 'Recommended for writing',
      };

      const res = resolveRecommendedModelSelection({
        roleHint,
        configOptions,
        availableModels,
      });

      expect(res).not.toBeNull();
      expect(res?.configId).toBe('cfg-openai');
      expect(res?.provider).toBe('openai');
      expect(res?.modelId).toBe('gpt-4o');
    });
  });

  describe('formatOutputRouteConditionLabel', () => {
    const mockTranslate = (key: string) => `[${key}]`;

    it('formats onComplete condition', () => {
      const label = formatOutputRouteConditionLabel(
        { condition: 'onComplete' },
        mockTranslate,
      );
      expect(label).toBe('[workflow.onComplete]');
    });

    it('formats onError condition', () => {
      const label = formatOutputRouteConditionLabel(
        { condition: 'onError' },
        mockTranslate,
      );
      expect(label).toBe('[workflow.onError]');
    });

    it('formats always condition', () => {
      const label = formatOutputRouteConditionLabel(
        { condition: 'always' },
        mockTranslate,
      );
      expect(label).toBe('[workflow.always]');
    });

    it('formats outputContains condition with default keywordMode', () => {
      const label = formatOutputRouteConditionLabel(
        { condition: 'outputContains', keyword: 'PASS' },
        mockTranslate,
      );
      expect(label).toBe('[workflow.outputContains] (includes) "PASS"');
    });

    it('formats outputContains condition with explicit regex keywordMode', () => {
      const label = formatOutputRouteConditionLabel(
        { condition: 'outputContains', keyword: '^ERR_\\d+', keywordMode: 'regex' },
        mockTranslate,
      );
      expect(label).toBe('[workflow.outputContains] (regex) "^ERR_\\d+"');
    });
  });

  describe('TopologyRunningLockBanner', () => {
    it('renders the Chinese lock string and alert styling in DOM', () => {
      const { container } = render(<TopologyRunningLockBanner />);
      expect(container.textContent).toContain('工作流运行中，当前不能修改上下游连接与输出路由。');
      expect(container.firstElementChild?.className).toContain('bg-amber-50');
      expect(container.firstElementChild?.className).toContain('border-amber-200');
    });
  });

  describe('AgentConfigPanelChromeHeader', () => {
    it('renders title and triggers onClose when close button is clicked', () => {
      const onClose = jest.fn();
      const { container } = render(
        <AgentConfigPanelChromeHeader title="Configure Agent" onClose={onClose} />,
      );

      expect(container.querySelector('h2')?.textContent).toBe('Configure Agent');
      const closeBtn = container.querySelector('button');
      expect(closeBtn?.textContent).toBe('×');

      act(() => {
        closeBtn?.click();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
