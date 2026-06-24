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
use crate::commands::code::execute_bash_for_tool;
use crate::commands::file::{
    create_directory_for_tool, read_file_for_tool, resolve_path as resolve_tool_path,
    write_file_for_tool,
};
use crate::tools::shell_profile::WindowsShellProfile;
use crate::tools::ssh_bridge::{execute_ssh_exec, execute_ssh_read_file, execute_ssh_upload};
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
    }

    fn validate_request(
        &self,
        req: &ToolCallRequest,
        session_id: Option<&str>,
    ) -> anyhow::Result<(&ToolEntry, serde_json::Value)> {
        let entry = self
            .tools
            .get(&req.name)
            .ok_or_else(|| anyhow::anyhow!("Unknown tool: {}", req.name))?;

        let mut args: serde_json::Value = serde_json::from_str(&req.arguments).map_err(|e| {
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

        if let Some(object) = args.as_object_mut() {
            if let Some(work_dir) = &req.work_dir {
                object
                    .entry("work_dir".to_string())
                    .or_insert_with(|| serde_json::Value::String(work_dir.clone()));
            }
        }

        crate::tools::execution_policy::enforce_request_policy(req, &args, session_id)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        Ok((entry, args))
    }

    /// Execute a single tool call request
    pub fn execute(&self, req: &ToolCallRequest) -> anyhow::Result<ToolCallResult> {
        let (entry, args) = self.validate_request(req, None)?;

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
        session_id: Option<&str>,
    ) -> anyhow::Result<ToolCallResult> {
        let (_entry, args) = self.validate_request(req, session_id)?;

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
                (Some(api_key), Some(model))
                    if !api_key.trim().is_empty() && !model.trim().is_empty() =>
                {
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

    /// Returns true when the tool is registered in the authoritative registry.
    pub fn is_registered(&self, name: &str) -> bool {
        self.tools.contains_key(name)
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
    let name_owned = name.to_string();
    registry.register(
        name,
        Arc::new(move |_| {
            Err(anyhow::anyhow!(
                "bootstrap tool '{}' requires execute_with_context()",
                name_owned
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
            read_file_for_tool(path, work_dir)
                .map(|result| result.content)
                .map_err(|error| anyhow::anyhow!(error.message))
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
            write_file_for_tool(path, content, work_dir).map_err(|error| anyhow::anyhow!(error.message))
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
            let resolved = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;

            let dir = resolved.as_path();
            if !dir.exists() {
                return Err(anyhow::anyhow!("Path does not exist: {}", resolved.display()));
            }
            if !dir.is_dir() {
                return Err(anyhow::anyhow!("Path is not a directory: {}", resolved.display()));
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
            create_directory_for_tool(path, work_dir)
                .map_err(|error| anyhow::anyhow!(error.message))
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
            let resolved = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let exists = resolved.exists();
            let is_dir = resolved.is_dir();
            let is_file = resolved.is_file();
            let kind = if is_dir { "directory" } else if is_file { "file" } else { "unknown" };
            Ok(format!("{}: {} ({})", resolved.display(), exists, kind))
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
            // AUDIT-FIX [fix-3#15] — Reject patterns that are known to
            // cause catastrophic backtracking in Rust's `regex` engine (and
            // by extension in `rg`'s default mode). The user-friendly
            // alternative is ripgrep's `rust` regex engine which is
            // O(n*m) but with a much smaller constant and is also bounded
            // by the input length. We additionally set a hard time limit.
            if pattern.len() > 4096 {
                return Err(anyhow::anyhow!(
                    "search_files pattern is too long ({} chars); max 4096",
                    pattern.len()
                ));
            }
            if pattern.contains("(a+)+") || pattern.contains("(a*)*") || pattern.contains("(.*)*") {
                return Err(anyhow::anyhow!(
                    "search_files pattern contains a quantifier-on-quantifier \
                     construct (e.g. `(a+)+`) known to cause catastrophic \
                     backtracking. Use a simpler pattern or PCRE2."
                ));
            }
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let resolved = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;

            // Use Rust's regex engine (no PCRE) and a hard timeout. If the
            // installed `rg` doesn't support `--engine` (very old versions),
            // we still get a per-process timeout from std::process.
            let output = std::process::Command::new("rg")
                .arg("--line-number")
                .arg("--no-heading")
                .arg("--max-count")
                .arg("50")
                .arg("--engine")
                .arg("rust")
                .arg(pattern)
                .arg(&resolved)
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

    // --- execute_command ---
    registry.register(
        "execute_command",
        Arc::new(|args| {
            let command = args
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: command"))?;
            let cwd = args.get("cwd").and_then(|v| v.as_str());
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let timeout_secs = args
                .get("timeoutSecs")
                .and_then(|v| v.as_u64())
                .or_else(|| args.get("timeout").and_then(|v| v.as_u64()));
            let execution_id = args
                .get("executionId")
                .and_then(|v| v.as_str())
                .or_else(|| args.get("execution_id").and_then(|v| v.as_str()));
            let windows_shell_profile = args
                .get("windowsShellProfile")
                .cloned()
                .map(serde_json::from_value::<WindowsShellProfile>)
                .transpose()
                .map_err(|e| anyhow::anyhow!("Invalid windowsShellProfile: {}", e))?;
            let result = execute_bash_for_tool(
                command,
                cwd,
                work_dir,
                timeout_secs,
                execution_id,
                windows_shell_profile,
            )
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            serde_json::to_string(&result)
                .map_err(|e| anyhow::anyhow!("Failed to serialize command result: {}", e))
        }),
        ToolMetadata {
            name: "execute_command".to_string(),
            description: "Execute a shell command inside the bound work directory. On Windows, Auto uses PowerShell for Windows paths and WSL only for WSL/Linux workspaces; do not mix PowerShell and WSL installs or build artifacts in the same workspace. Returns structured JSON with stdout, stderr, exit code, cwd, and truncation metadata.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Optional explicit cwd inside the bound workDir"
                    },
                    "timeoutSecs": {
                        "type": "number",
                        "description": "Optional timeout hint in seconds"
                    },
                    "executionId": {
                        "type": "string",
                        "description": "Optional execution identifier used to track and cancel a running command."
                    },
                    "execution_id": {
                        "type": "string",
                        "description": "Legacy snake_case alias for executionId."
                    },
                    "windowsShellProfile": {
                        "type": "string",
                        "enum": ["auto", "powershell", "wsl"],
                        "description": "Optional Windows shell profile override. Auto uses PowerShell for Windows paths and WSL for WSL/Linux workspaces."
                    }
                },
                "required": ["command"],
                "additionalProperties": false,
            }),
        },
    );

    registry.register(
        "ssh_exec",
        Arc::new(|args| execute_ssh_exec(&args)),
        ToolMetadata {
            name: "ssh_exec".to_string(),
            description: "Execute a command on a local or remote SSH target inside the bound remote work directory. Returns structured JSON with stdout, stderr, exit code, execution ID, and lifecycle status.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" },
                    "timeout": { "type": "number" },
                    "executionId": { "type": "string" }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        },
    );

    registry.register(
        "ssh_upload_file",
        Arc::new(|args| execute_ssh_upload(&args)),
        ToolMetadata {
            name: "ssh_upload_file".to_string(),
            description: "Upload a local file or inline content to a local or remote SSH target within the bound remote work directory.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "localPath": { "type": "string" },
                    "content": { "type": "string" },
                    "remotePath": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" }
                },
                "required": ["remotePath"],
                "additionalProperties": false
            }),
        },
    );

    registry.register(
        "ssh_read_file",
        Arc::new(|args| execute_ssh_read_file(&args)),
        ToolMetadata {
            name: "ssh_read_file".to_string(),
            description: "Read a file from a local or remote SSH target within the bound remote work directory.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "remotePath": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" },
                    "maxLines": { "type": "number" }
                },
                "required": ["remotePath"],
                "additionalProperties": false
            }),
        },
    );

    // --- glob_search ---
    registry.register(
        "glob_search",
        Arc::new(|args| {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: pattern"))?;
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let expanded_path = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let full_pattern = format!("{}/{}", expanded_path.display(), pattern);
            let mut files = Vec::new();
            for entry in glob::glob(&full_pattern)
                .map_err(|e| anyhow::anyhow!("Invalid glob pattern: {}", e))?
            {
                if let Ok(path) = entry {
                    if path.is_file() {
                        files.push(path.to_string_lossy().to_string());
                    }
                }
            }
            serde_json::to_string(&files)
                .map_err(|e| anyhow::anyhow!("Failed to serialize glob results: {}", e))
        }),
        ToolMetadata {
            name: "glob_search".to_string(),
            description: "Find files matching a glob pattern under the given directory.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern", "path"],
                "additionalProperties": false
            }),
        },
    );

    // --- grep_files ---
    registry.register(
        "grep_files",
        Arc::new(|args| {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: pattern"))?;
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let expanded_path = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let output = std::process::Command::new("grep")
                .arg("-n")
                .arg("--binary-files=without-match")
                .arg("-r")
                .arg(pattern)
                .arg(&expanded_path)
                .output()
                .map_err(|e| anyhow::anyhow!("Cannot run grep: {}", e))?;
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            } else if output.status.code() == Some(1) {
                Ok(format!("No matches found for '{}' in {}", pattern, path))
            } else {
                Err(anyhow::anyhow!(
                    "grep error: {}",
                    String::from_utf8_lossy(&output.stderr)
                ))
            }
        }),
        ToolMetadata {
            name: "grep_files".to_string(),
            description: "Search for a text pattern in files using grep.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern", "path"],
                "additionalProperties": false
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
            source: super::super::ToolExecutionSource::Unknown,
            allowed_tools: None,
            api_key: None,
            model: None,
            base_url: None,
            provider: None,
            api_format: None,
            provider_capabilities: None,
            approval_token: None,
            execution_mode: None,
        }
    }

    #[tokio::test]
    async fn bootstrap_llm_tool_requires_provider_context() {
        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry);

        let result = registry
            .execute_with_context(
                &make_request(
                    "paper_extract_meta",
                    serde_json::json!({ "text": "A paper about strong baselines." }),
                ),
                None,
            )
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

        let work_dir =
            std::env::temp_dir().join(format!("pipi-bootstrap-registry-{}", Uuid::new_v4()));
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
            .execute_with_context(&request, None)
            .await
            .expect("execution should succeed");

        assert!(!result.is_error);
        assert!(result.content.contains("python-ml-baseline"));
        assert!(work_dir.join("run_experiment.py").exists());
        assert!(work_dir.join("AUTORESEARCH.md").exists());

        let _ = std::fs::remove_dir_all(work_dir);
    }

    #[test]
    fn registry_registers_glob_and_grep_tools() {
        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry);
        assert!(registry.is_registered("glob_search"));
        assert!(registry.is_registered("grep_files"));
    }

    #[tokio::test]
    async fn modern_single_tool_path_still_executes_read_file() {
        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry);

        let work_dir = std::env::temp_dir().join(format!("pipi-registry-read-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");
        let file_path = work_dir.join("sample.txt");
        std::fs::write(&file_path, "hello registry").expect("sample file should exist");

        let mut request = make_request(
            "read_file",
            serde_json::json!({ "path": "sample.txt" }),
        );
        request.work_dir = Some(work_dir.to_string_lossy().to_string());
        request.source = super::super::ToolExecutionSource::AssistantToolCall;

        let result = registry
            .execute_with_context(&request, Some("session-modern"))
            .await
            .expect("read_file should execute through registry path");

        assert!(!result.is_error);
        assert_eq!(result.content, "hello registry");

        let _ = std::fs::remove_dir_all(work_dir);
    }

    #[tokio::test]
    async fn write_file_uses_bound_work_dir_for_relative_paths() {
        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry);

        let work_dir = std::env::temp_dir().join(format!("pipi-registry-write-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should be created");

        let mut request = make_request(
            "write_file",
            serde_json::json!({
                "path": "notes.txt",
                "content": "hello"
            }),
        );
        request.work_dir = Some(work_dir.to_string_lossy().to_string());
        request.source = super::super::ToolExecutionSource::AssistantToolCall;

        let result = registry
            .execute_with_context(&request, None)
            .await
            .expect("execution should succeed");

        assert!(!result.is_error);
        assert!(work_dir.join("notes.txt").exists());

        let _ = std::fs::remove_dir_all(work_dir);
    }
}
