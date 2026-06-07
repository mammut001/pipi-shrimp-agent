import type { SshConfig } from '@/store/autoresearchStore';
import { shellEscape, shellEscapePath } from '@/utils/remoteExec';
import {
  executeTargetCommand,
  readTargetText,
  writeTargetText,
} from './runDir';

export interface AutoResearchProjectAdaptResult {
  adapted: boolean;
  actions: string[];
  inferredProjectType: 'python' | 'node' | 'unknown';
  detectedEntryScript: string | null;
  detectedCommand: string | null;
  detectedNotebookFiles: string[];
  detectedResultFiles: string[];
}

interface ProjectState {
  gitRepo: boolean;
  hasHeadCommit: boolean;
  dirtyFileCount: number;
  hasRunExperiment: boolean;
  hasNotes: boolean;
  hasGitignore: boolean;
  hasPackageJson: boolean;
  pythonCandidates: string[];
  notebookCandidates: string[];
  resultJsonCandidates: string[];
}

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseProjectState(raw: string): ProjectState {
  const values = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [key, ...rest] = trimmed.split('\t');
    values.set(key, rest.join('\t'));
  }

  const dirtyFileCount = Number.parseInt(values.get('dirty_file_count') || '0', 10);
  return {
    gitRepo: values.get('git_repo') === '1',
    hasHeadCommit: values.get('has_head_commit') === '1',
    dirtyFileCount: Number.isFinite(dirtyFileCount) ? dirtyFileCount : 0,
    hasRunExperiment: values.get('has_run_experiment') === '1',
    hasNotes: values.get('has_notes') === '1',
    hasGitignore: values.get('has_gitignore') === '1',
    hasPackageJson: values.get('has_package_json') === '1',
    pythonCandidates: parseList(values.get('python_candidates')),
    notebookCandidates: parseList(values.get('notebook_candidates')),
    resultJsonCandidates: parseList(values.get('result_json_candidates')),
  };
}

