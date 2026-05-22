import { BootstrapPlanSchema, ScaffoldTemplateManifestSchema } from '@/services/autoresearch/bootstrap/schema';
import type {
  BootstrapPlan,
  ScaffoldPlan,
  ScaffoldTemplateId,
  ScaffoldTemplateManifest,
} from '@/services/autoresearch/bootstrap/types';

export interface RenderedScaffoldFile {
  path: string;
  purpose: string;
  content: string;
}

export interface ScaffoldRenderResult {
  scaffold: ScaffoldPlan;
  renderedFiles: RenderedScaffoldFile[];
}

const PYTHON_MANIFEST: ScaffoldTemplateManifest = {
  templateId: 'python-ml-baseline',
  language: 'python',
  entryCommand: 'python3 run_experiment.py',
  requiredVars: [
    'project_name',
    'research_goal',
    'success_criteria',
    'primary_metric',
    'baseline_name',
    'dataset_name',
    'train_command',
    'eval_command',
    'requirements_extra',
  ],
  files: [
    { output: 'README.md', source: 'README.md.tmpl', purpose: 'Project overview and usage notes.' },
    { output: 'AUTORESEARCH.md', source: 'AUTORESEARCH.md.tmpl', purpose: 'AutoResearch session notes and guardrails.' },
    { output: 'requirements.txt', source: 'requirements.txt.tmpl', purpose: 'Python dependencies.' },
    { output: 'configs/baseline.yaml', source: 'configs/baseline.yaml.tmpl', purpose: 'Baseline configuration seed.' },
    { output: 'train.py', source: 'train.py.tmpl', purpose: 'Training entrypoint placeholder.' },
    { output: 'eval.py', source: 'eval.py.tmpl', purpose: 'Evaluation entrypoint placeholder.' },
    { output: 'run_experiment.py', source: 'run_experiment.py.tmpl', purpose: 'Loop-compatible experiment entrypoint.' },
    { output: '.gitignore', source: '.gitignore', purpose: 'Ignore local artifacts.' },
  ],
};

const NODE_MANIFEST: ScaffoldTemplateManifest = {
  templateId: 'node-eval-harness',
  language: 'node',
  entryCommand: 'python3 run_experiment.py',
  requiredVars: [
    'project_name',
    'research_goal',
    'success_criteria',
    'primary_metric',
    'baseline_name',
    'dataset_name',
    'node_eval_command',
  ],
  files: [
    { output: 'README.md', source: 'README.md.tmpl', purpose: 'Project overview and usage notes.' },
    { output: 'AUTORESEARCH.md', source: 'AUTORESEARCH.md.tmpl', purpose: 'AutoResearch session notes and guardrails.' },
    { output: 'package.json', source: 'package.json.tmpl', purpose: 'Node runtime and scripts.' },
    { output: 'index.ts', source: 'index.ts.tmpl', purpose: 'Evaluation harness entrypoint.' },
    { output: 'run_experiment.py', source: 'run_experiment.py.tmpl', purpose: 'Loop-compatible wrapper entrypoint.' },
    { output: '.gitignore', source: '.gitignore', purpose: 'Ignore local artifacts.' },
  ],
};

const TEMPLATE_MANIFESTS: Record<ScaffoldTemplateId, ScaffoldTemplateManifest> = {
  'python-ml-baseline': PYTHON_MANIFEST,
  'node-eval-harness': NODE_MANIFEST,
};

