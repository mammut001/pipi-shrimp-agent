# Documentation

This directory holds detailed per-subsystem documentation that doesn't fit
neatly into the top-level [`README.md`](../README.md). The top-level README
remains the entry point for new users; docs here are for contributors and
maintainers who need deeper context.

---

## 🗂️ Index

| Subsystem | Document | What it covers | Language |
|-----------|----------|----------------|----------|
| AutoResearch | [`audits/auto-research.md`](./audits/auto-research.md) | Audit history, anchored fix log, design rationale, regression-test backlog | EN |
| Full Codebase (10 rounds) | [`audits/full-codebase.md`](./audits/full-codebase.md) | 10-round audit summary (97 issues), fix log by P0/P1/P2/P3 priority, anchor index, backlog | EN |

---

## 📖 How docs are organized

Three kinds of document live here, each with a different audience:

### `audits/` — Code-audit history
**Audience:** anyone changing AutoResearch code, doing a code review, or
investigating a regression.

These files record the issues found during systematic audits, the fixes
that landed, and the `file:line` of each change. They also include
design rationale and a regression-test backlog.

**Conventions used:**

- Fixes are anchored in the source with `// AUDIT-FIX [audit-N-ar#M]`
  comments. `N` is the round number (1, 2, 3, …), `M` is the issue
  number within that round. The `-ar` namespace suffix keeps
  AutoResearch anchors distinct from chat-module anchors
  (`[audit-N#M]`), which are tracked separately.
- Each anchor's full comment block explains the original bug, the
  invariant the fix maintains, and (where useful) cross-references
  to other anchors.
- The audit doc is **append-only**: future rounds get a new section
  at the bottom; existing entries are never edited, only referenced
  from the new ones.

**Quick reference:**

```bash
# All AutoResearch anchored fixes
rg "AUDIT-FIX \[audit-\d+-ar#" src/

# Just the third-round AutoResearch fixes
rg "AUDIT-FIX \[audit-3-ar#" src/

# All audit anchors in the project (chat + AutoResearch)
rg "AUDIT-FIX \[audit-" src/
```

### Future: `design/`, `runbooks/`, `migration/`
Reserved for the same per-subsystem split as `audits/`. Nothing here yet.

---

## 🌐 Bilingual policy

Top-level `README.md` is **bilingual (English + 简体中文)** to keep the
project approachable for both audiences. Docs in this directory are
**English-only** by default unless the doc's filename or frontmatter
indicates otherwise — they target maintainers, who we expect to read
English. If you need a Chinese version, please open an issue rather
than maintaining a parallel translation.

---

## ✍️ Adding a new document

1. Decide which subdirectory fits: `audits/`, `design/`, `runbooks/`,
   `migration/`, or a new category. Add the subdirectory if it doesn't
   exist.
2. Filename: `kebab-case.md`. Suffix with the subsystem name
   (`auto-research.md`, `chat-compression.md`).
3. The first `# H1` should be the subsystem name. The first paragraph
   should be a one-sentence elevator pitch.
4. Link from this index (the table above) and from the top-level
   `README.md` if the subsystem is user-facing.
5. If the document records audit findings, follow the conventions in
   the **"audits/"** section above (anchors, append-only structure,
   file:line in tables).

---

## 🧭 Maintenance

These documents are maintained alongside the code. When you change
code near an `AUDIT-FIX` anchor:

1. Re-read the anchor's full comment to make sure your change preserves
   the invariant.
2. If the change weakens or alters the invariant, update the anchor
   *and* the corresponding row in the audit doc.
3. If the change introduces a *new* issue that needs tracking, add
   `[audit-N+1#X]` to the next round's section.

When the source code referenced by a doc moves (file rename, line
shift), the `file:line` references go stale. Periodic regen:

```bash
# After large refactors, re-grep the file:line references and update
# the docs. The anchors themselves are the source of truth — if a
# refactor moves an anchor, the line number in the doc will be off
# but the AUDIT-FIX ID still points at the right place.
rg "AUDIT-FIX \[audit-\d+-ar#" src/ -n
```

---

---

# 文档

本目录存放不适合塞进顶层 [`README.md`](../README.md) 的子系统级文档。
`README.md` 面向新用户；这里的文档面向贡献者和维护者，需要更深入
的上下文。

---

## 🗂️ 索引

| 子系统 | 文档 | 内容 | 语言 |
|--------|------|------|------|
| AutoResearch | [`audits/auto-research.md`](./audits/auto-research.md) | 审计历史、锚定修复日志、设计理由、回归测试清单 | 英文 |

---

## 📖 文档组织

本目录里目前只有一类文档，但预留其他位置：

### `audits/` — 代码审计历史
**目标读者：** 修改 AutoResearch 代码的人、做 code review 的人、调查
回归问题的人。

这些文件记录系统审计中发现的问题、落地的修复、每个改动的
`file:line`，以及设计理由和回归测试清单。

**约定：**

- 源码中的修复用 `// AUDIT-FIX [audit-N-ar#M]` 注释锚定。`N` 是
  审计轮次（1、2、3 ……），`M` 是该轮内的问题编号。`-ar` 命名
  空间后缀用来和 chat 模块的锚点（`[audit-N#M]`）区分开。
- 每条锚点的完整注释块说明原始 bug、修复维持的不变量，以及
  必要的关联引用。
- 审计文档是 **append-only**：未来的轮次作为新章节追加到底部；
  旧条目不会被改写，只会被新条目引用。

**速查：**

```bash
# 所有 AutoResearch 锚定过的修复
rg "AUDIT-FIX \[audit-\d+-ar#" src/

# 只看 AutoResearch 第三轮
rg "AUDIT-FIX \[audit-3-ar#" src/

# 项目中所有 audit 锚点（chat + AutoResearch）
rg "AUDIT-FIX \[audit-" src/
```

### 未来：`design/`、`runbooks/`、`migration/`
预留给同样的「按子系统切分」结构。暂时为空。

---

## 🌐 双语策略

顶层 `README.md` 是 **双语（英文 + 简体中文）** 的，便于不同读者。
本目录下的文档 **默认只写英文**（维护者用），除非文件名或 frontmatter
另有说明。如果你需要中文版，请提 issue，不要私下维护平行翻译。

---

## ✍️ 新增文档

1. 确定子目录：`audits/`、`design/`、`runbooks/`、`migration/`，
   或者新建一个类别。
2. 文件名：`kebab-case.md`，用子系统名结尾
   （`auto-research.md`、`chat-compression.md`）。
3. 第一个 `# H1` 写子系统名。第一段一句话讲清这份文档写什么。
4. 在本索引（上方表格）和顶层 `README.md`（如果子系统面向用户）里
   加上链接。
5. 如果是审计类文档，遵循 **`audits/` 一节** 的约定（锚点、
   append-only 结构、表格里带 `file:line`）。

---

## 🧭 维护

文档随代码维护。修改 `AUDIT-FIX` 锚点附近的代码时：

1. 重读锚点的完整注释，确认改动不破坏不变量。
2. 如果改动削弱或修改了不变量，更新锚点 *和* 审计文档中对应的行。
3. 如果改动引入了 *新的* 需要追踪的问题，在下一轮章节加
   `[audit-N+1#X]`。

大重构之后，源码位置会移动，文档里的 `file:line` 会过期。定期
重新生成：

```bash
# 大重构后重新 grep 出 file:line，更新文档。
# 锚点本身是真相之源 — 如果重构移动了锚点，文档里的行号
# 会偏，但 AUDIT-FIX ID 仍然指向正确的位置。
rg "AUDIT-FIX \[audit-\d+-ar#" src/ -n
```
