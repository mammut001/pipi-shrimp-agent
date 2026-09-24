//! Scaffold template definitions and rendering logic for autoresearch bootstrapping.
//!
//! Moved verbatim from `mod.rs` as part of a mechanical extraction with no behavior change.

use regex::Regex;
use serde_json::{Map, Value};

use super::{
    optional_string_arg, RenderedScaffoldFile, ScaffoldFile, ScaffoldPlan, ScaffoldRenderResult,
    TemplateDefinition, TemplateFileSource, NODE_GITIGNORE, PYTHON_GITIGNORE,
};
use crate::utils::{AppError, AppResult};

const PYTHON_REQUIRED_VARS: &[&str] = &[
    "project_name",
    "research_goal",
    "success_criteria",
    "primary_metric",
    "baseline_name",
    "dataset_name",
    "train_command",
    "eval_command",
    "requirements_extra",
];

const PYTHON_TEMPLATE_FILES: &[TemplateFileSource] = &[
    TemplateFileSource {
        output: "README.md",
        purpose: "Project overview and usage notes.",
        content: "# {{project_name}}\n\n## Goal\n{{research_goal}}\n\n## Success Criteria\n{{success_criteria}}\n\n## Primary Metric\n{{primary_metric}}\n\n## Baseline\n{{baseline_name}} on {{dataset_name}}\n\n## Entry Command\nRun `{{train_command}}` and `{{eval_command}}` through `python3 run_experiment.py`.\n",
    },
    TemplateFileSource {
        output: "AUTORESEARCH.md",
        purpose: "AutoResearch session notes and guardrails.",
        content: "# AutoResearch Notes\n\nGoal: {{research_goal}}\n\nSuccess criteria: {{success_criteria}}\n\nPrimary metric: {{primary_metric}}\n\nBaseline: {{baseline_name}}\nDataset: {{dataset_name}}\n",
    },
    TemplateFileSource {
        output: "requirements.txt",
        purpose: "Python dependencies.",
        content: "pyyaml\n{{requirements_extra}}\n",
    },
    TemplateFileSource {
        output: "configs/baseline.yaml",
        purpose: "Baseline configuration seed.",
        content: "project: {{project_name}}\nbaseline: {{baseline_name}}\ndataset: {{dataset_name}}\nmetric: {{primary_metric}}\n",
    },
    TemplateFileSource {
        output: "train.py",
        purpose: "Training entrypoint placeholder.",
        content: "from pathlib import Path\n\n\ndef main() -> None:\n    Path('artifacts').mkdir(exist_ok=True)\n    print('Training placeholder for {{project_name}}')\n\n\nif __name__ == '__main__':\n    main()\n",
    },
    TemplateFileSource {
        output: "eval.py",
        purpose: "Evaluation entrypoint placeholder.",
        content: "import json\nfrom pathlib import Path\n\n\ndef main() -> None:\n    Path('artifacts').mkdir(exist_ok=True)\n    payload = {\n        'metric': '{{primary_metric}}',\n        'baseline': '{{baseline_name}}',\n        'dataset': '{{dataset_name}}',\n        'value': 0.0,\n    }\n    print(json.dumps(payload))\n\n\nif __name__ == '__main__':\n    main()\n",
    },
    TemplateFileSource {
        output: "run_experiment.py",
        purpose: "Loop-compatible experiment entrypoint.",
        content: "import json\nimport subprocess\nfrom pathlib import Path\n\n\ndef run(command: str) -> int:\n    completed = subprocess.run(command, shell=True, check=False)\n    return completed.returncode\n\n\nif __name__ == '__main__':\n    train_rc = run('{{train_command}}')\n    eval_rc = run('{{eval_command}}')\n    rc = train_rc or eval_rc\n    payload = {\n        'metricName': '{{primary_metric}}',\n        'metricValue': 0.0 if rc == 0 else None,\n        'status': 'IMPROVED' if rc == 0 else 'FAILED',\n        'hypothesis': 'scaffold baseline',\n        'failReason': None if rc == 0 else f'train/eval exited {rc}',\n    }\n    Path('metrics.json').write_text(json.dumps(payload, indent=2) + '\\n', encoding='utf-8')\n    raise SystemExit(0 if rc == 0 else 1)\n",
    },
    TemplateFileSource {
        output: ".gitignore",
        purpose: "Ignore local artifacts.",
        content: PYTHON_GITIGNORE,
    },
];

const NODE_REQUIRED_VARS: &[&str] = &[
    "project_name",
    "research_goal",
    "success_criteria",
    "primary_metric",
    "baseline_name",
    "dataset_name",
    "node_eval_command",
];

