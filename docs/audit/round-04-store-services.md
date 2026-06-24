# Round 4 — Store & Core Services

**Scope:** `uiStore`, `settingsStore`, `workflowStore`, `swarmStore`, `autoresearchStore`, `StreamingToolExecutor`, `workflowEngine/`, `swarm/`, `QueryEngine`, `streamAdapter`, `listenerGuard`

---

## Critical

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R4-01 | Critical | `listenerGuard.ts:65-68` | 次注册方 cleanup 只减 refCount；先卸载主注册方可能泄漏 listener | 两消费者乱序 unmount |
| R4-02 | Critical | `workflowEngine/engine.ts:239-250` | `stop()` 不清 `engine.isRunning`；新 `start()` 被挡 | stop 后立即可 restart |
| R4-03 | Critical | `QueryEngine.ts:385-404` | tool_batch `Promise.all` 无超时；不 resolve 永久挂起 | consumer 不回调应 timeout |

## High (7)

| ID | Summary |
| --- | ------- |
| R4-04 | `swarmStore.init()` TOCTOU 双订阅 |
| R4-05 | `enforceMemoryLimits` 全局 slice 非 per-team |
| R4-06 | `initSession` 不结束 prior active run |
| R4-07 | `requiresConfirmation` hook 后仍可能 auto-run |
| R4-08 | `streamAdapter` timeout 不 cancel Rust stream |
| R4-09 | `createRunDirectory` 失败后仍 running |
| R4-10 | `removeApiConfig` 无 autoresearch lifecycle lock |

## Medium (17)

R4-11 chrome prompt 覆盖 orphan promise · R4-12 questionnaire 同 session  stale UI · R4-13 notification timer 无取消 · R4-14 recoverToChatView 不清 questionnaire resolvers · R4-15 agentInstructions 裸 localStorage · R4-16 modelRound 在 retry 前递增 · R4-17 running 时 addAgent 幻影 ID · R4-18 workflow isRunning 不持久化 · R4-19 expirePermission 不 clearTimeout · R4-20 swarm permission 与 uiStore 不同步 · R4-21 swarm cleanup 不 expire pending · R4-22 swarm debounce 无 unload flush · R4-23 fetchModels 乱序覆盖 · R4-24 workflow IPC 传 raw apiKey

## Low + Test gaps

R4-25–R4-28 low severity items; R4-29–R4-33 dedicated test gaps (`streamAdapter`, `permissionBridge`, `listenerGuard`, `uiStore`, `engine`)

**Total: 33 findings** (3 Critical, 7 High, 17 Medium, 6 Low/Test-gap)