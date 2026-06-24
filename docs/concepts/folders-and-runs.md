# Folders and Runs

A single source of truth for every folder-shaped path the app talks about.
Read this before changing the bootstrap UI, AutoResearch wiring, or any
code that names a "workspace", "output dir", or "run".

> The whole app follows a two-folder model at the chat layer
> (`Project Folder` + `PiPi Output Folder`) and a three-folder model at the
> AutoResearch layer (`AutoResearch Workspace` + `Target Project` + `Run
> Dir`). Mixing them is the most common source of bug reports in this
> codebase.

---

## 1. Project Folder

The user's repository, the one they want help with.

| Field | Value |
| --- | --- |
| User-facing name | "Project Folder" (en-US `chat.projectFolder`, zh-CN 对应翻译) |
| Internal fields | `session.workDir` on the chat session; `promptBuilder.PromptContext.projectFolder`; `chatActions.cwd` for tool execution |
| Owner module | `src/store/createChatStore.ts` (`bindSessionProjectDir`), `src/components/chatInput/SessionFolderChip.tsx` (`kind: 'project'`) |
| Read by | `chatActions` (tool cwd), `promptBuilder` (rendered into the `## CONTEXT` block as **Project Folder (Source/Code/CWD)**), `systemPrompt` (default `workDir` when there is no PiPi Output Folder), `FileDropOverlay` ("Set parent folder as workspace?" toast) |
| Written by | The user (folder picker / drop toast). The app **never** writes source files, generated docs, or memory into it. |
| Can be tool `cwd`? | **Yes — this is the only folder the normal chat tool `cwd` may come from.** |
| App may write outputs there? | **No.** Generated docs, memory, and chat outputs must go to the PiPi Output Folder instead. |
| Default / fallback | Empty until the user binds a folder. The `FileDropOverlay` toast offers to bind the parent of a dropped file. |
| Common mistakes | (1) Treating the PiPi Output Folder as the Project Folder when piping cwd into `execute_command`. (2) Writing app-owned state into the Project Folder on the assumption that the user will be "fine with it". |
| Related tests | `src/store/__tests__/setSessionWorkDirFromPath.test.ts` (asserts the Project Folder bind runs `db_save_session` *after* the PiPi Output Folder init — see the test header comment for the two-folder model). `src/services/prompt/__tests__/defaultTemplate.test.ts` "defaultTemplate PiPi Output Folder section" — asserts docs land in the PiPi Output Folder, **not** the Project Folder. |

---

## 2. PiPi Output Folder

The app-owned output root. The agent writes its generated docs, memory
files, plan documents, and AutoResearch artifacts here, never in the
user's repo.

| Field | Value |
| --- | --- |
| User-facing name | "PiPi Output Folder" (en-US `chat.pipiOutputFolder`) |
| Internal fields | `session.pipiOutputDir`; `promptBuilder.PromptContext.pipiOutputDir`; `get_app_default_dir` (Rust side, default location resolution) |
| Owner module | `src/store/createChatStore.ts` (auto-provisioned via `bindSessionWorkDirPath` + `init_pipi_shrimp`); `src/components/chatInput/SessionFolderChip.tsx` (`kind: 'output'`); `src/services/headless/systemPrompt.ts` (`pipiOutputDir` input) |
| Read by | `systemPrompt.ts` (two-folder model: `core.md` lives here, not in `workDir`), `chatActions` (plan-doc save via `resolveRealSessionPipiOutputDir`), `promptBuilder` (rendered as **PiPi Output Folder (Outputs/Artifacts/Docs)**), AutoResearch store (`autoresearch.experimentDirHelper` uses this language) |
| Written by | The app. The `init_pipi_shrimp` Rust command auto-provisions a default under the user's home; the session row's `pipiOutputDir` is set as part of the bind flow. The user can rebind it through the output chip. |
| Can be tool `cwd`? | **No.** It is documented in the prompt as the place for *outputs*, never as the place to `cd` into. `chatActions` does not route `execute_command` `workDir` from `pipiOutputDir`. |
| App may write outputs there? | **Yes — this is its only purpose.** Generated docs, memory JSONL, plan-doc YAML, and AutoResearch artifacts must land here. Session memory commands fail closed when an explicit `work_dir` is outside writable roots (R2-03). |
| Default / fallback | `get_app_default_dir` (Rust); session bootstrap auto-creates the folder on first project bind. |
| Common mistakes | (1) Reading the PiPi Output Folder as if it were a tool cwd. (2) Putting a "preview" the model needs to read back into the Project Folder instead. (3) Assuming the PiPi Output Folder is empty by default — it is created lazily and may already contain memory from a previous session. |
| Related tests | `src/store/__tests__/setSessionWorkDirFromPath.test.ts` (asserts `init_pipi_shrimp` runs against the PiPi Output Folder, not the Project Folder). `src/services/prompt/__tests__/defaultTemplate.test.ts` — see "defaultTemplate PiPi Output Folder section". Artifact detection accepts generated outputs under the PiPi Output Folder (`outputDir`) and project artifacts under the Project Folder (`workDir`); paths outside both roots are rejected. |

