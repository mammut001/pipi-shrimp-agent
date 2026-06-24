# Round 2 — Rust / Tauri Backend

**Scope:** `src-tauri/src/commands/`, `tools/`, `claude/`, `database.rs`, `path_security.rs`, `browser/actions/`, `mcp/`

Chinese version: [../round-02-rust-backend.md](../round-02-rust-backend.md)

> **Remediation:** All R2-* findings remain **open** — no Rust backend fixes in the post-audit pass.

---

## Critical

| ID | Sev | Location | Description | Suggested test | Status |
| --- | --- | -------- | ----------- | -------------- | ------ |
| R2-01 | Critical | `commands/chat.rs:224-526` | Legacy `execute_tool` bypasses `ToolRegistry` + `execution_policy` + approval | Legacy path should be rejected or removed | ❌ Open |
| R2-02 | Critical | `commands/tools.rs:98` | `execute_single_tool` passes `session_id: None` — approval tokens cannot be consumed | Execute after preview should succeed | ❌ Open |
| R2-03 | Critical | `session_memory.rs:73-86` | `validate_work_dir` errors are discarded | `work_dir` of `/etc` must fail | ❌ Open |
| R2-04 | Critical | `ssh_bridge.rs:143-228` | Local-mode commands not escaped — shell injection | `; touch /tmp/pwned` must not execute | ❌ Open |

## High

| ID | Sev | Location | Description | Suggested test | Status |
| --- | --- | -------- | ----------- | -------------- | ------ |
| R2-05 | High | `chat.rs:500-525` | Legacy typst write path has no `resolve_path` | Writes outside work_dir rejected | ❌ Open |
| R2-06 | High | `database.rs:710-714` | Backup `starts_with` sibling-prefix escape | `backups-evil/` rejected | ❌ Open |
| R2-07 | High | `path_security.rs:204-218` | Exact roots like `/sys` may not match blocked prefix | `validate_path("/sys")` | ❌ Open |
| R2-08 | High | `execution_policy.rs:396-403` | Autoresearch bypass skips network checks | bypass + curl should confirm or deny | ❌ Open |
| R2-09 | High | `ssh_bridge.rs:134-137` | `SSHPASS` visible in process list | Password not in cmdline | ❌ Open |
| R2-10 | High | `browser/navigate.rs:42-48` | CDP goto has no scheme allowlist | `file://` rejected | ❌ Open |
| R2-11 | High | `mcp/stdio.rs:116-118` | MCP stdio `cwd` unsandboxed | `cwd: /etc` rejected | ❌ Open |
| R2-12 | High | `commands/mcp.rs:79-88` | `mcp_call_tool` has no policy layer | Destructive MCP needs approval | ❌ Open |

## Medium (15)

| ID | Location | Summary |
| --- | -------- | ------- |
| R2-13 | `registry.rs:57` | Schema compile failure fails open |
| R2-14 | `registry.rs:111` | `execute()` has no session_id |
| R2-15 | `execution_policy.rs:185-214` | Token mismatch does not delete token |
| R2-16 | `execution_policy.rs:638-706` | Long-running command heuristic false positive/negative |
| R2-17 | `file.rs:22-29` | Windows `/tmp` hardcoded |
| R2-18 | `search.rs:58-62` | Legacy search has no ReDoS guard |
| R2-19 | `stream_parser.rs:82-136` | SSE tail packet without newline lost |
| R2-20 | `executor.rs:308-316` | CancelGuard drop may leak token |
| R2-21 | `process_manager.rs:164-167` | execution_id collision overwrite |
| R2-22 | `process_manager.rs:178` | Poisoned mutex panic |
| R2-23 | `browser/wait.rs:29-48` | Selector DoS |
| R2-24 | `browser/common.rs:369-420` | `await_promise(true)` can hang |
| R2-25 | `action_service.rs:29-59` | Page-agent script injects apiKey |
| R2-26 | `code.rs:754` | `sessions.get().unwrap()` race |
| R2-27 | `database.rs:761-824` | Restore has no global lock |

## Low (7)

R2-28 SSH accept-new MITM · R2-29 upload localPath unsandboxed · R2-30 stream silently drops chunks · R2-31 incomplete URL log redaction · R2-32 session_memory duplicate heading · R2-33 click (0,0) misdetection · R2-34 MCP connected_at clock

---

## Missing Rust tests (summary)

| Area | Gap |
| ---- | --- |
| `commands/chat.rs` | Legacy bypass, typst path |
| `session_memory.rs` | Entire module untested |
| `database_bridge.rs` | export/restore allowlist |
| `mcp.rs` | Command surface |
| `tools.rs` | sessionId + approval |
| `ssh_bridge.rs` | Escape, injection, upload |
| `stream_parser.rs` | Tail buffer flush |
| `browser/actions/` | Navigate URL, wait bounds |

**Total: 34 findings** (4 Critical, 8 High, 15 Medium, 7 Low) — **none remediated**