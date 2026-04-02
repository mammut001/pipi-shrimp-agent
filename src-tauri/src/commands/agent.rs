/**
 * Agent Commands
 *
 * Exposes multi-agent capabilities to the frontend via Tauri invoke.
 * Subagents use the same ClaudeClient as the main chat, but with:
 * - Isolated session IDs
 * - Custom system prompts
 * - Optional background execution
 */

use crate::claude::{ClaudeClient, Message};
use tauri::Emitter;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;
use std::sync::Arc;
use std::collections::HashMap;

/// Agent request from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRequest {
    pub name: String,
    pub prompt: String,
    pub description: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "runInBackground")]
    pub run_in_background: bool,
    #[serde(rename = "subagentType")]
    pub subagent_type: Option<String>,
    pub model: Option<String>,
    #[serde(rename = "teamName")]
    pub team_name: Option<String>,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "baseUrl")]
    pub base_url: Option<String>,
    #[serde(rename = "systemPrompt")]
    pub system_prompt: Option<String>,
}

/// Agent response to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub agent_id: String,
    pub success: bool,
    pub content: String,
    pub error: Option<String>,
}

/// Agent state store
pub struct AgentState {
    pub agents: Arc<Mutex<HashMap<String, AgentResponse>>>,
}

/**
 * Run an agent (sync or background).
 */
#[tauri::command]
pub async fn run_agent(
    request: AgentRequest,
    state: State<'_, AgentState>,
    window: tauri::Window,
) -> Result<AgentResponse, String> {
    let agent_id = format!("agent-{}", uuid::Uuid::new_v4());

    if request.run_in_background {
        // Background mode: spawn and return immediately
        let window_clone = window.clone();
        let agent_id_clone = agent_id.clone();
        let request_clone = request.clone();
        let agents = state.agents.clone();

        tokio::spawn(async move {
            let result = execute_agent(&request_clone).await;

            // Store result
            {
                let mut guard = agents.lock().await;
                guard.insert(agent_id_clone.clone(), result.clone());
            }

            // Emit completion event
            let _ = window_clone.emit("agent-complete", serde_json::json!({
                "agent_id": agent_id_clone,
                "session_id": request_clone.session_id,
                "content": result.content,
                "success": result.success,
                "error": result.error,
            }));
        });

        Ok(AgentResponse {
            agent_id,
            success: true,
            content: String::new(),
            error: None,
        })
    } else {
        // Sync mode: await result
        let result = execute_agent(&request).await;

        // Store result
        {
            let mut guard = state.agents.lock().await;
            guard.insert(agent_id.clone(), result.clone());
        }

        Ok(AgentResponse {
            agent_id,
            success: result.success,
            content: result.content,
            error: result.error,
        })
    }
}

/**
 * Get agent result by ID.
 */
#[tauri::command]
pub async fn get_agent_result(
    agent_id: String,
    state: State<'_, AgentState>,
) -> Result<Option<AgentResponse>, String> {
    let guard = state.agents.lock().await;
    Ok(guard.get(&agent_id).cloned())
}

/**
 * Execute an agent's task by calling the Claude API.
 *
 * Creates a fresh ClaudeClient for each subagent call.
 * Subagents use non-streaming mode since they don't need real-time UI updates.
 */
async fn execute_agent(request: &AgentRequest) -> AgentResponse {
    let api_key = request.api_key.clone().unwrap_or_default();
    let model = request.model.clone().unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
    let base_url = request.base_url.clone();

    // Build subagent system prompt
    let system_prompt = request.system_prompt.clone().unwrap_or_else(|| {
        build_subagent_system_prompt(request)
    });

    // Build messages
    let messages = vec![Message {
        role: "user".to_string(),
        content: request.prompt.clone(),
        tool_calls: None,
        tool_call_id: None,
    }];

    // Create a fresh client for this subagent call
    let client = ClaudeClient::new();

    // Call the API (non-streaming for subagents)
    match client.chat(
        messages,
        api_key,
        model,
        base_url,
        Some(system_prompt),
        false, // browser_connected
    ).await {
        Ok(response) => AgentResponse {
            agent_id: String::new(),
            success: true,
            content: response.content,
            error: None,
        },
        Err(e) => AgentResponse {
            agent_id: String::new(),
            success: false,
            content: String::new(),
            error: Some(format!("API error: {}", e)),
        },
    }
}

/**
 * Build a system prompt for a subagent.
 */
fn build_subagent_system_prompt(request: &AgentRequest) -> String {
    let mut prompt = String::from(
        "You are a specialized AI assistant working on a specific task.\n\n",
    );

    if !request.description.is_empty() {
        prompt.push_str(&format!("## Your Role\n{}\n\n", request.description));
    }

    prompt.push_str("## Instructions\n");
    prompt.push_str("1. Focus only on the task described above\n");
    prompt.push_str("2. Provide a complete, self-contained response\n");
    prompt.push_str("3. If you need to use tools, use them to complete the task\n");
    prompt.push_str("4. Summarize your findings or work at the end\n");

    if let Some(team_name) = &request.team_name {
        prompt.push_str(&format!("\n## Team\nYou are part of team '{}'.\n", team_name));
    }

    prompt
}