const NODE_TEMPLATE_FILES: &[TemplateFileSource] = &[
    TemplateFileSource {
        output: "README.md",
        purpose: "Project overview and usage notes.",
        content: "# {{project_name}}\n\n## Goal\n{{research_goal}}\n\n## Success Criteria\n{{success_criteria}}\n\n## Primary Metric\n{{primary_metric}}\n\n## Baseline\n{{baseline_name}} on {{dataset_name}}\n",
    },
    TemplateFileSource {
        output: "AUTORESEARCH.md",
        purpose: "AutoResearch session notes and guardrails.",
        content: "# AutoResearch Notes\n\nGoal: {{research_goal}}\n\nSuccess criteria: {{success_criteria}}\n\nPrimary metric: {{primary_metric}}\n",
    },
    TemplateFileSource {
        output: "package.json",
        purpose: "Node runtime and scripts.",
        content: "{\"name\":\"{{project_name}}\",\"private\":true,\"type\":\"module\",\"scripts\":{\"evaluate\":\"{{node_eval_command}}\"},\"devDependencies\":{\"tsx\":\"^4.19.2\"}}\n",
    },
    TemplateFileSource {
        output: "index.ts",
        purpose: "Evaluation harness entrypoint.",
        content: "const result = {\n  metric: '{{primary_metric}}',\n  baseline: '{{baseline_name}}',\n  dataset: '{{dataset_name}}',\n  value: 0,\n};\n\nconsole.log(JSON.stringify(result));\n",
    },
    TemplateFileSource {
        output: "run_experiment.py",
        purpose: "Loop-compatible wrapper entrypoint.",
        content: "import json\nimport subprocess\nfrom pathlib import Path\n\n\nif __name__ == '__main__':\n    rc = subprocess.run('{{node_eval_command}}', shell=True, check=False).returncode\n    payload = {\n        'metricName': '{{primary_metric}}',\n        'metricValue': 0.0 if rc == 0 else None,\n        'status': 'IMPROVED' if rc == 0 else 'FAILED',\n        'hypothesis': 'scaffold baseline',\n        'failReason': None if rc == 0 else f'eval exited {rc}',\n    }\n    Path('metrics.json').write_text(json.dumps(payload, indent=2) + '\\n', encoding='utf-8')\n    raise SystemExit(0 if rc == 0 else 1)\n",
    },
    TemplateFileSource {
        output: ".gitignore",
        purpose: "Ignore local artifacts.",
        content: NODE_GITIGNORE,
    },
];

const PYTHON_TEMPLATE: TemplateDefinition = TemplateDefinition {
    language: "python",
    entry_command: "python3 run_experiment.py",
    required_vars: PYTHON_REQUIRED_VARS,
    files: PYTHON_TEMPLATE_FILES,
};

const NODE_TEMPLATE: TemplateDefinition = TemplateDefinition {
    language: "node",
    entry_command: "python3 run_experiment.py",
    required_vars: NODE_REQUIRED_VARS,
    files: NODE_TEMPLATE_FILES,
};

fn normalize_template_id(value: &str) -> AppResult<&'static str> {
    match value {
        "node-eval-harness" => Ok("node-eval-harness"),
        "python-ml-baseline" => Ok("python-ml-baseline"),
        _ => Err(AppError::InvalidInput(format!(
            "Unsupported scaffold templateId: {value}"
        ))),
    }
}

fn template_definition(template_id: &str) -> AppResult<&'static TemplateDefinition> {
    match normalize_template_id(template_id)? {
        "python-ml-baseline" => Ok(&PYTHON_TEMPLATE),
        "node-eval-harness" => Ok(&NODE_TEMPLATE),
        _ => Err(AppError::InvalidInput(
            "Unsupported scaffold template".to_string(),
        )),
    }
}

fn normalize_project_name(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let trimmed = value.trim().to_lowercase();
    let mut last_was_dash = false;

    for ch in trimmed.chars() {
        let keep = if ch.is_ascii_alphanumeric() {
            Some(ch)
        } else {
            Some('-')
        };
        if let Some(next) = keep {
            if next == '-' {
                if last_was_dash {
                    continue;
                }
                last_was_dash = true;
            } else {
                last_was_dash = false;
            }
            normalized.push(next);
        }
    }

    normalized.trim_matches('-').to_string()
}

