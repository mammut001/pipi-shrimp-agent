# AutoResearch Runtime

What "Start AutoResearch" actually does, end to end. This document
covers the two bootstrap paths, the local-vs-SSH execution model, the
folder and connection-test requirements, the run lifecycle, and the
distinction between **hard runtime settings** and **prompt-only
instructions**.

> Read [`folders-and-runs.md`](./folders-and-runs.md) first for the
> folder terminology, and [`execution-modes.md`](./execution-modes.md)
> for the chat-mode layer the bootstrap drops the user into.

---

## 1. Two bootstrap paths

The UI exposes two distinct entry points into AutoResearch. They share
the loop engine but the *setup UI* and the *handoff to the loop* are
different. The session row records which path was used via
`bootstrapKind`.

### 1a. Guided (conversational) bootstrap

The user walks through a multi-step chat-driven questionnaire. Each
step accumulates into a `BootstrapPlan` (research goal, papers,
baselines, primary metric, scaffold, and a `conversationalTemplateId`
of `'reproduce-paper' | 'beat-baseline' | 'ablation' | 'from-scratch'`).

| Field | Value |
| --- | --- |
| Entry | The "AutoResearch" page → "Start guided" flow. The conversational template chooser card on `BootstrapChatView`. |
| Plan shape | `BootstrapPlan` in `src/services/autoresearch/bootstrap/types.ts` (Zod-validated by `BootstrapPlanSchema`) |
| Result | `AutoResearchBootstrapResult` (`status: 'ready' | 'needs_user_confirmation' | 'failed'`) — handed off as `BootstrapStartHandoff` to the loop engine |
| Session marker | `bootstrapKind: 'conversational'` (`src/store/autoresearchStore.ts`) |
| Owner module | `src/components/autoresearch/BootstrapChatView.tsx`, `src/components/autoresearch/recipe/RecipeTemplateChooser.tsx`, `src/services/autoresearch/bootstrap/` |
| Hard-enforced? | The plan is **schema-validated** before the loop accepts it (`BootstrapPlanSchema` in `bootstrap/schema.ts`). A plan that fails validation cannot start a run. |
| Tests that protect it | `src/services/autoresearch/bootstrap/__tests__/applyBootstrap.test.ts`, `src/services/autoresearch/bootstrap/__tests__/schema.test.ts`, `src/components/autoresearch/__tests__/BootstrapChatView.test.tsx` |

### 1b. Manual launch

The user fills in a structured form (Runtime target, AutoResearch
Workspace, Target Project, Metrics & Iterations, Environment Check)
and the loop starts from a flat `AutoResearchValidatedSetup`.

| Field | Value |
| --- | --- |
| Entry | The "Manual Launch AutoResearch" cockpit (`src/components/autoresearch/manual/ManualLaunchCockpit.tsx`) |
| Form shape | `AutoResearchSetupDraft` and `AutoResearchValidatedSetup` in `src/services/autoresearch/setupFlow.ts` |
| Section status | The six `RecipeSectionCard`s (Goal / References / Baseline / Workspace / Verification / Output) collapse when valid; the right-side `RecipeCockpitPanel` shows the readiness checklist and the "Start" button. |
| Session marker | `bootstrapKind: 'manual'` (set when the manual path is the active flow; the store initializes at `null` until the first iteration is started) |
| Owner module | `src/components/autoresearch/manual/ManualLaunchCockpit.tsx` and the section components under `manual/sections/` |
| Hard-enforced? | Required-field validation runs in `setupFlow.validateSetupDraft`; missing workspace / experiment dir / metric / SSH credentials block the start button. |
| Tests that protect it | `src/components/autoresearch/manual/__tests__/manualComponents.test.tsx`, `src/components/autoresearch/manual/__tests__/manualReadiness.test.ts`, `src/components/autoresearch/manual/__tests__/manualFormatting.test.ts` |

### Common mistakes

- Treating the conversational plan and the manual form as
  interchangeable: they produce different handoff objects
  (`BootstrapStartHandoff` vs `AutoResearchValidatedSetup`).
- Looking up the "kind" by asking the UI which flow rendered; the
  authoritative answer is `session.bootstrapKind` on the experiment
  row.
- Mixing the conversational plan's `scaffold.workDir` with the manual
  form's `experimentDir` — they live in different fields and are
  consumed by different layers.

---

## 2. Local vs SSH execution

`SshConfig.mode` is `'local' | 'ssh'`. The runtime treats them
differently; do not assume the SSH path is just a wrapper.

