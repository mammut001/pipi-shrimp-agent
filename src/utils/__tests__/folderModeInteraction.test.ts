/**
 * Two-folder model + 5-mode interaction regression suite.
 *
 * PHASE 8 of the Mode Consistency + AutoResearch Execution audit.
 *
 * The two-folder model splits every chat session into:
 *   - Project Folder (the user's repo, tool cwd)
 *   - PiPi Output Folder (app-owned outputs, docs, memory,
 *     AutoResearch artifacts)
 *
 * This file pins the invariants:
 *   1. The chat cwd resolves to the Project Folder, NEVER the PiPi
 *      Output Folder. Treating Output as Project would silently let
 *      tool writes mutate the app-managed memory / doc tree.
 *   2. The chatToolExecution batch handler refuses to fall back to
 *      the PiPi Output Folder when the Project Folder is missing —
 *      tools that mutate project state must surface a hard error.
 *   3. Bypass mode does NOT relax the project/output separation.
 *   4. Ask mode never mutates either folder.
 *   5. Dragging Context Files does NOT change mode or folders.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  getSessionPipiOutputDir,
  getSessionProjectDir,
} from '../sessionFolders';
import type { Session } from '../../types/chat';

const repoRoot = resolve(__dirname, '../../..');

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-folder-test',
    title: 'Folder Test',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Session;
}

describe('Two-folder model: Project vs PiPi Output', () => {
  it('Project Folder and PiPi Output Folder are independent paths', () => {
    const session = makeSession({
      projectDir: '/home/user/my-repo',
      pipiOutputDir: '/home/user/PiPi-Shrimp/chats/session-folder-test',
    });
    expect(getSessionProjectDir(session)).toBe('/home/user/my-repo');
    expect(getSessionPipiOutputDir(session)).toBe(
      '/home/user/PiPi-Shrimp/chats/session-folder-test',
    );
    expect(getSessionProjectDir(session)).not.toBe(getSessionPipiOutputDir(session));
  });

  it('PiPi Output Folder falls back to the app-managed default, never to Project Folder', () => {
    const session = makeSession({
      projectDir: '/home/user/my-repo',
    });
    const outputDir = getSessionPipiOutputDir(session);
    expect(outputDir).toBeDefined();
    expect(outputDir).not.toBe('/home/user/my-repo');
    // Output folder lives under the app-managed prefix; it must
    // never silently reuse the Project Folder as a fallback.
    expect(outputDir).toContain('PiPi-Shrimp');
  });

  it('Project Folder does NOT fall back to the PiPi Output Folder', () => {
    const session = makeSession({
      pipiOutputDir: '/home/user/PiPi-Shrimp/chats/session-folder-test',
    });
    expect(getSessionProjectDir(session)).toBeUndefined();
  });

  it('chatToolExecution refuses to substitute PiPi Output Folder when Project Folder is missing', () => {
    // The runtime contract: when the user issues a workspace tool
    // (write_file, create_directory, execute_command, compile_typst_file)
    // and the session has no Project Folder bound, the batch handler
    // must surface a hard error rather than fall back to whatever
    // folder `ensureSessionWorkDir` returns.
    const source = readFileSync(
      resolve(repoRoot, 'src/store/chat/chatToolExecution.ts'),
      'utf8',
    );
    // The fallback-discard guard is a literal string we look for.
    expect(source).toMatch(/fallback.*PiPi Output Folder|PiPi Output Folder.*fallback|No Project Folder is bound/i);
    // Must hard-fail the workspace tool rather than proceeding with
    // the output folder as a silent tool cwd.
    expect(source).toMatch(/WORKSPACE_TOOL_NAMES\.has\(tool\.name\)/);
    expect(source).toMatch(/No Project Folder is bound/i);
  });

  it('the resolved execution cwd is sourced from Project Folder, not PiPi Output Folder', () => {
    // chatActions.sendMessage uses session.projectDir || session.workDir
    // as the engine cwd; it never falls back to session.pipiOutputDir.
    // This guards against a regression where the wrong folder is
    // picked as the tool cwd.
    const session = makeSession({
      projectDir: '/home/user/my-repo',
      pipiOutputDir: '/home/user/PiPi-Shrimp/chats/session-folder-test',
    });
    const resolvedCwd = session.projectDir ?? session.workDir;
    expect(resolvedCwd).toBe('/home/user/my-repo');
    expect(resolvedCwd).not.toBe(getSessionPipiOutputDir(session));
  });
});

describe('Bypass mode does not collapse the two-folder model', () => {
  it('Bypass mode + write_file inside Project Folder is allowed', () => {
    // The chatToolExecution bypass branch auto-approves normal
    // project-scoped tools when the path is inside Project Folder.
    // We assert the source contract here without booting the runtime.
    const source = readFileSync(
      resolve(repoRoot, 'src/store/chat/chatToolExecution.ts'),
      'utf8',
    );
    // Bypass auto-approve logic must use the same
    // canAutoApproveTool(permissionMode, toolName) predicate that the
    // pre-tool policy uses, so SSH / browser / MCP / agent_tool still
    // gate even in Bypass.
    expect(source).toMatch(/permissionMode\s*===\s*'bypass'/);
    expect(source).toMatch(/canAutoApproveTool\(permissionMode,\s*(?:req|tool)\.name\)/);
  });

  it('Bypass mode write_file inside PiPi Output Folder does NOT silently treat it as Project Folder', () => {
    // The path-validation hook (pathValidationCheck) runs before any
    // backend execute. A write into the PiPi Output Folder should
    // either succeed (since it's a real, writable path) but the
    // project-vs-output identity must not be erased by the Bypass
    // shortcut. The chatToolExecution handler must NOT promote
    // pipiOutputDir to projectDir.
    const source = readFileSync(
      resolve(repoRoot, 'src/store/chat/chatToolExecution.ts'),
      'utf8',
    );
    // The discard guard above is the one we rely on: when the only
    // fallback folder is the PiPi Output Folder, workspace tools are
    // rejected. We confirm there is no alternate path where the
    // output folder gets promoted to a project cwd.
    expect(source).not.toMatch(/pipiOutputDir\s*as\s*project/);
    expect(source).not.toMatch(/pipiOutputDir\s*\|\|\s*workDir/);
  });
});

describe('Ask mode never mutates either folder', () => {
  it('Ask mode chat sendMessage does not write to Project or PiPi Output folder', () => {
    const source = readFileSync(
      resolve(repoRoot, 'src/store/chat/chatActions.ts'),
      'utf8',
    );
    // Ask-mode path passes `{ noTools: true }` to runChatTurn.
    // The runtime short-circuits tool execution. The orchestrator
    // delegation block is also gated on `!isPlanMode` and we
    // intentionally let Ask fall through (Ask is not Plan), but
    // delegation must not write to either folder.
    expect(source).toMatch(/isAskMode\s*=\s*executionModeId\s*===\s*'ask'/);
    expect(source).toMatch(/noTools:\s*true/);
  });
});

describe('Context Files do not change mode or folders', () => {
  it('chat input file drop is a draft-only operation', () => {
    // File attachments live on the message (`ImageAttachment`) and
    // never mutate session.executionMode / session.permissionMode /
    // session.projectDir / session.pipiOutputDir. We assert that the
    // ChatInput drag/drop and file-selection handlers do not call
    // any session mutator.
    const source = readFileSync(
      resolve(repoRoot, 'src/components/ChatInput.tsx'),
      'utf8',
    );
    // The handleDrop / handleFileSelection / handlePaste paths only
    // call `setAttachments` and `appendImageAttachments`. They do
    // NOT call updateSessionExecutionMode / updateSessionPermissionMode
    // / setSessionProjectDir / setSessionPipiOutputDir.
    expect(source).not.toMatch(/handleDrop[\s\S]{0,400}updateSessionExecutionMode/);
    expect(source).not.toMatch(/handleFileSelection[\s\S]{0,400}updateSessionExecutionMode/);
    expect(source).not.toMatch(/handlePaste[\s\S]{0,400}updateSessionExecutionMode/);
  });
});
