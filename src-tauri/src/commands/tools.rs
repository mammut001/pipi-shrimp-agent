/**
 * Tool execution Tauri commands
 *
 * Exposes the tool pipeline to the frontend via Tauri invoke.
 */
use crate::models::CancelToolExecutionResponse;
use crate::tools::execution_policy::{self, ToolPolicyPreview};
use crate::tools::process_manager;
use crate::tools::{
    build_tool_runtime_metadata, classify_tool_error_code, ToolCallRequest, ToolCallResult,
    ToolExecutionSource,
};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub(crate) fn resolve_execute_single_tool_session_id(
    source: ToolExecutionSource,
    session_id: Option<&str>,
) -> Result<Option<&str>, String> {
    let trimmed = session_id.map(str::trim).filter(|value| !value.is_empty());

    match source {
        ToolExecutionSource::AssistantToolCall
        | ToolExecutionSource::UserRequestedCommand
        | ToolExecutionSource::ManualTerminal => trimmed
            .ok_or_else(|| {
                format!(
                    "session_id is required for execute_single_tool from {}",
                    source.as_str()
                )
            })
            .map(Some),
        ToolExecutionSource::AutoresearchPhase
        | ToolExecutionSource::HeadlessAgent
        | ToolExecutionSource::WorkflowAgent => Ok(trimmed),
        ToolExecutionSource::Unknown => trimmed
            .ok_or_else(|| {
                "session_id is required for execute_single_tool with unknown execution source"
                    .to_string()
            })
            .map(Some),
    }
}

/// Shared state carrying the tool registry
pub struct ToolRegistryState(pub Arc<Mutex<crate::tools::registry::ToolRegistry>>);

/**
 * Execute a batch of tool calls with concurrency control.
 *
 * This is the primary entry point for tool execution from the frontend.
 * The Rust side handles:
 * - Tool lookup and validation
 * - Concurrency partitioning (read-only tools run in parallel)
 * - Event emission (tool-start, tool-complete, tool-error)
 */
#[tauri::command]
pub async fn execute_tool_batch(
    #[allow(non_snake_case)] toolCalls: Vec<ToolCallRequest>,
    #[allow(non_snake_case)] sessionId: String,
    state: State<'_, ToolRegistryState>,
    window: tauri::Window,
) -> Result<Vec<ToolCallResult>, String> {
    let registry = state.0.lock().await;
    let results = crate::tools::scheduler::execute_tool_calls(
        &toolCalls,
        &registry,
        Some(&window),
        &sessionId,
    )
    .await;
    Ok(results)
}

#[tauri::command]
pub async fn preview_tool_policy(
    tool_call: ToolCallRequest,
    #[allow(non_snake_case)] sessionId: String,
) -> Result<ToolPolicyPreview, String> {
    let args: serde_json::Value = serde_json::from_str(&tool_call.arguments)
        .map_err(|e| format!("Invalid tool arguments: {}", e))?;
    execution_policy::preview_request_policy(&tool_call, &args, Some(&sessionId))
        .map_err(|e| e.to_string())
}

/**
 * Execute a single tool call.
 *
 * Used by the frontend for individual tool execution.
 */
#[tauri::command]
pub async fn execute_single_tool(
    #[allow(non_snake_case)] toolCallId: String,
    name: String,
    arguments: String,
    #[allow(non_snake_case)] workDir: Option<String>,
    source: Option<crate::tools::ToolExecutionSource>,
    #[allow(non_snake_case)] allowedTools: Option<Vec<String>>,
    #[allow(non_snake_case)] apiKey: Option<String>,
    model: Option<String>,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    provider: Option<String>,
    #[allow(non_snake_case)] apiFormat: Option<String>,
    #[allow(non_snake_case)] providerCapabilities: Option<
        crate::claude::provider::ProviderCapabilities,
    >,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    #[allow(non_snake_case)] executionMode: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    state: State<'_, ToolRegistryState>,
) -> Result<ToolCallResult, String> {
    let source_value = source.unwrap_or_default();
    let session_id_ref = match resolve_execute_single_tool_session_id(
        source_value,
        sessionId.as_deref(),
    ) {
        Ok(value) => value,
        Err(message) => {
            return Ok(ToolCallResult {
                id: toolCallId.clone(),
                name: name.clone(),
                content: format!("Error: {}", message),
                is_error: true,
                error_code: Some("invalid_arguments".to_string()),
            });
        }
    };

    let req = ToolCallRequest {
        id: toolCallId,
        name,
        arguments,
        work_dir: workDir,
        source: source_value,
        allowed_tools: allowedTools,
        api_key: apiKey,
        model,
        base_url: baseUrl,
        provider,
        api_format: apiFormat,
        provider_capabilities: providerCapabilities,
        approval_token: approvalToken,
        execution_mode: executionMode,
    };

    let registry = state.0.lock().await;
    match registry.execute_with_context(&req, session_id_ref).await {
        Ok(result) => Ok(result),
        Err(error) => Ok(ToolCallResult {
            id: req.id,
            name: req.name,
            content: format!("Error: {}", error),
            is_error: true,
            error_code: Some(classify_tool_error_code(&error.to_string()).to_string()),
        }),
    }
}

