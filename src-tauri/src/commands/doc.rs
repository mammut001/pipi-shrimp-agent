/**
 * Document management commands
 *
 * Handles document creation and management in .pipi-shrimp/docs/:
 * - Creating documents with auto-incrementing sequential numbers
 * - Maintaining INDEX.md automatically
 * - Reading, listing, and deleting documents
 */

use crate::utils::{AppResult, AppError};
use chrono::Local;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const DOCS_DIR: &str = "docs";
const INDEX_FILE: &str = "INDEX.md";

/// Document metadata returned by list_docs
#[derive(Debug, Serialize, Deserialize)]
pub struct DocMeta {
    pub number: String,
    pub filename: String,
    pub title: String,
    pub created: String,
    pub updated: Option<String>,
    pub tags: Vec<String>,
    pub summary: Option<String>,
    pub path: String,
}

/// Full document content returned by read_doc
#[derive(Debug, Serialize, Deserialize)]
pub struct DocContent {
    pub meta: DocMeta,
    pub body: String,
}

/// Result returned by create_doc
#[derive(Debug, Serialize, Deserialize)]
pub struct DocResult {
    pub number: String,
    pub filename: String,
    pub path: String,
    pub index_updated: bool,
}

/// Parse frontmatter from markdown content
fn parse_frontmatter(content: &str) -> (serde_json::Value, &str) {
    if !content.starts_with("---") {
        return (serde_json::json!({}), content);
    }

    if let Some(end_idx) = content[3..].find("---") {
        let frontmatter_str = &content[3..end_idx + 3];
        let body = &content[end_idx + 6..];

        // Simple YAML-like parsing for frontmatter
        let mut fm = serde_json::json!({});
        for line in frontmatter_str.lines() {
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();

                if value.starts_with('[') && value.ends_with(']') {
                    // Parse array
                    let items: Vec<String> = value
                        .trim_start_matches('[')
                        .trim_end_matches(']')
                        .split(',')
                        .map(|s| s.trim().trim_matches('"').to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    fm[key] = serde_json::json!(items);
                } else if value.starts_with('"') && value.ends_with('"') {
                    fm[key] = serde_json::json!(value.trim_matches('"'));
                } else {
                    fm[key] = serde_json::json!(value);
                }
            }
        }

        return (fm, body);
    }

    (serde_json::json!({}), content)
}

/// Generate frontmatter string
fn generate_frontmatter(
    title: &str,
    created: &str,
    tags: &[String],
    related: &[String],
    summary: &Option<String>,
) -> String {
    let mut fm = format!(
        r#"---
title: {}
created: {}
tags: [{}]
"#,
        title,
        created,
        tags.join(", ")
    );

    if !related.is_empty() {
        fm.push_str(&format!("related: [{}]\n", related.join(", ")));
    }

    if let Some(sum) = summary {
        fm.push_str(&format!("summary: {}\n", sum));
    }

    fm.push_str("---\n\n");
    fm
}

/// Slugify a title for filename
fn slugify(text: &str) -> String {
    let text = text
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");

    // Limit length
    if text.len() > 50 {
        text[..50].to_string()
    } else {
        text
    }
}

/// Ensure docs directory exists
fn ensure_docs_dir(pipi_dir: &PathBuf) -> AppResult<PathBuf> {
    let docs_dir = pipi_dir.join(DOCS_DIR);
    fs::create_dir_all(&docs_dir)
        .map_err(|e| AppError::FileError(format!("Failed to create docs directory: {}", e)))?;
    Ok(docs_dir)
}

/// Extract document number from filename
fn extract_number(filename: &str) -> Option<u32> {
    let re = Regex::new(r"^(\d+)").ok()?;
    let caps = re.captures(filename)?;
    caps.get(1)?.as_str().parse().ok()
}

/// Get the next available document number
#[tauri::command]
pub fn get_next_doc_number(work_dir: String) -> AppResult<String> {
    let pipi_dir = PathBuf::from(&work_dir).join(".pipi-shrimp");
    let docs_dir = pipi_dir.join(DOCS_DIR);

    if !docs_dir.exists() {
        return Ok("001".to_string());
    }

    let mut max_num: u32 = 0;

    if let Ok(entries) = fs::read_dir(&docs_dir) {
        for entry in entries.flatten() {
            if let Some(num) = extract_number(&entry.file_name().to_string_lossy()) {
                if num > max_num {
                    max_num = num;
                }
            }
        }
    }

    Ok(format!("{:03}", max_num + 1))
}

