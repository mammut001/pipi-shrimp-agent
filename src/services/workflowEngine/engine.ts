import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '@/store/workflowStore';
import { useUIStore } from '@/store/uiStore';
import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  updateDiagnosticsTask,
} from '@/store/taskRegistryStore';
import {
  type GoalEvaluationResult,
  type WorkflowAgent,
  type WorkflowConnection,
  type WorkflowInstance,
  type WorkflowRun,
} from '@/types/workflow';
import { DEFAULT_MAX_GOAL_ITERATIONS } from '@/services/workflow/defaults';
import {
  formatWorkflowValidationErrors,
  validateWorkflowForRun,
} from '@/services/workflow/validation';
import {
  buildDownstreamAgentPrompt,
  buildEntryAgentPrompt,
  type UpstreamOutput,
} from '@/services/workflowPromptBuilder';
import { evaluateWorkflowGoal } from '@/services/workflowGoalEvaluator';
import { readAgentInbox, notifyOnComplete } from '@/services/workflowNotifier';
import {
  getBlockingFailures,
  getPredecessorIds,
} from '@/services/workflowDependencies';
import {
  buildExecutionPlan,
  evaluateNextAgent,
  selectReentryAgents,
} from './phases';
import {
  runAgentWithRetry,
  type StreamChunkCallback,
} from './agentRunner';
import {
  WorkflowTranscriptManager,
  buildAgentArtifactBaseName,
  renderTranscriptFile,
  type WorkflowTranscriptEntry,
} from './transcript';
import { workflowRunFileService } from '@/services/workflow/runFileService';

const MAX_TOTAL_STEPS = 50;

interface WorkflowEngineDeps {
  createRunDirectory: (runId: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  writeRunFile?: (runDirectory: string, relativePath: string, content: string) => Promise<string>;
  runAgent: typeof runAgentWithRetry;
  evaluateGoal: typeof evaluateWorkflowGoal;
  notify: typeof notifyOnComplete;
  now: () => number;
}

interface WorkflowRunSnapshot {
  instanceId: string;
  instanceName: string;
  projectGoal: string;
  successCriteria: string;
  maxGoalIterations: number;
  goalEvaluatorAgentId: string | null;
  agents: WorkflowAgent[];
  executableAgents: WorkflowAgent[];
  connections: WorkflowConnection[];
  dirtyAgentIds: string[];
}

function defaultDeps(): WorkflowEngineDeps {
  return {
    createRunDirectory: (runId) => invoke<string>('create_workflow_run_directory', { runId }),
    writeRunFile: (runDirectory, relativePath, content) => (
      workflowRunFileService.writeRunFile(runDirectory, relativePath, content)
    ),
    runAgent: runAgentWithRetry,
    evaluateGoal: evaluateWorkflowGoal,
    notify: notifyOnComplete,
    now: () => Date.now(),
  };
}

function cloneWorkflowAgent(agent: WorkflowAgent): WorkflowAgent {
  return {
    ...agent,
    position: { ...agent.position },
    outputRoutes: (agent.outputRoutes ?? []).map((route) => ({ ...route })),
    execution: { ...agent.execution },
    model: agent.model ? { ...agent.model } : undefined,
    retryPolicy: agent.retryPolicy
      ? {
          ...agent.retryPolicy,
          fallbackConfigIds: [...(agent.retryPolicy.fallbackConfigIds ?? [])],
        }
      : undefined,
    notifyOnComplete: [...(agent.notifyOnComplete ?? [])],
  };
}

function cloneWorkflowConnection(connection: WorkflowConnection): WorkflowConnection {
  return { ...connection };
}

function freezeWorkflowRunSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  for (const agent of snapshot.agents) {
    Object.freeze(agent.position);
    Object.freeze(agent.outputRoutes);
    Object.freeze(agent.execution);
    if (agent.model) {
      Object.freeze(agent.model);
    }
    if (agent.retryPolicy) {
      Object.freeze(agent.retryPolicy.fallbackConfigIds ?? []);
      Object.freeze(agent.retryPolicy);
    }
    Object.freeze(agent.notifyOnComplete ?? []);
    Object.freeze(agent);
  }

  for (const connection of snapshot.connections) {
    Object.freeze(connection);
  }

  Object.freeze(snapshot.agents);
  Object.freeze(snapshot.executableAgents);
  Object.freeze(snapshot.connections);
  Object.freeze(snapshot.dirtyAgentIds);

  return Object.freeze(snapshot);
}

