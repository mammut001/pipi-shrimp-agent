/**
 * Response models for Tauri commands
 *
 * Defines all response types that are sent back to the frontend
 */
use serde::Serialize;

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolExecutionStatus {
    Validating,
    AwaitingConfirmation,
    Approved,
    Rejected,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    TimedOut,
}

/**
 * Response for send_message command
 */
#[derive(Debug, Serialize)]
pub struct SendMessageResponse {
    pub id: String,
    pub content: String,
    pub artifacts: Vec<ArtifactResponse>,
}

/**
 * Artifact response (code, HTML, SVG, etc.)
 */
#[derive(Debug, Serialize)]
pub struct ArtifactResponse {
    #[serde(rename = "type")]
    pub artifact_type: String, // html, svg, mermaid, react
    pub content: String,
    pub title: Option<String>,
}

/**
 * Response for code execution commands
 */
#[derive(Debug, Serialize)]
pub struct ExecuteCodeResponse {
    pub execution_id: String,
    pub status: ToolExecutionStatus,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    pub output_truncated: bool,
    pub sanitized: bool,
    pub timed_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelToolExecutionResponse {
    pub execution_id: String,
    pub cancelled: bool,
    pub status: String,
    pub message: String,
}

/**
 * Response for file operations
 */
#[derive(Debug, Serialize)]
pub struct FileResponse {
    pub content: String,
    pub path: String,
}

/**
 * Response for web automation
 */
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct WebAutomationResponse {
    pub success: bool,
    pub result: String,
}

/**
 * Error response for failed commands
 */
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

/**
 * Response for Claude execute command
 */
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct ClaudeExecuteResponse {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/**
 * Response for Claude chat command
 */
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct ClaudeChatResponse {
    pub message: String,
}

/**
 * Claude availability response
 */
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct ClaudeAvailabilityResponse {
    pub available: bool,
    pub version: Option<String>,
}
