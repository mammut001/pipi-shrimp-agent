# Live dual-session mid-tool soak checklist (post-#94)

**Audience:** human or box computer-use continuing after #94 / #99 / #100 / #102–#105.  
**Repo:** `/workspace/pipi-shrimp-agent`  
**Principle:** prove + persist + observe — no SessionRuntime rewrite.

Related: [`docs/soak-crash-reload.md`](../../docs/soak-crash-reload.md), [`docs/stop-session-switch-polish.md`](../../docs/stop-session-switch-polish.md), [`docs/HANDOVER-2026-09-16.md`](../../docs/HANDOVER-2026-09-16.md).

---

## 0. Setup

```bash
# Computer-use / live soak on this shared box commonly uses DISPLAY=:5
# (some agents use :3 — use whichever owns the desktop you are driving)
export DISPLAY=:5
cd /workspace/pipi-shrimp-agent
git checkout main && git pull --ff-only
pnpm run tauri:dev
# Optional: tee /tmp/pipi-tauri-soak.log
```

- Bind **Project Folder** to `/workspace/pipi-shrimp-agent` (or the checkout under test).
- Set session execution mode to **危险 / Danger** (Ask default blocks tools).
- DB path often: `/home/box/.local/share/pipi-shrimp-agent/data.db`

### Provider tip

DeepSeek (OpenAI Compatible / deepseek-flash) **often refuses `test_barrier_tool`**. Prefer:

```text
只用 execute_command 运行: sleep 120; echo soak-a-done
```

For session B:

```text
只用 execute_command 运行: sleep 120; echo soak-b-done
```

If using barriers instead (Danger + model willing): `test_barrier_tool` with distinct `barrier_id`s; see `docs/soak-crash-reload.md` manual section.

---

## 1. Dual-session mid-tool switch (isolation)

| Step | Action | Pass |
| --- | --- | --- |
| 1 | New chat **A**. Send long sleep probe. Confirm mid-tool (Stop visible / busy chrome). | A mid-tool |
| 2 | New chat **B** (do **not** Stop A). Send long sleep probe. | B mid-tool; A still running in background |
| 3 | Switch UI back to **A**. | A still mid-tool / streaming-or-pending — **not** cancelled by the switch |
| 4 | On **A**, press **Stop**. | A cancels; **B** still mid-tool when you switch to B |
| 5 | On **B**, press **Stop** (or let finish). | B settles; A history not rewritten by B’s Stop |

Also covered by Jest: `sessionSwitchCancellation`, `startSessionPermissionIsolation`, `chatStreamingIsolation` (see handover §4).

---

## 2. Mid-tool kill → reopen → hydrate (crash soak)

Prefer killing while **at least A** is mid-tool (optional: both A and B waiting).

| Step | Action | Pass |
| --- | --- | --- |
| 1 | Start A (and optionally B) mid-tool via sleep or barrier. **Do not** press Stop. | Mid-tool UI |
| 2 | Force-kill app: `pgrep -af target/debug/pipi-shrimp-agent` then `kill -9 <pid>` | Process dead |
| 3 | Restart `pnpm run tauri:dev` (same profile / DB). | App reopens |
| 4 | Open session **A**. | Interrupted hydrate notice; **0** dangling `tool_calls` for the killed turn |
| 5 | Open session **B**. | No ghost cancel/interrupt notice copied from A; B either hydrated cleanly or independently terminalized |
| 6 | Follow-up on **A**: short user message. | New turn works; history must **not** resume the killed tool as success |

Optional forensics (dev builds):

```js
__PIPI_RUNTIME_DIAG__.dump()
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: '…', limit: 100 })
```

---

## 3. Pass / fail summary

| Check | Pass |
| --- | --- |
| Session switch mid-tool | Background session not cancelled |
| Stop A | Does not cancel B (and vice versa) |
| Kill + reopen A | Interrupted notice; no orphan tool_calls |
| Follow-up A | No resume-as-success |
| Sibling B | No cross-session contamination from A |

Record results under `artifacts/soak/` or `/tmp/pipi-soak-*.md` with date + main tip SHA.

---

## 4. Automated companions (always run too)

```bash
pnpm exec jest src/core/runtime/soak/soakRunner.test.ts --runInBand --no-coverage
pnpm exec jest src/core/runtime/soak/crashReloadSoak.test.ts --runInBand --no-coverage
pnpm exec jest \
  src/store/chat/__tests__/sessionSwitchCancellation.test.ts \
  src/store/chat/__tests__/startSessionPermissionIsolation.test.ts \
  src/store/chat/__tests__/chatStreamingIsolation.test.ts \
  --runInBand --no-coverage
```
