//! ArXiv search and paper/baseline extraction tools for autoresearch bootstrapping.
//!
//! Moved verbatim from `mod.rs` as part of a mechanical extraction with no behavior change.

use std::path::Path;

use regex::Regex;
use serde_json::{json, Value};

use super::{
    metric_appears_in_source, output_string, parse_json, require_provider_context,
    require_string_arg, resolve_target_path, run_command, run_json_bootstrap_inference,
    BootstrapExecutionContext, ExtractedBaseline, PaperReference,
};
use crate::utils::{AppError, AppResult};

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
            let year = extract_arxiv_tag(entry, "published").and_then(|published| {
                published
                    .get(0..4)
                    .and_then(|year| year.parse::<i64>().ok())
            });
            let authors: Vec<String> = author_regex
                .captures_iter(entry)
                .filter_map(|captures| {
                    captures
                        .get(1)
                        .map(|author| author.as_str().trim().to_string())
                })
                .filter(|author| !author.is_empty())
                .collect();

            PaperReference {
                source: "arxiv".to_string(),
                title,
                authors: if authors.is_empty() {
                    None
                } else {
                    Some(authors)
                },
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

pub(super) async fn execute_pdf_read_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let path = require_string_arg(args, &["path", "filePath"], "pdf_read requires path")?;
    let resolved_path = resolve_target_path(&path, context)?;
    let output = run_command(
        "pdftotext",
        &[
            "-layout",
            "-nopgbrk",
            resolved_path.to_string_lossy().as_ref(),
            "-",
        ],
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

pub(super) async fn execute_paper_extract_meta_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let source_text = require_string_arg(
        args,
        &["text", "sourceText"],
        "paper_extract_meta requires text",
    )?;
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
    let paper: PaperReference = serde_json::from_value(candidate).map_err(|error| {
        AppError::InvalidInput(format!("paper_extract_meta returned invalid JSON: {error}"))
    })?;
    serde_json::to_string(&paper).map_err(|error| {
        AppError::InternalError(format!("Failed to serialize paper metadata: {error}"))
    })
}

fn parse_baseline_envelope(raw: &str) -> AppResult<Vec<ExtractedBaseline>> {
    let parsed = parse_json(raw)?;
    match parsed {
        Value::Array(_) => serde_json::from_value(parsed).map_err(|error| {
            AppError::InvalidInput(format!("Invalid baseline JSON response: {error}"))
        }),
        Value::Object(object) => match object.get("baselines") {
            Some(value) => serde_json::from_value(value.clone()).map_err(|error| {
                AppError::InvalidInput(format!("Invalid baseline JSON response: {error}"))
            }),
            None => Err(AppError::InvalidInput(
                "Invalid baseline JSON response: missing baselines field".to_string(),
            )),
        },
        _ => Err(AppError::InvalidInput(
            "Invalid baseline JSON response: expected object or array".to_string(),
        )),
    }
}

pub(super) async fn execute_baseline_extract_tool(
    args: &Value,
    context: &BootstrapExecutionContext,
) -> AppResult<String> {
    let source_text = require_string_arg(
        args,
        &["text", "sourceText"],
        "baseline_extract requires text",
    )?;
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
        unresolved_questions
            .push("No baselines were extracted. Ask the user to confirm one manually.".to_string());
    }

    Ok(json!({
        "baselines": parsed,
        "unresolvedQuestions": unresolved_questions,
        "reason": if unresolved_questions.is_empty() { Value::Null } else { Value::String("No baselines extracted.".to_string()) },
    })
    .to_string())
}

pub(super) async fn execute_arxiv_search_tool(args: &Value) -> AppResult<String> {
    let query = require_string_arg(args, &["query"], "arxiv_search requires query")?;
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(1, 20);
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
    let feed = response.text().await.map_err(|error| {
        AppError::ProcessError(format!("Failed to read arXiv response: {error}"))
    })?;
    let papers = parse_arxiv_atom_feed(&feed)?;
    Ok(json!({ "papers": papers }).to_string())
}