---

## 3. Context Files

User-attached reference files (PDFs, papers, code snippets) the model
should consult. **They do not change the Project Folder.**

| Field | Value |
| --- | --- |
| User-facing name | "References" (AutoResearch) / "Attached files" (chat composer) |
| Internal fields | `settingsStore.importedFiles` (chat); `bootstrap/types.ts::PaperReference` (AutoResearch) |
| Owner module | `src/store/settingsStore.ts` (`importedFiles`, `addImportedFiles`, `removeImportedFile`); `src/components/chatInput/blocks/types.ts` (`ContextBlock.contextFiles`) |
| Read by | `promptBuilder.buildPromptFromBlocks` (renders `- **Context Files (References): ...`**); `bootstrapRecipePrompt.buildBootstrapPromptFromRecipe` (renders the `## References` block); `bootstrap/schema.ts` Zod validator |
| Written by | The user, via file picker or drag-drop. The app never modifies their contents. |
| Can be tool `cwd`? | **No.** Context files are a *reading* side channel only. They never set the Project Folder. |
| App may write outputs there? | **No.** The original files are user data. Generated artefacts that *cite* the references belong in the PiPi Output Folder. |
| Default / fallback | Empty. AutoResearch bootstrap marks the References section as `optional` in the readiness model — a missing reference list does not block start. |
| Common mistakes | Treating a reference file path as if it were the user's repo root. Implementing a feature that auto-derives `projectFolder` from the first attached file. |
| Related tests | `src/components/chatInput/blocks/__tests__/promptBuilder.test.ts` ("should handle context files correctly in ContextBlock"). `src/components/autoresearch/recipe/__tests__/recipeReadiness.test.ts` (asserts references is `optional`). |

---

## 4. AutoResearch Workspace

The working directory the AutoResearch loop creates per-iteration run
dirs, logs, and a "best baseline" snapshot under. It is *not* the user's
code, and it is *not* the chat Project Folder.

