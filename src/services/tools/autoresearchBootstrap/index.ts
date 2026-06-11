import { invoke } from '@tauri-apps/api/core';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import { invokeRustAPIStream } from '@/core/streamAdapter';
import { shellEscapePath } from '@/utils/remoteExec';
import { getAutoResearchBootstrapResultPath } from '@/services/autoresearch/bootstrap/applyBootstrap';
import { parseArxivAtomFeed } from './tsTools/arxivSearch';
import { parseBaselineExtractResponse } from './tsTools/baselineExtract';
import { finalizeBootstrapPlan } from './tsTools/bootstrapFinalize';
import { parsePaperExtractMetaResponse } from './tsTools/paperExtractMeta';
import { buildPdfReadResult } from './tsTools/pdfRead';
import { renderKnownScaffoldTemplate } from './tsTools/scaffoldGenerate';
import { useSettingsStore } from '@/store';
import { withWindowsShellProfileArgs } from '@/utils/windowsShellProfile';

export * from './tsTools/arxivSearch';
export * from './tsTools/baselineExtract';
export * from './tsTools/bootstrapFinalize';
export * from './tsTools/paperExtractMeta';
export * from './tsTools/pdfRead';
export * from './tsTools/scaffoldGenerate';

export const AUTORESEARCH_BOOTSTRAP_TOOL_NAMES = [
  'pdf_read',
  'paper_extract_meta',
  'baseline_extract',
  'arxiv_search',
  'scaffold_generate',
  'git_init_workdir',
  'bootstrap_finalize',
] as const;

type BootstrapToolName = (typeof AUTORESEARCH_BOOTSTRAP_TOOL_NAMES)[number];

interface CommandResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

function getParentDirectory(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '.';
}

async function invokeCoreTool(toolName: string, args: Record<string, unknown>, workDir?: string): Promise<string> {
  return invoke<string>('execute_tool', {
    toolName,
    arguments: JSON.stringify(args),
    workDir: workDir ?? null,
  });
}

async function ensureDirectory(path: string, workDir?: string): Promise<void> {
  await invokeCoreTool('create_directory', { path }, workDir);
}

async function writeTextFile(path: string, content: string, workDir?: string): Promise<void> {
  await ensureDirectory(getParentDirectory(path), workDir);
  await invokeCoreTool('write_file', { path, content }, workDir);
}

async function executeCommand(command: string, workDir?: string): Promise<CommandResult> {
  const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;
  const args = withWindowsShellProfileArgs('execute_command', { command, cwd: workDir }, windowsShellProfile);
  const raw = await invokeCoreTool('execute_command', args, workDir);
  return JSON.parse(raw) as CommandResult;
}

async function runJsonBootstrapInference(systemPrompt: string, userPrompt: string): Promise<string> {
  const config = resolveActiveAgentConfig();
  const issues = validateResolvedAgentConfig(config);
  if (issues.length > 0) {
    throw new Error(formatAgentConfigValidationError(config, issues));
  }

  const request = buildResolvedChatRequest(config!, {
    messages: [{ role: 'user', content: userPrompt }],
    systemPrompt,
    sessionId: `bootstrap-tool-${Date.now()}`,
    noTools: true,
    responseFormat: { type: 'json_object' },
  });

  let content = '';
  for await (const chunk of invokeRustAPIStream(request.params)) {
    if (chunk.type === 'text_delta') {
      content += chunk.content;
    }
    if (chunk.type === 'api_response_complete' && !content.trim()) {
      content = typeof chunk.response?.content === 'string' ? chunk.response.content : content;
    }
  }

  return content.trim();
}

function normalizeTemplateId(value: unknown): 'python-ml-baseline' | 'node-eval-harness' {
  return value === 'node-eval-harness' ? 'node-eval-harness' : 'python-ml-baseline';
}

function normalizeScaffoldVars(args: Record<string, any>): Record<string, string | number | boolean> {
  const projectName = String(args.projectName || args.project_name || 'autoresearch-bootstrap').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return {
    project_name: projectName || 'autoresearch-bootstrap',
    research_goal: String(args.researchGoal || args.research_goal || 'Bootstrap an AutoResearch experiment').trim(),
    success_criteria: String(args.successCriteria || args.success_criteria || 'Improve the primary metric over the selected baseline.').trim(),
    primary_metric: String(args.primaryMetric || args.primary_metric || 'score').trim(),
    baseline_name: String(args.baselineName || args.baseline_name || 'baseline').trim(),
    dataset_name: String(args.datasetName || args.dataset_name || 'dataset').trim(),
    train_command: String(args.trainCommand || args.train_command || 'python3 train.py').trim(),
    eval_command: String(args.evalCommand || args.eval_command || 'python3 eval.py').trim(),
    requirements_extra: String(args.requirementsExtra || args.requirements_extra || '').trim(),
    node_eval_command: String(args.nodeEvalCommand || args.node_eval_command || 'npx tsx index.ts').trim(),
  };
}

async function executeScaffoldGenerateTool(args: Record<string, any>, workDir?: string): Promise<string> {
  const templateId = normalizeTemplateId(args.templateId);
  const targetDir = String(args.workDir || workDir || '').trim();
  if (!targetDir) {
    throw new Error('scaffold_generate requires workDir');
  }

  const vars = normalizeScaffoldVars(args);
  const { scaffold, renderedFiles } = renderKnownScaffoldTemplate({
    templateId,
    workDir: targetDir,
    vars,
  });

  await ensureDirectory(targetDir, workDir);
  for (const file of renderedFiles) {
    await writeTextFile(`${targetDir}/${file.path}`, file.content, workDir);
  }

  return JSON.stringify(scaffold);
}

