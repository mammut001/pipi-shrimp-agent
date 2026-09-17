# PiPi Shrimp Agent — Product UX Soak

## Wave 1 — Chat & tools

Tested as an end user on DISPLAY=:3. The native `pipi-shrimp-agent` window showed **“WebKit encountered an internal error”**, so I used the app's own Vite UI as a fallback for the visible UX checks. That fallback does not provide the Tauri `invoke` bridge.

1. **FAIL (partial)** — App window opened, but native content was the WebKit error. In the fallback UI, `SYSTEM READY` was visible at bottom right.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/00e3dfa506b0aabe3cd24f7a7879af3f6374fe6316893c6ddd1e3b44b9f1204e.webp`; fallback: `/tmp/.sand-browser/shot-call_opjT5nOdmhvDa1T8U5QfnSb0fc_012cdda177aed581.png`

2. **PASS** — New chat created as `Chat 1` via “无项目（根级）”. Bottom-left provider/account label was `阿里云 MaaS (Anthropic compatible) 账号`; no secret was pasted or exposed.  
   Screenshot: `/tmp/.sand-browser/shot-call_opjT5nOdmhvDa1T8U5QfnSb0fc_012cdda177aed581.png`

3. **FAIL** — “设置项目文件夹” was attempted for `/workspace/pipi-shrimp-agent`, but the folder picker failed with `Could not open folder picker: Cannot read properties of undefined (reading 'invoke')`. Folder remained unbound.  
   Screenshot: `/tmp/.sand-browser/shot-call_opjT5nOdmhvDa1T8U5QfnSb0fc_012cdda177aed581.png`

4. **PASS** — Switched to 危险/Danger and confirmed the warning dialog in the test UI; danger state was shown in the composer.  
   Screenshot/context: `/tmp/.sand-browser/shot-call_opjT5nOdmhvDa1T8U5QfnSb0fc_012cdda177aed581.png`

5. **FAIL** — Sent `用一句话介绍你自己，不要调用工具。`; the user message appeared, but the assistant returned `Cannot read properties of undefined (reading 'transformCallback')` instead of a short reply. No tool call was observed.  
   Screenshot: `/tmp/.sand-browser/shot-call_opjT5nOdmhvDa1T8U5QfnSb0fc_012cdda177aed581.png`

6. **PASS** — In Ask/问答 mode, sending `请用 execute_command 运行: echo ask-blocked` showed the expected tool-use friction modal (`这条请求需要调用工具`) with 取消/规划/危险 shell/工具推荐. The one-click Danger upgrade path was exercised and confirmed.  
   Screenshot: `/tmp/.sand-browser/shot-call_jXpbNZlyWB7sOQ8QoVlYgW5Rfc_012cdda177aed581.png`

7. **FAIL** — In Danger, sent `只用 execute_command 运行: echo product-soak-ok && pwd`; the assistant again failed with `Cannot read properties of undefined (reading 'transformCallback')`. No permission prompt or `product-soak-ok` tool result was reached.  
   Screenshot/context: `/tmp/.sand-browser/shot-call_opjT5nOdmhvDa1T8U5QfnSb0fc_012cdda177aed581.png`

8. **PASS** — Right panel glance: `PROGRESS` was collapsed; `工作文件夹` showed the empty state `暂无工作文件夹`; `AGENT SOUL (DEFAULT)` showed the default Chinese identity text. Chrome Browser connector was visible as `CLICK TO CONNECT`.  
   Screenshot: `/tmp/.sand-browser/shot-call_opjT5nOdmhvDa1T8U5QfnSb0fc_012cdda177aed581.png`

9. **PASS** — Opened 技能/Skills briefly. UI showed `Skills`, `RUNTIME`, filter field, no loaded runtime skill match, `No runtime skill selected`, and a Load installed/custom skill field. No skill was run.  
   Screenshot: `/tmp/.sand-browser/shot-call_e42V59ch8tgjupwy6IIPT4AKfc_012cdda177aed581.png`

10. **PASS** — Opened 诊断. `Diagnostics Tasks Panel` was visible with task-type and task-status filters both at 全部; empty state said `当前筛选条件下没有任务。`  
    Screenshot: `/tmp/.sand-browser/shot-call_wWfJGECnCKhIHBgXI8stTkLEfc_012cdda177aed581.png`

### Summary

- **PASS: 6**
- **FAIL: 4** (item 1 counted as fail because the native window did not render; fallback UI showed SYSTEM READY)
- **Primary blocker:** native WebKit internal error and missing Tauri bridge in fallback (`invoke`/`transformCallback` undefined), blocking folder binding and live chat/tool execution.
- **Account/API note:** a configured provider/account label was visible; no API key/account secret was requested or pasted. Live API usability could not be verified because of the bridge errors.

## Wave 1 retry — native Tauri

Retried as a real user in the native `pipi-shrimp-agent` window on DISPLAY=:3. No WebKit internal error appeared; Vite UI was not used.

1. **PASS** — SYSTEM READY was visible; app usable.
2. **PASS** — New chat `Chat 53` created. Provider label: `DeepSeek` (OpenAI-compatible); no secrets exposed.
3. **PASS** — Bound Project Folder `/workspace/pipi-shrimp-agent` using the GTK chooser.
4. **PASS** — Switched to 危险/Danger and confirmed the warning.
5. **PASS** — Plain request `用一句话介绍你自己，不要调用工具。` returned a one-sentence reply without tools.
6. **PASS** — Q&A tool-friction modal appeared for an `execute_command` request; switched to Danger and approved the safe friction-check command.
7. **PASS** — Approved `只用 execute_command 运行: echo product-soak-ok && pwd`; output included `product-soak-ok` and `/workspace/pipi-shrimp-agent`.
8. **PASS** — Right panel glance showed PROGRESS with successful `execute_command`, project-folder/context sections, connector, and SYSTEM READY.
9. **PASS** — Skills glance opened the Skills view with loaded runtime skills including `autoresearch`.
10. **PASS** — Diagnostics glance opened the Diagnostics Tasks Panel with task filters and task rows visible.

### Retry Summary

- **PASS: 10**
- **FAIL: 0**
- Native Tauri path succeeded; no WebKit internal error observed.

## Wave 2 — Skills / AutoResearch / Browser / Workflow

Tested as a real end user in the native `pipi-shrimp-agent` window on DISPLAY=:3; no Vite UI used. Project Folder was rebound to `/workspace/pipi-shrimp-agent` for Chat 54 and Danger was enabled.

1. **PASS — Skills** — 技能 opened with loaded runtime skills (`autoresearch`, `docx`, `imap-smtp-email`, `form_fill`, etc.). Selected `docx` lightly to inspect its loaded SKILL.md; no risky run started.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/325df9d522e568b66d4bbfca9f10f4fb2ca1d9480da06455a3bf8c3d914810e7.webp`

