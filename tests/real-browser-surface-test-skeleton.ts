// Real Browser Surface - Test Skeleton (A2/C2)
// This is a skeleton structure for automated tests. It is not wired to a runner yet.
// It outlines the test cases, steps, and expected outcomes for screenshot data flow,
// envelope/rerun semantics, login handoff, and mini/expanded transitions.

export type TestStep = {
  description: string;
  action?: string;
  expect?: string;
};

export interface TestCase {
  id: string;
  description: string;
  steps: TestStep[];
  setup?: string;
  teardown?: string;
}

const tests: TestCase[] = [
  {
    id: 'TC-A2-01',
    description: 'Screenshot data path exists and is used for preview when available',
    setup: 'Assume backend emits screenshot_captured with data URL on a navigated URL',
    steps: [
      { description: 'Trigger a browser open to a test URL', expect: 'status stays sane' },
      { description: 'Wait for screenshot_captured event', expect: 'screenshots array grows' },
      { description: 'Mini preview renders the latest data URL image', expect: 'image is visible' },
    ],
    teardown: 'Reset state'
  },
  {
    id: 'TC-A2-02',
    description: 'Rerun envelope preserves profile-aware context',
    steps: [
      { description: 'Edit task text but keep envelope context', expect: 'envelope preserved' },
      { description: 'Re-run envelope with same targetUrl/siteProfileId', expect: 'no loss of metadata' },
    ],
  },
  {
    id: 'TC-C2-01',
    description: 'Login handoff stability across mini/expanded',
    steps: [
      { description: 'Task requires login; trigger login flow', expect: 'login prompt shown' },
      { description: 'Complete login on visible surface', expect: 'authState === authenticated' },
      { description: 'Resume pending task after login', expect: 'pendingTask executed' },
    ],
  },
  {
    id: 'TC-C2-02',
    description: 'Mini <-> Expanded transition preserves envelope',
    steps: [
      { description: 'From Mini, Expand to Expanded', expect: 'currentUrl and envelope intact' },
      { description: 'Then Collapse back to Mini', expect: 'envelope intact' },
    ],
  }
];

export default tests;
