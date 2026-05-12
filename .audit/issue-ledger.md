# 📋 全局问题总账 (Issue Ledger)

**创建时间:** 2026-05-12  
**最后更新:** 2026-05-12  
**总问题数:** 5

---

## 问题统计

| 严重级 | 数量 | 待确认 | 已确认 |
|--------|------|--------|--------|
| P0 | 0 | 0 | 0 |
| P1 | 2 | 0 | 2 |
| P2 | 2 | 0 | 2 |
| P3 | 1 | 0 | 1 |

---

## 按类别分布

| 类别 | 数量 |
|------|------|
| Type Safety | 1 |
| Runtime Bug | 1 |
| State Consistency | 1 |
| Security | 1 |
| Maintainability | 1 |

---

## Issue AUDIT-001

**Severity:** P1  
**Category:** State Consistency  
**Status:** Confirmed

**Location:**
- `src/tools/impl/SshTool.ts`
- `src/store/autoresearchStore.ts`

**Problem:**  
SSH 工具中 `SshConfig` 接口和 `AutoResearchStore` 中的 `SshConfig` 接口定义不一致。两者字段相同，但散落在不同模块中，存在维护风险。

**Evidence:**  
两个文件独立定义相同接口。

**Suggested Fix:**  
将 `SshConfig` 移到 `src/types/` 目录作为共享类型。

---

## Issue AUDIT-002

**Severity:** P1  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src/tools/impl/BashTool.ts:25-30`
- `src/tools/impl/SshTool.ts:25-35`

**Problem:**  
危险命令检测使用正则表达式，可能被大小写转换、注释、空格等方法绕过。例如 `RM -RF /` 或全角空格变体。

**Suggested Fix:**  
将命令转为小写后检测，使用更健壮的检测库，检测 Unicode 同形字符。

---

## Issue AUDIT-003

**Severity:** P2  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src/tools/index.ts:100-120`

**Problem:**  
存在重复的 `bashTool` 注册代码。

**Suggested Fix:**  
删除重复的 `bashTool` 注册。

---

## Issue AUDIT-004

**Severity:** P2  
**Category:** Runtime Bug  
**Status:** Confirmed

**Location:**
- `src/tools/impl/FileWriteTool.ts:30-40`

**Problem:**  
文件写入前检查文件是否存在使用 `path_exists`，但该调用可能因权限问题失败而被静默捕获，导致 `isUpdate` 可能为 `false` 即使文件存在。

**Suggested Fix:**  
即使 `path_exists` 失败，也应该尝试写入文件，响应信息根据写入结果判断。

---

## Issue AUDIT-005

**Severity:** P3  
**Category:** Type Safety  
**Status:** Confirmed

**Location:**
- `src/types/chat.ts`
- `src/types/settings.ts`

**Problem:**  
类型文件中存在大量类型定义，但某些类型未被其他模块引用验证，可能存在孤岛类型。

**Suggested Fix:**  
定期运行 TypeScript 严格模式检查，清理未使用的类型定义。

---

## Issue AUDIT-006

**Severity:** P2  
**Category:** State Consistency  
**Status:** Confirmed

**Location:**
- `src/store/browserAgentStore.ts:17-20`

**Problem:**  
`browserAgentStore` 使用模块级变量 `_listenerRefCount` 和 `_listenerCleanup` 守卫事件监听器注册，但在 Zustand store 中混用模块级状态违反了 Zustand 的独立性原则 — store 在测试或 SSR 场景下可能产生状态泄漏。

**Evidence:**
```typescript
let _listenerRefCount = 0;
let _listenerCleanup: (() => void) | null = null;
let _listenerSetupPromise: Promise<() => void> | null = null;
```

**Suggested Fix:**  
使用 Zustand 内部状态 (via `set`/`get`) 而非模块级变量来管理引用计数，或将这些守卫变量封装为独立的模块。

---

## Issue AUDIT-007

**Severity:** P2  
**Category:** State Consistency  
**Status:** Confirmed

**Location:**
- `src/store/cdpStore.ts:19-21`

