use std::path::{Path, PathBuf};

use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::fs;
use tokio::process::Command;

use crate::claude::http::{build_http_client, send_request_impl, ProviderCapabilities};
use crate::claude::message::Message;
use crate::commands::file::resolve_path;
use crate::utils::{AppError, AppResult};

const PYTHON_GITIGNORE: &str = "__pycache__/\nartifacts/\n.venv/\nnode_modules/\n";
const NODE_GITIGNORE: &str = "node_modules/\ndist/\nartifacts/\n";

#[derive(Debug, Clone)]
pub struct BootstrapProviderContext {
    pub api_key: String,
    pub model: String,
    pub base_url: Option<String>,
    pub provider: Option<String>,
    pub api_format: Option<String>,
    pub provider_capabilities: Option<ProviderCapabilities>,
}

#[derive(Debug, Clone)]
pub struct BootstrapExecutionContext {
    pub work_dir: Option<String>,
    pub provider: Option<BootstrapProviderContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperReference {
    source: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    authors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    venue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_url: Option<String>,
    #[serde(rename = "abstract", skip_serializing_if = "Option::is_none")]
    abstract_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    citation_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportedMetric {
    name: String,
    value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaselineMethod {
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    key_hyperparams: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reproducibility {
    has_official_code: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    repo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedBaseline {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    paper: Option<PaperReference>,
    task: String,
    dataset: String,
    reported_metrics: Vec<ReportedMetric>,
    method: BaselineMethod,
    reproducibility: Reproducibility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScaffoldFile {
    path: String,
    purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScaffoldPlan {
    template_id: String,
    work_dir: String,
    language: String,
    entry_command: String,
    vars: Map<String, Value>,
    files: Vec<ScaffoldFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapPlan {
    research_goal: String,
    success_criteria: String,
    primary_metric: String,
    secondary_metrics: Vec<String>,
    papers: Vec<PaperReference>,
    baselines: Vec<ExtractedBaseline>,
    scaffold: ScaffoldPlan,
    git_initialized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    initial_commit_sha: Option<String>,
    conversational_template_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoResearchBootstrapResult {
    status: String,
    plan: BootstrapPlan,
    warnings: Vec<String>,
    unresolved_questions: Vec<String>,
    created_at: String,
    schema_version: u8,
}

#[derive(Debug, Clone)]
struct TemplateFileSource {
    output: &'static str,
    purpose: &'static str,
    content: &'static str,
}

#[derive(Debug, Clone)]
struct TemplateDefinition {
    language: &'static str,
    entry_command: &'static str,
    required_vars: &'static [&'static str],
    files: &'static [TemplateFileSource],
}

#[derive(Debug, Clone, Serialize)]
struct RenderedScaffoldFile {
    path: String,
    purpose: String,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
struct ScaffoldRenderResult {
    scaffold: ScaffoldPlan,
    rendered_files: Vec<RenderedScaffoldFile>,
}

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
        content: "import subprocess\n\n\ndef run(command: str) -> None:\n    completed = subprocess.run(command, shell=True, check=False)\n    if completed.returncode != 0:\n        raise SystemExit(completed.returncode)\n\n\nif __name__ == '__main__':\n    run('{{train_command}}')\n    run('{{eval_command}}')\n",
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
        content: "import subprocess\n\n\nif __name__ == '__main__':\n    raise SystemExit(subprocess.run('{{node_eval_command}}', shell=True, check=False).returncode)\n",
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

pub async fn execute_tool(
    tool_name: &str,
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<Option<String>> {
    let output = match tool_name {
        "pdf_read" => Some(execute_pdf_read_tool(args, context).await?),
        "paper_extract_meta" => Some(execute_paper_extract_meta_tool(args, context).await?),
        "baseline_extract" => Some(execute_baseline_extract_tool(args, context).await?),
        "arxiv_search" => Some(execute_arxiv_search_tool(args).await?),
        "scaffold_generate" => Some(execute_scaffold_generate_tool(args, context).await?),
        "git_init_workdir" => Some(execute_git_init_workdir_tool(args, context).await?),
        "bootstrap_finalize" => Some(execute_bootstrap_finalize_tool(args, context).await?),
        _ => None,
    };

    Ok(output)
}

fn require_string_arg(args: &Value, keys: &[&str], message: &str) -> AppResult<String> {
    for key in keys {
        if let Some(value) = args.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    Err(AppError::InvalidInput(message.to_string()))
}

fn optional_string_arg(args: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| args.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn optional_bool_arg(args: &Value, key: &str) -> Option<bool> {
    args.get(key).and_then(Value::as_bool)
}

fn optional_string_array_arg(args: &Value, key: &str) -> AppResult<Vec<String>> {
    match args.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
                    .ok_or_else(|| AppError::InvalidInput(format!("{} must be an array of non-empty strings", key)))
            })
            .collect(),
        Some(_) => Err(AppError::InvalidInput(format!("{} must be an array", key))),
        None => Ok(Vec::new()),
    }
}

fn resolve_target_path(path: &str, context: &BootstrapExecutionContext) -> AppResult<PathBuf> {
    resolve_path(path, context.work_dir.as_deref())
}

fn require_provider_context(context: &BootstrapExecutionContext) -> AppResult<&BootstrapProviderContext> {
    context.provider.as_ref().ok_or_else(|| {
        AppError::InvalidInput(
            "AutoResearch bootstrap inference requires active provider context (apiKey/model/provider)."
                .to_string(),
        )
    })
}

fn normalize_number_token(value: f64) -> Vec<String> {
    let normalized = value.to_string();
    let fixed_one = format!("{value:.1}");
    let fixed_two = format!("{value:.2}");
    vec![normalized, fixed_one, fixed_two]
}

fn metric_appears_in_source(value: f64, source_text: &str) -> bool {
    let normalized_source = source_text.replace(',', " ");
    normalize_number_token(value)
        .into_iter()
        .any(|token| normalized_source.contains(&token))
}

fn parse_json(raw: &str) -> AppResult<Value> {
    serde_json::from_str(raw.trim())
        .map_err(|error| AppError::InvalidInput(format!("Invalid JSON-only bootstrap response: {error}")))
}

async fn run_json_bootstrap_inference(
    provider: &BootstrapProviderContext,
    system_prompt: &str,
    user_prompt: &str,
) -> AppResult<String> {
    let client = build_http_client();
    let messages = vec![Message {
        role: "user".to_string(),
        content: user_prompt.to_string(),
        attachments: None,
        tool_calls: None,
        tool_call_id: None,
    }];

    let response = send_request_impl(
        &client,
        &messages,
        &provider.api_key,
        &provider.model,
        provider.base_url.as_deref(),
        Some(system_prompt),
        false,
        true,
        None,
        false,
        None,
        provider.provider.as_deref(),
        provider.api_format.as_deref(),
        provider.provider_capabilities.clone(),
        Some(json!({ "type": "json_object" })),
        None,
    )
    .await
    .map_err(|error| AppError::InternalError(format!("Bootstrap inference failed: {error}")))?;

    let content = response.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::InternalError(
            "Bootstrap inference returned an empty JSON response.".to_string(),
        ));
    }

    Ok(content)
}

async fn write_text_file(path: &Path, content: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| AppError::FileError(format!("Failed to create '{}': {error}", parent.display())))?;
    }

    fs::write(path, content)
        .await
        .map_err(|error| AppError::FileError(format!("Failed to write '{}': {error}", path.display())))
}

async fn run_command(program: &str, args: &[&str], cwd: &Path) -> AppResult<std::process::Output> {
    Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|error| AppError::ProcessError(format!("Failed to run {program}: {error}")))
}

fn output_string(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

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
        _ => Err(AppError::InvalidInput("Unsupported scaffold template".to_string())),
    }
}

fn normalize_project_name(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let trimmed = value.trim().to_lowercase();
    let mut last_was_dash = false;

    for ch in trimmed.chars() {
        let keep = if ch.is_ascii_alphanumeric() { Some(ch) } else { Some('-') };
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

fn normalize_scaffold_vars(args: &Value) -> Map<String, Value> {
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
            optional_string_arg(args, &["successCriteria", "success_criteria"])
                .unwrap_or_else(|| "Improve the primary metric over the selected baseline.".to_string()),
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
        Value::String(optional_string_arg(args, &["requirementsExtra", "requirements_extra"]).unwrap_or_default()),
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
    let pattern = Regex::new(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
        .map_err(|error| AppError::InternalError(format!("Invalid scaffold placeholder regex: {error}")))?;

    let mut missing = Vec::new();
    let rendered = pattern.replace_all(template, |captures: &regex::Captures<'_>| {
        let name = captures.get(1).map(|capture| capture.as_str()).unwrap_or_default();
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

fn render_known_scaffold_template(
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

fn extract_arxiv_tag(entry: &str, tag: &str) -> Option<String> {
    let pattern = format!(r"<{tag}[^>]*>([\s\S]*?)</{tag}>");
    let regex = Regex::new(&pattern).ok()?;
    regex
        .captures(entry)
        .and_then(|captures| captures.get(1))
        .map(|capture| {
            capture
                .as_str()
                .replace("<![CDATA[", "")
                .replace("]]>", "")
                .trim()
                .to_string()
        })
}

fn parse_arxiv_atom_feed(feed: &str) -> AppResult<Vec<PaperReference>> {
    let author_regex = Regex::new(r"<name>([^<]+)</name>")
        .map_err(|error| AppError::InternalError(format!("Invalid arXiv author regex: {error}")))?;

    Ok(feed
        .split("<entry>")
        .skip(1)
        .map(|entry| {
            let original_url = extract_arxiv_tag(entry, "id");
            let title = extract_arxiv_tag(entry, "title")
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "Untitled arXiv paper".to_string());
            let abstract_text = extract_arxiv_tag(entry, "summary");
            let year = extract_arxiv_tag(entry, "published")
                .and_then(|published| published.get(0..4).and_then(|year| year.parse::<i64>().ok()));
            let authors: Vec<String> = author_regex
                .captures_iter(entry)
                .filter_map(|captures| captures.get(1).map(|author| author.as_str().trim().to_string()))
                .filter(|author| !author.is_empty())
                .collect();

            PaperReference {
                source: "arxiv".to_string(),
                title,
                authors: if authors.is_empty() { None } else { Some(authors) },
                year,
                venue: None,
                file_path: None,
                original_url,
                abstract_text,
                citation_key: None,
            }
        })
        .collect())
}

async fn execute_pdf_read_tool(args: &Value, context: &BootstrapExecutionContext) -> AppResult<String> {
    let path = require_string_arg(args, &["path", "filePath"], "pdf_read requires path")?;
    let resolved_path = resolve_target_path(&path, context)?;
    let output = run_command(
        "pdftotext",
        &["-layout", "-nopgbrk", resolved_path.to_string_lossy().as_ref(), "-"],
        resolved_path.parent().unwrap_or_else(|| Path::new("/")),
    )
    .await?;

    if !output.status.success() {
        let stderr = output_string(&output.stderr);
        return Err(AppError::ProcessError(if stderr.is_empty() {
            format!("Failed to read PDF: {}", resolved_path.display())
        } else {
            stderr
        }));
    }

    let text = output_string(&output.stdout);
    Ok(json!({
        "filePath": resolved_path.to_string_lossy(),
        "text": text,
        "sections": [{ "heading": "Document", "text": text }],
    })
    .to_string())
}

async fn execute_paper_extract_meta_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let source_text = require_string_arg(args, &["text", "sourceText"], "paper_extract_meta requires text")?;
    let provider = require_provider_context(context)?;
    let raw = run_json_bootstrap_inference(
        provider,
        "Extract a single paper metadata object from the provided text. Return JSON only with fields matching the paper schema. Do not invent missing fields.",
        &source_text,
    )
    .await?;
    let parsed = parse_json(&raw)?;
    let candidate = match parsed {
        Value::Object(mut object) => object.remove("paper").unwrap_or(Value::Object(object)),
        other => other,
    };
    let paper: PaperReference = serde_json::from_value(candidate)
        .map_err(|error| AppError::InvalidInput(format!("paper_extract_meta returned invalid JSON: {error}")))?;
    Ok(serde_json::to_string(&paper)
        .map_err(|error| AppError::InternalError(format!("Failed to serialize paper metadata: {error}")))?)
}

fn parse_baseline_envelope(raw: &str) -> AppResult<Vec<ExtractedBaseline>> {
    let parsed = parse_json(raw)?;
    match parsed {
        Value::Array(_) => serde_json::from_value(parsed)
            .map_err(|error| AppError::InvalidInput(format!("Invalid baseline JSON response: {error}"))),
        Value::Object(object) => match object.get("baselines") {
            Some(value) => serde_json::from_value(value.clone())
                .map_err(|error| AppError::InvalidInput(format!("Invalid baseline JSON response: {error}"))),
            None => Err(AppError::InvalidInput(
                "Invalid baseline JSON response: missing baselines field".to_string(),
            )),
        },
        _ => Err(AppError::InvalidInput(
            "Invalid baseline JSON response: expected object or array".to_string(),
        )),
    }
}

async fn execute_baseline_extract_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let source_text = require_string_arg(args, &["text", "sourceText"], "baseline_extract requires text")?;
    let provider = require_provider_context(context)?;
    let raw = run_json_bootstrap_inference(
        provider,
        "Extract one or more baselines from the provided paper text. Return JSON only in the form {\"baselines\": [...]} and only include metrics grounded in the text.",
        &source_text,
    )
    .await?;

    let parsed = match parse_baseline_envelope(&raw) {
        Ok(baselines) => baselines,
        Err(error) => {
            return Ok(json!({
                "baselines": [],
                "unresolvedQuestions": ["The baseline extraction response was not valid JSON-only output."],
                "reason": error.message,
            })
            .to_string())
        }
    };

    let mut unresolved_questions = Vec::new();
    for baseline in &parsed {
        for metric in &baseline.reported_metrics {
            if !metric_appears_in_source(metric.value, &source_text) {
                unresolved_questions.push(format!(
                    "Metric {}={} for baseline {} does not appear in the source text.",
                    metric.name, metric.value, baseline.name
                ));
            }
        }
    }

    if !unresolved_questions.is_empty() {
        return Ok(json!({
            "baselines": [],
            "unresolvedQuestions": unresolved_questions,
            "reason": "baseline_extract returned metrics that could not be grounded in the source paper.",
        })
        .to_string());
    }

    if parsed.is_empty() {
        unresolved_questions.push(
            "No baselines were extracted. Ask the user to confirm one manually.".to_string(),
        );
    }

    Ok(json!({
        "baselines": parsed,
        "unresolvedQuestions": unresolved_questions,
        "reason": if unresolved_questions.is_empty() { Value::Null } else { Value::String("No baselines extracted.".to_string()) },
    })
    .to_string())
}

async fn execute_arxiv_search_tool(args: &Value) -> AppResult<String> {
    let query = require_string_arg(args, &["query"], "arxiv_search requires query")?;
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(5).clamp(1, 20);
    let url = format!(
        "https://export.arxiv.org/api/query?search_query=all:{}&start=0&max_results={}",
        urlencoding::encode(&query),
        limit
    );
    let response = reqwest::get(&url)
        .await
        .map_err(|error| AppError::ProcessError(format!("arxiv_search failed: {error}")))?;
    if !response.status().is_success() {
        return Err(AppError::ProcessError(format!(
            "arxiv_search failed with HTTP {}",
            response.status()
        )));
    }
    let feed = response
        .text()
        .await
        .map_err(|error| AppError::ProcessError(format!("Failed to read arXiv response: {error}")))?;
    let papers = parse_arxiv_atom_feed(&feed)?;
    Ok(json!({ "papers": papers }).to_string())
}

async fn execute_scaffold_generate_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let template_id = require_string_arg(args, &["templateId"], "scaffold_generate requires templateId")?;
    let target_dir = require_string_arg(args, &["workDir"], "scaffold_generate requires workDir")?;
    let resolved_work_dir = resolve_target_path(&target_dir, context)?;
    let vars = normalize_scaffold_vars(args);
    let rendered = render_known_scaffold_template(
        &template_id,
        &resolved_work_dir.to_string_lossy(),
        &vars,
    )?;

    fs::create_dir_all(&resolved_work_dir)
        .await
        .map_err(|error| AppError::FileError(format!("Failed to create workDir '{}': {error}", resolved_work_dir.display())))?;

    for file in &rendered.rendered_files {
        let path = resolved_work_dir.join(&file.path);
        write_text_file(&path, &file.content).await?;
    }

    Ok(serde_json::to_string(&rendered.scaffold)
        .map_err(|error| AppError::InternalError(format!("Failed to serialize scaffold plan: {error}")))?)
}

async fn execute_git_init_workdir_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let target_dir = require_string_arg(args, &["workDir"], "git_init_workdir requires workDir")?;
    let resolved_work_dir = resolve_target_path(&target_dir, context)?;
    fs::create_dir_all(&resolved_work_dir)
        .await
        .map_err(|error| AppError::FileError(format!("Failed to create workDir '{}': {error}", resolved_work_dir.display())))?;

    let work_dir_path = resolved_work_dir.as_path();
    let steps = [
        ("git", vec!["init"]),
        ("git", vec!["config", "user.name", "AutoResearch"]),
        ("git", vec!["config", "user.email", "autoresearch@local"]),
        ("git", vec!["add", "-A"]),
        (
            "git",
            vec!["commit", "--allow-empty", "-m", "Initial bootstrap scaffold"],
        ),
    ];

    for (program, program_args) in steps {
        let output = run_command(program, &program_args, work_dir_path).await?;
        if !output.status.success() {
            let stderr = output_string(&output.stderr);
            return Err(AppError::ProcessError(if stderr.is_empty() {
                format!("{} {} failed", program, program_args.join(" "))
            } else {
                stderr
            }));
        }
    }

    let head = run_command("git", &["rev-parse", "--short", "HEAD"], work_dir_path).await?;
    if !head.status.success() {
        return Err(AppError::ProcessError(
            output_string(&head.stderr).if_empty_then("git rev-parse --short HEAD failed"),
        ));
    }

    Ok(json!({
        "workDir": resolved_work_dir.to_string_lossy(),
        "gitInitialized": true,
        "initialCommitSha": output_string(&head.stdout),
    })
    .to_string())
}

fn get_bootstrap_result_path(work_dir: &Path) -> PathBuf {
    work_dir.join(".pipi-shrimp").join("autoresearch.bootstrap.json")
}

fn validate_scaffold(scaffold: &ScaffoldPlan) -> AppResult<()> {
    if scaffold.template_id != "python-ml-baseline" && scaffold.template_id != "node-eval-harness" {
        return Err(AppError::InvalidInput(format!(
            "Unsupported scaffold templateId: {}",
            scaffold.template_id
        )));
    }
    if scaffold.work_dir.trim().is_empty() {
        return Err(AppError::InvalidInput("scaffold.workDir is required".to_string()));
    }
    if scaffold.entry_command.trim().is_empty() {
        return Err(AppError::InvalidInput("scaffold.entryCommand is required".to_string()));
    }
    Ok(())
}

async fn execute_bootstrap_finalize_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let research_goal = require_string_arg(args, &["researchGoal"], "bootstrap_finalize requires researchGoal")?;
    let success_criteria = require_string_arg(args, &["successCriteria"], "bootstrap_finalize requires successCriteria")?;
    let primary_metric = require_string_arg(args, &["primaryMetric"], "bootstrap_finalize requires primaryMetric")?;
    let papers: Vec<PaperReference> = serde_json::from_value(
        args.get("papers").cloned().ok_or_else(|| AppError::InvalidInput("bootstrap_finalize requires papers".to_string()))?,
    )
    .map_err(|error| AppError::InvalidInput(format!("bootstrap_finalize papers are invalid: {error}")))?;
    let baselines: Vec<ExtractedBaseline> = serde_json::from_value(
        args.get("baselines").cloned().ok_or_else(|| AppError::InvalidInput("bootstrap_finalize requires baselines".to_string()))?,
    )
    .map_err(|error| AppError::InvalidInput(format!("bootstrap_finalize baselines are invalid: {error}")))?;
    let scaffold: ScaffoldPlan = serde_json::from_value(
        args.get("scaffold").cloned().ok_or_else(|| AppError::InvalidInput("bootstrap_finalize requires scaffold".to_string()))?,
    )
    .map_err(|error| AppError::InvalidInput(format!("bootstrap_finalize scaffold is invalid: {error}")))?;
    validate_scaffold(&scaffold)?;
    let git_initialized = optional_bool_arg(args, "gitInitialized")
        .ok_or_else(|| AppError::InvalidInput("bootstrap_finalize requires gitInitialized".to_string()))?;
    let conversational_template_id = require_string_arg(
        args,
        &["conversationalTemplateId"],
        "bootstrap_finalize requires conversationalTemplateId",
    )?;
    let secondary_metrics = optional_string_array_arg(args, "secondaryMetrics")?;
    let initial_commit_sha = optional_string_arg(args, &["initialCommitSha"]);

    let mut unresolved_questions = Vec::new();
    let mut warnings = Vec::new();
    if baselines.is_empty() {
        unresolved_questions.push("Keep at least one baseline before starting AutoResearch.".to_string());
    }
    if success_criteria.trim().len() < 10 {
        unresolved_questions.push(
            "Success criteria must be quantitative and at least 10 characters long.".to_string(),
        );
    }
    if !git_initialized {
        warnings.push(
            "Git initialization did not complete. The bootstrap can continue without it.".to_string(),
        );
    }

    let created_at = optional_string_arg(args, &["createdAt"])
        .filter(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok())
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    let result = AutoResearchBootstrapResult {
        status: if unresolved_questions.is_empty() {
            "ready".to_string()
        } else {
            "needs_user_confirmation".to_string()
        },
        plan: BootstrapPlan {
            research_goal,
            success_criteria,
            primary_metric,
            secondary_metrics,
            papers,
            baselines,
            scaffold: scaffold.clone(),
            git_initialized,
            initial_commit_sha,
            conversational_template_id,
        },
        warnings,
        unresolved_questions,
        created_at,
        schema_version: 1,
    };

    let bootstrap_work_dir = resolve_target_path(&scaffold.work_dir, context)?;
    let bootstrap_file_path = get_bootstrap_result_path(&bootstrap_work_dir);
    let pretty = serde_json::to_string_pretty(&result)
        .map_err(|error| AppError::InternalError(format!("Failed to encode bootstrap result: {error}")))?;
    write_text_file(&bootstrap_file_path, &format!("{pretty}\n")).await?;

    Ok(serde_json::to_string(&result)
        .map_err(|error| AppError::InternalError(format!("Failed to encode bootstrap result: {error}")))?)
}

trait IfEmptyThen {
    fn if_empty_then(self, fallback: &str) -> String;
}

impl IfEmptyThen for String {
    fn if_empty_then(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grounds_metric_tokens_from_source_text() {
        assert!(metric_appears_in_source(
            95.1,
            "The ResNet50 baseline reaches accuracy 95.1 on CIFAR10.",
        ));
        assert!(!metric_appears_in_source(
            99.9,
            "The ResNet50 baseline reaches accuracy 95.1 on CIFAR10.",
        ));
    }

    #[test]
    fn renders_python_scaffold_with_required_files() {
        let vars = normalize_scaffold_vars(&json!({
            "projectName": "test-project",
            "researchGoal": "Improve test accuracy",
            "successCriteria": "Beat the baseline by at least 1 point.",
            "primaryMetric": "accuracy",
            "baselineName": "ResNet50",
            "datasetName": "CIFAR10",
            "trainCommand": "python3 train.py",
            "evalCommand": "python3 eval.py",
            "requirementsExtra": "torch",
        }));

        let rendered = render_known_scaffold_template(
            "python-ml-baseline",
            "/tmp/test-project",
            &vars,
        )
        .expect("render should succeed");

        assert!(rendered
            .rendered_files
            .iter()
            .any(|file| file.path == "run_experiment.py"));
        assert!(rendered
            .rendered_files
            .iter()
            .any(|file| file.path == "AUTORESEARCH.md"));
    }
}