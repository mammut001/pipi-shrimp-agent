//! Unit tests for registry.rs moved verbatim out of registry.rs.

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

    let work_dir = std::env::temp_dir().join(format!("pipi-bootstrap-registry-{}", Uuid::new_v4()));
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

    assert!(
        !result.is_error,
        "scaffold_generate failed: {}",
        result.content
    );
    assert!(result.content.contains("python-ml-baseline"));
    assert!(work_dir.join("run_experiment.py").exists());
    assert!(work_dir.join("AUTORESEARCH.md").exists());

    let train_path = work_dir.join("train.py");
    std::fs::write(&train_path, "# KEEP-TRAIN-MARKER\n").expect("seed train.py");
    let second = registry
        .execute_with_context(&request, None)
        .await
        .expect("second scaffold should succeed");
    assert!(
        !second.is_error,
        "second scaffold_generate failed: {}",
        second.content
    );
    assert!(second.content.contains("\"skippedExisting\""));
    assert!(second.content.contains("train.py"));
    let preserved = std::fs::read_to_string(&train_path).expect("train.py should remain");
    assert_eq!(preserved, "# KEEP-TRAIN-MARKER\n");

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
async fn execute_with_context_consumes_approval_once_with_matching_session() {
    let mut registry = ToolRegistry::new();
    register_builtin_tools(&mut registry);

    let work_dir = std::env::temp_dir().join(format!("pipi-registry-approval-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir");

    let args = serde_json::json!({
        "command": "sleep 0",
        "cwd": work_dir.to_string_lossy(),
    });
    let mut request = make_request("execute_command", args.clone());
    request.work_dir = Some(work_dir.to_string_lossy().to_string());
    request.source = super::super::ToolExecutionSource::AssistantToolCall;

    let preview = crate::tools::execution_policy::preview_request_policy(
        &request,
        &args,
        Some("session-approval"),
    )
    .expect("preview should require confirmation for sleep");
    assert_eq!(preview.decision, "awaiting_confirmation");
    request.approval_token = preview.approval_token;

    let result = registry
        .execute_with_context(&request, Some("session-approval"))
        .await
        .expect("execute_with_context should return a result");

    assert!(
        !result.is_error,
        "matching session must not fail after Allow: {}",
        result.content
    );
    assert!(
        !result.content.contains("identity mismatch"),
        "double-validate with None must not surface session_id mismatch: {}",
        result.content
    );
    assert!(
        !result.content.contains("missing session_id"),
        "execute_with_context must pass session through: {}",
        result.content
    );

    let _ = std::fs::remove_dir_all(work_dir);
}

#[tokio::test]
async fn modern_single_tool_path_still_executes_read_file() {
    let mut registry = ToolRegistry::new();
    register_builtin_tools(&mut registry);

    let work_dir = std::env::temp_dir().join(format!("pipi-registry-read-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");
    let file_path = work_dir.join("sample.txt");
    std::fs::write(&file_path, "hello registry").expect("sample file should exist");

    let mut request = make_request("read_file", serde_json::json!({ "path": "sample.txt" }));
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

#[test]
fn test_barrier_tool_runtime_metadata_is_cancellable_and_concurrent() {
    let mut registry = ToolRegistry::new();
    register_builtin_tools(&mut registry);

    assert!(registry.is_registered("test_barrier_tool"));
    assert!(registry.is_concurrency_safe("test_barrier_tool"));
    assert!(!registry.is_read_only("test_barrier_tool"));

    let schema = registry
        .get_anthropic_tools_schema()
        .into_iter()
        .find(|s| s.get("name").and_then(|v| v.as_str()) == Some("test_barrier_tool"))
        .expect("schema present");
    let meta = crate::tools::build_tool_runtime_metadata(
        "test_barrier_tool".to_string(),
        schema
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        registry.is_read_only("test_barrier_tool"),
        registry.is_concurrency_safe("test_barrier_tool"),
        schema
            .get("input_schema")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "type": "object" })),
    );
    assert!(meta.cancellable);
    assert!(meta.is_concurrency_safe);
    assert!(!meta.requires_workspace);
    assert_eq!(
        meta.concurrency_class,
        crate::tools::ToolConcurrencyClass::Concurrent
    );
    assert_eq!(meta.default_timeout_ms, 300_000);
}