**Problem:**  
`cdpStore` 使用模块级变量 `monitorRefCount` 和 `monitorInterval` 管理连接监控，相同模式问题同 AUDIT-006。

**Evidence:**
```typescript
let monitorRefCount = 0;
let monitorInterval: ReturnType<typeof setInterval> | null = null;
```

**Suggested Fix:**  
将监控状态移入 Zustand store 自身状态。

---

## Issue AUDIT-008

**Severity:** P1  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/src/commands/code.rs:60-90`

**Problem:**  
`check_command_safety` 函数使用简单的 `contains` 检测危险命令模式，可以被 Unicode 同形字符、零宽字符、控制字符等绕过。Rust 代码中的黑名单检测不如 Rust 原生正则表达式安全。

**Evidence:**
```rust
if lower.contains(pattern) {
    return Err(AppError::ProcessError(format!(
        "Command blocked for safety: contains forbidden pattern '{}'",
        pattern
    )));
}
```

**Suggested Fix:**  
使用 `regex` crate 进行模式匹配，并添加对控制字符和 Unicode 同形字符的检测。

---

## Issue AUDIT-009

**Severity:** P3  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src/services/toolEngine.ts:1-20`

**Problem:**  
`toolEngine.ts` 是已废弃的空模块（注释说明它已被 `StreamingToolExecutor` 替代），但仍然存在并导出旧 API，造成混淆。

**Suggested Fix:**  
删除 `toolEngine.ts` 或将其标记为完全废弃并移除导出。

---

## Issue AUDIT-010

**Severity:** P2  
**Category:** State Consistency  
**Status:** Confirmed

**Location:**
- `src/utils/remoteExec.ts:37-48`

**Problem:**  
`shellEscape` 和 `shellEscapePath` 函数使用简单的字符串替换而非正则表达式，存在边缘情况处理不足（如边界字符、null 字节处理）。

**Evidence:**
```typescript
export function shellEscape(s: string): string {
  return "'" + String(s ?? '').replace(/'/g, "'\\''") + "'";
}
```

**Suggested Fix:**  
添加对 null 字节和边界情况的检测，或使用经过验证的库函数。

---

## Issue AUDIT-011

**Severity:** P2  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/src/commands/file.rs:60-80`

**Problem:**  
`expand_home` 函数在路径以 `~` 开头时使用 `std::env::var("HOME")`，但未验证结果路径的合法性。如果 HOME 环境变量被设置为恶意路径，可能导致安全检查绕过。

**Evidence:**
```rust
fn expand_home(path: &str) -> PathBuf {
    if path.starts_with("~") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(path.replacen("~", &home, 1));
        }
    }
    PathBuf::from(path)
}
```

**Suggested Fix:**  
在 `expand_home` 后立即验证路径的合法性。

---

## Issue AUDIT-012

**Severity:** P2  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src/components/ChatInput.tsx:38-60`

**Problem:**  
`cleanupOldDrafts` 函数使用启发式方法清理过期草稿（超过 30KB 的内容视为过期），这个阈值没有明确文档，且 `isStaleChatDraftValue` 的判断逻辑不透明，可能导致重要草稿被意外删除。

**Evidence:**
```typescript
// For drafts without timestamp, we use a heuristic:
// If the draft content looks stale (> 30KB, likely forgotten), remove it
if (isStaleChatDraftValue(value)) {
  keysToRemove.push(key);
}
```

**Suggested Fix:**  
为草稿添加时间戳元数据，使用明确的过期策略替代启发式判断。

---

## Issue AUDIT-013

**Severity:** P3  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src/components/Sidebar.tsx`

**Problem:**  
Sidebar 组件在项目管理、session 移动、批量删除等多个功能间状态管理复杂，存在大量 useState 声明（约 15+ 个独立状态），增加了维护成本和出错概率。

**Suggested Fix:**  
将相关状态分组为复合对象或使用 useReducer 模式。

---

## Issue AUDIT-014

**Severity:** P2  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/src/tools/registry.rs:50-80`

**Problem:**  
工具注册表的 schema 验证在验证失败时返回 JSON 格式错误消息，但 `ToolCallResult.content` 直接使用格式化的错误字符串而非结构化错误对象，前端需要额外解析。