/**
 * Get available tool definitions from the authoritative Rust registry.
 *
 * Existing callers receive the Anthropic-compatible schema. Runtime clients
 * can request the expanded metadata view with includeRuntimeMetadata=true;
 * this keeps one command/registry authority while preserving API compatibility.
 */
#[tauri::command]
pub async fn get_available_tools(
    #[allow(non_snake_case)] includeRuntimeMetadata: Option<bool>,
    state: State<'_, ToolRegistryState>,
) -> Result<Vec<serde_json::Value>, String> {
    let registry = state.0.lock().await;
    let schemas = registry.get_anthropic_tools_schema();

    if !includeRuntimeMetadata.unwrap_or(false) {
        return Ok(schemas);
    }

    let mut metadata = schemas
        .into_iter()
        .filter_map(|schema| {
            let name = schema.get("name")?.as_str()?.to_string();
            let description = schema
                .get("description")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string();
            let input_schema = schema
                .get("input_schema")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({ "type": "object" }));
            let runtime_metadata = build_tool_runtime_metadata(
                name.clone(),
                description,
                registry.is_read_only(&name),
                registry.is_concurrency_safe(&name),
                input_schema,
            );
            serde_json::to_value(runtime_metadata).ok()
        })
        .collect::<Vec<_>>();

    metadata.sort_by(|left, right| {
        left.get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .cmp(
                right
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
            )
    });

    Ok(metadata)
}

#[tauri::command]
pub async fn cancel_tool_execution(
    #[allow(non_snake_case)] executionId: String,
) -> Result<CancelToolExecutionResponse, String> {
    process_manager::cancel_execution(&executionId)
        .map_err(|e| e.to_string())
        .map(|result| CancelToolExecutionResponse {
            execution_id: result.execution_id,
            cancelled: result.cancelled,
            status: result.status,
            message: result.message,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::execution_policy::{enforce_request_policy, preview_request_policy};

    #[test]
    fn resolve_execute_single_tool_session_id_requires_assistant_session() {
        let error = resolve_execute_single_tool_session_id(
            ToolExecutionSource::AssistantToolCall,
            None,
        )
        .expect_err("assistant tool calls must include session_id");

        assert!(error.contains("session_id is required"));
        assert!(error.contains("assistant_tool_call"));
    }

    #[test]
    fn resolve_execute_single_tool_session_id_allows_autoresearch_optional() {
        assert_eq!(
            resolve_execute_single_tool_session_id(ToolExecutionSource::AutoresearchPhase, None)
                .expect("autoresearch phase may omit session_id"),
            None
        );
        assert_eq!(
            resolve_execute_single_tool_session_id(
                ToolExecutionSource::AutoresearchPhase,
                Some("run-42"),
            )
            .expect("autoresearch phase accepts explicit session_id"),
            Some("run-42")
        );
    }

    #[test]
    fn approval_token_consumption_requires_matching_session_id() {
        let mut request = ToolCallRequest {
            id: "tool-approval".to_string(),
            name: "execute_command".to_string(),
            arguments: serde_json::json!({
                "command": "curl https://example.com",
                "cwd": "/tmp/project"
            })
            .to_string(),
            work_dir: Some("/tmp/project".to_string()),
            source: ToolExecutionSource::AssistantToolCall,
            allowed_tools: None,
            api_key: None,
            model: None,
            base_url: None,
            provider: None,
            api_format: None,
            provider_capabilities: None,
            approval_token: None,
            execution_mode: None,
        };
        let args = serde_json::json!({
            "command": "curl https://example.com",
            "cwd": "/tmp/project"
        });

        let preview = preview_request_policy(&request, &args, Some("session-a"))
            .expect("preview should succeed");
        let token = preview
            .approval_token
            .clone()
            .expect("preview should issue approval token");

        request.approval_token = Some(token.clone());
        let wrong_session_error =
            enforce_request_policy(&request, &args, Some("session-b")).expect_err(
                "wrong session must not consume token",
            );
        assert!(wrong_session_error.to_string().contains("approval"));

        request.approval_token = Some(token.clone());
        enforce_request_policy(&request, &args, Some("session-a"))
            .expect("matching session should consume token");

        request.approval_token = Some(token);
        let replay_error = enforce_request_policy(&request, &args, Some("session-a"))
            .expect_err("token is single-use");
        assert!(replay_error.to_string().contains("approval"));

        let second_preview = preview_request_policy(&request, &args, Some("session-a"))
            .expect("second preview should succeed");
        request.approval_token = second_preview.approval_token;
        let missing_session_error = enforce_request_policy(&request, &args, None).expect_err(
            "missing session_id must not consume token",
        );
        assert!(missing_session_error.to_string().contains("approval"));
    }
}
