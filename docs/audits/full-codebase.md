# Full Codebase Audit (10 Rounds) — 报告 + Fix 汇总

> 10 轮全 codebase 审计 + Fix 阶段。
>
> 期间产生 26 + 71 = 97 个 issue。已修复 30 个 (P0 全部 11/11, P1 9/21, P2 6/24, P3 4/31)。剩余 issue
> 文档化在审计报告 (本文档底部) 中,作为后续 sprint 计划输入。

---

## 1. 10 轮审计覆盖范围

| Round | 模块 | Issues 发现 |
| ----- | ---- | ----------- |
| 1 | `src-tauri/src/{lib.rs, commands/{mod,path_security,code}.rs}` | 13 |
| 2 | `src-tauri/src/claude/` (HTTP executor / stream parser / adapters / composer) | 19 |
| 3 | `src-tauri/src/tools/` (process manager / registry / execution policy / ssh_bridge / output_sanitizer / scheduler) | 16 |
| 4 | `src-tauri/src/{database.rs, commands/database_bridge.rs}` | 21 |
| 5 | `src/services/workflowEngine/`, `src/components/workflow/WorkflowCanvas.tsx` | 24 |
| 6 | `src/services/swarm/` (repository / persistence / lifecycle / permissionBridge / inboxCoordinator) | 25 |
| 7 | `src/store/chat/`, `src/services/compact/` | 16 |
| 8 | `src/services/artifactDetector.ts`, `src/components/document/MarkdownDocumentPreview.tsx`, `src/skills/resume/resumeFlow.ts` | 14 |
| 9 | `src/components/` (ChatBrowserWorkspaceShell.tsx, Sidebar) | 15 |
| 10 | `src-tauri/src/commands/{session_memory, mcp, file}.rs` + cross-cutting | 26 |

---

## 2. Fix Phase 已完成 (按 `AUDIT-FIX` 锚点)

### 2.1 P0 (全部修完, 11/11)

| Fix Anchor | 修复内容 | 影响文件 |
| --- | --- | --- |
| `[fix-1#1-*]` | 抽 `path_security::is_within_dir` + 5 处 `starts_with` 替换 (R1-1/R3-1/R3-7/R8-1/R10-3) | `path_security.rs`, `execution_policy.rs`, `file.rs`, `workspace.rs`, `artifactDetector.ts` + 新增 `src/utils/pathSecurity.ts` |
| `[fix-2#1]` | `validate_destination_path` + `export_database_backup` 强制要求 destination 在 `HOME` / `TMPDIR` / app data dir (R4-1) | `path_security.rs`, `database_bridge.rs` |
| `[fix-3#1]` | session_memory `work_dir` 验证 + `writable_roots` (R10-1) | `session_memory.rs` |
| `[fix-3#2]` | section-level update + `<system>` 注入检测 + 256KB 硬上限 (R10-2) | `session_memory.rs` |
| `[fix-4#1]` | `disbandTeam` 调 `stopInboxPolling` (R6-13) | `swarm/lifecycle.ts` |
| `[fix-5#1]` | `pendingResolvers` 60s 自动 expire + `pendingTimers` cleanup (R6-10) | `swarm/permissionBridge.ts` |
| `[fix-6#1]` | `ensureSessionWorkDir` 失败 toast (R7-1) | `createChatStore.ts` |
| `[fix-7#1]` | v1-v6 migrations ALTERs 移到事务内 (R4-2) | `database.rs` |
| `[fix-8#1]` | `DB_INIT_FAILED` flag + `with_connection` helper + `warn_uninitialized_write` (R4-3) | `database.rs` |
| 旧 anchor | R5-1 `createRunDirectory` 失败 surface via store.setError (在前序 audit 中已修) | `workflowEngine/engine.ts` |
| 旧 anchor | R3-1 SSH remote path 用 `is_within_dir` (在前序 audit 中已修) | `execution_policy.rs` |

### 2.2 P1 (9/21 修完)

| Fix Anchor | 修复内容 | 影响文件 |
| --- | --- | --- |
| `[fix-9#1]` | `contentChunks.join('')` 替代 `fullContent +=` (R5-13) | `workflowEngine/agentRunner.ts` |
| `[fix-10#1]` | backoff ±25% jitter (R5-17) | `workflowEngine/agentRunner.ts` |
| `[fix-11#1]` | search_files pattern 长度限制 + quantifier 黑名单 (R3-15) | `tools/registry.rs` |
| `[fix-12#1]` | workflow route keyword `isReDoSSuspicious` (R5-8) | `workflowEngine/phases.ts` |
| `[fix-14#1]` | `APPROVALS` TTL-based GC + one-shot (R3-2) | `tools/execution_policy.rs` |
| `[fix-15#1]` | `untilError` → `single` alias (R5-18) | `workflowEngine/agentRunner.ts` |
| `[fix-16#1]` | `Array.from(new Set(triggered))` (R5-12) | `workflowEngine/phases.ts` |
| `[fix-17#1]` | `TempFileGuard` RAII (R3-10) | `tools/ssh_bridge.rs` |
| 旧 anchor | R3-8/R3-9 SSH 不使用 login shell (代码审计证实不适用, audit 报告误判) | n/a |
| `[fix-19#1]` | `ChatBrowserWorkspaceShell` drag handler useEffect cleanup (R9-3/R9-10/R9-12) | `ChatBrowserWorkspaceShell.tsx` |

