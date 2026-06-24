# Round 5 — AutoResearch

**Scope:** `services/autoresearch/*`, `autoresearchStore`, `AutoResearchPanel`, `BootstrapChatView`, `chatAdapter`, `loopEngine`

**CI status (audit day):** 11 of 24 failing suites were in the AutoResearch area — **all suites now pass post-remediation**

Chinese version: [../round-05-autoresearch.md](../round-05-autoresearch.md)

---

## Findings

| ID | Sev | Location | Description | Suggested test | Status |
| --- | --- | -------- | ----------- | -------------- | ------ |
| R5-01 | P0 | `chatAdapter.ts:697-900` | `options.signal` not passed to `runHeadlessAgentTurn`; Stop could not interrupt in-flight turn | Abort mid-turn exits immediately | ✅ Fixed |
| R5-02 | High | `loopEngine.ts:950-1065` | Preflight return outside try/finally — `activeLoopAbortController` leaked | Controller null after preflight failure | Open |
| R5-03 | P0 | `loopEngine.ts:1744-1820` | Agent error set `failed` but `loopState` did not stop — iterations could continue | No second sendMessage after throw | ✅ Fixed |
| R5-04 | Medium | `AutoResearch.tsx:373-380` | Unmount only stopped `running`, not `paused` | Pause + unmount stops loop | Open |
| R5-05 | P0 | `autoresearchStore.ts:632-659` | `deleteRun` did not call `stopExperimentLoop` | Deleting active run stops SSH/LLM | ✅ Fixed |
| R5-06 | Medium | `BootstrapChatView.tsx:174-219` | SSH upload has no transaction/rollback | Handle failure on Nth file | Open |
| R5-07 | Medium | `BootstrapChatView.tsx:222-233` | Handoff has no lifecycle lock | Block handoff when active run exists | Open |
| R5-08 | Medium | `BootstrapChatView.tsx:169-170` | Uses `guessMetricDirection` not plan direction | Direction matches plan | Open |
| R5-09 | Low | `loopEngine.ts:1132-1134` | Pause uses 1s setTimeout without AbortSignal | Stop during pause <200ms | Open |
| R5-10 | Medium | `AutoResearchPanel.tsx:322-336` | Copy uses raw `visibleLiveOutput` not redacted | Clipboard has no API key | Open |
| R5-11 | Medium | `AutoResearchPanel.tsx:479-488` | Recovery button only opens modal, does not execute action | retry_iteration should call handler | Open |
| R5-12 | Low | `autoresearchStore.ts:1036-1042` | `failureCount` vs `consecutiveFailures` inconsistent | Consistent consecutive failure count | Open |
| R5-13 | Low | `autoresearchStore.ts:1256-1273` | Close flush only when timer non-null | Flush after failed persist on close | Open |
| R5-14 | Test-gap | `chatAdapter.test.ts` | No signal propagation test | See R5-01 | Partially addressed |
| R5-15 | Test-gap | `loopEngine.integration.test.ts` | No stop/preflight/failed-continue tests | See R5-02/03/05 | Partially addressed |
| R5-16 | Test-gap | `BootstrapChatView` | No SSH failure or double-Start tests | Partial upload + duplicate | Open |

---

## Abort wiring summary

```
setupFlow → startExperimentLoop (has signal)
     ↓
chatAdapter.sendMessage (checks signal at entry)
     ↓
runHeadlessAgentTurn (now receives signal)  ← main gap closed
```

**Total: 16 findings** (3 P0 fixed; CI stabilized)