/**
 * Workspace Folder vs Context Files — product copy test
 *
 * This is a "contract test" for the user-facing wording. It walks the
 * ChatInput and FileDropOverlay JSX and asserts that the strings we ship
 * to the user match the agreed product terminology. We intentionally
 * test the *source code* of the components instead of rendering them
 * (rendering would pull in Tauri, Zustand, and a dozen providers); the
 * test would still fail loudly if a developer reverted to the old
 * "Bind folder" / "Working Files" copy.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', '..', '..', relativePath), 'utf8');
}

describe('ChatInput workspace copy', () => {
  const source = readSource('src/components/ChatInput.tsx');

  it('uses the new "workspace" terminology in the chip labels', () => {
    expect(source).toMatch(/chat\.workspaceFolder/);
    expect(source).toMatch(/chat\.setWorkspaceFolder/);
  });

  it('exposes a tooltip explaining the workspace folder', () => {
    expect(source).toMatch(/chat\.workspaceFolderTooltip/);
    // The tooltip text itself lives in the i18n bundle, not in the JSX.
    // We assert the bundled copy below, alongside the JSX key reference.
  });

  it('renders a hint when the session has no workspace', () => {
    expect(source).toMatch(/chat\.noWorkspaceHint/);
    expect(source).toMatch(/data-testid="workspace-folder-missing-hint"/);
  });
});

describe('FileDropOverlay context files copy', () => {
  const source = readSource('src/components/FileDropOverlay.tsx');

  it('labels dropped files as Context Files', () => {
    expect(source).toMatch(/chat\.contextFiles/);
    expect(source).toMatch(/chat\.input\.contextFilesHeader/);
  });

  it('does not advertise dropped files as the workspace folder', () => {
    // The old "Bind folder" / "Drag files here to bind" wording is gone.
    // We still reference `t('chat.input.dragFilesHere')` as a fallback
    // for the empty-state drag hint *if* a translation provides it, so
    // the assertion is scoped to the user-visible messages we render.
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

  it('wires the "Set parent as workspace?" toast action to the chat store', () => {
    // The toast now carries an `action` payload that calls
    // `setSessionWorkDirFromPath(currentSessionId, candidateParent)` so
    // the user can adopt the suggested folder in a single click.
    expect(source).toMatch(/setSessionWorkDirFromPath/);
    expect(source).toMatch(/chat\.useAsWorkspace/);
    // The action object literal must live inside the addNotification call.
    expect(source).toMatch(/label:\s*t\('chat\.useAsWorkspace'\)/);
  });
});
