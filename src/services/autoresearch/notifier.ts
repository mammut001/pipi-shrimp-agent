/**
 * AutoResearch Notifier — Telegram notification hook.
 *
 * Provides a clean interface for sending experiment updates via Telegram.
 * Uses the existing telegramService.ts infrastructure.
 *
 * Usage:
 *   const notifier = createNotifier(telegramConfig);
 *   await notifier.onExperimentComplete(entry, session);
 */

import { telegramSendMessage } from '@/services/telegramService';
import type { ExperimentEntry, ExperimentSession, TelegramNotifyConfig } from '@/store/autoresearchStore';

export interface AutoResearchNotifier {
  /** Called after each experiment completes */
  onExperimentComplete(entry: ExperimentEntry, session: ExperimentSession): Promise<void>;

  /** Called when the loop stops (user stop / max iterations / consecutive failures) */
  onLoopStopped(reason: string, session: ExperimentSession): Promise<void>;

  /** Called every N iterations with a trend summary */
  onTrendReport(report: string, session: ExperimentSession): Promise<void>;

  /**
   * AUDIT-2026-06-02 (silent errors): return the status of the most recent
   * delivery attempt so the consuming UI can render an "AutoResearch
   * notifications failing" banner instead of silently swallowing every
   * error in console. `null` means no attempt has been made yet.
   */
  getLastDelivery(): NotifierDeliveryStatus | null;
}

export interface NotifierDeliveryStatus {
  at: number;
  ok: boolean;
  reason?: string;
  /** Disabled means the call was skipped because Telegram is off / chatId missing. */
  disabled?: boolean;
}

/**
 * AUDIT-2026-06-02 (F3): module-scope holder for the most recently
 * observed notifier delivery status, so a UI banner component can
 * subscribe without needing to thread the notifier instance through
 * props. Updated by every send() call across every notifier.
 */
type DeliveryListener = (status: NotifierDeliveryStatus | null) => void;
let globalLastDelivery: NotifierDeliveryStatus | null = null;
const deliveryListeners = new Set<DeliveryListener>();

export function getLastNotifierDelivery(): NotifierDeliveryStatus | null {
  return globalLastDelivery;
}

export function subscribeNotifierDelivery(listener: DeliveryListener): () => void {
  deliveryListeners.add(listener);
  return () => {
    deliveryListeners.delete(listener);
  };
}

function publishDelivery(status: NotifierDeliveryStatus | null): void {
  globalLastDelivery = status;
  for (const listener of deliveryListeners) {
    try {
      listener(status);
    } catch (e) {
      console.warn('[AutoResearch Notifier] subscriber threw:', e);
    }
  }
}

/**
 * Create a notifier instance. If Telegram is disabled or chatId is missing,
 * all methods are no-ops (no errors thrown).
 *
 * AUDIT-2026-06-02 (silent errors): the previous implementation silently
 * no-op'd when the config was missing/disabled, so an operator with a
 * misconfigured bot (chatId revoked, never set, etc.) got zero in-app
 * signal and saw a "quiet" dashboard while critical events (loop stopped,
 * 3 consecutive failures, trend reports) vanished. We now log the disabled
 * state ONCE at notifier construction so devtools clearly shows whether
 * notifications are wired up, and we log each send failure with the chatId
 * so the operator can map it to their Telegram config.
 */
export function createNotifier(config: TelegramNotifyConfig): AutoResearchNotifier {
  const isDisabled = !config.enabled || !config.chatId;
  if (isDisabled) {
    console.info(
      `[AutoResearch Notifier] disabled (enabled=${Boolean(config.enabled)}, chatId set=${Boolean(config.chatId)}). All onExperimentComplete / onLoopStopped / onTrendReport calls will be no-ops.`,
    );
  }

  // AUDIT-2026-06-02 (silent errors): track the most recent delivery so the
  // UI can render a status banner via getLastDelivery(). Keeps the notifier
  // self-contained (no store cross-cutting required) while still making the
  // misconfig / send-failure visible to consumers. Also published via
  // publishDelivery() so a global banner (F3) can subscribe.
  const setLastDelivery = (status: NotifierDeliveryStatus | null) => {
    lastDelivery = status;
    publishDelivery(status);
  };
  let lastDelivery: NotifierDeliveryStatus | null = isDisabled
    ? { at: Date.now(), ok: false, disabled: true, reason: 'Telegram disabled or chatId not configured' }
    : null;
  if (lastDelivery) {
    publishDelivery(lastDelivery);
  }

  const send = async (text: string) => {
    if (isDisabled || !config.chatId) {
      setLastDelivery({ at: Date.now(), ok: false, disabled: true, reason: 'Telegram disabled or chatId not configured' });
      return;
    }
    try {
      await telegramSendMessage(config.chatId, text, { parseMode: 'MarkdownV2' });
      setLastDelivery({ at: Date.now(), ok: true });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setLastDelivery({ at: Date.now(), ok: false, reason });
      console.warn(
        `[AutoResearch Notifier] Failed to send Telegram message (chatId=${config.chatId}):`,
        e,
      );
    }
  };

  return {
    async onExperimentComplete(entry, session) {
      // Skip if notification not configured for this status
      if (entry.status === 'IMPROVED' && !config.notifyOnImproved) return;
      if (entry.status === 'FAILED' && !config.notifyOnFailed) return;
      if (entry.status === 'NOT_IMPROVED') return; // never notify on NOT_IMPROVED

      const icon = entry.status === 'IMPROVED' ? '✅' : '❌';
      const metricStr = entry.metricValue !== null ? `${session.metricName}=${entry.metricValue}` : 'N/A';
      const delta = entry.status === 'IMPROVED' && session.bestMetric !== null && entry.metricValue !== null
        ? ` (${session.metricDirection === 'lower' ? '↓' : '↑'}${Math.abs(entry.metricValue - session.bestMetric).toFixed(4)})`
        : '';

      const text = [
        `🧪 *[AutoResearch] Exp #${entry.iteration}*`,
        `假设: ${entry.hypothesis}`,
        `结果: ${metricStr} ${icon} ${entry.status}${delta}`,
        `累计最佳: ${session.bestMetric ?? 'N/A'} | 已完成: ${session.currentIteration}/${session.maxIterations}`,
      ].join('\n');

      await send(text);
    },

    async onLoopStopped(reason, session) {
      const text = [
        `🛑 *[AutoResearch] 循环已停止*`,
        `原因: ${reason}`,
        `完成实验: ${session.currentIteration}/${session.maxIterations}`,
        `最佳指标: ${session.bestMetric ?? 'N/A'}`,
      ].join('\n');

      await send(text);
    },

    async onTrendReport(report, session) {
      const text = [
        `📊 *[AutoResearch] 趋势报告* (${session.currentIteration}/${session.maxIterations})`,
        report,
      ].join('\n');

      await send(text);
    },

    getLastDelivery() {
      return lastDelivery;
    },
  };
}