| Field | Value |
| --- | --- |
| User-facing name | "AutoResearch Workspace" (en-US `autoresearch.manual.workspace`) |
| Internal fields | `SshConfig.remoteWorkDir` (used as the parent of `runs/<sessionId>/`); `setupFlow.experimentDir` (manual launch path); `autoResearchLlmSettings` (default from `.env`: `~/autoresearch`) |
| Owner module | `src/services/autoresearch/runDir.ts` (`getSessionRunPaths`, `createRunDir`); `src/components/autoresearch/manual/ManualLaunchCockpit.tsx`; `src/services/autoresearch/setupFlow.ts` |
| Read by | `loopEngine` (every `execute_bash` for the run), `runDir.createRunDir` (snapshot source), `expLogger` (per-iteration log directory) |
| Written by | The app, extensively: per-iteration `iter-NNN-<timestamp>/` dirs, `best-baseline/` snapshots, `autoresearch.md` living doc, `metrics.jsonl`, `run_config.json`. The user can pre-create it but should not edit its contents. |
| Can be tool `cwd`? | **Yes** — `execute_bash` runs in the AutoResearch Workspace (or in a worktree under it). |
| App may write outputs there? | **Yes — by design.** This is the *write* root for AutoResearch. |
| Default / fallback | `~/autoresearch` on local; `cfg.remoteWorkDir` on SSH. Overridable per-launch; otherwise the saved last-used config or the shipped default. |
| Common mistakes | (1) Confusing it with the chat Project Folder. (2) Mounting the Target Project under it directly — see §5. (3) Pointing it at a path that the user does not own (the loop will try to `mkdir -p` and may fail). |
| Related tests | `src/services/autoresearch/runDir.ts` `createRunDir` integration paths; `src/components/autoresearch/manual/__tests__/manualReadiness.test.ts` (asserts workspace missing → `missing` status, not "completed"). |

---

## 5. Target Project / Experiment Dir

The actual project AutoResearch will improve or evaluate. It is the
project the user pastes `run_experiment.py` and `AUTORESEARCH.md` into.

