# Round 2 — Rust / Tauri Backend

**Scope:** `src-tauri/src/commands/`, `tools/`, `claude/`, `database.rs`, `path_security.rs`, `browser/actions/`, `mcp/`

---

## Critical

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R2-01 | Critical | `commands/chat.rs:224-526` | Legacy `execute_tool` 绕过 `ToolRegistry` + `execution_policy` + approval | legacy path 应被拒绝或移除 |
| R2-02 | Critical | `commands/tools.rs:98` | `execute_single_tool` 传 `session_id: None`，审批 token 无法消费 | preview 后 execute 应成功 |
| R2-03 | Critical | `session_memory.rs:73-86` | `validate_work_dir` 错误被丢弃 | `/etc` work_dir 必须失败 |
| R2-04 | Critical | `ssh_bridge.rs:143-228` | local 模式命令未转义，shell 注入 | `; touch /tmp/pwned` 不可执行 |

## High

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R2-05 | High | `chat.rs:500-525` | legacy typst 写路径无 `resolve_path` | work_dir 外写入拒绝 |
| R2-06 | High | `database.rs:710-714` | backup `starts_with` sibling-prefix 逃逸 | `backups-evil/` 拒绝 |
| R2-07 | High | `path_security.rs:204-218` | `/sys` 等精确根路径可能不匹配 blocked prefix | `validate_path("/sys")` |
| R2-08 | High | `execution_policy.rs:396-403` | Autoresearch bypass 跳过网络检查 | bypass + curl 应确认或拒绝 |
| R2-09 | High | `ssh_bridge.rs:134-137` | `SSHPASS` 在进程列表可见 | 密码不出现在 cmdline |
| R2-10 | High | `browser/navigate.rs:42-48` | CDP goto 无 scheme allowlist | `file://` 拒绝 |
| R2-11 | High | `mcp/stdio.rs:116-118` | MCP stdio `cwd` 无沙箱 | `cwd: /etc` 拒绝 |
| R2-12 | High | `commands/mcp.rs:79-88` | `mcp_call_tool` 无策略层 | 破坏性 MCP 需审批 |

## Medium (15)

| ID | Location | Summary |
| --- | -------- | ------- |
| R2-13 | `registry.rs:57` | schema compile 失败 fail-open |
| R2-14 | `registry.rs:111` | `execute()` 无 session_id |
| R2-15 | `execution_policy.rs:185-214` | token mismatch 不删除 token |
| R2-16 | `execution_policy.rs:638-706` | long-running 命令启发式误报/漏报 |
| R2-17 | `file.rs:22-29` | Windows `/tmp` hardcode |
| R2-18 | `search.rs:58-62` | legacy search 无 ReDoS 守卫 |
| R2-19 | `stream_parser.rs:82-136` | SSE 尾包无换行丢失 |
| R2-20 | `executor.rs:308-316` | CancelGuard drop 可能泄漏 token |
| R2-21 | `process_manager.rs:164-167` | execution_id 碰撞覆盖 |
| R2-22 | `process_manager.rs:178` | poisoned mutex panic |
| R2-23 | `browser/wait.rs:29-48` | selector DoS |
| R2-24 | `browser/common.rs:369-420` | `await_promise(true)` 可挂死 |
| R2-25 | `action_service.rs:29-59` | page-agent script 注入 apiKey |
| R2-26 | `code.rs:754` | `sessions.get().unwrap()` 竞态 |
| R2-27 | `database.rs:761-824` | restore 无全局锁 |

## Low (7)

R2-28 SSH accept-new MITM · R2-29 upload localPath 无沙箱 · R2-30 stream 静默丢块 · R2-31 URL 日志脱敏不全 · R2-32 session_memory 重复 heading · R2-33 click (0,0) 误判 · R2-34 MCP connected_at 时钟

---

## Missing Rust tests (summary)

| Area | Gap |
| ---- | --- |
| `commands/chat.rs` | legacy bypass、typst 路径 |
| `session_memory.rs` | 全模块无测 |
| `database_bridge.rs` | export/restore allowlist |
| `mcp.rs` | 命令面 |
| `tools.rs` | sessionId + approval |
| `ssh_bridge.rs` | escape、注入、upload |
| `stream_parser.rs` | 尾缓冲 flush |
| `browser/actions/` | navigate URL、wait bounds |

**Total: 34 findings** (4 Critical, 8 High, 15 Medium, 7 Low)