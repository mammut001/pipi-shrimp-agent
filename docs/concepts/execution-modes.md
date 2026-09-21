# Execution Modes

PiPi Shrimp exposes exactly three product-facing execution modes: **Ask**, **Plan**, and **Danger**.
The registry in `src/services/executionMode/registry.ts` is the source of truth for the dropdown, prompt harness, model-facing tool catalog, and the compatibility mapping used while old sessions are migrated.

Historical ids **Debug**, **Agent**, and **Bypass** remain accepted only as load-time aliases (see [Historical mode migration](#historical-mode-migration)). They are not rendered in the composer.

> Hard rule: UI copy, prompt harnesses, tool visibility, and approval behavior must describe the same capability. A prompt-only instruction is never a substitute for runtime enforcement.

## Defaults affordance (composer)

Fresh sessions **default to Ask**. The composer shows a compact status hint under the mode control (`getExecutionModeAffordance` / `ExecutionModeDropdown`):

- **Ask** — default · no tools — switch to Danger for shell/tools
- **Plan** — read-only tools · Danger needed for shell/writes
- **Danger** — tools/shell active · risky ops still confirm (not legacy Bypass auto-approve)

Selecting Danger still shows the warning dialog; approval gates for risky categories remain. See [`docs/danger-mode-defaults-affordance.md`](../danger-mode-defaults-affordance.md).

## Mode contract

| Mode | Purpose | Tool surface | Permission layer | Warning |
| --- | --- | --- | --- | --- |
| Ask | Q&A only | none | `plan-only` | no |
| Plan | read-only investigation and planning | `PLAN_MODE_ALLOWED_TOOLS` | `plan-only` | no |
| Danger | execute the task end-to-end | full catalog | `auto-edits` | yes |

Every active profile has a non-empty `systemPromptSuffix`. Those suffixes are deliberately called **harnesses** because they define the behavior expected for the whole turn, while the tool guards below enforce the hard limits.

## Ask harness

Ask is chat-only.

- The model-facing tool catalog is empty.
- `isToolAllowedForMode('ask', ...)` returns false for every tool.
- The harness tells the model not to emit tool-call syntax or pretend that it inspected files.
- If the request needs repository, browser, or shell access, Ask should recommend Plan for read-only inspection or Danger for execution.

**Invariant:** Ask cannot run tools.

## Plan harness

Plan is read-only investigation plus a decision-ready plan.

- Allowed tools come from `PLAN_MODE_ALLOWED_TOOLS`.
- Writes, edits, shell, browser mutation, SSH, MCP, agent spawn, and `save_plan_doc` are blocked.
- Plan-document persistence remains an app-side post-turn action.
- Before proposing deletion/replacement, the harness requires checking references, dependents, persisted-data compatibility, migration, and rollback needs.

**Invariant:** Plan may inspect; it may not mutate state.

## Danger harness

Danger is the single tool-capable execution mode exposed to users.

- The model-facing catalog is unfiltered (`allowedToolPolicy: full`).
- The permission layer is `auto-edits`, **not** legacy `bypass`, so risky categories continue through the existing approval gates.
- Dangerous-command and path-validation hooks still run.
- The harness requires a destructive-operation double-check: identify exact targets, inspect references/dependents and persisted-data compatibility, then re-check requested scope immediately before delete/overwrite/reset/migration operations.
- Reversible changes are preferred when they satisfy the request.
- After mutation, the resulting state must be verified.

**Invariant:** Danger grants capability, not permission to skip repository protections, safety hooks, user scope, or external authorization boundaries.

## Historical mode migration

Old persisted ids remain accepted only as compatibility aliases; they are not rendered in the product UI.

| Historical value | Active mode | Reason |
| --- | --- | --- |
| `debug` | Plan | conservative: do not silently escalate a stored session |
| `agent` | Plan | conservative: do not silently escalate a stored session |
| `bypass` | Danger | it was already the explicit high-risk selection |

Rows that predate `executionMode` use the same conservative rule:

- `plan-only` -> Plan
- `standard` / `auto-edits` -> Plan
- `bypass` -> Danger
- unknown/corrupt values -> Ask

If an explicit `executionMode` is present but invalid, it collapses to Ask even if a stale `permissionMode` is more powerful. This prevents corrupt data from becoming an escalation path.

The next save persists the active three-mode id and its derived permission mode in lockstep.

### Non-UI consumers that still pass `bypass`

Product chat never selects Bypass. Some automated runners still pass the
legacy `execution_mode` / `permissionMode` string `bypass` on purpose:

- AutoResearch agent turns (`chatAdapter` → `runHeadlessAgentTurn`) use
  `executionMode: 'bypass'` so the Rust `execution_policy` can auto-allow
  ordinary project-scoped commands for `AutoresearchPhase` without a
  confirmation modal.
- That shortcut **does not** skip dangerous-command / path-escape hooks,
  and AutoresearchPhase **still rejects** network/package-install commands
  even under bypass (R2-08).

Do not confuse that internal runner flag with a user-facing Bypass mode.

## Enforcement layers

The harness is only one layer. Runtime behavior must remain aligned across:

### TypeScript (chat composer → tool batch)

1. `src/services/executionMode/registry.ts` — three active profiles + legacy aliases.
2. `src/services/executionMode/guards.ts` — active-mode normalization and tool visibility (`isToolAllowedForMode`, `getAllowedToolsForMode`).
3. `src/services/tools/preToolUseHooks.ts` — dangerous-command, path, browser, and permission checks.
4. `src/store/chat/chatActions.ts` — prompt harness attachment and request-time tool catalog.
5. `src/services/tools/toolExecutionPolicy.ts` — per-tool approval rules; routes registry tools through `execute_single_tool` / `execute_tool_batch`.

### Rust (hard gate after R2-01)

6. `src-tauri/src/tools/registry.rs` + `execute_single_tool` / `execute_tool_batch` — canonical execution path for registry-backed tools.
7. `src-tauri/src/tools/execution_policy.rs` — `preview_request_policy` / `enforce_request_policy` (workspace bind, source policy, network/long-running, SSH, MCP, browser mutation, approval tokens).
8. `src-tauri/src/commands/legacy_execute_tool.rs` — **rejects** registry-backed tools on the deprecated `execute_tool` Tauri command (`LEGACY_EXECUTE_TOOL_DISABLED_MSG`). Remaining chat-only tools (browser / Typst / Skill) still call `enforce_request_policy`; there is no “legacy bypass” of policy.

### Browser observe-only (orthogonal to Ask/Plan/Danger)

`PIPI_BROWSER_ACTION_PERMISSION_MODE=observe_only` is a browser-agent flag
(R3-02), not a chat execution mode. When set, mutating browser actions are
blocked before approval; read-only observation actions remain allowed.

Tests in `src/services/executionMode/__tests__/registry.test.ts`,
`modeConsistency.test.ts`, chat/tool-policy suites, and
`cargo test legacy_execute_tool` (T-18) must be updated whenever those
layers change.

## AutoResearch

AutoResearch has its own runtime loop. Its structured Recipe remains the bootstrap source of truth. The old advanced Prompt-block editor has been removed from the AutoResearch launch surface, but persisted recipe/schema fields were intentionally not deleted in the same change.

That separation is deliberate: removing a redundant UI path must not make old saved data unreadable.

See also [`autoresearch-runtime.md`](./autoresearch-runtime.md) for abort/stop/pause wiring and the intentional `bypass` runner flag above.

## Skill runtime

Skills are `SKILL.md` packages loaded by the Tauri `execute_skill` command. The Skills page must display real runtime content rather than a shadow React catalog. A concrete task is appended to the loaded skill instructions and then executed through a normal chat session, where the selected execution-mode harness and tool approval policies apply.

The Skills UI intentionally exposes no delete/write API for skill packages in this migration.
