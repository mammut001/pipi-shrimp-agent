# Execution Modes

Single source of truth for the 5-mode composer dropdown. The dropdown
drives chat behavior, the model-facing tool catalog, and the approval
gates. Everything that affects what the model can see, call, or have
auto-approved must agree with the values recorded here.

> **Hard rule.** UI copy must not advertise a behavior that the
> underlying enforcement layer does not provide. If a setting is only a
> prompt-side instruction, the label must say so.

---

## Mode registry

Every mode is a `ExecutionModeProfile` (`src/services/executionMode/registry.ts`).
The registry is the single source of truth for:

| Field | What it drives |
| --- | --- |
| `permissionMode` | `preToolUseHooks` decision (`plan-only` / `auto-edits` / `bypass` / `standard`) |
| `allowedToolPolicy` | The outer "is this tool even visible to the model?" guard (`none` / `plan` / `read-only` / `edit` / `shell` / `full`) |
| `approvalPolicy` | `always-ask` / `ask-on-risky` / `auto-safe-only` / `auto-everything` |
| `requiresWarning` | Dropdown shows a one-time warning gate (Bypass only) |
| `isAdvanced` | Visual separator before the entry in the dropdown (Bypass only) |
| `systemPromptSuffix` | Extra instructions appended to the system prompt |

The hydration path (`hydrateSessionModes` in `guards.ts`) guarantees
that a session row's `executionMode` and `permissionMode` are always in
lockstep; `executionMode` is the source of truth and the legacy
`permissionMode` column is only consulted when `executionMode` is
absent (pre-v8 DB rows, Telegram mirror).

---

## 1. Ask

Chat-only mode. **No tools at all.**

| Field | Value |
| --- | --- |
| UI label | `executionMode.ask.label` (en-US "Ask a question") |
| `permissionMode` | `plan-only` (defensive — `preToolUseHooks` would block tools anyway, but the outer Ask guard also returns false) |
| `allowedToolPolicy` | `none` |
| Approval behavior | `always-ask` (irrelevant in practice — there are no tools to ask about) |
| Allowed tools | **None** (`isToolAllowedForProfile` returns `false` for any tool name; `getAllowedToolsForMode` returns `[]`) |
| Blocked tools | Everything, including `read_file`. The system prompt suffix says: *"No tools are available. Do not emit tool calls, XML tool tags, pseudo-tool syntax, or 'I'll inspect/read/list files' stubs."* |
| Hard-enforced? | **Yes** — `isToolAllowedForProfile` returns `false` for every tool under `allowedToolPolicy: 'none'`, the model-facing catalog returns `[]`, and `preToolUseHooks` would also block. The system-prompt suffix is *redundant* defence, not the only line. |
| Default? | **Yes** — `isDefault: true`. New chats start in Ask. |
| Runtime enforcement points | `src/services/executionMode/guards.ts::isToolAllowedForMode` (outer guard), `preToolUseHooks.executionModeGuardCheck` (hook layer), the Ask system-prompt suffix (redundant) |
| Tests that protect it | `src/services/executionMode/__tests__/modeConsistency.test.ts` (registry invariants + Ask default). `src/store/chat/__tests__/chatToolExecution.test.ts` "Ask mode blocks every tool via the outer preToolUseHook" (Ask + every tool name → blocked). `src/services/executionMode/__tests__/registry.test.ts` (Ask is the default). |

> **Statement (must remain true):** Ask cannot run tools.
> Do not relax this when adding new tools — Ask must stay tool-free.

---

## 2. Plan

Read-only inspection of the bound workspace. The model can read code
and search it. It cannot write, edit, run, browse, ssh, or call MCP.

