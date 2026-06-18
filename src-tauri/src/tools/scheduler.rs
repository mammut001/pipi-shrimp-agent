/**
 * Concurrent Tool Scheduler
 *
 * Partitions tool calls into batches based on concurrency safety,
 * then executes each batch appropriately:
 * - Concurrent-safe batches → parallel execution (join_all)
 * - Non-safe batches → serial execution
 *
 * Mirrors Claude Code's partitionToolCalls() + runToolsConcurrently()/runToolsSerially().
 *
 * Algorithm:
 *   Iterate tool calls. If current tool is concurrency-safe AND the last batch
 *   is also concurrency-safe, merge into the last batch. Otherwise, start a new batch.
 *
 * Example: [A(read), B(read), C(write), D(read)]
 *   → Batch 1: [A, B]  (concurrent-safe → parallel)
 *   → Batch 2: [C]     (not safe → serial)
 *   → Batch 3: [D]     (not safe because C broke the chain → serial)
 */
use tauri::Emitter;

use super::registry::ToolRegistry;
use super::{classify_tool_error_code, ToolCallRequest, ToolCallResult};

/// A batch of tool calls that share the same concurrency safety property
struct Batch {
    is_concurrency_safe: bool,
    requests: Vec<ToolCallRequest>,
}

/// Extract the `path` / `file_path` / `remotePath` argument from a tool
/// call. Returns `None` if the tool doesn't take a path or the value is
/// missing.
///
/// AUDIT-FIX [fix-3#14] — We need to break batches on shared paths because
/// two concurrent `read_file` calls on the same path are not safe (one may
/// be reading while the other is being modified) and a `read_file` /
/// `list_dir` on the same parent can also race.
fn extract_path_key(req: &ToolCallRequest) -> Option<String> {
    let args: serde_json::Value = serde_json::from_str(&req.arguments).ok()?;
    for key in ["path", "file_path", "filePath", "remotePath", "target"] {
        if let Some(p) = args.get(key).and_then(serde_json::Value::as_str) {
            return Some(p.to_string());
        }
    }
    None
}

/// Partition tool calls into batches based on concurrency safety.
///
/// This is the core scheduling algorithm. It ensures that:
/// 1. Consecutive read-only tools are batched together for parallel execution
/// 2. Any write/destructive tool breaks the chain and runs alone
/// 3. Tools after a write tool also run alone (conservative: write may change state
///    that subsequent reads depend on)
///
/// AUDIT-FIX [fix-3#14] — Two read-only tools that target the *same path*
/// must NOT be batched, because the registry may mutate state between
/// calls (e.g. a hook re-writes the file). We break the chain on path
/// collision only — different paths are still batched.
fn partition_tool_calls(requests: &[ToolCallRequest], registry: &ToolRegistry) -> Vec<Batch> {
    let mut batches: Vec<Batch> = Vec::new();

    for req in requests {
        let is_safe = registry.is_concurrency_safe(&req.name);
        let path = extract_path_key(req);
        let merges_into_last = is_safe
            && batches.last().is_some_and(|b| b.is_concurrency_safe)
            && batches.last().is_some_and(|b| {
                path.is_none()
                    || b.requests
                        .iter()
                        .all(|r| extract_path_key(r).as_deref() != path.as_deref())
            });

        if merges_into_last {
            batches.last_mut().unwrap().requests.push(req.clone());
        } else {
            batches.push(Batch {
                is_concurrency_safe: is_safe,
                requests: vec![req.clone()],
            });
        }
    }

    batches
}

/// Execute a single tool call, emitting events to the frontend
async fn execute_single(
    req: &ToolCallRequest,
    registry: &ToolRegistry,
    window: Option<&tauri::Window>,
    session_id: &str,
) -> ToolCallResult {
    // Emit tool-start event
    if let Some(w) = window {
        let _ = w.emit(
            "tool-start",
            serde_json::json!({
                "session_id": session_id,
                "tool_call_id": req.id,
                "name": req.name,
            }),
        );
    }

    let result = registry.execute_with_context(req, Some(session_id)).await;

    match result {
        Ok(tool_result) => {
            // Emit tool-complete event
            if let Some(w) = window {
                let _ = w.emit(
                    "tool-complete",
                    serde_json::json!({
                        "session_id": session_id,
                        "tool_call_id": tool_result.id,
                        "name": tool_result.name,
                        "is_error": tool_result.is_error,
                    }),
                );
            }
            tool_result
        }
        Err(e) => {
            let error_result = ToolCallResult {
                id: req.id.clone(),
                name: req.name.clone(),
                content: format!("Error: {}", e),
                is_error: true,
                error_code: Some(classify_tool_error_code(&e.to_string()).to_string()),
            };
            if let Some(w) = window {
                let _ = w.emit(
                    "tool-error",
                    serde_json::json!({
                        "session_id": session_id,
                        "tool_call_id": req.id,
                        "name": req.name,
                        "error": e.to_string(),
                    }),
                );
            }
            error_result
        }
    }
}

