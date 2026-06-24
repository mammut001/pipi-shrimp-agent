# Round 3 — Browser Automation

**Scope:** `nativeBrowserAgent.ts`, `browserActionPolicy.ts`, `browserAgentStore.ts`, `BrowserPanel`, `BrowserWorkspacePane`, Rust CDP (`web.rs`)

Chinese version: [../round-03-browser-automation.md](../round-03-browser-automation.md)

> **Remediation:** All R3-* findings remain **open** — browser automation was not addressed in the post-audit pass.

---

## Critical

| ID | Sev | Location | Description | Suggested test | Status |
| --- | --- | -------- | ----------- | -------------- | ------ |
| R3-01 | Critical | `browserAgentStore.ts:850-898` | `executeCdpTask` does not pass `approveAction`; `ask` defaults to deny with no UI | Sensitive click should prompt approval | ✅ Fixed 2026-06-24 |
| R3-02 | Critical | `browserAgentStore.ts` + flags | `observe_only` flag not passed to agent | localStorage `observe_only` should block actions | ✅ Fixed 2026-06-24 |
| R3-03 | Critical | `browserAgentStore.ts:793-821` | CDP mode skips auth check | `auth_required` pages should not run agent directly | ✅ Fixed 2026-06-24 |
| R3-04 | Critical | store + `nativeBrowserAgent.ts` | Embedded WebView ≠ external CDP Chrome (:9222) | Preview URL ≠ agent-operated URL | ✅ Fixed 2026-06-24 |
| R3-05 | Critical | `browserAgentStore.ts:1139-1156` | `stopTask` does not stop CDP loop | No further LLM/CDP calls after stop | ❌ Open |
| R3-06 | Critical | `web.rs:669-696` | `cdp_execute_script` has no TS policy gate | Arbitrary JS should be deny-by-default | ✅ Fixed 2026-06-24 |

## High (8)

| ID | Summary | Status |
| --- | ------- | ------ |
| R3-07 | Overlay not removed on error path — fullscreen mask remains | ❌ Open |
| R3-08 | `closeWindow` does not stop CDP task | ❌ Open |
| R3-09 | Schema allows selector but executor ignores it | ❌ Open |
| R3-10 | `input_text.press_enter` does not call `pressBrowserKey` | ❌ Open |
| R3-11 | Malformed JSON count accumulates non-consecutively | ❌ Open |
| R3-12 | Dual timer system causes stale auto-reset | ❌ Open |
| R3-13 | `forceResumeWithoutAuth` bypasses login | ❌ Open |
| R3-14 | Light observation does not refresh navigation_id | ❌ Open |

## Medium (9)

R3-15 observation level parameter unused · R3-16 `refresh_page_state` ignores level/force · R3-17 messages array grows unbounded · R3-18 CDP completion has no auto-idle · R3-19 no tab sensitive-button miss · R3-20 `auto_safe` ternary dead code · R3-21 wait 10s cap vs schema 15s · R3-22 health ping false update · R3-23 native stats bypass mock mode

## Low (4)

R3-24 loop only warns, does not terminate · R3-25 `extract_text` uses errorMessage field · R3-26 split mode has no stop/policy controls · R3-27 `dismissedFailureIds` unbounded growth

---

## Permission bypass matrix

| Vector | Risk |
| ------ | ---- |
| CDP skips auth | High |
| forceResumeWithoutAuth | High |
| observe_only not wired | High |
| Chat browser_* bypasses TS policy | High |
| cdp_execute_script | High |
| Dual browser surfaces | Critical |

**Total: 27 findings** — **none remediated**