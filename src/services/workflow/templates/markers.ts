import type { WorkflowAgentRole, WorkflowMarkerCode } from '@/types/workflow';

const MARKER_TOKEN_REGEX = /\[\[(?:WORKFLOW:)?([A-Z0-9_:-]+)\]\]|<([A-Z0-9:_-]+)>/g;

export const WORKFLOW_MARKERS: Record<WorkflowMarkerCode, string> = {
  PASS: '[[WORKFLOW:PASS]]',
  REVIEW_REJECT: '[[WORKFLOW:REVIEW_REJECT]]',
  TESTS_FAIL_CODE: '[[WORKFLOW:TESTS_FAIL_CODE]]',
  TESTS_FAIL_SPEC: '[[WORKFLOW:TESTS_FAIL_SPEC]]',
  GOAL_NOT_REACHED: '[[WORKFLOW:GOAL_NOT_REACHED]]',
};

const WORKFLOW_MARKER_ALIASES: Record<string, WorkflowMarkerCode> = {
  PASS: 'PASS',
  GOAL_COMPLETE: 'PASS',
  REVIEW_PASS: 'PASS',
  TESTS_PASS: 'PASS',
  REVIEW_REJECT: 'REVIEW_REJECT',
  REJECT: 'REVIEW_REJECT',
  TESTS_FAIL_CODE: 'TESTS_FAIL_CODE',
  BUG_FOUND: 'TESTS_FAIL_CODE',
  TESTS_FAIL_SPEC: 'TESTS_FAIL_SPEC',
  GOAL_NOT_REACHED: 'GOAL_NOT_REACHED',
};

function normalizeMarkerLabel(rawLabel: string): string {
  return rawLabel.trim().toUpperCase().replace(/^WORKFLOW:/, '').replace(/-/g, '_');
}

export function buildWorkflowMarkerToken(code: WorkflowMarkerCode): string {
  return WORKFLOW_MARKERS[code];
}

export function normalizeWorkflowMarkerToken(token: string): string | null {
  const match = /\[\[(?:WORKFLOW:)?([A-Z0-9_:-]+)\]\]|<([A-Z0-9:_-]+)>/i.exec(token.trim());
  if (!match) return null;

  const rawLabel = match[1] || match[2];
  const normalizedLabel = normalizeMarkerLabel(rawLabel);
  const knownCode = WORKFLOW_MARKER_ALIASES[normalizedLabel];

  if (knownCode) {
    return WORKFLOW_MARKERS[knownCode];
  }

  return `[[WORKFLOW:${normalizedLabel}]]`;
}

export function extractWorkflowMarkerTokens(text: string): string[] {
  const normalizedTokens = new Set<string>();

  for (const match of text.matchAll(MARKER_TOKEN_REGEX)) {
    const rawToken = match[0];
    const normalizedToken = normalizeWorkflowMarkerToken(rawToken);
    if (normalizedToken) {
      normalizedTokens.add(normalizedToken);
    }
  }

  return Array.from(normalizedTokens);
}

export function parseWorkflowMarkers(text: string): WorkflowMarkerCode[] {
  const detectedCodes = new Set<WorkflowMarkerCode>();

  for (const match of text.matchAll(MARKER_TOKEN_REGEX)) {
    const rawLabel = match[1] || match[2];
    const normalizedLabel = normalizeMarkerLabel(rawLabel);
    const code = WORKFLOW_MARKER_ALIASES[normalizedLabel];
    if (code) {
      detectedCodes.add(code);
    }
  }

  return Array.from(detectedCodes);
}

export function hasWorkflowMarker(text: string, code: WorkflowMarkerCode): boolean {
  return parseWorkflowMarkers(text).includes(code);
}

export function hasWorkflowCompletionMarker(text: string): boolean {
  return hasWorkflowMarker(text, 'PASS');
}

export function getExpectedMarkersForRole(role?: WorkflowAgentRole | null): WorkflowMarkerCode[] {
  switch (role) {
    case 'reviewer':
      return ['PASS', 'REVIEW_REJECT'];
    case 'qa':
      return ['PASS', 'TESTS_FAIL_CODE', 'TESTS_FAIL_SPEC'];
    case 'goal-evaluator':
      return [];
    default:
      return ['PASS', 'GOAL_NOT_REACHED'];
  }
}