| Aspect | Local | SSH |
| --- | --- | --- |
| Where commands run | On the desktop host through Tauri (`@tauri-apps/plugin-shell` / Rust `execute_bash`) | On a remote Linux box via the SSH command the user pre-configured |
| `workDir` semantics | Used as the `execute_bash` `workDir` argument; the loop runs commands directly under it | Used as the *parent* of `runs/<sessionId>/`; commands run inside per-iteration worktrees under it |
| Windows | Requires a WSL shell profile (set in settings); raw commands get `$` escaped to `\$` to survive `wsl.exe -- bash -lc ...` | N/A — SSH is always Linux-side |
| Process-group semantics | Tauri Rust already cleans up local child processes | The loop wraps the user command in `set -e` + `trap 'kill -TERM -$$'` so that when Rust times out, the SSH child and any `python run_experiment.py` it spawned are also killed (see `runDir.ts`, AUDIT-FIX `audit-2-ar#5`) |
| Path handling | `normalizePathForComparison` rewrites `/mnt/<drive>/...` to `<Drive>:/...` for comparisons | Pure Linux paths; Windows-drive rewriting is a no-op |
| Tests that protect it | `src/services/autoresearch/__tests__/runDir.test.ts` (local branch), `src/services/autoresearch/__tests__/preflight.test.ts` (local env check) | `src/services/autoresearch/__tests__/runDir.test.ts` (SSH branch + process-group trap), `src/services/autoresearch/__tests__/preflight.test.ts` (remote env check) |

> **Statement.** The runtime never silently switches between local and
> SSH. The `SshConfig.mode` field is sticky for the session.

---

## 3. AutoResearch Workspace