2. **PASS — MCP / Connectors** — Right panel showed Chrome Browser `CLICK TO CONNECT`. Connector dialog reported mode `attach`, health `disconnected`, with one-click and direct-connect choices; no heavy auth/connect attempted.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/d2a9896c32ed3c704ecba2fba051f186624f0ec0b208c7c0818f6c90a7d89264.webp`

3. **PASS — AutoResearch (自动研究)** — Opened existing run history/detail, viewed 引导式启动 (target/literature/baseline/metric/scaffold steps), then 新建运行 → 手动启动 AutoResearch. Setup was 5/6 ready with local target, workflow/metric fields populated and final environment check pending. Backed out without starting a long experiment.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/1cce3934d24011c6f3df5edec536eb9f382a01afd5c10e5551a56071d96170fd.webp`

4. **PASS — Browser workspace / split** — 预览 toggled to a split chat + Session workspace layout. Workspace path displayed `/workspace/pipi-shrimp-agent`; pane reported no previewable files. No embedded browser URL field was present, so `https://example.com` navigation was not applicable.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/413367158fead37a4be1f7a0ade92a6efa546c692c4d2f192d4c701fa2ef78ac.webp`

5. **PASS — Workflow (工作流)** — Workflow canvas was populated with four agent nodes (Technical Writer, Full Stack Developer, Code Reviewer, QA Engineer), with run controls and Iter 1/5 not reached. Opened AddAgent template picker and closed it without adding or running a job.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/70ca90183377b2139a9694c3828e289d1e82ada3d00d27ab3ed0aa7194d75c9d.webp`

