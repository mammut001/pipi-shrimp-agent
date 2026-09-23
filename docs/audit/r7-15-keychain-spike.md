# R7-15 Keychain migration spike

**Status:** Spike shipped; plugin wire-up still open  
**Date:** 2026-09-22 (ET)  
**Related commits:** `588dd9f`, `122131e`, `90566a3`

## Problem

Telegram bot tokens (and other long-lived secrets) were stored in
`localStorage` with XOR obfuscation. That is better than plaintext but
still recoverable via DevTools / same-origin XSS. The intended end state
is OS keychain storage via a Tauri plugin.

## What already landed (do not reinvent)

| Piece | Location | Role |
| --- | --- | --- |
| Provider interface | `src/utils/secureStorage.ts` | `SecureStorageProvider` with `save` / `load` / `remove` |
| XOR backend | `LocalStorageProvider` | Current default; preserves existing behaviour |
| Keychain stub | `KeychainProvider` | Dynamic-imports `@tauri-apps/plugin-secure-store` when present |
| Factory | `getSecureStorage()` / `resolveSecureStorage()` | Tauri → keychain provider; web/tests → localStorage (overrides for tests) |
| Call-site shim | `src/utils/secureSecrets.ts` | `saveSecret` / `loadSecret` / `deleteSecret` / `migrateLegacySecret` |
| Settings wiring | `src/store/settingsStore.ts` | Telegram token load + legacy migrate through shim |
| Tests | `src/utils/__tests__/secureStorage.test.ts` | Provider selection + keychain-missing fallback |

Secrets never need new call-site changes once a real keychain backend is
reachable through `KeychainProvider`.

## Why this is still "partially fixed"

There is **no official** `@tauri-apps/plugin-secure-store` for Tauri 2
in this project's dependency set (and no first-party package by that
name was available when the spike was written). `KeychainProvider`
therefore fails its dynamic import and either throws on `save` or
returns `null` on `load`. Runtime behaviour remains localStorage XOR.

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

Do **not** rewrite `secureSecrets` / settingsStore unless the plugin API
forces it — the spike already isolates that churn behind
`getSecureStorage()`.

## Out of scope for follow-up

- Rewriting SessionRuntime / settings UX
- Migrating every API key in the app (start with `telegram-token` only)
- Boiling the ocean with Stronghold / custom crypto
