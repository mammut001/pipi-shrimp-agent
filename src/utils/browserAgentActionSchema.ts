/**
 * Browser agent action envelope — schema, parser, and retry helper.
 *
 * The native agent prompts the model to emit a JSON object with this shape:
 *
 *   {
 *     "thought": "explain what I see and what I'll do",
 *     "action":  { "<action_name>": { ...payload... } }
 *   }
 *
 * The parser is deliberately tolerant: it accepts fenced JSON, JSON embedded
 * in prose, and trims noise around the object. It rejects anything that is
 * not a single JSON object and returns an actionable error message so the
 * model can self-correct.
 *
 * After two malformed responses the agent stops — this prevents infinite
 * "garbage in → garbage out" loops that burn API quota.
 */

import { z } from 'zod';

export const SUPPORTED_ACTION_NAMES = [
  'wait',
  'wait_for_selector',
  'click_element',
  'input_text',
  'press_key',
  'scroll',
  'navigate',
  'extract_text',
  'done',
  'ask_user',
  'refresh_page_state',
  'screenshot_observe',
] as const;

export type SupportedActionName = (typeof SUPPORTED_ACTION_NAMES)[number];

const waitPayload = z
  .object({
    seconds: z.number().positive().max(15).optional(),
    milliseconds: z.number().positive().max(15000).optional(),
  })
  .strict()
  .refine((value) => value.seconds != null || value.milliseconds != null, {
    message: 'wait requires either seconds or milliseconds',
  });

const waitForSelectorPayload = z
  .object({
    selector: z.string().min(1),
    timeout_ms: z.number().positive().max(30000).optional(),
  })
  .strict();

const clickElementPayload = z
  .object({
    id: z.number().int().positive().optional(),
    backend_node_id: z.number().int().positive().optional(),
    element_id: z.number().int().positive().optional(),
    backendNodeId: z.number().int().positive().optional(),
    selector: z.string().min(1).optional(),
  })
  .strict();

const inputTextPayload = z
  .object({
    id: z.number().int().positive().optional(),
    backend_node_id: z.number().int().positive().optional(),
    element_id: z.number().int().positive().optional(),
    backendNodeId: z.number().int().positive().optional(),
    text: z.string().min(1),
    press_enter: z.boolean().optional(),
    selector: z.string().min(1).optional(),
  })
  .strict();

const pressKeyPayload = z
  .object({
    key: z.string().min(1),
    modifiers: z.array(z.string()).optional(),
  })
  .strict();

const scrollPayload = z
  .object({
    direction: z.enum(['up', 'down', 'left', 'right']),
    pixels: z.number().positive().max(10000).optional(),
  })
  .strict();

const navigatePayload = z
  .object({
    url: z.string().min(1),
    wait_selector: z.string().optional(),
    timeout_ms: z.number().positive().max(60000).optional(),
  })
  .strict();

const extractTextPayload = z
  .object({
    max_length: z.number().positive().max(20000).optional(),
    selector: z.string().optional(),
  })
  .strict();

const donePayload = z
  .object({
    text: z.string(),
    success: z.boolean(),
  })
  .strict();

const askUserPayload = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
  })
  .strict();

const refreshPageStatePayload = z
  .object({
    level: z.enum(['light', 'interactive', 'full']).optional(),
    force: z.boolean().optional(),
  })
  .strict();

const screenshotObservePayload = z
  .object({
    max_width: z.number().positive().optional(),
    format: z.enum(['jpeg', 'png']).optional(),
  })
  .strict();

const ACTION_PAYLOADS: Record<SupportedActionName, z.ZodTypeAny> = {
  wait: waitPayload,
  wait_for_selector: waitForSelectorPayload,
  click_element: clickElementPayload,
  input_text: inputTextPayload,
  press_key: pressKeyPayload,
  scroll: scrollPayload,
  navigate: navigatePayload,
  extract_text: extractTextPayload,
  done: donePayload,
  ask_user: askUserPayload,
  refresh_page_state: refreshPageStatePayload,
  screenshot_observe: screenshotObservePayload,
};

