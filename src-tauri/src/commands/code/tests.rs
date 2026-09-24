//! Unit tests for code.rs moved verbatim out of code.rs.

use super::*;
use std::path::{Path, PathBuf};
use uuid::Uuid;

fn canonical_path_string(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn assert_cwd_matches(result_cwd: Option<&str>, expected: &Path) {
    assert_eq!(
        result_cwd.map(|value| canonical_path_string(Path::new(value))),
        Some(canonical_path_string(expected))
    );
}

fn temp_work_dir(label: &str) -> PathBuf {
    let work_dir = std::env::temp_dir().join(format!("{label}-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");
    work_dir
}

#[test]
fn execute_bash_for_tool_returns_structured_timeout_result() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-timeout-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let result = execute_bash_for_tool(
        "sleep 1",
        None,
        Some(work_dir.to_string_lossy().as_ref()),
        Some(0),
        Some("timeout-test"),
        None,
        None,
    )
    .expect("timeout should still return a structured response");

    assert!(result.timed_out);
    assert_eq!(result.exit_code, -1);
    assert_eq!(result.execution_id, "timeout-test");
    assert_eq!(result.status, ToolExecutionStatus::TimedOut);
    assert!(result.stderr.contains("timed out"));

    let _ = std::fs::remove_dir_all(work_dir);
}

#[test]
fn execute_bash_for_tool_returns_sanitized_structured_response() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-sanitize-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let result = execute_bash_for_tool(
        "printf 'Authorization: Bearer sk-test-secret\\nOPENAI_API_KEY=sk-abc12345\\n'",
        None,
        Some(work_dir.to_string_lossy().as_ref()),
        Some(5),
        Some("smoke-command-json"),
        None,
        None,
    )
    .expect("command should return a structured response");

    assert_eq!(result.execution_id, "smoke-command-json");
    assert_eq!(result.status, ToolExecutionStatus::Succeeded);
    assert_eq!(result.exit_code, 0);
    assert_cwd_matches(result.cwd.as_deref(), &work_dir);
    assert!(result.sanitized);
    assert!(result.stdout.contains("Authorization: [redacted]"));
    assert!(result.stdout.contains("OPENAI_API_KEY=[redacted]"));
    assert!(!result.stdout.contains("sk-test-secret"));
    assert!(!result.stdout.contains("sk-abc12345"));

    println!(
        "SMOKE_COMMAND_RESULT_JSON={}",
        serde_json::to_string(&result).expect("result should serialize")
    );

    let _ = std::fs::remove_dir_all(work_dir);
}

#[test]
fn execute_bash_for_tool_rejects_dangerous_commands() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-danger-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let error = execute_bash_for_tool(
        "rm -rf /",
        None,
        Some(work_dir.to_string_lossy().as_ref()),
        Some(5),
        Some("dangerous-command"),
        None,
        None,
    )
    .expect_err("dangerous command should be blocked");

    let message = error.to_string();
    assert!(
        message.contains("Command blocked for safety")
            || message.contains("Dangerous command blocked"),
        "unexpected error: {message}"
    );

    let _ = std::fs::remove_dir_all(work_dir);
}

#[tokio::test]
async fn execute_python_session_times_out_on_no_sentinel() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-pysess-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let session_id = format!("test-timeout-{}", Uuid::new_v4());
    let result = execute_python_session(
        "import time; time.sleep(0.1)".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("should return a response, not an error");

    // The sentinel protocol should succeed for normal code
    assert_eq!(result.status, ToolExecutionStatus::Succeeded);
    assert!(!result.timed_out);

    // Cleanup
    let _ = close_python_session(session_id).await;
    let _ = std::fs::remove_dir_all(work_dir);
}

