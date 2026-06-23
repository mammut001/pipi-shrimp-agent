# Architecture Complexity Governance

This document sets the size and complexity thresholds for the PiPi
Shrimp Agent codebase, and the rules that follow from them. It is the
companion to `scripts/complexity-report.mjs` — that script enforces the
file-size axis; this document covers the other axes and the refactor
protocol.

> **Run the report first.**

```bash
npm run report:complexity
```

The report is generated from `git ls-files` (so it reflects what is
actually tracked, not the working tree), ignores `node_modules`,
`dist`, `target`, `build`, and `coverage`, and only counts `.ts`,
`.tsx`, `.js`, `.jsx`, and `.rs` files. It writes markdown to stdout
and never fails the process — the goal is for the report to be safe
to wire into CI later without breaking the build.

---

## 1. File size thresholds (canonical axis)

`scripts/complexity-report.mjs` measures every tracked file and tags
it with one of four risk levels. These are the thresholds the script
enforces.

| Risk level | Range | What it means | Action |
| --- | --- | --- | --- |
| `low` | `< 300` LOC | Healthy. No action. | — |
| `watch` | `300 – 500` LOC | Approaching the split threshold. | Add a refactor note in the next PR that touches the file. |
| `split soon` | `500 – 800` LOC | Past the safe limit. | Plan a split in the current milestone. Do not add new features on top. |
| `requires refactor plan` | `> 800` LOC | Past the hard limit. | Open a refactor plan issue. Block new feature work on this file until the plan lands. |

The "Files Requiring Refactor Plan (>800 LOC)" and "Files to Split
Soon (500-800 LOC)" sections of the report are the canonical
backlog for the next refactor pass.

> **Statement (must remain true):** No file should ship in the
> "refactor plan required" range for more than one release. New
> "refactor plan required" files are a regression.

---

## 2. Other size axes

The file-size axis is the one the report enforces automatically. The
other axes are enforced by code review.

| Metric | Safe | Watch | Refactor | Action |
| --- | --- | --- | --- | --- |
| **Component file** (`.tsx`) | `< 300` LOC | `300 – 500` LOC | `> 500` LOC | Component split: sub-views, form field blocks, and status displays must be extracted into their own files. The component file should only render layout and connect hooks. |
| **Custom hook** (`.ts` exported `useXxx`) | `< 150` LOC | `150 – 250` LOC | `> 250` LOC | Hook split: pure calculation functions, formatting, and API handlers move to `utils/` or `services/`. The hook keeps React state and reactivity loops. |
| **Pure helper / formatter** | unbounded by itself, but see the flow complexity row | — | — | If a helper holds its own state machine, the state machine should be its own file. |
| **Flow complexity** (boolean flags driving a single UI) | `<= 2` flags | `3` flags | `> 3` flags | State machine. See §4. |

The 500-LOC component threshold lines up with the 500-LOC file-size
"split soon" boundary. A component that hits 500 LOC is *also* in the
file-size "split soon" bucket, which is the right outcome — the
report will surface it.

---

## 3. Component split rules

When a React component file crosses 500 LOC:

- Sub-views and layout helpers move to their own files. Examples in
  this repo: `BootstrapRecipeBuilder` is a layout that imports
  `RecipeSectionCard` and the `recipe/sections/*` section
  components; `AdvancedWorkdirSetup` is a layout that delegates to
  `ManualLaunchCockpit` and small `manualFormatting` /
  `manualReadiness` helpers.
- Form field blocks, buttons, and status displays become standalone
  components. They are the things that change most often, and keeping
  them inline is what makes a 500+ LOC file hard to read.
- Pure formatters and readiness helpers move to a sibling
  `*Formatting.ts` / `*Readiness.ts` and are unit-tested in
  `__tests__/`. The component file should only render and connect.
- Re-exports that exist *only* to keep the old import path working
  are not an excuse to keep the file large; move the re-exports to
  the new module and update the import sites.

## 4. Hook split rules

When a custom hook crosses 250 LOC:

- Pure calculation, formatting, and API calling handlers move to
  helper files (`utils/`, `services/`, or a sibling
  `*Helpers.ts`). The hook keeps the React state and the reactivity
  loop.
- The pure helpers must be unit-tested independently of React
  (`@jest/globals` + `jsdom` is not required, plain `node` test env
  is fine).
- The hook file should fit on one screen (≈ 200 LOC) so a reviewer
  can see the reactivity model without scrolling.

## 5. Pure logic extraction rules