See [`folders-and-runs.md` §4](./folders-and-runs.md#4-autoresearch-workspace).
**It is not the chat Project Folder** — the chat Project Folder holds
the user's repo, the AutoResearch Workspace holds the per-iteration run
dirs and the "best baseline" snapshot. The `autoresearch.manual.workspace`
helper text is:

> "AutoResearch will create run files, logs, and temporary experiment
> directories here."

That text is **descriptive, not a permission grant** — the loop will
*always* create run dirs under it; the helper text exists to warn the
user that the folder will fill up over many iterations.

---

## 4. Target Project / Experiment Dir

See [`folders-and-runs.md` §5](./folders-and-runs.md#5-target-project--experiment-dir).
Preflight checks that this directory:

1. Exists (`test -d $experimentDir` in the connection probe).
2. Contains the required scaffold files: `run_experiment.py` and
   `AUTORESEARCH.md` (`REQUIRED_EXPERIMENT_FILES` in `preflight.ts`).
3. Is a git repository, or accepts a snapshot copy if not
   (`runDir.createRunDir` falls back to `tar` if `git worktree add`
   fails).

The user-visible helper text (`autoresearch.manual.targetProjectHelper`):
"AutoResearch will run verification and improvements on this project
or experiment directory."

---

## 5. Connection test requirement

The manual launch flow requires a successful connection test before
the Start button enables. The conversational path has the same gate
but it runs inline as part of the preflight.

| Status | i18n key | Meaning |
| --- | --- | --- |
| `idle` | (initial) | Not yet tested |
| `testing` | `autoresearch.connectionTesting` | The connection probe is running |
| `success` | `autoresearch.connectionStatusSuccessTitle` | The probe printed `__AUTORESEARCH_TARGET_OK__` and `git:ok` |
| `error` | `autoresearch.connectionStatusErrorTitle` | The probe failed; the Start button is disabled |

Source: `AutoResearchConnectionTestStatus` in `setupFlow.ts` and
`buildAutoResearchConnectionProbeCommand` in `connectionProbe.ts`.

> **Statement.** A successful connection test is required before
> `Start AutoResearch` enables. Do not let the loop start on
> `testing` or `error`.

---

## 6. Run lifecycle

The session row carries two related but distinct lifecycles:

### 6a. `AutoResearchRunStatus` (per-run, in `runHistory`)

Defined in `src/services/autoresearch/history.ts`:

| State | Source-of-truth meaning |
| --- | --- |
| `draft` | Run record was created, no iteration has been started yet |
| `running` | Loop engine is actively running iterations |
| `waiting_rate_limit` | Provider reported a rate-limit; loop is backing off |
| `reflection_failed` | Reflection parsing failed for the latest iteration |
| `stopped` | User pressed Stop; loop has drained the in-flight iteration |
| `failed` | Loop hit a non-recoverable error (provider error, env error) |
| `completed` | Loop reached `maxIterations` or hit the success criteria |
| `interrupted` | Loop was interrupted (process killed, IDE reload); resumable via `resumeToken` |

`isAutoResearchTerminalState` is the canonical check for "this run is
done" — true for `reflection_failed`, `failed`, `completed`, `stopped`,
`interrupted`.

### 6b. `LoopState` (live UI state, on the active session)

`src/store/autoresearchStore.ts`:

| State | Meaning |
| --- | --- |
| `idle` | No active run; right-side cockpit shows "Start AutoResearch" |
| `running` | Loop is running iterations |
| `paused` | User paused between iterations; resumes from `currentIteration` |
| `stopped` | User stopped the loop; a new run can be started fresh |
| `error` | Loop hit a non-recoverable error; the right-side cockpit surfaces the error message |

### 6c. The 10-state aspirational lifecycle

The task description lists a finer-grained lifecycle (`configuring` →
`checking_environment` → `bootstrapping` → `bootstrap_ready` →
`starting_run` → `running` → `paused` → `stopped` → `failed` →
`completed`). The current code expresses those phases through the
combination of `bootstrapKind`, `LoopState`, and the individual
`AutoResearchRunStatus` rows, **not** as a single 10-state enum. The
`configuring` phase is implicit in `bootstrapKind` being `null`; the
`checking_environment` phase is implicit in the
`AutoResearchConnectionTestStatus` cycle (idle → testing → success/error);
`bootstrapping` / `bootstrap_ready` are the conversational plan being
applied (`applyBootstrap`); the rest maps 1:1 to `AutoResearchRunStatus`
and `LoopState`.

If you need a finer lifecycle in a new feature, prefer to derive it
from the existing fields rather than introduce a parallel enum.

---

## 7. Artifacts, living doc, result.json

For every iteration the loop writes under the run dir
(see [`folders-and-runs.md` §9](./folders-and-runs.md#9-artifacts)):

| File | Written by | Read by |
| --- | --- | --- |
| `transcript.md` | The agent (model) | Dashboard / run detail |
| `system_prompt.txt` | The loop, before the agent runs | Recovery / replay |
| `hypothesis.md` | The agent (model) | Reflection pass |
| `diff.patch` | The agent (model) | Dashboard |
| `metrics.json` | The experiment script (`run_experiment.py`) | `metricsStore.readAllMetrics` |
| `reflection.input.json` | The loop | Reflection pass |
| `reflection.raw.txt` | The agent (model) | Reflection parser |
| `reflection.parsed.json` | `metricsStore` + reflection parser | The next iteration's decision |
| `result.json` | The loop, on `running → completed` / `failed` / `stopped` | Run detail document |

Per-session (one file per session, not per iteration):

| File | Owner |
| --- | --- |
| `session.md` | The bootstrap handoff (initial config snapshot) |
| `autoresearch.md` | `livingDoc.ts` (the living doc, appended each iteration) |
| `metrics.jsonl` | The loop (one line per iteration) |
| `run_config.json` | `runConfig.ts` (the resolved config snapshot) |
| `bootstrap.plan.json` | The bootstrap flow sidecar |

---

## 8. Hard runtime settings vs prompt-only instructions

> **Hard rule.** A setting is "hard" only if the runtime layer enforces
> it (Rust backend, `preToolUseHooks`, a guard, a state machine). If
> the setting is just text in the system prompt or a UI label, the
> setting is "prompt-only" and the UI must say so.

| Setting | UI location | Runtime field | Hard enforced? | Prompt-only? | Tests |
| --- | --- | --- | --- | --- | --- |
| Execution mode (Ask/Plan/Debug/Agent/Bypass) | Chat composer dropdown | `session.executionMode` + `session.permissionMode` | ✅ | — | `src/services/executionMode/__tests__/modeConsistency.test.ts`, `src/store/chat/__tests__/chatToolExecution.test.ts` |
| Project Folder | Project Folder chip | `session.workDir` | ✅ (`chatActions` uses it as `execute_command.workDir`) | — | `src/store/__tests__/setSessionWorkDirFromPath.test.ts` |
| PiPi Output Folder | PiPi Output Folder chip | `session.pipiOutputDir` | ✅ (`init_pipi_shrimp` runs against it, plan-doc save resolves to it) | — | `src/store/__tests__/setSessionWorkDirFromPath.test.ts`, `src/services/prompt/__tests__/defaultTemplate.test.ts` |
| AutoResearch Workspace | Manual launch Workspace field | `SshConfig.remoteWorkDir` (parent of `runs/`) | ✅ (run dir created under it) | — | `src/services/autoresearch/__tests__/runDir.test.ts`, `src/components/autoresearch/manual/__tests__/manualReadiness.test.ts` |
| Target Project | Manual launch Target Project field | `AutoResearchPreflightInput.experimentDir` | ✅ (preflight checks `run_experiment.py` + `AUTORESEARCH.md` + git) | — | `src/services/autoresearch/__tests__/preflight.test.ts` |
| Max iterations | Manual launch Metrics & Iterations | `ExperimentSession.maxIterations` | ✅ (loop terminates at the boundary) | — | `src/services/autoresearch/__tests__/loopEngine.integration.test.ts` |
| Primary metric / direction | Manual launch Metrics | `recipe.baselineAndMetric.primaryMetric` / `direction` | ✅ (parsed by `metricsStore`) | — | `src/services/autoresearch/__tests__/metricsStore.test.ts` |
| Baseline (optional) | Manual launch Baseline | `AutoResearchValidatedSetup.baseline` | — | ✅ (it is the starting `bestMetric`; the loop just records the first value above it as "improved") | `src/components/autoresearch/manual/__tests__/manualComponents.test.tsx` |
| Verification commands | Recipe Verification section | `recipe.verification.commands` | — | ✅ (injected into the bootstrap prompt only; the loop does not auto-run them) | `src/services/autoresearch/__tests__/recipeReadiness.test.ts` (recipe shape) |
| Output contract flags | Recipe Output section | `recipe.outputContract.*` | — | ✅ (these shape the bootstrap prompt's final section) | `src/services/autoresearch/__tests__/recipeReadiness.test.ts` |
| References / Context Files | AutoResearch References card | `settingsStore.importedFiles` | ✅ for the chat layer (carried into `promptBuilder`); ⚠ partial for the AutoResearch loop (the loop *reads* the files when the agent decides to, but does not auto-attach them) | partial | `src/components/chatInput/blocks/__tests__/promptBuilder.test.ts` (chat) |
| Connection test result | Manual launch Environment Check | `AutoResearchConnectionTestStatus` | ✅ (Start button is disabled unless `success`) | — | `src/components/autoresearch/manual/__tests__/manualComponents.test.tsx` |
| Agent / reflection / default config id | Manual launch Advanced Fields | `autoResearchLlmSettings.{default,agent,reflection}ConfigId` | ✅ (`runConfig.resolveAutoResearchRunConfig` resolves them, agent config is asserted to support tool calls) | — | `src/services/autoresearch/__tests__/runConfig.test.ts` |
| Preferred Python command | (computed by preflight) | `environmentSummary.preferredPythonCommand` | ✅ (preflight auto-detects `python3` vs `python`) | — | `src/services/autoresearch/__tests__/preflight.test.ts` |
| Reflection prompt / strictness | (in `loopEngine` constants) | hard-coded in `reflection.ts` | — | ✅ (the reflection prompt is text the agent sees; the parser is hard, but the prompt is not) | `src/services/autoresearch/__tests__/reflection.test.ts` |
| Stop / pause action | Right-side cockpit | `LoopState` | ✅ (state machine in `loopEngine`) | — | `src/services/autoresearch/__tests__/loopEngine.integration.test.ts` |
| Resume token | Persisted on `interrupted` | `AutoResearchResumeToken` | ✅ (drives `ResumeAutoResearchRunResult`) | — | `src/services/autoresearch/__tests__/resumeToken.test.ts` |
| Telegram notification | AutoResearch panel | `TelegramNotifyConfig` | ✅ for the *send* side (it fires on `IMPROVED` / `FAILED`); — for the *throttling* side (interval is a hint, not a hard limit) | partial | `src/services/autoresearch/__tests__/notifier.test.ts` |

---

## 9. Common cross-cutting mistakes

- Writing the AutoResearch living doc into the Target Project. The
  living doc belongs under the AutoResearch Workspace, not the user's
  code.
- Reading the AutoResearch Workspace as a "chat workspace" and piping
  it into `chatActions.execute_command.workDir`. The two workspaces
  are independent.
- Forgetting that the conversational plan and the manual form are two
  different code paths that share the loop engine. The handoff objects
  are not interchangeable.
- Re-running `applyBootstrap` after iterations have started: that
  would overwrite `run_experiment.py` and clobber the agent's edits.
- Treating "Bypass" as "no safety". Bypass skips the user prompt but
  keeps the dangerous-command and path-escape `preToolUseHooks`.

---

## Cross-references

- Folder model: [`folders-and-runs.md`](./folders-and-runs.md).
- Mode and tool gating: [`execution-modes.md`](./execution-modes.md).
- Architecture governance: [`../architecture/complexity-governance.md`](../architecture/complexity-governance.md).
- AutoResearch audit history (anchored fixes): `../audits/auto-research.md`.
