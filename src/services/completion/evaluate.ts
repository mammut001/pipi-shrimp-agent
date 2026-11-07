import type { CompletionContract } from './contract';
import { DELIVERY_EXAMPLE, parseDeliveryReport } from './delivery';
import { formatAcceptanceOutputForRepair, type AcceptanceCommandResult } from './runAcceptance';

export type CompletionFailureReason =
  | 'empty_output'
  | 'delivery_invalid'
  | 'acceptance_failed'
  | 'acceptance_blocked'
  | 'stalled_tools'
  | 'no_file_progress';

export interface CompletionEvaluationInput {
  finalText: string;
  acceptanceResults?: AcceptanceCommandResult[];
}

export interface CompletionEvaluation {
  pass: boolean;
  reasons: string[];
  failureKinds: CompletionFailureReason[];
  detail: string;
}

function truncate(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n... [已截断]`;
}

export function evaluateCompletion(
  contract: CompletionContract,
  input: CompletionEvaluationInput,
): CompletionEvaluation {
  const reasons: string[] = [];
  const failureKinds: CompletionFailureReason[] = [];
  const details: string[] = [];
  const text = input.finalText ?? '';

  if (contract.requireNonEmpty && !text.trim()) {
    reasons.push('empty_output: 回复正文为空。');
    failureKinds.push('empty_output');
    details.push('回复正文为空，请输出本轮实际完成的工作。');
  }

  if (contract.requireDeliveryReport) {
    const parsed = parseDeliveryReport(text);
    if (!parsed.ok) {
      reasons.push(`delivery_invalid: ${parsed.detail}`);
      failureKinds.push('delivery_invalid');
      details.push(parsed.detail);
    }
  }

  for (const result of input.acceptanceResults ?? []) {
    if (result.status === 'pass') {
      continue;
    }
    if (result.status === 'blocked') {
      reasons.push(`acceptance_blocked: 命令「${result.command}」未能执行：${result.detail ?? '被拦截'}`);
      failureKinds.push('acceptance_blocked');
      details.push(`验收命令「${result.command}」未能执行：${result.detail ?? '被拦截'}。`);
      continue;
    }
    reasons.push(`acceptance_failed: 命令「${result.command}」退出码为 ${result.exitCode ?? '未知'}。`);
    failureKinds.push('acceptance_failed');
    details.push(
      `验收命令「${result.command}」失败（退出码 ${result.exitCode ?? '未知'}）：\n${formatAcceptanceOutputForRepair(result)}`,
    );
  }

  return {
    pass: reasons.length === 0,
    reasons,
    failureKinds,
    detail: details.join('\n'),
  };
}

export interface RepairMessageInput {
  evaluation: CompletionEvaluation;
  attempt: number;
  maxAttempts: number;
}

export function buildCompletionRepairMessage(input: RepairMessageInput): string {
  const lines = [
    '上一轮输出没有通过完成检查，请在同一会话里继续补齐后再结束，不要自行判断已经完成。',
    '',
    '失败原因：',
    ...input.evaluation.reasons.map((reason) => `- ${reason}`),
  ];
  if (input.evaluation.detail) {
    lines.push('', '详情：', truncate(input.evaluation.detail));
  }
  lines.push(
    '',
    `这是第 ${input.attempt}/${input.maxAttempts} 次打回。请直接调用工具补齐缺失的工作，然后重新输出完整正文和合法的 [[DELIVERY]] 块。`,
    '',
    '交付块格式（不要放在代码块里）：',
    DELIVERY_EXAMPLE,
  );
  return lines.join('\n');
}

export function buildRepairUserMessage(params: {
  assistantText: string;
  toolSummary: string;
  repairMessage: string;
}): string {
  const parts = [
    '[上一轮助手输出]',
    params.assistantText.trim() || '(空输出)',
    '',
  ];
  if (params.toolSummary.trim()) {
    parts.push('[上一轮工具调用摘要]', params.toolSummary.trim(), '');
  }
  parts.push('[完成检查打回说明]', params.repairMessage);
  return parts.join('\n');
}