function createWorkflowRunSnapshot(instance: WorkflowInstance): WorkflowRunSnapshot {
  const agents = instance.agents.map(cloneWorkflowAgent);
  const connections = instance.connections.map(cloneWorkflowConnection);

  return freezeWorkflowRunSnapshot({
    instanceId: instance.id,
    instanceName: instance.name,
    projectGoal: instance.projectGoal?.trim() || '',
    successCriteria: instance.successCriteria?.trim() || '',
    maxGoalIterations: instance.maxGoalIterations ?? DEFAULT_MAX_GOAL_ITERATIONS,
    goalEvaluatorAgentId: instance.goalEvaluatorAgentId ?? null,
    agents,
    executableAgents: agents.filter((agent) => agent.role !== 'goal-evaluator'),
    connections,
    dirtyAgentIds: [...(instance.dirtyAgentIds ?? [])],
  });
}

function buildGoalEvaluationInstance(snapshot: WorkflowRunSnapshot): WorkflowInstance {
  return {
    id: snapshot.instanceId,
    name: snapshot.instanceName,
    projectGoal: snapshot.projectGoal,
    successCriteria: snapshot.successCriteria,
    goalEvaluatorAgentId: snapshot.goalEvaluatorAgentId,
    maxGoalIterations: snapshot.maxGoalIterations,
    agents: snapshot.agents,
    connections: snapshot.connections,
    workflowRuns: [],
    activeRunId: null,
    dirtyAgentIds: [...snapshot.dirtyAgentIds],
    createdAt: 0,
    updatedAt: 0,
  };
}

export class WorkflowEngine {
  private readonly deps: WorkflowEngineDeps;
  private readonly transcripts = new WorkflowTranscriptManager();
  private readonly agentOutputs = new Map<string, string>();
  private isRunning = false;
  private stopRequested = false;
  private totalSteps = 0;
  private workingDirectory = '';
  private currentRunId = '';
  private currentInstanceId = '';
  private onStreamChunk?: StreamChunkCallback;

