# PiPi Shrimp Agent live dual-session mid-tool soak — 2026-09-17

Scope: §1 isolation only. No process kill performed.
Main tip note: `49f0701`
Desktop: `DISPLAY=:3`

## Preconditions

- App open: PASS — PiPi Shrimp Agent was already running and responsive.
- Project Folder: PASS — bound both test chats to `/workspace/pipi-shrimp-agent`.
- Mode: PASS — set both chats to 危险 / Danger.
- Provider: PASS — DeepSeek (OpenAI Compatible) accepted `execute_command`; no provider refusal.

## §1 results

| Step | Result | Evidence / notes |
|---|---|---|
| 1. Session A new chat; exact `sleep 120; echo soak-a-done`; confirm mid-tool | PASS | A entered processing with Stop visible; screenshot: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/952243e80c3e0d17a7c81909c2a692d93048a643dce29b5afb00847e61545ef2.webp` |
| 2. New Session B without stopping A; exact B probe; B mid-tool and A still running | FAIL (timing) | B entered processing with Stop visible, screenshot: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/e633e6bdf25a2b55d72d14f92dc6717a7dafa5b910480db3c995db6ac5cc61a4.webp`; by the time B was started, A's 120-second command had already completed, so A was not still running in background. |
| 3. Switch back to A; A still mid-tool/not cancelled by switch | FAIL | Switching to A showed completed `soak-a-done` result, not mid-tool: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/21ffdd4d0cc080099d431a8fe5945618a1d5ef61d996ca14be3c9528604dbbea.webp` |
| 4. Stop A; A cancels while B remains mid-tool | FAIL (A already done) / isolation observation PASS | Stop on A had no cancellation effect because A had completed; switching to B showed B still processing with Stop visible: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/0b41ed1d35dd3043cc33014a90a4339250b1fc6b63064afc8405722967bb01a0.webp` |
| 5. Stop B or let finish; no cross-session history rewrite | PASS | Stop on B produced `[Tool execution cancelled before completion.]` and a terminal cancellation notice; A history remained its own successful `soak-a-done` result. B cancellation screenshot: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/97f3ab60d783a096d62788ee1a41424afb77790a1541295ca566b47fc3d77671.webp`; A remained intact after switching back: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/274a672f5d5f0e33a4eacfa4967aa1ae39794ca039ef1c39fe38935325c75375.webp` |

## Blockers / notes

- No folder-unbound, Ask-mode, or provider-tool refusal blocker after setup.
- The setup/permission approvals consumed enough time for Session A's 120-second command to finish before Session B was launched; therefore the strict background-running checks in steps 2–4 were not fully met.
- Session B was independently cancellable and its cancellation did not rewrite Session A history.

## Retry with sleep 600

Scope: §1 live dual-session retry on `DISPLAY=:3`; no `kill -9` or process kill performed.

| Step | Result | Evidence / notes |
|---|---|---|
| Preparation A: bind Project Folder and enable 危险/Danger before any sleep | PASS | Fresh Chat 48 showed Project Folder `pipi-shrimp-agent` and red 危险 mode: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/6b27710ffe3de336cf2fbcf2e632a4c0116af4511df085e3601dbfeddac36db2.webp` |
| Preparation B: bind Project Folder and enable 危险/Danger before any sleep | PASS | Fresh Chat 49 showed Project Folder `pipi-shrimp-agent` and red 危险 mode: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/b8dfaee3a0e48a35785ad2177110c7f9fa4a5c30d5c5afee8481c07f0a5ba144.webp` |
| 1. Session A exact `只用 execute_command 运行: sleep 600; echo soak-a-done`; confirm mid-tool | PASS | Permission sheet displayed exact command and `/workspace/pipi-shrimp-agent`: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/3f453895783f4f2cd714885905893f91d6aeaf69ee6799c28fd24c1a64bfdd76.webp`; A then showed processing/Stop: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/5a4c666bec025f13fc09e06b2d46dd777d983937761579371ecbbd471fadb408.webp` |
| 2. Switch immediately to prepared B and send exact `只用 execute_command 运行: sleep 600; echo soak-b-done`; B mid-tool while A remains running | FAIL | B was switched to immediately and was prepared, but its composer remained unavailable while A ran; the exact B text could not be entered/sent, so B never reached a tool/Stop state. Empty prepared B evidence: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/47822404938e0010b11cc3b6884a6f601ad83d4bb99fb806e26f102d567cd95b.webp`, after settle: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/7908ead0b8d6ed98a1f528e5c629f5d8985cd1855ff7aca53d1317f17e861533.webp`. A was still processing when checked: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/9d94d4e34d475c18f02eddae59afbd1322b90ff45cc698b39fdeb65927918ac4.webp` |
| 3. Switch back to A; it must still be mid-tool | FAIL (prerequisite) | A did remain mid-tool/Stop-visible when checked, but B had not started, so the strict dual-session step was not met; same A evidence as above. |
| 4. Stop A; B must still be mid-tool | FAIL | A was stopped gracefully via the app Stop control; B had never started. A recorded terminal cancellation notice: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/7c8ab50ddd5b298a441993745d1ca05b19e503ac43de8b11a7620de3288da8a1.webp` |
| 5. Stop B; A history must stay its cancel/notice | FAIL / NOT RUN | No B execution existed to stop. A history remained its own cancellation/notice in the screenshot above; no cross-session B rewrite was possible to test. |

### Retry verdict
**FAIL** — A successfully entered the exact 600-second command and was cancellable, but the prepared second chat's composer was unavailable while A was running, preventing the required concurrent B start. No `kill -9` or process kill was used.

### Companion Jest
**PASS** — 5 suites passed; 32 passed, 2 skipped (34 total), exit 0. Suites: `soakRunner+crashReload+sessionSwitch+startSessionPermission+chatStreamingIsolation`. Log: `/tmp/pipi-soak-companion-jest.log`.

## Retry 2 focus composer
- Prepared Chat 50 (A) and Chat 51 (B) with Project Folder `workspace` and 危险 mode before starting either soak.
- A probe `只用 execute_command 运行: sleep 600; echo soak-a-done` was sent and permission approved; A showed the red Stop control.
- Switched to B while A was mid-tool. Initial direct clicks/keyboard focus attempts did not enter text; toggling 对话→预览→对话 reset focus. B probe was then typed by keyboard and visibly rendered (partial-typing screenshot: `file:///home/box/sand-data/agents/051467ec-3546-40b5-a423-0af3c4aa0caf/assets/234ed0b7acba35b5d4b1aba4e1d3fa27b0a232a98f2d35ede5f2429aaecb9fd8.webp`), then sent.
- B permission was approved; both A and B were observed with red Stop controls / processing state in separate chats.
- Stopped A, switched to B and confirmed B still mid-tool (a permission prompt resurfaced and was approved), then stopped B. Both ended with tool-cancelled-before-completion records.
- Result: PASS for dual-session concurrency and cross-chat isolation; noted composer focus required the view toggle workaround.
