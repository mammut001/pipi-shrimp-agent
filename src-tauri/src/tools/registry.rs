/**
 * Tool Registry
 *
 * Central registry of all available tools.
 * Each tool has a handler function, metadata for scheduling decisions,
 * and a JSON Schema for input validation.
 *
 * Design: fail-closed — unknown tools are rejected, not silently ignored.
 */
use std::collections::HashMap;
use std::sync::Arc;

use super::autoresearch_bootstrap::{self, BootstrapExecutionContext, BootstrapProviderContext};
use super::{ToolCallRequest, ToolCallResult, ToolMetadata};
use crate::commands::path_security::validate_path;
use jsonschema::{JSONSchema, ValidationError};

/// Tool handler: receives parsed JSON arguments, returns result string
pub type ToolHandler = Arc<dyn Fn(serde_json::Value) -> anyhow::Result<String> + Send + Sync>;

/// Registered tool entry
struct ToolEntry {
    handler: ToolHandler,
    metadata: ToolMetadata,
    compiled_schema: Option<JSONSchema>,
}

pub struct ToolRegistry {
    tools: HashMap<String, ToolEntry>,
}

const BOOTSTRAP_TOOL_NAMES: &[&str] = &[
    "pdf_read",
    "paper_extract_meta",
    "baseline_extract",
    "arxiv_search",
    "scaffold_generate",
    "git_init_workdir",
    "bootstrap_finalize",
];

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    /// Register a tool with its handler and metadata
    pub fn register(&mut self, name: &str, handler: ToolHandler, metadata: ToolMetadata) {
        let compiled_schema = JSONSchema::compile(&metadata.input_schema).ok();
        self.tools.insert(
            name.to_string(),
            ToolEntry {
                handler,
                metadata,
                compiled_schema,
            },
        );

        fn validate_request<'a>(
            &'a self,
            req: &ToolCallRequest,
        ) -> anyhow::Result<(&'a ToolEntry, serde_json::Value)> {
            let entry = self
                .tools
                .get(&req.name)
                .ok_or_else(|| anyhow::anyhow!("Unknown tool: {}", req.name))?;

            let args: serde_json::Value = serde_json::from_str(&req.arguments).map_err(|e| {
                anyhow::anyhow!("Invalid JSON arguments for tool '{}': {}", req.name, e)
            })?;

            if let Some(schema) = &entry.compiled_schema {
                if let Err(errors) = schema.validate(&args) {
                    let error_msgs: Vec<String> =
                        errors.map(|e: ValidationError| format!("{}", e)).collect();
                    return Ok((
                        entry,
                        serde_json::json!({
                            "__schema_validation_error": true,
                            "messages": error_msgs,
                        }),
                    ));
                }
            }

            Ok((entry, args))
        }
    }

    /// Execute a single tool call request
            let (entry, args) = self.validate_request(req)?;

            if args
                .get("__schema_validation_error")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                let error_msgs = args
                    .get("messages")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .collect::<Vec<_>>()
                    .join("; ");
                return Ok(ToolCallResult {
                    id: req.id.clone(),
                    name: req.name.clone(),
                    content: format!(
                        "Schema validation failed for tool '{}': {}",
                        req.name, error_msgs
                    ),
                    is_error: true,
                    error_code: Some("schema_validation".to_string()),
                });
            }

            if BOOTSTRAP_TOOL_NAMES.contains(&req.name.as_str()) {
                return Ok(ToolCallResult {
                    id: req.id.clone(),
                    name: req.name.clone(),
                    content: format!(
                        "Error: bootstrap tool '{}' requires execute_with_context()",
                        req.name
                    ),
                    is_error: true,
                    error_code: Some("invalid_arguments".to_string()),
                });
        }

        match (entry.handler)(args) {
            Ok(content) => Ok(ToolCallResult {
                id: req.id.clone(),
                name: req.name.clone(),
                content,
                is_error: false,
                    error_code: None,
            }),
            Err(e) => Ok(ToolCallResult {
                id: req.id.clone(),
                name: req.name.clone(),
                content: format!("Error: {}", e),
                is_error: true,
                    error_code: Some("internal_error".to_string()),
            }),
        }
    }

        pub async fn execute_with_context(
            &self,
            req: &ToolCallRequest,
        ) -> anyhow::Result<ToolCallResult> {
            let (_entry, args) = self.validate_request(req)?;

            if args
                .get("__schema_validation_error")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                let error_msgs = args
                    .get("messages")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .collect::<Vec<_>>()
                    .join("; ");
                return Ok(ToolCallResult {
                    id: req.id.clone(),
                    name: req.name.clone(),
                    content: format!(
                        "Schema validation failed for tool '{}': {}",
                        req.name, error_msgs
                    ),
                    is_error: true,
                    error_code: Some("schema_validation".to_string()),
                });
            }

            if BOOTSTRAP_TOOL_NAMES.contains(&req.name.as_str()) {
                let provider_context = match (&req.api_key, &req.model) {
                    (Some(api_key), Some(model)) if !api_key.trim().is_empty() && !model.trim().is_empty() => {
                        Some(BootstrapProviderContext {
                            api_key: api_key.clone(),
                            model: model.clone(),
                            base_url: req.base_url.clone(),
                            provider: req.provider.clone(),
                            api_format: req.api_format.clone(),
                            provider_capabilities: req.provider_capabilities.clone(),
                        })
                    }
                    _ => None,
                };
                let context = BootstrapExecutionContext {
                    work_dir: req.work_dir.clone(),
                    provider: provider_context,
                };

                match autoresearch_bootstrap::execute_tool(&req.name, &args, &context).await {
                    Ok(Some(content)) => {
                        return Ok(ToolCallResult {
                            id: req.id.clone(),
                            name: req.name.clone(),
                            content,
                            is_error: false,
                            error_code: None,
                        })
                    }
                    Ok(None) => {
                        return Ok(ToolCallResult {
                            id: req.id.clone(),
                            name: req.name.clone(),
                            content: format!("Error: Unknown tool: {}", req.name),
                            is_error: true,
                            error_code: Some("not_found".to_string()),
                        })
                    }
                    Err(error) => {
                        return Ok(ToolCallResult {
                            id: req.id.clone(),
                            name: req.name.clone(),
                            content: format!("Error: {}", error),
                            is_error: true,
                            error_code: Some(error.code.clone()),
                        })
                    }
                }
            }

            self.execute(req)
        }

    /// Check if a tool is concurrency-safe
    pub fn is_concurrency_safe(&self, name: &str) -> bool {
        self.tools
            .get(name)
            .map(|e| e.metadata.is_concurrency_safe)
            .unwrap_or(false)
    }

    /// Check if a tool is read-only
    #[allow(dead_code)]
    pub fn is_read_only(&self, name: &str) -> bool {
        self.tools
            .get(name)
            .map(|e| e.metadata.is_read_only)
            .unwrap_or(false)
    }

    /// Generate Anthropic API tools schema
    pub fn get_anthropic_tools_schema(&self) -> Vec<serde_json::Value> {
        self.tools
            .values()
            .map(|entry| {
                serde_json::json!({
                    "name": entry.metadata.name,
                    "description": entry.metadata.description,
                    "input_schema": entry.metadata.input_schema,
                })
            })
            .collect()
    }

    /// Generate OpenAI-compatible tools schema
    #[allow(dead_code)]
    pub fn get_openai_tools_schema(&self) -> Vec<serde_json::Value> {
        self.tools
            .values()
            .map(|entry| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": entry.metadata.name,
                        "description": entry.metadata.description,
                        "parameters": entry.metadata.input_schema,
                    }
                })
            })
            .collect()
    }

    /// Get all registered tool names
    #[allow(dead_code)]
    pub fn tool_names(&self) -> Vec<&String> {
        self.tools.keys().collect()
    }

    /// Get number of registered tools
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }
}

