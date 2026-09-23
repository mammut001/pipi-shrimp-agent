/**
 * Session goal hydrate/bind + popover save/clear handlers for ChatInput (AG-13).
 */

import { useCallback, useEffect, useState } from 'react';
import { useSessionGoalStore } from '@/store/sessionGoalStore';
import { t } from '@/i18n';

export interface UseSessionGoalComposerBindingsParams {
  currentSessionId: string | null;
  addNotification: (type: any, message: string) => void;
}

export function useSessionGoalComposerBindings({
  currentSessionId,
  addNotification,
}: UseSessionGoalComposerBindingsParams) {
  const [goalPopoverOpen, setGoalPopoverOpen] = useState(false);
  const [goalInputText, setGoalInputText] = useState<string>('');

  const hydrateGoals = useSessionGoalStore((s) => s.hydrate);
  const bindSessionGoal = useSessionGoalStore((s) => s.bindSession);
  const setSessionObjective = useSessionGoalStore((s) => s.setObjective);
  const clearSessionGoal = useSessionGoalStore((s) => s.clearGoal);
  const sessionGoal = useSessionGoalStore((s) => (
    currentSessionId ? s.goalsBySession[currentSessionId]?.objective ?? '' : ''
  ));

  useEffect(() => {
    hydrateGoals();
  }, [hydrateGoals]);

  useEffect(() => {
    bindSessionGoal(currentSessionId);
  }, [bindSessionGoal, currentSessionId]);

  // Load goal draft on session switch
  useEffect(() => {
    if (!currentSessionId) {
      setGoalInputText('');
      return;
    }
    setGoalInputText(useSessionGoalStore.getState().goalsBySession[currentSessionId]?.objective ?? '');
  }, [currentSessionId]);

  const handleClearGoal = useCallback(() => {
    if (!currentSessionId) return;
    clearSessionGoal(currentSessionId);
    setGoalInputText('');
    setGoalPopoverOpen(false);
    addNotification('success', t('goal.clearSuccess'));
  }, [addNotification, clearSessionGoal, currentSessionId]);

  const handleSaveGoal = useCallback((trimmed: string) => {
    if (!currentSessionId) return;
    if (trimmed) {
      setSessionObjective(currentSessionId, trimmed);
    } else {
      clearSessionGoal(currentSessionId);
    }
    setGoalPopoverOpen(false);
    addNotification('success', trimmed ? t('goal.saveSuccess') : t('goal.clearSuccess'));
  }, [addNotification, clearSessionGoal, currentSessionId, setSessionObjective]);

  return {
    goalPopoverOpen,
    setGoalPopoverOpen,
    goalInputText,
    setGoalInputText,
    sessionGoal,
    handleClearGoal,
    handleSaveGoal,
  };
}