  constructor(deps?: Partial<WorkflowEngineDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  setStreamChunkCallback(cb: StreamChunkCallback): void {
    this.onStreamChunk = cb;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir;
  }

  getCurrentRunId(): string {
    return this.currentRunId;
  }

  getTranscript(agentId: string): WorkflowTranscriptEntry[] {
    return this.transcripts.get(agentId);
  }

  reset(): void {
    const store = useWorkflowStore.getState();
    const instanceId = this.currentInstanceId || store.currentInstanceId || '';

    if (this.currentRunId) {
      store.updateWorkflowRun(this.currentRunId, {
        status: 'stopped',
        endTime: this.deps.now(),
        reachedGoal: false,
      });
    }

    if (instanceId) {
      store.resetAllStatuses(instanceId);
    }

    store.setRunning(false, null);
    this.isRunning = false;
    this.stopRequested = false;
    this.totalSteps = 0;
    this.agentOutputs.clear();
    this.transcripts.clear();
    this.workingDirectory = '';
    this.currentRunId = '';
    this.currentInstanceId = '';
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const store = useWorkflowStore.getState();
    if (this.currentRunId) {
      store.updateWorkflowRun(this.currentRunId, {
        status: 'stopped',
        endTime: this.deps.now(),
        reachedGoal: false,
      });
    }
    store.setRunning(false, null);
  }

  private shouldAcceptRunMutation(runId: string): boolean {
    return !this.stopRequested && this.currentRunId === runId;
  }

  private deriveWorkflowGoal(agents: WorkflowAgent[], explicitGoal?: string): string {
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

  private async executeAgent(
    agent: WorkflowAgent,
    prompt: string,
    options?: { systemPromptOverride?: string; disableStreaming?: boolean },
  ): Promise<string> {
    const runId = this.currentRunId;

    return this.deps.runAgent(
      agent,
      prompt,
      {
        runId,
        onStreamChunk: options?.disableStreaming ? undefined : ((agentId, chunk, fullContent) => {
          if (!this.shouldAcceptRunMutation(runId)) return;
          this.onStreamChunk?.(agentId, chunk, fullContent);
        }),
        transcript: this.transcripts,
      },
      { systemPromptOverride: options?.systemPromptOverride },
    );
  }

  private async writeRunFile(relativePath: string, content: string): Promise<string | null> {
    if (!this.workingDirectory) return null;
    if (this.deps.writeRunFile) {
      return this.deps.writeRunFile(this.workingDirectory, relativePath, content);
    }

    if (this.deps.writeFile) {
      const absolutePath = workflowRunFileService.resolvePath(this.workingDirectory, relativePath);
      await this.deps.writeFile(absolutePath, content);
      return absolutePath;
    }

    return null;
  }

  private async saveOutputToFile(agent: WorkflowAgent, artifactBaseName: string, output: string, runId: string): Promise<string | null> {
    if (!this.shouldAcceptRunMutation(runId)) return null;
    const content = `<!--
Agent: ${agent.name}
Executed: ${new Date(this.deps.now()).toLocaleString()}
Run ID: ${runId}
-->

${output}
`;
    return this.writeRunFile(`${artifactBaseName}-output.md`, content);
  }

  private async saveTranscriptToFile(agent: WorkflowAgent, artifactBaseName: string, runId: string): Promise<string | null> {
    if (!this.shouldAcceptRunMutation(runId)) return null;
    const entries = this.transcripts.get(agent.id);
    if (entries.length === 0) return null;
    const content = renderTranscriptFile(agent.id, runId, entries);
    return this.writeRunFile(`${artifactBaseName}-transcript.md`, content);
  }

  private async updateGoalEvaluatorStatus(
    instanceId: string,
    evaluatorAgentId: string | null | undefined,
    status: WorkflowAgent['status'],
    runId: string,
  ): Promise<void> {
    if (!evaluatorAgentId) return;
    if (!this.shouldAcceptRunMutation(runId)) return;
    const store = useWorkflowStore.getState();
    store.setAgentStatusInInstance(instanceId, evaluatorAgentId, status);
    store.updateRunAgent(runId, evaluatorAgentId, {
      status: status === 'completed' ? 'completed' : status === 'running' ? 'running' : 'error',
      endTime: status === 'running' ? undefined : this.deps.now(),
    });
  }

  private async performGoalEvaluation(
    snapshot: WorkflowRunSnapshot,
    iteration: number,
  ): Promise<GoalEvaluationResult> {
    const runId = this.currentRunId;
    const evaluationInstance = buildGoalEvaluationInstance(snapshot);

    await this.updateGoalEvaluatorStatus(snapshot.instanceId, snapshot.goalEvaluatorAgentId, 'running', runId);

    try {
      const result = await this.deps.evaluateGoal(
        {
          instance: evaluationInstance,
          agents: snapshot.agents,
          agentOutputs: this.agentOutputs,
          iteration,
        },
        {
          runAgent: (agent, prompt, options) => this.executeAgent(agent, prompt, {
            disableStreaming: true,
            systemPromptOverride: options?.systemPromptOverride,
          }),
        },
      );

      await this.updateGoalEvaluatorStatus(snapshot.instanceId, snapshot.goalEvaluatorAgentId, 'completed', runId);
      return result;
    } catch (error) {
      await this.updateGoalEvaluatorStatus(snapshot.instanceId, snapshot.goalEvaluatorAgentId, 'error', runId);
      throw error;
    }
  }

  private async runPlannedAgent(
    agent: WorkflowAgent,
    snapshot: WorkflowRunSnapshot,
    iteration: number,
    previousEvaluation: GoalEvaluationResult | null,
    failedAgents: Set<string>,
  ): Promise<void> {
    const store = useWorkflowStore.getState();
    const runId = this.currentRunId;
    const blockingFailures = getBlockingFailures(agent, snapshot.executableAgents, snapshot.connections, failedAgents);
    if (blockingFailures.length > 0) {
      store.setAgentStatusInInstance(snapshot.instanceId, agent.id, 'error');
      store.updateRunAgent(runId, agent.id, { status: 'skipped', endTime: this.deps.now() });
      return;
    }

    this.totalSteps += 1;
    if (this.totalSteps > MAX_TOTAL_STEPS) {
      throw new Error(`已达最大步数限制（${MAX_TOTAL_STEPS}步），工作流已停止`);
    }

    const predecessorIds = getPredecessorIds(agent.id, snapshot.executableAgents, snapshot.connections);
    const upstreams: UpstreamOutput[] = predecessorIds
      .filter((id) => this.agentOutputs.has(id))
      .map((id) => ({
        agent: snapshot.executableAgents.find((item) => item.id === id)!,
        output: this.agentOutputs.get(id)!,
      }));
    const inboxMessages = readAgentInbox(agent.id, this.currentRunId, snapshot.agents);
    const prompt = predecessorIds.length === 0 && inboxMessages.length === 0
      ? buildEntryAgentPrompt({
          projectGoal: snapshot.projectGoal,
          successCriteria: snapshot.successCriteria,
          agent,
          iteration,
          previousEvaluation,
          inboxMessages,
        })
      : buildDownstreamAgentPrompt(
          {
            projectGoal: snapshot.projectGoal,
            successCriteria: snapshot.successCriteria,
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
      startTime: this.deps.now(),
      iteration,
    });

    try {
      const output = await this.executeAgent(agent, prompt);
      if (!this.shouldAcceptRunMutation(runId)) {
        return;
      }

      const artifactBaseName = buildAgentArtifactBaseName(agent);
      this.agentOutputs.set(agent.id, output);
      const outputFilePath = await this.saveOutputToFile(agent, artifactBaseName, output, runId);
      if (!this.shouldAcceptRunMutation(runId)) {
        return;
      }
      this.transcripts.record(agent.id, {
        timestamp: this.deps.now(),
        type: 'agent_completed',
        content: output,
      });
      const transcriptFilePath = await this.saveTranscriptToFile(agent, artifactBaseName, runId);
      if (!this.shouldAcceptRunMutation(runId)) {
        return;
      }
      store.setAgentStatusInInstance(snapshot.instanceId, agent.id, 'completed');
      store.clearAgentDirtyInInstance(snapshot.instanceId, agent.id);
      store.updateRunAgent(runId, agent.id, {
        status: 'completed',
        endTime: this.deps.now(),
        output: output.slice(0, 2000),
        iteration,
        outputFilePath: outputFilePath ?? undefined,
        transcriptFilePath: transcriptFilePath ?? undefined,
        artifactBaseName,
      });
      failedAgents.delete(agent.id);
      await this.deps.notify(agent, snapshot.agents, output, runId);
    } catch (error) {
      if (!this.shouldAcceptRunMutation(runId)) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      this.agentOutputs.set(agent.id, `[[WORKFLOW:GOAL_NOT_REACHED]]\n${errorMessage}`);
      this.transcripts.record(agent.id, {
        timestamp: this.deps.now(),
        type: 'agent_error',
        content: errorMessage,
      });
      const artifactBaseName = buildAgentArtifactBaseName(agent);
      const transcriptFilePath = await this.saveTranscriptToFile(agent, artifactBaseName, runId);
      store.setAgentStatusInInstance(snapshot.instanceId, agent.id, 'error');
      store.updateRunAgent(runId, agent.id, {
        status: 'error',
        endTime: this.deps.now(),
        output: errorMessage.slice(0, 2000),
        iteration,
        transcriptFilePath: transcriptFilePath ?? undefined,
        artifactBaseName,
      });
      failedAgents.add(agent.id);
    }
  }

  async start(userPrompt?: string): Promise<void> {
    if (this.isRunning) return;

    const store = useWorkflowStore.getState();
    let instance: WorkflowInstance;

    try {
      instance = store.getCurrentInstanceOrThrow();
    } catch {
      useUIStore.getState().addNotification('error', '请先创建一个 Workflow');
      return;
    }

    const configuredGoal = instance.projectGoal?.trim() || userPrompt?.trim() || '';
    const successCriteria = instance.successCriteria?.trim() || '';
    const validationResult = validateWorkflowForRun({
      ...instance,
      projectGoal: configuredGoal,
      successCriteria,
    });

    if (!validationResult.valid) {
      console.error('[workflow] validation failed\n' + formatWorkflowValidationErrors(validationResult), validationResult.errors);
      useUIStore.getState().addNotification('error', validationResult.firstError?.message ?? '当前 Workflow 配置无效，无法运行。');
      return;
    }

    const projectGoal = this.deriveWorkflowGoal(instance.agents, configuredGoal);
    const snapshot = createWorkflowRunSnapshot({
      ...instance,
      projectGoal,
      successCriteria,
    });
    const localRunId = crypto.randomUUID();

    this.isRunning = true;
    this.stopRequested = false;
    this.totalSteps = 0;
    this.currentRunId = localRunId;
    this.currentInstanceId = snapshot.instanceId;
    this.agentOutputs.clear();
    this.transcripts.clear();

    registerDiagnosticsTask({
      id: localRunId,
      kind: 'workflow',
      source: `instance:${snapshot.instanceId}`,
      state: 'created',
      cancelable: true,
      title: projectGoal.slice(0, 120),
    });
    registerDiagnosticsTaskCancel(localRunId, async () => {
      await this.stop();
    });

    store.resetAllStatuses(snapshot.instanceId);
    store.setRunning(true, null);
    store.setActiveRunId(localRunId, snapshot.instanceId);

    try {
      this.workingDirectory = await this.deps.createRunDirectory(localRunId);
    } catch {
      this.workingDirectory = '';
    }

    const run: WorkflowRun = {
      id: localRunId,
      title: `${projectGoal.slice(0, 60)}${projectGoal.length > 60 ? '...' : ''}`,
      projectGoal,
      successCriteria,
      status: 'running',
      startTime: this.deps.now(),
      agents: snapshot.agents.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        status: 'pending',
      })),
      runDirectory: this.workingDirectory,
      currentIteration: 0,
      goalEvaluations: [],
      reachedGoal: false,
    };
    store.addWorkflowRun(run, snapshot.instanceId);

