# Provider stream finalize (truncated replies)

**Date:** 2026-09-15 (America/Toronto)  
**Scope:** Scout leftover from `docs/soak-polish-scout.md` — truncated replies / provider stream finalize.  
**Principle:** prove + persist + observe (no SessionRuntime rewrite).

## Problem

Provider SSE streams sometimes:

1. Close **without a trailing newline** on the last `data:` line → last token(s) never parsed (e.g. UI shows `ping` while curl got `ping-ok`).
2. End **without** `finish_reason` / `[DONE]` / Anthropic `message_stop` → invoke still “succeeds” with partial text and **no clear terminal marker**.
3. OpenAI-compatible adapters never emitted `StreamEvent::Done` on `finish_reason`, so finalize waited on TCP EOF alone.

## Fix (smallest proveable)

### Native (`src-tauri/src/claude/`)

| Change | Where |
|--------|--------|
| Flush leftover SSE buffer on EOF (`take_sse_buffer_remainder`) | `stream_parser.rs` |
| Treat `data: [DONE]` as terminal finalize | `stream_parser.rs` |
| Emit `StreamEvent::Done` on OpenAI `finish_reason` | `http/adapters/openai.rs` |
| Track `finish_reason` on `StreamContext` / `ChatResponse` | `adapters/mod.rs`, `message.rs` |
| Set `truncated: true` for EOF / `length` / `content_filter` / unknown | `ChatResponse::with_finish` |

Cancel path still returns `empty_response().with_finish(Some("cancelled"))` (not truncated).

### Frontend

| Change | Where |
|--------|--------|
| Detect truncated finalize meta + append notice | `src/core/providerStreamFinalize.ts` |
| On `api_response_complete`, append notice + `status_update` | `src/core/runtime/queryLoop.ts` |
| Re-export from chat streaming helpers | `src/store/chat/chatStreaming.ts` |

## Tests

```bash
# Rust
cargo test --manifest-path src-tauri/Cargo.toml \
  take_sse_buffer_remainder \
  emits_done_on_finish_reason \
  marks_length_finish_reason \
  send_request_finalizes_truncated \
  send_request_finalizes_openai_stream_without_trailing_newline \
  -- --nocapture

# Jest
pnpm exec jest \
  src/store/chat/__tests__/chatStreaming.test.ts \
  src/core/__tests__/providerStreamFinalize.test.ts \
  src/core/__tests__/streamAdapter.test.ts \
  --runInBand --no-coverage
```

## Residuals (out of scope)

- Project Folder GTK binding UX
- Danger mode defaults affordance
- Full Playwright product check of short `ping-ok` prompt against live provider