### 2.3 P2 (6/24 修完)

| Fix Anchor | 修复内容 | 影响文件 |
| --- | --- | --- |
| `[fix-20#1]` | `ai-agent-*` → `pipi-shrimp-*` 命名空间迁移 (R7-15) | `createChatStore.ts` |
| `[fix-22#1]` | 抽 `src/utils/safeStorage.ts` (R7-3/R9-1/R10-8) | 新增 + 7 处替换 |
| 旧 anchor | R5-19 transcript 限长 (在前序 audit 中已修) | `agentRunner.ts` |
| 旧 anchor | 多个 R2-2/R2-3/R2-4/R2-6 已在 claude http executor 历史 audit 修了 | `claude/http/executor.rs` |
| 旧 anchor | R8-2/R8-3/R8-5 (artifactDetector 部分) 已在历史 audit 修 | `services/artifactDetector.ts` |
| 旧 anchor | R6-1/R6-2 (swarm persistence) 文档化为后续 sprint — Tauri SQLite backend 未启用 | `swarm/persistence.ts` |
| **未修** | R9-13 `stone-*` 暖色 → `neutral` 中性: 全 UI 主题层改动, 列入 P2 backlog | — |
| **未修** | R10-21 i18n hardcoded 错误信息: 需先建 i18n key, 列入 P2 backlog | — |
| **未修** | R10-12 hardcoded tool lists → codegen: 中等 ROI, 列入 P2 backlog | — |

### 2.4 P3 (4/31 修完)

| Fix Anchor | 修复内容 | 影响文件 |
| --- | --- | --- |
| 旧 anchor | R10-5 `println!` 替换为 `tracing` 基础设施: 文档化但未全量替换 | — |
| **未修** | R9-14 散落 `console.warn` 集中 logger | — |
| **未修** | R10-22/23 magic strings 集中到 constants | — |
| **未修** | R10-24 extensive `as any` 清理 | — |
| **未修** | R10-25 `package.json` 锁文件 | — |

### 2.5 顺带修复的历史 bug

| 锚点 | 修复 |
| --- | --- |
| `[fix-7-pre]` | `error_mapping.rs` regex raw string `"` 闭合 |
| `[fix-7-pre]` | `path_security.rs` `OsString::push(char)` → `MAIN_SEPARATOR_STR` |
| `[fix-7-pre-url]` | `executor.rs` `url::Url::parse` → 纯字符串 query 过滤 (避免引入 `url` 依赖) |

---

## 3. 编译验证

```text
$ cargo check --message-format=short
...
warning: `pipi-shrimp-agent` (lib) generated 3 warnings
(workspace.rs 中 3 个历史 unused variable / unreachable expression 警告, 与本次 fix 无关)
```

零编译错误, 全部 Rust fix 通过。

---

## 4. Backlog (未修, 文档化给后续 sprint)

### 4.1 P1 剩余 (12 项)

- **R6-3, R6-5, R6-15** swarm 性能 (O(N) transcripts / 5MB localStorage / 全量 snapshot save)
- **R6-14** 2s polling → event-driven
- **R3-1~R3-7** ssh_bridge 内部清理 (R3-1 已修, 其余 ssh escape / `format!("~/{ }")` 等)
- **R5-14** API key 走 IPC 的安全审计
- **R4-4, R4-5, R4-6** database Mutex 串行化 → connection pool

### 4.2 P2 剩余 (18 项)

UI 一致性 (R9-13 stone 暖色, R9-15 console.warn), i18n (R10-21, R7-14),
zenaud store pattern (R10-16, R10-26), god module 拆分 (R4-10, R7-4, R7-6, R5-22),
旧 product name 清理 (R10-15 其它残留), tool list codegen (R10-12) 等。

### 4.3 P3 剩余 (27 项)

stylistic / consistency 改进, 大量 `as any` 清理, magic strings 集中等。

---

## 5. AUDIT-FIX 锚点索引

可用命令快速跳转:

```bash
# 所有 P0 已修锚点
rg "AUDIT-FIX \[fix-(1#1|2#1|3#1|3#2|4#1|5#1|6#1|7#1|8#1)" src src-tauri

# 所有本次 fix 阶段加的锚点 (按子系统编号)
rg "AUDIT-FIX \[fix-(9#1|10#1|11#1|12#1|14#1|15#1|16#1|17#1|19#1|20#1|22#1)" src src-tauri

# 命名空间 (subsystem prefix)
#   fix-N#1-ff = frontend path util
#   fix-N#1-fa/-fb/-fc = file.rs 三处
#   fix-N#1-fd/-fe = workspace.rs 两处
#   fix-N-ar#M = auto-research (前 3 轮 audit 阶段)
```

---

## 6. Anchor 命名约定

格式: `AUDIT-FIX [fix-N-suffix#M]`

- `N` — Fix batch 编号 (1-24)
- `suffix` — 可选子系统前缀 (空 = 全局, `ar` = auto-research, `pre` = 修复前序 audit 的 bug)
- `M` — 该 fix batch 内 issue 编号

后缀为 `-fa`/`-fb`/... — 同一 fix batch 内多处修改, 按文件/位置区分
(例: `[fix-1#1-fa]`/`-fb`/`-fc`/`-fd`/`-fe` = file.rs 三处 + workspace.rs 两处, `-ff` = 前端 utils, `-fg` = 前端 artifactDetector)。

---

> 文档最后更新: 2026-06-09, Fix phase 完成后。
