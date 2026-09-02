/** @jest-environment jsdom */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import {
  AutoResearchRunProgressRail,
  AutoResearchRunPhaseChip,
  normalizeToMainRunPhase,
  formatRunPhaseLabel,
} from '../AutoResearchRunProgressRail';

// Mock i18n
jest.mock('@/i18n', () => ({
  t: (key: string, params?: any) => {
    const table: Record<string, string> = {
      'autoresearch.runProgress': 'Run Progress',
      'autoresearch.iterationProgress': params ? `Iteration ${params.current} / ${params.total}` : 'Iteration',
      'autoresearch.loopStateRunning': 'Running',
      'autoresearch.loopStatePaused': 'Paused',
      'autoresearch.phase.preflight': 'Preflight',
      'autoresearch.phase.run_experiment': 'Running Experiment',
      'autoresearch.phase.parse_metrics': 'Parsing Metrics',
      'autoresearch.phase.decide_next': 'Deciding Next Step',
      'autoresearch.phase.done': 'Completed',
      'autoresearch.phase.failed': 'Failed',
    };
    return table[key] || key;
  },
}));

describe('AutoResearchRunProgressRail & AutoResearchRunPhaseChip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  describe('normalizeToMainRunPhase', () => {
    it('maps setup and preflight phases to PREFLIGHT', () => {
      expect(normalizeToMainRunPhase('INIT')).toBe('PREFLIGHT');
      expect(normalizeToMainRunPhase('READ_CONTEXT')).toBe('PREFLIGHT');
      expect(normalizeToMainRunPhase('PLAN_HYPOTHESIS')).toBe('PREFLIGHT');
      expect(normalizeToMainRunPhase('PREFLIGHT')).toBe('PREFLIGHT');
    });

    it('maps coding and experiment phases to RUN_EXPERIMENT', () => {
      expect(normalizeToMainRunPhase('EDIT_CODE')).toBe('RUN_EXPERIMENT');
      expect(normalizeToMainRunPhase('RUN_EXPERIMENT')).toBe('RUN_EXPERIMENT');
    });

    it('maps metric parsing to PARSE_METRICS', () => {
      expect(normalizeToMainRunPhase('PARSE_METRICS')).toBe('PARSE_METRICS');
    });

    it('maps reflection and decision to DECIDE_NEXT', () => {
      expect(normalizeToMainRunPhase('REFLECT')).toBe('DECIDE_NEXT');
      expect(normalizeToMainRunPhase('DECIDE_NEXT')).toBe('DECIDE_NEXT');
    });

    it('maps terminal phases to DONE and FAILED', () => {
      expect(normalizeToMainRunPhase('DONE')).toBe('DONE');
      expect(normalizeToMainRunPhase('FAILED')).toBe('FAILED');
    });
  });

  describe('formatRunPhaseLabel', () => {
    it('formats localized labels for each main phase', () => {
      expect(formatRunPhaseLabel('PREFLIGHT')).toBe('Preflight');
      expect(formatRunPhaseLabel('RUN_EXPERIMENT')).toBe('Running Experiment');
      expect(formatRunPhaseLabel('PARSE_METRICS')).toBe('Parsing Metrics');
      expect(formatRunPhaseLabel('DECIDE_NEXT')).toBe('Deciding Next Step');
      expect(formatRunPhaseLabel('DONE')).toBe('Completed');
      expect(formatRunPhaseLabel('FAILED')).toBe('Failed');
    });
  });

  describe('AutoResearchRunProgressRail component', () => {
    it('renders run progress header with iteration info and status badge', () => {
      act(() => {
        root.render(
          <AutoResearchRunProgressRail
            currentIteration={2}
            maxIterations={5}
            phase="RUN_EXPERIMENT"
            loopState="running"
          />
        );
      });

      expect(container.textContent).toContain('Run Progress');
      expect(container.textContent).toContain('Iteration 2 / 5');
      expect(container.textContent).toContain('Running');
    });

    it('renders paused status badge when loop is paused', () => {
      act(() => {
        root.render(
          <AutoResearchRunProgressRail
            currentIteration={3}
            maxIterations={10}
            phase="DECIDE_NEXT"
            loopState="paused"
          />
        );
      });

      expect(container.textContent).toContain('Paused');
    });

    it('renders all run phases and marks previous steps as done', () => {
      act(() => {
        root.render(
          <AutoResearchRunProgressRail
            currentIteration={1}
            maxIterations={3}
            phase="PARSE_METRICS"
            loopState="running"
          />
        );
      });

      expect(container.textContent).toContain('Preflight');
      expect(container.textContent).toContain('Running Experiment');
      expect(container.textContent).toContain('Parsing Metrics');
      expect(container.textContent).toContain('Deciding Next Step');
      expect(container.textContent).toContain('Completed');

      // PREFLIGHT and RUN_EXPERIMENT are done (checkmarks: ✓)
      const text = container.textContent || '';
      expect(text).toContain('✓');
    });

    it('renders Failed label when run phase is FAILED', () => {
      act(() => {
        root.render(
          <AutoResearchRunProgressRail
            currentIteration={1}
            maxIterations={3}
            phase="FAILED"
            loopState="stopped"
          />
        );
      });

      expect(container.textContent).toContain('Failed');
    });
  });

  describe('AutoResearchRunPhaseChip component', () => {
    it('renders chip with iteration progress and phase label', () => {
      act(() => {
        root.render(
          <AutoResearchRunPhaseChip
            currentIteration={2}
            maxIterations={5}
            phase="PARSE_METRICS"
            loopState="running"
          />
        );
      });

      const chip = container.querySelector('[data-testid="autoresearch-run-phase-chip"]');
      expect(chip).toBeTruthy();
      expect(chip?.getAttribute('data-phase')).toBe('PARSE_METRICS');
      expect(chip?.textContent).toContain('Iteration 2 / 5');
      expect(chip?.textContent).toContain('Parsing Metrics');
    });

    it('applies amber tone when loopState is paused', () => {
      act(() => {
        root.render(
          <AutoResearchRunPhaseChip
            currentIteration={1}
            maxIterations={5}
            phase="DECIDE_NEXT"
            loopState="paused"
          />
        );
      });

      const chip = container.querySelector('[data-testid="autoresearch-run-phase-chip"]');
      expect(chip?.className).toContain('text-amber-700');
    });

    it('applies rose tone when phase is FAILED', () => {
      act(() => {
        root.render(
          <AutoResearchRunPhaseChip
            currentIteration={1}
            maxIterations={5}
            phase="FAILED"
            loopState="stopped"
          />
        );
      });

      const chip = container.querySelector('[data-testid="autoresearch-run-phase-chip"]');
      expect(chip?.className).toContain('text-rose-700');
    });
  });
});
