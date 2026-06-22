import { describe, it, expect } from '@jest/globals';
import { buildPromptFromBlocks } from '../promptBuilder';
import {
  PRESET_ASK_QUESTION,
  PRESET_MAKE_PLAN,
  PRESET_DEBUG_BUG,
  PRESET_FAST_TRUSTED_EDIT,
  type ComposerBlock,
} from '../types';

describe('buildPromptFromBlocks', () => {
  it('should compile Ask a question preset correctly', () => {
    const prompt = buildPromptFromBlocks(PRESET_ASK_QUESTION);
    expect(prompt).toContain('# TASK SPECIFICATION');
    expect(prompt).toContain('## INTENT');
    expect(prompt).toContain('Ask a Question');
    expect(prompt).toContain('## EXECUTION MODE');
    expect(prompt).toContain('- **Mode**: ASK');
    expect(prompt).toContain('Answer directly. Do not use tools.');
    expect(prompt).toContain('## EXPECTED OUTPUT');
    expect(prompt).toContain('Direct Answer / Explanation');
  });

  it('should compile Make a plan preset correctly with folder context', () => {
    const context = {
      projectFolder: '/path/to/project',
      pipiOutputDir: '/path/to/output',
    };
    const planBlocksWithContext: ComposerBlock[] = [
      ...PRESET_MAKE_PLAN,
      {
        id: 'test-plan-context',
        type: 'context',
        paths: [],
        symbols: [],
        scope: 'whole_project',
      },
    ];
    const prompt = buildPromptFromBlocks(planBlocksWithContext, context);
    expect(prompt).toContain('## INTENT');
    expect(prompt).toContain('Make a Plan');
    expect(prompt).toContain('## CONSTRAINTS');
    expect(prompt).toContain('Read-Only Mode');
    expect(prompt).toContain('## EXPECTED OUTPUT');
    expect(prompt).toContain('Structured Plan Document');
    // Folder context verification
    expect(prompt).toContain('- **Project Folder (Source/Code/CWD)**: /path/to/project');
    expect(prompt).toContain('- **PiPi Output Folder (Outputs/Artifacts/Docs)**: /path/to/output');
  });

  it('should compile Debug a bug preset correctly with verification step', () => {
    const debugBlocksWithCmd: ComposerBlock[] = PRESET_DEBUG_BUG.map((b) => {
      if (b.type === 'verification') {
        return {
          ...b,
          commands: ['npm run test:unit'],
        };
      }
      return b;
    });

    const prompt = buildPromptFromBlocks(debugBlocksWithCmd);
    expect(prompt).toContain('## INTENT');
    expect(prompt).toContain('Debug a Bug');
    expect(prompt).toContain('## CONSTRAINTS');
    expect(prompt).toContain('No Broad Refactoring');
    expect(prompt).toContain('## VERIFICATION STEPS');
    expect(prompt).toContain('Run the test suite to verify correctness.');
    expect(prompt).toContain('Execute verification command: `npm run test:unit`');
  });

  it('should compile Fast trusted edit preset safety rules', () => {
    const prompt = buildPromptFromBlocks(PRESET_FAST_TRUSTED_EDIT);
    expect(prompt).toContain('## SAFETY RULES');
    expect(prompt).toContain('Bypass approvals for normal tools (trust mode)');
    expect(prompt).toContain('- **Confirm before**: deleting files, network requests, installing packages');
    expect(prompt).toContain('- **Prohibited Action**: Do not run large script migrations');
  });

  it('should handle context files correctly in ContextBlock', () => {
    const blocks: ComposerBlock[] = [
      {
        id: 'ctx-1',
        type: 'context',
        paths: ['src/index.ts'],
        symbols: ['main'],
        scope: 'selected_files',
        notes: 'Review performance here',
      },
    ];
    const prompt = buildPromptFromBlocks(blocks, {
      contextFiles: ['README.md', 'CONTRIBUTING.md'],
    });
    expect(prompt).toContain('## CONTEXT');
    expect(prompt).toContain('Selected Files/Paths');
    expect(prompt).toContain('- **Context Files (References)**: README.md, CONTRIBUTING.md');
    expect(prompt).toContain('- **Target Paths**: src/index.ts');
    expect(prompt).toContain('- **Target Symbols**: main');
    expect(prompt).toContain('- **Context Notes**: Review performance here');
  });

  it('should return empty string on empty blocks list', () => {
    const prompt = buildPromptFromBlocks([]);
    expect(prompt).toBe('');
  });
});

