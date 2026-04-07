/**
 * Delegation Planner Tests
 *
 * Tests for the delegation plan builder that converts
 * intent classifications into executable plans.
 */

import { buildDelegationPlan } from '../delegationPlanner.js';
import type { IntentClassification } from '../types.js';

describe('Delegation Planner', () => {
  describe('No Delegation Plans', () => {
    it('returns non-delegating plan for simple tasks', () => {
      const classification: IntentClassification = {
        taskType: 'simple_single_agent_task',
        scope: 'narrow',
        shouldDelegate: false,
        areaHints: [],
        confidence: 0.8,
        reasoning: 'Simple task',
      };

      const plan = buildDelegationPlan(classification, 'fix the typo');
      expect(plan.delegate).toBe(false);
      expect(plan.agents).toHaveLength(0);
      expect(plan.mainThreadResponsibility).toContain('Handle the full request directly');
    });
  });

  describe('Repo Exploration Plans', () => {
    it('creates plan with frontend and backend explorers', () => {
      const classification: IntentClassification = {
        taskType: 'repo_exploration',
        scope: 'broad',
        shouldDelegate: true,
        areaHints: [],
        confidence: 0.9,
        reasoning: 'Broad exploration',
      };

      const plan = buildDelegationPlan(classification, 'explore the entire codebase');
      expect(plan.delegate).toBe(true);
      expect(plan.agents).toHaveLength(2);
      expect(plan.agents[0].role).toBe('frontend_explorer');
      expect(plan.agents[1].role).toBe('rust_backend_explorer');
      expect(plan.maxParallelism).toBe(2);
    });
  });

  describe('Architecture Review Plans', () => {
    it('includes all areas when no specific hints', () => {
      const classification: IntentClassification = {
        taskType: 'architecture_review',
        scope: 'broad',
        shouldDelegate: true,
        areaHints: [],
        confidence: 0.9,
        reasoning: 'Broad review',
      };

      const plan = buildDelegationPlan(classification, 'review the architecture');
      expect(plan.agents).toHaveLength(2);
      expect(plan.agents.map(a => a.role)).toEqual(['frontend_explorer', 'rust_backend_explorer']);
    });

    it('includes specific areas when hinted', () => {
      const classification: IntentClassification = {
        taskType: 'architecture_review',
        scope: 'broad',
        shouldDelegate: true,
        areaHints: ['frontend', 'browser'],
        confidence: 0.9,
        reasoning: 'Specific areas',
      };

      const plan = buildDelegationPlan(classification, 'review frontend and browser');
      expect(plan.agents).toHaveLength(2);
      expect(plan.agents.map(a => a.role)).toEqual(['frontend_explorer', 'browser_investigator']);
    });

    it('caps agents at 3', () => {
      const classification: IntentClassification = {
        taskType: 'architecture_review',
        scope: 'broad',
        shouldDelegate: true,
        areaHints: ['frontend', 'rust_backend', 'browser', 'workflow'],
        confidence: 0.9,
        reasoning: 'Many areas',
      };

      const plan = buildDelegationPlan(classification, 'review everything');
      expect(plan.agents).toHaveLength(3);
    });
  });

  describe('Bug Investigation Plans', () => {
    it('spawns investigators based on area hints', () => {
      const classification: IntentClassification = {
        taskType: 'bug_investigation',
        scope: 'moderate',
        shouldDelegate: true,
        areaHints: ['frontend', 'rust_backend'],
        confidence: 0.8,
        reasoning: 'Cross-area bug',
      };

      const plan = buildDelegationPlan(classification, 'find the bug');
      expect(plan.agents).toHaveLength(2);
      expect(plan.agents.map(a => a.role)).toEqual(['frontend_explorer', 'rust_backend_explorer']);
    });

    it('defaults to frontend + backend when no hints', () => {
      const classification: IntentClassification = {
        taskType: 'bug_investigation',
        scope: 'broad',
        shouldDelegate: true,
        areaHints: [],
        confidence: 0.8,
        reasoning: 'Broad bug hunt',
      };

      const plan = buildDelegationPlan(classification, 'find the bug');
      expect(plan.agents).toHaveLength(2);
    });
  });

  describe('Release Review Plans', () => {
    it('always includes build, frontend, and backend reviewers', () => {
      const classification: IntentClassification = {
        taskType: 'release_review',
        scope: 'broad',
        shouldDelegate: true,
        areaHints: [],
        confidence: 0.9,
        reasoning: 'Release check',
      };

      const plan = buildDelegationPlan(classification, 'ready to release?');
      expect(plan.agents).toHaveLength(3);
      expect(plan.agents.map(a => a.role)).toEqual([
        'build_release_reviewer',
        'frontend_explorer',
        'rust_backend_explorer'
      ]);
    });
  });
});