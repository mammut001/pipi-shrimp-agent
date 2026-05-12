import {
  extractWorkflowMarkerTokens,
  hasWorkflowCompletionMarker,
  normalizeWorkflowMarkerToken,
  parseWorkflowMarkers,
} from '../workflow/templates/markers';

describe('workflow markers', () => {
  it('normalizes canonical and legacy markers to the shared protocol', () => {
    expect(parseWorkflowMarkers('[[WORKFLOW:REVIEW_REJECT]] [[BUG_FOUND]] [[TESTS_PASS]]')).toEqual(
      expect.arrayContaining(['REVIEW_REJECT', 'TESTS_FAIL_CODE', 'PASS']),
    );
    expect(normalizeWorkflowMarkerToken('<needs_rework>')).toBe('[[WORKFLOW:NEEDS_REWORK]]');
    expect(extractWorkflowMarkerTokens('[[REVIEW_REJECT]] <PASS>')).toEqual(
      expect.arrayContaining(['[[WORKFLOW:REVIEW_REJECT]]', '[[WORKFLOW:PASS]]']),
    );
    expect(hasWorkflowCompletionMarker('done [[REVIEW_PASS]]')).toBe(true);
  });
});