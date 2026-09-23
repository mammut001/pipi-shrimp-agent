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
 *          Tools run commands here. The empty chip label (`chat.setProjectFolder`)
 *          is the affordance when it's missing.
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
  const barSource = readSource('src/components/chatInput/SessionFolderBar.tsx');
  const chipSource = readSource('src/components/chatInput/SessionFolderChip.tsx');
  const folderBindingsSource = readSource('src/components/chatInput/useSessionFolderBindings.ts');

  it('labels the Project Folder chip with the new "project folder" terminology', () => {
    // Project Folder is the user's repo. Its bound, set, and tooltip
    // keys must all reference the new copy. The labels themselves live
    // on the SessionFolderChip component (selected by `kind`).
    expect(source).toMatch(/SessionFolderBar/);
    expect(barSource).toMatch(/SessionFolderChip/);
    expect(chipSource).toMatch(/chat\.projectFolder/);
    expect(chipSource).toMatch(/chat\.setProjectFolder/);
    expect(chipSource).toMatch(/chat\.projectFolderTooltip/);
  });

  it('surfaces the unbound Project Folder hint on the empty chip', () => {
    // Scout leftover: clearer unbound denial. The empty project chip must
    // render chat.noProjectFolderHint (not leave the i18n key unused) and
    // expose a stable test id for Manual D / soak observers.
    expect(chipSource).toMatch(/chat\.noProjectFolderHint/);
    expect(chipSource).toMatch(/project-folder-unbound-hint/);
    expect(chipSource).toMatch(/chat\.noPipiOutputFolderHint/);
  });

  it('labels the PiPi Output Folder chip with the new "output folder" terminology', () => {
    // PiPi Output Folder is the app-owned output root. It must be
    // addressable independently of the Project Folder. The labels
    // live on the SessionFolderChip component.
    expect(source).toMatch(/SessionFolderBar/);
    expect(barSource).toMatch(/SessionFolderChip/);
    expect(chipSource).toMatch(/chat\.pipiOutputFolder/);
    expect(chipSource).toMatch(/chat\.setPipiOutputFolder/);
    expect(chipSource).toMatch(/chat\.pipiOutputFolderTooltip/);
  });

  it('mounts both chip kinds in the chat input folder bar', () => {
    // Two-folder model: SessionFolderBar renders BOTH a `kind="project"` chip
    // and a `kind="output"` chip. Removing one must not remove the
    // other.
    expect(barSource).toMatch(/kind="project"/);
    expect(barSource).toMatch(/kind="output"/);
  });

  it('shows folder chips as soon as a session exists (not gated on messages)', () => {
    // Folder binding is a pre-flight step — users should be able to set
    // folders before sending the first message.
    expect(source).toMatch(/Two-folder chips — always visible once a session exists/);
    expect(source).toMatch(/\{currentSession && \(/);
    expect(source).not.toMatch(/currentSession\.messages\.length > 0/);
  });

  it('exposes independent bind and clear handlers for each folder', () => {
    // The two-folder model requires that removing one folder does
    // not remove the other. AG-13 PR4 extracted the store wiring into
    // useSessionFolderBindings; ChatInput must still mount that hook,
    // and the hook must call the four independent store actions.
    expect(source).toMatch(/useSessionFolderBindings/);
    expect(folderBindingsSource).toMatch(/setSessionProjectDir/);
    expect(folderBindingsSource).toMatch(/setSessionPipiOutputDir/);
    expect(folderBindingsSource).toMatch(/clearSessionProjectDir/);
    expect(folderBindingsSource).toMatch(/clearSessionPipiOutputDir/);
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

describe('AgentPanel Working folders empty copy', () => {
  const source = readSource('src/components/AgentPanel.tsx');
  const sectionsSource = readSource('src/components/agentPanelSections.tsx');
  const uiSource = readSource('src/components/agentPanelUi.tsx');

  it('uses i18n empty-state keys instead of hardcoded Drop-files copy', () => {
    // Soak/debug glance: empty Working Folders should read clearly in
    // both locales, not a faint "Drop files here…" stub.
    expect(source).toMatch(/AgentPanelWorkingFoldersSection/);
    expect(sectionsSource).toMatch(/agentPanel\.workingFolders\.title/);
    expect(sectionsSource).toMatch(/agentPanel\.workingFolders\.emptyTitle/);
    expect(sectionsSource).toMatch(/agentPanel\.workingFolders\.emptyHint/);
    expect(sectionsSource).toMatch(/data-testid="working-folders-empty"/);
    expect(sectionsSource).not.toMatch(/Drop files here to add to context/);
  });

  it('hides the Working folders count badge when the list is empty', () => {
    // Progress already omits count at 0; Working folders should match
    // so a "0" chip does not clutter the empty glance.
    // split-soon PR1 extracted the badge into workingFoldersCountBadge;
    // split-soon PR2 extracted the section into agentPanelSections.tsx.
    // AgentPanel must wire the section, sectionsSource must wire the badge,
    // and the helper must return undefined at 0.
    expect(source).toMatch(/AgentPanelWorkingFoldersSection/);
    expect(sectionsSource).toMatch(
      /count=\{workingFoldersCountBadge\(syncedFiles\.length, allWorkingFiles\.length\)\}/,
    );
    expect(uiSource).toMatch(/export function workingFoldersCountBadge/);
    expect(uiSource).toMatch(/return total > 0 \? String\(total\) : undefined/);
  });
});
