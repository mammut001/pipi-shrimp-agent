# Audit Baseline — Methodology & Test Status

**Date:** 2026-06-23  
**Auditor:** AI-assisted 10-round static + test-run review  
**Original constraint:** Findings only — no code fixes in the audit pass  
**English version** · Chinese: [../00-baseline.md](../00-baseline.md)

---

## Remediation update

A follow-up remediation pass fixed P0 TypeScript/React issues and stabilized CI.  
See [README.md](./README.md#remediation-post-audit) for the full fixed/open matrix.

| Metric | Audit day | After remediation |
| ------ | --------- | ----------------- |
| Test suites | 194 total — **24 failed**, 170 passed | **195 passed**, 0 failed |
| Tests | 1363 total — **34 failed**, 1 skipped, 1328 passed | **1382 total — 1381 passed**, 1 skipped, 0 failed |
| Duration | ~431s | ~528s |

Command (post-remediation): `npm test -- --no-coverage` → all suites green.

---

## Methodology

Each round followed:

1. **Scope mapping** — identify entry points, stores, and cross-module dependencies
2. **Static review** — read production paths (not only tests)
3. **Drift detection** — compare duplicate implementations (`Chat.tsx` vs shell, TS vs Rust path checks)
4. **Test gap analysis** — map `__tests__` coverage to critical paths
5. **Severity assignment** — user impact × exploitability × likelihood

### Production entry points verified

| Route / View | Actual component |
| ------------ | ---------------- |
| `currentView === 'chat'` | `ChatBrowserWorkspaceShell` (`App.tsx`) |
| `pages/Chat.tsx` | **Not wired to routing** (dead code, still maintained) |
| Browser split | `browserDockMode === 'split'` → `BrowserWorkspacePane` + chat panel (R1-03 fixed) |

---

## Full test run results (audit day)

Command: `npm test -- --no-coverage`

| Metric | Value |
| ------ | ----- |
| Test suites | 194 total — **24 failed**, 170 passed |
| Tests | 1363 total — **34 failed**, 1 skipped, 1328 passed |
| Duration | ~431s |

### Failing suites (24) — historical

| Suite | Area |
| ----- | ---- |
| `services/autoresearch/__tests__/chatAdapter.test.ts` | AutoResearch |
| `services/autoresearch/__tests__/loopEngine.integration.test.ts` | AutoResearch |
| `services/autoresearch/__tests__/localSmoke.test.ts` | AutoResearch |
| `services/autoresearch/__tests__/metricsStore.test.ts` | AutoResearch |
| `services/autoresearch/__tests__/reflection.test.ts` | AutoResearch |
| `services/autoresearch/__tests__/runDir.test.ts` | AutoResearch |
| `services/autoresearch/__tests__/setupFlow.test.ts` | AutoResearch |
| `services/autoresearch/__tests__/terminalRunner.test.ts` | AutoResearch |
| `services/tools/autoresearchBootstrap/__tests__/scaffoldGenerate.test.ts` | AutoResearch |
| `store/__tests__/autoresearchStore.test.ts` | AutoResearch |
| `components/__tests__/AutoResearchPanel.liveOutput.test.ts` | AutoResearch UI |
| `components/__tests__/AgentPanel.test.ts` | UI |
| `components/__tests__/ChatMessage.resume.test.ts` | Chat UI |
| `components/workflow/__tests__/AgentConfigPanel.test.ts` | Workflow UI |
| `components/workflow/__tests__/WorkflowView.test.ts` | Workflow UI |
| `components/workflow/__tests__/WorkflowRunHistory.test.ts` | Workflow UI |
| `components/workflow/__tests__/WorkflowOutputPanel.test.ts` | Workflow UI |
| `services/__tests__/workflowEngine.goalLoop.test.ts` | Workflow |
| `services/swarm/__tests__/memoryPaths.test.ts` | Swarm |
| `__tests__/uiStoreMigration.test.ts` | UI Store |
| `__tests__/DatabaseHealthSection.test.ts` | Diagnostics |
| `__tests__/DocPanel.test.ts` | Docs |
| `__tests__/AppErrorBoundary.test.tsx` | Error boundary |
| `skills/resume/__tests__/resumeTemplateSmoke.test.ts` | Resume skill |

> **Observation:** 11 of 24 failing suites were **AutoResearch**, indicating severe test/implementation drift in that area. CI stabilization was prioritized before expanding coverage.

### Example failure (loopEngine integration)

`loopEngine.integration.test.ts:829` — expected `metricsJson` to be `null`, but a metrics record was written. May relate to API failure convergence logic changes; needs separate triage (**test/implementation mismatch**, not necessarily a production bug).

---

## Coverage

`npm run test:coverage` was not run to completion in the audit round (full suite ~7min+). Recommended locally:

```bash
npm run test:coverage
# or
bash tools/view-coverage.sh
```

### Manual coverage gap estimate

| Area | Test density | Gap |
| ---- | ------------ | --- |
| `store/chat/*` | High (15+ files) | Medium |
| `services/autoresearch/*` | High but **11/24 suites failed on audit day** | High (stability) — **resolved post-remediation** |
| `App.tsx`, `main.tsx` | **None** | Critical |
| `ChatBrowserWorkspaceShell.tsx` | **None** | Critical |
| `layout/MainLayout.tsx` | Mock only | High |
| `hooks/*` | Only `usePolling` | High |
| `tools/impl/*` | 2/22 | Critical |
| `website/` | 0 (standalone Next.js) | N/A |

---

## Relationship to prior audit

[`docs/audits/full-codebase.md`](../../audits/full-codebase.md) documents 97 historical issues and 30 fixes (`AUDIT-FIX` anchors).  
This round was a **fresh pass**, re-verifying some prior fixes (e.g. Rust `is_within_dir`) and finding **TypeScript `pathValidation.ts` still used `startsWith`** (R7-01) — **now fixed** via `isWithinDir`.