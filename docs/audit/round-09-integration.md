# Round 9 — Cross-Cutting Integration

**Scope:** `App.tsx`, `main.tsx`, `MainLayout`, error boundaries, Telegram wiring, dead code

---

## Findings

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R9-01 | High | `telegramService.ts:150-311` | invoke 命令未在 `lib.rs` 注册 | 每 `telegram_*` 有 handler |
| R9-02 | High | `telegramStore.ts:321-354` | `telegramEmit` 从未被调用；事件路径死亡 | 仅 poller 摄入 updates |
| R9-03 | Medium | `telegramStore.ts:328-330` | `messageId` vs `updateId` 混用可腐化 offset | poller 只用 updateId |
| R9-04 | Medium | `App.tsx:59-72` | `DeprecatedBrowserViewFallback` 不可达（uiStore 归一化 browser→chat） | 死分支删除或文档 |
| R9-05 | Medium | `App.tsx:96-106` | 后台 init 无 unmount abort；StrictMode 双 connect | init 幂等 |
| R9-06 | Medium | `App.tsx:131-150` | critical init 失败仍显示窗口，无 fatal UI | mock initChat fail |
| R9-07 | Low | `MainLayout.tsx:164` | 窄屏隐藏 right panel toggle | width 600 + showRightPanel |
| R9-08 | Low | `useResponsiveLayout.ts` | 文档 breakpoint 与常量不一致 | 719/720/1388 边界 |
| R9-09 | Low | `ExecutionModeDropdownErrorBoundary` | 无 recovery UI | fallback + remount |
| R9-10 | Info | `package.json` | `grammy` 依赖未使用 | depcheck |
| R9-11 | Info | `pages/Chat.tsx` | 死代码 ~377 行 | import graph 不含 |
| R9-12 | Info | `chat.ts` + `chatHelpers.ts` | 重复 `mergeReasoningParts` | 单源 |
| R9-13 | Info | `telegram.rs:287-291` | token 在 GET URL（API 设计） | 错误路径脱敏 |

---

## Error boundary 矩阵

| Component | 挂载点 | 测试 |
| --------- | ------ | ---- |
| `AppErrorBoundary` | `main.tsx` | ✅ `AppErrorBoundary.test.tsx` |
| `ExecutionModeDropdownErrorBoundary` | `ChatInput.tsx` | ❌ 无 |

`recoverToChatView` 测试（`uiStoreMigration`）未验证 permission `_resolve(false)` 与 ledger `cancelled`。

**Total: 13 findings**