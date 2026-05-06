import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '@/store/workflowStore';
import { useUIStore } from '@/store/uiStore';
import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  updateDiagnosticsTask,
} from '@/store/taskRegistryStore';
import {
  DEFAULT_MAX_GOAL_ITERATIONS,
  type GoalEvaluationResult,
  type WorkflowAgent,
  type WorkflowRun,
} from '@/types/workflow';
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

const MAX_TOTAL_STEPS = 50;

interface WorkflowEngineDeps {
  createRunDirectory: (runId: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  runAgent: typeof runAgentWithRetry;
  evaluateGoal: typeof evaluateWorkflowGoal;
  notify: typeof notifyOnComplete;
  now: () => number;
}

function defaultDeps(): WorkflowEngineDeps {
  return {
    createRunDirectory: (runId) => invoke<string>('create_workflow_run_directory', { runId }),
    writeFile: (path, content) => invoke('write_file', { path, content, workDir: null }),
    runAgent: runAgentWithRetry,
    evaluateGoal: evaluateWorkflowGoal,
    notify: notifyOnComplete,
    now: () => Date.now(),
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
    this.isRunning = false;
    this.stopRequested = false;
    this.totalSteps = 0;
    this.agentOutputs.clear();
    this.transcripts.clear();
    this.workingDirectory = '';
    useWorkflowStore.getState().resetAllStatuses();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    useWorkflowStore.getState().setRunning(false, null);
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
    return this.deps.runAgent(
      agent,
      prompt,
      {
        runId: this.currentRunId,
        onStreamChunk: options?.disableStreaming ? undefined : this.onStreamChunk,
        transcript: this.transcripts,
      },
      { systemPromptOverride: options?.systemPromptOverride },
    );
  }

  private async saveOutputToFile(agent: WorkflowAgent, output: string): Promise<void> {
    if (!this.workingDirectory) return;
    const baseName = buildAgentArtifactBaseName(agent);
    const filePath = `${this.workingDirectory}/${baseName}-output.md`;
    const content = `<!--
Agent: ${agent.name}
Executed: ${new Date(this.deps.now()).toLocaleString()}
Run ID: ${this.currentRunId}
-->

${output}
`;
    await this.deps.writeFile(filePath, content);
  }

  private async saveTranscriptToFile(agent: WorkflowAgent): Promise<void> {
    if (!this.workingDirectory) return;
    const entries = this.transcripts.get(agent.id);
    if (entries.length === 0) return;
    const baseName = buildAgentArtifactBaseName(agent);
    const filePath = `${this.workingDirectory}/${baseName}-transcript.md`;
    const content = renderTranscriptFile(agent.id, this.currentRunId, entries);
    await this.deps.writeFile(filePath, content);
  }

  private async updateGoalEvaluatorStatus(
    evaluatorAgentId: string | null | undefined,
    status: WorkflowAgent['status'],
  ): Promise<void> {
    if (!evaluatorAgentId) return;
    const store = useWorkflowStore.getState();
    store.setAgentStatus(evaluatorAgentId, status);
    store.updateRunAgent(this.currentRunId, evaluatorAgentId, {
      status: status === 'completed' ? 'completed' : status === 'running' ? 'running' : 'error',
      endTime: status === 'running' ? undefined : this.deps.now(),
    });
  }

  private async performGoalEvaluation(
    instanceGoal: string,
    successCriteria: string,
    agents: WorkflowAgent[],
    iteration: number,
  ): Promise<GoalEvaluationResult> {
    const instance = useWorkflowStore.getState().getCurrentInstance();
    if (!instance) {
      throw new Error('工作流实例不存在，无法执行 Goal 评估。');
    }

    await this.updateGoalEvaluatorStatus(instance.goalEvaluatorAgentId, 'running');

    try {
      const result = await this.deps.evaluateGoal(
        {
          instance: {
            ...instance,
            projectGoal: instanceGoal,
            successCriteria,
          },
          agents,
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

      await this.updateGoalEvaluatorStatus(instance.goalEvaluatorAgentId, 'completed');
      return result;
    } catch (error) {
      await this.updateGoalEvaluatorStatus(instance.goalEvaluatorAgentId, 'error');
      throw error;
    }
  }

  private async runPlannedAgent(
    agent: WorkflowAgent,
    agents: WorkflowAgent[],
    connections: Parameters<typeof getPredecessorIds>[2],
    projectGoal: string,
    successCriteria: string,
    iteration: number,
    previousEvaluation: GoalEvaluationResult | null,
    failedAgents: Set<string>,
  ): Promise<void> {
    const store = useWorkflowStore.getState();
    const blockingFailures = getBlockingFailures(agent, agents, connections, failedAgents);
    if (blockingFailures.length > 0) {
      store.setAgentStatus(agent.id, 'error');
      store.updateRunAgent(this.currentRunId, agent.id, { status: 'skipped', endTime: this.deps.now() });
      return;
    }

    this.totalSteps += 1;
    if (this.totalSteps > MAX_TOTAL_STEPS) {
      throw new Error(`已达最大步数限制（${MAX_TOTAL_STEPS}步），工作流已停止`);
    }

    const predecessorIds = getPredecessorIds(agent.id, agents, connections);
    const upstreams: UpstreamOutput[] = predecessorIds
      .filter((id) => this.agentOutputs.has(id))
      .map((id) => ({
        agent: agents.find((item) => item.id === id)!,
        output: this.agentOutputs.get(id)!,
      }));
    const inboxMessages = readAgentInbox(agent.id, this.currentRunId, agents);
    const prompt = predecessorIds.length === 0 && inboxMessages.length === 0
      ? buildEntryAgentPrompt(projectGoal, agent, successCriteria, iteration, previousEvaluation)
      : buildDownstreamAgentPrompt(
          projectGoal,
          agent,
          upstreams,
          iteration,
          successCriteria,
          inboxMessages,
          previousEvaluation,
        );

    store.setRunning(true, agent.id);
    store.setAgentStatus(agent.id, 'running');
    store.updateRunAgent(this.currentRunId, agent.id, {
      status: 'running',
      startTime: this.deps.now(),
      iteration,
    });

    try {
      const output = await this.executeAgent(agent, prompt);
      this.agentOutputs.set(agent.id, output);
      await this.saveOutputToFile(agent, output);
      this.transcripts.record(agent.id, {
        timestamp: this.deps.now(),
        type: 'agent_completed',
        content: output,
      });
      await this.saveTranscriptToFile(agent);
      store.setAgentStatus(agent.id, 'completed');
      store.clearAgentDirty(agent.id);
      store.updateRunAgent(this.currentRunId, agent.id, {
        status: 'completed',
        endTime: this.deps.now(),
        output: output.slice(0, 2000),
        iteration,
      });
      failedAgents.delete(agent.id);
      await this.deps.notify(agent, agents, output, this.currentRunId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      this.agentOutputs.set(agent.id, `[[GOAL_NOT_REACHED]]\n${errorMessage}`);
      this.transcripts.record(agent.id, {
        timestamp: this.deps.now(),
        type: 'agent_error',
        content: errorMessage,
      });
      await this.saveTranscriptToFile(agent);
      store.setAgentStatus(agent.id, 'error');
      store.updateRunAgent(this.currentRunId, agent.id, {
        status: 'error',
        endTime: this.deps.now(),
        output: errorMessage.slice(0, 2000),
        iteration,
      });
      failedAgents.add(agent.id);
    }
  }

  async start(userPrompt?: string): Promise<void> {
    if (this.isRunning) return;

    const store = useWorkflowStore.getState();
    const instance = store.getCurrentInstance();
    if (!instance) {
      useUIStore.getState().addNotification('error', '请先创建一个 Workflow');
      return;
    }

    if (instance.agents.length === 0) {
      useUIStore.getState().addNotification('error', '请先添加至少一个 Agent');
      return;
    }

    const projectGoal = this.deriveWorkflowGoal(instance.agents, instance.projectGoal || userPrompt);
    const successCriteria = instance.successCriteria?.trim() || '';
    const localRunId = crypto.randomUUID();

    this.isRunning = true;
    this.stopRequested = false;
    this.totalSteps = 0;
    this.currentRunId = localRunId;
    this.agentOutputs.clear();
    this.transcripts.clear();

    registerDiagnosticsTask({
      id: localRunId,
      kind: 'workflow',
      source: `instance:${instance.id}`,
      state: 'created',
      cancelable: true,
      title: projectGoal.slice(0, 120),
    });
    registerDiagnosticsTaskCancel(localRunId, async () => {
      await this.stop();
    });

    store.resetAllStatuses();
    store.setRunning(true, null);

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
      agents: instance.agents.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        status: 'pending',
      })),
      runDirectory: this.workingDirectory,
      currentIteration: 0,
      goalEvaluations: [],
      reachedGoal: false,
    };
    store.addWorkflowRun(run);

    updateDiagnosticsTask(localRunId, {
      state: 'running',
      cancelable: true,
      detail: projectGoal.slice(0, 240),
    });

    let reachedGoal = false;
    let lastEvaluation: GoalEvaluationResult | null = null;
    let dirtyAgentIds = [...(instance.dirtyAgentIds ?? [])];
    const failedAgents = new Set<string>();
    const executableAgents = instance.agents.filter((agent) => agent.role !== 'goal-evaluator');

    try {
      const maxIterations = instance.maxGoalIterations ?? DEFAULT_MAX_GOAL_ITERATIONS;

      for (let iteration = 1; iteration <= maxIterations && !this.stopRequested; iteration += 1) {
        store.updateWorkflowRun(localRunId, { currentIteration: iteration });
        for (const dirtyAgentId of dirtyAgentIds) {
          store.clearAgentDirty(dirtyAgentId);
        }

        const executionPlan = buildExecutionPlan(executableAgents, instance.connections, dirtyAgentIds);
        dirtyAgentIds = [];

        for (const agent of executionPlan) {
          if (this.stopRequested) break;
          await this.runPlannedAgent(
            agent,
            executableAgents,
            instance.connections,
            projectGoal,
            successCriteria,
            iteration,
            lastEvaluation,
            failedAgents,
          );
        }

        if (this.stopRequested) {
          break;
        }

        lastEvaluation = await this.performGoalEvaluation(
          projectGoal,
          successCriteria,
          instance.agents,
          iteration,
        );
        store.appendGoalEvaluation(localRunId, lastEvaluation);

        if (lastEvaluation.reached) {
          reachedGoal = true;
          break;
        }

        const reentryAgentIds = selectReentryAgents({
          evaluation: lastEvaluation,
          agents: executableAgents,
          connections: instance.connections,
          agentOutputs: this.agentOutputs,
        });

        if (reentryAgentIds.length === 0) {
          break;
        }

        dirtyAgentIds = reentryAgentIds;
        for (const agentId of reentryAgentIds) {
          store.markAgentDirty(agentId);
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
        store.setRunning(false, null);
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
