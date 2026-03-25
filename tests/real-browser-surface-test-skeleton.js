// Real Browser Surface - Test Skeleton (A2/C2) - JS version
// Simple placeholders for test cases; to be wired to a runner like Playwright/Cypress later.
const tests = [
  {
    id: 'TC-A2-01',
    description: 'Screenshot data path exists and is used for preview when available',
    steps: [
      { description: 'Trigger a browser open to a test URL' },
      { description: 'Wait for screenshot_captured event' },
      { description: 'Mini preview renders the latest data URL image' },
    ],
  },
  {
    id: 'TC-A2-02',
    description: 'Rerun envelope preserves profile-aware context',
    steps: [
      { description: 'Edit task text but keep envelope context' },
      { description: 'Re-run envelope with same targetUrl/siteProfileId' },
    ],
  }
];

module.exports = tests;
