# R7-15 Keychain migration spike

**Status:** Spike + fail-safe migrate correctness; plugin wire-up still open  
**Date:** 2026-09-22 (ET)  
**Related commits:** `588dd9f`, `122131e`, `90566a3` (+ this PR's fail-safe migrate)

## Problem

Telegram bot tokens (and other long-lived secrets) were stored in
`localStorage` with XOR obfuscation. That is better than plaintext but
still recoverable via DevTools / same-origin XSS. The intended end state
is OS keychain storage via a Tauri plugin.

## What already landed (do not reinvent)

| Piece | Location | Role |
| --- | --- | --- |
| Provider interface | `src/utils/secureStorage.ts` | `SecureStorageProvider` with `save` / `load` / `remove` |
| XOR backend | `LocalStorageProvider` | Current default outside Tauri; preserves existing behaviour |
| Keychain stub | `KeychainProvider` | Dynamic-imports `@tauri-apps/plugin-secure-store` when present |
| Factory | `getSecureStorage()` / `resolveSecureStorage()` | Tauri → keychain **provider object**; web/tests → localStorage (overrides for tests) |
| Call-site shim | `src/utils/secureSecrets.ts` | `saveSecret` / `loadSecret` / `deleteSecret` / fail-safe `migrateLegacySecret` |
| Settings wiring | `src/store/settingsStore.ts` | Telegram token load + legacy migrate through shim |
| Tests | `src/utils/__tests__/secureStorage.test.ts` | Provider selection, keychain-missing behaviour, fail-safe migrate |

Secrets never need new call-site changes once a real keychain backend is
reachable through `KeychainProvider`.

## Honest behaviour when the plugin is missing

There is **no official** `@tauri-apps/plugin-secure-store` for Tauri 2
in this project's dependency set (and no first-party package by that
name was available when the spike was written). Do **not** document or
assume a "reliable fallback" to XOR/localStorage inside
`KeychainProvider`:

| Call | Plugin missing |
| --- | --- |
| `KeychainProvider.save` | **Throws** (`Tauri secure-store plugin is not installed…`) |
| `KeychainProvider.load` | Returns `null` |
| `KeychainProvider.remove` | No-op |

The factory still returns a provider named `keychain` under Tauri (or
`__secureStorageForceKeychain`) even when the module is absent — it does
**not** probe the dynamic import synchronously and rewrite to
`localStorage`. Outside Tauri, `LocalStorageProvider` remains the working
path.

### Fail-safe legacy migrate

`migrateLegacySecret` only removes the legacy localStorage key **after**
the active provider `save` + `load` round-trip confirms the new value.
If keychain write fails (throw or verify mismatch), the legacy key is
**left in place** so the token stays readable for retry / next boot.
Tests cover: forced keychain + missing plugin → legacy token still
present and readable.

## Why this is still "partially fixed"

Runtime secret persistence in a Tauri build still needs a real plugin
wired (Cargo + npm + capabilities + `ensurePlugin` adapt). Until then,
treat keychain selection without a plugin as a **write failure**, not as
a silent XOR fallback.

## Smallest follow-up knife (not this PR)

1. Pick a maintained Tauri 2 desktop keychain plugin (candidates surveyed
   2026-09-22: third-party `tauri-plugin-secure-keystore` /
   `tauri-plugin-secure-storage` — evaluate license, desktop backends,
   and API surface before committing).
2. Add Cargo + npm deps; register `.plugin(...)` in `src-tauri/src/lib.rs`.
3. Add capability permission in `src-tauri/capabilities/default.json`.
4. Adapt `KeychainProvider.ensurePlugin()` to the chosen package's
   `set` / `get` / `delete` exports (keep the provider interface stable).
5. Add one integration test that forces the keychain provider and asserts
   the secret is **not** under `pipi_secret_v2_*` in `localStorage`.
6. Optionally: make `resolveSecureStorage` async (or cache a probed
   backend) so Tauri without a plugin selects `LocalStorageProvider`
   explicitly — that would be a deliberate product choice, not the
   current silent-fallback myth.

Do **not** rewrite `secureSecrets` / settingsStore unless the plugin API
forces it — the spike already isolates that churn behind
`getSecureStorage()`.

## Out of scope for follow-up

- Rewriting SessionRuntime / settings UX
- Migrating every API key in the app (start with `telegram-token` only)
- Boiling the ocean with Stronghold / custom crypto
