# Round 10 — Test Coverage & Gaps

**Scope:** 全仓库测试矩阵、CI 失败 triage、优先补测清单

---

## CI 现状（审计基线）

- **194** test suites，**24 failed**（12.4%）
- **1363** tests，**34 failed**
- AutoResearch 占失败 suite 的 **~46%**

应先 **稳定 24 个失败 suite** 再扩覆盖，否则 coverage 数字误导。

---

## 零覆盖 / 关键路径无测

| ID | Sev | Path | Gap | Suggested test |
| --- | --- | ---- | --- | -------------- |
| R10-01 | Critical | `App.tsx` | 无 bootstrap/路由集成测 | mock stores + view 切换 |
| R10-02 | Critical | `ChatBrowserWorkspaceShell.tsx` | 主 shell 无测 | split、permission、terminal |
| R10-03 | Critical | `MainLayout.tsx` | 三栏布局/响应式无测 | breakpoint panel 可见性 |
| R10-04 | High | `telegramStore.ts` | connect/disconnect 无测 | mock service + poller |
| R10-05 | High | `telegramService.ts` | error mapping 无测 | 401/429 table-driven |
| R10-06 | High | `telegram/bindings.ts` | owner 规则无直接测 | first owner / group reject |
| R10-07 | High | `telegram/taskService.ts` | DB bridge 无 TS 测 | mock db_* round-trip |
| R10-08 | Critical | `tools/impl/*` | 20/22 无测 | BashTool, FileRead, WebFetch |
| R10-09 | Medium | `ExecutionModeDropdownErrorBoundary` | 无测 | child throw → fallback |
| R10-10 | Medium | `taskDiagnosticsWiring.ts` | 无测 | swarm → diagnostics sync |
| R10-11 | Medium | `uiStoreMigration.test.ts` | permission shape 无效 | 正确 `_resolve` + ledger |
| R10-12 | Medium | `useResponsiveLayout.ts` | 无测 | resize 模拟 |
| R10-13 | Medium | `useChatMessageScroll.ts` | 无测（无 @testing-library/react） | 纯 DOM mock 或加 devDep |
| R10-14 | Medium | `TelegramSettings.tsx` | 无测 | validate/connect flow |
| R10-15 | Low | `pages/Skill.tsx` | 无测 | smoke |
| R10-16 | Low | `website/src` | 0 tests | changelog.ts 单元测 |

---

## 优先补测 Top 10（跨 round 汇总）

1. `App.tsx` bootstrap + routing
2. `ChatBrowserWorkspaceShell` split + permissions
3. `MainLayout` responsive panels
4. `chatActions` session switch during stream (R1-01/02)
5. `listenerGuard` ref-count (R4-01)
6. `QueryEngine` tool_batch timeout (R4-03)
7. `chatAdapter` signal → headless (R5-01)
8. `loopEngine` stop / delete active run (R5-03/05)
9. `telegramService` ↔ Rust command parity (R9-01)
10. `MarkdownDocumentPreview` + `ChatMessage` XSS (R7-07/08)

---

## 工具 impl 测试缺口

| 有测试 | 无测试（示例） |
| ------ | -------------- |
| `SshTool` | `BashTool`, `FileReadTool`, `FileWriteTool` |
| `SavePlanDocTool` | `WebSearchTool`, `WebFetchTool`, `GrepTool`, … |

**Total: 16 findings**（以 test-gap 为主）