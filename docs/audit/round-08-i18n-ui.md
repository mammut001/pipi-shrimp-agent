# Round 8 — i18n & UI

**Scope:** `src/i18n/*`, Sidebar, Settings, TerminalPanel, AgentPanel, Markdown, DocPanel

---

## Findings

| ID | Sev | Location | Description | Suggested test |
| --- | --- | -------- | ----------- | -------------- |
| R8-01 | Medium | `Settings.tsx:795` | 硬编码 `Fetching...`；i18n key 已存在未用 | zh-CN render Settings |
| R8-02 | Low | `Sidebar.tsx:538` | 标题硬编码非 i18n | locale 切换 |
| R8-03 | Medium | `TerminalPanel.tsx` | Connecting/Active/Clear/Close 等硬编码 EN | toolbar 用 `t()` |
| R8-04 | High | `AgentPanel.tsx` | 大块英文 UI（tabs、progress、CDP 字符串） | i18n provider + grep guard |
| R8-05 | Medium | `ChatMessage.tsx:223` | `Loading carousel...` 未 i18n | zh-CN suspense |
| R8-06 | Medium | `telegram/commandRouter.ts` | 用户可见回复硬编码中文 | `t('telegram.*')` |
| R8-07 | Low | `ChatImage.tsx:153` | Download 硬编码 | lightbox labels |
| R8-08 | Low | `DocPanel.tsx:336` | `Back to Docs` 硬编码 | zh-CN |
| R8-09 | Low | `Sidebar.tsx:504` | `formatDate` 未用 app locale | `setLocale('zh-CN')` |
| R8-10 | Info | `keyParity.test.ts` | 不检测 unused keys / 组件硬编码 | unused key report |
| R8-11 | Medium | `MarkdownDocumentPreview` | **无组件测试** + XSS（见 R7-08） | security render test |
| R8-12 | Medium | `Sidebar.tsx` | **无测试**；批量删除等复杂流 | RTL delete flow |
| R8-13 | Medium | `TerminalPanel.tsx` | **无测试** | shell profile banner |
| R8-14 | Low | `Settings.tsx` | 无页面级 UI test | smoke render |
| R8-15 | Low | `AgentPanel.test.ts` | 未断言 i18n 覆盖 | tab titles locale |

**Total: 15 findings**