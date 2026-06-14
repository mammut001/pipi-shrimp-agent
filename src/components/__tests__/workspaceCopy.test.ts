/**
 * Two-Folder Model product copy contract test
 *
 * Pins the user-facing wording for the Project Folder / PiPi Output Folder /
 * Context Files split. We intentionally test the *source code* of the
 * components instead of rendering them (rendering would pull in Tauri,
 * Zustand, and a dozen providers); the test still fails loudly if a
 * developer reverts to the old single-folder "Workspace Folder" copy.
 *
 * The locked copy:
 *   - The two folders are **independent** controls in the chat input:
 *       1. **Project Folder** (chat.projectFolder) — the user's repo.
 *          Tools run commands here. `chat.noProjectFolderHint` is shown
 *          when it's missing.
 *       2. **PiPi Output Folder** (chat.pipiOutputFolder) — the
 *          app-owned output root for `.pipi-shrimp/`, generated docs,
 *          memory, AutoResearch artifacts. The hint when missing is
 *          `chat.noPipiOutputFolderHint`.
 *   - Dropped files are **Context Files** (chat.contextFiles), distinct
 *     from either folder. The "Set parent as Project Folder?" toast
 *     still goes through `setSessionWorkDirFromPath` for backwards
 *     compatibility (the store-level alias), but the action label is
 *     `chat.useAsWorkspace` and the success toast now says
 *     `chat.projectFolder: <path>`.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', '..', '..', relativePath), 'utf8');
}

describe('ChatInput two-folder copy', () => {
  const source = readSource('src/components/ChatInput.tsx');
  const chipSource = readSource('src/components/chatInput/SessionFolderChip.tsx');

  it('labels the Project Folder chip with the new "project folder" terminology', () => {
    // Project Folder is the user's repo. Its bound, set, and tooltip
    // keys must all reference the new copy. The labels themselves live
    // on the SessionFolderChip component (selected by `kind`).
    expect(source).toMatch(/SessionFolderChip/);
    expect(chipSource).toMatch(/chat\.projectFolder/);
    expect(chipSource).toMatch(/chat\.setProjectFolder/);
    expect(chipSource).toMatch(/chat\.projectFolderTooltip/);
  });

  it('labels the PiPi Output Folder chip with the new "output folder" terminology', () => {
    // PiPi Output Folder is the app-owned output root. It must be
    // addressable independently of the Project Folder. The labels
    // live on the SessionFolderChip component.
    expect(source).toMatch(/SessionFolderChip/);
    expect(chipSource).toMatch(/chat\.pipiOutputFolder/);
    expect(chipSource).toMatch(/chat\.setPipiOutputFolder/);
    expect(chipSource).toMatch(/chat\.pipiOutputFolderTooltip/);
  });

  it('mounts both chip kinds in the chat input', () => {
    // Two-folder model: ChatInput renders BOTH a `kind="project"` chip
    // and a `kind="output"` chip. Removing one must not remove the
    // other.
    expect(source).toMatch(/kind="project"/);
    expect(source).toMatch(/kind="output"/);
  });

  it('renders a hint when the Project Folder is missing', () => {
    // The Project Folder hint uses the new testid so the user can
    // tell which folder is missing.
    expect(source).toMatch(/chat\.noProjectFolderHint/);
    expect(source).toMatch(/data-testid="project-folder-missing-hint"/);
  });

  it('exposes independent bind and clear handlers for each folder', () => {
    // The two-folder model requires that removing one folder does
    // not remove the other. The store actions called from this
    // component enforce that — we assert the wiring is in place.
    expect(source).toMatch(/setSessionProjectDir/);
    expect(source).toMatch(/setSessionPipiOutputDir/);
    expect(source).toMatch(/clearSessionProjectDir/);
    expect(source).toMatch(/clearSessionPipiOutputDir/);
  });
});

describe('FileDropOverlay context files copy', () => {
  const source = readSource('src/components/FileDropOverlay.tsx');

  it('labels dropped files as Context Files', () => {
    expect(source).toMatch(/chat\.contextFiles/);
    expect(source).toMatch(/chat\.input\.contextFilesHeader/);
  });

  it('does not advertise dropped files as either folder', () => {
    // Dropped files are **Context Files**, not the Project Folder and
    // not the PiPi Output Folder. The user-facing subtitle must
    // explicitly call this out.
    expect(source).toMatch(/chat\.input\.contextFilesSubtitle/);
    expect(source).toMatch(/chat\.input\.contextFilesNotWorkspace/);
  });

  it('marks external context files as such', () => {
    expect(source).toMatch(/chat\.contextFileExternal/);
    expect(source).toMatch(/chat\.contextFileInsideWorkspace/);
    // The badge uses a JSX expression `data-testid={insideWorkspace ? ... : ...}`,
    // not a static string. Assert both literal values appear in the source.
    expect(source).toMatch(/'file-drop-inside'/);
    expect(source).toMatch(/'file-drop-external'/);
  });

  it('routes dropped files through the session working files list (context files)', () => {
    expect(source).toMatch(/addSessionWorkingFiles/);
  });

  it('wires the "Set parent as Project Folder?" toast action through the chat store', () => {
    // The toast still uses `setSessionWorkDirFromPath` (a
    // backwards-compatible alias for `setSessionProjectDirFromPath`).
    // The label key is `chat.useAsWorkspace` and the success toast
    // confirms via `chat.projectFolder`.
    expect(source).toMatch(/setSessionWorkDirFromPath/);
    expect(source).toMatch(/chat\.useAsWorkspace/);
    expect(source).toMatch(/chat\.projectFolder/);
    // The action object literal must live inside the addNotification call.
    expect(source).toMatch(/label:\s*t\('chat\.useAsWorkspace'\)/);
  });
});