**Evidence:**
```rust
return Ok(ToolCallResult {
    id: req.id.clone(),
    name: req.name.clone(),
    content: format!(
        "Schema validation failed for tool '{}': {}",
        req.name,
        error_msgs.join("; ")
    ),
    is_error: true,
});
```

**Suggested Fix:**  
返回标准化的错误格式，前端统一解析。

---

## Issue AUDIT-015

**Severity:** P2  
**Category:** State Consistency  
**Status:** Confirmed

**Location:**
- `src-tauri/src/mcp/client.rs:35-50`

**Problem:**  
`MCPConnection` 结构体中的 `reconnect_attempts` 字段在使用时没有持久化到磁盘，重启后重置为 0，可能导致无限重连循环。

**Evidence:**
```rust
struct MCPConnection {
    // ...
    reconnect_attempts: u32,
}
```

**Suggested Fix:**  
在 `MCPServer` 配置中持久化重连计数，或使用指数退避策略限制最大重试次数。

---

## Issue AUDIT-016

**Severity:** P2  
**Category:** Runtime Bug  
**Status:** Confirmed

**Location:**
- `src/components/BrowserPanel.tsx:50-100`

**Problem:**  
`getQuickTasks` 函数对 URL 模式使用简单的字符串 `includes` 检测，可能产生误判（如包含 "github" 的非 GitHub URL）。

**Evidence:**
```typescript
if (lowerUrl.includes('github')) {
  return [
    'browser.quickTask.findHotRepos',
    // ...
  ];
}
```

**Suggested Fix:**  
使用更精确的 URL 匹配模式（如检查 hostname 或使用 URL 类解析）。

---

## Issue AUDIT-017

**Severity:** P3  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src/components/BrowserDebugPanel.tsx:150-200`

**Problem:**  
`BrowserDebugPanel` 在 `isUsingMockData=true` 时显示 "Mock-backed rollout scaffold"，但缺少视觉明确性警告标注，容易被开发者忽略为真实数据。

**Suggested Fix:**  
添加更明显的 Mock 数据警告样式（如黄色边框、Mock 标识等）。

---

## Issue AUDIT-018

**Severity:** P2  
**Category:** State Consistency  
**Status:** Confirmed

**Location:**
- `src/components/SwarmPanel.tsx`

**Problem:**  
`isLong` 变量硬编码为 `true` 导致所有消息都可以展开，即使消息内容很短不需要展开，浪费渲染资源。

**Evidence:**
```typescript
const isLong = true;
// ...
<div onClick={() => isLong && setExpanded(!expanded)}>
```

**Suggested Fix:**  
根据实际消息长度动态设置 `isLong` 标志。

---

## Issue AUDIT-019

**Severity:** P2  
**Category:** State Consistency  
**Status:** Confirmed

**Location:**
- `src/core/QueryEngine.ts:30-35`

**Problem:**  
QueryEngine 中的 round 计数逻辑注释说明了当前行为与目标行为的差异：`round` 每次循环递增，无论是真正的模型推理步骤、工具重试还是轮询/等待。如果工具暂时失败或轮询需要多次检查，这些都会占用 `maxModelRounds` 限制。

**Evidence:**
```typescript
// [ROUND ACCOUNTING CONTRACT]
// Current Behavior: Every iteration of this loop increments `round` by 1, regardless of whether it's
// a true model reasoning step, a tool retry, or polling/waiting.
// Target Behavior: We need an Explicit Execution Budget distinguishing:
// 1. Model reasoning rounds (maxModelRounds)
// 2. Tool execution attempts (maxToolExecutions)
// 3. Tool wall-clock timeouts & Retries
```

**Suggested Fix:**  
实现显式的执行预算区分模型推理轮次和工具执行轮次。

---

## Issue AUDIT-020

**Severity:** P3  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src/hooks/useClipboard.ts`

**Problem:**  
`useClipboard` hook 在剪贴板 API 失败后使用 `document.execCommand('copy')` 作为回退方案，但该 API 已废弃，现代浏览器可能不支持。

**Suggested Fix:**  
移除废弃的 `execCommand` 回退，或添加 deprecation 警告。

