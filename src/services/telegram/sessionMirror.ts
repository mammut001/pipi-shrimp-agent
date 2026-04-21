import { invoke } from '@tauri-apps/api/core';

import { useChatStore } from '@/store';
import { createMessage, createSession, type Session } from '@/types/chat';
import type { TelegramBinding, TelegramTask } from '@/types/telegramTask';
import { formatTelegramTaskRef } from '@/types/telegramTask';

interface DbSessionPayload {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  cwd: string | null;
  project_id: string | null;
  model: string | null;
  work_dir: string | null;
  working_files: string | null;
  permission_mode: Session['permissionMode'] | null;
}

function sessionToDb(session: Session): DbSessionPayload {
  return {
    id: session.id,
    title: session.title,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    cwd: session.cwd || null,
    project_id: session.projectId || null,
    model: session.model || null,
    work_dir: session.workDir || null,
    working_files: session.workingFiles ? JSON.stringify(session.workingFiles) : null,
    permission_mode: session.permissionMode || null,
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

  session.permissionMode = binding.defaultPermissionMode;
  const initialWorkDir = binding.defaultWorkDir ?? currentSession?.workDir;
  if (initialWorkDir) {
    session.cwd = initialWorkDir;
    session.workDir = initialWorkDir;
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

  const updatedSession: Session = {
    ...session,
    cwd: workDir,
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