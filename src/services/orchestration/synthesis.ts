/**
 * Synthesis Builder
 *
 * Transforms raw delegation results into a structured synthesis prompt
 * that guides the main thread to produce a strong final answer.
 *
 * This is NOT an LLM-based synthesis loop — it's a deterministic builder
 * that constructs the right prompt context for the main thread's single
 * query engine pass.
 */

import type { DelegationPlan, DelegationResult, AgentResult } from './types';
import type { FollowThroughInstruction } from './followThrough';

// =============================================================================
// Synthesis Prompt Builder
// =============================================================================

/**
 * Build a synthesis prompt that will be injected as a user message
 * into the conversation for the main thread to respond to.
 *
 * The prompt includes:
 * 1. Context header explaining this is a delegation synthesis
 * 2. Structured agent results (deduplicated, organized by role)
 * 3. Status summary (what succeeded, what failed)
 * 4. Follow-through guidance (what kind of output to produce)
 * 5. Original user request reminder
 */
export function buildSynthesisPrompt(
  plan: DelegationPlan,
  result: DelegationResult,
  followThrough: FollowThroughInstruction,
): string {
  const sections: string[] = [];

  // 1. Context header
  sections.push(buildContextHeader(plan, result));

  // 2. Agent results
  sections.push(buildAgentResultsSection(result.agentResults, plan));

  // 3. Status summary
  sections.push(buildStatusSummary(result));

  // 4. Synthesis instruction with follow-through guidance
  sections.push(buildSynthesisInstruction(plan, followThrough));

  return sections.join('\n\n');
}

// =============================================================================
// Section Builders
// =============================================================================

function buildContextHeader(plan: DelegationPlan, result: DelegationResult): string {
  const agentCount = plan.agents.length;
  const successCount = result.agentResults.filter((r) => r.success).length;
  const durationSec = result.completedAt
    ? Math.round((result.completedAt - result.startedAt) / 1000)
    : '?';

  return [
    `[System — Orchestration Synthesis]`,
    `You are the main thread. ${agentCount} specialist agent${agentCount > 1 ? 's' : ''} explored the codebase on your behalf (${successCount}/${agentCount} succeeded, ~${durationSec}s).`,
    `Their raw findings are below. Your job is to synthesize them into ONE cohesive response — do NOT just concatenate or list each agent\'s output.`,
    `Deduplicate overlapping information. Where multiple agents cover the same file or topic, merge into a single point.`,
    `Write as one expert, in first person. The user should feel they are getting a single authoritative answer, not a committee report.`,
    `Never mention agent names, agent counts, or delegation mechanics in your response.`,
    `CRITICAL: This is the synthesis pass. Do NOT call any tools or read any files. All the codebase information you need is already contained in the agent findings below. Produce your complete response immediately, without any tool calls.`,
  ].join(' ');
}

function buildAgentResultsSection(results: AgentResult[], plan: DelegationPlan): string {
  if (results.length === 0) {
    return '**No agent results were collected.** Please respond based on your own knowledge.';
  }

  const sections: string[] = ['---', '## Agent Findings'];

  // Group results: successful first, then failed
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  for (const r of successful) {
    const planned = plan.agents.find((a) => a.name === r.agentName);
    const scope = planned?.scope || 'general';
    sections.push(`### ${r.agentName} (${formatRole(r.role)}) — ${scope}`);
    sections.push(trimContent(r.content));
    sections.push('');
  }

  if (failed.length > 0) {
    sections.push('### ⚠️ Failed Agents');
    for (const r of failed) {
      sections.push(`- **${r.agentName}** (${formatRole(r.role)}): ${r.error || 'Unknown error'}`);
      if (r.content) {
        sections.push(`  Partial output: ${r.content.slice(0, 200)}...`);
      }
    }
    sections.push('');
  }

  sections.push('---');
  return sections.join('\n');
}

function buildStatusSummary(result: DelegationResult): string {
  const total = result.agentResults.length;
  const succeeded = result.agentResults.filter((r) => r.success).length;
  const failed = total - succeeded;

  if (failed === 0) {
    return `**Status:** All ${total} agents completed successfully.`;
  }
  if (succeeded === 0) {
    return `**Status:** All ${total} agents failed. Please provide the best response you can based on your own knowledge and note the investigation failure.`;
  }
  return `**Status:** ${succeeded}/${total} agents succeeded, ${failed} failed. Synthesize from available results and note gaps from failed agents.`;
}

function buildSynthesisInstruction(
  plan: DelegationPlan,
  followThrough: FollowThroughInstruction,
): string {
  return [
    '## Your Task',
    '',
    `**Original request:** "${plan.userMessage}"`,
    '',
    followThrough.promptGuidance,
    '',
    '**Synthesis rules:**',
    '- Do NOT call any tools or read any files. Synthesize only from the agent findings above.',
    '- Write in first person as one expert. Never mention agents, agent names, or delegation in your response.',
    '- Merge overlapping findings — if two agents covered the same file or topic, combine into one section.',
    '- Organize by topic/theme, not by which agent produced the information.',
    '- Omit all agent metadata, timing info, status labels, and delegation framing from your response.',
    '- If findings disagree, resolve the conflict — do not report both sides without resolution.',
  ].join('\n');
}

// =============================================================================
// Helpers
// =============================================================================

function formatRole(role: string): string {
  return role.replace(/_/g, ' ');
}

/**
 * Trim excessively long content to keep the synthesis prompt within reasonable bounds.
 * Each agent's output is capped at ~3000 chars to prevent context overflow.
 */
function trimContent(content: string): string {
  const MAX_AGENT_OUTPUT = 3000;
  if (content.length <= MAX_AGENT_OUTPUT) return content;
  return content.slice(0, MAX_AGENT_OUTPUT) + '\n\n[... output truncated for synthesis ...]';
}

/**
 * Build a short human-readable progress message for the chat UI.
 */
export function buildProgressMessage(phase: 'started' | 'agents_complete' | 'synthesizing', plan: DelegationPlan, result?: DelegationResult): string {
  switch (phase) {
    case 'started':
      return `🔍 Delegating to ${plan.agents.length} specialist${plan.agents.length > 1 ? 's' : ''}...`;
    case 'agents_complete': {
      if (!result) return '✅ All agents completed. Synthesizing results...';
      const succeeded = result.agentResults.filter((r) => r.success).length;
      const total = result.agentResults.length;
      if (succeeded === total) return `✅ All ${total} agents completed. Synthesizing results...`;
      return `⚠️ ${succeeded}/${total} agents completed. Synthesizing available results...`;
    }
    case 'synthesizing':
      return '📝 Producing final response...';
  }
}