/// Create a new document
#[tauri::command]
pub async fn create_doc(
    work_dir: String,
    title: String,
    body: String,
    tags: Option<Vec<String>>,
    related: Option<Vec<String>>,
    summary: Option<String>,
) -> AppResult<DocResult> {
    let pipi_dir = PathBuf::from(&work_dir).join(".pipi-shrimp");
    let docs_dir = ensure_docs_dir(&pipi_dir)?;

    // Get next number
    let number = get_next_doc_number(work_dir.clone())?;
    let slug = slugify(&title);
    let filename = format!("{}_{}.md", number, slug);
    let doc_path = docs_dir.join(&filename);

    let created = Local::now().to_rfc3339();
    let tags = tags.unwrap_or_default();
    let related = related.unwrap_or_default();

    // Generate content with frontmatter
    let frontmatter = generate_frontmatter(&title, &created, &tags, &related, &summary);
    let content = format!("{}{}", frontmatter, body);

    // Write document
    fs::write(&doc_path, &content)
        .map_err(|e| AppError::FileError(format!("Failed to write document: {}", e)))?;

    // Update index
    let index_updated = update_index_internal(&pipi_dir, &number, &filename, &title, &created, &tags, &summary)?;

    Ok(DocResult {
        number,
        filename,
        path: doc_path.to_string_lossy().to_string(),
        index_updated,
    })
}

/// Internal function to update INDEX.md
fn update_index_internal(
    pipi_dir: &PathBuf,
    number: &str,
    filename: &str,
    title: &str,
    created: &str,
    _tags: &[String],
    summary: &Option<String>,
) -> AppResult<bool> {
    let index_path = pipi_dir.join(DOCS_DIR).join(INDEX_FILE);

    let created_date = created.split('T').next().unwrap_or(created);

    let new_entry = format!(
        "| {} | {} | {} | {} |\n",
        number,
        format!("[{}]({})", title, filename),
        created_date,
        summary.as_deref().unwrap_or("-")
    );

    let content = if index_path.exists() {
        fs::read_to_string(&index_path).unwrap_or_default()
    } else {
        generate_index_template()
    };

    // Check if entry already exists (by number)
    if content.contains(&format!("| {} |", number)) {
        return Ok(false); // Entry already exists
    }

    // Find the last table row and insert before any separator
    let insert_pos = content.rfind("\n---")
        .or_else(|| content.rfind("\n|"))
        .map(|pos| pos + 1)
        .unwrap_or(content.len());

    let new_content = format!("{}{}", &content[..insert_pos], new_entry);

    fs::write(&index_path, new_content)
        .map_err(|e| AppError::FileError(format!("Failed to update index: {}", e)))?;

    Ok(true)
}

/// Generate INDEX.md template
fn generate_index_template() -> String {
    let today = Local::now().format("%Y-%m-%d").to_string();
    format!(
        r#"# 文档索引

> 最后更新: {}

## 统计

- 文档总数: 0
- 创建时间: {}

## 文档列表

| 序号 | 文档名 | 创建时间 | 说明 |
|------|--------|----------|------|
"#,
        today, today
    )
}

