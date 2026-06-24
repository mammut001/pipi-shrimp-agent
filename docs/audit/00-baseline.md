# Audit Baseline — Methodology & Test Status

**Date:** 2026-06-23  
**Auditor:** AI-assisted 10-round static + test-run review  
**Constraint:** Findings only — no code fixes in this pass  
**English:** [en/00-baseline.md](./en/00-baseline.md)

## 修复进展（Remediation）

审计后修复多项 P0 问题，CI 已全绿：**195 suites passed，1381 tests passed**（原 24 failed suites / 34 failed tests）。  
详见 [README.md](./README.md#修复进展remediation) 与 [en/README.md](./en/README.md#remediation-post-audit)。

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
| ------------ | -------------- |
| `currentView === 'chat'` | `ChatBrowserWorkspaceShell` (`App.tsx`) |
| `pages/Chat.tsx` | **未接入路由**（死代码，仍维护） |
| Browser split | `browserDockMode === 'split'` → 仅 `BrowserWorkspacePane` |

---

## Full test run results

Command: `npm test -- --no-coverage`

| Metric | Value |
| ------ | ----- |
| Test suites | 194 total — **24 failed**, 170 passed |
| Tests | 1363 total — **34 failed**, 1 skipped, 1328 passed |
| Duration | ~431s |

### Failing suites (24)

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

> **观察：** 24 个失败 suite 中 **11 个属于 AutoResearch**，说明该区域测试与实现漂移严重，应优先稳定 CI 再扩覆盖。

### Example failure (loopEngine integration)

`loopEngine.integration.test.ts:829` — 期望 `metricsJson` 为 `null`，实际写入了 metrics 记录。可能与 API 失败收敛逻辑变更有关，需单独 triage（**测试/实现不一致**，不一定是生产 bug）。

---

## Coverage

`npm run test:coverage` 未在本轮完整跑完（全量 suite ~7min+）。建议本地：

```bash
npm run test:coverage
# 或
bash tools/view-coverage.sh
```

### 手动覆盖缺口估计

| 区域 | 测试密度 | 缺口 |
| ---- | -------- | ---- |
| `store/chat/*` | 高（15+ files） | 中 |
| `services/autoresearch/*` | 高但 **24 suite 中 11 失败** | 高（稳定性） |
| `App.tsx`, `main.tsx` | **无** | Critical |
| `ChatBrowserWorkspaceShell.tsx` | **无** | Critical |
| `layout/MainLayout.tsx` | 仅 mock | High |
| `hooks/*` | 仅 `usePolling` | High |
| `tools/impl/*` | 2/22 | Critical |
| `website/` | 0（独立 Next.js） | N/A |

---

## Relationship to prior audit

[`docs/audits/full-codebase.md`](../audits/full-codebase.md) 记录了历史 97 issues 及 30 项已修复（`AUDIT-FIX` 锚点）。  
本轮为 **fresh pass**，重复验证了部分已修项（如 Rust `is_within_dir`），并发现 **TS 侧 `pathValidation.ts` 仍用 `startsWith`**（R7-01）。