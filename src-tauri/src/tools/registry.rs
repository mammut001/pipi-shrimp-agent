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

use super::{ToolCallRequest, ToolCallResult, ToolMetadata};
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

    /// Execute a single tool call request
    pub fn execute(&self, req: &ToolCallRequest) -> anyhow::Result<ToolCallResult> {
        let entry = self
            .tools
            .get(&req.name)
            .ok_or_else(|| anyhow::anyhow!("Unknown tool: {}", req.name))?;

        let args: serde_json::Value = serde_json::from_str(&req.arguments).map_err(|e| {
            anyhow::anyhow!("Invalid JSON arguments for tool '{}': {}", req.name, e)
        })?;

        // Schema validation
        if let Some(schema) = &entry.compiled_schema {
            if let Err(errors) = schema.validate(&args) {
                let error_msgs: Vec<String> =
                    errors.map(|e: ValidationError| format!("{}", e)).collect();
                return Ok(ToolCallResult {
                    id: req.id.clone(),
                    name: req.name.clone(),
                    content: format!(
                        "Schema validation failed for tool '{}': {}",
                        req.name,
                        error_msgs.join("; ")
                    ),
                    is_error: true,
                });
            }
        }

        match (entry.handler)(args) {
            Ok(content) => Ok(ToolCallResult {
                id: req.id.clone(),
                name: req.name.clone(),
                content,
                is_error: false,
            }),
            Err(e) => Ok(ToolCallResult {
                id: req.id.clone(),
                name: req.name.clone(),
                content: format!("Error: {}", e),
                is_error: true,
            }),
        }
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

/// Register all built-in tools
pub fn register_builtin_tools(registry: &mut ToolRegistry) {
    // --- read_file ---
    registry.register(
        "read_file",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
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
            {
                if let Ok(entry) = entry {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let is_dir = entry.path().is_dir();
                    let prefix = if is_dir { "📁 " } else { "📄 " };
                    entries.push(format!("{}{}", prefix, name));
                }
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
}
