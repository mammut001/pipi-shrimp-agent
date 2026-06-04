# AutoResearch Harness v1

The AutoResearch Harness v1 is the auditable execution layer for
`repo_self_improve` mode. It is modeled after Codex CLI's permission
profile / sandbox / event log patterns: the agent is constrained
*in code*, not just in prompts, and every run produces a self-contained
set of artifacts that can be replayed or audited.

This document covers architecture, layout, schemas, profiles, events,
the patch gate, and the headless runner.

---

## 1. Architecture

```
+--------------------+        +----------------------+
| UI / store         |        | Headless runner      |
| (loopEngine, store)|        | scripts/autoresearch-|
|                    |        |   exec.mjs           |
+----------+---------+        +-----------+----------+
           |                               |
           v                               v
+--------------------+        +----------------------+
| Self-improve v2    |        | Self-improve v2      |
| prompt + scoring   |        | in-script JS         |
+----------+---------+        +-----------+----------+
           |                               |
           +---------------+---------------+
                           v
                +----------------------+
                | Permission profile   |
                | + JSONL event log    |
                | + Patch gate         |
                +----------+-----------+
                           v
                +----------------------+
                | Tauri / execute_bash |
                | (write_file / etc)   |
                +----------------------+
```

The harness has three top-level concerns:

1. **Permission enforcement** — see `src/services/autoresearch/permissions.ts`.
   Profiles (`read_only`, `workspace_write`, `danger_full_access`) are
   checked *in code* before any shell command, file read, or file write.
2. **Event log** — see `src/services/autoresearch/jsonlEventLog.ts`.
   Every meaningful action emits a JSONL event with redaction.
3. **Patch gate** — see `src/services/autoresearch/patchGate.ts`.
   Diff, result.json, events.jsonl, verification logs, apply.md, and
   revert.md are written together. The harness never auto-applies the
   patch to the original repo.

For `repo_self_improve` mode the agent runs against an iteration
checkout (`<workdir>/runs/<sessionId>/iter-NNN-<ts>/code`) — a git
worktree of the original repo. The harness enforces that the iteration
code checkout is the only place the agent is allowed to write.

---

## 2. Permission Profiles

Three built-in profiles live in `PROFILE_CATALOG`:

| id                 | read roots           | write roots                                    | shell | writes | max files | max diff | max timeout |
|--------------------|----------------------|------------------------------------------------|--------|--------|-----------|----------|-------------|
| `read_only`        | `<workspace>`        | _(none)_                                       | no     | no     | 0         | 0        | 0s          |
| `workspace_write`  | `<workspace>`        | `<iter_code_dir>`, `<iter_run_dir>`, `<session_run_dir>` | yes    | yes    | 25        | 512 KB   | 600s        |
| `danger_full_access`| `<any>`             | `<any>`                                        | yes    | yes    | 1000      | ∞        | 1800s       |

In addition to the profile policies, the following are always denied
across all profiles:

- `rm -rf` style destructive deletes
- `mkfs`, `dd if=…`, `format`, `parted`, `fdisk`
- `chmod 777` (recursive or not)
- `sudo`, `su - root`
- `chown -R root`
- `curl … | bash` / `wget … | sh` pipes
- shell fork bombs

The forbidden read list covers `.git/config`, `.git/credentials`,
`.netrc`, `.npmrc`, `.pypirc`, `.ssh/id_*`, and `secrets/`,
`credentials/` directories.

The write-deny list covers `.git/config`, `.git/hooks/`, `LICENSE`,
`package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock` regardless of
the active profile.

The harness enforces these in `checkCommand`, `checkReadPath`,
`checkWritePath`, `checkChangedFiles`, and `checkDiffSize`.

---

## 3. Run directory layout