pub(super) fn normalize_scaffold_vars(args: &Value) -> Map<String, Value> {
    let project_name = optional_string_arg(args, &["projectName", "project_name"])
        .map(|value| normalize_project_name(&value))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "autoresearch-bootstrap".to_string());

    let mut vars = Map::new();
    vars.insert("project_name".to_string(), Value::String(project_name));
    vars.insert(
        "research_goal".to_string(),
        Value::String(
            optional_string_arg(args, &["researchGoal", "research_goal"])
                .unwrap_or_else(|| "Bootstrap an AutoResearch experiment".to_string()),
        ),
    );
    vars.insert(
        "success_criteria".to_string(),
        Value::String(
            optional_string_arg(args, &["successCriteria", "success_criteria"]).unwrap_or_else(
                || "Improve the primary metric over the selected baseline.".to_string(),
            ),
        ),
    );
    vars.insert(
        "primary_metric".to_string(),
        Value::String(
            optional_string_arg(args, &["primaryMetric", "primary_metric"])
                .unwrap_or_else(|| "score".to_string()),
        ),
    );
    vars.insert(
        "baseline_name".to_string(),
        Value::String(
            optional_string_arg(args, &["baselineName", "baseline_name"])
                .unwrap_or_else(|| "baseline".to_string()),
        ),
    );
    vars.insert(
        "dataset_name".to_string(),
        Value::String(
            optional_string_arg(args, &["datasetName", "dataset_name"])
                .unwrap_or_else(|| "dataset".to_string()),
        ),
    );
    vars.insert(
        "train_command".to_string(),
        Value::String(
            optional_string_arg(args, &["trainCommand", "train_command"])
                .unwrap_or_else(|| "python3 train.py".to_string()),
        ),
    );
    vars.insert(
        "eval_command".to_string(),
        Value::String(
            optional_string_arg(args, &["evalCommand", "eval_command"])
                .unwrap_or_else(|| "python3 eval.py".to_string()),
        ),
    );
    vars.insert(
        "requirements_extra".to_string(),
        Value::String(
            optional_string_arg(args, &["requirementsExtra", "requirements_extra"])
                .unwrap_or_default(),
        ),
    );
    vars.insert(
        "node_eval_command".to_string(),
        Value::String(
            optional_string_arg(args, &["nodeEvalCommand", "node_eval_command"])
                .unwrap_or_else(|| "npx tsx index.ts".to_string()),
        ),
    );

    vars
}

fn render_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn render_template_string(template: &str, vars: &Map<String, Value>) -> AppResult<String> {
    let pattern = Regex::new(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}").map_err(|error| {
        AppError::InternalError(format!("Invalid scaffold placeholder regex: {error}"))
    })?;

    let mut missing = Vec::new();
    let rendered = pattern.replace_all(template, |captures: &regex::Captures<'_>| {
        let name = captures
            .get(1)
            .map(|capture| capture.as_str())
            .unwrap_or_default();
        match vars.get(name) {
            Some(value) => render_value(Some(value)),
            None => {
                missing.push(name.to_string());
                String::new()
            }
        }
    });

    if !missing.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "Missing scaffold vars: {}",
            missing.join(", ")
        )));
    }

    Ok(rendered.into_owned())
}

pub(super) fn render_known_scaffold_template(
    template_id: &str,
    work_dir: &str,
    vars: &Map<String, Value>,
) -> AppResult<ScaffoldRenderResult> {
    let definition = template_definition(template_id)?;

    let missing: Vec<&str> = definition
        .required_vars
        .iter()
        .copied()
        .filter(|key| !vars.contains_key(*key))
        .collect();
    if !missing.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "Missing scaffold vars: {}",
            missing.join(", ")
        )));
    }

    let rendered_files: Vec<RenderedScaffoldFile> = definition
        .files
        .iter()
        .map(|file| {
            let content = if file.output.ends_with(".tmpl") {
                file.content.to_string()
            } else {
                render_template_string(file.content, vars)?
            };

            let final_content = if file.output.ends_with(".tmpl") {
                render_template_string(file.content, vars)?
            } else {
                content
            };

            Ok(RenderedScaffoldFile {
                path: file.output.to_string(),
                purpose: file.purpose.to_string(),
                content: final_content,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    let scaffold = ScaffoldPlan {
        template_id: template_id.to_string(),
        work_dir: work_dir.to_string(),
        language: definition.language.to_string(),
        entry_command: definition.entry_command.to_string(),
        vars: vars.clone(),
        files: rendered_files
            .iter()
            .map(|file| ScaffoldFile {
                path: file.path.clone(),
                purpose: file.purpose.clone(),
            })
            .collect(),
    };

    Ok(ScaffoldRenderResult {
        scaffold,
        rendered_files,
    })
}
