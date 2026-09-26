use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::{json, Value};
use tokio::fs;
use tokio::process::Command;

use crate::claude::http::{build_http_client, send_request_impl, ProviderCapabilities};
use crate::claude::message::Message;
use crate::commands::file::resolve_path;
use crate::utils::{AppError, AppResult};

mod paper_tools;
mod scaffold_template;
mod types;

use paper_tools::{
    execute_arxiv_search_tool, execute_baseline_extract_tool, execute_paper_extract_meta_tool,
    execute_pdf_read_tool,
};
use scaffold_template::{normalize_scaffold_vars, render_known_scaffold_template};
use types::{
    AutoResearchBootstrapResult, BootstrapPlan, ExtractedBaseline, IfEmptyThen, PaperReference,
    RenderedScaffoldFile, ScaffoldFile,
    ScaffoldPlan, ScaffoldRenderResult, TemplateDefinition, TemplateFileSource,
};

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
                    .ok_or_else(|| {
                        AppError::InvalidInput(format!(
                            "{} must be an array of non-empty strings",
                            key
                        ))
                    })
            })
            .collect(),
        Some(_) => Err(AppError::InvalidInput(format!("{} must be an array", key))),
        None => Ok(Vec::new()),
    }
}

fn resolve_target_path(path: &str, context: &BootstrapExecutionContext) -> AppResult<PathBuf> {
    resolve_path(path, context.work_dir.as_deref())
}

fn require_provider_context(
    context: &BootstrapExecutionContext,
) -> AppResult<&BootstrapProviderContext> {
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
    serde_json::from_str(raw.trim()).map_err(|error| {
        AppError::InvalidInput(format!("Invalid JSON-only bootstrap response: {error}"))
    })
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
            reasoning: None,
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
        fs::create_dir_all(parent).await.map_err(|error| {
            AppError::FileError(format!("Failed to create '{}': {error}", parent.display()))
        })?;
    }

    fs::write(path, content).await.map_err(|error| {
        AppError::FileError(format!("Failed to write '{}': {error}", path.display()))
    })
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

fn is_safe_scaffold_relative_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim();
    !trimmed.is_empty()
        && !trimmed.starts_with('/')
        && !trimmed.contains("..")
        && !trimmed.contains(':')
}

async fn execute_scaffold_generate_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let template_id = require_string_arg(
        args,
        &["templateId"],
        "scaffold_generate requires templateId",
    )?;
    let target_dir = require_string_arg(args, &["workDir"], "scaffold_generate requires workDir")?;
    let resolved_work_dir = resolve_target_path(&target_dir, context)?;
    let overwrite_existing = args
        .get("overwriteExisting")
        .and_then(Value::as_bool)
        .or_else(|| args.get("overwrite_existing").and_then(Value::as_bool))
        .unwrap_or(false);
    let vars = normalize_scaffold_vars(args);
    let rendered =
        render_known_scaffold_template(&template_id, &resolved_work_dir.to_string_lossy(), &vars)?;

    fs::create_dir_all(&resolved_work_dir)
        .await
        .map_err(|error| {
            AppError::FileError(format!(
                "Failed to create workDir '{}': {error}",
                resolved_work_dir.display()
            ))
        })?;

    let mut written: Vec<String> = Vec::new();
    let mut skipped_existing: Vec<String> = Vec::new();
    for file in &rendered.rendered_files {
        if !is_safe_scaffold_relative_path(&file.path) {
            return Err(AppError::InvalidInput(format!(
                "Refusing to write scaffold file outside workDir: {}",
                file.path
            )));
        }
        let path = resolved_work_dir.join(&file.path);
        if path.exists() && !overwrite_existing {
            skipped_existing.push(file.path.clone());
            continue;
        }
        write_text_file(&path, &file.content).await?;
        written.push(file.path.clone());
    }

    let mut payload = serde_json::to_value(&rendered.scaffold).map_err(|error| {
        AppError::InternalError(format!("Failed to serialize scaffold plan: {error}"))
    })?;
    if let Some(object) = payload.as_object_mut() {
        object.insert("written".to_string(), json!(written));
        object.insert("skippedExisting".to_string(), json!(skipped_existing));
    }
    serde_json::to_string(&payload).map_err(|error| {
        AppError::InternalError(format!("Failed to serialize scaffold plan: {error}"))
    })
}

