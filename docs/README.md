# Documentation

This directory holds detailed per-subsystem documentation that doesn't fit
neatly into the top-level [`README.md`](../README.md). The top-level README
remains the entry point for new users; docs here are for contributors and
maintainers who need deeper context.

---

## 📋🔍 Index

| Subsystem | Document | What it covers | Language |
|-----------|----------|----------------|----------|
| AutoResearch | [`audits/auto-research.md`](./audits/auto-research.md) | Audit history, anchored fix log, design rationale, regression-test backlog | EN |
| Full Codebase (10 rounds) | [`audits/full-codebase.md`](./audits/full-codebase.md) | 10-round audit summary (97 issues), fix log by P0/P1/P2/P3 priority, anchor index, backlog | EN |
| Browser Automation | [`design/browser-automation.md`](./design/browser-automation.md) | Engine selection, action policy, vision fallback, observability, embedded surface, test map | EN |
| Folders & Runs (concepts) | [`concepts/folders-and-runs.md`](./concepts/folders-and-runs.md) | Project Folder, PiPi Output Folder, Context Files, AutoResearch Workspace, Target Project, Scaffold Folder, Run Dir, Living Doc, Artifacts — owners, readers, writers, defaults, common mistakes | EN |
| Execution Modes (concepts) | [`concepts/execution-modes.md`](./concepts/execution-modes.md) | Ask / Plan / Debug / Agent / Bypass — registry, allowed tools, hard-enforcement points, tests that protect each mode, UI ↔ enforcement honesty | EN |
| AutoResearch Runtime (concepts) | [`concepts/autoresearch-runtime.md`](./concepts/autoresearch-runtime.md) | Guided vs manual bootstrap, local vs SSH, connection test, run lifecycle, artifacts / living doc / result.json, hard runtime vs prompt-only settings | EN |
| Complexity Governance | [`architecture/complexity-governance.md`](./architecture/complexity-governance.md) | File-size thresholds, component / hook / pure-logic split rules, state-machine recommendation, PR size, required tests before extraction, how to run `npm run report:complexity` | EN |
| Refactor Plan | [`architecture/refactor-plan.md`](./architecture/refactor-plan.md) | Per-anchor split roadmap for every `>800` LOC file (AG-01..AG-35 + TEST-01..TEST-06), wave definitions, promotion criteria for `500-800` LOC files, retirement protocol | EN |

---

## 🏗 How docs are organized

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
Reserved for the same per-subsystem split as `audits/`. The
[`design/browser-automation.md`](./design/browser-automation.md) doc is the
first entry under `design/`.

---

## 📜 Bilingual policy

Top-level `README.md` is **bilingual (English + 简体中文)** to keep the
project approachable for both audiences. Docs in this directory are
**English-only** by default unless the doc's filename or frontmatter
indicates otherwise — they target maintainers, who we expect to read
English. If you need a Chinese version, please open an issue rather
than maintaining a parallel translation.

---

## ✅📋 Adding a new document

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
   `file:line` in tables).

---

## 🛠 Maintenance

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
