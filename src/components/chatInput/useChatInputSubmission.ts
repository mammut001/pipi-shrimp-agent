import { useState, useCallback, useEffect, type RefObject } from 'react';
import { useChatStore } from '@/store';
import type { ImageAttachment } from '@/types/vision';
import type { ComposerBlock } from './blocks/types';
import { clearDraftPair } from './draftPersistence';
import {
  decideChatInputSubmission,
  shouldClearDraftAfterBrowserWorkflow,
  shouldDismissBrowserIntentConfirm,
} from '../chatInputFlow';
import { quickCheckBrowserIntent, handleChatBrowserWorkflow } from '@/utils/chatBrowserBridge';
import {
  hasMeaningfulComposerContent,
  isCompiledTaskPrompt,
  resolveComposerSubmitMessage,
} from './blocks/promptBuilder';

export interface UseChatInputSubmissionParams {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>> | ((value: string) => void);
  attachments: ImageAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ImageAttachment[]>> | ((attachments: ImageAttachment[]) => void);
  draftStorageKey: string;
  blockDraftStorageKey: string;
  resetComposer: () => void;
  composerOpen: boolean;
  composerBlocks: ComposerBlock[];
  projectDir?: string | null;
  pipiOutputDir?: string | null;
  currentSessionId?: string | null;
  onSend?: (message: string, attachments?: ImageAttachment[]) => void | Promise<void>;
  submitMode?: 'chat-store' | 'callback-only';
  showStopControl: boolean;
  sendMessage?: (message: string, sessionId?: string, options?: { attachments?: ImageAttachment[] }) => Promise<unknown>;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

export function useChatInputSubmission({
  input,
  setInput,
  attachments,
  setAttachments,
  draftStorageKey,
  blockDraftStorageKey,
  resetComposer,
  composerOpen,
  composerBlocks,
  projectDir,
  pipiOutputDir,
  currentSessionId,
  onSend,
  submitMode = 'chat-store',
  showStopControl,
  sendMessage: sendMessageOverride,
  textareaRef,
}: UseChatInputSubmissionParams) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [browserIntentCandidate, setBrowserIntentCandidate] = useState<string | null>(null);

  const defaultSendMessage = useChatStore((s) => s.sendMessage);
  const sendMessage = sendMessageOverride ?? defaultSendMessage;

  useEffect(() => {
    if (shouldDismissBrowserIntentConfirm(browserIntentCandidate, input)) {
      setBrowserIntentCandidate(null);
    }
  }, [browserIntentCandidate, input]);

  const clearInputDraft = useCallback(() => {
    setInput('');
    setAttachments([]);
    setBrowserIntentCandidate(null);
    clearDraftPair(draftStorageKey);
    clearDraftPair(blockDraftStorageKey);
    resetComposer();
  }, [blockDraftStorageKey, draftStorageKey, resetComposer, setAttachments, setInput]);

  const sendAsRegularChat = useCallback(async (
    message: string,
    messageAttachments: ImageAttachment[],
    rawInput?: string,
  ) => {
    setIsSubmitting(true);
    // Clear draft immediately so rapid subsequent keystrokes are preserved
    clearInputDraft();
    try {
      onSend?.(message);
      await sendMessage(message, currentSessionId ?? undefined, { attachments: messageAttachments });
    } catch (error) {
      // Preserve input on failure so user can retry
      console.error('[ChatInput] sendMessage failed, preserving input:', error);
      setInput(rawInput !== undefined ? rawInput : message);
      setAttachments(messageAttachments);
    } finally {
      setIsSubmitting(false);
    }
  }, [clearInputDraft, currentSessionId, onSend, sendMessage, setAttachments, setInput]);

