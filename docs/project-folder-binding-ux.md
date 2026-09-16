# Project Folder binding UX (scout leftover)

**Principle:** prove + persist + observe — no `SessionRuntime` / `queryLoop` rewrite.

Companion scout: [`soak-polish-scout.md`](./soak-polish-scout.md) · plan: [`soak-polish-plan.md`](./soak-polish-plan.md) · folders: [`concepts/folders-and-runs.md`](./concepts/folders-and-runs.md)

## Claims

| Claim | Proof |
| --- | --- |
| **Clearer unbound denial** | Tool preflight returns greppable `No Project Folder is bound` (`NO_PROJECT_FOLDER_MESSAGE` / `permission_denied`); empty Project Folder chip shows `chat.noProjectFolderHint` (`data-testid=project-folder-unbound-hint`) |
| **Smoother GTK / OS bind dialog** | `open_folder_dialog` takes optional `title`; Project vs Output titles differ; second concurrent open returns `folder_dialog_busy` (no stacked pickers); store toasts on busy/failure |
| **Path bind still available** | Headless / tests / FileDrop toast use `setSessionProjectDirFromPath` / `setSessionWorkDirFromPath` — no dialog required |

## Entry points

```
src/store/chat/chatToolExecution.ts          # NO_PROJECT_FOLDER_MESSAGE + preflight block
src/components/chatInput/SessionFolderChip.tsx
src/store/createChatStore.ts                 # setSessionProjectDir / setSessionPipiOutputDir
src/services/workspace/folderDialog.ts
src-tauri/src/commands/workspace.rs          # open_folder_dialog
docs/concepts/folders-and-runs.md
```

## Intentionally not this leftover

- Danger mode defaults affordance (next scout leftover)
- Stream finalize redo / epoch races / SessionRuntime redesign
- Playwright mega E2E; replacing native dialog with an in-app path text field
