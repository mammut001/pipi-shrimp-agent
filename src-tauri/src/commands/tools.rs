/**
 * Tool execution Tauri commands
 *
 * Exposes the tool pipeline to the frontend via Tauri invoke.
 */

use crate::tools::{ToolCallRequest, ToolCallResult};
use tauri::State;
use tokio::sync::Mutex;
use std::sync::Arc;

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
    ).await;
    Ok(results)
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
    state: State<'_, ToolRegistryState>,
) -> Result<ToolCallResult, String> {
    let req = ToolCallRequest {
        id: toolCallId,
        name,
        arguments,
    };

    let registry = state.0.lock().await;
    registry.execute(&req).map_err(|e| e.to_string())
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
