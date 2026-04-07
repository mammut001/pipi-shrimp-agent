/**
 * Follow-Through Router Tests
 *
 * Tests for the follow-through mode resolver that determines
 * what the main thread should do after delegation.
 */

import { resolveFollowThrough } from '../followThrough.js';
import type { DelegationPlan } from '../types.js';

describe('Follow-Through Router', () => {
  describe('Answer Only Mode', () => {
    it('routes repo exploration to answer only', () => {
      const plan: DelegationPlan = {
        id: 'test',
        planType: 'repo_exploration',
        delegate: true,
        mainThreadResponsibility: 'Synthesize results',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'merge_summaries',
        userMessage: 'explore the codebase',
        createdAt: Date.now(),
      };

      const result = resolveFollowThrough(plan);
      expect(result.mode).toBe('answer_only');
      expect(result.description).toContain('unified codebase overview');
    });
  });

  describe('Produce Review Mode', () => {
    it('routes architecture review to produce review', () => {
      const plan: DelegationPlan = {
        id: 'test',
        planType: 'architecture_review',
        delegate: true,
        mainThreadResponsibility: 'Review architecture',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'merge_summaries',
        userMessage: 'review architecture',
        createdAt: Date.now(),
      };

      const result = resolveFollowThrough(plan);
      expect(result.mode).toBe('produce_review');
      expect(result.description).toContain('structured architecture review');
    });

    it('routes release review to produce review', () => {
      const plan: DelegationPlan = {
        id: 'test',
        planType: 'release_review',
        delegate: true,
        mainThreadResponsibility: 'Review release',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'merge_summaries',
        userMessage: 'ready to release?',
        createdAt: Date.now(),
      };

      const result = resolveFollowThrough(plan);
      expect(result.mode).toBe('produce_review');
      expect(result.description).toContain('release readiness assessment');
    });
  });

  describe('Produce Fix Plan Mode', () => {
    it('routes bug investigation to produce fix plan', () => {
      const plan: DelegationPlan = {
        id: 'test',
        planType: 'bug_investigation',
        delegate: true,
        mainThreadResponsibility: 'Fix bug',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'merge_summaries',
        userMessage: 'find the bug',
        createdAt: Date.now(),
      };

      const result = resolveFollowThrough(plan);
      expect(result.mode).toBe('produce_fix_plan');
      expect(result.description).toContain('root cause and fix plan');
    });

    it('routes fix intent messages to produce fix plan', () => {
      const plan: DelegationPlan = {
        id: 'test',
        planType: 'bug_investigation',
        delegate: true,
        mainThreadResponsibility: 'Fix bug',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'merge_summaries',
        userMessage: 'fix the bug please',
        createdAt: Date.now(),
      };

      const result = resolveFollowThrough(plan);
      expect(result.mode).toBe('produce_fix_plan');
    });
  });

  describe('Produce README Update Mode', () => {
    it('routes doc write intent to produce readme update', () => {
      const plan: DelegationPlan = {
        id: 'test',
        planType: 'documentation_update',
        delegate: true,
        mainThreadResponsibility: 'Write docs',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'merge_summaries',
        userMessage: 'update the README',
        createdAt: Date.now(),
      };

      const result = resolveFollowThrough(plan);
      expect(result.mode).toBe('produce_readme_update');
      expect(result.description).toContain('documentation content');
    });

    it('detects doc write patterns', () => {
      const plan: DelegationPlan = {
        id: 'test',
        planType: 'repo_exploration',
        delegate: true,
        mainThreadResponsibility: 'Explore',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'merge_summaries',
        userMessage: 'write documentation for the project',
        createdAt: Date.now(),
      };

      const result = resolveFollowThrough(plan);
      expect(result.mode).toBe('produce_readme_update');
    });
  });
});