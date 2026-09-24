import { invoke } from '@tauri-apps/api/core';

import type { ChatState } from '../../types/chat';
import { sessionToDb } from '../../utils/chatHelpers';
import { safeInvoke } from '../../utils/safeInvoke';
import { getSessionPipiOutputDir as resolveSessionPipiOutputDirHelper } from '../../utils/sessionFolders';
import { safeRemoveItem, safeSetItem } from '../../utils/safeStorage';
import { useArtifactsStore } from '../artifactsStore';
import { useUIStore } from '../uiStore';

export const CURRENT_SESSION_ID_STORAGE_KEY = 'pipi-shrimp-current-session-id';
export const LEGACY_CURRENT_SESSION_ID_STORAGE_KEY = 'ai-agent-current-session-id';

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

export async function ensureSessionWorkDir(sessionId: string, set: ChatSetState, get: () => ChatState): Promise<string | null> {
  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    return null;
  }
  // Two-folder model: this helper provisions the app-managed PiPi
  // Output Folder (the .pipi-shrimp/, docs, memory, AutoResearch root).
  // Use `getSessionPipiOutputDir` so a pre-v7 session that already has
  // `workDir` set (and migrated it to `projectDir`) doesn't get its
  // PiPi Output Folder accidentally pointed at the user's repo.
  const existing = resolveSessionPipiOutputDirHelper(session);
  if (existing && session.pipiOutputDir) {
    return existing;
  }

  const maxRetries = 3;
  const baseDelayMs = 1000;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const defaultDir = await safeInvoke<string>('get_app_default_dir', { sessionId });
      await safeInvoke('create_directory', { path: defaultDir });
      const latestSession = get().sessions.find((candidate) => candidate.id === sessionId) ?? session;
      // Persist onto `pipiOutputDir` (the new field). Leave
      // `projectDir`/`workDir` alone so the Project Folder binding
      // stays independent.
      const updated = { ...latestSession, pipiOutputDir: defaultDir, updatedAt: Date.now() };
      await safeInvoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({
        sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)),
      }));
      return defaultDir;
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        console.error('[workDir] Failed to auto-assign default directory after retries:', error);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }

  // AUDIT-FIX [fix-6#1] — Surface the failure to the user via a toast
  // notification. The previous behaviour silently returned `null`, leaving
  // the user staring at a chat session that has no working directory and
  // every tool call will subsequently fail.
  try {
    useUIStore.getState().addNotification(
      'error',
      `Failed to create session work directory: ${String(
        lastError instanceof Error ? lastError.message : lastError ?? 'unknown error',
      )}`,
      sessionId,
    );
  } catch {
    // UI store may not be ready; the console.error above is the fallback.
  }
  return null;
}

/**
 * Shared "bind a folder to a session" flow used by both
 * `setSessionProjectDir` (folder picker) and
 * `setSessionProjectDirFromPath` (caller-supplied path, e.g. from a
 * "Set parent folder as workspace?" toast action).
 *
 * Two-folder model: the bound folder is the **Project Folder** (the
 * user's repo). The PiPi Output Folder is independent — it stays on
 * the app-managed default unless the caller has explicitly set one.
 *
 * The function reads the project tree (README / tech-stack /
 * structure) from the Project Folder for the auto-scan, then writes
 * the seed `core.md` into the PiPi Output Folder so we don't
 * introduce `.pipi-shrimp/` into the user's repo. If the user has
 * not yet bound a PiPi Output Folder, we auto-provision the
 * app-managed default first.
 *
 * Steps:
 * 1. Ensure a PiPi Output Folder exists (auto-provision the
 *    app-managed default when none is bound).
 * 2. `init_pipi_shrimp` against the PiPi Output Folder so the
 *    `.pipi-shrimp/` metadata tree lives there, not in the user's
 *    repo.
 * 3. On a fresh init, run the README / tech-stack / top-level-structure
 *    auto-scan against the Project Folder and seed the
 *    `.pipi-shrimp/core.md` *into the PiPi Output Folder*.
 * 4. Persist `projectDir` (and the legacy `workDir` mirror) to the DB
 *    and update the in-memory store.
 */
