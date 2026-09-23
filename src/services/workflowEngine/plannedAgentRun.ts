import { useWorkflowStore } from '@/store/workflowStore';
import {
  type GoalEvaluationResult,
  type WorkflowAgent,
} from '@/types/workflow';
import {
  buildDownstreamAgentPrompt,
  buildEntryAgentPrompt,
  type UpstreamOutput,
} from '@/services/workflowPromptBuilder';
import { readAgentInbox } from '@/services/workflowNotifier';
import {
  getBlockingFailures,
  getPredecessorIds,
} from '@/services/workflowDependencies';
import {
  buildAgentArtifactBaseName,
  WorkflowTranscriptManager,
} from './transcript';
import { type WorkflowRunSnapshot } from './runSnapshot';
import { type WorkflowEngineDeps } from './engineDeps';
import { executeAgent, type AgentExecutionHost } from './agentExecution';
import {
  persistOutputCodeArtifacts,
  saveOutputToFile,
  saveTranscriptToFile,
  type RunPersistenceHost,
} from './runPersistence';

export const MAX_TOTAL_STEPS = 50;

export interface PlannedAgentRunHost extends AgentExecutionHost, RunPersistenceHost {
  agentOutputs: Map<string, string>;
  transcripts: WorkflowTranscriptManager;
  deps: WorkflowEngineDeps;
  bumpTotalSteps(): number;
}

export async function runPlannedAgent(
  host: PlannedAgentRunHost,
  agent: WorkflowAgent,
  snapshot: WorkflowRunSnapshot,
  iteration: number,
  previousEvaluation: GoalEvaluationResult | null,
  failedAgents: Set<string>,
): Promise<void> {
  const store = useWorkflowStore.getState();
  const runId = host.currentRunId;
  const blockingFailures = getBlockingFailures(agent, snapshot.executableAgents, snapshot.connections, failedAgents);
  if (blockingFailures.length > 0) {
    store.setAgentStatusInInstance(snapshot.instanceId, agent.id, 'error');
    store.updateRunAgent(runId, agent.id, { status: 'skipped', endTime: host.deps.now() });
    return;
  }

  const nextSteps = host.bumpTotalSteps();
  if (nextSteps > MAX_TOTAL_STEPS) {
    throw new Error(`已达最大步数限制（${MAX_TOTAL_STEPS}步），工作流已停止`);
  }

  const predecessorIds = getPredecessorIds(agent.id, snapshot.executableAgents, snapshot.connections);
  const upstreams: UpstreamOutput[] = predecessorIds
    .filter((id) => host.agentOutputs.has(id))
    .map((id) => ({
      agent: snapshot.executableAgents.find((item) => item.id === id)!,
      output: host.agentOutputs.get(id)!,
    }));
  const inboxMessages = readAgentInbox(agent.id, host.currentRunId, snapshot.agents);
  const prompt = predecessorIds.length === 0 && inboxMessages.length === 0
    ? buildEntryAgentPrompt({
        projectGoal: snapshot.projectGoal,
        successCriteria: [...snapshot.successCriteria],
        agent,
        iteration,
        previousEvaluation,
        inboxMessages,
      })
    : buildDownstreamAgentPrompt(
        {
          projectGoal: snapshot.projectGoal,
          successCriteria: [...snapshot.successCriteria],
          agent,
          upstreams,
          iteration,
          previousEvaluation,
          inboxMessages,
        },
      );

  store.setRunning(true, agent.id);
  store.setAgentStatusInInstance(snapshot.instanceId, agent.id, 'running');
  store.updateRunAgent(runId, agent.id, {
    status: 'running',
    startTime: host.deps.now(),
    iteration,
  });

  try {
    const agentStart = host.deps.now();
    const output = await executeAgent(host, agent, prompt);
    const agentDuration = host.deps.now() - agentStart;
    if (agentDuration > 30_000) {
      // eslint-disable-next-line no-console
      console.warn(`[workflow] Agent "${agent.name}" (${agent.id}) took ${agentDuration}ms`);
    }
    if (!host.shouldAcceptRunMutation(runId)) {
      return;
    }

    await persistOutputCodeArtifacts(host, output);
    const artifactBaseName = buildAgentArtifactBaseName(agent);
    host.agentOutputs.set(agent.id, output);
    const outputFilePath = await saveOutputToFile(host, agent, artifactBaseName, output, runId);
    if (!host.shouldAcceptRunMutation(runId)) {
      return;
    }
    host.transcripts.record(agent.id, {
      timestamp: host.deps.now(),
      type: 'agent_completed',
      content: output,
    });
    const transcriptFilePath = await saveTranscriptToFile(host, agent, artifactBaseName, runId);
    if (!host.shouldAcceptRunMutation(runId)) {
      return;
    }
    store.setAgentStatusInInstance(snapshot.instanceId, agent.id, 'completed');
    store.clearAgentDirtyInInstance(snapshot.instanceId, agent.id);
    store.updateRunAgent(runId, agent.id, {
      status: 'completed',
      endTime: host.deps.now(),
      output: output.slice(0, 2000),
      iteration,
      outputFilePath: outputFilePath ?? undefined,
      transcriptFilePath: transcriptFilePath ?? undefined,
      artifactBaseName,
    });
    failedAgents.delete(agent.id);
    await host.deps.notify(agent, snapshot.agents, output, runId);
  } catch (error) {
    if (!host.shouldAcceptRunMutation(runId)) {
      return;
    }
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    host.agentOutputs.set(agent.id, `[[WORKFLOW:GOAL_NOT_REACHED]]\n${errorMessage}`);
    host.transcripts.record(agent.id, {
      timestamp: host.deps.now(),
      type: 'agent_error',
      content: errorMessage,
    });
    const artifactBaseName = buildAgentArtifactBaseName(agent);
    const transcriptFilePath = await saveTranscriptToFile(host, agent, artifactBaseName, runId);
    store.setAgentStatusInInstance(snapshot.instanceId, agent.id, 'error');
    store.updateRunAgent(runId, agent.id, {
      status: 'error',
      endTime: host.deps.now(),
      output: errorMessage.slice(0, 2000),
      iteration,
      transcriptFilePath: transcriptFilePath ?? undefined,
      artifactBaseName,
    });
    failedAgents.add(agent.id);
  }
}
