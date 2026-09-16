# Stop + session-switch product feel (soak knife 3)

**Principle:** prove + persist + observe — no `SessionRuntime` / `queryLoop` rewrite.

Companion plan: [`soak-polish-plan.md`](./soak-polish-plan.md) · scout: [`soak-polish-scout.md`](./soak-polish-scout.md)

## Claims

| Claim | Proof |
| --- | --- |
| **≤1s cancelled feel** | `stopGeneration` clears `isStreaming` / pending counters **before** awaiting `cancel_tool_execution` |
| **A ≠ B isolation** | Stop cancels only `owningSessionId` tools/messages; B history untouched |
| **Stop visible while streaming / long tool** | `shouldShowStopControl` — Stop when `isStreaming` **or** pending tools/results |
| **Session-switch busy binding** | `selectSession` clears global busy flags then syncs selected session tool runtime (rebind, not idle-only) |
| **Same-session Stop→send race** | Per-session turn epoch: `sendMessage` bumps; stale `stopGeneration` cancel completion **re-checks epoch after every await** before scrub/placeholder/`stop_subprocess`/pending wipe; placeholder/message ops id-bound to stopped turn; stale `sendMessage` cancel/real-error/success/policy-recovery skip session mutations; diagnostics cancel uses Stop snapshot only |
| **Stop A leaves B runtime** | Stop cancels only A's executionIds; B unresolved tools / executionIds remain |

## Entry points

```
src/store/chat/chatActions.ts          # stopGeneration optimistic clear
src/store/chat/chatSelectors.ts        # shouldShowStopControl
src/components/ChatInput.tsx           # Send/Stop toggles on shouldShowStopControl
src/store/createChatStore.ts           # selectSession busy rebind
src/store/chat/__tests__/chatSelectors.test.ts
src/store/chat/__tests__/chatStoreSendMessage.test.ts  # knife 3 cases
```

## Intentionally not this knife

- Long-tool intermediate `cancelling` TaskStep status / vocabulary unify
- Truncated replies / Project Folder UX / Danger defaults (scout leftovers)
- Playwright mega-framework; OTel; durable half-tool resume
