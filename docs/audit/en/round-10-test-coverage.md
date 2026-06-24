# Round 10 — Test Coverage & Gaps

**Scope:** Full-repo test matrix, CI failure triage, prioritized test backlog

Chinese version: [../round-10-test-coverage.md](../round-10-test-coverage.md)

---

## CI status

### Audit day baseline

- **194** test suites, **24 failed** (12.4%)
- **1363** tests, **34 failed**
- AutoResearch accounted for **~46%** of failing suites

### After remediation

- **195** test suites, **0 failed**
- **1382** tests, **1381 passed**, 1 skipped
- New suite: `store/chat/__tests__/sessionIsolation.test.ts`

Stabilize failing suites before expanding coverage — **completed**. Coverage numbers are now meaningful.

---

## Zero coverage / critical paths without tests

| ID | Sev | Path | Gap | Suggested test |
| --- | --- | ---- | --- | -------------- |
| R10-01 | Critical | `App.tsx` | No bootstrap/routing integration test | Mock stores + view switching |
| R10-02 | Critical | `ChatBrowserWorkspaceShell.tsx` | Main shell untested | split, permission, terminal |
| R10-03 | Critical | `MainLayout.tsx` | Three-column layout/responsive untested | Breakpoint panel visibility |
| R10-04 | High | `telegramStore.ts` | connect/disconnect untested | Mock service + poller |
| R10-05 | High | `telegramService.ts` | error mapping untested | 401/429 table-driven |
| R10-06 | High | `telegram/bindings.ts` | owner rules not directly tested | first owner / group reject |
| R10-07 | High | `telegram/taskService.ts` | DB bridge no TS test | mock db_* round-trip |
| R10-08 | Critical | `tools/impl/*` | 20/22 untested | BashTool, FileRead, WebFetch |
| R10-09 | Medium | `ExecutionModeDropdownErrorBoundary` | untested | child throw → fallback |
| R10-10 | Medium | `taskDiagnosticsWiring.ts` | untested | swarm → diagnostics sync |
| R10-11 | Medium | `uiStoreMigration.test.ts` | invalid permission shape | correct `_resolve` + ledger |
| R10-12 | Medium | `useResponsiveLayout.ts` | untested | resize simulation |
| R10-13 | Medium | `useChatMessageScroll.ts` | untested (no @testing-library/react) | Pure DOM mock or add devDep |
| R10-14 | Medium | `TelegramSettings.tsx` | untested | validate/connect flow |
| R10-15 | Low | `pages/Skill.tsx` | untested | smoke |
| R10-16 | Low | `website/src` | 0 tests | changelog.ts unit test |

---

## Top 10 tests to add (cross-round summary)

1. `App.tsx` bootstrap + routing
2. `ChatBrowserWorkspaceShell` split + permissions
3. `MainLayout` responsive panels
4. `chatActions` session switch during stream (R1-01/02) — code fixed, regression test needed
5. `listenerGuard` ref-count (R4-01) — code fixed, regression test needed
6. `QueryEngine` tool_batch timeout (R4-03) — code fixed, regression test needed
7. `chatAdapter` signal → headless (R5-01) — code fixed, regression test needed
8. `loopEngine` stop / delete active run (R5-03/05) — code fixed, regression test needed
9. `telegramService` ↔ Rust command parity (R9-01)
10. `MarkdownDocumentPreview` + `ChatMessage` XSS (R7-07/08) — code fixed, regression test needed

---

## tools/impl test gaps

| Has tests | No tests (examples) |
| --------- | ------------------- |
| `SshTool` | `BashTool`, `FileReadTool`, `FileWriteTool` |
| `SavePlanDocTool` | `WebSearchTool`, `WebFetchTool`, `GrepTool`, … |

**Total: 16 findings** (primarily test-gap items)