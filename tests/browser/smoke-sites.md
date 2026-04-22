# Browser CDP Core Acceptance Scenarios

Use these five scenarios as the manual acceptance baseline for browser-related releases.

They are intentionally product-shaped instead of implementation-shaped: if all five pass, the browser stack is working for the user-facing flows that matter most.

## Preconditions

- Launch the app in a development build or a release candidate build.
- Keep one Chrome profile already signed in to a normal site so attach-first reuse can be verified.
- Enable the browser debug panel.
- Run `npm run test:browser-gate` before manual smoke so the automated gate is already green.

## Scenario BCDP-AC-01: Attach-First Session Reuse

### Goal

Prove that the app reuses a real Chrome session instead of silently falling back to an app-launched browser.

### Steps

1. Start a normal Chrome window with a logged-in tab already open.
2. Connect the app to Chrome.
3. Confirm the browser session reports `attach` instead of `launch`.
4. Navigate within the reused tab and verify the logged-in state is preserved.

### Pass Criteria

- Session mode is `attach`.
- The active page keeps the existing login state.
- Browser Debug shows a healthy connected session with the reused target.

### Primary Failure Signals

- Unexpected fallback to `launch`.
- Reused tab loses authentication state.
- Session connects but target selection lands on the wrong tab.

## Scenario BCDP-AC-02: PageState Visual Truth

### Goal

Prove that PageState is not just structurally valid, but visually trustworthy enough for an agent to act on.

### Steps

1. Open a page with at least one visible button and one visible input.
2. Trigger a fresh `browser_get_page` capture.
3. Open Browser Debug and inspect `Latest Page State`.
4. Verify `Screenshot Preview` is present.
5. Verify the cyan overlays line up with the corresponding visible interactive elements.

### Pass Criteria

- Latest Page State shows screenshot, viewport, and element overlays.
- Overlay labels correspond to the visible elements shown in the element list.
- No obvious drift exists between highlighted bounds and the rendered page.

### Primary Failure Signals

- Screenshot is missing or stale.
- Highlight bounds are offset or clipped incorrectly.
- Element list and visual overlays disagree about what is actionable.

## Scenario BCDP-AC-03: Web Research Happy Path

### Goal

Prove that the browser stack can complete a read-heavy navigation and extraction task end to end.

### Steps

1. Open `Web Research` from the Skill page and jump into chat.
2. Run a prompt that requires one navigation, one result selection, and one extraction.
3. Watch Browser Debug for navigation, PageState updates, and action events.
4. Inspect the final response.

### Pass Criteria

- The agent reaches the target page without manual intervention.
- The final answer includes the source title and URL.
- Browser Debug shows a coherent navigation plus extraction timeline.

### Primary Failure Signals

- Agent loops on the same page state without progressing.
- Extraction returns content from the wrong page.
- Final answer omits or misstates the source page.

## Scenario BCDP-AC-04: Guarded Form Fill

### Goal

Prove that the write path is reliable and conservative: it can fill fields correctly without over-submitting.

### Steps

1. Open `Form Fill` from the Skill page and jump into chat.
2. Run a non-destructive form prompt that fills fields but should stop before submit.
3. Verify the page updates after typing and optional clicks.
4. Re-read the final agent response.

### Pass Criteria

- The intended fields are filled.
- The agent stops before submission unless the prompt explicitly asks to submit.
- The final response lists exactly which fields changed.

### Primary Failure Signals

- Wrong field receives input.
- The agent submits when it should only stage changes.
- The final response claims changes that did not happen on the page.

## Scenario BCDP-AC-05: Lifecycle Robustness

### Goal

Prove that runtime invalidation, cache lifecycle, and idle cleanup are observable and correct under normal user behavior.

### Steps

1. Trigger `browser_get_page` twice on the same page.
2. Verify cache hit/store behavior in Browser Debug.
3. Reload or navigate the page and verify cache invalidation appears with a compact reason label.
4. Leave the session idle until cleanup should run.
5. Verify attach mode disconnects without closing the user's Chrome window.

### Pass Criteria

- Cache lifecycle shows miss, store, hit, and invalidation in a believable order.
- Invalidation reasons are normalized and not shown as raw `cdp_*` strings.
- Idle cleanup disconnects the session cleanly while preserving the user browser.

### Primary Failure Signals

- Cache keys are present but event ordering is incoherent.
- Invalidation renders raw backend reason codes.
- Idle cleanup closes or disturbs the user's attached Chrome instance.

## Exit Rule

Treat a browser release as acceptable only when all five scenarios pass. If one fails, fix that slice before broadening the browser surface further.