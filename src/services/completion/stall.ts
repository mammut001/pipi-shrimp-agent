export interface StallSignalInput {
  toolNames: string[];
  filesChanged: string[];
  toolRoundsUsed: number;
  toolRoundsMax: number;
}

export interface StallSignal {
  stalled: boolean;
  reasons: string[];
}

const SAME_TOOL_STALL_THRESHOLD = 3;

export function detectStall(input: StallSignalInput): StallSignal {
  const reasons: string[] = [];
  const tail = input.toolNames.slice(-SAME_TOOL_STALL_THRESHOLD);
  if (
    tail.length === SAME_TOOL_STALL_THRESHOLD &&
    tail.every((name) => name === tail[0])
  ) {
    reasons.push(`stalled_tools: 连续 ${SAME_TOOL_STALL_THRESHOLD} 次调用同一工具「${tail[0]}」且未产出新内容。`);
  }
  if (input.toolNames.length > 0 && input.filesChanged.length === 0 && input.toolRoundsUsed >= 2) {
    reasons.push('no_file_progress: 已调用工具多轮但交付块 files_changed 仍为空。');
  }
  if (input.toolRoundsMax > 0 && input.toolRoundsUsed >= input.toolRoundsMax - 1 && input.toolNames.length > 0) {
    reasons.push('stalled_tools: 工具轮数将用尽，仍未收口。');
  }
  return { stalled: reasons.length > 0, reasons };
}

export function buildStallNudge(reasons: string[]): string {
  return [
    '检测到任务可能卡住（仍在同一会话内，不要结束）：',
    ...reasons.map((reason) => `- ${reason}`),
    '请换一种做法：收窄范围、先让最小可验证改动落盘、再补验收证据；不要重复同样失败的工具调用。',
  ].join('\n');
}
