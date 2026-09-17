# Danger mode defaults affordance (scout leftover)

**Principle:** prove + persist + observe — no security-model redesign; no `SessionRuntime` / `queryLoop` rewrite.

Companion scout: [`soak-polish-scout.md`](./soak-polish-scout.md) · plan: [`soak-polish-plan.md`](./soak-polish-plan.md) · modes: [`concepts/execution-modes.md`](./concepts/execution-modes.md)

## Claims

| Claim | Proof |
| --- | --- |
| **New sessions default to Ask (no tools)** | Registry `isDefault: true` on Ask only; affordance `getExecutionModeAffordance('ask').isDefault === true` / `toolsActive === false`; composer hint `data-testid=execution-mode-affordance-ask` |
| **Shell / full tools need Danger** | Ask/Plan affordance copy points to Danger; Danger affordance `toolsActive === true` (`execution-mode-affordance-danger`) |
| **Danger ≠ legacy Bypass auto-approve** | Danger keeps `permissionMode: auto-edits` + `ask-on-risky`; warning body + defaults line (`execution-mode-danger-warning-defaults`) state risky ops still confirm |
| **Menu marks Default** | Ask row shows `executionMode.ask.defaultBadge` when the mode menu is open |
| **One-click Switch to Danger** | Ask/Plan affordance row shows `*-switch-to-danger` → DangerWarningDialog (still ask-on-risky); hidden on Danger |
| **Shell/general upgrade recommends Danger** | Upgrade modal `reason===general` shows `execution-mode-upgrade-recommend-danger`; body copy leads with Danger (Plan is read-only) |
| **Policy recovery names Danger** | Pre-send + `tryRecoverFromToolPolicyError` notify with `executionMode.upgrade.switchedToDanger` / `switchedToPlan` |

## Entry points

```
src/services/executionMode/modeAffordance.ts
src/services/executionMode/registry.ts
src/components/chatInput/ExecutionModeDropdown.tsx
src/i18n/locales/en-US.ts / zh-CN.ts
docs/concepts/execution-modes.md
```

## Intentionally not this leftover

- Changing default mode away from Ask
- Restoring Bypass auto-everything / removing risky approval gates
- Project Folder / stream finalize / SessionRuntime redesign
- Playwright mega E2E

## Ask → Danger friction (this leftover)

- Stronger Ask affordance copy (`tools blocked` / `工具已禁用`) + `executionMode.affordance.switchToDanger`.
- Composer one-click Switch to Danger still opens the Danger warning (risky ops confirm).
- Shell/command tool-need (`general`) highlights Danger as recommended in the upgrade modal.
- Ask tool-policy recovery notifies with Danger/Plan copy so soaks do not look “broken”.

## Jest

```bash
pnpm exec jest \
  src/services/executionMode/__tests__/modeAffordance.test.ts \
  src/services/executionMode/__tests__/registry.test.ts \
  src/services/executionMode/__tests__/askModeToolNeed.test.ts \
  src/components/chatInput/__tests__/ExecutionModeDropdown.test.tsx \
  src/store/chat/__tests__/chatStoreSendMessage.test.ts \
  --runInBand --no-coverage
```
