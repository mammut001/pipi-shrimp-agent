# Test Gaps Backlog — Actionable Sprint Items

从 10 轮审计提取的 **仅测试相关** 任务，按优先级排序。可直接转为 GitHub issues。

---

## P0 — 必须先有测试再改代码

| # | 模块 | 测试描述 | 关联 finding |
| --- | ---- | -------- | ------------ |
| T-01 | Chat | 流式中 `selectSession`：内容不串会话、选中会话 chrome 清空；后台 turn 继续写 owning session（不在切换时 cancel）✅ Fixed 2026-09-17 | R1-01, R1-02 |
| T-02 | Shell | `browserDockMode=split` 时 ChatInput 可见性或明确 UX ✅ Fixed 2026-09-17 | R1-03 |
| T-03 | Core | `QueryEngine` tool_batch 无 resolve → timeout/reject ✅ 已覆盖 2026-09-26（`src/core/__tests__/QueryEngine.test.ts`） | R4-03 |
| T-04 | AutoResearch | `chatAdapter` AbortSignal 传到 `runHeadlessAgentTurn` ✅ 已覆盖 2026-09-26（`src/services/autoresearch/__tests__/chatAdapter.test.ts`） | R5-01 |
| T-05 | AutoResearch | `deleteRun` + in-flight loop 停止 ✅ 已覆盖 2026-09-26（`src/store/__tests__/autoresearchStore.test.ts`） | R5-05 |
| T-06 | Workflow | `createRunDirectory` reject → run 不继续 ✅ 已覆盖 2026-09-26（`src/services/workflowEngine/__tests__/engine.test.ts`） | R6-01 |
| T-07 | Security | `pathValidation.ts` sibling-prefix ✅ 已覆盖 2026-09-26（`src/services/tools/__tests__/pathValidation.test.ts`） | R7-01 |
| T-08 | Security | `ChatMessage` / `MarkdownDocumentPreview` XSS 向量 ✅ 已覆盖 2026-09-26（`src/utils/__tests__/markdownSafety.test.tsx`） | R7-07, R7-08 |

---

## P1 — 主路径集成

| # | 模块 | 测试描述 | 关联 |
| --- | ---- | -------- | ---- |
| T-09 | App | bootstrap 顺序、lazy route、init 失败 UI ✅ 已覆盖 2026-09-26（`src/__tests__/App.bootstrap-routing.test.tsx`） | R10-01, R9-06 |
| T-10 | Shell | `ChatBrowserWorkspaceShell` permission 队列 FIFO ✅ 已覆盖 2026-09-26（`src/components/__tests__/ChatBrowserWorkspaceShell.splitChatInput.test.tsx`） | R10-02 |
| T-11 | Shell | questionnaire `activeQuestionnaireSessionId` 过滤 ✅ 已覆盖 2026-09-26（`src/components/__tests__/ChatBrowserWorkspaceShell.splitChatInput.test.tsx`） | R1-15 |
| T-12 | Store | `listenerGuard` 乱序 unmount ✅ 已覆盖 2026-09-26（`src/store/__tests__/listenerGuard.test.ts`） | R4-01 |
| T-13 | Store | `StreamingToolExecutor` requiresConfirmation 路径 ✅ 已覆盖 2026-09-26（`src/services/__tests__/StreamingToolExecutor.test.ts`） | R4-07 |
| T-14 | Workflow | `engine.stop()` 后 `getIsRunning()` 与 restart ✅ 已覆盖 2026-09-26（`src/services/workflowEngine/__tests__/engine.test.ts`） | R4-02, R6-02 |
| T-15 | Telegram | `telegramService` invoke 与 `lib.rs` 注册表 parity ✅ Fixed 2026-09-17 | R7-12, R9-01, R10-05 |
| T-16 | Telegram | `allowedChats` 在 commandRouter 执行 ✅ Fixed 2026-09-24（chatAuthorization 拒绝未列入的 chat；commandRouter 在分发前拒绝未授权聊天） | R7-11 |
| T-17 | Browser | `stopTask` 停止 CDP loop ✅ 已覆盖 2026-09-26（`src/store/browser/__tests__/browserTaskStop.test.ts`） | R3-05 |
| T-18 | Rust | legacy `execute_tool` 与 batch 策略一致 ✅ 已覆盖 2026-09-26（`src-tauri/src/commands/legacy_execute_tool.rs`） | R2-01 |

---

## P2 — 组件 & hooks

| # | 模块 | 测试描述 | 关联 |
| --- | ---- | -------- | ---- |
| T-19 | Hook | `useChatMessageScroll` debounce + unmount ✅ 已覆盖 2026-09-26（`src/hooks/__tests__/useChatMessageScroll.test.tsx`） | R1-11, R10-13 |
| T-20 | Hook | `useResponsiveLayout` 断点 | R9-08, R10-12 |
| T-21 | UI | `ScrollToBottomButton` visible when scrolled up | 近期功能 |
| T-22 | UI | `TerminalPanel` shell profile + error banner | R8-13 |
| T-23 | UI | `Sidebar` 批量删除确认 | R8-12 |
| T-24 | UI | `AgentPanel` i18n 关键字符串 | R8-04 |
| T-25 | Error | `ExecutionModeDropdownErrorBoundary` fallback | R10-09 |
| T-26 | Error | `recoverToChatView` permission resolve false | R4-14, R10-11 |

---

## P3 — 工具 & 基础设施

| # | 模块 | 测试描述 |
| --- | ---- | -------- |
| T-27 | tools/impl | `BashTool` schema + policy |
| T-28 | tools/impl | `FileReadTool` / `FileWriteTool` path sandbox |
| T-29 | tools/impl | `WebFetchTool` SSRF 限制 |
| T-30 | streamAdapter | listen/invoke mock 全套 | R4-29 |
| T-31 | artifactDetector | workDir undefined + Windows paths | R7-03, R7-04 |
| T-32 | i18n | Settings 按钮用 `settings.fetchModels` | R8-01 |
| T-33 | CI | 修复 24 个失败 suite 并加 regression ✅ 2026-09-26：jest 356/356 suites 全绿 | 00-baseline |

---

## 测试基础设施建议

1. **添加 `@testing-library/react`** — ✅ Fixed 2026-09-17（INFRA-01：RTL + jest-dom/user-event + `useChatMessageScroll` sample）
2. **Rust:** 扩展 `src-tauri` 内 `#[cfg(test)]` 覆盖 `session_memory`, `ssh_bridge`, `commands/tools.rs`
3. **契约测试:** `tools/check-tauri-commands.mjs` 扫描 TS `invoke('...')` vs `lib.rs` 生成表 ✅ Added 2026-09-17 (telegram scope / R7-12)
4. **CI 分片:** AutoResearch integration 380s+ 应单独 job，避免阻塞 PR

---

## 估算工作量

| 档位 | 项数 | 粗略人天 |
| ---- | ---- | -------- |
| P0 | 8 | 3–5 |
| P1 | 10 | 5–8 |
| P2 | 8 | 4–6 |
| P3 | 7 | 5–10 |
| CI 稳定 | 24 suites | 2–4 |

*不含修复 bug 本身，仅测试编写与 CI 绿化。*