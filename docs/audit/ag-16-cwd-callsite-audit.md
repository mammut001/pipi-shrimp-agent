# AG-16 — Two-folder vs three-folder cwd call-site audit

**Date:** 2026-09-21 (America/Toronto)\
**Base:** `main` @ `1b26fb2`\
**Scope:** `src/store/createChatStore.ts`, `src/store/chat/chatActions.ts`, `src/services/autoresearch/`

Canonical model: [`docs/concepts/folders-and-runs.md`](../concepts/folders-and-runs.md).

## Folder map (quick)

| Layer | Folder | Field(s) | Tool `cwd`? |
| --- | --- | --- | --- |
| Chat two-folder | Project Folder | `session.projectDir` (legacy mirror `workDir`) | **Yes** — only chat tool cwd |
| Chat two-folder | PiPi Output Folder | `session.pipiOutputDir` | **No** — outputs/docs/memory only |
| AutoResearch three-folder | AutoResearch Workspace | `SshConfig.remoteWorkDir` / loop `workDir` | Yes — AR `execute_bash` parent |
| AutoResearch three-folder | Target Project | `experimentDir` | Snapshot source; live edits go to run worktrees |
| AutoResearch three-folder | Run Dir | `runs/<sessionId>/iter-…` | Yes — per-iteration cwd |

## Findings

### Fixed in this PR

1. **`chatActions` browser-result handoff used `session.workDir` alone**
   (`sendBrowserResultFollowUp` path). The main send path and
   `chatToolExecution` already resolve Project Folder via
   `getSessionProjectDir` (`projectDir ?? workDir`). Reading `workDir`
   alone can skip an explicit `projectDir` if the fields ever diverge.
   **Fix:** use `resolveSessionProjectDir(currentSession)` on the browser
   handoff path (and the main send path for consistency).

### Audit clean (no code change)

| Call site | Verdict |
| --- | --- |
| `ensureSessionWorkDir` in `createChatStore.ts` | Name is legacy, but body provisions **`pipiOutputDir`** only; Project Folder untouched. Documented in-file. |
| `bindSessionWorkDirPath` | `init_pipi_shrimp` / `core.md` write target PiPi Output; bind writes `projectDir`+`workDir` mirror. |
| `chatToolExecution.resolveWorkspaceToolPreflight` | Rejects `ensureResult === pipiOutputDir` and nulls workDir when equal to pipi — prevents PiPi-as-tool-cwd. Covered by existing tests. |
| `chatActions` plan-doc / memory / `get_next_output_dir` | Correctly pass `sessionPipiOutputDir` into output/memory invokes, not Project Folder. |
| AutoResearch `loopEngine` / `chatAdapter` `workDir` | AutoResearch Workspace / iterDir — independent of chat `session.workDir` / `pipiOutputDir`. |
| AutoResearch `experimentDir` | Target Project; path rewrite keeps tool args off the live experiment tree when worktrees exist. |
| `headless/systemPrompt.ts` `workDir: pipiOutputDir` on `read_file` | Intentional — reading `core.md` from the output root, not setting chat tool cwd. |

## Tests

- Extended `src/store/__tests__/setSessionWorkDirFromPath.test.ts` — asserts
  `projectDir` / `pipiOutputDir` separation and `init_pipi_shrimp` args.
- Existing: `chatToolExecution.test.ts` two-folder preflight + Project Folder
  cwd suites; `defaultTemplate.test.ts` PiPi Output section.

## Left open (non-bugs)

- Rename `ensureSessionWorkDir` → `ensureSessionPipiOutputDir` (API churn;
  prefer a follow-up AG / rename PR).
- Composer / i18n copy that still says “workspace” for Project Folder is
  editorial, not a cwd miswire.