describe('isCompiledTaskPrompt', () => {
  const { isCompiledTaskPrompt, COMPILED_TASK_PROMPT_HEADER } = require('../promptBuilder');

  it('detects compiled task prompts', () => {
    expect(isCompiledTaskPrompt(`${COMPILED_TASK_PROMPT_HEADER}\n\n## INTENT`)).toBe(true);
    expect(isCompiledTaskPrompt('  # TASK SPECIFICATION\n')).toBe(true);
    expect(isCompiledTaskPrompt('plain message')).toBe(false);
  });
});

describe('canSendFromComposer', () => {
  const { canSendFromComposer } = require('../promptBuilder');

  it('returns false when composer is empty and input is empty', () => {
    expect(canSendFromComposer([], '')).toBe(false);
    expect(canSendFromComposer([], '   ')).toBe(false);
  });

  it('returns true when input has text', () => {
    expect(canSendFromComposer([], 'hello')).toBe(true);
  });

  it('returns false for mode-only blocks', () => {
    expect(canSendFromComposer([
      { id: 'm', type: 'mode', executionMode: 'ask' },
    ], '')).toBe(false);
  });
});

describe('resolveComposerSubmitMessage', () => {
  const { resolveComposerSubmitMessage, COMPILED_TASK_PROMPT_HEADER } = require('../promptBuilder');

  it('does not double-compile after Use as message flow', () => {
    const compiled = `${COMPILED_TASK_PROMPT_HEADER}\n\n## INTENT\nDo thing`;
    const message = resolveComposerSubmitMessage({
      composerOpen: false,
      composerBlocks: [],
      input: compiled,
    });
    expect(message).toBe(compiled);
    expect(message?.match(/# TASK SPECIFICATION/g)?.length).toBe(1);
  });

  it('Use as message then normal send simulation keeps single TASK SPECIFICATION', () => {
    const blocks = [
      { id: 'i', type: 'intent', intentType: 'implement', detail: 'write parser' },
    ];
    const compiled = resolveComposerSubmitMessage({
      composerOpen: true,
      composerBlocks: blocks,
      input: '',
    })!;
    const afterUseAsMessage = resolveComposerSubmitMessage({
      composerOpen: false,
      composerBlocks: [],
      input: compiled,
    });
    expect(afterUseAsMessage?.match(/# TASK SPECIFICATION/g)?.length).toBe(1);
  });
});

describe('hasMeaningfulComposerContent', () => {
  const { hasMeaningfulComposerContent } = require('../promptBuilder');

  it('should return false on empty blocks list', () => {
    expect(hasMeaningfulComposerContent([])).toBe(false);
  });

  it('should return false on empty intent block', () => {
    expect(hasMeaningfulComposerContent([
      {
        id: 'test-intent',
        type: 'intent',
        intentType: 'implement',
        detail: '   ',
      }
    ])).toBe(false);
  });

  it('should return true on non-empty intent block', () => {
    expect(hasMeaningfulComposerContent([
      {
        id: 'test-intent',
        type: 'intent',
        intentType: 'implement',
        detail: 'write a parser',
      }
    ])).toBe(true);
  });

  it('should return false on mode-only block', () => {
    expect(hasMeaningfulComposerContent([
      {
        id: 'test-mode',
        type: 'mode',
        executionMode: 'ask',
      }
    ])).toBe(false);
  });

  it('should return true on preset with output block', () => {
    expect(hasMeaningfulComposerContent([
      {
        id: 'test-intent',
        type: 'intent',
        intentType: 'question',
        detail: '',
      },
      {
        id: 'test-mode',
        type: 'mode',
        executionMode: 'ask',
      },
      {
        id: 'test-output',
        type: 'output',
        outputType: 'answer',
        includeFilesChanged: false,
        includeCommandsRun: false,
        includeRemainingRisks: false,
        includeManualQA: false,
      },
    ])).toBe(true);
  });
});