```
<workdir>/runs/<sessionId>/
  iter-001-<ts>/
    code/                 (git worktree; agent edits only here)
    logs/                 (per-command stdout/stderr)
    diff.patch            (unified diff vs baseline)
    result.json           (SelfImproveResult v2)
    events.jsonl          (JSONL event log)
    run.jsonl             (alias of events.jsonl written by the script)
    system_prompt.txt
    hypothesis.md
    metrics.json          (v1 fallback)
    reflection.*          (reflection artifacts)
    apply.md              (manual apply instructions)
    revert.md             (revert instructions)
  iter-002-<ts>/
    …
  session.md
  autoresearch.md         (living doc)
  metrics.jsonl
  run_config.json
```

Iteration directories use the `iter-NNN-<ts>` naming convention. The
timestamp is in `YYYY-MM-DDTHH-MM-SS-GMT` form (`:` replaced with `-`,
`Z` kept) so it sorts naturally.

---

## 4. Result schema v1/v2

### v1 (deprecated, still accepted)

```jsonc
{
  "schemaVersion": 1,
  "mode": "repo_self_improve",
  "iteration": 1,
  "phaseResults": { "AUDIT": { "phase": "AUDIT", "success": true } },
  "changedFiles": ["src/a.ts"],
  "commandsRun": ["pnpm test"],
  "buildPassed": true,
  "testsPassed": true,
  "typecheckPassed": true,
  "riskLevel": "low|medium|high",
  "status": "IMPROVED|NO_CHANGE|FAILED|NEEDS_REVIEW",
  "summary": "…",
  "nextRecommendation": "…"
}
```

### v2 (preferred)

Adds:

```jsonc
{
  "schemaVersion": 2,
  "issue": {
    "summary": "…",
    "evidence": ["exact error message"],
    "category": "build|test|typecheck|lint|security|performance|docs|refactor|bugfix|other",
    "severity": "info|minor|major|critical"
  },
  "patch": {
    "diffPath": "diff.patch",
    "addedLines": 0,
    "deletedLines": 0,
    "reverted": false
  },
  "verification": [
    { "command": "pnpm run build", "exitCode": 0, "durationMs": 1234, "status": "pass|fail|skipped|timeout", "stdoutPath": "logs/…", "stderrPath": "logs/…" }
  ],
  "workspace": { "dirtyBefore": false, "dirtyAfter": false },
  "decision": { "status": "…", "score": 0, "nextRecommendation": "…" }
}
```

`parseSelfImproveResultV2(text)` accepts both v1 and v2. v1 results
are normalized to v2 via `normalizeV1ToV2`. The UI should call v2
directly and fall back to v1 (`parseSelfImproveResult`) only if the
agent was very old.

---

## 5. JSONL event log

One file per iteration: `events.jsonl` (in the iter dir) and
`run.jsonl` (also written by the headless runner). Each line is a
single JSON object. Event types:

- `run.started`
- `run.completed`
- `run.failed`
- `preflight.completed`
- `iteration.started`
- `iteration.completed`
- `phase.started`
- `phase.completed`
- `tool.started`
- `tool.completed`
- `file_change.detected`
- `verification.started`
- `verification.completed`
- `patch.generated`
- `permission.denied`
- `guardrail.triggered`

Each event has `ts`, `runId`, `iteration`, `phase`, `type`, `status`,
and an optional `data` object. The logger redacts well-known API
key formats (`sk-…`, `sk-ant-…`, `ghp_…`, `AKIA…`, `Bearer …`),
private key blocks, and truncates long strings to 4 KB.

### Example

```jsonl
{"ts":"2026-06-03T12:00:00.000Z","runId":"sess-1","iteration":1,"phase":"INIT","type":"run.started","status":"ok","data":{"repo":"/srv/repo","workdir":"/srv/work","profile":"workspace_write","dryRun":true}}
{"ts":"2026-06-03T12:00:00.100Z","runId":"sess-1","iteration":1,"phase":"INIT","type":"preflight.completed","status":"ok","data":{"isGitRepo":true,"dirtyBefore":false,"baselineRef":"HEAD"}}
{"ts":"2026-06-03T12:00:00.500Z","runId":"sess-1","iteration":1,"phase":"VERIFY","type":"verification.started","status":"ok","data":{"command":"pnpm run build","timeoutSecs":600}}
{"ts":"2026-06-03T12:00:05.000Z","runId":"sess-1","iteration":1,"phase":"VERIFY","type":"verification.completed","status":"ok","data":{"command":"pnpm run build","exitCode":0,"durationMs":4500}}
```

