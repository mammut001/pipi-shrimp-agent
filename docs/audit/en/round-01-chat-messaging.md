# Round 1 — Chat & Messaging

**Scope:** `ChatBrowserWorkspaceShell`, `Chat.tsx`, `useChatMessageScroll`, `store/chat/*`, `ChatInput`, `ChatMessage`, `utils/chat*`

**Production path:** `App.tsx` → `ChatBrowserWorkspaceShell` (`Chat.tsx` not routed)

Chinese version: [../round-01-chat-messaging.md](../round-01-chat-messaging.md)

---

## Findings

| ID | Sev | Location | Description | Suggested test | Status |
| --- | --- | -------- | ----------- | -------------- | ------ |
| R1-01 | P0 | `chatActions.ts:1088-1206` | `appendStreamingContent` / `updateLastMessage` used `currentSessionId` instead of `streamingSessionId`; switching sessions during streaming could write content to the wrong session | Stream in session A, switch to B; assert B unchanged, A receives deltas | ✅ Fixed |
| R1-02 | P0 | `createChatStore.ts:855-913`, `chatActions.ts:653-685` | `selectSession` stopped child processes and cleared `isStreaming` but did not call `requestChatGenerationCancel`; background `for await` continued | Long stream, switch session; assert generator exits | ✅ Fixed |
| R1-03 | P1 | `ChatBrowserWorkspaceShell.tsx:644-653` | `split` mode rendered only `BrowserWorkspacePane` — no message list / `ChatInput`; `focusChatPane()` had no UI effect | Assert `ChatInput` present in split mode | ✅ Fixed |
| R1-04 | P1 | `chat.ts:70-74` vs shell:296-299 | `processMessagesForDisplay` did not filter `metadata.hidden`; shell inlined filtering — logic drift | Unit test for hidden messages |
| R1-05 | P1 | shell:293-347 vs `chat.ts:70-120` | Duplicate display pipeline (reasoning merge, `isRenderableMessage`) | Golden fixture comparison |
| R1-06 | P1 | `chatActions.ts:1008-1044` | `retryLastMessage` could retry hidden synthesis user messages | hidden + visible user; retry should pick visible |
| R1-07 | P1 | `createChatStore.ts:108-117`, `ChatMessage.tsx` | `system` compact boundary could render as assistant bubble | compact boundary not shown in UI |
| R1-08 | P1 | `chatActions.ts:361-413` | Could `sendMessage` to other sessions while another session was streaming | Overlapping sends should be mutually exclusive |
| R1-09 | P2 | `chatActions.ts:372-477` | Diagnostics task registered but not cleaned up on early-exit paths | Invalid config send; task should be failed/cancelled |
| R1-10 | P2 | shell:252-271, `Chat.tsx:89-108` | Terminal CWD promise had no `.catch()` | Mock reject; no unhandled rejection |
| R1-11 | P2 | `useChatMessageScroll.ts:12-22` | Scroll debounce timer not cleared on unmount | No setState after unmount from debounce | ✅ Fixed |
| R1-12 | P2 | shell:201-217 | Terminal drag listeners had no unmount cleanup | Unmount during drag; no listener leak |
| R1-13 | P2 | `ChatInput.tsx:682` | After session switch `isStreaming=false` but background turn could still run | Input disable policy after session switch |
| R1-14 | P2 | `pages/Chat.tsx` | Dead code maintained in parallel with shell | Production import graph excludes `Chat.tsx` |
| R1-15 | P2 | `Chat.tsx:364` vs shell:670 | Questionnaire not filtered by sessionId (shell correct) | Cross-session questionnaire not visible |
| R1-16 | P2 | `useChatMessageScroll.ts:29-33` | Depends on `displayMessages` but renders `visibleMessages`; expanding history does not scroll to bottom | Scroll behavior after `showFullHistory` |
| R1-17 | P2 | `chatActions.ts:1047-1051` | `addMessage` silently returns when no session | Should throw or surface explicit error |
| R1-18 | P3 | `chat.ts` + `chatHelpers.ts` | Duplicate `mergeReasoningParts` implementation | Single source + re-export |
| R1-19 | P3 | `Chat.tsx:287` vs shell | Global "AI thinking" bar only in legacy path | Shell streaming indicator consistency |
| R1-20 | P3 | Error banner styling | `bg-red-50` vs `error-banner` theme class | Shared ErrorBanner |
| R1-21 | P3 | terminal `key={terminalCwd}` | Legacy Chat had no cwd remount | PTY cwd after workDir change |
| R1-22 | P3 | `ChatMessage` vs `chatHelpers` | Inconsistent `__TOOL_RESULT__` parsing regex | IDs containing `:` parsed consistently |
| R1-23 | P3 | `useChatMessageScroll.ts:31` | Smooth scroll on every streaming delta may jank | Use `auto` or no animation during streaming |
| R1-24 | P3 | `ChatMessage.tsx:72-85` | Copy failure only logged to console | Clipboard reject should show toast |
| R1-25 | P3 | `SwarmPanelDraggable:118-125` | Document listener not removed on unmount during drag | Same as R1-12 |

---

## Test coverage (existing vs gaps)

**Existing:** `chatStoreSendMessage`, `chatStreaming`, `chatPersistence`, `messageWindowing`, `ChatInputFlow`, `ChatMessage.resume`, `sessionIsolation`

**Missing:**

- `useChatMessageScroll` — debounce, unmount, windowed history, `ScrollToBottomButton` visibility
- `ChatBrowserWorkspaceShell` — split mode, questionnaire session, message display parity
- `chatActions` — session switch + streaming, retry hidden, diagnostics cleanup
- `processMessagesForDisplay` — hidden, system compact boundary

---

## Summary

| Severity | Count |
| -------- | ----- |
| P0 | 2 (both fixed) |
| P1 | 6 |
| P2 | 8 |
| P3 | 7 |

**Highest priority (original):** R1-01/02 (session isolation) + R1-03 (split had no chat) — **all three remediated**.