fn register_bootstrap_tool(
    registry: &mut ToolRegistry,
    name: &str,
    description: &str,
    input_schema: serde_json::Value,
    is_read_only: bool,
    is_concurrency_safe: bool,
) {
    registry.register(
        name,
        Arc::new(move |_| {
            Err(anyhow::anyhow!(
                "bootstrap tool '{}' requires execute_with_context()",
                name
            ))
        }),
        ToolMetadata {
            name: name.to_string(),
            description: description.to_string(),
            is_read_only,
            is_concurrency_safe,
            input_schema,
        },
    );
}

/// Register all built-in tools
pub fn register_builtin_tools(registry: &mut ToolRegistry) {
    // --- read_file ---
    registry.register(
        "read_file",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            validate_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!("Path security violation: {}", e))?;
            std::fs::read_to_string(path)
                .map_err(|e| anyhow::anyhow!("Cannot read '{}': {}", path, e))
        }),
        ToolMetadata {
            name: "read_file".to_string(),
            description: "Read the contents of a file at the given path. Returns the file content as text. Use this to examine source code, configuration files, or any text file.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file to read"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );

    // --- write_file ---
    registry.register(
        "write_file",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let content = args.get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: content"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            validate_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!("Path security violation: {}", e))?;

            // Ensure parent directory exists
            if let Some(parent) = std::path::Path::new(path).parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| anyhow::anyhow!("Cannot create directory for '{}': {}", path, e))?;
                }
            }

            std::fs::write(path, content)
                .map_err(|e| anyhow::anyhow!("Cannot write '{}': {}", path, e))?;
            Ok(format!("Successfully wrote {} bytes to {}", content.len(), path))
        }),
        ToolMetadata {
            name: "write_file".to_string(),
            description: "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories if needed.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file"
                    }
                },
                "required": ["path", "content"],
                "additionalProperties": false,
            }),
        },
    );

    // --- list_files ---
    registry.register(
        "list_files",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            validate_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!("Path security violation: {}", e))?;

            let dir = std::path::Path::new(path);
            if !dir.exists() {
                return Err(anyhow::anyhow!("Path does not exist: {}", path));
            }
            if !dir.is_dir() {
                return Err(anyhow::anyhow!("Path is not a directory: {}", path));
            }

            let mut entries: Vec<String> = Vec::new();
            for entry in std::fs::read_dir(dir)
                .map_err(|e| anyhow::anyhow!("Cannot read directory '{}': {}", path, e))?
                .flatten()
            {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.path().is_dir();
                let prefix = if is_dir { "📁 " } else { "📄 " };
                entries.push(format!("{}{}", prefix, name));
            }
            entries.sort();
            Ok(entries.join("\n"))
        }),
        ToolMetadata {
            name: "list_files".to_string(),
            description: "List files and directories in the given path. Returns a sorted list with directory indicators. Use this to explore project structure.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list contents of"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );

    // --- create_directory ---
    registry.register(
        "create_directory",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            validate_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!("Path security violation: {}", e))?;
            std::fs::create_dir_all(path)
                .map_err(|e| anyhow::anyhow!("Cannot create directory '{}': {}", path, e))?;
            Ok(format!("Directory created: {}", path))
        }),
        ToolMetadata {
            name: "create_directory".to_string(),
            description: "Create a new directory at the given path. Creates parent directories as needed (like mkdir -p).".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to create"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );

    // --- path_exists ---
    registry.register(
        "path_exists",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            validate_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!("Path security violation: {}", e))?;
            let exists = std::path::Path::new(path).exists();
            let is_dir = std::path::Path::new(path).is_dir();
            let is_file = std::path::Path::new(path).is_file();
            let kind = if is_dir { "directory" } else if is_file { "file" } else { "unknown" };
            Ok(format!("{}: {} ({})", path, exists, kind))
        }),
        ToolMetadata {
            name: "path_exists".to_string(),
            description: "Check if a file or directory exists at the given path. Returns existence status and type (file/directory).".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to check for existence"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );

    // --- search_files (ripgrep) ---
    registry.register(
        "search_files",
        Arc::new(|args| {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: pattern"))?;
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            validate_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!("Path security violation: {}", e))?;

            let output = std::process::Command::new("rg")
                .arg("--line-number")
                .arg("--no-heading")
                .arg("--max-count")
                .arg("50")
                .arg(pattern)
                .arg(path)
                .output()
                .map_err(|e| anyhow::anyhow!("Cannot run ripgrep: {}. Is rg installed?", e))?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.is_empty() {
                    Ok(format!("No matches found for '{}' in {}", pattern, path))
                } else {
                    Ok(stdout.to_string())
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // rg returns exit code 1 for no matches (not an error)
                if output.status.code() == Some(1) {
                    Ok(format!("No matches found for '{}' in {}", pattern, path))
                } else {
                    Err(anyhow::anyhow!("ripgrep error: {}", stderr))
                }
            }
        }),
        ToolMetadata {
            name: "search_files".to_string(),
            description: "Search for a text pattern in files using ripgrep (rg). Returns matching lines with file paths and line numbers. Fast and efficient for code search.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Text pattern to search for (supports regex)"
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory or file to search in (default: current directory)"
                    }
                },
                "required": ["pattern"],
                "additionalProperties": false,
            }),
        },
    );

    register_bootstrap_tool(
        registry,
        "pdf_read",
        "Read and extract plain text from a local PDF file path.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            },
            "required": ["path"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "paper_extract_meta",
        "Extract structured paper metadata from grounded source text. Return JSON-only metadata.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" }
            },
            "required": ["text"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "baseline_extract",
        "Extract baseline methods and reported metrics from grounded paper text. Return JSON-only baselines.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" }
            },
            "required": ["text"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "arxiv_search",
        "Search arXiv and return a small list of relevant paper metadata.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "limit": { "type": "number" }
            },
            "required": ["query"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "scaffold_generate",
        "Generate a deterministic AutoResearch scaffold into the requested workDir using a known template.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "templateId": { "type": "string", "enum": ["python-ml-baseline", "node-eval-harness"] },
                "workDir": { "type": "string" },
                "researchGoal": { "type": "string" },
                "successCriteria": { "type": "string" },
                "primaryMetric": { "type": "string" },
                "baselineName": { "type": "string" },
                "datasetName": { "type": "string" },
                "projectName": { "type": "string" }
            },
            "required": ["templateId", "workDir", "researchGoal", "successCriteria", "primaryMetric"],
            "additionalProperties": false,
        }),
        false,
        false,
    );
    register_bootstrap_tool(
        registry,
        "git_init_workdir",
        "Initialize a Git repository in the specified workDir and create the initial commit.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "workDir": { "type": "string" }
            },
            "required": ["workDir"],
            "additionalProperties": false,
        }),
        false,
        false,
    );
    register_bootstrap_tool(
        registry,
        "bootstrap_finalize",
        "Validate and persist the final AutoResearch bootstrap plan. Returns a structured bootstrap result.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "researchGoal": { "type": "string" },
                "successCriteria": { "type": "string" },
                "primaryMetric": { "type": "string" },
                "secondaryMetrics": { "type": "array", "items": { "type": "string" } },
                "papers": { "type": "array", "items": { "type": "object" } },
                "baselines": { "type": "array", "items": { "type": "object" } },
                "scaffold": { "type": "object" },
                "gitInitialized": { "type": "boolean" },
                "initialCommitSha": { "type": "string" },
                "conversationalTemplateId": { "type": "string", "enum": ["reproduce-paper", "beat-baseline", "ablation", "from-scratch"] }
            },
            "required": ["researchGoal", "successCriteria", "primaryMetric", "papers", "baselines", "scaffold", "gitInitialized", "conversationalTemplateId"],
            "additionalProperties": false,
        }),
        false,
        false,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_request(name: &str, arguments: serde_json::Value) -> ToolCallRequest {
        ToolCallRequest {
            id: "tool-1".to_string(),
            name: name.to_string(),
            arguments: arguments.to_string(),
            work_dir: None,
            api_key: None,
            model: None,
            base_url: None,
            provider: None,
            api_format: None,
            provider_capabilities: None,
        }
    }

    #[tokio::test]
    async fn bootstrap_llm_tool_requires_provider_context() {
        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry);

        let result = registry
            .execute_with_context(&make_request(
                "paper_extract_meta",
                serde_json::json!({ "text": "A paper about strong baselines." }),
            ))
            .await
            .expect("execution should return structured result");

        assert!(result.is_error);
        assert_eq!(result.error_code.as_deref(), Some("invalid_input"));
        assert!(result.content.contains("requires active provider context"));
    }

    #[tokio::test]
    async fn scaffold_generate_executes_through_contextual_registry_path() {
        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry);

        let work_dir = std::env::temp_dir().join(format!(
            "pipi-bootstrap-registry-{}",
            Uuid::new_v4()
        ));
        let request = make_request(
            "scaffold_generate",
            serde_json::json!({
                "templateId": "python-ml-baseline",
                "workDir": work_dir.to_string_lossy(),
                "researchGoal": "Improve benchmark accuracy",
                "successCriteria": "Beat the baseline by at least 1 point.",
                "primaryMetric": "accuracy",
                "baselineName": "ResNet50",
                "datasetName": "CIFAR10",
                "projectName": "registry-test",
            }),
        );

        let result = registry
            .execute_with_context(&request)
            .await
            .expect("execution should succeed");

        assert!(!result.is_error);
        assert!(result.content.contains("python-ml-baseline"));
        assert!(work_dir.join("run_experiment.py").exists());
        assert!(work_dir.join("AUTORESEARCH.md").exists());

        let _ = std::fs::remove_dir_all(work_dir);
    }
}
