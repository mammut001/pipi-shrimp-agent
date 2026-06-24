# Round 4 — Store & Core Services

**Scope:** `uiStore`, `settingsStore`, `workflowStore`, `swarmStore`, `autoresearchStore`, `StreamingToolExecutor`, `workflowEngine/`, `swarm/`, `QueryEngine`, `streamAdapter`, `listenerGuard`

Chinese version: [../round-04-store-services.md](../round-04-store-services.md)

---

## Critical

| ID | Sev | Location | Description | Suggested test | Status |
| --- | --- | -------- | ----------- | -------------- | ------ |
| R4-01 | Critical | `listenerGuard.ts:65-68` | Secondary registrant cleanup only decrements refCount; unmounting primary registrant first can leak listener | Two consumers unmount out of order | ✅ Fixed |
| R4-02 | Critical | `workflowEngine/engine.ts:239-250` | `stop()` did not clear `engine.isRunning`; new `start()` blocked | Restart immediately after stop | ✅ Fixed |
| R4-03 | Critical | `QueryEngine.ts:385-404` | tool_batch `Promise.all` had no timeout; consumer never resolving hung forever | Consumer never callbacks → timeout | ✅ Fixed |

## High (7)

| ID | Summary | Status |
| --- | ------- | ------ |
| R4-04 | `swarmStore.init()` TOCTOU double subscribe | Open |
| R4-05 | `enforceMemoryLimits` global slice not per-team | Open |
| R4-06 | `initSession` does not end prior active run | Open |
| R4-07 | `requiresConfirmation` hook may still auto-run | Open |
| R4-08 | `streamAdapter` timeout does not cancel Rust stream | Open |
| R4-09 | `createRunDirectory` failure still leaves run in running state | Open |
| R4-10 | `removeApiConfig` has no autoresearch lifecycle lock | Open |

## Medium (17)

R4-11 chrome prompt orphans promise · R4-12 questionnaire same-session stale UI · R4-13 notification timer not cancelled · R4-14 recoverToChatView does not clear questionnaire resolvers · R4-15 agentInstructions raw localStorage · R4-16 modelRound incremented before retry · R4-17 addAgent during running creates phantom ID · R4-18 workflow isRunning not persisted · R4-19 expirePermission does not clearTimeout · R4-20 swarm permission out of sync with uiStore · R4-21 swarm cleanup does not expire pending · R4-22 swarm debounce no unload flush · R4-23 fetchModels out-of-order overwrite · R4-24 workflow IPC passes raw apiKey

## Low + Test gaps

R4-25–R4-28 low severity items; R4-29–R4-33 dedicated test gaps (`streamAdapter`, `permissionBridge`, `listenerGuard`, `uiStore`, `engine`)

**Total: 33 findings** (3 Critical — all fixed, 7 High, 17 Medium, 6 Low/Test-gap)