const TEMPLATE_SOURCES: Record<ScaffoldTemplateId, Record<string, string>> = {
  'python-ml-baseline': {
    'README.md.tmpl': `# {{project_name}}\n\n## Goal\n{{research_goal}}\n\n## Success Criteria\n{{success_criteria}}\n\n## Primary Metric\n{{primary_metric}}\n\n## Baseline\n{{baseline_name}} on {{dataset_name}}\n\n## Entry Command\nRun \`{{train_command}}\` and \`{{eval_command}}\` through \`python3 run_experiment.py\`.\n`,
    'AUTORESEARCH.md.tmpl': `# AutoResearch Notes\n\nGoal: {{research_goal}}\n\nSuccess criteria: {{success_criteria}}\n\nPrimary metric: {{primary_metric}}\n\nBaseline: {{baseline_name}}\nDataset: {{dataset_name}}\n`,
    'requirements.txt.tmpl': `pyyaml\n{{requirements_extra}}\n`,
    'configs/baseline.yaml.tmpl': `project: {{project_name}}\nbaseline: {{baseline_name}}\ndataset: {{dataset_name}}\nmetric: {{primary_metric}}\n`,
    'train.py.tmpl': `from pathlib import Path\n\n\ndef main() -> None:\n    Path('artifacts').mkdir(exist_ok=True)\n    print('Training placeholder for {{project_name}}')\n\n\nif __name__ == '__main__':\n    main()\n`,
    'eval.py.tmpl': `import json\nfrom pathlib import Path\n\n\ndef main() -> None:\n    Path('artifacts').mkdir(exist_ok=True)\n    payload = {\n        'metric': '{{primary_metric}}',\n        'baseline': '{{baseline_name}}',\n        'dataset': '{{dataset_name}}',\n        'value': 0.0,\n    }\n    print(json.dumps(payload))\n\n\nif __name__ == '__main__':\n    main()\n`,
    'run_experiment.py.tmpl': `import subprocess\n\n\ndef run(command: str) -> None:\n    completed = subprocess.run(command, shell=True, check=False)\n    if completed.returncode != 0:\n        raise SystemExit(completed.returncode)\n\n\nif __name__ == '__main__':\n    run('{{train_command}}')\n    run('{{eval_command}}')\n`,
    '.gitignore': `__pycache__/\nartifacts/\n.venv/\nnode_modules/\n`,
  },
  'node-eval-harness': {
    'README.md.tmpl': `# {{project_name}}\n\n## Goal\n{{research_goal}}\n\n## Success Criteria\n{{success_criteria}}\n\n## Primary Metric\n{{primary_metric}}\n\n## Baseline\n{{baseline_name}} on {{dataset_name}}\n`,
    'AUTORESEARCH.md.tmpl': `# AutoResearch Notes\n\nGoal: {{research_goal}}\n\nSuccess criteria: {{success_criteria}}\n\nPrimary metric: {{primary_metric}}\n`,
    'package.json.tmpl': `{"name":"{{project_name}}","private":true,"type":"module","scripts":{"evaluate":"{{node_eval_command}}"},"devDependencies":{"tsx":"^4.19.2"}}\n`,
    'index.ts.tmpl': `const result = {\n  metric: '{{primary_metric}}',\n  baseline: '{{baseline_name}}',\n  dataset: '{{dataset_name}}',\n  value: 0,\n};\n\nconsole.log(JSON.stringify(result));\n`,
    'run_experiment.py.tmpl': `import subprocess\n\n\nif __name__ == '__main__':\n    raise SystemExit(subprocess.run('{{node_eval_command}}', shell=True, check=False).returncode)\n`,
    '.gitignore': `node_modules/\ndist/\nartifacts/\n`,
  },
};

function assertDefinedVars(requiredVars: string[], vars: Record<string, string | number | boolean>): void {
  const missing = requiredVars.filter((key) => vars[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing scaffold vars: ${missing.join(', ')}`);
  }
}

export function renderTemplateString(template: string, vars: Record<string, string | number | boolean>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, name: string) => {
    if (!(name in vars)) {
      throw new Error(`Undefined scaffold var: ${name}`);
    }
    return String(vars[name]);
  });
}

export function renderScaffoldFiles(input: {
  manifest: ScaffoldTemplateManifest;
  templates: Record<string, string>;
  templateId: ScaffoldTemplateId;
  workDir: string;
  vars: Record<string, string | number | boolean>;
}): ScaffoldRenderResult {
  const manifest = ScaffoldTemplateManifestSchema.parse(input.manifest);
  if (manifest.templateId !== input.templateId) {
    throw new Error(`Manifest/template mismatch: ${manifest.templateId} !== ${input.templateId}`);
  }
  assertDefinedVars(manifest.requiredVars, input.vars);

  const renderedFiles = manifest.files.map((file) => {
    const templateContent = input.templates[file.source];
    if (templateContent === undefined) {
      throw new Error(`Missing template source: ${file.source}`);
    }
    return {
      path: file.output,
      purpose: file.purpose,
      content: file.source.endsWith('.tmpl')
        ? renderTemplateString(templateContent, input.vars)
        : templateContent,
    };
  });

  const scaffold = {
    templateId: input.templateId,
    workDir: input.workDir,
    language: manifest.language,
    entryCommand: manifest.entryCommand,
    vars: input.vars,
    files: renderedFiles.map((file) => ({ path: file.path, purpose: file.purpose })),
  } satisfies ScaffoldPlan;

  return {
    scaffold: (BootstrapPlanSchema as any).shape.scaffold.parse(scaffold),
    renderedFiles,
  };
}

export function renderKnownScaffoldTemplate(input: {
  templateId: ScaffoldTemplateId;
  workDir: string;
  vars: Record<string, string | number | boolean>;
}): ScaffoldRenderResult {
  return renderScaffoldFiles({
    manifest: TEMPLATE_MANIFESTS[input.templateId],
    templates: TEMPLATE_SOURCES[input.templateId],
    templateId: input.templateId,
    workDir: input.workDir,
    vars: input.vars,
  });
}

export function getKnownScaffoldTemplateManifest(templateId: ScaffoldTemplateId): ScaffoldTemplateManifest {
  return TEMPLATE_MANIFESTS[templateId];
}