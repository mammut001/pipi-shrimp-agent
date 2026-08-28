from __future__ import annotations

from pathlib import Path
import ast
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def replace(path: str, old: str, new: str, *, expected: int | None = None) -> None:
    text = read(path)
    count = text.count(old)
    if expected is not None and count != expected:
        raise RuntimeError(f"{path}: expected {expected} occurrences, found {count}: {old!r}")
    if count == 0:
        raise RuntimeError(f"{path}: pattern not found: {old!r}")
    write(path, text.replace(old, new))


def replace_if_present(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old in text:
        path.write_text(text.replace(old, new), encoding="utf-8")


GOAL_TYPES = r'''/**
 * Shared Goal Core domain types.
 *
 * Session Goal and Workflow Goal have different runtimes, but they share the
 * same objective / success-criteria vocabulary and evaluation contract. Keep
 * runtime-specific state (budgets, traces, routing, iterations) outside this
 * module.
 */

export type GoalSuccessCriteria = string[];
export type GoalSuccessCriteriaInput = string | readonly string[] | null | undefined;

export interface GoalSpec {
  objective: string;
  successCriteria: GoalSuccessCriteria;
  asciiPreview?: string;
  assumptions?: string[];
  risks?: string[];
}

export interface GoalEvaluation {
  reached: boolean;
  confidence: number;
  reasoning: string;
  evidence?: string[];
  missingItems?: string[];
  timestamp: number;
}

function normalizeCriterion(item: string): string {
  return item
    .trim()
    .replace(/^[-•*]+\s*/, '')
    .trim();
}

/**
 * Normalize any legacy/new success-criteria representation into Goal Core's
 * canonical string[] shape. This is intentionally safe for persisted data
 * written by older pipi-shrimp versions.
 */
export function normalizeSuccessCriteria(input: GoalSuccessCriteriaInput): GoalSuccessCriteria {
  const items = typeof input === 'string'
    ? input.split(/\r?\n/)
    : Array.isArray(input)
      ? input
      : [];

  return items
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeCriterion)
    .filter(Boolean);
}

/** @deprecated Use normalizeSuccessCriteria. */
export const parseSuccessCriteria = normalizeSuccessCriteria;

/** Render canonical criteria for textareas/prompts without changing storage. */
export function formatSuccessCriteria(input: GoalSuccessCriteriaInput): string {
  return normalizeSuccessCriteria(input)
    .map((item) => `- ${item}`)
    .join('\n');
}

/** @deprecated UI/prompt adapter only; Goal Core storage is string[]. */
export const serializeSuccessCriteria = formatSuccessCriteria;
'''
write("src/services/goal/types.ts", GOAL_TYPES)

GOAL_PREFLIGHT = r'''/**
 * Goal Core Preflight — shared clarification schema.
 *
 * Both Session Goal and Workflow Goal can start from a rough natural-language
 * objective. The clarifier turns that input into a structured, reviewable
 * result before either runtime begins executing it.
 */

import { z } from 'zod';

export const GOAL_PREFLIGHT_AGENT_ROLES = [
  'planner',
  'writer',
  'developer',
  'reviewer',
  'qa',
  'security',
  'devops',
  'custom',
] as const;

export type GoalPreflightAgentRole = typeof GOAL_PREFLIGHT_AGENT_ROLES[number];

export const GoalPreflightAgentSuggestionSchema = z.object({
  role: z.enum(GOAL_PREFLIGHT_AGENT_ROLES),
  name: z.string().min(1),
  task: z.string().min(1),
  reason: z.string().min(1),
}).strict();

export type GoalPreflightAgentSuggestion = z.infer<typeof GoalPreflightAgentSuggestionSchema>;

export const GoalPreflightResultSchema = z.object({
  status: z.enum(['needs_more_info', 'ready']),
  finalGoal: z.string().min(1),
  successCriteria: z.array(z.string().min(1)),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  suggestedAgents: z.array(GoalPreflightAgentSuggestionSchema),
  asciiPreview: z.string(),
  risks: z.array(z.string()),
  readinessScore: z.number().int().min(0).max(100),
  schemaVersion: z.literal(1).optional(),
}).strict();

export type GoalPreflightResult = z.infer<typeof GoalPreflightResultSchema>;

export interface GoalPreflightAssistantTurn {
  status: 'needs_more_info' | 'ready';
  questionText: string;
  result: GoalPreflightResult | null;
}

export function tryParseGoalPreflightResult(raw: string): GoalPreflightResult | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  const cleaned = extractJsonObject(raw);
  if (!cleaned) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const result = GoalPreflightResultSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function extractJsonObject(input: string): string | null {
  let text = input.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}
'''
write("src/services/goal/preflight/schema.ts", GOAL_PREFLIGHT)

# Goal Preflight is no longer Workflow-owned. Migrate every direct caller.
for path in ROOT.glob("src/**/*"):
    if path.suffix not in {".ts", ".tsx"} or not path.is_file():
        continue
    replace_if_present(
        path,
        "@/services/workflow/goalPreflight/schema",
        "@/services/goal/preflight/schema",
    )

# Move schema tests into Goal Core and remove the compatibility shim.
old_test = ROOT / "src/services/workflow/goalPreflight/__tests__/schema.test.ts"
new_test = ROOT / "src/services/goal/preflight/__tests__/schema.test.ts"
if old_test.exists():
    new_test.parent.mkdir(parents=True, exist_ok=True)
    new_test.write_text(old_test.read_text(encoding="utf-8"), encoding="utf-8")
    old_test.unlink()
old_schema = ROOT / "src/services/workflow/goalPreflight/schema.ts"
if old_schema.exists():
    old_schema.unlink()

# Workflow's public in-memory model now uses Goal Core's canonical string[].
workflow_types = read("src/types/workflow.ts")
workflow_types = workflow_types.replace(
    "import type { GoalEvaluation } from '@/services/goal/types';",
    "import type { GoalEvaluation, GoalSpec } from '@/services/goal/types';",
)
count = workflow_types.count("successCriteria: string;")
if count != 2:
    raise RuntimeError(f"src/types/workflow.ts: expected 2 string criteria fields, found {count}")
workflow_types = workflow_types.replace(
    "successCriteria: string;",
    "successCriteria: GoalSpec['successCriteria'];",
)
write("src/types/workflow.ts", workflow_types)

# Store hydration is the persistence migration boundary: old newline strings are
# accepted, normalized, and immediately written back as arrays.
store_path = "src/store/workflowStore.ts"
store = read(store_path)
anchor = "import { useUIStore } from '@/store/uiStore';\n"
if "normalizeSuccessCriteria" not in store:
    store = store.replace(anchor, anchor + "import { normalizeSuccessCriteria } from '@/services/goal/types';\n")
store = store.replace(
    "successCriteria: run.successCriteria ?? '',",
    "successCriteria: normalizeSuccessCriteria(run.successCriteria as unknown as string | string[]),",
)
store = store.replace(
    "successCriteria: instance.successCriteria ?? '',",
    "successCriteria: normalizeSuccessCriteria(instance.successCriteria as unknown as string | string[]),",
)
# V1 migration + new instance defaults.
store = store.replace("successCriteria: '',", "successCriteria: [],")
old_v2 = """    if (v2) {\n      const parsed = JSON.parse(v2);\n      return {\n        instances: (parsed.instances || []).map(normalizeInstance),\n        currentInstanceId: parsed.currentInstanceId || null,\n      };\n    }"""
new_v2 = """    if (v2) {\n      const parsed = JSON.parse(v2);\n      const instances = (parsed.instances || []).map(normalizeInstance);\n      const currentInstanceId = parsed.currentInstanceId || null;\n      // Persist the normalized representation immediately so legacy string\n      // criteria are migrated even before the user edits the workflow.\n      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({ instances, currentInstanceId }));\n      return { instances, currentInstanceId };\n    }"""
if old_v2 not in store:
    raise RuntimeError("workflowStore V2 hydration block not found")
store = store.replace(old_v2, new_v2)
write(store_path, store)

# Workflow Goal UI: textarea remains text, store is canonical string[].
panel_path = "src/components/workflow/WorkflowGoalPanel.tsx"
panel = read(panel_path)
panel = panel.replace(
    "import {\n  serializeSuccessCriteria,\n  type GoalPreflightResult,\n} from '@/services/goal/preflight/schema';",
    "import type { GoalPreflightResult } from '@/services/goal/preflight/schema';\nimport { formatSuccessCriteria, normalizeSuccessCriteria } from '@/services/goal/types';",
)
panel = panel.replace(
    "setSuccessCriteria(currentInstance.successCriteria || '');",
    "setSuccessCriteria(formatSuccessCriteria(currentInstance.successCriteria));",
)
panel = panel.replace(
    "    const criteriaString = serializeSuccessCriteria(result.successCriteria);\n",
    "",
)
panel = panel.replace("successCriteria: criteriaString,", "successCriteria: result.successCriteria,")
panel = panel.replace("setSuccessCriteria(criteriaString);", "setSuccessCriteria(formatSuccessCriteria(result.successCriteria));")
# Only the manual Save path still passes the textarea string.
panel = panel.replace(
    "                successCriteria,\n                goalEvaluatorAgentId:",
    "                successCriteria: normalizeSuccessCriteria(successCriteria),\n                goalEvaluatorAgentId:",
)
write(panel_path, panel)

# Workflow preflight result card renders criteria via Goal Core UI adapter.
preflight_panel_path = "src/components/workflow/WorkflowGoalPreflightPanel.tsx"
preflight_panel = read(preflight_panel_path)
preflight_panel = preflight_panel.replace("  serializeSuccessCriteria,\n", "")
if "formatSuccessCriteria" not in preflight_panel:
    preflight_panel = preflight_panel.replace(
        "import { useWorkflowStore } from '@/store/workflowStore';",
        "import { useWorkflowStore } from '@/store/workflowStore';\nimport { formatSuccessCriteria } from '@/services/goal/types';",
    )
preflight_panel = preflight_panel.replace("serializeSuccessCriteria(", "formatSuccessCriteria(")
write(preflight_panel_path, preflight_panel)

# Prompt/evaluator adapters consume canonical arrays and render only at the LLM boundary.
prompt_path = "src/services/workflowPromptBuilder.ts"
prompt = read(prompt_path)
if "formatSuccessCriteria" not in prompt:
    prompt = prompt.replace(
        "import { normalizeWorkflowAgentRole } from '@/services/workflow/templates/roles';",
        "import { normalizeWorkflowAgentRole } from '@/services/workflow/templates/roles';\nimport { formatSuccessCriteria } from '@/services/goal/types';",
    )
prompt = prompt.replace("  successCriteria?: string;", "  successCriteria?: readonly string[];")
prompt = prompt.replace(
    "${options.successCriteria?.trim() || '（未设置）'}",
    "${formatSuccessCriteria(options.successCriteria) || '（未设置）'}",
)
write(prompt_path, prompt)

evaluator_path = "src/services/workflowGoalEvaluator.ts"
evaluator = read(evaluator_path)
if "formatSuccessCriteria" not in evaluator:
    evaluator = evaluator.replace(
        "import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';",
        "import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';\nimport { formatSuccessCriteria } from '@/services/goal/types';",
    )
evaluator = evaluator.replace(
    "`Success Criteria:\\n${context.instance.successCriteria?.trim() || ''}`",
    "`Success Criteria:\\n${formatSuccessCriteria(context.instance.successCriteria)}`",
)
write(evaluator_path, evaluator)

engine_path = "src/services/workflowEngine/engine.ts"
engine = read(engine_path)
if "normalizeSuccessCriteria" not in engine:
    engine = engine.replace(
        "import { DEFAULT_MAX_GOAL_ITERATIONS } from '@/services/workflow/defaults';",
        "import { DEFAULT_MAX_GOAL_ITERATIONS } from '@/services/workflow/defaults';\nimport { normalizeSuccessCriteria } from '@/services/goal/types';",
    )
engine = engine.replace("  successCriteria: string;", "  successCriteria: string[];")
engine = engine.replace(
    "    successCriteria: instance.successCriteria?.trim() || '',",
    "    successCriteria: normalizeSuccessCriteria(instance.successCriteria),",
)
engine = engine.replace(
    "    successCriteria: snapshot.successCriteria,",
    "    successCriteria: [...snapshot.successCriteria],",
)
engine = engine.replace(
    "    const successCriteria = instance.successCriteria?.trim() || '';",
    "    const successCriteria = normalizeSuccessCriteria(instance.successCriteria);",
)
engine = engine.replace(
    "  Object.freeze(snapshot.agents);",
    "  Object.freeze(snapshot.successCriteria);\n  Object.freeze(snapshot.agents);",
)
# Runs should own their snapshot array rather than sharing a mutable reference.
engine = engine.replace("        successCriteria,\n        status: 'error',", "        successCriteria: [...successCriteria],\n        status: 'error',")
engine = engine.replace("      successCriteria,\n      status: 'running',", "      successCriteria: [...successCriteria],\n      status: 'running',")
write(engine_path, engine)

# Convert Workflow-related object-literal fixtures/defaults to canonical arrays.
def normalize_literal(value: str) -> list[str]:
    return [
        re.sub(r"^[-•*]+\\s*", "", line.strip()).strip()
        for line in value.splitlines()
        if re.sub(r"^[-•*]+\\s*", "", line.strip()).strip()
    ]

single_re = re.compile(r"(successCriteria:\\s*)'((?:\\\\.|[^'\\n])*)'")
double_re = re.compile(r'(successCriteria:\\s*)"((?:\\\\.|[^"\\n])*)"')

def convert_literals(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    def repl_single(match: re.Match[str]) -> str:
        try:
            value = ast.literal_eval("'" + match.group(2) + "'")
        except Exception:
            return match.group(0)
        return match.group(1) + json.dumps(normalize_literal(value), ensure_ascii=False)

    def repl_double(match: re.Match[str]) -> str:
        try:
            value = ast.literal_eval('"' + match.group(2) + '"')
        except Exception:
            return match.group(0)
        return match.group(1) + json.dumps(normalize_literal(value), ensure_ascii=False)

    updated = single_re.sub(repl_single, text)
    updated = double_re.sub(repl_double, updated)
    if updated != text:
        path.write_text(updated, encoding="utf-8")

workflow_targets: set[Path] = set()
for pattern in [
    "src/components/workflow/**/*.ts",
    "src/components/workflow/**/*.tsx",
    "src/services/workflow/**/*.ts",
    "src/services/workflowEngine/**/*.ts",
    "src/services/__tests__/workflow*.test.ts",
    "src/services/workflow*.ts",
    "src/store/__tests__/workflowStore.test.ts",
    "src/utils/workflowValidation.ts",
    "src/components/Sidebar.tsx",
]:
    workflow_targets.update(ROOT.glob(pattern))
workflow_targets.add(ROOT / "src/store/workflowStore.ts")
for target in sorted(workflow_targets):
    if target.is_file() and target.suffix in {".ts", ".tsx"}:
        convert_literals(target)

# The panel intentionally uses a string textarea; restore its local initial state
# if the fixture converter ever sees it (it currently does not match assignments).

# Add explicit persistence migration coverage.
MIGRATION_TEST = r'''import { describe, expect, it, jest } from '@jest/globals';

describe('workflow goal criteria persistence migration', () => {
  it('hydrates legacy V2 string criteria into canonical arrays and writes them back', async () => {
    localStorage.clear();
    jest.resetModules();

    localStorage.setItem('pipi-workflow-v2', JSON.stringify({
      currentInstanceId: 'legacy',
      instances: [{
        id: 'legacy',
        name: 'Legacy Workflow',
        projectGoal: 'Ship the feature',
        successCriteria: '- tests pass\n• docs updated',
        goalEvaluatorAgentId: null,
        maxGoalIterations: 5,
        agents: [],
        connections: [],
        workflowRuns: [{
          id: 'legacy-run',
          title: 'Legacy run',
          projectGoal: 'Ship the feature',
          successCriteria: 'tests pass\ndocs updated',
          status: 'idle',
          startTime: 1,
          agents: [],
        }],
        activeRunId: null,
        dirtyAgentIds: [],
        createdAt: 1,
        updatedAt: 1,
      }],
    }));

    const { useWorkflowStore } = await import('../workflowStore');
    const instance = useWorkflowStore.getState().instances[0];

    expect(instance.successCriteria).toEqual(['tests pass', 'docs updated']);
    expect(instance.workflowRuns[0].successCriteria).toEqual(['tests pass', 'docs updated']);

    const persisted = JSON.parse(localStorage.getItem('pipi-workflow-v2') || '{}');
    expect(persisted.instances[0].successCriteria).toEqual(['tests pass', 'docs updated']);
    expect(persisted.instances[0].workflowRuns[0].successCriteria).toEqual(['tests pass', 'docs updated']);
  });
});
'''
write("src/store/__tests__/workflowGoalCriteriaMigration.test.ts", MIGRATION_TEST)

# Strengthen Goal Core adapter coverage.
GOAL_TYPES_TEST = r'''import { describe, expect, it } from '@jest/globals';

import {
  formatSuccessCriteria,
  normalizeSuccessCriteria,
  parseSuccessCriteria,
  serializeSuccessCriteria,
} from '@/services/goal/types';

describe('Goal Core success criteria adapters', () => {
  it('normalizes legacy Workflow text into canonical string[] criteria', () => {
    expect(normalizeSuccessCriteria('- first\n• second\n\n third ')).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('keeps canonical arrays canonical and removes accidental bullet prefixes', () => {
    expect(normalizeSuccessCriteria([' first ', '- second', '• third', ''])).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('round-trips canonical criteria through text adapters', () => {
    const criteria = ['first', 'second', 'third'];
    expect(parseSuccessCriteria(serializeSuccessCriteria(criteria))).toEqual(criteria);
  });

  it('renders criteria only at UI/prompt boundaries', () => {
    expect(formatSuccessCriteria(['first', 'second'])).toBe('- first\n- second');
  });

  it('normalizes nullish input to an empty array', () => {
    expect(normalizeSuccessCriteria(undefined)).toEqual([]);
    expect(normalizeSuccessCriteria(null)).toEqual([]);
  });
});
'''
write("src/services/goal/__tests__/types.test.ts", GOAL_TYPES_TEST)

# Fix the existing CI baseline so root tests genuinely execute.
ci_path = ".github/workflows/ci.yml"
ci = read(ci_path)
ci = ci.replace(
    "      - uses: pnpm/action-setup@v4\n      - uses: actions/setup-node@v4",
    "      - uses: pnpm/action-setup@v4\n        with:\n          version: 9\n      - uses: actions/setup-node@v4",
)
ci = ci.replace(
    "      - run: pnpm test -- --passWithNoTests 2>/dev/null || true",
    "      - run: pnpm test -- --passWithNoTests",
)
write(ci_path, ci)

# Delete the one-shot migration machinery from the resulting commit.
for ephemeral in [
    ROOT / "tools/goal-core-migrate.py",
    ROOT / ".github/workflows/goal-core-migrate.yml",
]:
    if ephemeral.exists():
        ephemeral.unlink()

print('Goal Core migration applied successfully.')
