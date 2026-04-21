---
name: form_fill
description: Fill structured web forms with PageState-based targeting, validation checks, and guarded submission.
official: true
version: 0.1.0
---

# Form Fill Skill

Use this skill when the task requires entering data into a browser form, selecting options, and optionally submitting once the page state looks correct.

## Goal

Complete forms reliably on dynamic sites by using stable `backend_node_id` targets, re-checking `browser_get_page`, and stopping before risky submissions when the content is ambiguous.

## Preferred Tool Sequence

1. Use `browser_get_page` to identify editable fields and buttons.
2. Use `browser_type` with `backend_node_id` when present.
3. Use `browser_click` for checkboxes, radios, selects, and submit buttons.
4. Use `browser_press_key` for Enter or Tab only when it is clearly part of the intended flow.
5. Use `browser_wait` plus another `browser_get_page` after large DOM updates.

## Guardrails

1. Never submit if required field values are uncertain.
2. If a field label is ambiguous, ask the user instead of guessing.
3. Re-read `browser_get_page` before submitting if the form changed after typing.
4. If the page warns about login, captcha, or MFA, hand back control to the user.
5. Mention exactly which fields were changed in the final response.

## Minimal Demo Flow

1. `browser_get_page` to inspect inputs.
2. `browser_type` for each required field.
3. `browser_click` optional toggles or selectors.
4. `browser_get_page` again to confirm the final state.
5. `browser_click` submit only if the user explicitly asked to send or submit.