---

## 6. Patch gate flow

For each self-improve iteration the harness writes:

1. `diff.patch` — unified diff of the iteration code checkout.
2. `result.json` — the v2 result artifact.
3. `events.jsonl` — the run event log.
4. `logs/verify-<slug>.{stdout,stderr}.log` — per-command output.
5. `apply.md` — manual apply instructions with a diff preview.
6. `revert.md` — instructions to revert (`git apply -R`).

**Default behavior: the patch is NOT auto-applied to the original
repository.** The user (or a future automation) must explicitly review
`apply.md` and run `git apply`. The `danger_full_access` profile is
*not* a way to bypass this — it only widens the in-code checks; the
patch gate is always gated.

If verification fails the result is still written (status `FAILED` or
`NEEDS_REVIEW`) so the failure is auditable, but `apply.md` makes it
clear the patch should not be applied.

---

## 7. How to run headless

```bash
# Sanity: dry-run a one-iteration cycle against any git repo
pnpm run autoresearch:exec -- \
  --repo /path/to/target --workdir /path/to/workdir \
  --dry-run --json --session-id smoke-1

# Real: actually run the verification commands (no agent attached yet)
pnpm run autoresearch:exec -- \
  --repo /path/to/target --workdir /path/to/workdir \
  --json --session-id real-1 \
  --verification "pnpm run build" "pnpm test" "node_modules/.bin/tsc --noEmit"

# Stricter profile
pnpm run autoresearch:exec -- \
  --repo /path/to/target --workdir /path/to/workdir \
  --permission-profile read_only --dry-run

# Non-git repos require explicit opt-in
pnpm run autoresearch:exec -- \
  --repo /path/to/dir --workdir /path/to/workdir \
  --allow-non-git --dry-run
```

Exit codes:

- `0` — run completed (regardless of iteration status)
- `2` — bad arguments
- `3` — non-git repo without `--allow-non-git`
- `4` — harness / system failure
- `5` — unexpected error (top-level catch)

Artifacts land under `<workdir>/runs/<sessionId>/iter-NNN-<ts>/`.

---

## 8. Safety guarantees

- The iteration code lives in a git worktree under `<workdir>/runs/<sessionId>/iter-NNN-<ts>/code`. The harness never edits the source repo.
- Reads are restricted to the workspace, plus any profile-allowed read roots.
- Writes are restricted to `<iter_code_dir>`, `<iter_run_dir>`, and `<session_run_dir>` for `workspace_write`; deny-list for `.git/config`, `LICENSE`, lock files is enforced regardless.
- Shell commands are filtered against a denylist of destructive patterns.
- Verification command timeouts are clamped to the profile limit.
- Diff size is bounded; changedFiles count is bounded.
- Events and result.json are redacted for API keys, bearer tokens, and private keys.

---

## 9. Known limitations (v1)

- The headless runner does not yet call the LLM agent. It exercises the
  harness layer (preflight, verification, scoring, patch gate). Wiring
  the agent call is the natural next phase.
- The Rust `execute_bash` blocklist in `src-tauri/` is *additive* — it
  is a defense-in-depth layer, not a substitute for the harness.
- The `danger_full_access` profile exists for trusted recovery flows
  only. It does not auto-apply patches.
- Verification logs are stored as plain text. They are redacted in the
  event log but the per-command files themselves are not.
- `iter-NNN-…` directory naming is timezone-agnostic (UTC). Two
  iterations created within the same second will collide. The runner
  adds a timestamp suffix; if you script your own runs, sleep a
  second between them.
- The harness writes a `run.jsonl` (canonical name used by the script)
  and a copy named `events.jsonl` (canonical name used by the UI).
  They are byte-identical.

