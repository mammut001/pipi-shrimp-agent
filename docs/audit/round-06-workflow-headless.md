# Round 6 — Workflow & Headless

**Scope:** `workflowEngine/*`, `Workflow.tsx`, workflow components, `headless/agentRunner`

---

## Findings

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R6-01 | P0 | `engine.ts:559-589` | `createRunDirectory` 失败后继续执行，产物静默丢失 | reject 后 run → error |
| R6-02 | P0 | `engine.ts:239-250`, `agentRunner.ts:163-228` | `stop()` 不取消 in-flight streaming invoke | stop 后不等待完整 completion |
| R6-03 | Medium | `agentRunner.ts:336-398` | abort 在 tool batch 期间不检查（最长 120s） | abort during executeBatch |
| R6-04 | Medium | `agentRunner.ts:342-350` | 流式 `finalText +=` O(n²) | 10k chunks 性能 |
| R6-05 | Medium | `engine.ts:403-409` | 缺失 upstream agent 用 `!` 抛错 | stale inputFrom 优雅 skip |
| R6-06 | Medium | `WorkflowGoalPreflightPanel` | 无 AbortController | 关闭 panel 取消 headless |
| R6-07 | Medium | `BootstrapChatView.tsx:255-272` | bootstrap 创建 orphan workflow run | AR 失败后 workflow 状态更新 |
| R6-08 | Low | `WorkflowExecutionBar.tsx:39-50` | `handleRun` 无 catch | engine throw 不 unhandled |
| R6-09 | Low | `engine.ts:692-700` | stop 后 `getIsRunning()` 仍为 true | 与 store 一致 |
| R6-10 | Low | `agentRunner.ts:206-214` | IPC 仍传 raw apiKey | configId-only invoke |
| R6-11 | Test-gap | `engine.test.ts` | 缺 stop/directory/upstream 路径 | 新 describe block |
| R6-12 | Test-gap | `headless/agentRunner.test.ts` | 缺 abort-during-tool | 见 R6-03 |
| R6-13 | Test-gap | Workflow UI tests | 无双击 Run 防护 | rapid double-click |

**Total: 13 findings**