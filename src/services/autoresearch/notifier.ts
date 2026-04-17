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
}

/**
 * Create a notifier instance. If Telegram is disabled or chatId is missing,
 * all methods are no-ops (no errors thrown).
 */
export function createNotifier(config: TelegramNotifyConfig): AutoResearchNotifier {
  const send = async (text: string) => {
    if (!config.enabled || !config.chatId) return;
    try {
      await telegramSendMessage(config.chatId, text, { parseMode: 'MarkdownV2' });
    } catch (e) {
      console.warn('[AutoResearch Notifier] Failed to send Telegram message:', e);
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
  };
}