| Field | Value |
| --- | --- |
| User-facing name | "Target Project Directory" (en-US `autoresearch.manual.targetProject`) — also called "Experiment Directory" in the field labels |
| Internal fields | `AutoResearchPreflightInput.experimentDir`; `ExperimentSession.experimentDir`; `AutoResearchPreflightResult.resolvedExperimentDir`; `bootstrapSchema.scaffold.workDir` |
| Owner module | `src/services/autoresearch/preflight.ts` (`REQUIRED_EXPERIMENT_FILES = ['run_experiment.py', 'AUTORESEARCH.md']`); `src/components/autoresearch/manual/sections/WorkspaceTargetSection.tsx`; `bootstrap/applyBootstrap.ts` (sets `scaffold.workDir`) |
| Read by | `loopEngine` (initial code copy), `preflight` (env check, `git rev-parse`), `runDir.createRunDir` (`snapshotSourceDir`), `connectionProbe` (`test -d <experimentDir>`) |
| Written by | The user (they own this directory). The app never edits it directly; it copies snapshots *out* of it into the AutoResearch Workspace. |
| Can be tool `cwd`? | **Yes, with care** — verification and improvement commands run in a per-iteration worktree that was originally snapshotted from the Target Project, not in the live Target Project. |
| App may write outputs there? | **No** (it is the user's code). Output artefacts belong in the AutoResearch Workspace and the PiPi Output Folder. |
| Default / fallback | `~/Documents/tiny-autoresearch-digits` in shipped builds; `AUTORESEARCH_DEFAULT_EXPERIMENT_DIR` from `.env` for local development. |
| Common mistakes | (1) Treating the Target Project as the AutoResearch Workspace and writing `autoresearch.md` into it. (2) Pointing the Target Project at the same path as the AutoResearch Workspace — this would mix the user's code with per-iteration snapshots and corrupt the next `git worktree add`. (3) Pointing it at a non-git directory and missing the `git:ok` line in the connection probe. |
| Related tests | `src/services/autoresearch/__tests__/preflight.test.ts` (asserts the required files are checked and `gitRepo` is recorded). `src/services/autoresearch/connectionProbe.ts` (`buildAutoResearchConnectionProbeCommand` — the test in `manualsConnecting.test` and the runbook expect a `git:ok` line). |

---

## 6. Scaffold Folder

The folder the bootstrap creates for a brand-new project that does not
yet have `run_experiment.py` / `AUTORESEARCH.md`. **It is generated
output, not necessarily the workspace root.**

| Field | Value |
| --- | --- |
| User-facing name | "Scaffold Folder Name" (Recipe card) / "Scaffold folder" in the manual launch UI |
| Internal fields | `bootstrapRecipePrompt.Recipe.workspace.folderName`; `bootstrap/types.ts::ScaffoldPlan.workDir` and `ScaffoldTemplateManifest`; the `vars.workDir` template var |
| Owner module | `src/components/autoresearch/bootstrapRecipePrompt.ts`; `src/components/autoresearch/recipe/sections/WorkspaceSection.tsx`; `src/services/autoresearch/bootstrap/` (ScaffoldPlan + apply) |
| Read by | `bootstrap/applyBootstrap.ts` (writes the scaffold files); `RecipeCockpitPanel` (collapsed summary) |
| Written by | The bootstrap flow — the app emits scaffold files (`run_experiment.py`, `AUTORESEARCH.md`, etc.) into this folder. |
| Can be tool `cwd`? | **Only if** the scaffold folder happens to also be the Target Project; in that case yes. Otherwise it is a one-shot output folder. |
| App may write outputs there? | **Yes — that is its purpose.** Subsequent iterations, however, do not write back into it; the per-iteration run dirs live under the AutoResearch Workspace. |
| Default / fallback | Recipe default is empty. The conversational template can suggest `bootstrap-project` or a user-supplied name. |
| Common mistakes | (1) Re-running the scaffold after iterations have started — that would overwrite `run_experiment.py` and clobber the user's edits. (2) Reading "Scaffold Folder" as "Workspace" — see §4. |
| Related tests | `src/components/autoresearch/recipe/__tests__/recipeReadiness.test.ts` (recipe workspace missing → `missing` section status, not `completed`). |

---

## 7. Run Dir

The per-iteration directory the loop creates inside the AutoResearch
Workspace. Contains the code snapshot, logs, transcript, hypothesis,
diff, metrics, and status for that one iteration.

| Field | Value |
| --- | --- |
| User-facing name | "Run dir" (internal; users see it as `iter-NNN-<timestamp>/` under their AutoResearch Workspace) |
| Internal fields | `RunDir` (`src/services/autoresearch/runDir.ts`) — `iterDir`, `codeDir`, `logsDir`, `transcriptPath`, `systemPromptPath`, `hypothesisPath`, `diffPath`, `metricsPath`, `statusPath`, `reflectionInputPath`, `reflectionRawPath`, `reflectionParsedPath` |
| Owner module | `src/services/autoresearch/runDir.ts` (`createRunDir`, `buildRunDir`, `listIterations`, `pruneOldRuns`) |
| Read by | `loopEngine` (every phase), `expLogger` (log stream), `metricsStore` (parses `metrics.json`), `reflection.ts` (writes & reads reflection files), `history.ts` (summary rows reference the run dir) |
| Written by | The app, every iteration. The user should not edit it. |
| Can be tool `cwd`? | **Yes** — `loopEngine` runs `execute_bash` with `workDir` derived from the current iteration's `codeDir` (the worktree). |
| App may write outputs there? | **Yes — exclusively** for that iteration's transcripts, hypotheses, diffs, and metrics. |
| Default / fallback | `path.join(remoteWorkDir, 'runs', sessionId, 'iter-NNN-<ISO timestamp>')`. Pruned by `pruneOldRuns` if the user requests a `keepLast` cap. |
| Common mistakes | (1) Forgetting that the `iterDir` lives *under* the session, not under `remoteWorkDir` directly — `getSessionRunPaths` returns `<remoteWorkDir>/runs/<sessionId>/...`. (2) Trying to `cd` into a deleted run dir after a `pruneOldRuns`. (3) Mixing up the run dir with the "best baseline" directory (they have different lifecycles). |
| Related tests | `src/services/autoresearch/__tests__/runDir.test.ts` (path layout, `assertSafeSessionId` rejection, snapshot fall-back). |

---

## 8. Living Doc

A long-lived markdown document the loop maintains under each session.
It records the bootstrap plan, hypotheses tried, dead-ends, and the
current best metric.

| Field | Value |
| --- | --- |
| User-facing name | "Living doc" (internal label, also referred to as the "session report") |
| Internal fields | `SessionRunPaths.livingDocPath` (`<sessionDir>/autoresearch.md`); `getAutoResearchLivingDocPathFromWorkDir` (legacy) |
| Owner module | `src/services/autoresearch/livingDoc.ts`; `src/services/autoresearch/runDir.ts::getSessionRunPaths` |
| Read by | The UI ("Living doc" tab in the AutoResearch panel); `loopEngine` (re-renders after each iteration); `recoverySummary.ts` (cites the latest section) |
| Written by | `livingDoc.ts` (`renderLivingDoc`, `appendLivingDocSection`). Writes are *appends* — sections grow as the run advances. |
| Can be tool `cwd`? | **No.** The living doc is a *file* (`autoresearch.md`), not a folder. |
| App may write outputs there? | **Yes — this is the canonical place** for the human-readable per-session narrative. Metrics JSONL and the bootstrap plan are co-located under the same session dir. |
| Default / fallback | Auto-created on first iteration: `<remoteWorkDir>/runs/<sessionId>/autoresearch.md`. |
| Common mistakes | (1) Putting the living doc inside the Target Project — it belongs in the AutoResearch Workspace so a session can outlive a cloned project. (2) Reading it as if it were the run-config snapshot — that one is `run_config.json` next to it. |
| Related tests | `src/services/autoresearch/__tests__/livingDoc.test.ts` (section order, dead-end grouping, "current best" rendering). |

---

## 9. Artifacts

Per-iteration outputs the loop creates: `metrics.json`, `diff.patch`,
`transcript.md`, `system_prompt.txt`, `hypothesis.md`, `reflection.*`.

| Field | Value |
| --- | --- |
| User-facing name | "Artifacts" (UI label) |
| Internal fields | `RunDir` paths enumerated in §7; `metricsStore.ts` (parses `metrics.json` into `IterationMetrics`); `result.json` (top-level summary, written by `loopEngine` on completion) |
| Owner module | `src/services/autoresearch/runDir.ts::buildRunDir`; `src/services/autoresearch/metricsStore.ts`; `src/services/autoresearch/loopEngine.ts` (writes `result.json`) |
| Read by | The dashboard, the run detail document, the per-iteration tables. The model also reads `metrics.json` and `reflection.parsed.json` to decide the next iteration. |
| Written by | The app, every iteration. `transcript.md` and `hypothesis.md` are written by the agent through `write_file`; `metrics.json` is written by the experiment script. |
| Can be tool `cwd`? | **No.** Artifacts are *files*, not a folder. The containing folder is the Run Dir (§7). |
| App may write outputs there? | **Yes — by design.** The agent should never write artifacts outside the Run Dir. |
| Default / fallback | All paths are derived from `RunDir`; no caller ever sets them manually. |
| Common mistakes | (1) Mixing the "artifact" word with the "PiPi Output Folder" — at the chat layer, "outputs" mean docs/memory/plan-doc; at AutoResearch, "artifacts" mean per-iteration files. (2) Reading `result.json` as a *test result*; it is the per-run summary the loop writes on completion or failure. |
| Related tests | `src/services/autoresearch/__tests__/metricsStore.test.ts`. `src/components/autoresearch/__tests__/AutoResearchDashboardTable.test.ts`. |

---

## Cross-references

- Two-folder model at the chat layer: `src/components/chatInput/SessionFolderChip.tsx` (file-level docstring).
- AutoResearch flow: [`autoresearch-runtime.md`](./autoresearch-runtime.md).
- Mode and tool gating: [`execution-modes.md`](./execution-modes.md).
- Architecture governance (thresholds for "refactor plan required"): [`../architecture/complexity-governance.md`](../architecture/complexity-governance.md).
