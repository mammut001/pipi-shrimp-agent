# Plan Mode "I'll go look at the code" Theater — Diagnostic

**Status:** Fixed by prompt change in `src/services/planMode.ts` (PLAN_MODE_SYSTEM_PROMPT).
**Affects:** All sessions in `permissionMode === 'plan-only'`.
**Not a bug in the tool wiring** — the missing tools are intentional. The defect is in the prompt that does not tell the model how to behave when tools are missing.

---

## Symptom (verbatim from the user)

> "为啥现在直接说他会去看，然后就直接不动了呢"

(`pipi-shrimp-agent` is running in Plan Mode, the user types "帮我看看这个代码", the model streams "我先了解一下这个项目的结构,然后再仔细看看代码。让我先查看一下项目目录结构。" and then the turn ends with no further output. The model never actually opens a tool.)

The agent runtime logs (excerpt from the user) confirm the cause:

```
[claude-http] provider=MiniMax format=OpenAI url=https://api.minimaxi.com/v1/chat/completions ...
[claude-http] request_summary={"hasReasoningParam":false,"hasResponseFormat":false,"hasTools":false,"messageCount":3,"model":"MiniMax-M3","provider":"minimax","toolNames":[],"tool_choice":null}
[claude-http] ClaudeHttpTelemetryOutcome { provider: "minimax", model: "MiniMax-M3", ..., status: "success", ... }
```

The relevant signal: `"hasTools":false, "toolNames":[]`. The LLM call goes through, succeeds, and returns text — but it has no tool list, so any "I'll inspect the code" intent it expresses is theatrical.

---

## Root cause chain (verified by reading the code)

1. **The user's session is in Plan Mode.**
   - `src/store/chat/chatActions.ts:315`: `const isPlanMode = sessionSnapshot?.permissionMode === 'plan-only';`
2. **Plan Mode explicitly disables tools.**
   - `src/store/chat/chatActions.ts:489-492`:
     ```ts
     const engine = isPlanMode
       ? runChatTurn(activeSessionId, currentMessages(), finalSystemPrompt, sessionWorkDir, false, undefined, { noTools: true })
       : runChatTurn(..., options?.allowBrowserTools || false);
     ```
3. **The Rust request body drops `tools` entirely when `no_tools: true`.**
   - `src-tauri/src/claude/http/request_builder.rs:512-518` (openai path):
     ```rust
     if !no_tools {
         body["tools"] = serde_json::json!(convert_tools_to_openai_format(
             &get_tools(allow_browser_tools),
             config.capabilities.supports_response_format_json_schema
         ));
         body["tool_choice"] = serde_json::json!("auto");
     }
     ```
   - Same guard at `:465-467` (anthropic path).
4. **The model receives `tools: []` and a Plan Mode system prompt that says "do not call tools, do not pretend you have" — but does not say "do not announce that you are about to do something you cannot do."**

The model produces a polite preamble ("let me first take a look"), has no way to follow through, and the turn ends. To the user, this looks like the model froze. In reality the model followed the prompt literally — it just had no recipe for what to do when it cannot inspect the codebase.

This is **not** the same defect as the `Some([])`-vs-`None` `allowedTools` trap in `filter_tools_by_allowed_names` (`src-tauri/src/claude/http/tool_catalog.rs:560-584`). That trap is real and would be hit if any caller ever passed `allowedTools: Some([])` to the Rust command, but every TypeScript call site either omits the field, sets it to a non-empty list, or normalizes `[]` to `undefined` in `src/services/resolvedChatRequest.ts:176`:

```ts
allowedTools: options.allowedTools?.length ? [...options.allowedTools] : undefined,
```

So the `toolNames:[]` the user observed is **not** the `Some([])` filter trap — it is the `no_tools: true` Plan Mode design.

---

## What was changed

`src/services/planMode.ts` — added a new section "Tool Availability in Plan Mode" right after "Strict Constraints" in `PLAN_MODE_SYSTEM_PROMPT`. The new section:

- Tells the model tools are intentionally disabled in Plan Mode.
- Forbids "I'll go look at the code" / "let me first inspect" preambles (the precise phrasing the failing model used).
- Tells the model to either (a) produce the structured execution plan from in-conversation context, or (b) ask focused clarifying questions when context is insufficient, or (c) tell the user to switch Execution Mode if they explicitly want a tool call.
- Adds a one-line note to "Iteration Behavior" so the rule applies to follow-up revisions too.

The fix is **prompt-only** — no Rust, no Tauri commands, no store actions were touched. The behavioral contract of Plan Mode (no tools, plan only) is unchanged; only the model's reading of it is corrected.

---

## Blast radius / what is NOT changed

- Plan Mode still sets `noTools: true` in the chat engine call (`chatActions.ts:492`).
- The Rust `executor.rs` tool-removal logic (`src-tauri/src/claude/http/executor.rs:133-141`) is unchanged. It still strips `tools`/`tool_choice` when the model/provider capability combination says no.
- The `allowedTools: Some([])` trap in `filter_tools_by_allowed_names` is still latent. Today no caller hits it (verified by audit below), but a future caller that passes `[]` to the Rust command will silently lose all tools. This is documented here for future review.

---

## Audit of every `send_claude_sdk_chat_streaming` call site

| File:line | `noTools` | `allowedTools` | Verdict |
|---|---|---|---|
| `src/store/chat/chatActions.ts:213-227` (generateBrowserResultResponse) | `true` | not passed | ✓ Intentional (post-browser tool, model summarises) |
| `src/store/chat/chatActions.ts:489-492` (sendMessage, plan mode) | `true` | not passed | ✓ Intentional (this is the affected path) |
| `src/services/multiagent/subagent.ts:70-79` | not passed | not passed | ✓ Inherits defaults (no filter) |
| `src/services/memory/autoExtraction.ts:139-149` | `true` | not passed | ✓ Intentional (extraction task) |
| `src/services/memory/relevantRecall.ts:68-77` | not passed | not passed | ⚠ Should probably be `noTools: true` (this is a memory-classifier task and the model should not have tool access). Low-priority cleanup; left as-is in this change to keep scope tight. |
| `src/services/swarm/memory/extraction.ts:62-72` | `true` | not passed | ✓ Intentional |
| `src/services/swarm/memory/extraction.ts:200-210` | `true` | not passed | ✓ Intentional |
| `src/services/workflowEngine/agentRunner.ts:206-215` | not passed | not passed | ✓ Intentional (workflow agents are expected to call tools; scope is controlled by the agent definition upstream) |
| `src/services/resolvedChatRequest.ts:167-186` (the one all "normal" chat calls go through) | forwarded | normalised `[]` → `undefined` at line 176 | ✓ The `Some([])` trap is unreachable from this path |

`runChatTurn` (`src/core/QueryEngine.ts:110`) is the funnel for both `sendMessage` (non-plan) and `runHeadlessAgentTurn` (`src/services/headless/agentRunner.ts:266`); both honour the same `RunChatTurnOptions` and go through `buildResolvedChatRequest`, so the audit covers them transitively.

No call site is misconfigured. The defect was purely in the Plan Mode system prompt.
