# Round 3 — Browser Automation

**Scope:** `nativeBrowserAgent.ts`, `browserActionPolicy.ts`, `browserAgentStore.ts`, `BrowserPanel`, `BrowserWorkspacePane`, Rust CDP (`web.rs`)

---

## Critical

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R3-01 | Critical | `browserAgentStore.ts:850-898` | `executeCdpTask` 未传 `approveAction`；`ask` 默认 deny 且无 UI | 敏感 click 应弹审批 |
| R3-02 | Critical | `browserAgentStore.ts` + flags | `observe_only` flag 未传入 agent | localStorage observe_only 应 block 动作 |
| R3-03 | Critical | `browserAgentStore.ts:793-821` | CDP 模式跳过 auth 检查 | auth_required 页不应直接跑 agent |
| R3-04 | Critical | store + `nativeBrowserAgent.ts` | 嵌入式 WebView ≠ 外部 CDP Chrome（:9222） | 预览 URL ≠ agent 操作 URL |
| R3-05 | Critical | `browserAgentStore.ts:1139-1156` | `stopTask` 不停止 CDP loop | stop 后无进一步 LLM/CDP 调用 |
| R3-06 | Critical | `web.rs:669-696` | `cdp_execute_script` 无 TS 策略门控 | 任意 JS 应 deny-by-default |

## High (8)

| ID | Summary |
| --- | ------- |
| R3-07 | overlay 异常路径未 remove，留全屏遮罩 |
| R3-08 | `closeWindow` 不 stop CDP task |
| R3-09 | schema 允许 selector 但 executor 忽略 |
| R3-10 | `input_text.press_enter` 未调 `pressBrowserKey` |
| R3-11 | malformed JSON 计数累计非连续 |
| R3-12 | 双 timer 系统导致 stale auto-reset |
| R3-13 | `forceResumeWithoutAuth` 绕过登录 |
| R3-14 | light observation 不刷新 navigation_id |

## Medium (9)

R3-15 observation level 参数未用 · R3-16 refresh_page_state 忽略 level/force · R3-17 messages 数组无限增长 · R3-18 CDP 完成无 auto-idle · R3-19 无标签敏感按钮漏检 · R3-20 auto_safe 三元死代码 · R3-21 wait 10s cap vs schema 15s · R3-22 health ping 误更新 · R3-23 native stats 绕过 mock 模式

## Low (4)

R3-24 loop 只 warn 不终止 · R3-25 extract_text 用 errorMessage 字段 · R3-26 split 无 stop/策略控件 · R3-27 dismissedFailureIds 无界增长

---

## Permission bypass matrix

| Vector | Risk |
| ------ | ---- |
| CDP 跳过 auth | High |
| forceResumeWithoutAuth | High |
| observe_only 未接线 | High |
| Chat browser_* bypass TS policy | High |
| cdp_execute_script | High |
| 双浏览器表面 | Critical |

**Total: 27 findings**