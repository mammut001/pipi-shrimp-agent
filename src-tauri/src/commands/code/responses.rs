use crate::models::{ExecuteCodeResponse, ToolExecutionStatus};
use crate::tools::output_sanitizer::sanitize_execute_code_output;

pub(super) fn build_execute_code_response(
    stdout: &[u8],
    stderr: &[u8],
    exit_code: i32,
    cwd: Option<&str>,
    timed_out: bool,
    execution_id: &str,
    status: ToolExecutionStatus,
) -> ExecuteCodeResponse {
    sanitize_execute_code_output(
        stdout,
        stderr,
        exit_code,
        cwd,
        timed_out,
        execution_id,
        status,
    )
}

pub(super) fn build_failed_command_response(
    message: &str,
    cwd: Option<&str>,
    execution_id: Option<&str>,
) -> ExecuteCodeResponse {
    let execution_id = execution_id
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    build_execute_code_response(
        b"",
        message.as_bytes(),
        -1,
        cwd,
        false,
        execution_id.as_str(),
        ToolExecutionStatus::Failed,
    )
}

pub(super) fn append_warning(stderr: &mut Vec<u8>, warning: &str) {
    if warning.trim().is_empty() {
        return;
    }
    if !stderr.is_empty() && !stderr.ends_with(b"\n") {
        stderr.push(b'\n');
    }
    stderr.extend_from_slice(warning.as_bytes());
}
