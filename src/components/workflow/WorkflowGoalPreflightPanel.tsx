/**
 * WorkflowGoalPreflightPanel — Conversational Goal Clarifier for Workflow
 *
 * This is a self-contained panel that opens from `WorkflowGoalPanel`. It runs
 * a headless chat with a Goal Clarifier agent, shows a streaming assistant
 * response, and — when the clarifier returns a parseable `GoalPreflightResult`
 * — surfaces a confirmation card with the structured fields.
 *
 * Architectural notes:
 *  - The component is intentionally *passive*. It does not start the
 *    workflow engine, mutate the workflow store, or create agents. It
 *    computes the final `GoalPreflightResult` and emits it through callbacks
 *    (`onApply`, `onApplyAndStart`, `onClose`) so the parent can decide what
 *    to do — the same way `BootstrapChatView` does for AutoResearch.
 *  - It does **not** auto-apply or auto-start. The user must always click
 *    an explicit action button. If JSON parsing fails, the assistant
 *    message is kept visible and a small warning is shown.
 *  - It does **not** auto-create suggested agents. A "create suggested
 *    agents" affordance is exposed only when the current instance has no
 *    agents at all (so the user has a clear escape hatch from an empty
 *    canvas), and even then it is gated behind a button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatInput } from '@/components/ChatInput';
import { ChatMessage } from '@/components/ChatMessage';
import { AsciiPreviewBlock } from './AsciiPreviewBlock';
import { t, type TranslationKeys } from '@/i18n';
import { createMessage, type Message } from '@/types/chat';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import { WORKFLOW_GOAL_CLARIFIER_TEMPLATE } from '@/services/agents/templates/workflowGoalClarifier';
import {
  tryParseGoalPreflightResult,
  serializeSuccessCriteria,
  type GoalPreflightResult,
} from '@/services/workflow/goalPreflight/schema';
import { useWorkflowStore } from '@/store/workflowStore';

interface WorkflowGoalPreflightPanelProps {
  /** Current workflow instance id (used to detect empty canvases & run engine). */
  instanceId: string;
  /** Optional initial draft goal — usually the existing `projectGoal`. */
  initialGoal?: string;
  /** Apply the clarifier result to the current workflow's metadata. */
  onApply?: (result: GoalPreflightResult) => void;
  /** Apply the result, then ask the parent to start the workflow engine. */
  onApplyAndStart?: (result: GoalPreflightResult) => void;
  /** Close the panel. The parent decides what "close" means. */
  onClose?: () => void;
}

const QUICK_START_CHIPS: ReadonlyArray<{ id: string; label: keyof TranslationKeys }> = [
  { id: 'modern-login-ui', label: 'workflow.goalPreflight.quickStart.login' },
  { id: 'refactor-with-tests', label: 'workflow.goalPreflight.quickStart.refactor' },
  { id: 'design-research-workflow', label: 'workflow.goalPreflight.quickStart.research' },
];

interface ClarifierRuntime {
  messages: Message[];
  draftKey: string;
  isStreaming: boolean;
  error: string | null;
  result: GoalPreflightResult | null;
  parseWarning: string | null;
  ready: boolean;
  questionText: string | null;
}

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

function buildSystemPrompt(): string {
  return [
    WORKFLOW_GOAL_CLARIFIER_TEMPLATE.soulPrompt,
    WORKFLOW_GOAL_CLARIFIER_TEMPLATE.taskInstruction,
  ].filter(Boolean).join('\n\n');
}