| Field | Value |
| --- | --- |
| UI label | `executionMode.plan.label` (en-US "Make a plan") |
| `permissionMode` | `plan-only` |
| `allowedToolPolicy` | `plan` |
| Approval behavior | `always-ask` (irrelevant — the tool list is locked to read-only) |
| Allowed tools | **Exactly** `read_file`, `list_files`, `search_files` (see `PLAN_MODE_ALLOWED_TOOLS` in `src/services/planMode.ts`) |
| Blocked tools | `write_file`, `edit_file`, `execute_command`, `create_directory`, `delete_file`, `browser_*`, `ssh_*`, `mcp__*`, `agent_tool`, `save_plan_doc` (the last is not in the Rust registry at all) |
| Hard-enforced? | **Yes** — Plan mode is *triple-enforced*: (a) the model-facing `getAllowedToolsForMode` returns only the Plan allowlist, (b) `isToolAllowedForProfile` returns `false` for every other tool, (c) `preToolUseHooks` checks `permissionMode === 'plan-only'`. |
| Runtime enforcement points | `src/services/planMode.ts::PLAN_MODE_ALLOWED_TOOLS` (allowlist), `src/services/executionMode/guards.ts::isToolAllowedForProfile` (outer guard), `preToolUseHooks` (hook layer), `chatActions` plan-mode branch (request boundary), `resolvedChatRequest.allowedTools` normalisation |
| Tests that protect it | `src/services/executionMode/__tests__/modeConsistency.test.ts` (registry invariants). `src/services/executionMode/__tests__/registry.test.ts` (Plan profile). `src/store/chat/__tests__/chatToolExecution.test.ts` "Plan mode … allowedTools filtered to PLAN_MODE_ALLOWED_TOOLS" (write/exec/browser/ssh/MCP rejected). |

> **Statement (must remain true):** Plan only exposes
> `read_file` / `list_files` / `search_files`. The exact allowlist lives
> in `PLAN_MODE_ALLOWED_TOOLS` so the registry, the model-facing tool
> catalog, and `preToolUseHooks` stay in sync. Plan-document persistence
> is an **app-side post-turn action** in `chatActions.sendMessage`
> (`shouldSavePlanDoc` + `savePlanModeDoc`) — not a model-callable tool.
> Do not add a `save_plan_doc` Rust handler and do not add it to
> `PLAN_MODE_ALLOWED_TOOLS`.

---

## 3. Debug

Repro → diagnose → minimal fix → verify. Read + write/edit auto-approve;
shell/browser/MCP/SSH still confirm.

| Field | Value |
| --- | --- |
| UI label | `executionMode.debug.label` (en-US "Debug a bug") |
| `permissionMode` | `auto-edits` |
| `allowedToolPolicy` | `edit` |
| Approval behavior | `auto-safe-only` (Debug only auto-approves tools in the `AUTO_EDIT_SAFE_TOOLS` set; everything else asks) |
| Allowed tools | `read_file`, `list_files`, `path_exists`, `search_files`, `glob_search`, `grep_files`, `get_current_workspace`, `write_file`, `create_directory` |
| Blocked tools | `execute_command`, `run_in_terminal`, `bash`, `exec`, `shell`, `ssh_*`, `browser_*`, `mcp__*`, `agent_tool`, `delete_file`, `edit_file` |
| Hard-enforced? | **Yes** — write/edit auto-approve, but the outer guard's `edit` policy still rejects shell/browser/SSH regardless of `permissionMode`, and `canAutoApproveTool` for shell/SSH returns `false` even in Bypass. |
| Runtime enforcement points | `src/services/executionMode/guards.ts::isToolAllowedForProfile` (outer `edit` policy), `src/services/tools/toolExecutionPolicy.ts::canAutoApproveTool` (auto-approve gate for `auto-edits`), `preToolUseHooks` |
| Tests that protect it | `src/services/executionMode/__tests__/modeConsistency.test.ts` (registry invariants). `src/store/chat/__tests__/chatToolExecution.test.ts` (Debug can write_file but execute_command still asks). |

> **Statement (must remain true):** Debug auto-approves file edits but
> still asks for shell, browser, MCP, SSH, and `agent_tool`. Do not move
> those into `AUTO_EDIT_SAFE_TOOLS`.

---

## 4. Agent

The default autonomous workhorse. Read + write + shell auto-approve;
SSH / browser / MCP / `agent_tool` still confirm.

| Field | Value |
| --- | --- |
| UI label | `executionMode.agent.label` (en-US "Agent") |
| `permissionMode` | `auto-edits` |
| `allowedToolPolicy` | `shell` |
| Approval behavior | `ask-on-risky` (read/write/shell auto-approve, dangerous tools still confirm) |
| Allowed tools | `read_file`, `list_files`, `path_exists`, `search_files`, `glob_search`, `grep_files`, `get_current_workspace`, `write_file`, `create_directory`, `edit_file`, `delete_file`, `execute_command`, `run_in_terminal`, `bash`, `exec`, `shell` |
| Blocked tools | `ssh_*`, `browser_*`, `mcp__*`, `agent_tool` (the outer `shell` policy explicitly rejects these — they need explicit approval because the hard safety hooks cannot generically prove they are safe) |
| Hard-enforced? | **Yes** — the dangerous-command and path-escape `preToolUseHooks` still run on every `execute_command`, and shell/SSH paths outside the bound workspace are still rejected. Agent does not bypass the dangerous-command gate. |
| Runtime enforcement points | `src/services/executionMode/guards.ts::isToolAllowedForProfile` (outer `shell` policy), `preToolUseHooks` (dangerous command + path escape), `canAutoApproveTool` |
| Tests that protect it | `src/services/executionMode/__tests__/modeConsistency.test.ts`. `src/store/chat/__tests__/chatToolExecution.test.ts` "Agent mode: shell auto-approves, ssh still asks". `src/services/tools/__tests__/toolExecutionPolicy.test.ts` (auto-approve for high-risk tools returns false). |

