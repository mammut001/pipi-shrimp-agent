# 10-Round Code Audit — 2026-06-23

> **只审计、不修复。** 本轮审计聚焦 bug、安全风险、架构漂移与测试缺口。  
> 上一轮全量审计见 [`docs/audits/full-codebase.md`](../audits/full-codebase.md)（含已修复项）。  
> **English:** [en/README.md](./en/README.md)

## 修复进展（Remediation）

审计后已进行一轮代码修复，CI 已绿化：

| 指标 | 审计当日 | 修复后 |
| ---- | -------- | ------ |
| Test suites | 194，**24 failed** | **195 passed**，0 failed |
| Tests | 1363，**34 failed** | **1381 passed**，1 skipped |

**已修复 P0 / Critical（2026-06-24 检查点）：** 见 [p0-critical-checkpoint.md](./p0-critical-checkpoint.md)

- 早期修复：R1-01–03、R4-01–03、R5-01/03/05、R7-01/07/08
- 本轮修复：R2-01–04、R3-01–06、R6-01/02、R7-11

**开放 Critical：** 0（backlog JSON）。下一阶段为 High 项（R3-07–10、R5-02、R7-04/06/12 等）与回归测试 — 详见检查点报告。

## 修复路线图（Remediation backlog）

从 10 轮审计提取的可执行 backlog，按 lane 分组、含 PR 执行顺序：

| 文档 | 说明 |
| ---- | ---- |
| [p0-critical-checkpoint.md](./p0-critical-checkpoint.md) | P0/Critical 检查点报告（2026-06-24）：已修复清单、backlog 一致性、下一阶段 10 PR |
| [remediation-roadmap.md](./remediation-roadmap.md) | 人类可读路线图：Recommended Next 10 PRs、Fixed/Verify 区、A–I lane |
| [remediation-backlog.json](./remediation-backlog.json) | 机器可读 backlog（P0、Top 15 测试、开放安全项、AutoResearch、架构治理） |

## 审计范围

| Round | 模块 | 报告 | 发现数 |
| ----- | ---- | ---- | ------ |
| 1 | Chat / Messaging | [round-01-chat-messaging.md](./round-01-chat-messaging.md) | 25 |
| 2 | Rust / Tauri Backend | [round-02-rust-backend.md](./round-02-rust-backend.md) | 34 |
| 3 | Browser Automation | [round-03-browser-automation.md](./round-03-browser-automation.md) | 27 |
| 4 | Store & Core Services | [round-04-store-services.md](./round-04-store-services.md) | 33 |
| 5 | AutoResearch | [round-05-autoresearch.md](./round-05-autoresearch.md) | 16 |
| 6 | Workflow & Headless | [round-06-workflow-headless.md](./round-06-workflow-headless.md) | 13 |
| 7 | Security | [round-07-security.md](./round-07-security.md) | 18 |
| 8 | i18n & UI | [round-08-i18n-ui.md](./round-08-i18n-ui.md) | 15 |
| 9 | Cross-Cutting Integration | [round-09-integration.md](./round-09-integration.md) | 13 |
| 10 | Test Coverage & Baseline | [round-10-test-coverage.md](./round-10-test-coverage.md) | 16 |

**合计：约 210 条发现**（含 Test-gap 条目）

## 测试基线（审计当日）

```
Test Suites: 24 failed, 170 passed, 194 total
Tests:       34 failed, 1 skipped, 1328 passed, 1363 total
Time:        ~431s
```

详见 [00-baseline.md](./00-baseline.md)。测试任务 backlog 见 [test-gaps-backlog.md](./test-gaps-backlog.md)。

## 优先级总览（P0 / Critical）

| ID | 模块 | 摘要 |
| --- | ---- | ---- |
| R1-01 | Chat | 流式输出写入 `currentSessionId` 而非 `streamingSessionId`，切 session 会写错消息 |
| R1-02 | Chat | `selectSession` 不取消进行中的 generation，后台 loop 继续跑 |
| R1-03 | Chat | Split 模式下无聊天面板/输入框，用户无法发消息 |
| R2-01 | Rust | Legacy `execute_tool` 绕过 registry + execution_policy |
| R2-02 | Rust | `execute_single_tool` 未传 sessionId，审批 token 无法消费 |
| R2-03 | Rust | `session_memory` 丢弃 `validate_work_dir` 错误 |
| R2-04 | Rust | SSH local 模式 shell 注入 |
| R3-04 | Browser | 嵌入式 WebView 与外部 CDP Chrome 分裂，用户看到的 ≠ agent 操作的 |
| R3-05 | Browser | `stopTask` 无法停止 native CDP loop |
| R3-06 | Browser | Rust `cdp_execute_script` 无策略门控 |
| R4-01 | Store | `listenerGuard` ref-count 卸载顺序错误会泄漏 Tauri listener |
| R4-02 | Store | Workflow `stop()` 后 `engine.isRunning` 仍为 true，阻塞新 run |
| R4-03 | Core | `QueryEngine` tool_batch 无超时，consumer 不 resolve 会永久挂起 |
| R5-01 | AutoResearch | `chatAdapter` 未把 `AbortSignal` 传给 `runHeadlessAgentTurn` |
| R5-03 | AutoResearch | Agent 失败后 `loopState` 未停，迭代可能继续 |
| R5-05 | AutoResearch | 删除 active run 不调用 `stopExperimentLoop` |
| R6-01 | Workflow | `createRunDirectory` 失败后仍继续执行 |
| R6-02 | Workflow | `stop()` 不取消 in-flight `invoke` 流 |
| R7-07 | Security | `ChatMessage` markdown `javascript:` 链接未拦截 |
| R7-08 | Security | `MarkdownDocumentPreview` 无 DOMPurify |
| R7-11 | Security | Telegram `allowedChats` 定义了但未在 router 执行 |

## 建议优先补的测试（Top 15）

1. Session 切换中流式隔离 — `chatActions` + `selectSession`
2. `ChatBrowserWorkspaceShell` split 模式布局与 `ChatInput` 可见性
3. `useChatMessageScroll` — debounce、unmount cleanup、windowed history
4. `listenerGuard` ref-count 并发注册/注销顺序
5. `QueryEngine` tool_batch 超时 / 无 resolve 场景
6. `StreamingToolExecutor` `requiresConfirmation` 绕过路径
7. Legacy `execute_tool` vs `execute_tool_batch` 策略一致性（Rust）
8. `chatAdapter` AbortSignal 传播到 headless turn
9. `loopEngine` stop / delete active run / failed 后继续迭代
10. `App.tsx` bootstrap + 路由集成
11. `ChatBrowserWorkspaceShell` 权限队列 + questionnaire session 隔离
12. `telegramService` invoke 与 Rust `lib.rs` 命令表 parity
13. `telegram/bindings` owner 授权 + `allowedChats` 执行
14. `MarkdownDocumentPreview` / `ChatMessage` XSS 向量
15. `pathValidation.ts` sibling-prefix escape（TS 侧）

## 与近期改动的关系

本轮审计包含刚加入的 **「回到底部」** 功能（`useChatMessageScroll` + `ScrollToBottomButton`）：

- **R1-11**：debounce timer 未在 unmount 时清理
- **R1-16**：`displayMessages` vs `visibleMessages` 展开历史时不触发滚底
- **R10-13**：hook 无单元测试（项目无 `@testing-library/react`）

## 文档约定

- **Severity**：P0/Critical > High/P1 > Medium/P2 > Low/P3 > Info
- **Test-gap**：专门标记缺少测试的发现，不计入 bug 修复优先级
- 每条发现含 **Suggested test** — 可直接转为 issue / sprint 任务