export interface ParsedActionEnvelope {
  actionName: SupportedActionName;
  payload: Record<string, unknown>;
  thought?: string;
}

const isSupportedActionName = (value: string): value is SupportedActionName =>
  (SUPPORTED_ACTION_NAMES as readonly string[]).includes(value);

/**
 * Strip markdown fences and surrounding whitespace. Returns the first JSON
 * object it finds, or null if no object is present.
 */
const extractFirstJsonObject = (input: string): string | null => {
  const trimmed = input.trim();

  // 1. Try the trimmed input as-is.
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  // 2. Try fenced ```json ... ``` blocks.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }

  // 3. Find the first `{` and the matching `}` (simple bracket counting).
  const start = trimmed.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }
  return null;
};

export interface ParseSuccess {
  ok: true;
  envelope: ParsedActionEnvelope;
  /** Echo of the original model output for logging. */
  raw: string;
}

export interface ParseFailure {
  ok: false;
  error: string;
  /** True when this is the second malformed response in a row. */
  fatal: boolean;
  raw: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Parse a model response into a ParsedActionEnvelope. Returns either a
 * success or a structured failure with a user-friendly error message.
 */
export const parseBrowserActionEnvelope = (input: string): ParseResult => {
  const raw = (input ?? '').toString();
  const candidate = extractFirstJsonObject(raw);
  if (!candidate) {
    return {
      ok: false,
      raw,
      fatal: false,
      error: 'No JSON object found in response.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      ok: false,
      raw,
      fatal: false,
      error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      raw,
      fatal: false,
      error: 'Response must be a single JSON object.',
    };
  }

  const obj = parsed as Record<string, unknown>;
  const actionField = obj.action;
  if (!actionField || typeof actionField !== 'object' || Array.isArray(actionField)) {
    return {
      ok: false,
      raw,
      fatal: false,
      error: 'Missing "action" object.',
    };
  }

  const actionObj = actionField as Record<string, unknown>;
  const actionKeys = Object.keys(actionObj);
  if (actionKeys.length !== 1) {
    return {
      ok: false,
      raw,
      fatal: false,
      error: `Expected exactly one action key, got ${actionKeys.length}: [${actionKeys.join(', ')}]`,
    };
  }

  const [actionName, rawPayload] = actionKeys[0].split('.', 1)[0]
    ? [actionKeys[0], actionObj[actionKeys[0]]]
    : ['', null];
  if (!isSupportedActionName(actionName)) {
    return {
      ok: false,
      raw,
      fatal: false,
      error: `Unsupported action "${actionName}". Supported: ${SUPPORTED_ACTION_NAMES.join(', ')}.`,
    };
  }

  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      ok: false,
      raw,
      fatal: false,
      error: `Action "${actionName}" payload must be an object.`,
    };
  }

  const schema = ACTION_PAYLOADS[actionName];
  const validation = schema.safeParse(rawPayload);
  if (!validation.success) {
    const message = validation.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      raw,
      fatal: false,
      error: `Invalid "${actionName}" payload: ${message}`,
    };
  }

  const thought = typeof obj.thought === 'string' ? obj.thought : undefined;

  return {
    ok: true,
    raw,
    envelope: {
      actionName,
      payload: validation.data as Record<string, unknown>,
      thought,
    },
  };
};

export interface ParseRetryOptions {
  /** Number of malformed responses already produced by the model. */
  malformedSoFar: number;
  /** Soft cap before the loop is considered fatal. */
  fatalAfter?: number;
}

/**
 * Parse the response and decide whether to retry or stop the agent.
 *
 * The first malformed response yields a retry hint; the second (per options
 * cap) becomes fatal and the agent should stop with an actionable error.
 */
export const parseBrowserActionEnvelopeWithRetry = (
  input: string,
  malformedSoFar: number,
  options: ParseRetryOptions = { malformedSoFar },
): ParseResult => {
  const fatalAfter = options.fatalAfter ?? 2;
  const result = parseBrowserActionEnvelope(input);
  if (result.ok) {
    return result;
  }
  return {
    ...result,
    fatal: malformedSoFar + 1 >= fatalAfter,
  };
};
