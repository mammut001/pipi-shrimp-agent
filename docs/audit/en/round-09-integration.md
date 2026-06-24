# Round 9 — Cross-Cutting Integration

**Scope:** `App.tsx`, `main.tsx`, `MainLayout`, error boundaries, Telegram wiring, dead code

Chinese version: [../round-09-integration.md](../round-09-integration.md)

---

## Findings

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R9-01 | High | `telegramService.ts:150-311` | invoke commands not registered in `lib.rs` | Every `telegram_*` has handler |
| R9-02 | High | `telegramStore.ts:321-354` | `telegramEmit` never called; event path dead | Only poller ingests updates |
| R9-03 | Medium | `telegramStore.ts:328-330` | `messageId` vs `updateId` mix can corrupt offset | Poller uses updateId only |
| R9-04 | Medium | `App.tsx:59-72` | `DeprecatedBrowserViewFallback` unreachable (uiStore normalizes browser→chat) | Delete dead branch or document |
| R9-05 | Medium | `App.tsx:96-106` | Background init has no unmount abort; StrictMode double connect | Init idempotent |
| R9-06 | Medium | `App.tsx:131-150` | Critical init failure still shows window, no fatal UI | Mock initChat fail |
| R9-07 | Low | `MainLayout.tsx:164` | Narrow screen hides right panel toggle | width 600 + showRightPanel |
| R9-08 | Low | `useResponsiveLayout.ts` | Documented breakpoint vs constants mismatch | 719/720/1388 boundaries |
| R9-09 | Low | `ExecutionModeDropdownErrorBoundary` | No recovery UI | Fallback + remount |
| R9-10 | Info | `package.json` | `grammy` dependency unused | depcheck |
| R9-11 | Info | `pages/Chat.tsx` | Dead code ~377 lines | Import graph excludes it |
| R9-12 | Info | `chat.ts` + `chatHelpers.ts` | Duplicate `mergeReasoningParts` | Single source |
| R9-13 | Info | `telegram.rs:287-291` | Token in GET URL (API design) | Redact on error paths |

---

## Error boundary matrix

| Component | Mount point | Test |
| --------- | ----------- | ---- |
| `AppErrorBoundary` | `main.tsx` | ✅ `AppErrorBoundary.test.tsx` |
| `ExecutionModeDropdownErrorBoundary` | `ChatInput.tsx` | ❌ None |

`recoverToChatView` test (`uiStoreMigration`) does not verify permission `_resolve(false)` and ledger `cancelled`.

**Total: 13 findings**