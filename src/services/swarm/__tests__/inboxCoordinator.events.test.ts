import { swarmEvents } from '../inboxCoordinator';

describe('swarmEvents subscriptions', () => {
  it('unsubscribes via the function returned from on()', () => {
    const handler = jest.fn();
    const unsubscribe = swarmEvents.on('task_result_received', handler);

    swarmEvents.emit('task_result_received', {
      teamId: 'team-1',
      leaderId: 'leader-1',
      fromAgentId: 'agent-1',
      taskId: 'task-1',
      content: 'done',
      messageId: 'message-1',
    });

    unsubscribe();

    swarmEvents.emit('task_result_received', {
      teamId: 'team-1',
      leaderId: 'leader-1',
      fromAgentId: 'agent-1',
      taskId: 'task-2',
      content: 'done again',
      messageId: 'message-2',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      content: 'done',
    }));
  });
});