    updateDiagnosticsTask(localRunId, {
      state: 'running',
      cancelable: true,
      detail: projectGoal.slice(0, 240),
    });

    let reachedGoal = false;
    let lastEvaluation: GoalEvaluationResult | null = null;
    let dirtyAgentIds = [...snapshot.dirtyAgentIds];
    const failedAgents = new Set<string>();
    const executableAgents = snapshot.executableAgents;

    try {
      const maxIterations = snapshot.maxGoalIterations ?? DEFAULT_MAX_GOAL_ITERATIONS;

      for (let iteration = 1; iteration <= maxIterations && !this.stopRequested; iteration += 1) {
        store.updateWorkflowRun(localRunId, { currentIteration: iteration });
        for (const dirtyAgentId of dirtyAgentIds) {
          store.clearAgentDirtyInInstance(snapshot.instanceId, dirtyAgentId);
        }

        const executionPlan = buildExecutionPlan(executableAgents, snapshot.connections, dirtyAgentIds);
        dirtyAgentIds = [];

        for (const agent of executionPlan) {
          if (this.stopRequested) break;
          await this.runPlannedAgent(
            agent,
            snapshot,
            iteration,
            lastEvaluation,
            failedAgents,
          );
        }

        if (this.stopRequested) {
          break;
        }

        lastEvaluation = await this.performGoalEvaluation(snapshot, iteration);
        if (!this.shouldAcceptRunMutation(localRunId)) {
          break;
        }
        store.appendGoalEvaluation(localRunId, lastEvaluation);

        if (lastEvaluation.reached) {
          reachedGoal = true;
          break;
        }

        const reentryAgentIds = selectReentryAgents({
          evaluation: lastEvaluation,
          agents: executableAgents,
          connections: snapshot.connections,
          agentOutputs: this.agentOutputs,
        });

        if (reentryAgentIds.length === 0) {
          break;
        }

        dirtyAgentIds = reentryAgentIds;
        for (const agentId of reentryAgentIds) {
          store.markAgentDirtyInInstance(snapshot.instanceId, agentId);
        }
      }

      const finalStatus = this.stopRequested ? 'stopped' : 'completed';
      store.updateWorkflowRun(localRunId, {
        status: finalStatus,
        endTime: this.deps.now(),
        reachedGoal,
      });

      updateDiagnosticsTask(localRunId, {
        state: this.stopRequested ? 'cancelled' : 'completed',
        cancelable: false,
      });

      useUIStore.getState().addNotification(
        this.stopRequested ? 'info' : reachedGoal ? 'success' : 'warning',
        this.stopRequested
          ? '⏹ 工作流已停止'
          : reachedGoal
            ? `✅ 工作流执行完成！${this.workingDirectory ? `\n输出保存在: ${this.workingDirectory}` : ''}`
            : '⚠️ 工作流已完成，但项目目标仍未达成。',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      store.updateWorkflowRun(localRunId, {
        status: 'error',
        endTime: this.deps.now(),
        reachedGoal: false,
      });
      updateDiagnosticsTask(localRunId, {
        state: 'failed',
        cancelable: false,
        error: errorMessage,
      });
      useUIStore.getState().addNotification('error', `❌ 工作流失败：${errorMessage}`);
    } finally {
      if (this.currentRunId === localRunId) {
        this.isRunning = false;
        this.stopRequested = false;
        this.totalSteps = 0;
        store.setRunning(false, null);
        this.currentRunId = '';
        this.currentInstanceId = '';
        this.workingDirectory = '';
      }
    }
  }

  // Backward-compatible helper for tests and legacy routing logic.
  evaluateNextAgent(
    currentAgent: WorkflowAgent,
    output: string,
    connections: Parameters<typeof evaluateNextAgent>[2],
    agents: Parameters<typeof evaluateNextAgent>[3],
    agentStatus: Parameters<typeof evaluateNextAgent>[4] = 'completed',
  ): WorkflowAgent | null {
    return evaluateNextAgent(currentAgent, output, connections, agents, agentStatus);
  }
}

export const workflowEngine = new WorkflowEngine();
export default WorkflowEngine;
