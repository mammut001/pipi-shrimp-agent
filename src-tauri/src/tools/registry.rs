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
use super::{ToolCallRequest, ToolCallResult, ToolHandlerOutput, ToolMetadata, classify_tool_error_code};
use crate::tools::test_barrier;
use jsonschema::{JSONSchema, ValidationError};

mod builtin_bootstrap;
mod builtin_command;
mod builtin_fs;
mod builtin_search;

/// Tool handler: receives parsed JSON arguments, returns content + explicit terminal status.
pub type ToolHandler =
    Arc<dyn Fn(serde_json::Value) -> anyhow::Result<ToolHandlerOutput> + Send + Sync>;

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

    fn schema_validation_result(
        req: &ToolCallRequest,
        args: &serde_json::Value,
    ) -> Option<ToolCallResult> {
        if !args
            .get("__schema_validation_error")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            return None;
        }

        let error_msgs = args
            .get("messages")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .collect::<Vec<_>>()
            .join("; ");
        Some(ToolCallResult::error(
            req.id.clone(),
            req.name.clone(),
            format!(
                "Schema validation failed for tool '{}': {}",
                req.name, error_msgs
            ),
            Some("schema_validation".to_string()),
        ))
    }

    /// Run a sync registry handler with already-validated args.
    ///
    /// Must not re-enter `validate_request` / `enforce_request_policy`: approval
    /// tokens are one-shot, and a second enforce with `session_id: None` was
    /// producing "Approval token identity mismatch (session_id)" after Allow.
    fn dispatch_validated(
        &self,
        req: &ToolCallRequest,
        entry: &ToolEntry,
        args: serde_json::Value,
    ) -> anyhow::Result<ToolCallResult> {
        if let Some(result) = Self::schema_validation_result(req, &args) {
            return Ok(result);
        }

        if BOOTSTRAP_TOOL_NAMES.contains(&req.name.as_str()) {
            return Ok(ToolCallResult::error(
                req.id.clone(),
                req.name.clone(),
                format!(
                    "Error: bootstrap tool '{}' requires execute_with_context()",
                    req.name
                ),
                Some("invalid_arguments".to_string()),
            ));
        }

        match (entry.handler)(args) {
            Ok(output) => Ok(ToolCallResult::from_handler_output(
                req.id.clone(),
                req.name.clone(),
                output,
            )),
            Err(e) => {
                let code = classify_tool_error_code(&e.to_string()).to_string();
                Ok(ToolCallResult::error(
                    req.id.clone(),
                    req.name.clone(),
                    format!("Error: {}", e),
                    Some(code),
                ))
            }
        }
    }

    /// Execute a single tool call request
    pub fn execute(&self, req: &ToolCallRequest) -> anyhow::Result<ToolCallResult> {
        let (entry, args) = self.validate_request(req, None)?;
        self.dispatch_validated(req, entry, args)
    }

    pub async fn execute_with_context(
        &self,
        req: &ToolCallRequest,
        session_id: Option<&str>,
    ) -> anyhow::Result<ToolCallResult> {
        // Validate exactly once with the caller-provided session identity so
        // approval tokens stored at preview can be consumed here.
        let (entry, args) = self.validate_request(req, session_id)?;

        if let Some(result) = Self::schema_validation_result(req, &args) {
            return Ok(result);
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

            return match autoresearch_bootstrap::execute_tool(&req.name, &args, &context).await {
                Ok(Some(content)) => Ok(ToolCallResult::success(
                    req.id.clone(),
                    req.name.clone(),
                    content,
                )),
                Ok(None) => Ok(ToolCallResult::error(
                    req.id.clone(),
                    req.name.clone(),
                    format!("Error: Unknown tool: {}", req.name),
                    Some("not_found".to_string()),
                )),
                Err(error) => Ok(ToolCallResult::error(
                    req.id.clone(),
                    req.name.clone(),
                    format!("Error: {}", error),
                    Some(error.code.clone()),
                )),
            };
        }

        self.dispatch_validated(req, entry, args)
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
    builtin_fs::register_filesystem_tools(registry);
    builtin_search::register_search_files(registry);
    builtin_command::register_command_tools(registry);
    builtin_search::register_glob_and_grep(registry);
    builtin_bootstrap::register_bootstrap_tools(registry);

    // --- test_barrier_tool (Manual D deterministic harness) ---
    registry.register(
        "test_barrier_tool",
        Arc::new(|args| test_barrier::execute_test_barrier_tool(&args)),
        ToolMetadata {
            name: "test_barrier_tool".to_string(),
            description: "Deterministic Manual D harness: block until release_test_barrier(barrier_id) or cancel_tool_execution(executionId). Not for production agent use.".to_string(),
            is_read_only: false,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "barrier_id": {
                        "type": "string",
                        "description": "Barrier identifier shared with release_test_barrier."
                    },
                    "barrierId": {
                        "type": "string",
                        "description": "CamelCase alias for barrier_id."
                    },
                    "executionId": {
                        "type": "string",
                        "description": "Optional execution identifier used to cancel this wait via cancel_tool_execution."
                    },
                    "execution_id": {
                        "type": "string",
                        "description": "Legacy snake_case alias for executionId."
                    }
                },
                "required": ["barrier_id"],
                "additionalProperties": false,
            }),
        },
    );

}

#[cfg(test)]
mod tests;
