# R7-15 Native keychain storage

**Status:** Native keychain backend wired for Tauri desktop; browser storage remains compatible.  
**Date:** 2026-09-23

## Implementation

Tauri builds use the Rust keyring crate (3.6.3) with native macOS Keychain,
Windows Credential Manager, and Linux Secret Service backends. The fixed
service name is com.pipishrimp.agent; per-secret identifiers are validated
before the OS credential API is called. Blocking OS calls run on Tokio's
blocking thread pool.

The Rust commands are registered in the Tauri invoke handler:

- secure_storage_save
- secure_storage_load
- secure_storage_delete

The frontend KeychainProvider calls those commands through the Tauri core
API. It has no localStorage fallback. Native read, write, or delete errors
propagate to the caller instead of being reported as success.

Browser builds continue to use the existing XOR-backed localStorage provider
for compatibility. Inline settings that mix secrets with ordinary settings
also retain their legacy XOR format; this change moves discrete secrets such
as the Telegram token to the OS keychain in desktop builds.

## Migration

The provider migrates values written by earlier desktop builds under the
pipi_secret_v2_ namespace. It removes the localStorage copy only after
writing the value to the native keychain and reading it back successfully.
The existing migration for ai-agent-telegram-token follows the same rule.
If native storage fails, the old value remains so the next startup can retry.

## Verification

Frontend tests cover provider selection, native command dispatch, error
propagation, removal of local copies after verified migration, and keeping
old values when verification fails. Rust unit tests cover key identifier
validation. CI checks the locked Cargo dependency resolution and rustfmt.
The repository's release workflow remains responsible for full macOS and
Windows application builds.

## Runtime boundary

Keychain storage protects discrete secrets at rest from casual inspection
of localStorage. Code running inside the trusted application renderer can
still request a stored value through the registered Tauri commands; this
does not isolate secrets from a compromised renderer.