export function WorkflowGoalPreflightPanel({
  instanceId,
  initialGoal,
  onApply,
  onApplyAndStart,
  onClose,
}: WorkflowGoalPreflightPanelProps) {
  const agentsCount = useWorkflowStore((state) => {
    const inst = state.instances.find((item) => item.id === state.currentInstanceId);
    return inst?.agents.length ?? 0;
  });
  const createA_B_C_Workflow = useWorkflowStore((state) => state.createA_B_C_Workflow);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draftKey, setDraftKey] = useState('workflow-goal-preflight-initial');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GoalPreflightResult | null>(null);
  const [parseWarning, setParseWarning] = useState<string | null>(null);
  const [appliedFlag, setAppliedFlag] = useState<null | 'applied' | 'started'>(null);
  const messagesRef = useRef<Message[]>(messages);
  const lastFinalizedAtRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!initialGoal || initialGoal.trim().length === 0) return;
    // Only prefill the *draft* so the user still gets a chip-style entry point
    // and can edit before sending. We don't auto-send.
    try {
      localStorage.setItem(`chat_draft_${draftKey}`, initialGoal);
    } catch {
      // best-effort; localStorage may be unavailable in some test envs
    }
  }, [initialGoal, draftKey]);

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
      const result = await runHeadlessAgentTurn({
        sessionId: `workflow-goal-preflight-${Date.now()}`,
        initialMessages: toHeadlessMessages(nextMessages),
        systemPrompt: buildSystemPrompt(),
        allowedTools: WORKFLOW_GOAL_CLARIFIER_TEMPLATE.allowedTools ?? [],
        onTextDelta: (chunk) => appendAssistantChunk(assistantShell.id, chunk),
      });

      // After the run finishes, look at the final assistant message and try
      // to parse it as a structured `GoalPreflightResult`. If parsing fails
      // we just keep the assistant message and surface a non-blocking
      // warning — the user can still ask follow-up questions.
      const finalAssistant = result.finalText ?? '';
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
    const nextDraftKey = `workflow-goal-preflight-${Date.now()}`;
    try {
      localStorage.setItem(`chat_draft_${nextDraftKey}`, opener);
    } catch {
      // best-effort
    }
    setDraftKey(nextDraftKey);
  }, []);

  const handleApply = useCallback(() => {
    if (!result) return;
    onApply?.(result);
    setAppliedFlag('applied');
  }, [onApply, result]);

  const handleApplyAndStart = useCallback(() => {
    if (!result) return;
    onApplyAndStart?.(result);
    setAppliedFlag('started');
  }, [onApplyAndStart, result]);

  const handleCreateSuggestedAgents = useCallback(() => {
    if (!result) return;
    if (agentsCount > 0) return;
    // Only the *empty canvas* case is allowed to auto-create the A→B→C
    // preset here. For richer mappings, the user must wire suggestedAgents
    // onto the canvas themselves.
    createA_B_C_Workflow();
  }, [agentsCount, createA_B_C_Workflow, result]);

  const runtime = useMemo<ClarifierRuntime>(() => ({
    messages,
    draftKey,
    isStreaming,
    error,
    result,
    parseWarning,
    ready: result?.status === 'ready',
    questionText: null,
  }), [messages, draftKey, isStreaming, error, result, parseWarning]);

  const resultCard = result ? (
    <GoalPreflightResultCard
      result={result}
      appliedFlag={appliedFlag}
      agentsCount={agentsCount}
      instanceId={instanceId}
      onAskMore={() => {
        // Send a synthetic message asking the clarifier to refine the
        // last answer. The user can also type their own question.
        handleSend(t('workflow.goalPreflight.askMoreAutoPrompt'));
      }}
      onEdit={() => {
        // Closing the panel hands control back to the manual `WorkflowGoalPanel`.
        onClose?.();
      }}
      onApply={handleApply}
      onApplyAndStart={handleApplyAndStart}
      onCreateSuggestedAgents={handleCreateSuggestedAgents}
    />
  ) : null;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
      data-instance-id={instanceId}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-600">
            {t('workflow.goalPreflight.eyebrow')}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">
            {t('workflow.goalPreflight.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            {t('workflow.goalPreflight.subtitle')}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
          >
            {t('common.close')}
          </button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col overflow-hidden border-r border-gray-100">
          <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-5">
            {messages.length === 0 ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-6 text-sm text-gray-600">
                  {t('workflow.goalPreflight.emptyState')}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {QUICK_START_CHIPS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => handleQuickStart(chip.id)}
                      className="rounded-2xl border border-gray-200 bg-white p-4 text-left text-sm shadow-sm transition hover:border-sky-500 hover:shadow-md"
                    >
                      <p className="font-semibold text-gray-900">{t(chip.label)}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-0 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                {runtime.messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isLatest={index === runtime.messages.length - 1}
                    isStreaming={isStreaming && index === runtime.messages.length - 1 && message.role === 'assistant'}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-4">
            <div className="space-y-3">
              {parseWarning && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {parseWarning}
                </div>
              )}
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <ChatInput
                key={runtime.draftKey}
                draftKey={runtime.draftKey}
                submitMode="callback-only"
                density="compact"
                onSend={(message) => handleSend(message)}
              />
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden bg-white">
          <div className="border-b border-gray-100 px-5 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-600">
              {t('workflow.goalPreflight.cardEyebrow')}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-gray-900">
              {t('workflow.goalPreflight.confirmTitle')}
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {resultCard ?? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                {isStreaming
                  ? t('workflow.goalPreflight.progressStreaming')
                  : t('workflow.goalPreflight.progressIdle')}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------- Result card (subcomponent, kept private to this file) ----------

interface GoalPreflightResultCardProps {
  result: GoalPreflightResult;
  appliedFlag: null | 'applied' | 'started';
  agentsCount: number;
  instanceId: string;
  onAskMore: () => void;
  onEdit: () => void;
  onApply: () => void;
  onApplyAndStart: () => void;
  onCreateSuggestedAgents: () => void;
}

function GoalPreflightResultCard({
  result,
  appliedFlag,
  agentsCount,
  instanceId: _instanceId,
  onAskMore,
  onEdit,
  onApply,
  onApplyAndStart,
  onCreateSuggestedAgents,
}: GoalPreflightResultCardProps) {
  const successCriteriaText = useMemo(
    () => serializeSuccessCriteria(result.successCriteria),
    [result.successCriteria],
  );

  const canCreateAgents = agentsCount === 0;

  return (
    <div className="space-y-4" data-testid="workflow-goal-preflight-result">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <p className="font-semibold">{t('workflow.goalPreflight.readyEyebrow')}</p>
        <p className="mt-1 text-xs text-emerald-800">
          {t('workflow.goalPreflight.readinessLabel')}: {result.readinessScore}/100
        </p>
      </div>

      <ResultSection title={t('workflow.goalPreflight.finalGoal')}>
        <p className="whitespace-pre-wrap text-sm text-gray-900">{result.finalGoal}</p>
      </ResultSection>

      <ResultSection title={t('workflow.goalPreflight.successCriteria')}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-900">
          {result.successCriteria.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-gray-400">
          {t('workflow.goalPreflight.serializedPreview')}: <code className="rounded bg-gray-100 px-1.5 py-0.5">{successCriteriaText.split('\n')[0]}{successCriteriaText.split('\n').length > 1 ? '…' : ''}</code>
        </p>
      </ResultSection>

      {result.assumptions.length > 0 && (
        <ResultSection title={t('workflow.goalPreflight.assumptions')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {result.assumptions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </ResultSection>
      )}

      {result.openQuestions.length > 0 && (
        <ResultSection title={t('workflow.goalPreflight.openQuestions')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {result.openQuestions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </ResultSection>
      )}

      {result.suggestedAgents.length > 0 && (
        <ResultSection title={t('workflow.goalPreflight.suggestedAgents')}>
          <ul className="space-y-2 text-sm text-gray-700">
            {result.suggestedAgents.map((agent, index) => (
              <li key={index} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <p className="font-semibold text-gray-900">
                  {agent.name}
                  <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700">
                    {agent.role}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-gray-600">{agent.task}</p>
                <p className="mt-0.5 text-[11px] text-gray-400">{agent.reason}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-amber-700">
            {t('workflow.goalPreflight.topologyNote')}
          </p>
          {canCreateAgents && (
            <button
              type="button"
              onClick={onCreateSuggestedAgents}
              className="mt-2 inline-flex items-center rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 transition-colors hover:bg-sky-100"
            >
              {t('workflow.goalPreflight.createSuggestedAgents')}
            </button>
          )}
        </ResultSection>
      )}

      <ResultSection title={t('workflow.goalPreflight.asciiPreview')}>
        <AsciiPreviewBlock text={result.asciiPreview} />
      </ResultSection>

      {result.risks.length > 0 && (
        <ResultSection title={t('workflow.goalPreflight.risks')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {result.risks.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </ResultSection>
      )}

      {appliedFlag && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {appliedFlag === 'applied'
            ? t('workflow.goalPreflight.appliedNote')
            : t('workflow.goalPreflight.appliedAndStartedNote')}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApplyAndStart}
          className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          {t('workflow.goalPreflight.applyAndStart')}
        </button>
        <button
          type="button"
          onClick={onApply}
          className="inline-flex items-center rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50"
        >
          {t('workflow.goalPreflight.applyOnly')}
        </button>
        <button
          type="button"
          onClick={onAskMore}
          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {t('workflow.goalPreflight.askMore')}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {t('workflow.goalPreflight.editManually')}
        </button>
      </div>
    </div>
  );
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50/50 px-4 py-3">
      <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
        {title}
      </h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default WorkflowGoalPreflightPanel;
