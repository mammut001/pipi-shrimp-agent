import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChatInput } from '@/components/ChatInput';
import { ChatMessage } from '@/components/ChatMessage';
import { AsciiPreviewBlock } from '@/components/workflow/AsciiPreviewBlock';
import { t, type TranslationKeys } from '@/i18n';
import { SESSION_GOAL_CLARIFIER_TEMPLATE } from '@/services/agents/templates/sessionGoalClarifier';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import {
  tryParseGoalPreflightResult,
  type GoalPreflightResult,
} from '@/services/goal/preflight/schema';
import { createMessage, type Message } from '@/types/chat';

interface SessionGoalClarifyPanelProps {
  initialGoal?: string;
  onApply: (result: GoalPreflightResult) => void;
  onClose?: () => void;
}

const QUICK_START_CHIPS: ReadonlyArray<{ id: string; label: keyof TranslationKeys }> = [
  { id: 'modern-login-ui', label: 'workflow.goalPreflight.quickStart.login' },
  { id: 'refactor-with-tests', label: 'workflow.goalPreflight.quickStart.refactor' },
  { id: 'design-research-workflow', label: 'workflow.goalPreflight.quickStart.research' },
];

function createAssistantShell(): Message {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  };
}

function toHeadlessMessages(messages: Message[]) {
  return messages
    .filter((message): message is Message & { role: 'user' | 'assistant' } => (
      message.role === 'user' || message.role === 'assistant'
    ))
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function deriveQuickStartDraft(chipId: string): string {
  switch (chipId) {
    case 'modern-login-ui':
      return t('workflow.goalPreflight.quickStart.loginDraft');
    case 'refactor-with-tests':
      return t('workflow.goalPreflight.quickStart.refactorDraft');
    case 'design-research-workflow':
      return t('workflow.goalPreflight.quickStart.researchDraft');
    default:
      return '';
  }
}

export function SessionGoalClarifyPanel({
  initialGoal,
  onApply,
  onClose,
}: SessionGoalClarifyPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftKey, setDraftKey] = useState('session-goal-clarify-initial');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GoalPreflightResult | null>(null);
  const [parseWarning, setParseWarning] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const lastFinalizedAtRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!initialGoal?.trim()) return;
    try {
      localStorage.setItem(`chat_draft_${draftKey}`, initialGoal);
    } catch {
      // best-effort
    }
  }, [draftKey, initialGoal]);

  const appendAssistantChunk = useCallback((messageId: string, chunk: string) => {
    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? { ...message, content: `${message.content}${chunk}` }
        : message
    )));
  }, []);

  const handleSend = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    setError(null);
    setParseWarning(null);

    const userMessage = createMessage('user', trimmed);
    const assistantShell = createAssistantShell();
    const nextMessages = [...messagesRef.current, userMessage, assistantShell];
    setMessages(nextMessages);
    setIsStreaming(true);

    try {
      const turn = await runHeadlessAgentTurn({
        sessionId: `session-goal-clarify-${Date.now()}`,
        initialMessages: toHeadlessMessages(nextMessages),
        systemPrompt: [
          SESSION_GOAL_CLARIFIER_TEMPLATE.soulPrompt,
          SESSION_GOAL_CLARIFIER_TEMPLATE.taskInstruction,
        ].filter(Boolean).join('\n\n'),
        allowedTools: SESSION_GOAL_CLARIFIER_TEMPLATE.allowedTools ?? [],
        onTextDelta: (chunk) => appendAssistantChunk(assistantShell.id, chunk),
      });

      const finalAssistant = turn.finalText ?? '';
      const parsed = tryParseGoalPreflightResult(finalAssistant);
      if (parsed && parsed.status === 'ready' && lastFinalizedAtRef.current !== finalAssistant) {
        lastFinalizedAtRef.current = finalAssistant;
        setResult(parsed);
      } else if (!parsed) {
        setParseWarning(t('workflow.goalPreflight.parseFailed'));
      }
    } catch (runnerError) {
      setError(runnerError instanceof Error ? runnerError.message : String(runnerError));
    } finally {
      setIsStreaming(false);
    }
  }, [appendAssistantChunk, isStreaming]);

  const handleQuickStart = useCallback((chipId: string) => {
    const opener = deriveQuickStartDraft(chipId);
    const nextDraftKey = `session-goal-clarify-${Date.now()}`;
    try {
      localStorage.setItem(`chat_draft_${nextDraftKey}`, opener);
    } catch {
      // best-effort
    }
    setDraftKey(nextDraftKey);
  }, []);

  const resultCard = useMemo(() => {
    if (!result) return null;

    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p className="font-semibold">{t('workflow.goalPreflight.readyEyebrow')}</p>
          <p className="mt-1 text-xs">{t('workflow.goalPreflight.readinessLabel')}: {result.readinessScore}/100</p>
        </div>
        <section className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{t('workflow.goalPreflight.finalGoal')}</h4>
          <p className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{result.finalGoal}</p>
        </section>
        <section className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{t('workflow.goalPreflight.successCriteria')}</h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-gray-900 space-y-1">
            {result.successCriteria.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{t('workflow.goalPreflight.asciiPreview')}</h4>
          <div className="mt-2">
            <AsciiPreviewBlock text={result.asciiPreview} />
          </div>
        </section>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onApply(result)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {t('goal.clarify.apply')}
          </button>
          <button
            type="button"
            onClick={() => handleSend(t('workflow.goalPreflight.askMoreAutoPrompt'))}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            {t('workflow.goalPreflight.askMore')}
          </button>
        </div>
      </div>
    );
  }, [handleSend, onApply, result]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-gray-200 bg-white/90">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">{t('goal.clarify.eyebrow')}</p>
            <h3 className="text-sm font-semibold text-gray-900">{t('goal.clarify.title')}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{t('goal.clarify.subtitle')}</p>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800">
              {t('common.close')}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-rows-[1fr_auto] lg:grid-rows-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-gray-100">
          <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-gray-50">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-4">
                  {t('goal.clarify.emptyState')}
                </p>
                <div className="grid gap-2">
                  {QUICK_START_CHIPS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => handleQuickStart(chip.id)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-xs hover:border-emerald-400"
                    >
                      {t(chip.label)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isLatest={index === messages.length - 1}
                    isStreaming={isStreaming && index === messages.length - 1 && message.role === 'assistant'}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="p-3 border-t border-gray-100 bg-white space-y-2">
            {parseWarning && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">{parseWarning}</p>
            )}
            {error && (
              <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{error}</p>
            )}
            <ChatInput
              key={draftKey}
              draftKey={draftKey}
              submitMode="callback-only"
              density="compact"
              onSend={(message) => void handleSend(message)}
            />
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto p-3 bg-white">
          {resultCard ?? (
            <p className="text-xs text-gray-400 rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center">
              {isStreaming ? t('workflow.goalPreflight.progressStreaming') : t('goal.clarify.waiting')}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