A function that does not depend on React hooks, DOM, or
`window`/`document` should live in a `.ts` library file (not
`.tsx`), and should be unit-tested directly.

This is the rule that lets a 500-LOC component shrink to 250 LOC:
the formatters and readiness checks are pulled into
`*Formatting.ts` and `*Readiness.ts` and tested with no React. The
component file becomes mostly JSX.

Examples in this repo:
- `src/components/autoresearch/recipe/recipeFormatting.ts` and
  `recipeReadiness.ts` — pure formatters and readiness checks used
  by `BootstrapRecipeBuilder`.
- `src/components/autoresearch/manual/manualFormatting.ts` and
  `manualReadiness.ts` — the same shape for `ManualLaunchCockpit`.
- `src/components/chatInput/blocks/promptBuilder.ts` — pure
  prompt-block compiler with no React import.

## 6. State machine recommendation

A flow that depends on more than three boolean flags is almost
always wrong. The classic example
`isStarted && !isTesting && isConfigured && hasTested` is a code
smell because no one can read it without enumerating the cases.

When a state lifecycle or UI transition relies on **more than 3
boolean flags**, refactor it to a discrete state type:

```ts
type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
```

and orchestrate transitions with `useReducer`, a small state
machine, or a `Set<Phase>` if the lifecycle is purely additive.
Examples in this repo:

- `LoopState` (`src/store/autoresearchStore.ts`) — `'idle' |
  'running' | 'paused' | 'stopped' | 'error'`.
- `AutoResearchConnectionTestStatus` (`src/services/autoresearch/setupFlow.ts`)
  — `'idle' | 'testing' | 'success' | 'error'`.
- `AutoResearchRunStatus` (`src/services/autoresearch/history.ts`) —
  the per-run lifecycle.

If you find yourself reaching for a fourth boolean to describe a
lifecycle that already has a state enum, the right fix is usually a
new state, not a new boolean.

---

## 7. PR size guidance

| Type | Recommended | Hard cap | Notes |
| --- | --- | --- | --- |
| Feature PR | `< 20` files changed, `< 800` net LOC | `30` files / `1500` LOC | Anything past the cap should split into a stack. |
| Refactor PR | `< 20` files, `< 800` net LOC | `30` files / `1500` LOC | A "mechanical rename" or "extract pure helpers" refactor can go higher, but must be flagged in the PR description. |
| Audit fix | per anchor | per anchor | One audit anchor = one PR, unless multiple anchors are co-located in the same file. |
| Dependency upgrade | unbounded | unbounded | Must be its own PR. Pin the lockfile and call out behaviour changes in the body. |

> **Statement (must remain true):** PRs should be small and focused.
> A PR that touches more than 20 files or adds more than 800 net LOC
> is a sign that the change should be split.

---

## 8. Required tests before extracting logic

You **must** have unit tests for the code you are about to move
*before* you move it. The minimum bar:

1. Pure helpers: at least one direct unit test per public function
   in the new file. (`@jest/globals` + `node` env is fine.)
2. Component helpers (`*Formatting`, `*Readiness`): at least one
   happy-path and one edge-case test per exported function. The
   companion component test should also assert the helper is wired
   up (`getRecipeReadiness`, `getManualReadiness`, etc.).
3. State machines: at least one test per transition. Forbidden
   transitions should be tested too.
4. Refactor extraction: snapshot the old test outcomes first, then
   run the same tests after the move. Zero test-result drift.

If a piece of code has no test and you are about to extract it,
*write the test first*, then extract. The refactor sequence is
always: **add test → extract → re-run tests → commit**, never
**extract → add test**.

---

## 9. Workflow

```bash
# 1. See the backlog.
npm run report:complexity

# 2. Pick a "refactor plan required" or "split soon" file. Open
#    (or update) an issue with the file path, a short rationale,
#    and a proposed split.

# 3. Write tests for the parts you are about to extract.
pnpm test src/path/to/file

# 4. Extract. Re-run the report and the tests.
npm run report:complexity
pnpm test src/path/to/file

# 5. Land the PR. The report should show one fewer "refactor plan
#    required" entry, or one fewer "split soon" entry, or a smaller
#    LOC count for the same file.
```

---

## Cross-references

- Folder model: [`../concepts/folders-and-runs.md`](../concepts/folders-and-runs.md).
- Mode and tool gating: [`../concepts/execution-modes.md`](../concepts/execution-modes.md).
- AutoResearch runtime: [`../concepts/autoresearch-runtime.md`](../concepts/autoresearch-runtime.md).
- The script that produces the report:
  `scripts/complexity-report.mjs`.