/// Execute a batch of tool calls.
/// Concurrent-safe batches run in parallel; non-safe batches run serially.
async fn execute_batch(
    batch: &Batch,
    registry: &ToolRegistry,
    window: Option<&tauri::Window>,
    session_id: &str,
) -> Vec<ToolCallResult> {
    if batch.is_concurrency_safe && batch.requests.len() > 1 {
        // Parallel execution: all read-only tools start simultaneously
        let futures: Vec<_> = batch
            .requests
            .iter()
            .map(|req| execute_single(req, registry, window, session_id))
            .collect();
        futures::future::join_all(futures).await
    } else {
        // Serial execution: one at a time (either non-safe or single tool)
        let mut results = Vec::new();
        for req in &batch.requests {
            let result = execute_single(req, registry, window, session_id).await;
            results.push(result);
        }
        results
    }
}

/// Execute all tool calls with concurrency control.
///
/// This is the main entry point for tool execution.
/// Returns results in the same order as the input requests.
pub async fn execute_tool_calls(
    requests: &[ToolCallRequest],
    registry: &ToolRegistry,
    window: Option<&tauri::Window>,
    session_id: &str,
) -> Vec<ToolCallResult> {
    if requests.is_empty() {
        return Vec::new();
    }

    let batches = partition_tool_calls(requests, registry);
    let mut all_results = Vec::new();

    for batch in batches {
        let results = execute_batch(&batch, registry, window, session_id).await;
        all_results.extend(results);
    }

    all_results
}

#[cfg(test)]
mod tests {
    use super::super::ToolMetadata;
    use super::*;
    use std::sync::Arc;

    fn make_registry() -> ToolRegistry {
        let mut reg = ToolRegistry::new();
        reg.register(
            "read_file",
            Arc::new(|_| Ok("content".to_string())),
            ToolMetadata {
                name: "read_file".to_string(),
                description: "Read a file".to_string(),
                is_read_only: true,
                is_concurrency_safe: true,
                input_schema: serde_json::json!({}),
            },
        );
        reg.register(
            "write_file",
            Arc::new(|_| Ok("ok".to_string())),
            ToolMetadata {
                name: "write_file".to_string(),
                description: "Write a file".to_string(),
                is_read_only: false,
                is_concurrency_safe: false,
                input_schema: serde_json::json!({}),
            },
        );
        reg.register(
            "list_files",
            Arc::new(|_| Ok("files".to_string())),
            ToolMetadata {
                name: "list_files".to_string(),
                description: "List files".to_string(),
                is_read_only: true,
                is_concurrency_safe: true,
                input_schema: serde_json::json!({}),
            },
        );
        reg
    }

    #[test]
    fn test_partition_all_read_only() {
        let reg = make_registry();
        let requests = vec![
            ToolCallRequest {
                id: "1".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
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
            },
            ToolCallRequest {
                id: "2".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
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
            },
            ToolCallRequest {
                id: "3".into(),
                name: "list_files".into(),
                arguments: "{}".into(),
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
            },
        ];
        let batches = partition_tool_calls(&requests, &reg);
        assert_eq!(
            batches.len(),
            1,
            "All read-only tools should be in one batch"
        );
        assert!(batches[0].is_concurrency_safe);
        assert_eq!(batches[0].requests.len(), 3);
    }

    #[test]
    fn test_partition_mixed() {
        let reg = make_registry();
        let requests = vec![
            ToolCallRequest {
                id: "1".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
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
            },
            ToolCallRequest {
                id: "2".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
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
            },
            ToolCallRequest {
                id: "3".into(),
                name: "write_file".into(),
                arguments: "{}".into(),
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
            },
            ToolCallRequest {
                id: "4".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
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
            },
        ];
        let batches = partition_tool_calls(&requests, &reg);
        assert_eq!(batches.len(), 3, "write_file should break the chain");
        assert!(batches[0].is_concurrency_safe);
        assert_eq!(batches[0].requests.len(), 2);
        assert!(!batches[1].is_concurrency_safe);
        assert_eq!(batches[1].requests.len(), 1);
        assert!(!batches[2].is_concurrency_safe); // D is alone because C broke the chain
        assert_eq!(batches[2].requests.len(), 1);
    }

    #[test]
    fn test_partition_all_write() {
        let reg = make_registry();
        let requests = vec![
            ToolCallRequest {
                id: "1".into(),
                name: "write_file".into(),
                arguments: "{}".into(),
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
            },
            ToolCallRequest {
                id: "2".into(),
                name: "write_file".into(),
                arguments: "{}".into(),
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
            },
        ];
        let batches = partition_tool_calls(&requests, &reg);
        assert_eq!(
            batches.len(),
            2,
            "Each write tool should be in its own batch"
        );
        assert!(!batches[0].is_concurrency_safe);
        assert!(!batches[1].is_concurrency_safe);
    }
}
