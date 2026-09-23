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
  type WorkflowInstance,
  type WorkflowRun,
} from '@/types/workflow';
import { DEFAULT_MAX_GOAL_ITERATIONS } from '@/services/workflow/defaults';
import { normalizeSuccessCriteria } from '@/services/goal/types';
import {
  formatWorkflowValidationErrors,
  validateWorkflowForRun,
} from '@/services/workflow/validation';
import {
  buildExecutionPlan,
  evaluateNextAgent,
  selectReentryAgents,
} from './phases';
import {
  type StreamChunkCallback,
} from './agentRunner';
import {
  WorkflowTranscriptManager,
  type WorkflowTranscriptEntry,
} from './transcript';
import { extractCodeBlockArtifacts } from './codeBlockArtifacts';
import {
  createWorkflowRunSnapshot,
} from './runSnapshot';
import {
  defaultDeps,
  type WorkflowEngineDeps,
} from './engineDeps';
import {
  deriveWorkflowGoal,
  evaluateGoalStep,
  type GoalStepHost,
} from './goalStep';
import {
  runPlannedAgent,
  type PlannedAgentRunHost,
} from './plannedAgentRun';

export { extractCodeBlockArtifacts };

export class WorkflowEngine {
  private readonly deps: WorkflowEngineDeps;
  private readonly transcripts = new WorkflowTranscriptManager();
  private readonly agentOutputs = new Map<string, string>();
  private isRunning = false;
  private stopRequested = false;
  private abortController: AbortController | null = null;
  private runToken = 0;
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
    this.abortController?.abort();
    this.abortController = null;
    this.isRunning = false;
    this.stopRequested = false;
    this.runToken += 1;
    this.totalSteps = 0;
    this.agentOutputs.clear();
    this.transcripts.clear();
    this.workingDirectory = '';
    this.currentRunId = '';
    this.currentInstanceId = '';
  }

  async stop(): Promise<void> {
    if (this.stopRequested) {
      this.abortController?.abort();
      return;
    }

    this.stopRequested = true;
    this.isRunning = false;
    this.abortController?.abort();
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

  /** Shared host view for extracted run helpers (persistence / goal / planned agent). */
  private asRunHost(): PlannedAgentRunHost & GoalStepHost {
    const self = this;
    return {
      get currentRunId() { return self.currentRunId; },
      get workingDirectory() { return self.workingDirectory; },
      get abortController() { return self.abortController; },
      get deps() { return self.deps; },
      get transcripts() { return self.transcripts; },
      get agentOutputs() { return self.agentOutputs; },
      get onStreamChunk() { return self.onStreamChunk; },
      shouldAcceptRunMutation: (runId: string) => self.shouldAcceptRunMutation(runId),
      getTranscriptEntries: (agentId: string) => self.transcripts.get(agentId),
      bumpTotalSteps: () => {
        self.totalSteps += 1;
        return self.totalSteps;
      },
    };
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
    const successCriteria = normalizeSuccessCriteria(instance.successCriteria);
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

    const projectGoal = deriveWorkflowGoal(instance.agents, configuredGoal);
    const snapshot = createWorkflowRunSnapshot({
      ...instance,
      projectGoal,
      successCriteria,
    });
    const localRunId = crypto.randomUUID();
    const localRunToken = this.runToken + 1;

    this.isRunning = true;
    this.stopRequested = false;
    this.abortController = new AbortController();
    this.runToken = localRunToken;
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
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const failureMessage = `Failed to create workflow run directory: ${reason}`;
      // eslint-disable-next-line no-console
      console.error('[workflow] createRunDirectory failed:', error);

      const failedRun: WorkflowRun = {
        id: localRunId,
        title: `${projectGoal.slice(0, 60)}${projectGoal.length > 60 ? '...' : ''}`,
        projectGoal,
        successCriteria: [...successCriteria],
        status: 'error',
        startTime: this.deps.now(),
        endTime: this.deps.now(),
        agents: snapshot.agents.map((agent) => ({
          agentId: agent.id,
          agentName: agent.name,
          status: 'pending',
        })),
        runDirectory: '',
        currentIteration: 0,
        goalEvaluations: [],
        reachedGoal: false,
      };
      store.addWorkflowRun(failedRun, snapshot.instanceId);

      updateDiagnosticsTask(localRunId, {
        state: 'failed',
        cancelable: false,
        error: failureMessage,
      });

      useUIStore.getState().addNotification('error', `❌ 工作流失败：${failureMessage}`);

      this.isRunning = false;
      this.stopRequested = false;
      if (this.runToken === localRunToken) {
        this.abortController = null;
      }
      this.totalSteps = 0;
      this.currentRunId = '';
      this.currentInstanceId = '';
      this.workingDirectory = '';
      store.setRunning(false, null);
      store.setActiveRunId(null, snapshot.instanceId);
      return;
    }

    const run: WorkflowRun = {
      id: localRunId,
      title: `${projectGoal.slice(0, 60)}${projectGoal.length > 60 ? '...' : ''}`,
      projectGoal,
      successCriteria: [...successCriteria],
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
    const host = this.asRunHost();

    try {
      const maxIterations = snapshot.maxGoalIterations ?? DEFAULT_MAX_GOAL_ITERATIONS;

      for (let iteration = 1; iteration <= maxIterations && !this.stopRequested; iteration += 1) {
        // eslint-disable-next-line no-console
        console.info(`[workflow] Loop iter ${iteration}/${maxIterations}: starting plan build with dirtyAgentIds=[${dirtyAgentIds.join(', ')}]`);
        store.updateWorkflowRun(localRunId, { currentIteration: iteration });
        for (const dirtyAgentId of dirtyAgentIds) {
          store.clearAgentDirtyInInstance(snapshot.instanceId, dirtyAgentId);
        }

        const executionPlan = buildExecutionPlan(executableAgents, snapshot.connections, dirtyAgentIds);
        dirtyAgentIds = [];
        // eslint-disable-next-line no-console
        console.info(`[workflow] Loop iter ${iteration}: executionPlan=[${executionPlan.map((a) => `${a.name}(${a.id})`).join(', ')}]`);

        for (const agent of executionPlan) {
          if (this.stopRequested) break;
          // eslint-disable-next-line no-console
          console.info(`[workflow] Starting execution of agent "${agent.name}" (${agent.id}) in iter ${iteration}`);
          await runPlannedAgent(
            host,
            agent,
            snapshot,
            iteration,
            lastEvaluation,
            failedAgents,
          );
          // eslint-disable-next-line no-console
          console.info(`[workflow] Completed execution of agent "${agent.name}" (${agent.id}) in iter ${iteration}`);
        }

        if (this.stopRequested) {
          // eslint-disable-next-line no-console
          console.info(`[workflow] Stop requested after agent execution in iter ${iteration}`);
          break;
        }

        lastEvaluation = await evaluateGoalStep(host, snapshot, iteration);
        if (!this.shouldAcceptRunMutation(localRunId)) {
          // eslint-disable-next-line no-console
          console.info(`[workflow] Run mutation no longer accepted for runId=${localRunId} after evaluateGoalStep`);
          break;
        }
        store.appendGoalEvaluation(localRunId, lastEvaluation);

        if (lastEvaluation.reached) {
          // eslint-disable-next-line no-console
          console.info(`[workflow] Goal reached in iter ${iteration}! Breaking loop.`);
          reachedGoal = true;
          break;
        }

        const reentryAgentIds = selectReentryAgents({
          evaluation: lastEvaluation,
          agents: executableAgents,
          connections: snapshot.connections,
          agentOutputs: this.agentOutputs,
        });

        // eslint-disable-next-line no-console
        console.info(`[workflow] Reentry agents selected for iter ${iteration + 1}: [${reentryAgentIds.join(', ')}]`);

        if (reentryAgentIds.length === 0) {
          // eslint-disable-next-line no-console
          console.info(`[workflow] No reentry agents selected. Workflow loop ending at iter ${iteration}.`);
          break;
        }

        dirtyAgentIds = reentryAgentIds;
        for (const agentId of reentryAgentIds) {
          store.markAgentDirtyInInstance(snapshot.instanceId, agentId);
        }
      }

      // eslint-disable-next-line no-console
      console.info(`[workflow] Loop finished: finalStatus=${this.stopRequested ? 'stopped' : 'completed'}, reachedGoal=${reachedGoal}`);

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
      if (this.currentRunId === localRunId || this.runToken === localRunToken || this.isRunning) {
        this.isRunning = false;
        this.stopRequested = false;
        this.abortController = null;
        this.totalSteps = 0;
        this.currentRunId = '';
        this.currentInstanceId = '';
        this.workingDirectory = '';
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