async fn execute_git_init_workdir_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let target_dir = require_string_arg(args, &["workDir"], "git_init_workdir requires workDir")?;
    let resolved_work_dir = resolve_target_path(&target_dir, context)?;
    fs::create_dir_all(&resolved_work_dir)
        .await
        .map_err(|error| {
            AppError::FileError(format!(
                "Failed to create workDir '{}': {error}",
                resolved_work_dir.display()
            ))
        })?;

    let work_dir_path = resolved_work_dir.as_path();
    let steps = [
        ("git", vec!["init"]),
        ("git", vec!["config", "user.name", "AutoResearch"]),
        ("git", vec!["config", "user.email", "autoresearch@local"]),
        ("git", vec!["add", "-A"]),
        (
            "git",
            vec![
                "commit",
                "--allow-empty",
                "-m",
                "Initial bootstrap scaffold",
            ],
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
    work_dir
        .join(".pipi-shrimp")
        .join("autoresearch.bootstrap.json")
}

fn validate_scaffold(scaffold: &ScaffoldPlan) -> AppResult<()> {
    if scaffold.template_id != "python-ml-baseline" && scaffold.template_id != "node-eval-harness" {
        return Err(AppError::InvalidInput(format!(
            "Unsupported scaffold templateId: {}",
            scaffold.template_id
        )));
    }
    if scaffold.work_dir.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "scaffold.workDir is required".to_string(),
        ));
    }
    if scaffold.entry_command.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "scaffold.entryCommand is required".to_string(),
        ));
    }
    Ok(())
}

async fn execute_bootstrap_finalize_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let research_goal = require_string_arg(
        args,
        &["researchGoal"],
        "bootstrap_finalize requires researchGoal",
    )?;
    let success_criteria = require_string_arg(
        args,
        &["successCriteria"],
        "bootstrap_finalize requires successCriteria",
    )?;
    let primary_metric = require_string_arg(
        args,
        &["primaryMetric"],
        "bootstrap_finalize requires primaryMetric",
    )?;
    let papers: Vec<PaperReference> =
        serde_json::from_value(args.get("papers").cloned().ok_or_else(|| {
            AppError::InvalidInput("bootstrap_finalize requires papers".to_string())
        })?)
        .map_err(|error| {
            AppError::InvalidInput(format!("bootstrap_finalize papers are invalid: {error}"))
        })?;
    let baselines: Vec<ExtractedBaseline> =
        serde_json::from_value(args.get("baselines").cloned().ok_or_else(|| {
            AppError::InvalidInput("bootstrap_finalize requires baselines".to_string())
        })?)
        .map_err(|error| {
            AppError::InvalidInput(format!("bootstrap_finalize baselines are invalid: {error}"))
        })?;
    let scaffold: ScaffoldPlan =
        serde_json::from_value(args.get("scaffold").cloned().ok_or_else(|| {
            AppError::InvalidInput("bootstrap_finalize requires scaffold".to_string())
        })?)
        .map_err(|error| {
            AppError::InvalidInput(format!("bootstrap_finalize scaffold is invalid: {error}"))
        })?;
    validate_scaffold(&scaffold)?;
    let git_initialized = optional_bool_arg(args, "gitInitialized").ok_or_else(|| {
        AppError::InvalidInput("bootstrap_finalize requires gitInitialized".to_string())
    })?;
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
        unresolved_questions
            .push("Keep at least one baseline before starting AutoResearch.".to_string());
    }
    if success_criteria.trim().len() < 10 {
        unresolved_questions.push(
            "Success criteria must be quantitative and at least 10 characters long.".to_string(),
        );
    }
    if !git_initialized {
        warnings.push(
            "Git initialization did not complete. The bootstrap can continue without it."
                .to_string(),
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
    let bootstrap_temp_path = bootstrap_file_path.with_extension("json.tmp");
    let pretty = serde_json::to_string_pretty(&result).map_err(|error| {
        AppError::InternalError(format!("Failed to encode bootstrap result: {error}"))
    })?;
    write_text_file(&bootstrap_temp_path, &format!("{pretty}\n")).await?;
    fs::rename(&bootstrap_temp_path, &bootstrap_file_path)
        .await
        .map_err(|error| {
            AppError::InternalError(format!(
                "Failed to finalize bootstrap result file {}: {error}",
                bootstrap_file_path.display()
            ))
        })?;

    serde_json::to_string(&result).map_err(|error| {
        AppError::InternalError(format!("Failed to encode bootstrap result: {error}"))
    })
}

#[cfg(test)]
mod tests;
