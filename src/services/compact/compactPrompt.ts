/**
 * Layer 3: Legacy Compact Prompt Templates
 * 
 * Claude Code 源码参考: restored-src/src/services/compact/prompt.ts
 */

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool Calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.`;

// 详细的分析指令
const DETAILED_ANALYSIS_INSTRUCTION = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.`;

const NO_TOOLS_TRAILER = `
REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.`;

/**
 * 完整的 Legacy Compact Prompt
 * 
 * Claude Code 参考: getCompactPrompt() 在 prompt.ts
 * 
 * 9 个必须字段：
 * 1. Primary Request and Intent
 * 2. Key Technical Concepts
 * 3. Files and Code Sections
 * 4. Errors and fixes
 * 5. Problem Solving
 * 6. All user messages
 * 7. Pending Tasks
 * 8. Current Work
 * 9. Optional Next Step
 */
export const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

${DETAILED_ANALYSIS_INSTRUCTION}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Example output structure:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages:
    - [Detailed non tool use user message]

7. Pending Tasks:
    - [Task 1]
    - [Task 2]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]
</summary>
</example>`;

/**
 * 获取完整的 compact prompt
 */
export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + '\n\n' + BASE_COMPACT_PROMPT;
  
  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }
  
  prompt += NO_TOOLS_TRAILER;
  return prompt;
}

/**
 * 格式化摘要文本
 * 
 * Claude Code 参考: formatCompactSummary() 在 prompt.ts
 * 
 * 逻辑：
 * 1. 去掉 <analysis>...</analysis> 块（草稿区）
 * 2. 把 <summary>...</summary> 替换为可读格式
 */
export function formatCompactSummary(raw: string): string {
  let formatted = raw;
  
  // Strip analysis section
  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, '');
  
  // Extract and format summary section
  const match = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${match[1]!.trim()}`
    );
  }
  
  // Clean up extra whitespace
  formatted = formatted.replace(/\n\n+/g, '\n\n');
  return formatted.trim();
}

/**
 * 构建用户可见的摘要消息
 * 
 * Claude Code 参考: getCompactUserSummaryMessage() 在 prompt.ts
 */
export function getCompactUserSummaryMessage(
  summary: string,
  suppressFollowUp: boolean = true,
  transcriptPath?: string,
): string {
  const formatted = formatCompactSummary(summary);
  
  let msg = `此会话正在从之前的对话中继续。以下是早期对话的摘要。\n\n${formatted}`;
  
  if (transcriptPath) {
    msg += `\n\n如需查看完整的早期对话历史，可读取：${transcriptPath}`;
  }
  
  msg += `\n\n最近的消息保持完整。`;
  
  if (suppressFollowUp) {
    msg += `\n\n请继续对话，不要询问用户任何问题。直接继续上次的工作。`;
  }
  
  return msg;
}