---

## 10. Verification commands

| command                                | what it checks                                              |
|----------------------------------------|-------------------------------------------------------------|
| `pnpm test`                            | Jest unit + behavior tests                                  |
| `pnpm run build`                       | Vite build of the React app                                 |
| `pnpm run check:repo-hygiene`          | Repo hygiene check                                          |
| `pnpm run check:skill-sync`            | Skill / manifest sync                                       |
| `pnpm run smoke:autoresearch:local`    | Local smoke (requires Tauri toolchain / cargo)              |
| `pnpm run autoresearch:exec -- --dry-run --json …` | One-iteration harness smoke run (no LLM)          |

For a quick harness-only smoke:

```bash
mkdir -p /tmp/harness-smoke/{work,repo}
git init -q /tmp/harness-smoke/repo
echo hello > /tmp/harness-smoke/repo/README.md
git -C /tmp/harness-smoke/repo add . && git -C /tmp/harness-smoke/repo commit -q -m init

pnpm run autoresearch:exec -- \
  --repo /tmp/harness-smoke/repo --workdir /tmp/harness-smoke/work \
  --dry-run --json --session-id smoke-$(date +%s) \
  --verification "node -e \"console.log('ok')\""
```

---

## 11. v1.1 integration: UI ↔ headless

The v1.1 release connects the harness to the actual `repo_self_improve`
user flow. The loop engine reads v2 result artifacts and the React UI
exposes a patch-gate artifact viewer and a status card.

### How the loop engine reads v2

When `mode === 'repo_self_improve'`, the loop engine:

1. Reads `result.json` from `<workdir>/runs/<sessionId>/iter-NNN-<ts>/`.
2. Tries `parseSelfImproveResultV2` first (v2 + v1 auto-upgrade).
3. Falls back to `parseSelfImproveResult` (legacy v1).
4. Falls back to `parseSelfImproveAgentOutput` (parses agent's text).
5. Writes a synthesized v2 result to `result.json` if the agent only
   produced a v1-shaped payload, so the UI viewer always has a file
   to render.
6. Stores the v2 issue / patch / verification / workspace / decision
   fields in `parsedMetrics` (as both v1 and v2 field shapes), tagged
   with `sourceSchema: 1 | 2`.

The legacy `parsedMetrics.buildPassed` / `testsPassed` / `typecheckPassed`
fields are still populated, so the v1-aware UI does not break.

### How the UI surfaces artifacts

The right-hand detail panel (and the dashboard table row) now render two
new components when `parsedMetrics.selfImproveMode` is true:

- **Patch Gate Status Card** — `AutoResearchPatchGateStatusCard`
  Shows: changed files, +N added / -N deleted, per-check badges
  (build / tests / typecheck), verification command count + failure
  count, dirtyBefore / dirtyAfter, risk level, decision.status / score,
  and the v1/v2 source badge. Prefers v2 fields; falls back to v1.
- **Patch Gate Artifacts** — `AutoResearchPatchGateArtifacts`
  Renders a button grid for `result.json`, `diff.patch`,
  `events.jsonl` / `run.jsonl`, `apply.md`, `revert.md`, and
  the `logs/` folder. Clicking an artifact delegates to
  `openFileExternal` (or a host-provided handler) — **the harness
  does not auto-apply the patch**.

### Headless smoke (v1.1)

```bash
# 1. Create a small fixture repo
rm -rf /tmp/smoke-v1-1 && mkdir -p /tmp/smoke-v1-1/{repo,work}
cd /tmp/smoke-v1-1/repo
git init -q && git config user.email t@t && git config user.name t
echo "console.log('hello')" > app.js
git add . && git commit -qm init

# 2. Run one iteration headless (no LLM attached yet, no auto-apply)
pnpm run autoresearch:exec -- \
  --repo /tmp/smoke-v1-1/repo \
  --workdir /tmp/smoke-v1-1/work \
  --dry-run --json --session-id smoke-ui-v1
# → prints JSON with runDir + result.schemaVersion=2

# 3. Inspect the artifacts
ls /tmp/smoke-v1-1/work/runs/smoke-ui-v1/iter-*/
# apply.md  diff.patch  events.jsonl  result.json  revert.md  run.jsonl  logs/

# 4. Read the patch gate report
cat /tmp/smoke-v1-1/work/runs/smoke-ui-v1/iter-*/apply.md
# → "Patch Gate — Apply Instructions" with diff preview

# 5. Verify the JSONL event log
head -3 /tmp/smoke-v1-1/work/runs/smoke-ui-v1/iter-*/events.jsonl
# → run.started, preflight.completed, verification.started, ...

# 6. Run the parity test to confirm UI and headless are in sync
pnpm test -- src/services/autoresearch/__tests__/uiHeadlessParity.test.ts
# → 8 tests pass: standard verification commands, profile ids, v2
#   parsing, artifact paths
```

### Inspecting artifacts in the UI

After a self-improve iteration (UI loop or headless runner):

1. Open AutoResearch → select a run → pick an iteration.
2. The right-hand detail panel shows the **Patch Gate Status Card**:
   `v2` / `v1` badge, status pill, risk pill, issue summary,
   patch line counts, verification badges, workspace state, decision.
3. Below it the **Patch Gate Artifacts** grid lists the run's
   artifact paths as buttons. Click `result.json` to open it,
   `diff.patch` to inspect, `apply.md` for instructions, `logs/`
   to view the folder.
4. The **default behavior is read-only** — the patch is never
   auto-applied. The artifacts are *evidence*, not actions.

### How to manually apply / discard a patch

When the status card says `IMPROVED` or `NO_CHANGE` and you trust
the diff, the standard flow is:

```bash
# 1. Inspect the diff
less /tmp/.../iter-001-.../diff.patch

# 2. Read the apply instructions
cat /tmp/.../iter-001-.../apply.md

# 3. Dry-run apply (catches conflicts without touching the tree)
cd /path/to/original/repo
git apply --check /tmp/.../iter-001-.../diff.patch

# 4. Real apply
git apply /tmp/.../iter-001-.../diff.patch

# 5. Revert if needed
git apply -R /tmp/.../iter-001-.../diff.patch
# or, if the patch was already committed:
git restore --source=HEAD~1 <path>
# or:
git revert <commit-sha>
```

To **discard** a patch: do nothing. The original repo is never
modified by the harness. The diff sits in the iter dir until you
prune it (see `pruneOldRuns` in `src/services/autoresearch/runDir.ts`).

### What is still NOT supported (v1.1)

- **No auto-apply.** Apply flow is manual. The UI has buttons to
  *open* artifacts but no button to *apply* them. This is intentional.
- **No PR creation.** No remote push, no branch, no draft PR.
- **The headless runner does not yet call the LLM agent.** It
  exercises the harness layer (preflight, verification, scoring,
  patch gate). A future version will wire `createAutoResearchSendMessage`
  in to perform a real audit/plan/patch cycle.
- **ML Experiment mode is unchanged.** The v1.1 work only touched
  the self-improve path.
- **Loop engine still emits the legacy `metrics.json` and
  `status.json` artifacts.** Those are kept for the ML path and
  for the existing store-driven UI surfaces.

### Parity tests

`src/services/autoresearch/__tests__/uiHeadlessParity.test.ts` pins
five invariants between the UI and the headless runner:

1. `VERIFICATION_PRESETS['standard']` matches the script's
   `STANDARD_VERIFICATION` constant.
2. The set of permission profile ids is identical (3 ids in
   the same order).
3. Field-level constraints (maxChangedFiles, maxDiffBytes, etc.)
   are identical for every profile.
4. v2 result parsing produces a v2 object for both script-emitted
   artifacts and legacy v1 agent output.
5. The patch gate artifact paths the script writes are exactly
   the paths the UI's `derivePatchGateArtifactEntries` recognizes.

If any of these drift, the test fails.

