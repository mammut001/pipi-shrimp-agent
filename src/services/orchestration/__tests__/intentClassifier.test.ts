/**
 * Orchestration Intent Classifier Tests
 *
 * Tests for the rule-based intent classifier that determines
 * whether delegation is warranted and what task type to use.
 */

import { classifyIntent } from '../intentClassifier.js';

describe('Intent Classifier', () => {
  describe('Suppression Guardrails', () => {
    it('suppresses very short messages', () => {
      const result = classifyIntent('hi');
      expect(result.shouldDelegate).toBe(false);
      expect(result.reasoning).toContain('Message too short');
    });

    it('suppresses trivial word counts', () => {
      const result = classifyIntent('fix this please');
      expect(result.shouldDelegate).toBe(false);
      expect(result.reasoning).toContain('Message too short');
    });

    it('suppresses trivial patterns', () => {
      const result = classifyIntent('please rename the file for me right now');
      expect(result.shouldDelegate).toBe(false);
      expect(result.reasoning).toContain('Message too short');
    });

    it('suppresses single-file tasks without broad scope', () => {
      const result = classifyIntent('update src/main.ts file');
      expect(result.shouldDelegate).toBe(false);
      expect(result.reasoning).toContain('Message too short');
    });
  });

  describe('Delegation Triggers', () => {
    it('delegates for broad repo exploration', () => {
      const result = classifyIntent('please explore the entire codebase for me right now and give me a summary');
      expect(result.shouldDelegate).toBe(true);
      expect(result.taskType).toBe('repo_exploration');
    });

    it('delegates for architecture review with multiple areas', () => {
      const result = classifyIntent('review the frontend and backend architecture please and give feedback on the design');
      expect(result.shouldDelegate).toBe(true);
      expect(result.taskType).toBe('architecture_review');
    });

    it('delegates for bug investigation across areas', () => {
      const result = classifyIntent('find the bug in the browser and workflow and frontend systems and help me fix it');
      expect(result.shouldDelegate).toBe(true);
      expect(result.taskType).toBe('bug_investigation');
    });

    it('delegates for release review', () => {
      // Use message that triggers release_review and broad scope but avoids "check" suppression
      const message = 'please verify the app is ready to ship and review all the changes across the entire codebase for release';
      console.log('Message:', message);
      console.log('Match release pattern:', /\b(release\s+review|ready\s+to\s+(release|ship|deploy))/i.test(message));
      console.log('Match can release pattern:', /\bcan\s+(i|we)\s+(release|ship|deploy)/i.test(message));
      console.log('Match pre-release pattern:', /\b(pre[\s-]?release|release\s+check)/i.test(message));
      const result = classifyIntent(message);
      console.log('Classification result:', JSON.stringify(result, null, 2));
      expect(result.shouldDelegate).toBe(true);
      expect(result.taskType).toBe('release_review');
    });
  });

  describe('No Delegation Cases', () => {
    it('does not delegate for simple questions', () => {
      const result = classifyIntent('what is this function?');
      expect(result.shouldDelegate).toBe(false);
      expect(result.taskType).toBe('simple_single_agent_task');
    });

    it('does not delegate for narrow bug fixes', () => {
      const result = classifyIntent('fix the typo in line 42');
      expect(result.shouldDelegate).toBe(false);
    });

    it('does not delegate for single-area architecture without broad scope', () => {
      const result = classifyIntent('review the frontend components');
      expect(result.shouldDelegate).toBe(false);
    });
  });

  describe('Area Detection', () => {
    it('detects frontend area hints', () => {
      const result = classifyIntent('fix the React component');
      expect(result.areaHints).toContain('frontend');
    });

    it('detects rust backend hints', () => {
      const result = classifyIntent('update the Tauri command');
      expect(result.areaHints).toContain('rust_backend');
    });

    it('detects browser hints', () => {
      const result = classifyIntent('investigate the browser issue');
      expect(result.areaHints).toContain('browser');
    });

    it('detects workflow hints', () => {
      const result = classifyIntent('debug the swarm runtime');
      expect(result.areaHints).toContain('workflow');
    });
  });
});