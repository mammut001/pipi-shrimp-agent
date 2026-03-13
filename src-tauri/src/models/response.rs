/**
 * Response models for Tauri commands
 *
 * Defines all response types that are sent back to the frontend
 */

use serde::Serialize;

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
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
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
