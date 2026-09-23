import { useWorkflowStore } from '@/store/workflowStore';
import {
  type GoalEvaluationResult,
  type WorkflowAgent,
} from '@/types/workflow';
import { evaluateGoalWithRules } from '@/services/workflowGoalEvaluator';
import {
  buildGoalEvaluationInstance,
  type WorkflowRunSnapshot,
} from './runSnapshot';
import { executeAgent, type AgentExecutionHost } from './agentExecution';

export interface GoalStepHost extends AgentExecutionHost {
  agentOutputs: Map<string, string>;
}

export function deriveWorkflowGoal(agents: WorkflowAgent[], explicitGoal?: string): string {
  if (explicitGoal?.trim()) {
    return explicitGoal.trim();
  }

  const entryAgents = agents.filter((agent) => !agent.inputFrom);
  const preferredAgents = entryAgents.length > 0 ? entryAgents : agents;
  const derivedLines = preferredAgents
    .map((agent) => {
      const parts = [agent.taskPrompt?.trim(), agent.task?.trim()].filter(Boolean);
      return parts.length > 0 ? `${agent.name}: ${parts.join(' | ')}` : null;
    })
    .filter((line): line is string => Boolean(line));

  return derivedLines.length > 0
    ? derivedLines.join('\n')
    : '请按照当前工作流中各个 Agent 的职责与配置依次完成任务。';
}

export async function updateGoalEvaluatorStatus(
  host: Pick<GoalStepHost, 'deps' | 'shouldAcceptRunMutation'>,
  instanceId: string,
  evaluatorAgentId: string | null | undefined,
  status: WorkflowAgent['status'],
  runId: string,
): Promise<void> {
  if (!evaluatorAgentId) return;
  if (!host.shouldAcceptRunMutation(runId)) return;
  const store = useWorkflowStore.getState();
  const instance = store.instances.find((item) => item.id === instanceId);
  const evaluatorAgent = instance?.agents.find((agent) => agent.id === evaluatorAgentId);
  if (evaluatorAgent && evaluatorAgent.role !== 'goal-evaluator') {
    return;
  }
  store.setAgentStatusInInstance(instanceId, evaluatorAgentId, status);
  store.updateRunAgent(runId, evaluatorAgentId, {
    status: status === 'completed' ? 'completed' : status === 'running' ? 'running' : 'error',
    endTime: status === 'running' ? undefined : host.deps.now(),
  });
}

export async function evaluateGoalStep(
  host: GoalStepHost,
  snapshot: WorkflowRunSnapshot,
  iteration: number,
): Promise<GoalEvaluationResult> {
  const runId = host.currentRunId;
  const evaluationInstance = buildGoalEvaluationInstance(snapshot);

  // eslint-disable-next-line no-console
  console.info(`[workflow] Entering evaluateGoalStep (iter ${iteration}), runId=${runId}, evaluator=${snapshot.goalEvaluatorAgentId ?? 'builtin'}`);
  const store = useWorkflowStore.getState();
  store.setRunning(true, snapshot.goalEvaluatorAgentId ?? null);
  await updateGoalEvaluatorStatus(host, snapshot.instanceId, snapshot.goalEvaluatorAgentId, 'running', runId);

  try {
    const evaluateGoalWithTimeout = async (): Promise<GoalEvaluationResult> => {
      const GOAL_EVAL_TIMEOUT_MS = 300_000;
      const evalAbortController = new AbortController();
      const mainSignal = host.abortController?.signal;

      const onMainAbort = () => evalAbortController.abort();
      if (mainSignal) {
        if (mainSignal.aborted) {
          evalAbortController.abort();
        } else {
          mainSignal.addEventListener('abort', onMainAbort, { once: true });
        }
      }

      const timer = setTimeout(() => {
        evalAbortController.abort();
      }, GOAL_EVAL_TIMEOUT_MS);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        (timer as unknown as { unref: () => void }).unref();
      }

      try {
        const result = await host.deps.evaluateGoal(
          {
            instance: evaluationInstance,
            agents: snapshot.agents,
            agentOutputs: host.agentOutputs,
            iteration,
          },
          {
            runAgent: (agent, prompt, options) => executeAgent(host, agent, prompt, {
              disableStreaming: true,
              systemPromptOverride: options?.systemPromptOverride,
              signal: evalAbortController.signal,
              noTools: true,
              allowedTools: [],
            }),
          },
        );
        return result;
      } catch (err) {
        if (mainSignal?.aborted) {
          throw err;
        }
        const ruleResult = evaluateGoalWithRules({
          instance: evaluationInstance,
          agents: snapshot.agents,
          agentOutputs: host.agentOutputs,
          iteration,
        });
        // eslint-disable-next-line no-console
        console.warn(`[workflow] Goal evaluation failed or timed out (${err instanceof Error ? err.message : String(err)}). Falling back to rule evaluation.`, ruleResult);
        return {
          ...ruleResult,
          reasoning: `${ruleResult.reasoning}（LLM evaluator 超时/异常，已回退到规则判定。）`,
        };
      } finally {
        clearTimeout(timer);
        if (mainSignal) {
          mainSignal.removeEventListener('abort', onMainAbort);
        }
      }
    };

    const result = await evaluateGoalWithTimeout();
    // eslint-disable-next-line no-console
    console.info(`[workflow] Exiting evaluateGoalStep (iter ${iteration}): reached=${result.reached}, hint=${result.nextAgentIdHint ?? 'none'}, reasoning="${result.reasoning.slice(0, 100)}"`);

    await updateGoalEvaluatorStatus(host, snapshot.instanceId, snapshot.goalEvaluatorAgentId, 'completed', runId);
    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[workflow] Exiting evaluateGoalStep (iter ${iteration}) with error:`, error);
    await updateGoalEvaluatorStatus(host, snapshot.instanceId, snapshot.goalEvaluatorAgentId, 'error', runId);
    throw error;
  }
}
