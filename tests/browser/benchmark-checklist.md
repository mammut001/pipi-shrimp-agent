# Browser CDP Benchmark Checklist

Run this checklist after the automated release gate is green.

## Commands

```bash
npm run test:browser-gate
```

Optional live browser pass:

```bash
RUN_LIVE_BROWSER_TESTS=1 bash tests/browser/release-gate.sh
```

## Metrics To Capture

Collect the current Browser Debug benchmark markdown and record:

- connect latency
- page_state latency
- action click latency
- memory before and after page_state capture
- attach vs launch sample counts

## Budget Checks

- `page_state` average duration stays below `500ms`
- no unexpected benchmark failures in recent samples
- idle attach sessions do not exceed the existing memory budget documented in phase 017

## Regression Notes

Record any of the following before shipping:

- screenshot preview missing or stale
- overlay bounds misaligned with the visible page
- cache invalidation reason shows raw `cdp_*` text instead of compact taxonomy
- attach-first unexpectedly falls back to launch