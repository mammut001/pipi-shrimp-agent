# Round 1 — Chat & Messaging

**Scope:** `ChatBrowserWorkspaceShell`, `Chat.tsx`, `useChatMessageScroll`, `store/chat/*`, `ChatInput`, `ChatMessage`, `utils/chat*`

**Production path:** `App.tsx` → `ChatBrowserWorkspaceShell`（`Chat.tsx` 未路由）

---

## Findings

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R1-01 | P0 | `chatActions.ts:1088-1206` | `appendStreamingContent` / `updateLastMessage` 用 `currentSessionId` 而非 `streamingSessionId`；切 session 时流式内容可能写入错误会话 | 会话 A 流式中切到 B；断言 B 不变、A 收到 delta |
| R1-02 | P0 | `createChatStore.ts:855-913`, `chatActions.ts:653-685` | `selectSession` 停子进程并清 `isStreaming`，但不调 `requestChatGenerationCancel`；后台 `for await` 继续 | 长流中切 session；断言 generator 退出 |
| R1-03 | P1 | `ChatBrowserWorkspaceShell.tsx:644-653` | `split` 模式只渲染 `BrowserWorkspacePane`，无消息列表/`ChatInput`；`focusChatPane()` 无 UI 效果 | split 模式断言 `ChatInput` 缺失 |
| R1-04 | P1 | `chat.ts:70-74` vs shell:296-299 | `processMessagesForDisplay` 不过滤 `metadata.hidden`；shell 内联过滤，逻辑漂移 | hidden 消息单元测试 |
| R1-05 | P1 | shell:293-347 vs `chat.ts:70-120` | 显示管线重复实现（reasoning merge、`isRenderableMessage`） | 同 fixture 金样对比 |
| R1-06 | P1 | `chatActions.ts:1008-1044` | `retryLastMessage` 可能重试 hidden synthesis 用户消息 | hidden + visible user；retry 应选 visible |
| R1-07 | P1 | `createChatStore.ts:108-117`, `ChatMessage.tsx` | `system` compact boundary 可能渲染为 assistant 气泡 | compact boundary 不出现在 UI |
| R1-08 | P1 | `chatActions.ts:361-413` | 另一 session 流式时仍可向其他 session `sendMessage` | 重叠 send 应互斥 |
| R1-09 | P2 | `chatActions.ts:372-477` | diagnostics task 注册后早退路径未清理任务 | 无效 config send；task 应 failed/cancelled |
| R1-10 | P2 | shell:252-271, `Chat.tsx:89-108` | terminal CWD promise 无 `.catch()` | mock reject；无 unhandled rejection |
| R1-11 | P2 | `useChatMessageScroll.ts:12-22` | scroll debounce timer unmount 未清理 | unmount 后 debounce 不 setState |
| R1-12 | P2 | shell:201-217 | terminal 拖拽 listener 无 unmount cleanup | 拖拽中 unmount 不泄漏 listener |
| R1-13 | P2 | `ChatInput.tsx:682` | 切 session 后 `isStreaming=false` 但后台 turn 可能仍在 | 切 session 后 input 禁用策略 |
| R1-14 | P2 | `pages/Chat.tsx` | 死代码与 shell 并行维护 | 生产 import 图不含 Chat.tsx |
| R1-15 | P2 | `Chat.tsx:364` vs shell:670 | 问卷未按 sessionId 过滤（shell 正确） | 跨 session 问卷不可见 |
| R1-16 | P2 | `useChatMessageScroll.ts:29-33` | 依赖 `displayMessages` 但渲染 `visibleMessages`；展开历史不滚底 | showFullHistory 后滚动策略 |
| R1-17 | P2 | `chatActions.ts:1047-1051` | `addMessage` 无 session 时静默 return | 应 throw 或显式错误 |
| R1-18 | P3 | `chat.ts` + `chatHelpers.ts` | `mergeReasoningParts` 重复实现 | 单源 + re-export |
| R1-19 | P3 | `Chat.tsx:287` vs shell | 全局 “AI thinking” 条仅 legacy 有 | shell streaming 指示一致性 |
| R1-20 | P3 | error banner 样式 | `bg-red-50` vs `error-banner` 主题类 | 共享 ErrorBanner |
| R1-21 | P3 | terminal `key={terminalCwd}` | legacy Chat 无 cwd remount | 换 workDir 后 PTY cwd |
| R1-22 | P3 | `ChatMessage` vs `chatHelpers` | `__TOOL_RESULT__` 解析 regex 不一致 | 含 `:` 的 ID 一致解析 |
| R1-23 | P3 | `useChatMessageScroll.ts:31` | 流式时每 delta smooth scroll 可能卡顿 | streaming 用 `auto` 或无动画 |
| R1-24 | P3 | `ChatMessage.tsx:72-85` | 复制失败仅 console | clipboard reject 应 toast |
| R1-25 | P3 | `SwarmPanelDraggable:118-125` | 拖拽中 unmount 不删 document listener | 同 R1-12 |

---

## Test coverage (existing vs gaps)

**已有：** `chatStoreSendMessage`, `chatStreaming`, `chatPersistence`, `messageWindowing`, `ChatInputFlow`, `ChatMessage.resume`

**缺失：**

- `useChatMessageScroll` — debounce、unmount、windowed history、ScrollToBottomButton 可见性
- `ChatBrowserWorkspaceShell` — split 模式、问卷 session、消息显示 parity
- `chatActions` — session 切换 + 流式、retry hidden、diagnostics 清理
- `processMessagesForDisplay` — hidden、system compact boundary

---

## Summary

| Severity | Count |
| -------- | ----- |
| P0 | 2 |
| P1 | 6 |
| P2 | 8 |
| P3 | 7 |

**最高优先：** R1-01/02（session 隔离）+ R1-03（split 无聊天）