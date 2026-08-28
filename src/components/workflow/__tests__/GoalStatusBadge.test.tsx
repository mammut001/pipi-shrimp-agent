/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { GoalStatusBadge } from '../GoalStatusBadge';
import { useWorkflowStore } from '@/store/workflowStore';

describe('GoalStatusBadge', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      instances: [
        {
          id: 'inst-1',
          name: 'Workflow 1',
          projectGoal: 'Build feature',
          successCriteria: ["Tests pass"],
          goalEvaluatorAgentId: null,
          maxGoalIterations: 5,
          agents: [],
          connections: [],
          workflowRuns: [
            {
              id: 'run-1',
              title: 'Workflow 1',
              projectGoal: 'Build feature',
              successCriteria: ["Tests pass"],
              status: 'idle',
              startTime: Date.now(),
              currentIteration: 0,
              goalEvaluations: [],
              reachedGoal: false,
              agents: [],
            },
          ],
          activeRunId: 'run-1',
          dirtyAgentIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      currentInstanceId: 'inst-1',
      isRunning: false,
    });
  });

  it('renders Not Started status for idle workflow before run', () => {
    render(<GoalStatusBadge />);
    expect(screen.getByText('⚪')).toBeTruthy();
    expect(screen.getByText('Iter 0/5')).toBeTruthy();
    expect(screen.getByText('workflow.goalStatus.notStarted')).toBeTruthy();
  });

  it('renders In Progress status when agent is executing', () => {
    useWorkflowStore.setState({ isRunning: true, currentRunningAgentId: 'agent-1' });
    render(<GoalStatusBadge />);
    expect(screen.getByText('⚡')).toBeTruthy();
    expect(screen.getByText('workflow.goalStatus.inProgress')).toBeTruthy();
  });

  it('renders Evaluating status when goal evaluation is running', () => {
    useWorkflowStore.setState({ isRunning: true, currentRunningAgentId: null });
    render(<GoalStatusBadge />);
    expect(screen.getByText('⏳')).toBeTruthy();
    expect(screen.getByText('workflow.goalStatus.evaluating')).toBeTruthy();
  });
});