---

## Issue AUDIT-021

**Severity:** P2  
**Category:** Runtime Bug  
**Status:** Confirmed

**Location:**
- `src/pages/Chat.tsx:60-75`

**Problem:**  
`handleScroll` 使用固定阈值 100px 判断用户是否滚动到顶部，但在快速滚动场景下可能出现状态不一致。

**Evidence:**
```typescript
const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
setUserScrolledUp(distanceFromBottom > 100);
```

**Suggested Fix:**  
使用防抖处理滚动事件，或使用更鲁棒的判断逻辑。

---

## Issue AUDIT-022

**Severity:** P2  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/tauri.conf.json:18-22`

**Problem:**  
CSP 配置使用 `'unsafe-inline' 'unsafe-eval'`，这削弱了内容安全策略的保护效果。虽然在开发模式下这可能是必要的，但生产构建时应考虑更严格的策略。

**Evidence:**
```json
"csp": "default-src 'self'; connect-src 'self' https: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; ..."
```

**Suggested Fix:**  
在生产构建中使用更严格的 CSP，仅在开发模式下允许 unsafe-inline 和 unsafe-eval。

---

## Issue AUDIT-023

**Severity:** P3  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `.github/workflows/ci.yml`

**Problem:**  
CI 配置使用 `needs: [lint-and-test, rust-check, repo-hygiene, i18n-check]` 作为 `build-tauri` 的前置条件，但 `repo-hygiene` 和 `i18n-check` 与构建无依赖关系，可并行执行。

**Suggested Fix:**  
移除 `build-tauri` 的不必要依赖，或将其移到允许并行执行的作业组。

---

## Issue AUDIT-024

**Severity:** P3  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src/skills/resume/SKILL.md:40-50`

**Problem:**  
SKILL.md 中包含详细的路径解析约定，与 AGENTS.md 中的说明存在潜在不一致。如果 session `workDir` 已提供，技能不应创建额外的 `resume/` 子目录，但模板注册表可能依赖特定路径结构。

**Suggested Fix:**  
统一 AGENTS.md 和 SKILL.md 中的路径模型，确保技能代码和模板注册表一致。

---

## Issue AUDIT-025

**Severity:** P2  
**Category:** Runtime Bug  
**Status:** Confirmed

**Location:**
- `src/skills/resume/resumeFlow.ts:75-85`

**Problem:**  
`normalizeResumeTemplateMarkdown` 函数在处理 `resume-templates` 代码块时有多个字符串替换逻辑，但当代码块已完整时（包含开闭标记），仍然可能被错误处理。

**Evidence:**
```typescript
const openingIndex = normalized.indexOf('```resume-templates');
if (openingIndex === -1) {
  return normalized;
}
const afterOpening = normalized.slice(openingIndex + '```resume-templates'.length);
if (afterOpening.includes('```')) {
  return normalized; // 可能已经包含结束标记但仍被处理
}
```

**Suggested Fix:**  
使用更健壮的解析逻辑处理多行代码块边界情况。

---

## Issue AUDIT-026

**Severity:** P2  
**Category:** Error Handling  
**Status:** Confirmed

**Location:**
- `src-tauri/src/lib.rs:42-48`

**Problem:**  
数据库初始化失败时直接 panic，应用程序无法启动。虽然这是"关键"操作，但 panic 会导致用户体验不佳，应考虑更优雅的错误处理方式。

**Evidence:**
```rust
if let Err(e) = init_database() {
    eprintln!("❌ CRITICAL: Failed to initialize database: {}", e);
    panic!("Database initialization failed: {}. Application cannot start.", e);
}
```

**Suggested Fix:**  
考虑在 panic 前向用户显示错误对话框，提示可能的解决方案（如权限问题、磁盘空间等）。

---

## Issue AUDIT-027

**Severity:** P1  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/Cargo.toml:39`

**Problem:**  
Chromiumoxide 依赖用于浏览器自动化，但其 `features = ["tokio"]` 可能引入额外的安全风险。需确保 chromiumoxide 使用的 Chromium 版本是安全的，且无已知漏洞。

