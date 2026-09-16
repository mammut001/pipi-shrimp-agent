# Intermediate `cancelling` status + cancel/interrupt vocabulary

**Principle:** prove + persist + observe — no `SessionRuntime` rewrite.

Companion: [`stop-session-switch-polish.md`](./stop-session-switch-polish.md) · plan: [`soak-polish-plan.md`](./soak-polish-plan.md)

## Claims

| Claim | Proof |
| --- | --- |
| **Intermediate `cancelling` on Stop** | `stopGeneration` calls `markSessionToolsCancelling` after optimistic busy clear, before awaiting `cancel_tool_execution`; TaskStep shows `cancelling` until `failUnresolvedSessionTools(..., 'cancelled')` |
| **Pending counters stay cleared** | `markSessionToolsCancelling` updates `setTaskProgress` only — does **not** restore `pendingToolCalls` / `pendingToolResults` |
| **No busy rebound after terminalize** | `failUnresolvedSessionTools` clears `runtime.results` before sync; Stop completion re-asserts idle pending flags so `shouldShowStopControl` stays false |
| **Per-step Cancel same vocab** | AgentPanel sets `cancelling` while invoke is in flight, then `cancelled` |
| **Unified labels** | `cancelInterruptVocab`: Cancelling / Cancelled / Interrupted (`canceled` → `cancelled` when normalizing) |

## Vocabulary

| Kind | Where | Label |
| --- | --- | --- |
| `cancelling` | TaskStep (non-terminal, in-flight Stop/Cancel) | Cancelling |
| `cancelled` | TaskStep terminal + user Stop notice | Cancelled |
| `interrupted` | Hydrate / reload durable notice | Interrupted |

## Entry points

```
src/types/ui.ts                              # TaskStep status + cancelling
src/store/chat/cancelInterruptVocab.ts       # shared labels
src/store/chat/toolRuntimeState.ts           # markSessionToolsCancelling
src/store/chat/chatActions.ts                # stopGeneration wire-up
src/components/AgentPanel.tsx                # Progress UI
src/store/chat/__tests__/cancelInterruptVocab.test.ts
src/store/chat/__tests__/toolRuntimeCancelling.test.ts
src/store/chat/__tests__/chatStoreSendMessage.test.ts
src/components/__tests__/AgentPanel.test.ts
```

## Intentionally not this knife

- Truncated replies / Project Folder UX / Danger defaults
- Epoch race redo (unless broken)
- Playwright mega-framework; OTel; durable half-tool resume
