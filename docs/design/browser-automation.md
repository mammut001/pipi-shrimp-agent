# Browser Automation

This document describes the browser-automation architecture that powers the
embedded WebView, the CDP Native agent, and the safety / observability layers
that surround them. It complements the source-level JSDoc in
`src/utils/browserEngine.ts`, `src/utils/browserActionPolicy.ts`,
`src/utils/browserVisionFallback.ts`, and the Rust modules under
`src-tauri/src/browser/`.

---

## 🎯 Goals

1. The default browser-automation path must be **fast, stable, and observable**.
2. The legacy `page-agent` injection must remain available only as a **deliberate
   opt-in**, never as a silent default.
3. Every action the agent wants to take is checked against a **safety policy**
   before reaching the CDP layer.
4. A **vision-based** fallback must be wired in as an interface, with a stub
   provider, so that future coordinate-based agents can be added without
   re-architecting the loop.
5. The embedded WebView is a **display / manual-handoff** surface; heavy CDP
   work happens in Rust, not in the WebView.

---

## 🧠 Engines

Three engines are defined in `src/types/browserEngine.ts`:

| Engine | What it is | Default? | When to use |
|--------|------------|----------|-------------|
| `cdp_native` | Rust-driven Chromiumoxide CDP loop, with light PageState observations and structured-action execution | **Yes** | Always, unless explicitly opted out |
| `legacy_page_agent` | The original `page-agent` script injected into the Tauri WebView | No — requires `PIPI_BROWSER_PAGE_AGENT_LEGACY` | Diagnostic / fallback when CDP cannot observe the page |
| `vision_fallback` | Screenshot + coordinate-based stub provider | No — requires `PIPI_BROWSER_VISION_FALLBACK` | Pages that return empty PageState, canvas / shadow warnings, or explicitly requested |

### Selection flow

```
resolveBrowserEngine(requested?)
   1. read default from localStorage / PIPI_BROWSER_ENGINE_DEFAULT
   2. if requested:
        requested == 'legacy_page_agent' && legacyEnabled   -> legacy
        requested == 'vision_fallback'   && visionEnabled   -> vision
        requested == 'cdp_native'                            -> cdp
   3. always re-clamp:
        legacy with !legacyEnabled -> cdp_native
        vision with !visionEnabled -> cdp_native
   4. log [BrowserEngine] Selected engine: <engine>
```

The full logic lives in `src/utils/browserEngine.ts`. It is unit-tested in
`src/__tests__/browserEngine.test.ts`.

### Feature flags

| Env / localStorage key | Effect |
|------------------------|--------|
| `PIPI_BROWSER_ENGINE_DEFAULT` | Overrides the default engine. |
| `PIPI_BROWSER_PAGE_AGENT_LEGACY` | Enables the legacy `page-agent` injection. Off by default. |
| `PIPI_BROWSER_VISION_FALLBACK` | Enables the vision-fallback path. Off by default. |
| `PIPI_BROWSER_LOCK_SURFACE_WHILE_RUNNING` | Locks the WebView bounds during an agent run to avoid costly move/resize calls. |
| `PIPI_BROWSER_PERMISSION_MODE` | One of `observe_only` / `ask_each_action` / `auto_safe`. |

---

## 🛡️ Action Policy

Every action emitted by the model is evaluated by
`src/utils/browserActionPolicy.ts` before it touches the CDP layer. The
verdict is one of:

- `allow` — execute immediately.
- `ask` — surface a confirmation dialog in the UI; pause the loop.
- `block` — refuse and log a `policy_blocked` event.

Risk is classified as `low` / `medium` / `high` based on:

- **URL pattern** (banking, payments, auth, internal tools).
- **Element label** (`pay`, `checkout`, `delete`, `transfer`, `subscribe`, …).
- **Input type** (`password`, `credit-card`, `tel`).
- **Permission mode** (the active `BrowserActionPermissionMode`).

The policy is **deterministic and unit-tested** in
`src/__tests__/browserActionPolicy.test.ts`.

---

## 🔭 Observability

Observability data is produced by three layers and stored in
`useBrowserObservabilityStore`:

1. **Frontend store** (`src/store/browserObservabilityStore.ts`) — collects
   `recordEvent`, `recordAction`, `startCommand`, `finishCommand`, and
   `upsertPageState` calls. Persists a snapshot-cache view, a benchmark
   report, and the latest `BrowserPageState` snapshot.