**Evidence:**
```toml
chromiumoxide = { version = "0.5", features = ["tokio"] }
```

**Suggested Fix:**  
定期更新 chromiumoxide 到最新版本，监控其依赖的 Chromium 版本安全性。

---

## Issue AUDIT-028

**Severity:** P2  
**Category:** Concurrency  
**Status:** Confirmed

**Location:**
- `src-tauri/src/lib.rs:61-72`

**Problem:**  
多个 `Arc<Mutex<...>>` 状态使用全局锁，可能在高频操作时成为性能瓶颈。特别是 `BrowserState` 和 `BrowserController` 可能同时被多个命令访问。

**Evidence:**
```rust
app.manage(Arc::new(Mutex::new(BrowserState::default())));
app.manage(Arc::new(Mutex::new(BrowserController::default())));
```

**Suggested Fix:**  
考虑使用更细粒度的锁策略，或使用 `tokio::sync::RwLock` 替代 `Mutex` 以提高读操作并发性。

---

## Issue AUDIT-029

**Severity:** P3  
**Category:** Configuration  
**Status:** Confirmed

**Location:**
- `src-tauri/capabilities/default.json`

**Problem:**  
`fs` 权限使用 `fs:default` 和基本读写权限，但未细化到特定目录。攻击者可能利用恶意网页通过 Tauri 命令访问任意文件。

**Evidence:**
```json
"fs:allow-read",
"fs:allow-write",
"fs:allow-exists",
```

**Suggested Fix:**  
使用更细粒度的 fs 权限配置，限制仅能访问应用程序数据目录。

---

## Issue AUDIT-030

**Severity:** P3  
**Category:** Error Handling  
**Status:** Confirmed

**Location:**
- `src-tauri/src/lib.rs:55-57`

**Problem:**  
直接使用 `unwrap()` 获取 main window，如果窗口创建失败会导致 panic。应使用更安全的错误处理方式。

**Evidence:**
```rust
let _window = app.get_webview_window("main").unwrap();
```

**Suggested Fix:**  
使用 `expect()` 提供清晰的错误信息，或使用 `ok()`/`unwrap_or()` 提供降级处理。

---

## Issue AUDIT-031