/// List all documents
#[tauri::command]
pub fn list_docs(work_dir: String) -> AppResult<Vec<DocMeta>> {
    let docs_dir = PathBuf::from(&work_dir).join(".pipi-shrimp").join(DOCS_DIR);

    if !docs_dir.exists() {
        return Ok(vec![]);
    }

    let mut docs: Vec<DocMeta> = Vec::new();

    if let Ok(entries) = fs::read_dir(&docs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    if filename == INDEX_FILE {
                        continue;
                    }

                    if let Some(number) = extract_number(filename) {
                        let content = fs::read_to_string(&path)
                            .unwrap_or_default();
                        let (fm, _) = parse_frontmatter(&content);

                        let title = fm.get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&filename.replace(".md", ""))
                            .to_string();

                        let created = fm.get("created")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        let updated = fm.get("updated")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        let tags: Vec<String> = fm.get("tags")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                            .unwrap_or_default();

                        let summary = fm.get("summary")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        docs.push(DocMeta {
                            number: format!("{:03}", number),
                            filename: filename.to_string(),
                            title,
                            created,
                            updated,
                            tags,
                            summary,
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    // Sort by number
    docs.sort_by(|a, b| a.number.cmp(&b.number));

    Ok(docs)
}

/// Read a single document
#[tauri::command]
pub fn read_doc(work_dir: String, number: String) -> AppResult<DocContent> {
    let docs_dir = PathBuf::from(&work_dir).join(".pipi-shrimp").join(DOCS_DIR);

    // Find the document with matching number
    let mut found_path: Option<PathBuf> = None;

    if let Ok(entries) = fs::read_dir(&docs_dir) {
        for entry in entries.flatten() {
            if let Some(filename) = entry.file_name().to_str() {
                if filename.starts_with(&format!("{}_", number)) && filename.ends_with(".md") {
                    found_path = Some(entry.path());
                    break;
                }
            }
        }
    }

    let path = found_path.ok_or_else(|| {
        AppError::FileError(format!("Document {} not found", number))
    })?;

    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::FileError(format!("Failed to read document: {}", e)))?;

    let (fm, body) = parse_frontmatter(&content);

    let title = fm.get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let created = fm.get("created")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let updated = fm.get("updated")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let tags: Vec<String> = fm.get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let summary = fm.get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let meta = DocMeta {
        number,
        filename: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
        title,
        created,
        updated,
        tags,
        summary,
        path: path.to_string_lossy().to_string(),
    };

    Ok(DocContent { meta, body: body.to_string() })
}

/// Delete a document
#[tauri::command]
pub fn delete_doc(work_dir: String, number: String) -> AppResult<bool> {
    let docs_dir = PathBuf::from(&work_dir).join(".pipi-shrimp").join(DOCS_DIR);

    // Find and delete the document
    let mut found_path: Option<PathBuf> = None;

    if let Ok(entries) = fs::read_dir(&docs_dir) {
        for entry in entries.flatten() {
            if let Some(filename) = entry.file_name().to_str() {
                if filename.starts_with(&format!("{}_", number)) && filename.ends_with(".md") {
                    found_path = Some(entry.path());
                    break;
                }
            }
        }
    }

    if let Some(path) = found_path {
        fs::remove_file(&path)
            .map_err(|e| AppError::FileError(format!("Failed to delete document: {}", e)))?;

        // Rebuild index
        rebuild_index(&docs_dir)?;

        Ok(true)
    } else {
        Ok(false)
    }
}

/// Rebuild INDEX.md from existing documents
fn rebuild_index(docs_dir: &PathBuf) -> AppResult<()> {
    let docs = list_docs_internal(docs_dir)?;

    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut content = format!(
        r#"# 文档索引

> 最后更新: {}

## 统计

- 文档总数: {}
- 创建时间: {}

## 文档列表

| 序号 | 文档名 | 创建时间 | 说明 |
|------|--------|----------|------|
"#,
        today,
        docs.len(),
        today
    );

    for doc in docs {
        let summary = doc.summary.as_deref().unwrap_or("-");
        let updated = doc.updated.as_ref().map(|s| format!(" (更新: {})", s.split('T').next().unwrap_or(s))).unwrap_or_default();
        content.push_str(&format!(
            "| {} | {} | {} | {}{} |\n",
            doc.number,
            format!("[{}]({})", doc.title, doc.filename),
            doc.created.split('T').next().unwrap_or(&doc.created),
            summary,
            updated
        ));
    }

    let index_path = docs_dir.join(INDEX_FILE);
    fs::write(&index_path, content)
        .map_err(|e| AppError::FileError(format!("Failed to rebuild index: {}", e)))?;

    Ok(())
}

/// Internal list_docs without AppResult wrapper
fn list_docs_internal(docs_dir: &PathBuf) -> AppResult<Vec<DocMeta>> {
    if !docs_dir.exists() {
        return Ok(vec![]);
    }

    let mut docs: Vec<DocMeta> = Vec::new();

    if let Ok(entries) = fs::read_dir(docs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    if filename == INDEX_FILE {
                        continue;
                    }

                    if let Some(number) = extract_number(filename) {
                        let content = fs::read_to_string(&path)
                            .unwrap_or_default();
                        let (fm, _) = parse_frontmatter(&content);

                        let title = fm.get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&filename.replace(".md", ""))
                            .to_string();

                        let created = fm.get("created")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        let updated = fm.get("updated")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        let tags: Vec<String> = fm.get("tags")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                            .unwrap_or_default();

                        let summary = fm.get("summary")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        docs.push(DocMeta {
                            number: format!("{:03}", number),
                            filename: filename.to_string(),
                            title,
                            created,
                            updated,
                            tags,
                            summary,
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    docs.sort_by(|a, b| a.number.cmp(&b.number));

    Ok(docs)
}

/// Update document index (rebuild from scratch)
#[tauri::command]
pub fn update_doc_index(work_dir: String) -> AppResult<String> {
    let docs_dir = PathBuf::from(&work_dir).join(".pipi-shrimp").join(DOCS_DIR);
    rebuild_index(&docs_dir)?;
    Ok("Index updated successfully".to_string())
}

/// Update an existing document
#[tauri::command]
pub async fn update_doc(
    work_dir: String,
    number: String,
    title: Option<String>,
    body: Option<String>,
    tags: Option<Vec<String>>,
    related: Option<Vec<String>>,
    summary: Option<String>,
) -> AppResult<DocResult> {
    let docs_dir = PathBuf::from(&work_dir).join(".pipi-shrimp").join(DOCS_DIR);

    // Find the document
    let mut found_path: Option<PathBuf> = None;

    if let Ok(entries) = fs::read_dir(&docs_dir) {
        for entry in entries.flatten() {
            if let Some(filename) = entry.file_name().to_str() {
                if filename.starts_with(&format!("{}_", number)) && filename.ends_with(".md") {
                    found_path = Some(entry.path());
                    break;
                }
            }
        }
    }

    let path = found_path.ok_or_else(|| {
        AppError::FileError(format!("Document {} not found", number))
    })?;

    // Read existing content
    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::FileError(format!("Failed to read document: {}", e)))?;

    let (fm, _existing_body) = parse_frontmatter(&content);

    // Get existing values or use new ones
    let new_title = title.unwrap_or_else(|| 
        fm.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string()
    );
    let new_tags = tags.unwrap_or_else(|| 
        fm.get("tags").and_then(|v| v.as_array()).map(|arr| 
            arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        ).unwrap_or_default()
    );
    let new_related = related.unwrap_or_else(|| 
        fm.get("related").and_then(|v| v.as_array()).map(|arr| 
            arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        ).unwrap_or_default()
    );
    let new_summary = summary.or_else(|| 
        fm.get("summary").and_then(|v| v.as_str()).map(String::from)
    );
    let created = fm.get("created")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| chrono::Local::now().to_rfc3339());

    let updated = chrono::Local::now().to_rfc3339();

    // Generate new frontmatter
    let frontmatter = generate_frontmatter_with_updated(&new_title, &created, &updated, &new_tags, &new_related, &new_summary);
    
    // Use new body if provided, otherwise keep existing
    let final_body = body.unwrap_or(_existing_body.to_string());
    let new_content = format!("{}{}", frontmatter, final_body);

    // Write updated content
    fs::write(&path, &new_content)
        .map_err(|e| AppError::FileError(format!("Failed to update document: {}", e)))?;

    // Update index
    let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    rebuild_index(&docs_dir)?;

    Ok(DocResult {
        number,
        filename,
        path: path.to_string_lossy().to_string(),
        index_updated: true,
    })
}

/// Generate frontmatter string with updated timestamp
fn generate_frontmatter_with_updated(
    title: &str,
    created: &str,
    updated: &str,
    tags: &[String],
    related: &[String],
    summary: &Option<String>,
) -> String {
    let mut fm = format!(
        r#"---
title: {}
created: {}
updated: {}
tags: [{}]
"#,
        title,
        created,
        updated,
        tags.join(", ")
    );

    if !related.is_empty() {
        fm.push_str(&format!("related: [{}]\n", related.join(", ")));
    }

    if let Some(sum) = summary {
        fm.push_str(&format!("summary: {}\n", sum));
    }

    fm.push_str("---\n\n");
    fm
}