export async function bindSessionWorkDirPath(
  sessionId: string,
  selectedPath: string,
  set: ChatSetState,
  get: () => ChatState,
): Promise<string | null> {
  // Make sure we have a PiPi Output Folder before we touch
  // `init_pipi_shrimp`. The Rust helper expects an existing folder to
  // populate — it does not own the lifecycle of the directory itself.
  const ensuredPipiOutput = await ensureSessionWorkDir(sessionId, set, get);
  const pipiOutputDir = ensuredPipiOutput ?? get().sessions.find((candidate) => candidate.id === sessionId)?.pipiOutputDir;

  if (pipiOutputDir) {
    try {
      const initResult = await invoke<string>('init_pipi_shrimp', { workDir: pipiOutputDir });
      const isNewProject = initResult.endsWith('|new');
      if (isNewProject) {
        // Build the project overview from the user's repo (the Project
        // Folder) but write the seed `core.md` into the PiPi Output
        // Folder so we don't drop a `.pipi-shrimp/` directory into the
        // repo by default.
        try {
          const lines: string[] = ['## 📌 Project Overview\n'];
          for (const name of ['README.md', 'readme.md', 'README.txt']) {
            try {
              const res = await invoke<{ content: string }>('read_file', { path: `${selectedPath}/${name}`, workDir: selectedPath });
              if (res?.content) {
                lines.push(`### README\n\`\`\`\n${res.content.split('\n').slice(0, 20).join('\n')}\n\`\`\`\n`);
                break;
              }
            } catch {
              // ignore missing file
            }
          }
          const techStack: string[] = [];
          for (const { file, label } of [
            { file: 'package.json', label: 'Node.js / JS/TS' },
            { file: 'Cargo.toml', label: 'Rust' },
            { file: 'pyproject.toml', label: 'Python' },
            { file: 'go.mod', label: 'Go' },
            { file: 'pom.xml', label: 'Java/Maven' },
            { file: 'build.gradle', label: 'Java/Gradle' },
          ]) {
            try {
              await invoke('read_file', { path: `${selectedPath}/${file}`, workDir: selectedPath });
              techStack.push(label);
            } catch {
              // ignore missing manifest
            }
          }
          if (techStack.length > 0) {
            lines.push(`## 🛠 Tech Stack\n${techStack.map((entry) => `- ${entry}`).join('\n')}\n`);
          }
          try {
            const entries = await invoke<{ name: string; is_dir: boolean }[]>('list_files', { path: selectedPath });
            lines.push(`## 📖 Top-level Structure\n${[
              ...entries.filter((entry) => entry.is_dir).map((entry) => `📁 ${entry.name}`),
              ...entries.filter((entry) => !entry.is_dir).map((entry) => `📄 ${entry.name}`),
            ].join('\n')}\n`);
          } catch {
            // ignore list failure
          }
          // The core memory file lives in the PiPi Output Folder, not
          // the Project Folder. Two-folder model separation.
          const coreMdPath = `${pipiOutputDir}/core.md`;
          const coreRes = await invoke<{ content: string }>('read_file', { path: coreMdPath, workDir: pipiOutputDir });
          await invoke('write_file', {
            path: coreMdPath,
            content: (coreRes?.content ?? '').replace(
              '## 📌 Project Overview\n[Auto-detected on bind — see below]\n\n## 🛠 Tech Stack\n[Auto-detected on bind — see below]',
              lines.join('\n'),
            ),
            workDir: pipiOutputDir,
          });
        } catch (error) {
          console.debug('[setSessionProjectDir] auto-scan failed (non-fatal):', error);
        }
      }
    } catch (error) {
      // Don't block the bind if the PiPi Output Folder can't be
      // initialised — the user can still work in Project Folder mode
      // and the next bind attempt will retry.
      console.debug('[setSessionProjectDir] init_pipi_shrimp against output dir failed (non-fatal):', error);
    }
  }

  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    return null;
  }
  // Two-folder model: persist to `projectDir` (the new field) and
  // mirror into `workDir` (the legacy field) so downgrades / pre-v7
  // callers keep working. `pipiOutputDir` is intentionally untouched
  // here — the app-managed default takes over unless the user binds
  // a custom output folder.
  const updated = {
    ...session,
    projectDir: selectedPath,
    workDir: selectedPath,
    updatedAt: Date.now(),
  };
  await invoke('db_save_session', { session: sessionToDb(updated) });
  set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
  return selectedPath;
}

export function resetRightPanelStateAfterSessionRemoval(
  deletedSessionIds: string[],
  nextSessionId: string | null,
  previousCurrentSessionId: string | null,
) {
  const uiStore = useUIStore.getState();
  const artifactsStore = useArtifactsStore.getState();
  const currentSessionWasDeleted = previousCurrentSessionId
    ? deletedSessionIds.includes(previousCurrentSessionId)
    : false;

  for (const sessionId of deletedSessionIds) {
    uiStore.clearQuestionnaire(sessionId);
    uiStore.clearPermissionsForSession(sessionId);
  }

  if (currentSessionWasDeleted || nextSessionId === null) {
    if (nextSessionId === null) {
      uiStore.clearAllPermissions();
    }
    uiStore.clearArtifactId();
    uiStore.clearTaskProgress();
    uiStore.setActiveSkill(null);
    uiStore.setAgentPanelTab('main');
    artifactsStore.closePanel();
  }

  if (nextSessionId) {
    // AUDIT-FIX [fix-22#1] — Use the safe localStorage helper so a quota
    // or private-mode error doesn't crash the persistence path.
    safeSetItem(CURRENT_SESSION_ID_STORAGE_KEY, nextSessionId);
  } else {
    safeRemoveItem(CURRENT_SESSION_ID_STORAGE_KEY);
  }
}