**Severity:** P2  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/src/commands/path_security.rs:120-140`

**Problem:**  
在 `validate_path` 中，当路径不存在时（非 existent path），检查 traversal 的逻辑使用 `normalize_path` 但该函数未在代码中定义。这可能导致路径遍历检测失效。

**Evidence:**
```rust
let normalized = normalize_path(&resolved);
// ...
if !normalized.starts_with(&wd_str) && !normalized.starts_with(&wd_expanded) {
```

**Suggested Fix:**  
定义 `normalize_path` 函数或在不存在路径时使用不同的验证策略。

---

## Issue AUDIT-032

**Severity:** P2  
**Category:** Concurrency  
**Status:** Confirmed

**Location:**
- `src-tauri/src/commands/terminal.rs:50-65`

**Problem:**  
Terminal PTY session 使用全局 `HashMap` 存储，`TERMINAL_SESSIONS` 使用 `Mutex` 保护，但锁在 await 期间被释放后重新获取可能导致竞态条件。`terminal-create` 中的双检查模式正确，但其他操作可能存在类似问题。

**Evidence:**
```rust
static TERMINAL_SESSIONS: Lazy<Mutex<HashMap<String, TerminalSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
```

**Suggested Fix:**  
考虑使用 `tokio::sync::RwLock` 替代 `Mutex` 以提高读操作的并发性。

---

## Issue AUDIT-033

**Severity:** P3  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/src/commands/terminal.rs:170-180`

**Problem:**  
PTY 输出使用 `String::from_utf8_lossy` 进行字节到字符串的转换，可能导致特定字节序列被替换为 replacement character，影响终端输出的正确性。

**Evidence:**
```rust
let data = String::from_utf8_lossy(&buf[..n]).to_string();
```

**Suggested Fix:**  
考虑使用原始字节传输或更精确的 UTF-8 处理策略。

---

## Issue AUDIT-034

**Severity:** P2  
**Category:** Error Handling  
**Status:** Confirmed

**Location:**
- `src-tauri/src/mcp/client.rs:16-20`

**Problem:**  
MCP 重连配置 `MAX_RECONNECT_ATTEMPTS = 3` 是硬编码的，但 `reconnect_attempts` 字段未持久化。应用重启后重连计数会重置，导致无限重连（如果服务器持续拒绝）。

**Evidence:**
```rust
const MAX_RECONNECT_ATTEMPTS: u32 = 3;
/// Number of reconnection attempts made
reconnect_attempts: u32,
```

**Suggested Fix:**  
考虑将重连计数持久化到数据库，或在无限重连时添加指数退避策略。

---

## Issue AUDIT-035

**Severity:** P2  
**Category:** Runtime Bug  
**Status:** Confirmed

**Location:**
- `src/hooks/usePolling.ts:37-45`

**Problem:**  
`usePolling` 中的 `inFlight` ref 检查会丢弃正在执行中的回调结果，但如果 `inFlight` 为 true，当前 tick 的结果被静默丢弃，可能导致轮询周期被跳过。

**Evidence:**
```typescript
if (inFlight.current) {
  return;  // 当前 tick 结果被丢弃
}
```

**Suggested Fix:**  
考虑将跳过的 tick 记录到下次执行，或使用更完善的防抖策略。

---

## Issue AUDIT-036

**Severity:** P3  
**Category:** Maintainability  
**Status:** Confirmed

**Location:**
- `src-tauri/src/browser/session/manager.rs:30-50`

**Problem:**  
`BrowserSessionManager` 结构体包含大量字段（约 20+ 个），其中包含多个可选字段和 worker handles。这种复杂的结构可能导致维护困难，建议使用子结构体分组。

**Evidence:**
```rust
pub(super) handler: Option<JoinHandle<()>>,
pub(super) health_worker: Option<JoinHandle<()>>,
pub(super) reconnect_worker: Option<JoinHandle<()>>,
pub(super) idle_worker: Option<JoinHandle<()>>,
pub(super) runtime_event_worker: Option<JoinHandle<()>>,
pub(super) worker_shutdown: Option<watch::Sender<bool>>,
```

**Suggested Fix:**  
将相关的 worker 字段分组为独立的子结构体。

---

## Issue AUDIT-037

**Severity:** P1  
**Category:** Security  
**Status:** Confirmed

**Location:**
- `src-tauri/src/services/browser/action_service.rs:26-50`

**Problem:**  
`PAGE_AGENT_IIFE` 通过 `include_str!` 嵌入浏览器脚本，该脚本中包含硬编码的 API URL 模式列表 (`LLM_API_PATTERNS`)，用于决定哪些请求需要代理。这是绕过 CSP 的机制，但硬编码的 URL 模式可能包含安全风险。

**Evidence:**
```rust
const PAGE_AGENT_IIFE: &str =
    include_str!("../../../../node_modules/page-agent/dist/iife/page-agent.demo.js");
```

**Suggested Fix:**  
确保 page-agent 脚本来源可信，定期更新依赖，并审计 `LLM_API_PATTERNS` 列表。

---

## Issue AUDIT-038

**Severity:** P3  
**Category:** Error Handling  
**Status:** Confirmed

**Location:**
- `src-tauri/src/mcp/config_store.rs:40-60`

**Problem:**  
`MCPConfigStore::load` 方法在配置文件不存在时返回空 Vec，但如果文件存在但内容损坏，`serde_json::from_str` 失败会产生不明确的错误消息。

**Evidence:**
```rust
if !path.exists() {
    return Ok(Vec::new());
}
let data = std::fs::read_to_string(&path)
    .map_err(|e| MCPError::ConfigError(format!("Failed to read config: {}", e)))?;
let servers: Vec<MCPServer> = serde_json::from_str(&data)
    .map_err(|e| MCPError::ConfigError(format!("Failed to parse config: {}", e)))?;
```

**Suggested Fix:**  
区分"配置文件不存在"和"配置文件损坏"两种情况，提供更精确的错误消息。

---

**最后更新:** 2026-05-12 发现38个问题