6. **PASS — Diagnostics deeper** — Changed task-type filter from 全部 to Workflow; list correctly changed to `当前筛选条件下没有任务。` (empty behavior verified).  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/4a9d6b653234e2cb04bc8e448a7efff356d4f11caf83b693743cb53ce1d4630b.webp`

7. **PASS — New chat / session switch** — Created Chat 54, rebound `/workspace/pipi-shrimp-agent`, enabled Danger, sent the no-tool message `会话二测试` and got a normal reply. Switched back to Chat 53 and its prior history remained intact.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/6c6ba763095cd8ba420fd923ae93c5e799ef01863a6a4aa241f7e09c2d268f01.webp`

8. **PASS — Stop control** — Started `只用 execute_command 运行: sleep 30; echo stop-wave2`, approved the long-running command in `/workspace/pipi-shrimp-agent`, pressed Stop while it was running, and confirmed right-panel state `CANCELLED` plus a cancellation notice.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/afeaf7a59ed3130b9ae3f9a0a71f359eb90aff424c12214cab1862cafa24dbce.webp`

### Wave 2 Summary

- **PASS: 8**
- **FAIL: 0**

## Wave 3 — Settings / Goal / Preview / edges

Tested as a real user in the native `pipi-shrimp-agent` window on DISPLAY=:3 only; no Vite UI, API calls, secret paste, or app kill. Existing DeepSeek account remained selected and the app stayed `SYSTEM READY`.

1. **FAIL (picker UX)** — Bottom-left showed `DeepSeek` / `OPENAI COMPATIBLE` with a gear. Clicking the avatar/name/compatibility label did not open an account/model menu. The gear did open Settings, where the available configured models/providers were visible without exposing secrets: Aliyun MaaS (Anthropic/OpenAI compatible), MiniMax, Vercel AI Gateway, and DeepSeek (`deepseek-flash`); DeepSeek remained the active working account. This is a product-surface gap: the visible account/model area is not discoverably clickable, while the inventory is only reachable through Settings.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/de72cbff0daccf99ad12873bad64df3921e020a00d145d33f466ef0f51931a0a.webp`

2. **PASS — Goal (目标)** — Opened the composer Goal chip, saved `product-soak-goal`, verified the green active goal state/toast, then reopened it and used 清除目标; the cleared toast returned and the composer was restored.  
   Screenshots: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/d1109a4181624caf1c57614f38541858190deb3d815df58f26df5b0cbd15b7ff.webp`, `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/c2268b285684b4bdcd5a718b29b27c60382195ce9f9535b8237adaae8c53a7b1.webp`

3. **PASS — 对话 / 预览 tabs** — Toggled from 对话 to 预览 and back. Preview showed the Session workspace at `/workspace/pipi-shrimp-agent` with `No files detected yet`; conversation returned normally with existing content.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/9934582582cd25c5144459c808ca521df59c6aacc9530a1edf3c102eb499b420.webp`

4. **PASS — MCP button** — Opened the composer MCP Servers popup. It clearly reported `No servers configured` and offered `+ Add Server`; closed without changing configuration or entering credentials.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/c0bff30de757daae79f042c5b69926ba6b839e96f03305a53909dd835a5db715.webp`

5. **PASS — Attachments** — Image affordance opened the native GTK `Select Files` picker; it was cancelled without selecting/uploading. The adjacent folder affordance opened the native Thunar conversation directory (`/workspace/pipi-shrimp-agent`), which was closed without changes.  
   Screenshots: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/2a8058c4acdd2a92829dc3e164fe599250fa8ecf5a31c4e0610c762b850b0163.webp`, `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/9f0db0bda96aae3c0eb5c524816e729c1c780c7b8606c773a4b7058258487218.webp`

6. **PASS — Working Folders** — Right panel remained in the safe empty state `暂无工作文件夹` with the hint to drag files into chat/specify a project folder. No obvious add control was present, so no folder was added or disturbed.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/9d66a6e7d72ded183290da4ab1dfdbe99b5b10004a734cdb4588579f79527dcc.webp`

7. **PASS — Settings gear** — Opened Settings and inspected (without edits): API configurations/provider/model inventory, masked API secret field, AutoResearch provider/model overrides, MCP server section (unconfigured), intelligent-behavior limit, and database-health area. No secret was revealed or changed. A distinct theme control was not obvious in this light scan.  
   Screenshots: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/3e4bf3582efe21b9ea3371b4493d13f5a7311ba2157176a5a5052fa4f7bdba4c.webp`, `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/e386e15520e672973a7aa85feeb89458c877a2154fc8a86a4177ebb13cd14d19.webp`