2. **Wiring** (`src/store/browserObservabilityWiring.ts`) — subscribes to
   `useBrowserAgentStore` and `useCdpStore`, ingests backend events, and
   drives the periodic `syncBackendObservability` / `syncBackendPageState`
   poll loops. Resets its module-level high-water mark on `cleanup` so
   tests can re-ingest from the start.
3. **Rust observability** (`src-tauri/src/browser/observability.rs`) —
   produces `BrowserEvent` and `BrowserBenchmarkSample` records with
   per-step timings that are surfaced as a benchmark report.

The debug panel (`src/components/BrowserDebugPanel.tsx`) renders a
read-only view of the latest state and is used to diagnose regressions.

---

## 🌐 Vision Fallback (preview)

`src/utils/browserVisionFallback.ts` decides **when** to switch to a
vision-based provider, and `src/utils/visionBrowserProvider.ts` holds the
provider registry.

Trigger conditions include:

- A configurable streak of empty `PageState` observations.
- A `click_element` action whose target could not be resolved.
- Warnings on the page state such as `canvas`, `shadow`, `cross_origin`.
- An explicit `forceVision` flag from the caller.

The registered `MockVisionProvider` always returns a `left_click` at the
center of the viewport, which is enough to exercise the dispatch path
end-to-end. Real vision models plug in by calling `registerVisionProvider`
during app startup.

Unit tests live in `src/__tests__/browserVisionFallback.test.ts`.

---

## 🪟 Embedded WebView

`src/components/BrowserSurfaceViewport.tsx` treats the embedded Tauri
WebView as a **display surface** first and an automation target second:

- The surface is **locked** (`shouldLockSurface`) while the agent is
  running, to avoid costly move / resize calls.
- Surface syncs are debounced (`SURFACE_SYNC_DEBOUNCE_MS = 120ms`) and
  retried (`MAX_SYNC_RETRIES = 12`).
- Heavy base64 screenshots are avoided in favor of light `PageState`
  observations delivered by the Rust CDP layer.

---

## 🔄 Request lifecycle

```
   user prompt
       │
       ▼
 useBrowserAgentStore
       │
       │  resolveExecutionMode() ──▶ resolveBrowserEngine()
       ▼
 nativeBrowserAgent.run()
       │
       │  ┌─ chooseObservationLevel() ─▶ light / interactive / full / screenshot
       │  ├─ capture PageState (Rust CDP) ───────────▶ backend PageState event
       │  ├─ LLM structured action
       │  ├─ parseBrowserActionEnvelopeWithRetry()
       │  ├─ evaluateBrowserAction() ─▶ allow / ask / block
       │  ├─ execute action (Rust CDP)
       │  └─ ingest event ──▶ useBrowserObservabilityStore
       ▼
   onRunSummary ──▶ setNativeRunStats
```

---

## 🧪 Tests

| File | What it covers |
|------|----------------|
| `src/__tests__/browserEngine.test.ts` | Engine selection, feature-flag matrix, human-readable labels. |
| `src/__tests__/browserAgentActionSchema.test.ts` | Action schema parsing, retry path, malformed-input handling. |
| `src/__tests__/browserActionPolicy.test.ts` | Safety policy decisions across permission modes, sensitive labels, URL patterns. |
| `src/__tests__/browserVisionFallback.test.ts` | Vision-fallback decisioning and provider dispatch. |
| `src/__tests__/browserPageStateFormatting.test.ts` | PageState prompt formatting, element list cap, target resolution. |
| `src/__tests__/BrowserDebugPanel.test.ts` | Debug panel rendering against a synthetic observability snapshot. |
| `src/__tests__/BrowserFailureRecovery.test.ts` | Recovery snapshot UI interactions (retry / continue / takeover). |
| `src/__tests__/browserObservabilityWiring.test.ts` | Wiring between CDP / agent stores and the observability store. |
| `src/__tests__/browserAgentListeners.test.ts` | Cross-store listener wiring. |

---

## 📚 Further reading

- `src/utils/browserEngine.ts` — engine selection logic.
- `src/utils/browserActionPolicy.ts` — safety policy.
- `src/utils/browserVisionFallback.ts` — vision decisioning.
- `src/utils/nativeBrowserAgent.ts` — the CDP-native agent loop.
- `src/store/browserObservabilityWiring.ts` — observability wiring.
- `src-tauri/src/browser/observability.rs` — Rust observability primitives.