> **Statement (must remain true):** Agent auto-approves normal
> project-scoped tools. It does *not* auto-approve SSH, browser
> mutation, MCP, or `agent_tool` — those are the categories where the
> hard safety hooks cannot generically prove safety and the user should
> still be in the loop.

---

## 5. Bypass

Auto-approve everything that the dangerous-command and path-escape
hooks can prove safe. Still respects every hard safety gate the app
already has.

| Field | Value |
| --- | --- |
| UI label | `executionMode.bypass.label` (en-US "Bypass permissions") |
| `permissionMode` | `bypass` |
| `allowedToolPolicy` | `full` |
| Approval behavior | `auto-everything` |
| Allowed tools | All (model-facing catalog returns `undefined`, meaning "do not filter") |
| Blocked tools | **None at the registry layer** — but the dangerous-command and path-escape `preToolUseHooks` still fire on every shell call. SSH, browser, MCP, and `agent_tool` keep their confirmation dialog in the current implementation (see `canAutoApproveTool`'s `permissionMode === 'bypass'` branch in `toolExecutionPolicy.ts`). |
| Hard-enforced? | **Partially.** Bypass is the **only** mode where `allowedToolPolicy: 'full'` is true, so the outer guard no longer rejects tools by name. But the dangerous-command check, the path-escape check, the SSH config gate, and the MCP server gate are *not* skipped — Bypass is "skip the user prompt" not "skip the safety hooks". |
| Runtime enforcement points | `canAutoApproveTool` (auto-approve gate; rejects `isSshTool` / `isMcpTool` / `isBrowserMutationTool` / `agent_tool` even in bypass), `preToolUseHooks` dangerous-command + path-escape checks (always fire) |
| Tests that protect it | `src/store/chat/__tests__/chatToolExecution.test.ts` "Bypass still rejects dangerous commands via preToolUseHooks" (canonical test — rm -rf, mkfs, dd rejected even in Bypass). `src/services/executionMode/__tests__/modeConsistency.test.ts` (Bypass `requiresWarning: true`, `isAdvanced: true`). |

> **Statement (must remain true):** Bypass auto-approves normal
> project-scoped tools but still respects the dangerous-command,
> path-escape, SSH, browser, MCP, and `agent_tool` safety gates. The
> UI must not say "Bypass: all tools auto-approve" without naming the
> exceptions.

---

## UI ↔ enforcement honesty

The composer dropdown shows a `systemPromptSuffix` per mode. That
suffix is **redundant** with the actual enforcement — it is the
explanation the model sees, not the rule. The rules are:

1. The 5-mode registry (`registry.ts`).
2. The outer guard (`isToolAllowedForProfile`).
3. `preToolUseHooks` (dangerous-command, path-escape, mode guard).
4. The model-facing catalog (`getAllowedToolsForMode`).
5. `canAutoApproveTool` (per-tool approval gate).

If you add or change a mode:

- Update the registry *and* the outer guard *and* the catalog at the
  same time. `modeConsistency.test.ts` asserts that all three agree.
- Do not put a "guard" in the system-prompt suffix that the
  enforcement layer does not actually enforce. The model will call the
  tool, and the tool will succeed.
- If a setting is only a prompt-side instruction (no enforcement),
  label it as such in the UI. Examples: "agent will try to", "may
  require a follow-up turn", "the loop will retry up to N times".

---

## Cross-references

- Folder model: [`folders-and-runs.md`](./folders-and-runs.md).
- AutoResearch runtime, which executes its own loop on top of these
  modes: [`autoresearch-runtime.md`](./autoresearch-runtime.md).
- File-level responsibility for the registry itself:
  `src/services/executionMode/registry.ts` (file-level docstring).