async function inspectProjectState(cfg: SshConfig, experimentDir: string): Promise<ProjectState> {
  const command = [
    `repo=${shellEscape(experimentDir)}`,
    'git_repo=0',
    'has_head_commit=0',
    'dirty_file_count=0',
    'if git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  git_repo=1',
    '  if git -C "$repo" rev-parse --verify HEAD >/dev/null 2>&1; then',
    '    has_head_commit=1',
    '  fi',
    '  dirty_file_count="$(git -C "$repo" status --porcelain | wc -l | tr -d \' \')"',
    'fi',
    'printf \'git_repo\\t%s\\n\' "$git_repo"',
    'printf \'has_head_commit\\t%s\\n\' "$has_head_commit"',
    'printf \'dirty_file_count\\t%s\\n\' "$dirty_file_count"',
    'printf \'has_run_experiment\\t%s\\n\' "$([ -f "$repo/run_experiment.py" ] && printf 1 || printf 0)"',
    'printf \'has_notes\\t%s\\n\' "$([ -f "$repo/AUTORESEARCH.md" ] && printf 1 || printf 0)"',
    'printf \'has_gitignore\\t%s\\n\' "$([ -f "$repo/.gitignore" ] && printf 1 || printf 0)"',
    'printf \'has_package_json\\t%s\\n\' "$([ -f "$repo/package.json" ] && printf 1 || printf 0)"',
    'python_candidates="$(find "$repo" -maxdepth 1 -type f -name \'*.py\' -printf \'%f,\' 2>/dev/null | sed \'s/,$//\')"',
    'notebook_candidates="$(find "$repo" -maxdepth 1 -type f -name \'*.ipynb\' -printf \'%f,\' 2>/dev/null | sed \'s/,$//\')"',
    'result_json_candidates="$(find "$repo" -maxdepth 2 -type f \\( -name \'metrics.json\' -o -name \'results.json\' -o -name \'eval_results.json\' -o -name \'scores.json\' \\) -printf \'%P,\' 2>/dev/null | sed \'s/,$//\')"',
    'printf \'python_candidates\\t%s\\n\' "$python_candidates"',
    'printf \'notebook_candidates\\t%s\\n\' "$notebook_candidates"',
    'printf \'result_json_candidates\\t%s\\n\' "$result_json_candidates"',
  ].join('\n');

  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, command, 90);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to inspect AutoResearch project: ${experimentDir}`);
  }
  return parseProjectState(result.stdout || '');
}

function inferProjectType(state: ProjectState): 'python' | 'node' | 'unknown' {
  if (state.pythonCandidates.length > 0) {
    return 'python';
  }
  if (state.hasPackageJson) {
    return 'node';
  }
  return 'unknown';
}

function pickDefaultEntryScript(candidates: string[]): string | null {
  const filtered = candidates.filter((item) => item !== 'run_experiment.py');
  if (filtered.length === 0) {
    return null;
  }

  const preferredPatterns = [
    /^train/i,
    /^main/i,
    /^run/i,
    /^fit/i,
    /^experiment/i,
    /^eval/i,
  ];
  for (const pattern of preferredPatterns) {
    const match = filtered.find((item) => pattern.test(item));
    if (match) {
      return match;
    }
  }
  return filtered[0] || null;
}

function buildDetectedCommand(input: {
  inferredProjectType: 'python' | 'node' | 'unknown';
  defaultEntryScript: string | null;
  hasPackageJson: boolean;
  notebookCandidates: string[];
}): string | null {
  if (input.inferredProjectType === 'python' && input.defaultEntryScript) {
    return `python3 ${input.defaultEntryScript}`;
  }
  if (input.inferredProjectType === 'node' && input.hasPackageJson) {
    return 'npm run evaluate';
  }
  if (input.notebookCandidates.length > 0) {
    return null;
  }
  return null;
}

function buildAutoResearchNotesContent(input: {
  experimentDir: string;
  inferredProjectType: 'python' | 'node' | 'unknown';
  defaultEntryScript: string | null;
  detectedCommand: string | null;
  notebookCandidates: string[];
  resultJsonCandidates: string[];
}): string {
  return [
    '# AutoResearch Notes',
    '',
    '## Goal',
    'Make this existing project runnable by AutoResearch with the smallest safe adapter layer.',
    '',
    '## Project Shape',
    `- Project root: ${input.experimentDir}`,
    `- Detected runtime: ${input.inferredProjectType === 'unknown' ? 'unknown, assume Python wrapper first' : input.inferredProjectType}`,
    input.defaultEntryScript
      ? `- Detected legacy entry script: ${input.defaultEntryScript}`
      : '- No stable legacy training entry point was detected yet; use AUTORESEARCH_TRAIN_COMMAND if needed',
    input.detectedCommand
      ? `- Default detected command: ${input.detectedCommand}`
      : '- No default runnable command was detected yet; set AUTORESEARCH_TRAIN_COMMAND if needed',
    input.resultJsonCandidates.length > 0
      ? `- Existing result files: ${input.resultJsonCandidates.join(', ')}`
      : '- No standard result JSON files were discovered yet',
    input.notebookCandidates.length > 0
      ? `- Notebook files: ${input.notebookCandidates.join(', ')}`
      : '- No notebook files were discovered at the project root',
    '- Canonical AutoResearch entry point: run_experiment.py',
    '',
    '## Contract',
    '- run_experiment.py must write a valid metrics.json',
    '- The selected primary metric must be written to metricName and metricValue',
    '- Additional metrics should stay in extra',
    '',
    '## Safe Changes',
    '- Adjust wrapper logic in run_experiment.py',
    '- Tune train or eval commands through environment variables',
    '- Add small helper files that improve experiment reproducibility',
    '',
    '## Do Not Do',
    '- Do not delete training data',
    '- Do not write outside the project root except normal AutoResearch run artifacts',
    '- Do not assume browser-based testing; prefer terminal-accessible workflows',
    '',
    '## Runtime Constraints',
    '- Fail fast when no metric can be extracted',
    '- If GPU-backed training is introduced, inspect nvidia-smi before long runs',
    '- Keep experiments iterative enough for AutoResearch to compare multiple rounds',
    '',
  ].join('\n');
}

function buildGitignoreContent(): string {
  return [
    '__pycache__/',
    '.pytest_cache/',
    '.venv/',
    'venv/',
    'node_modules/',
    'artifacts/',
    'runs/',
    '*.log',
    '',
  ].join('\n');
}

function buildRunExperimentContent(input: {
  pythonCandidates: string[];
  detectedCommand: string | null;
  resultJsonCandidates: string[];
}): string {
  const pythonCandidates = JSON.stringify(input.pythonCandidates.filter((item) => item !== 'run_experiment.py'));
  const resultCandidates = JSON.stringify(input.resultJsonCandidates);
  const detectedCommand = JSON.stringify(input.detectedCommand || '');

  return `import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
