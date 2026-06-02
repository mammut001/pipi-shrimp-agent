# Testing notes

This file tracks pre-existing test failures in the repository that are **not
caused by recent feature work** and that contributors should expect to see
when running the test suite locally or in CI.

If you are about to open a pull request and a test in this file is failing,
that failure is almost certainly pre-existing — please do not block on it
unless your change is touching the same code path.

## Pre-existing failures

### `pnpm test -- DatabaseHealthSection`

The test file `src/__tests__/DatabaseHealthSection.test.ts` fails to load
with the following Jest error:

```
TypeError: Cannot assign to read only property 'reload' of object '[object Location]'
  at node_modules/.pnpm/jest-mock@.../jest-mock/build/index.js:...
```

Cause: the test environment cannot rebind `window.location.reload`. This is a
Jest `jsdom` setup issue, not a regression in the
`DatabaseHealthSection` component. The failure is reproducible on a clean
working tree of `main` (no working-tree changes), and was first observed
prior to the commits listed below.

Affected file: `src/__tests__/DatabaseHealthSection.test.ts`.

### `pnpm test -- autoresearch`

The `src/services/autoresearch` suite contains several Tauri / platform-layer
integration tests that fail when the Tauri runtime is not available — i.e.
when running the test suite in a regular Node / Vite-only environment
without the Tauri desktop shell. Roughly 40 of the 274 tests in the suite
fall into this category.

Representative failing suites (not exhaustive):

- `src/services/autoresearch/__tests__/loopEngine.integration.test.ts`
- `src/services/autoresearch/__tests__/terminalRunner.test.ts`
- `src/services/autoresearch/__tests__/runDir.test.ts`
- `src/services/autoresearch/__tests__/metricsStore.test.ts`
- `src/services/autoresearch/__tests__/reflection.test.ts`
- `src/services/autoresearch/__tests__/localSmoke.test.ts`
- `src/services/autoresearch/__tests__/chatAdapter.test.ts`
- `src/services/tools/autoresearchBootstrap/__tests__/scaffoldGenerate.test.ts`
- `src/components/__tests__/AutoResearchPanel.test.ts`
- `src/components/autoresearch/__tests__/AutoResearchDashboardTable.test.ts`
- `src/components/autoresearch/__tests__/AutoResearchDashboardView.clipboard.test.ts`
- `src/components/autoresearch/__tests__/AutoResearchRunDetailDocument.test.ts`

These failures are independent of recent AutoResearch changes and are
expected when the suite is executed outside the Tauri desktop app.

## Recent commits that did **not** introduce these failures

The following commits were landed on `main` immediately before this file was
created. They are listed so reviewers can quickly confirm that the failures
above are not regressions from this batch:

- `d1adf4c` — `fix(autoresearch): polish self-improve setup modal`
- `6b3eafa` — `Add browser diagnostics unavailable copy`
- `e00b449` — `Improve Tauri browser compatibility guards`
- `0414ed6` — `Add gated real LLM AutoResearch smoke test`

Each of these was verified to keep the modal jest tests, the `tsc` check,
and `pnpm run build` green at the time of landing. The pre-existing
failures above were already present on `main` before any of these commits
and remain so afterwards.

## Tests that **must** stay green for the recent commits

When reviewing changes to the AutoResearch setup modal, the Tauri browser
compatibility layer, the i18n `diagnostics.*` keys, or the gated e2e
LLM smoke test, the following commands are the regression gate:

```bash
node_modules/.bin/tsc --noEmit
pnpm run build
pnpm test -- AutoResearchSetupModal
pnpm test -- safeInvoke
pnpm test -- e2eRealLlm   # skips cleanly without env, see 0414ed6
```

The `pnpm test -- autoresearch` aggregate is **not** a useful gate for
these commits because of the pre-existing failures documented above.
