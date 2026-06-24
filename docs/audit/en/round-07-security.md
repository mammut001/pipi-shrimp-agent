# Round 7 — Security

**Scope:** path validation (TS+Rust), permissions, DOMPurify, artifactDetector, telegram, terminal cwd

Chinese version: [../round-07-security.md](../round-07-security.md)

---

## High

| ID | Location | Description | Suggested test | Status |
| --- | -------- | ----------- | -------------- | ------ |
| R7-01 | `pathValidation.ts:84,109` | TypeScript still used `startsWith` not `isWithinDir` — sibling-prefix escape (Rust fixed, TS not) | `/project2` inside `/project` | ✅ Fixed |
| R7-04 | `artifactDetector.ts:168-170` | When `workDir` undefined, paths not filtered — any absolute path registrable | `/etc/passwd` not added as artifact | Open |
| R7-06 | `artifactDetector.ts:147-187` | Declared `outputDir` unused | pipiOutputDir artifacts should register | Open |
| R7-07 | `ChatMessage.tsx:192-285` | `rehypeRaw` + DOMPurify on source string; `javascript:` href not blocked | Malicious link render | ✅ Fixed |
| R7-08 | `MarkdownDocumentPreview.tsx:18-22` | No DOMPurify / sanitize | `<img onerror>` vector | ✅ Fixed |
| R7-11 | `telegram.ts` types vs `commandRouter.ts` | `allowedChats` / `isChatAllowed` never called in router | Chat 456 rejected when allowlist is [123] | ❌ Open |
| R7-12 | `telegramService.ts` vs `lib.rs` | Multiple `telegram_*` invoke calls have no Rust handler | Command parity contract test | Open |

## Medium

| ID | Summary |
| --- | ------- |
| R7-02 | `isWithinDir` lexical comparison, no `..` normalization |
| R7-03 | artifactDetector matches Unix paths only |
| R7-05 | `addFileArtifact` has no workDir check |
| R7-09 | `ChatImage` accepts arbitrary img src |
| R7-10 | Telegram token in URL — log leakage risk |
| R7-13 | `terminal_create` cwd has no path_security |
| R7-15 | Telegram token XOR localStorage, not keychain |
| R7-16 | TS `BLOCKED_PREFIXES` missing Windows entries |

## Low / Info

R7-14 `telegram_get_updates` has no extra auth · R7-17 approval token negative test suggestion · R7-18 Terminal WebLinks malicious URL click

---

## TS/Rust defense-in-depth

| Check | Rust | TypeScript |
| ----- | ---- | ---------- |
| sibling-prefix escape | ✅ `is_within_dir` | ✅ `pathValidation.ts` (fixed) |
| blocked system dirs | ✅ comprehensive | ⚠️ Windows gaps |
| tool execution policy | ✅ registry | ⚠️ legacy `execute_tool` bypass |

**Total: 18 findings** (5 High — 3 fixed, 2 open; 9 Medium, 4 Low/Info)