8. **PASS — Typst / Docs** — Expanded the right-panel DOCS section. It showed `No documents yet` and the explanatory auto-create-when-asked empty state; no document was created.  
   Screenshot: `file:///home/box/agent-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/278384b0a608adb79bea8c1d6fa9bc5583ec6c068e957be2fb3f5c1365268461.webp`

9. **Not run (optional)** — Did not create another chat/project-picker variant because existing native session state was already stable and the required surfaces were covered.

### Wave 3 Summary

- **PASS: 7**
- **FAIL: 1** (account/model picker click surface did not open a menu)
- **Optional: 1 not run**

### Overall soak verdict

Native Tauri operation is now healthy across the retry and Wave 2/3 checks: SYSTEM READY, chat/tool flows, preview, goal persistence, MCP empty state, native attachment pickers, settings, and Docs all behaved coherently. Recommend fixing the bottom-left account/model picker affordance (or adding an explicit chevron/menu) so users can actually switch among the models that Settings lists. The earlier Wave 1 WebKit/fallback bridge failures were not reproduced on the native path, but remain historical regression coverage.


## Overall verdict

**Native Tauri product soak (2026-09-17, DISPLAY=:3, WEBKIT_DISABLE_COMPOSITING_MODE=1)**

| Wave | Result |
| --- | --- |
| Wave 1 (Vite fallback, broken bridge) | 6 PASS / 4 FAIL — **invalid for product** (WebKit error → fell back to Vite without `invoke`) |
| Wave 1 retry (native) | **10 / 10 PASS** |
| Wave 2 (Skills / AutoResearch / Browser pane / Workflow / Diagnostics / sessions / Stop) | **8 / 8 PASS** |
| Wave 3 (Settings / Goal / Preview / MCP / edges) | **7 PASS / 1 FAIL** (+1 optional skipped) |

### What works well
- Chat + DeepSeek provider, Project Folder bind, Danger mode, Ask→Danger upgrade friction
- `execute_command` approve + result; Stop cancels mid-tool
- Skills browser, AutoResearch guided/manual setup (without long run), Workflow canvas, Diagnostics filters
- Session switch keeps histories; Preview/workspace split shows project path
- Goal / MCP / Settings surfaces reachable

### Product issues found
1. **WebKit blank/internal error** without `WEBKIT_DISABLE_COMPOSITING_MODE=1` on this box — native window unusable; easy to accidentally use Vite and hit `invoke`/`transformCallback` undefined.
2. **Bottom-left account/model label does not open a picker** — models only via Settings (Wave 3 FAIL).
3. **Chrome Browser connector** stays `CLICK TO CONNECT` / disconnected in soak (not fully exercised end-to-end).
4. **Preview pane** has no embedded URL browser field in this build — workspace file preview only.

### Recommendation
Ship/day-to-day soaks on this box should always start Tauri with `WEBKIT_DISABLE_COMPOSITING_MODE=1`. Consider UX: make account/model chip open the account picker; document that Vite-only preview is not a supported runtime.

## Follow-up — sidebar account chip picker (2026-09-17)

Wave 3 FAIL item 1 is addressed on branch `fix/sidebar-account-chip-picker`:

- Bottom-left account/model chip is now a keyboard-accessible button with chevron.
- Click opens a picker of API configs (same inventory Settings uses); selecting one calls `setActiveConfig`.
- Empty config / “Manage in Settings…” opens Settings (`settingsOpen: true`).
- Focused unit test: `src/components/sidebar/__tests__/SidebarAccountChip.test.tsx`.

### Box note — native Tauri WebKit

On this soak box, always start native Tauri with:

```bash
DISPLAY=:3 WEBKIT_DISABLE_COMPOSITING_MODE=1 pnpm run tauri:dev
```

Without `WEBKIT_DISABLE_COMPOSITING_MODE=1`, WebKit often fails with an internal/blank error and it is easy to accidentally exercise the Vite UI (missing `invoke` / `transformCallback`). See also `docs/HANDOVER-2026-09-16.md` § `tauri:dev`.
