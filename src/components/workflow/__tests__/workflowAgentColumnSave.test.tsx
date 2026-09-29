/**
 * @jest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unmock('@/i18n');

jest.mock('@/services/workflowEngine', () => ({
  workflowEngine: {
    start: jest.fn(async () => undefined),
    getIsRunning: () => false,
  },
}));

jest.mock('../WorkflowGoalPanel', () => ({
  WorkflowGoalPanel: () => createElement('div', { 'data-testid': 'goal-panel' }, 'goal-panel'),
}));

jest.mock('../WorkflowExecutionBar', () => ({
  WorkflowExecutionBar: () => createElement('div', { 'data-testid': 'execution-bar' }, 'execution-bar'),
}));

const mockSelection: { id: string } = { id: '' };

jest.mock('../WorkflowCanvas', () => ({
  WorkflowCanvas: ({
    onAgentSelect,
  }: {
    onAgentSelect: (id: string | null) => void;
  }) => createElement('button', {
    type: 'button',
    onClick: () => onAgentSelect(mockSelection.id),
  }, 'select-agent'),
}));

jest.mock('../WorkflowOutputPanel', () => ({
  WorkflowOutputPanel: () => createElement('div', { 'data-testid': 'workflow-output' }, 'workflow-output'),
}));

jest.mock('../WorkflowRunHistory', () => ({
  WorkflowRunHistory: () => createElement('div', { 'data-testid': 'workflow-history' }, 'workflow-history'),
}));

import { t } from '@/i18n';
import { useWorkflowStore } from '@/store/workflowStore';
import { WorkflowView } from '../WorkflowView';

function checkboxForLabel(container: HTMLElement, text: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label')).filter((node) => (
    node.textContent?.includes(text) && node.querySelector('input[type="checkbox"]')
  ));
  if (labels.length !== 1) {
    throw new Error(`Expected one checkbox label for ${text}, found ${labels.length}. Text: ${container.textContent?.slice(0, 500)}`);
  }
  const input = labels[0].querySelector('input[type="checkbox"]');
  if (!input) throw new Error(`Missing checkbox for ${text}`);
  return input as HTMLInputElement;
}

async function setCheckbox(user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement, checked: boolean): Promise<void> {
  if (input.checked === checked) return;
  await user.click(input);
}

async function replaceTextInput(user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement, value: string): Promise<void> {
  await user.clear(input);
  if (value) await user.type(input, value);
}

function writerAgent() {
  const state = useWorkflowStore.getState();
  const instance = state.instances.find((item) => item.id === state.currentInstanceId);
  const agent = instance?.agents.find((item) => item.name === 'Writer');
  if (!agent) throw new Error('Writer agent is missing from the store');
  return agent;
}

async function mountColumn(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(WorkflowView));
  });
  const select = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'select-agent');
  if (!select) throw new Error('select-agent button missing');
  await act(async () => {
    select.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return { container, root };
}

async function checkNotifyAndFullOutput(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
): Promise<void> {
  await setCheckbox(user, checkboxForLabel(container, 'Developer'), true);
  await setCheckbox(user, checkboxForLabel(container, t('workflow.notifyFullOutput')), true);
}

describe('workflow agent column save', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    document.body.innerHTML = '';
    useWorkflowStore.setState({ isRunning: false, currentRunningAgentId: null });
    for (const instance of [...useWorkflowStore.getState().instances]) {
      useWorkflowStore.getState().deleteInstance(instance.id);
    }
    useWorkflowStore.getState().createInstance('Column save');
    const writer = useWorkflowStore.getState().addAgent({
      name: 'Writer',
      task: 'Draft the note',
      role: 'writer',
    });
    useWorkflowStore.getState().addAgent({
      name: 'Developer',
      task: 'Implement',
      role: 'developer',
    });
    mockSelection.id = writer.id;
  });

  it('upper 保存 persists notify-on-complete and 发送完整输出', async () => {
    expect(t('workflow.notifyFullOutput')).toBe('发送完整输出');
    expect(t('workflow.save')).toBe('保存');
    const user = userEvent.setup();
    const developer = useWorkflowStore.getState().getCurrentInstance()?.agents.find((agent) => agent.name === 'Developer');
    if (!developer) throw new Error('Developer missing');

    const mounted = await mountColumn();
    const taskInput = mounted.container.querySelector(
      `input[placeholder="${t('workflow.agentTaskLabelPlaceholder')}"]`,
    ) as HTMLInputElement | null;
    if (!taskInput) throw new Error('task input missing');

    expect(writerAgent().notifyOnComplete ?? []).toEqual([]);
    await replaceTextInput(user, taskInput, 'Updated task label');
    await checkNotifyAndFullOutput(user, mounted.container);

    const upperSave = mounted.container.querySelector('[data-testid="workflow-task-save"]') as HTMLButtonElement | null;
    if (!upperSave) throw new Error('upper save missing');
    expect(upperSave.textContent).toContain('保存');
    await user.click(upperSave);

    expect(writerAgent().notifyOnComplete).toEqual([developer.id]);
    expect(writerAgent().notifyFullOutputAgentIds).toEqual([developer.id]);
    expect(writerAgent().task).toBe('Updated task label');

    await act(async () => {
      mounted.root.unmount();
    });
    mounted.container.remove();

    const remounted = await mountColumn();
    expect(checkboxForLabel(remounted.container, 'Developer').checked).toBe(true);
    expect(checkboxForLabel(remounted.container, '发送完整输出').checked).toBe(true);
    const remountedTask = remounted.container.querySelector(
      `input[placeholder="${t('workflow.agentTaskLabelPlaceholder')}"]`,
    ) as HTMLInputElement | null;
    expect(remountedTask?.value).toBe('Updated task label');

    await act(async () => {
      remounted.root.unmount();
    });
    remounted.container.remove();
  });

  it('lower 保存 persists the same notify and full-output fields', async () => {
    const user = userEvent.setup();
    const developer = useWorkflowStore.getState().getCurrentInstance()?.agents.find((agent) => agent.name === 'Developer');
    if (!developer) throw new Error('Developer missing');

    const mounted = await mountColumn();
    const taskInput = mounted.container.querySelector(
      `input[placeholder="${t('workflow.agentTaskLabelPlaceholder')}"]`,
    ) as HTMLInputElement | null;
    if (!taskInput) throw new Error('task input missing');
    await replaceTextInput(user, taskInput, 'Lower save task');
    await checkNotifyAndFullOutput(user, mounted.container);

    const lowerSave = mounted.container.querySelector('[data-testid="workflow-config-save"]') as HTMLButtonElement | null;
    if (!lowerSave) throw new Error('lower save missing');
    expect(lowerSave.textContent).toContain('保存');
    await user.click(lowerSave);

    expect(writerAgent().notifyOnComplete).toEqual([developer.id]);
    expect(writerAgent().notifyFullOutputAgentIds).toEqual([developer.id]);
    expect(writerAgent().task).toBe('Lower save task');

    await act(async () => {
      mounted.root.unmount();
    });
    mounted.container.remove();

    const remounted = await mountColumn();
    expect(checkboxForLabel(remounted.container, 'Developer').checked).toBe(true);
    expect(checkboxForLabel(remounted.container, '发送完整输出').checked).toBe(true);
    expect(writerAgent().notifyOnComplete).toEqual([developer.id]);
    expect(writerAgent().notifyFullOutputAgentIds).toEqual([developer.id]);

    await act(async () => {
      remounted.root.unmount();
    });
    remounted.container.remove();
  });
});
