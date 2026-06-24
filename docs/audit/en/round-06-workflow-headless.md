# Round 6 — Workflow & Headless

**Scope:** `workflowEngine/*`, `Workflow.tsx`, workflow components, `headless/agentRunner`

Chinese version: [../round-06-workflow-headless.md](../round-06-workflow-headless.md)

> **Remediation:** R6-01 and R6-02 (P0) remain **open**. R4-02 partially overlaps R6-02 regarding `isRunning` after stop.

---

## Findings

| ID | Sev | Location | Description | Suggested test | Status |
| --- | --- | -------- | ----------- | -------------- | ------ |
| R6-01 | P0 | `engine.ts:559-589` | `createRunDirectory` failure still continued execution — artifacts silently lost | Reject → run transitions to error | ❌ Open |
| R6-02 | P0 | `engine.ts:239-250`, `agentRunner.ts:163-228` | `stop()` did not cancel in-flight streaming invoke | Stop does not wait for full completion | ❌ Open |
| R6-03 | Medium | `agentRunner.ts:336-398` | Abort not checked during tool batch (up to 120s) | Abort during executeBatch | Open |
| R6-04 | Medium | `agentRunner.ts:342-350` | Streaming `finalText +=` is O(n²) | 10k chunks performance | Open |
| R6-05 | Medium | `engine.ts:403-409` | Missing upstream agent throws with `!` | Graceful skip for stale inputFrom | Open |
| R6-06 | Medium | `WorkflowGoalPreflightPanel` | No AbortController | Closing panel cancels headless | Open |
| R6-07 | Medium | `BootstrapChatView.tsx:255-272` | Bootstrap creates orphan workflow run | Workflow state updated after AR failure | Open |
| R6-08 | Low | `WorkflowExecutionBar.tsx:39-50` | `handleRun` has no catch | engine throw does not cause unhandled rejection | Open |
| R6-09 | Low | `engine.ts:692-700` | `getIsRunning()` still true after stop | Consistent with store | Partially addressed via R4-02 |
| R6-10 | Low | `agentRunner.ts:206-214` | IPC still passes raw apiKey | configId-only invoke | Open |
| R6-11 | Test-gap | `engine.test.ts` | Missing stop/directory/upstream paths | New describe block | Open |
| R6-12 | Test-gap | `headless/agentRunner.test.ts` | Missing abort-during-tool | See R6-03 | Open |
| R6-13 | Test-gap | Workflow UI tests | No double-click Run guard | Rapid double-click | Open |

**Total: 13 findings**