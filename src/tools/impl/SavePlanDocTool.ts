import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';
import {
  savePlanModeDoc,
  shouldSavePlanDoc,
  type SavePlanModeDocResult,
} from '@/services/planMode';
import { useChatStore } from '@/store/createChatStore';
import {
  getSessionPipiOutputDir,
  resolveRealSessionPipiOutputDir,
} from '@/utils/sessionFolders';

/**
 * SavePlanDocTool — persist a plan-mode plan as a markdown document
 * under the session's `.pipi-shrimp/docs/` directory.
 *
 * The model supplies the plan body (and optionally a short title).
 * The destination folder is resolved through the **PiPi Output Folder**
 * helper (`getSessionPipiOutputDir`) so plan docs land in the
 * app-owned output root rather than the user's repo. We deliberately
 * do NOT honour `ToolContext.cwd` here — `cwd` is the **Project
 * Folder** (the user's repo, where tool commands run), and writing
 * a generated doc there would pollute the repo with `.pipi-shrimp/`.
 *
 * `userRequest` (used only to derive the file title) is taken from the
 * most recent user message in `ToolContext.messages`, with a
 * markdown-first-line fallback if the context is empty.
 *
 * NOTE: This tool is intentionally NOT exposed to the model in the
 * active chat path. The Rust tool registry has no `save_plan_doc`
 * handler and the chat engine routes tool calls through that
 * registry, so advertising it would make the model call an "Unknown
 * tool". Instead, `chatActions.sendMessage` auto-persists the final
 * plan after `turn_complete` via `shouldSavePlanDoc` + `savePlanModeDoc`
 * (see `src/services/planMode.ts`). This class is retained for the
 * legacy TypeScript tool executor and for direct programmatic use;
 * the chat composer should never advertise it to the model.
 *
 * The tool deliberately does not take a free-form `path` argument —
 * the on-disk location is fully determined by the docs service so
 * the user can rely on `.pipi-shrimp/docs/0xx-plan-*.md` showing up
 * every time.
 */
export class SavePlanDocTool extends BaseTool<SavePlanDocInput, SavePlanDocOutput> {
  readonly name = 'SavePlanDoc';
  readonly aliases = ['save_plan_doc', 'SavePlanDocument', 'WritePlan'];
  readonly searchHint = 'save plan document markdown docs plan-mode';
  readonly maxResultSizeChars = 5000;
  readonly shouldDefer = false;
  readonly alwaysLoad = false;

  readonly inputSchema = SavePlanDocInputSchema;
  readonly outputSchema = SavePlanDocOutputSchema;

  async execute(
    input: SavePlanDocInput,
    context: ToolContext,
  ): Promise<ToolResult<SavePlanDocOutput>> {
    // Two-folder model: plan docs are app-owned outputs, so the
    // destination folder is the session's **PiPi Output Folder**, NOT
    // `ToolContext.cwd` (which is the Project Folder / user's repo).
    //
    // We resolve the real on-disk path via `resolveRealSessionPipiOutputDir`
    // (which calls `get_app_default_dir` when `pipiOutputDir` is unset)
    // because the JS-only `getSessionPipiOutputDir` returns the
    // `PiPi-Shrimp/chats/<id>` placeholder — that string has NOT been
    // joined with the platform's Documents folder yet and feeding it
    // to `createDoc` would land in the wrong directory. We still call
    // `getSessionPipiOutputDir` once for the deterministic error
    // message below (which reads better than "real path unavailable"
    // when the session has a fully-bound folder).
    const session = useChatStore
      .getState()
      .sessions.find((candidate) => candidate.id === context.sessionId);
    const pipiOutputDir = (await resolveRealSessionPipiOutputDir(session))
      ?? getSessionPipiOutputDir(session)
      ?? '';
    const workDir = pipiOutputDir.trim();

    if (!workDir) {
      return {
        success: false,
        error:
          'No PiPi Output Folder is available for this session. Bind an output folder (or wait for the app-managed default to be provisioned) before persisting a plan document.',
      };
    }

    const rawMarkdown = (input.markdown ?? '');
    const markdown = rawMarkdown.trim();
    if (!markdown) {
      return {
        success: false,
        error: '`markdown` must be a non-empty string.',
      };
    }

    if (!shouldSavePlanDoc(markdown)) {
      return {
        success: false,
        error:
          'Refusing to persist: the plan body does not contain the required plan structure (Execution Plan header / Proposed Implementation Steps / Validation Plan / Execution Gate). Add the standard Plan Mode structure and try again.',
      };
    }

    const userRequest = deriveUserRequest(context, input.title, markdown);

    try {
      const saved: SavePlanModeDocResult = await savePlanModeDoc({
        workDir,
        userRequest,
        planMarkdown: markdown,
        sessionId: context.sessionId,
      });

      return {
        success: true,
        data: {
          path: saved.path,
          filename: saved.filename,
          number: saved.number,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  async describe(): Promise<string> {
    return (
      'Persist the final plan as a single markdown document under the session ' +
      "`.pipi-shrimp/docs/` directory. The tool returns the saved file path; " +
      'include it in the chat reply so the user can open the document.'
    );
  }

  isReadOnly(): boolean {
    // Writes a doc file. Conceptually plan-doc persistence, not a
    // user-driven file edit; we still mark it as a write so the
    // sandbox policy treats it accordingly.
    return false;
  }

  isDestructive(): boolean {
    return false;
  }
}

function deriveUserRequest(
  context: ToolContext,
  explicitTitle: string | undefined,
  markdown: string,
): string {
  if (explicitTitle && explicitTitle.trim()) {
    return explicitTitle.trim();
  }

  // Walk the message buffer backwards to find the latest user message.
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message && message.role === 'user') {
      const text = (message.content ?? '').trim();
      if (text) {
        return text.slice(0, 200);
      }
    }
  }

  // Fallback: derive a short title from the first non-heading line
  // of the markdown body so the docs service always has *something*
  // human-readable to work with.
  const firstContentLine = markdown
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  return (firstContentLine ?? 'Execution plan').slice(0, 200);
}

// ============== Schema ==============

export const SavePlanDocInputSchema = z.object({
  markdown: z
    .string()
    .describe(
      'The full plan body in markdown. Must include the standard Plan Mode structure ' +
        '(## Execution Plan header, ### Proposed Implementation Steps, ### Validation Plan, ' +
        '### Execution Gate) or the tool will refuse to persist it.',
    ),
  title: z
    .string()
    .optional()
    .describe(
      'Optional short title used for the docs file. Defaults to the latest user ' +
        'message, then to the first content line of the markdown body.',
    ),
});

export const SavePlanDocOutputSchema = z.object({
  path: z.string().describe('Absolute path to the saved markdown file.'),
  filename: z.string().describe('Bare filename of the saved markdown file.'),
  number: z.string().describe('Doc number prefix, e.g. "021".'),
});

export type SavePlanDocInput = z.infer<typeof SavePlanDocInputSchema>;
export type SavePlanDocOutput = z.infer<typeof SavePlanDocOutputSchema>;

export const savePlanDocTool = new SavePlanDocTool();