  const sendToBrowserWorkflow = useCallback(async (message: string) => {
    setIsSubmitting(true);
    try {
      const handled = await handleChatBrowserWorkflow(message);
      if (shouldClearDraftAfterBrowserWorkflow(handled)) {
        clearInputDraft();
      } else if (!handled) {
        // Browser handoff declined — preserve input and show fallback prompt
        setInput(message);
        setBrowserIntentCandidate(message);
      }
      return handled;
    } catch (error) {
      console.error('[ChatInput] Failed to hand off browser workflow:', error);
      // Preserve input and re-show intent confirm so user can choose "send as normal"
      setInput(message);
      setBrowserIntentCandidate(message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [clearInputDraft, setInput]);

  const submitOutboundMessage = useCallback(async (compiledOverride?: string) => {
    const promptContext = {
      projectFolder: projectDir ?? undefined,
      pipiOutputDir: pipiOutputDir ?? undefined,
    };
    const message = compiledOverride ?? resolveComposerSubmitMessage({
      composerOpen,
      composerBlocks,
      input,
      context: promptContext,
    });

    if (!message) {
      return;
    }

    const messageAttachments = compiledOverride !== undefined ? [] : attachments;
    const rawInput = input.trim();

    if (submitMode === 'callback-only') {
      if (isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      clearInputDraft();
      try {
        await onSend?.(message, messageAttachments);
      } catch (error) {
        console.error('[ChatInput] callback-only onSend failed, preserving input:', error);
        setInput(rawInput);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const decision = decideChatInputSubmission({
      input: message,
      hasAttachments: messageAttachments.length > 0,
      isStreaming: showStopControl,
      isSubmitting,
      isBrowserIntent: quickCheckBrowserIntent,
    });

    if (decision.type === 'noop') {
      return;
    }

    if (decision.type === 'confirm-browser') {
      setBrowserIntentCandidate((current) => current === decision.message ? current : decision.message);
      return;
    }

    await sendAsRegularChat(decision.message, messageAttachments, rawInput);
  }, [
    attachments,
    clearInputDraft,
    composerBlocks,
    composerOpen,
    input,
    isSubmitting,
    onSend,
    pipiOutputDir,
    projectDir,
    sendAsRegularChat,
    setInput,
    showStopControl,
    submitMode,
  ]);

  /**
   * Handle message submission
   */
  const handleSubmit = useCallback(async () => {
    const rawMessage = input.trim();
    const hasMeaningfulBlock = composerOpen && hasMeaningfulComposerContent(composerBlocks);
    if (!rawMessage && attachments.length === 0 && !hasMeaningfulBlock) {
      return;
    }

    await submitOutboundMessage();
  }, [attachments.length, composerBlocks, composerOpen, input, submitOutboundMessage]);

  const handleConfirmBrowserIntent = useCallback(async () => {
    if (!browserIntentCandidate || isSubmitting) return;
    await sendToBrowserWorkflow(browserIntentCandidate);
  }, [browserIntentCandidate, isSubmitting, sendToBrowserWorkflow]);

  const handleSendAsNormalMessage = useCallback(async () => {
    const message = browserIntentCandidate ?? input.trim();
    if (!message || isSubmitting) return;
    const rawInput = input.trim();
    let finalMessage = message;
    if (composerOpen && !isCompiledTaskPrompt(message)) {
      finalMessage = resolveComposerSubmitMessage({
        composerOpen,
        composerBlocks,
        input: message,
        context: {
          projectFolder: projectDir ?? undefined,
          pipiOutputDir: pipiOutputDir ?? undefined,
        },
      }) ?? message;
    }
    await sendAsRegularChat(finalMessage, [], rawInput);
  }, [
    browserIntentCandidate,
    composerBlocks,
    composerOpen,
    input,
    isSubmitting,
    pipiOutputDir,
    projectDir,
    sendAsRegularChat,
  ]);

  const handleCancelBrowserIntent = useCallback(() => {
    if (isSubmitting) return;
    setBrowserIntentCandidate(null);
    textareaRef?.current?.focus();
  }, [isSubmitting, textareaRef]);

  return {
    isSubmitting,
    browserIntentCandidate,
    setBrowserIntentCandidate,
    clearInputDraft,
    sendAsRegularChat,
    sendToBrowserWorkflow,
    submitOutboundMessage,
    handleSubmit,
    handleConfirmBrowserIntent,
    handleSendAsNormalMessage,
    handleCancelBrowserIntent,
  };
}
