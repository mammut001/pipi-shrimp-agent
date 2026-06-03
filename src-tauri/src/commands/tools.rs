/**
 * Tool execution Tauri commands
 *
 * Exposes the tool pipeline to the frontend via Tauri invoke.
 */
use crate::models::CancelToolExecutionResponse;
use crate::tools::execution_policy::{self, ToolPolicyPreview};
use crate::tools::process_manager;
use crate::tools::{classify_tool_error_code, ToolCallRequest, ToolCallResult};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

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
 *
 * AUDIT-2026-06-02 (boundary): the previous implementation called
 * `execute_with_context(&req, None)`. With `None`, `consume_matching_approval`
 * cannot match the approval token that the frontend just obtained from
 * `preview_tool_policy`, so every tool that required explicit confirmation
 * failed with a "requires confirmation" error even after the user clicked
 * approve. We now accept the `sessionId` and forward it.
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
    #[allow(non_snake_case)] providerCapabilities: Option<crate::claude::provider::ProviderCapabilities>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    state: State<'_, ToolRegistryState>,
) -> Result<ToolCallResult, String> {
    let req = ToolCallRequest {
        id: toolCallId,
        name,
        arguments,
        work_dir: workDir,
        source: source.unwrap_or_default(),
        allowed_tools: allowedTools,
        api_key: apiKey,
        model,
        base_url: baseUrl,
        provider,
        api_format: apiFormat,
        provider_capabilities: providerCapabilities,
        approval_token: approvalToken,
    };

    let registry = state.0.lock().await;
    match registry
        .execute_with_context(&req, sessionId.as_deref())
        .await
    {
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
 * Get the list of available tools and their metadata.
 *
 * Used by the frontend to build the tool list for the API request.
 */
#[tauri::command]
pub async fn get_available_tools(
    state: State<'_, ToolRegistryState>,
) -> Result<Vec<serde_json::Value>, String> {
    let registry = state.0.lock().await;
    Ok(registry.get_anthropic_tools_schema())
}

#[tauri::command]
pub async fn cancel_tool_execution(
    #[allow(non_snake_case)] executionId: String,
) -> Result<CancelToolExecutionResponse, String> {
    process_manager::cancel_execution(&executionId).map_err(|e| e.to_string()).map(|result| CancelToolExecutionResponse {
        execution_id: result.execution_id,
        cancelled: result.cancelled,
        status: result.status,
        message: result.message,
    })
}
