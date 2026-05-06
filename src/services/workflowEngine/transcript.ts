import type { WorkflowAgent } from '@/types/workflow';

export type WorkflowTranscriptEntryType =
  | 'user_prompt_injected'
  | 'assistant_text'
  | 'tool_called'
  | 'tool_result'
  | 'agent_completed'
  | 'agent_error';

export interface WorkflowTranscriptEntry {
  timestamp: number;
  type: WorkflowTranscriptEntryType;
  content: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
}

export class WorkflowTranscriptManager {
  private readonly transcripts = new Map<string, WorkflowTranscriptEntry[]>();

  clear(): void {
    this.transcripts.clear();
  }

  record(agentId: string, entry: WorkflowTranscriptEntry): void {
    if (!this.transcripts.has(agentId)) {
      this.transcripts.set(agentId, []);
    }
    this.transcripts.get(agentId)!.push(entry);
  }

  get(agentId: string): WorkflowTranscriptEntry[] {
    return this.transcripts.get(agentId) ?? [];
  }
}

export function buildAgentArtifactBaseName(agent: WorkflowAgent): string {
  const safeName = agent.name
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const fallbackName = safeName || 'agent';
  return `${fallbackName}-${agent.id.slice(0, 8)}`;
}

export function renderTranscriptFile(
  agentId: string,
  runId: string,
  entries: WorkflowTranscriptEntry[],
): string {
  const lines = [
    '# Agent Operation Transcript',
    '',
    `**Agent ID**: ${agentId}`,
    `**Run ID**: ${runId}`,
    '',
    '---',
    '',
  ];

  for (const entry of entries) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    switch (entry.type) {
      case 'user_prompt_injected':
        lines.push(`## [${time}] 📥 User Prompt`, '', '```', entry.content, '```', '');
        break;
      case 'assistant_text':
        if (entry.content.trim()) {
          lines.push(`## [${time}] 🤖 Assistant`, '', entry.content.trim(), '');
        }
        break;
      case 'tool_called':
        lines.push(`## [${time}] 🔧 Tool Called`, `**Tool**: \`${entry.toolName}\``, '');
        if (entry.toolArgs) {
          lines.push('**Arguments**:', '```json', entry.toolArgs, '```');
        }
        lines.push('');
        break;
      case 'tool_result':
        lines.push(
          `## [${time}] 📋 Tool Result`,
          `**Tool**: \`${entry.toolName}\``,
          '',
          '```',
          (entry.toolResult || '(empty)').slice(0, 2000),
          '```',
          '',
        );
        break;
      case 'agent_completed':
        lines.push(
          `## [${time}] ✅ Agent Completed`,
          `**Output length**: ${entry.content.length} chars`,
          '',
          '```',
          entry.content.slice(0, 3000),
          entry.content.length > 3000 ? '... (truncated)' : '',
          '```',
          '',
        );
        break;
      case 'agent_error':
        lines.push(`## [${time}] ❌ Agent Error`, `\`\`\`\n${entry.content}\n\`\`\``, '');
        break;
    }
  }

  return lines.filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n');
}
