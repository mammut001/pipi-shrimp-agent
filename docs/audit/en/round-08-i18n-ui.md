# Round 8 — i18n & UI

**Scope:** `src/i18n/*`, Sidebar, Settings, TerminalPanel, AgentPanel, Markdown, DocPanel

Chinese version: [../round-08-i18n-ui.md](../round-08-i18n-ui.md)

---

## Findings

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R8-01 | Medium | `Settings.tsx:795` | Hardcoded `Fetching...`; i18n key exists but unused | zh-CN render Settings |
| R8-02 | Low | `Sidebar.tsx:538` | Title hardcoded, not i18n | Locale switch |
| R8-03 | Medium | `TerminalPanel.tsx` | Connecting/Active/Clear/Close etc. hardcoded EN | Toolbar uses `t()` |
| R8-04 | High | `AgentPanel.tsx` | Large English UI blocks (tabs, progress, CDP strings) | i18n provider + grep guard |
| R8-05 | Medium | `ChatMessage.tsx:223` | `Loading carousel...` not i18n | zh-CN suspense |
| R8-06 | Medium | `telegram/commandRouter.ts` | User-visible replies hardcoded Chinese | `t('telegram.*')` |
| R8-07 | Low | `ChatImage.tsx:153` | Download hardcoded | Lightbox labels |
| R8-08 | Low | `DocPanel.tsx:336` | `Back to Docs` hardcoded | zh-CN |
| R8-09 | Low | `Sidebar.tsx:504` | `formatDate` does not use app locale | `setLocale('zh-CN')` |
| R8-10 | Info | `keyParity.test.ts` | Does not detect unused keys / component hardcoding | Unused key report |
| R8-11 | Medium | `MarkdownDocumentPreview` | **No component test** + XSS (see R7-08) | Security render test |
| R8-12 | Medium | `Sidebar.tsx` | **No tests**; complex flows like bulk delete | RTL delete flow |
| R8-13 | Medium | `TerminalPanel.tsx` | **No tests** | Shell profile banner |
| R8-14 | Low | `Settings.tsx` | No page-level UI test | Smoke render |
| R8-15 | Low | `AgentPanel.test.ts` | Does not assert i18n coverage | Tab titles per locale |

**Total: 15 findings**