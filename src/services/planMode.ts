import { createDoc } from '@/services/docService';
import { DOCS_CHANGED_EVENT, type DocsChangedEventDetail } from '@/services/docEvents';

export const PLAN_MODE_SYSTEM_PROMPT = `
# PLAN MODE ACTIVATED

You are currently operating in PLAN MODE for this conversation.

## Strict Constraints

- Do not execute tools.
- Do not call file, terminal, browser, shell, or workspace tools.
- Do not claim that you have modified files, run commands, installed dependencies, created documents, or completed implementation.
- Do not pretend that any code change has already happened.
- Your only job is to produce a clear, actionable execution plan for user review.

## What You Must Produce

When the user asks for an implementation, debugging, refactor, feature, or multi-step task, produce a structured execution plan.

The plan should be specific enough that it can later be executed after the user switches from Plan Mode to Ask, Auto, or Bypass mode.

If the user's request is unclear, ask clarifying questions instead of inventing details.

## Required Plan Structure

Start with:

## Execution Plan: [Brief task description]

**Mode**: Plan Only  
**Status**: Not executed yet  
**Purpose**: Prepare a safe implementation plan before making changes.

Then include the following sections:

### 1. Goal Summary

Restate the user's request in your own words.
Clarify the intended outcome.
Mention any implicit requirements you detected.

### 2. Context and Assumptions

Describe what is known about the current project or conversation.
List assumptions you are making.
If important information is missing, state it clearly.

### 3. Proposed Implementation Steps

List the steps in execution order.

For each step, include:

- Action: what should be done
- Files: files likely to be created, modified, or inspected
- Tools: tools that would be used later, after Plan Mode is turned off
- Dependencies: what must happen before this step

Use this format:

Step 1: [Action]
- Files: [paths]
- Tools later: [tool names]
- Dependencies: [dependencies]

### 4. Files Likely Affected

List all files likely to be created, modified, or deleted.

Use this format:

- path/to/file.ts — reason for change
- path/to/another-file.tsx — reason for change

If exact paths are uncertain, say so.

### 5. Risks and Considerations

Mention potential breaking changes, migration risks, UI risks, data persistence risks, permission risks, or testing risks.
Mention trade-offs and alternative approaches when useful.

### 6. Validation Plan

Explain how the implementation should be verified.

Include:

- automated tests to add or run
- manual checks
- expected behavior
- regression checks for existing modes

### 7. Execution Gate

Clearly state:

This plan has not been executed.

To proceed, the user must:
1. Review and approve or revise the plan.
2. Switch Execution Mode from Plan to Ask, Auto, or Bypass.
3. Ask the agent to execute the approved plan.

## Iteration Behavior

If the user asks to modify the plan, update the relevant sections and preserve the same structure.
Do not execute the plan while still in Plan Mode.
`.trim();

export interface SavePlanModeDocParams {
  workDir: string;
  userRequest: string;
  planMarkdown: string;
  sessionId?: string;
}

export interface SavePlanModeDocResult {
  path: string;
  number: string;
  filename: string;
}

export async function savePlanModeDoc({
  workDir,
  userRequest,
  planMarkdown,
}: SavePlanModeDocParams): Promise<SavePlanModeDocResult> {
  const title = createPlanTitle(userRequest);

  const doc = await createDoc(workDir, {
    title,
    body: planMarkdown,
    tags: ['plan', 'plan-mode', 'execution-plan'],
    summary: createPlanSummary(userRequest),
  });

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<DocsChangedEventDetail>(DOCS_CHANGED_EVENT, {
        detail: {
          workDir,
          path: doc.path,
        },
      }),
    );
  }

  return {
    path: doc.path,
    number: doc.number,
    filename: doc.filename,
  };
}

export function shouldSavePlanDoc(content: string): boolean {
  const normalized = content.toLowerCase();

  return (
    normalized.includes('execution plan')
    || normalized.includes('proposed implementation steps')
    || normalized.includes('execution gate')
    || normalized.includes('validation plan')
    || normalized.includes('执行计划')
    || normalized.includes('实施步骤')
    || normalized.includes('验证计划')
    || normalized.includes('执行门')
    || normalized.includes('执行闸门')
  );
}

function createPlanTitle(userRequest: string): string {
  const cleaned = userRequest
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return cleaned ? `Plan - ${cleaned}` : 'Plan - Untitled Task';
}

function createPlanSummary(userRequest: string): string {
  const cleaned = userRequest
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

  return cleaned
    ? `Execution plan generated in Plan Mode for: ${cleaned}`
    : 'Execution plan generated in Plan Mode.';
}