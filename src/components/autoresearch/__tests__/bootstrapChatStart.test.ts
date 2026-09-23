import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  applyQuickStartTemplateToRecipe,
  type BootstrapChatStartHost,
  runBootstrapStart,
} from '../bootstrapChatStart';
import { createDefaultRecipe } from '../bootstrapChatHelpers';
import { useBootstrapPlanStore } from '@/services/autoresearch/bootstrap/bootstrapPlanStore';

const mockRunHeadlessAgentTurn = jest.fn<any>();
jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: any[]) => mockRunHeadlessAgentTurn(...args),
}));

describe('bootstrapChatStart', () => {
  describe('applyQuickStartTemplateToRecipe', () => {
    const baseRecipe = createDefaultRecipe();

    it('configures reproduce-paper template correctly', () => {
      const updated = applyQuickStartTemplateToRecipe(baseRecipe, 'reproduce-paper');
      expect(updated.researchGoal.taskType).toBe('reproduce_paper');
      expect(updated.researchGoal.source).toBe('template');
      expect(updated.researchGoal.goalText).toContain('reproduce a paper');
      expect(updated.workspace.folderName).toBe('reproduce-project');
      expect(updated.verification.commands).toEqual(['pytest']);
      expect(updated.baselineAndMetric.baselineValue).toBe('0.85');
      expect(updated.baselineAndMetric.successCriteria).toBe('Match or exceed the target baseline metric.');
    });

    it('configures beat-baseline template correctly', () => {
      const updated = applyQuickStartTemplateToRecipe(baseRecipe, 'beat-baseline');
      expect(updated.researchGoal.taskType).toBe('beat_baseline');
      expect(updated.researchGoal.source).toBe('template');
      expect(updated.researchGoal.goalText).toContain('exceed an existing baseline');
      expect(updated.workspace.folderName).toBe('baseline-project');
      expect(updated.verification.commands).toEqual(['pytest']);
      expect(updated.baselineAndMetric.baselineValue).toBe('0.85');
      expect(updated.baselineAndMetric.successCriteria).toBe('Match or exceed the target baseline metric.');
    });

    it('configures ablation template correctly', () => {
      const updated = applyQuickStartTemplateToRecipe(baseRecipe, 'ablation');
      expect(updated.researchGoal.taskType).toBe('ablation');
      expect(updated.researchGoal.source).toBe('template');
      expect(updated.researchGoal.goalText).toContain('ablation studies');
      expect(updated.workspace.folderName).toBe('ablation-project');
      expect(updated.verification.commands).toEqual(['pytest']);
      expect(updated.baselineAndMetric.baselineValue).toBe('');
      expect(updated.baselineAndMetric.successCriteria).toBe('');
    });

    it('configures from-scratch template correctly', () => {
      const updated = applyQuickStartTemplateToRecipe(baseRecipe, 'from-scratch');
      expect(updated.researchGoal.taskType).toBe('from_scratch');
      expect(updated.researchGoal.source).toBe('template');
      expect(updated.researchGoal.goalText).toContain('brand new AutoResearch project');
      expect(updated.workspace.folderName).toBe('scratch-project');
      expect(updated.verification.commands).toEqual(['pytest']);
      expect(updated.baselineAndMetric.baselineValue).toBe('');
      expect(updated.baselineAndMetric.successCriteria).toBe('');
    });
  });

  describe('runBootstrapStart', () => {
    let host: BootstrapChatStartHost;
    let bootstrappedAtRef: { current: string | null };
    let lastCompiledPromptRef: { current: string | null };
    let bootstrapAbortRef: { current: AbortController | null };

    beforeEach(() => {
      jest.clearAllMocks();
      bootstrappedAtRef = { current: null };
      lastCompiledPromptRef = { current: null };
      bootstrapAbortRef = { current: null };

      host = {
        isStreaming: false,
        recipe: createDefaultRecipe(),
        sshConfig: undefined,
        importedFiles: [],
        setReadyResult: jest.fn(),
        lastCompiledPromptRef,
        setError: jest.fn(),
        setMissingFinalize: jest.fn(),
        setStoppedByUser: jest.fn(),
        setHandoffSummary: jest.fn(),
        bootstrappedAtRef,
        setHasStarted: jest.fn(),
        setIsStreaming: jest.fn(),
        setAgentLogs: jest.fn(),
        bootstrapAbortRef,
        noteTool: jest.fn(),
        setWarnings: jest.fn(),
      };

      useBootstrapPlanStore.getState().reset();
    });

    it('ignores start request if already streaming', async () => {
      host.isStreaming = true;
      await runBootstrapStart('my prompt', host);

      expect(host.setHasStarted).not.toHaveBeenCalled();
      expect(mockRunHeadlessAgentTurn).not.toHaveBeenCalled();
    });

    it('initializes agent and triggers runHeadlessAgentTurn', async () => {
      mockRunHeadlessAgentTurn.mockResolvedValueOnce(undefined);

      await runBootstrapStart('compile instructions', host);

      expect(host.setHasStarted).toHaveBeenCalledWith(true);
      expect(host.setIsStreaming).toHaveBeenCalledWith(true);
      expect(host.lastCompiledPromptRef.current).toBe('compile instructions');
      expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          initialMessages: [{ role: 'user', content: 'compile instructions' }],
          workDir: '/tmp',
        }),
      );
      expect(host.setIsStreaming).toHaveBeenLastCalledWith(false);
    });

    it('catches runner errors and updates host state', async () => {
      mockRunHeadlessAgentTurn.mockRejectedValueOnce(new Error('Agent crashed'));

      await runBootstrapStart('fail prompt', host);

      expect(host.setError).toHaveBeenCalledWith('Agent crashed');
      expect(host.setMissingFinalize).toHaveBeenCalledWith(false);
      expect(host.setIsStreaming).toHaveBeenLastCalledWith(false);
    });
  });
});