PYTHON_CANDIDATES = ${pythonCandidates}
RESULT_JSON_CANDIDATES = ${resultCandidates}
DETECTED_COMMAND = ${detectedCommand}
COMMON_METRIC_NAMES = [
    "f1_score",
    "f1",
    "accuracy",
    "acc",
    "auc",
    "roc_auc",
    "precision",
    "recall",
    "loss",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--primary-metric", default="score")
    parser.add_argument("--hypothesis", default="")
    parser.add_argument("--change", default="")
    return parser.parse_args()


def pick_command() -> str:
    env_command = os.environ.get("AUTORESEARCH_TRAIN_COMMAND", "").strip()
    if env_command:
        return env_command
    if DETECTED_COMMAND:
        return DETECTED_COMMAND
    for candidate in PYTHON_CANDIDATES:
        if candidate and candidate != "run_experiment.py":
            return f"python3 {candidate}"
    raise RuntimeError("No runnable training command detected. Set AUTORESEARCH_TRAIN_COMMAND.")


def read_json_file(path: Path) -> dict[str, object] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def parse_metrics_from_text(text: str) -> dict[str, float]:
    metrics: dict[str, float] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            parsed = json.loads(stripped)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            for key, value in parsed.items():
                if isinstance(value, (int, float)):
                    metrics[str(key)] = float(value)
        for name in COMMON_METRIC_NAMES:
            pattern = rf"{re.escape(name)}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)"
            match = re.search(pattern, stripped, flags=re.IGNORECASE)
            if match:
                metrics[name] = float(match.group(1))
    return metrics


def collect_metrics(command_output: str) -> dict[str, float]:
    metrics = parse_metrics_from_text(command_output)
    candidate_paths = ["metrics.json", "results.json", "eval_results.json", "scores.json", *RESULT_JSON_CANDIDATES]
    for relative_path in candidate_paths:
        path = PROJECT_ROOT / relative_path
        if not path.exists():
            continue
        parsed = read_json_file(path)
        if not parsed:
            continue
        for key, value in parsed.items():
            if isinstance(value, (int, float)):
                metrics[str(key)] = float(value)
            elif isinstance(value, dict):
                nested_value = value.get("value")
                if isinstance(nested_value, (int, float)):
                    metrics[str(key)] = float(nested_value)
    return metrics


def select_primary_metric(metrics: dict[str, float], primary_metric: str) -> tuple[str, float | None]:
    if primary_metric in metrics:
        return primary_metric, metrics[primary_metric]
    for name in COMMON_METRIC_NAMES:
        if name in metrics:
            return name, metrics[name]
    first = next(iter(metrics.items()), None)
    if first:
        return first[0], first[1]
    return primary_metric, None


def write_metrics(payload: dict[str, object]) -> None:
    target = PROJECT_ROOT / "metrics.json"
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    command = pick_command()
    completed = subprocess.run(
        command,
        shell=True,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.stdout:
        sys.stdout.write(completed.stdout)
    if completed.stderr:
        sys.stderr.write(completed.stderr)

    combined_output = "\\n".join(part for part in [completed.stdout, completed.stderr] if part)
    metrics = collect_metrics(combined_output)
    metric_name, metric_value = select_primary_metric(metrics, args.primary_metric)
    status = "IMPROVED" if completed.returncode == 0 and metric_value is not None else "FAILED"
    payload = {
        "metricName": metric_name,
        "metricValue": metric_value,
        "status": status,
        "hypothesis": args.hypothesis,
        "change": args.change,
        "reasoning": f"Ran detected command: {command}",
        "failReason": None if status != "FAILED" else (
            f"Underlying command exited with code {completed.returncode}." if completed.returncode != 0
            else "No metric could be extracted from command output or known result files."
        ),
        "extra": {
            **metrics,
            "detected_command": command,
            "return_code": completed.returncode,
        },
    }
    if status == "FAILED":
        payload["metricValue"] = None
    write_metrics(payload)
    return 0 if status != "FAILED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

async function commitAdaptationChanges(
  cfg: SshConfig,
  experimentDir: string,
  state: ProjectState,
): Promise<string | null> {
  const script = !state.gitRepo
    ? [
      `git -C ${shellEscapePath(experimentDir)} init >/dev/null 2>&1`,
      `git -C ${shellEscapePath(experimentDir)} config user.name ${shellEscape('AutoResearch')}`,
      `git -C ${shellEscapePath(experimentDir)} config user.email ${shellEscape('autoresearch@local.invalid')}`,
      `git -C ${shellEscapePath(experimentDir)} add -A`,
      `git -C ${shellEscapePath(experimentDir)} commit --allow-empty -m ${shellEscape('Initialize AutoResearch project')} >/dev/null 2>&1`,
      `git -C ${shellEscapePath(experimentDir)} rev-parse --short HEAD`,
    ].join('\n')
    : !state.hasHeadCommit
      ? [
        `git -C ${shellEscapePath(experimentDir)} config user.name >/dev/null 2>&1 || git -C ${shellEscapePath(experimentDir)} config user.name ${shellEscape('AutoResearch')}`,
        `git -C ${shellEscapePath(experimentDir)} config user.email >/dev/null 2>&1 || git -C ${shellEscapePath(experimentDir)} config user.email ${shellEscape('autoresearch@local.invalid')}`,
        `git -C ${shellEscapePath(experimentDir)} add -A`,
        `git -C ${shellEscapePath(experimentDir)} commit --allow-empty -m ${shellEscape('Create initial AutoResearch project commit')} >/dev/null 2>&1`,
        `git -C ${shellEscapePath(experimentDir)} rev-parse --short HEAD`,
      ].join('\n')
      : [
        `git -C ${shellEscapePath(experimentDir)} config user.name >/dev/null 2>&1 || git -C ${shellEscapePath(experimentDir)} config user.name ${shellEscape('AutoResearch')}`,
        `git -C ${shellEscapePath(experimentDir)} config user.email >/dev/null 2>&1 || git -C ${shellEscapePath(experimentDir)} config user.email ${shellEscape('autoresearch@local.invalid')}`,
        `git -C ${shellEscapePath(experimentDir)} add run_experiment.py AUTORESEARCH.md .gitignore >/dev/null 2>&1 || true`,
        `if ! git -C ${shellEscapePath(experimentDir)} diff --cached --quiet -- run_experiment.py AUTORESEARCH.md .gitignore; then`,
        `  git -C ${shellEscapePath(experimentDir)} commit -m ${shellEscape('Add AutoResearch project adapter')} >/dev/null 2>&1`,
        'fi',
        `git -C ${shellEscapePath(experimentDir)} rev-parse --short HEAD`,
      ].join('\n');

  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, script, 90);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to commit AutoResearch adapter changes in ${experimentDir}`);
  }
  const head = (result.stdout || '').trim();
  return head || null;
}

export async function ensureAutoResearchProjectReady(
  cfg: SshConfig,
  experimentDir: string,
): Promise<AutoResearchProjectAdaptResult> {
  const state = await inspectProjectState(cfg, experimentDir);
  const inferredProjectType = inferProjectType(state);
  const detectedEntryScript = pickDefaultEntryScript(state.pythonCandidates);
  const detectedCommand = buildDetectedCommand({
    inferredProjectType,
    defaultEntryScript: detectedEntryScript,
    hasPackageJson: state.hasPackageJson,
    notebookCandidates: state.notebookCandidates,
  });
  const actions: string[] = [];

  if (state.gitRepo && state.hasHeadCommit && state.dirtyFileCount > 0 && (!state.hasRunExperiment || !state.hasNotes)) {
    throw new Error(
      `AutoResearch cannot auto-adapt a dirty repository: ${experimentDir}. Commit or stash existing changes first, then retry.`,
    );
  }

  if (!state.hasNotes) {
    await writeTargetText(
      cfg,
      `${experimentDir}/AUTORESEARCH.md`,
      buildAutoResearchNotesContent({
        experimentDir,
        inferredProjectType,
        defaultEntryScript: detectedEntryScript,
        detectedCommand,
        notebookCandidates: state.notebookCandidates,
        resultJsonCandidates: state.resultJsonCandidates,
      }),
    );
    actions.push('generated AUTORESEARCH.md');
  }

  if (!state.hasRunExperiment) {
    await writeTargetText(
      cfg,
      `${experimentDir}/run_experiment.py`,
      buildRunExperimentContent({
        pythonCandidates: state.pythonCandidates,
        detectedCommand,
        resultJsonCandidates: state.resultJsonCandidates,
      }),
    );
    actions.push('generated run_experiment.py');
  }

  if (!state.hasGitignore) {
    const existing = await readTargetText(cfg, `${experimentDir}/.gitignore`);
    if (existing === null) {
      await writeTargetText(cfg, `${experimentDir}/.gitignore`, buildGitignoreContent());
      actions.push('generated .gitignore');
    }
  }

  if (!state.gitRepo || actions.length > 0 || !state.hasHeadCommit) {
    const head = await commitAdaptationChanges(cfg, experimentDir, state);
    if (!state.gitRepo) {
      actions.push(`initialized git repository${head ? ` at ${head}` : ''}`);
    } else if (!state.hasHeadCommit) {
      actions.push(`created initial git commit${head ? ` at ${head}` : ''}`);
    } else if (actions.length > 0) {
      actions.push(`committed adapter changes${head ? ` at ${head}` : ''}`);
    }
  }

  return {
    adapted: actions.length > 0,
    actions,
    inferredProjectType,
    detectedEntryScript,
    detectedCommand,
    detectedNotebookFiles: state.notebookCandidates,
    detectedResultFiles: state.resultJsonCandidates,
  };
}
