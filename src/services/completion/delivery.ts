export interface DeliveryCommandRun {
  command: string;
  exit_code: number;
}

export interface DeliveryReport {
  summary: string;
  files_changed: string[];
  commands_run: DeliveryCommandRun[];
}

export type DeliveryParseFailureKind =
  | 'delivery_missing'
  | 'delivery_invalid_json'
  | 'delivery_not_object'
  | 'delivery_missing_summary'
  | 'delivery_invalid_files_changed'
  | 'delivery_invalid_commands_run';

export interface DeliveryParseSuccess {
  ok: true;
  report: DeliveryReport;
}

export interface DeliveryParseFailure {
  ok: false;
  kind: DeliveryParseFailureKind;
  detail: string;
}

export type DeliveryParseResult = DeliveryParseSuccess | DeliveryParseFailure;

export const DELIVERY_EXAMPLE = [
  '[[DELIVERY]]',
  '{"summary":"这一轮做了什么","files_changed":["src/foo.ts"],"commands_run":[{"command":"pnpm test path","exit_code":0}]}',
  '[[/DELIVERY]]',
].join('\n');

const DELIVERY_BLOCK_REGEX = /\[\[DELIVERY\]\]([\s\S]*?)\[\[\/DELIVERY\]\]/i;

function stripFencedCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

function findDeliveryPayload(text: string): { found: boolean; payload?: string } {
  const cleanText = stripFencedCodeBlocks(text);
  const match = DELIVERY_BLOCK_REGEX.exec(cleanText);
  if (!match?.[1]) {
    return { found: false };
  }
  return { found: true, payload: match[1].trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDeliveryReport(text: string): DeliveryParseResult {
  const block = findDeliveryPayload(text);
  if (!block.found || block.payload === undefined || !block.payload) {
    return { ok: false, kind: 'delivery_missing', detail: '缺少 [[DELIVERY]] 交付块。' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.payload);
  } catch {
    return { ok: false, kind: 'delivery_invalid_json', detail: '[[DELIVERY]] 块内不是合法 JSON。' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, kind: 'delivery_not_object', detail: '[[DELIVERY]] 块必须是 JSON 对象。' };
  }

  if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
    return { ok: false, kind: 'delivery_missing_summary', detail: '[[DELIVERY]] 缺少非空 summary。' };
  }

  if (!Array.isArray(parsed.files_changed) || parsed.files_changed.some((item) => typeof item !== 'string')) {
    return { ok: false, kind: 'delivery_invalid_files_changed', detail: '[[DELIVERY]] 的 files_changed 必须是字符串数组。' };
  }

  if (!Array.isArray(parsed.commands_run)) {
    return { ok: false, kind: 'delivery_invalid_commands_run', detail: '[[DELIVERY]] 的 commands_run 必须是数组。' };
  }
  for (const entry of parsed.commands_run) {
    if (
      !isRecord(entry) ||
      typeof entry.command !== 'string' ||
      !entry.command.trim() ||
      typeof entry.exit_code !== 'number' ||
      !Number.isFinite(entry.exit_code)
    ) {
      return {
        ok: false,
        kind: 'delivery_invalid_commands_run',
        detail: '[[DELIVERY]] 的 commands_run 元素必须包含 command 字符串和数字 exit_code。',
      };
    }
  }

  return {
    ok: true,
    report: {
      summary: (parsed.summary as string).trim(),
      files_changed: parsed.files_changed as string[],
      commands_run: (parsed.commands_run as Array<{ command: string; exit_code: number }>).map((entry) => ({
        command: entry.command,
        exit_code: entry.exit_code,
      })),
    },
  };
}