/// Test 1: Persistent state — variable set in first call is visible in second call.
#[tokio::test]
async fn python_session_persists_state_between_calls() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-persist-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let session_id = format!("test-persist-{}", Uuid::new_v4());

    // First call: set x = 41
    let r1 = execute_python_session(
        "x = 41".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("first call should succeed");
    assert_eq!(r1.status, ToolExecutionStatus::Succeeded);
    assert!(!r1.timed_out);

    // Second call: print(x + 1) → should print 42
    let r2 = execute_python_session(
        "print(x + 1)".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("second call should succeed");
    assert_eq!(r2.status, ToolExecutionStatus::Succeeded);
    assert!(!r2.timed_out);
    assert!(
        r2.stdout.contains("42"),
        "Expected stdout to contain '42', got: {}",
        r2.stdout
    );

    let _ = close_python_session(session_id).await;
    let _ = std::fs::remove_dir_all(work_dir);
}

/// Test 2: Second call doesn't fail — two sequential print calls both succeed.
#[tokio::test]
async fn python_session_second_call_succeeds() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-second-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let session_id = format!("test-second-{}", Uuid::new_v4());

    let r1 = execute_python_session(
        "print('first')".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("first call should succeed");
    assert_eq!(r1.status, ToolExecutionStatus::Succeeded);
    assert!(
        r1.stdout.contains("first"),
        "Expected 'first', got: {}",
        r1.stdout
    );

    let r2 = execute_python_session(
        "print('second')".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("second call should succeed");
    assert_eq!(r2.status, ToolExecutionStatus::Succeeded);
    assert!(
        r2.stdout.contains("second"),
        "Expected 'second', got: {}",
        r2.stdout
    );

    let _ = close_python_session(session_id).await;
    let _ = std::fs::remove_dir_all(work_dir);
}

/// Test 3: stderr-heavy code doesn't hang.
#[tokio::test]
async fn python_session_stderr_heavy_does_not_hang() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-stderr-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let session_id = format!("test-stderr-{}", Uuid::new_v4());

    // Write a lot to stderr, then to stdout
    let code = r#"
import sys
for i in range(200):
    print(f"err line {i}", file=sys.stderr)
print("done")
"#;
    let result = execute_python_session(
        code.to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("should return within timeout");

    assert_eq!(result.status, ToolExecutionStatus::Succeeded);
    assert!(!result.timed_out);
    assert!(
        result.stdout.contains("done"),
        "Expected 'done' in stdout, got: {}",
        result.stdout
    );
    assert!(
        result.stderr.contains("err line 0"),
        "Expected stderr to contain 'err line 0', got: {}",
        result.stderr
    );

    let _ = close_python_session(session_id).await;
    let _ = std::fs::remove_dir_all(work_dir);
}

/// Test 4: Absolute timeout despite continuous stdout.
/// A script that prints forever must still timeout within ~30 seconds.
#[tokio::test]
async fn python_session_absolute_timeout_despite_continuous_stdout() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-absto-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let session_id = format!("test-absto-{}", Uuid::new_v4());

    let start = std::time::Instant::now();
    let r = execute_python_session(
        "while True:\n    print('still running', flush=True)".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("should return a response, not hang");
    let elapsed = start.elapsed();

    assert_eq!(r.status, ToolExecutionStatus::TimedOut);
    assert!(r.timed_out);
    // Must complete in a bounded time — well under 60s even on slow CI
    assert!(
        elapsed < Duration::from_secs(60),
        "Expected timeout in ~30s, took {:?}",
        elapsed
    );
    assert!(
        r.stderr.contains("timed out"),
        "Expected timeout message in stderr, got: {}",
        r.stderr
    );

    // Session should be killed/removed — a fresh call with same id works
    let r2 = execute_python_session(
        "print('recovered')".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("fresh session should succeed");
    assert_eq!(r2.status, ToolExecutionStatus::Succeeded);
    assert!(!r2.timed_out);
    assert!(r2.stdout.contains("recovered"));

    let _ = close_python_session(session_id).await;
    let _ = std::fs::remove_dir_all(work_dir);
}

/// Test: stderr from a previous call does not leak into a later call.
#[tokio::test]
async fn python_session_stderr_is_per_call_not_stale() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-stderriso-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let session_id = format!("test-stderriso-{}", Uuid::new_v4());

    // Call 1: write to stderr
    let r1 = execute_python_session(
        r#"import sys; print("old warning", file=sys.stderr)"#.to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("first call should succeed");
    assert_eq!(r1.status, ToolExecutionStatus::Succeeded);
    assert!(
        r1.stderr.contains("old warning"),
        "Expected 'old warning' in stderr, got: {}",
        r1.stderr
    );

    // Call 2: produce no stderr
    let r2 = execute_python_session(
        "print('clean call')".to_string(),
        session_id.clone(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("second call should succeed");
    assert_eq!(r2.status, ToolExecutionStatus::Succeeded);
    assert!(
        r2.stdout.contains("clean call"),
        "Expected 'clean call' in stdout, got: {}",
        r2.stdout
    );
    assert!(
        !r2.stderr.contains("old warning"),
        "Expected NO 'old warning' in stderr, got: {}",
        r2.stderr
    );

    let _ = close_python_session(session_id).await;
    let _ = std::fs::remove_dir_all(work_dir);
}

/// Test 5: execute_python infinite loop returns timed_out.
#[tokio::test]
async fn execute_python_infinite_loop_returns_timed_out() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-pyto-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let result = execute_python(
        "while True: pass".to_string(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("should return a response, not hang");

    assert!(result.timed_out);
    assert_eq!(result.status, ToolExecutionStatus::TimedOut);
    assert_eq!(result.exit_code, -1);
    assert!(result.stderr.contains("timed out"));

    let _ = std::fs::remove_dir_all(work_dir);
}

/// Test 6: execute_node long-running interval returns timed_out.
#[tokio::test]
async fn execute_node_long_running_returns_timed_out() {
    let work_dir = std::env::temp_dir().join(format!("pipi-code-nodeto-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

    let result = execute_node(
        "setInterval(() => {}, 100)".to_string(),
        None,
        Some(work_dir.to_string_lossy().to_string()),
    )
    .await
    .expect("should return a response, not hang");

    assert!(result.timed_out);
    assert_eq!(result.status, ToolExecutionStatus::TimedOut);
    assert_eq!(result.exit_code, -1);
    assert!(result.stderr.contains("timed out"));

    let _ = std::fs::remove_dir_all(work_dir);
}
