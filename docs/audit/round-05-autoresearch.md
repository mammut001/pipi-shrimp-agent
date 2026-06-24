# Round 5 — AutoResearch

**Scope:** `services/autoresearch/*`, `autoresearchStore`, `AutoResearchPanel`, `BootstrapChatView`, `chatAdapter`, `loopEngine`

**CI 状态：** 11/24 失败 suite 属 AutoResearch 区域

---

## Findings

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R5-01 | P0 | `chatAdapter.ts:697-900` | `options.signal` 未传给 `runHeadlessAgentTurn`；Stop 无法中断 in-flight turn | abort mid-turn 立即退出 |
| R5-02 | High | `loopEngine.ts:950-1065` | preflight return 在 try/finally 外，`activeLoopAbortController` 泄漏 | preflight 失败后 controller null |
| R5-03 | P0 | `loopEngine.ts:1744-1820` | agent 错误设 `failed` 但 `loopState` 不停，迭代可能继续 | throw 后无第二次 sendMessage |
| R5-04 | Medium | `AutoResearch.tsx:373-380` | unmount 仅 stop `running`，`paused` 不 stop | pause + unmount 停止 loop |
| R5-05 | P0 | `autoresearchStore.ts:632-659` | `deleteRun` 不 `stopExperimentLoop` | 删 active run 停止 SSH/LLM |
| R5-06 | Medium | `BootstrapChatView.tsx:174-219` | SSH 上传无事务/回滚 | 第 N 个文件失败处理 |
| R5-07 | Medium | `BootstrapChatView.tsx:222-233` | handoff 无 lifecycle lock | 有 active run 时 block handoff |
| R5-08 | Medium | `BootstrapChatView.tsx:169-170` | 用 `guessMetricDirection` 非 plan direction | direction 跟 plan 一致 |
| R5-09 | Low | `loopEngine.ts:1132-1134` | pause 用 1s setTimeout 无 AbortSignal | stop during pause <200ms |
| R5-10 | Medium | `AutoResearchPanel.tsx:322-336` | copy 用 raw `visibleLiveOutput` 非 redacted | clipboard 无 API key |
| R5-11 | Medium | `AutoResearchPanel.tsx:479-488` | recovery 按钮只开 modal 不执行动作 | retry_iteration 应调用 handler |
| R5-12 | Low | `autoresearchStore.ts:1036-1042` | `failureCount` vs `consecutiveFailures` 不一致 | 连续失败计数一致 |
| R5-13 | Low | `autoresearchStore.ts:1256-1273` | close flush 仅 timer 非 null 时 | 失败 persist 后 close 仍 flush |
| R5-14 | Test-gap | `chatAdapter.test.ts` | 无 signal 传播测试 | 见 R5-01 |
| R5-15 | Test-gap | `loopEngine.integration.test.ts` | 无 stop/preflight/failed-continue | 见 R5-02/03/05 |
| R5-16 | Test-gap | `BootstrapChatView` | SSH 失败、双点 Start | partial upload + duplicate |

---

## Abort wiring 总结

```
setupFlow → startExperimentLoop (有 signal)
     ↓
chatAdapter.sendMessage (只检查入口 signal)
     ↓
runHeadlessAgentTurn (❌ 未接收 signal)  ← 主缺口
```

**Total: 16 findings**