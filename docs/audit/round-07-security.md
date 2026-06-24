# Round 7 — Security

**Scope:** path validation (TS+Rust), permissions, DOMPurify, artifactDetector, telegram, terminal cwd

---

## High

| ID | Location | Description | Suggested test |
| --- | -------- | ----------- | -------------- |
| R7-01 | `pathValidation.ts:84,109` | TS 仍用 `startsWith` 非 `isWithinDir`；sibling-prefix 逃逸（Rust 已修 TS 未修） | `/project2` inside `/project` |
| R7-04 | `artifactDetector.ts:168-170` | `workDir` undefined 时不过滤路径，任意绝对路径可注册 | `/etc/passwd` 不 addArtifacts |
| R7-06 | `artifactDetector.ts:147-187` | `outputDir` 声明未使用 | pipiOutputDir 产物应注册 |
| R7-07 | `ChatMessage.tsx:192-285` | `rehypeRaw` + DOMPurify 源串；`javascript:` href 未拦 | malicious link render |
| R7-08 | `MarkdownDocumentPreview.tsx:18-22` | 无 DOMPurify / sanitize | `<img onerror>` 向量 |
| R7-11 | `telegram.ts` types vs `commandRouter.ts` | `allowedChats` / `isChatAllowed` 从未在 router 调用 | chat 456 被拒 when allowlist [123] |
| R7-12 | `telegramService.ts` vs `lib.rs` | 多个 `telegram_*` invoke 无 Rust handler | command parity 契约测试 |

## Medium

| ID | Summary |
| --- | ------- |
| R7-02 | `isWithinDir` 词法比较，无 `..` 规范化 |
| R7-03 | artifactDetector 只匹配 Unix 路径 |
| R7-05 | `addFileArtifact` 无 workDir 检查 |
| R7-09 | `ChatImage` 接受任意 img src |
| R7-10 | Telegram token 在 URL 中，日志泄漏风险 |
| R7-13 | `terminal_create` cwd 无 path_security |
| R7-15 | Telegram token XOR localStorage 非 keychain |
| R7-16 | TS `BLOCKED_PREFIXES` 缺 Windows 项 |

## Low / Info

R7-14 telegram_get_updates 无额外鉴权 · R7-17 approval token 负例测试建议 · R7-18 Terminal WebLinks 误点 URL · R7-18 terminal 可点击恶意 URL

---

## TS/Rust 防御纵深

| 检查 | Rust | TypeScript |
| ---- | ---- | ---------- |
| sibling-prefix escape | ✅ `is_within_dir` | ❌ `pathValidation.ts` |
| blocked system dirs | ✅ 较全 | ⚠️ Windows 缺口 |
| tool execution policy | ✅ registry | ⚠️ legacy `execute_tool` 绕过 |

**Total: 18 findings** (5 High, 9 Medium, 4 Low/Info)