async function executeGitInitWorkdirTool(args: Record<string, any>, workDir?: string): Promise<string> {
  const targetDir = String(args.workDir || workDir || '').trim();
  if (!targetDir) {
    throw new Error('git_init_workdir requires workDir');
  }

  await ensureDirectory(targetDir, workDir);
  await executeCommand('git init', targetDir);
  await executeCommand('git config user.name "AutoResearch"', targetDir);
  await executeCommand('git config user.email "autoresearch@local"', targetDir);
  await executeCommand('git add -A', targetDir);
  await executeCommand('git commit --allow-empty -m "Initial bootstrap scaffold"', targetDir);
  const head = await executeCommand('git rev-parse --short HEAD', targetDir);

  return JSON.stringify({
    workDir: targetDir,
    gitInitialized: true,
    initialCommitSha: head.stdout?.trim() || undefined,
  });
}

async function executePdfReadTool(args: Record<string, any>, workDir?: string): Promise<string> {
  const path = String(args.path || args.filePath || '').trim();
  if (!path) {
    throw new Error('pdf_read requires path');
  }

  const command = `pdftotext -layout -nopgbrk ${shellEscapePath(path)} -`;
  const result = await executeCommand(command, workDir);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to read PDF: ${path}`);
  }

  const text = (result.stdout || '').trim();
  return JSON.stringify(buildPdfReadResult({
    filePath: path,
    text,
    sections: [{ heading: 'Document', text }],
  }));
}

async function executeArxivSearchTool(args: Record<string, any>): Promise<string> {
  const query = String(args.query || '').trim();
  const limit = Number(args.limit ?? 5) || 5;
  if (!query) {
    throw new Error('arxiv_search requires query');
  }

  const response = await fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`);
  if (!response.ok) {
    throw new Error(`arxiv_search failed with HTTP ${response.status}`);
  }
  const feed = await response.text();
  return JSON.stringify({ papers: parseArxivAtomFeed(feed) });
}

async function executePaperExtractMetaTool(args: Record<string, any>): Promise<string> {
  const sourceText = String(args.text || args.sourceText || '').trim();
  if (!sourceText) {
    throw new Error('paper_extract_meta requires text');
  }

  const raw = await runJsonBootstrapInference(
    'Extract a single paper metadata object from the provided text. Return JSON only with fields matching the paper schema. Do not invent missing fields.',
    sourceText,
  );
  const parsed = parsePaperExtractMetaResponse(raw);
  if (!parsed.ok || !parsed.paper) {
    throw new Error(parsed.reason || 'paper_extract_meta returned invalid JSON');
  }
  return JSON.stringify(parsed.paper);
}

async function executeBaselineExtractTool(args: Record<string, any>): Promise<string> {
  const sourceText = String(args.text || args.sourceText || '').trim();
  if (!sourceText) {
    throw new Error('baseline_extract requires text');
  }

  const raw = await runJsonBootstrapInference(
    'Extract one or more baselines from the provided paper text. Return JSON only in the form {"baselines": [...]} and only include metrics grounded in the text.',
    sourceText,
  );
  const parsed = parseBaselineExtractResponse(raw, sourceText);
  if (!parsed.ok) {
    return JSON.stringify({ baselines: [], unresolvedQuestions: parsed.unresolvedQuestions, reason: parsed.reason });
  }
  return JSON.stringify({ baselines: parsed.baselines, unresolvedQuestions: parsed.unresolvedQuestions });
}

async function executeBootstrapFinalizeTool(args: Record<string, any>, workDir?: string): Promise<string> {
  const planInput = {
    researchGoal: args.researchGoal,
    successCriteria: args.successCriteria,
    primaryMetric: args.primaryMetric,
    secondaryMetrics: args.secondaryMetrics ?? [],
    papers: args.papers ?? [],
    baselines: args.baselines ?? [],
    scaffold: args.scaffold,
    gitInitialized: Boolean(args.gitInitialized),
    initialCommitSha: args.initialCommitSha,
    conversationalTemplateId: args.conversationalTemplateId,
  };
  const result = finalizeBootstrapPlan(planInput as any, typeof args.createdAt === 'string' ? args.createdAt : undefined);
  const targetWorkDir = result.plan.scaffold.workDir || String(args.workDir || workDir || '').trim();
  if (targetWorkDir) {
    const bootstrapFilePath = getAutoResearchBootstrapResultPath(targetWorkDir);
    await ensureDirectory(getParentDirectory(bootstrapFilePath), workDir);
    await writeTextFile(bootstrapFilePath, `${JSON.stringify(result, null, 2)}\n`, workDir);
  }
  return JSON.stringify(result);
}

export async function executeAutoResearchBootstrapTool(
  toolName: BootstrapToolName,
  args: Record<string, any>,
  workDir?: string,
): Promise<string> {
  switch (toolName) {
    case 'pdf_read':
      return executePdfReadTool(args, workDir);
    case 'paper_extract_meta':
      return executePaperExtractMetaTool(args);
    case 'baseline_extract':
      return executeBaselineExtractTool(args);
    case 'arxiv_search':
      return executeArxivSearchTool(args);
    case 'scaffold_generate':
      return executeScaffoldGenerateTool(args, workDir);
    case 'git_init_workdir':
      return executeGitInitWorkdirTool(args, workDir);
    case 'bootstrap_finalize':
      return executeBootstrapFinalizeTool(args, workDir);
    default:
      throw new Error(`Unsupported bootstrap tool: ${toolName}`);
  }
}
