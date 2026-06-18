import { invoke } from '@tauri-apps/api/core';

import { hydrateSessionModes } from '@/services/executionMode';
import type { TelegramBinding, TelegramTask } from '@/types/telegramTask';
import { formatTelegramTaskRef } from '@/types/telegramTask';
import { useChatStore } from '@/store/createChatStore';
import type { Session } from '@/types/chat';
import { createMessage, createSession } from '@/types/chat';

interface DbSessionPayload {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  cwd: string | null;
  project_id: string | null;
  model: string | null;
  work_dir: string | null;
  project_dir: string | null;
  pipi_output_dir: string | null;
  working_files: string | null;
  permission_mode: Session['permissionMode'] | null;
  execution_mode: string | null;
}

function sessionToDb(session: Session): DbSessionPayload {
  // Two-folder model: mirror the Project Folder into `work_dir` for
  // backwards compat and persist both new fields independently.
  const effectiveProjectDir = session.projectDir || session.workDir || null;
  return {
    id: session.id,
    title: session.title,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    cwd: session.cwd || null,
    project_id: session.projectId || null,
    model: session.model || null,
    work_dir: effectiveProjectDir,
    project_dir: effectiveProjectDir,
    pipi_output_dir: session.pipiOutputDir || null,
    working_files: session.workingFiles ? JSON.stringify(session.workingFiles) : null,
    permission_mode: session.permissionMode || null,
    execution_mode: session.executionMode || null,
  };
}

function upsertSessionInStore(session: Session): void {
  useChatStore.setState((state) => {
    const existingIndex = state.sessions.findIndex((candidate) => candidate.id === session.id);
    if (existingIndex === -1) {
      return {
        sessions: [...state.sessions, session],
      };
    }

    const nextSessions = [...state.sessions];
    nextSessions[existingIndex] = session;
    return {
      sessions: nextSessions,
    };
  });
}

function buildSessionTitle(prompt: string): string {
  const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim();
  if (!normalizedPrompt) {
    return 'Telegram Task';
  }

  return normalizedPrompt.length > 40
    ? `TG · ${normalizedPrompt.slice(0, 40)}…`
    : `TG · ${normalizedPrompt}`;
}

function buildSourceNote(task: TelegramTask, binding: TelegramBinding): string {
  return [
    `Telegram 任务 ${formatTelegramTaskRef(task.id)} 已同步到桌面端。`,
    `来源 chat：${binding.displayName}`,
    '下面是手机端发来的原始需求。',
  ].join('\n');
}

export async function createTelegramTaskSession(
  task: TelegramTask,
  binding: TelegramBinding,
): Promise<Session> {
  const currentSession = useChatStore.getState().currentSession();
  const session = createSession(
    buildSessionTitle(task.prompt),
    binding.defaultProjectId ?? currentSession?.projectId,
    currentSession?.model,
  );

  const withBindingMode = hydrateSessionModes({
    ...session,
    permissionMode: binding.defaultPermissionMode,
  });
  Object.assign(session, withBindingMode);
  // Two-folder model: bind the **Project Folder** (the user's repo)
  // to the new session. The PiPi Output Folder stays on the app-managed
  // default unless the user (or the binding) explicitly sets one.
  const initialProjectDir = binding.defaultWorkDir ?? currentSession?.workDir;
  if (initialProjectDir) {
    session.cwd = initialProjectDir;
    session.projectDir = initialProjectDir;
    session.workDir = initialProjectDir;
  }
  // Inherit the PiPi Output Folder from the current session when the
  // binding doesn't carry one. Bindings themselves only model a single
  // `default_work_dir` (legacy shape), so we don't introduce a second
  // binding column here.
  if (currentSession?.pipiOutputDir) {
    session.pipiOutputDir = currentSession.pipiOutputDir;
  }

  await invoke('db_save_session', { session: sessionToDb(session) });
  upsertSessionInStore(session);

  await useChatStore.getState().addMessageToSession(
    session.id,
    createMessage('assistant', buildSourceNote(task, binding)),
  );
  await useChatStore.getState().addMessageToSession(
    session.id,
    createMessage('user', task.prompt),
  );

  return session;
}

export async function updateTelegramTaskSessionWorkDir(
  sessionId: string,
  workDir: string,
): Promise<void> {
  const session = useChatStore.getState().sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    return;
  }

  // Two-folder model: `workDir` here is the **Project Folder** (the
  // user's repo). Mirror into both `projectDir` and `workDir`. The PiPi
  // Output Folder is intentionally untouched.
  const updatedSession: Session = {
    ...session,
    cwd: workDir,
    projectDir: workDir,
    workDir,
    updatedAt: Date.now(),
  };

  await invoke('db_save_session', { session: sessionToDb(updatedSession) });
  upsertSessionInStore(updatedSession);
}

export async function appendTelegramTaskResult(
  sessionId: string,
  content: string,
): Promise<void> {
  const finalContent = content.trim() || '任务已完成，但没有生成额外文本输出。';
  await useChatStore.getState().addMessageToSession(
    sessionId,
    createMessage('assistant', finalContent),
  );
}

export async function appendTelegramTaskError(
  sessionId: string,
  errorMessage: string,
): Promise<void> {
  await useChatStore.getState().addMessageToSession(
    sessionId,
    createMessage('assistant', `任务执行失败：${errorMessage}`),
  );
}