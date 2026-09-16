# GPT guidance: post-★★★★★ product gaps (2026-09-15)

Source: ChatGPT 皮皮虾 / 后端架构对比

Principle: **prove + persist + observe**, not redesign. Do not rewrite SessionRuntime / queryLoop.

## First 3 knives
1. Crash/reload terminalization (P0) — orphan tool_calls → terminal cancelled/interrupted on hydrate
2. DB reload + session-switch cancellation matrix tests (P0)
3. Runtime trace sink usable for race forensics (P0)

## Do not
- Rewrite SessionRuntime / queryLoop / new SessionManager
- Actor system / event sourcing / full durable resume of half-run tools
- OpenTelemetry stack; ChatStore rewrite; multi-provider; big E2E framework

## Next knives (P1)

4. **DONE** Manual D repeatable product harness — [`docs/manual-d-product-harness.md`](./manual-d-product-harness.md) (#83 TS harness, #92 Rust catalog; `src/core/runtime/__tests__/manualDProductHarness.test.ts` + Rust `test_barrier_tool`)
5. Interrupted-turn recovery policy — `docs/interrupted-turn-recovery-policy.md` + helpers/tests

## Next knives (P2)

6. Runtime diagnostics snapshot — `dumpRuntimeDiagnostics` / `__PIPI_RUNTIME_DIAG__` (+ extended `getSnapshot`)
7. Trace retention / export (light) — `dumpJsonLines({ sessionId, limit })` documented; no OpenTelemetry

