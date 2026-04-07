/**
 * Compact Commands - Context Compression System
 * 
 * Layer 1: Microcompact - 工具结果清除
 * 
 * 源码参考: 
 * - restored-src/src/services/compact/microCompact.ts
 * - restored-src/src/services/compact/compact.ts
 */

use crate::database;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * 估算文本 token 数
 * 
 * 参考: roughTokenCountEstimation() 在 tokenEstimation.ts
 * - ASCII/英文: ~4 字符/token
 * - CJK (中日韩): ~2 字符/token
 */
#[command]
pub fn estimate_tokens(text: &str) -> usize {
    crate::utils::token::estimate_tokens(text).max(0) as usize
}

/**
 * 估算消息数组的总 token 数
 * 
 * 参考: estimateMessageTokens() 在 microCompact.ts
 * - content 文本
 * - tool_calls JSON（assistant 消息）
 * - reasoning（assistant 消息）
 * - 已清除的工具结果 token极少
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct MessageTokens {
    pub total: usize,
    pub by_role: (usize, usize), // (user_tokens, assistant_tokens)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenStats {
    pub current_tokens: usize,
    pub warning_threshold: usize,
    pub blocking_threshold: usize,
    pub sm_threshold: usize,
    pub legacy_threshold: usize,
    pub user_tokens: usize,
    pub assistant_tokens: usize,
    pub message_count: usize,
}

#[command]
pub fn estimate_messages_tokens(messages_json: &str) -> Result<MessageTokens, String> {
    let messages: Vec<serde_json::Value> = serde_json::from_str(messages_json)
        .map_err(|e| format!("Failed to parse messages: {}", e))?;
    
    let mut total = 0usize;
    let mut user_tokens = 0usize;
    let mut assistant_tokens = 0usize;
    
    for msg in &messages {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        
        // content
        let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let content_tokens = estimate_tokens(content);
        
        // tool_calls JSON（assistant 消息）
        let tool_calls_tokens = if let Some(tc) = msg.get("tool_calls") {
            let tc_str = serde_json::to_string(tc).unwrap_or_default();
            estimate_tokens(&tc_str) / 3 // JSON 比纯文本紧凑
        } else {
            0
        };
        
        // reasoning
        let reasoning_tokens = if let Some(r) = msg.get("reasoning") {
            let r_str = r.as_str().unwrap_or("");
            estimate_tokens(r_str) / 2
        } else {
            0
        };
        
        // 是否是工具结果
        let is_tool_result = content.starts_with("__TOOL_RESULT__:");
        
        // 是否已清除
        let is_cleared = content.contains("[旧工具结果已清除]");
        
        let effective = if is_cleared {
            3 // "[旧工具结果已清除]" ≈ 10字符 ≈ 3 tokens
        } else if is_tool_result {
            content_tokens
        } else {
            content_tokens + tool_calls_tokens + reasoning_tokens
        };
        
        total += effective;
        
        if role == "user" {
            user_tokens += effective;
        } else {
            assistant_tokens += effective;
        }
    }
    
    // Claude Code: roughTokenCountEstimationForMessages 还乘以 4/3 padding
    let padded_total = (total * 4) / 3;
    let padded_user = (user_tokens * 4) / 3;
    let padded_assistant = (assistant_tokens * 4) / 3;
    
    Ok(MessageTokens {
        total: padded_total,
        by_role: (padded_user, padded_assistant),
    })
}

// ============================================================================
// Tool Result Helpers
// ============================================================================

/**
 * 判断 content 是否为工具结果
 * 格式: "__TOOL_RESULT__:{tool_call_id}:{result}"
 */
fn is_tool_result_message(content: &str) -> bool {
    content.starts_with("__TOOL_RESULT__:")
}

/**
 * 从工具结果 content 中提取 tool_call_id 和 result
 */
fn extract_tool_result(content: &str) -> Option<(String, String)> {
    if !content.starts_with("__TOOL_RESULT__:") {
        return None;
    }
    let rest = &content["__TOOL_RESULT__:".len()..];
    if let Some(idx) = rest.find(':') {
        Some((rest[..idx].to_string(), rest[idx + 1..].to_string()))
    } else {
        None
    }
}

/**
 * 替换工具结果内容为清除标记
 * 
 * 参考: TIME_BASED_MC_CLEARED_MESSAGE = "[Old tool result content cleared]"
 */
fn clear_tool_result(content: &str) -> String {
    if let Some((tool_call_id, _)) = extract_tool_result(content) {
        format!("__TOOL_RESULT__:{}:[旧工具结果已清除]", tool_call_id)
    } else {
        content.to_string()
    }
}

/**
 * 判断工具结果是否已被清除
 */
fn is_tool_result_cleared(content: &str) -> bool {
    content.contains("[旧工具结果已清除]")
}

// ============================================================================
// Microcompact Commands
// ============================================================================

/**
 * Microcompact 更新结果
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct MicrocompactUpdate {
    pub message_id: String,
    pub old_content: String,
    pub new_content: String,
    pub cleared_at: i64,
    pub tool_call_id: Option<String>,
}

/**
 * 时间触发的 Microcompact
 * 
 * 逻辑:
 * 1. 获取 session 所有消息
 * 2. 找到所有工具结果（按顺序）
 * 3. 找最近一次 assistant 消息时间戳
 * 4. 如果距离上次 assistant > idle_minutes，保留最后 keep_count 个，清除更早的
 * 
 * 参考: maybeTimeBasedMicrocompact() 在 microCompact.ts
 */
#[command]
pub fn microcompact_clear_old_tool_results(
    session_id: String,
    keep_count: usize,
    idle_minutes: usize,
) -> Result<Vec<MicrocompactUpdate>, String> {
    let messages = database::get_messages_for_session(&session_id)
        .map_err(|e| format!("Failed to get messages: {}", e))?;
    
    if messages.is_empty() {
        return Ok(vec![]);
    }
    
    // 收集所有工具结果的索引（保持顺序），避免借用冲突
    let tool_result_indices: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "user" && is_tool_result_message(&m.content))
        .map(|(i, _)| i)
        .collect();
    
    if tool_result_indices.len() <= keep_count {
        return Ok(vec![]);
    }
    
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    let last_assistant_ts = messages
        .iter()
        .filter(|m| m.role == "assistant")
        .map(|m| m.created_at)
        .max()
        .unwrap_or(now_secs);
    
    let idle_secs = (idle_minutes as i64) * 60;
    
    if now_secs - last_assistant_ts < idle_secs {
        return Ok(vec![]);
    }
    
    // 保留最后 keep_count 个，清除更早的
    let to_clear = &tool_result_indices[..(tool_result_indices.len() - keep_count)];
    
    let mut updates = Vec::new();
    
    for &idx in to_clear {
        let msg = &messages[idx];
        if is_tool_result_cleared(&msg.content) {
            continue;
        }
        
        let tool_call_id = extract_tool_result(&msg.content).map(|(id, _)| id);
        let new_content = clear_tool_result(&msg.content);
        
        let mut msg_clone = msg.clone();
        msg_clone.content = new_content.clone();
        database::save_message(&msg_clone)
            .map_err(|e| format!("Failed to save: {}", e))?;
        
        updates.push(MicrocompactUpdate {
            message_id: msg.id.clone(),
            old_content: msg.content.clone(),
            new_content,
            cleared_at: now_secs,
            tool_call_id,
        });
    }
    
    println!("🧹 Microcompact(time): cleared {} tool results (kept {} recent, {}min idle)",
             updates.len(), keep_count, idle_minutes);
    
    Ok(updates)
}

/**
 * 计数触发的 Microcompact
 * 
 * 逻辑:
 * 1. 统计未清除的工具结果数量
 * 2. 如果超过 max_tool_results，保留最后 keep_count 个，清除更早的
 * 
 * pipi-shrimp-agent 扩展（Claude Code 原版无此逻辑）
 */
#[command]
pub fn microcompact_by_count(
    session_id: String,
    max_tool_results: usize,
    keep_count: usize,
) -> Result<Vec<MicrocompactUpdate>, String> {
    let messages = database::get_messages_for_session(&session_id)
        .map_err(|e| format!("Failed to get messages: {}", e))?;
    
    // 收集未清除的工具结果（用索引避免借用冲突）
    let tool_result_indices: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter(|(_, m)| {
            m.role == "user"
                && is_tool_result_message(&m.content)
                && !is_tool_result_cleared(&m.content)
        })
        .map(|(i, _)| i)
        .collect();
    
    if tool_result_indices.len() <= max_tool_results {
        return Ok(vec![]);
    }
    
    let to_clear_count = tool_result_indices.len() - keep_count;
    let to_clear = &tool_result_indices[..to_clear_count];
    
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    let mut updates = Vec::new();
    
    for &idx in to_clear {
        let msg = &messages[idx];
        let tool_call_id = extract_tool_result(&msg.content).map(|(id, _)| id);
        let new_content = clear_tool_result(&msg.content);
        
        let mut msg_clone = msg.clone();
        msg_clone.content = new_content.clone();
        database::save_message(&msg_clone)
            .map_err(|e| format!("Failed to save: {}", e))?;
        
        updates.push(MicrocompactUpdate {
            message_id: msg.id.clone(),
            old_content: msg.content.clone(),
            new_content,
            cleared_at: now_secs,
            tool_call_id,
        });
    }
    
    println!("🧹 Microcompact(count): cleared {} tool results (max={}, keep={})",
             updates.len(), max_tool_results, keep_count);
    
    Ok(updates)
}

// ============================================================================
// Token Stats
// ============================================================================

/**
 * 获取 session 的 token 统计
 * 
 * 用于前端显示警告条和触发判断
 */
#[command]
pub fn get_session_token_stats(
    session_id: String,
    config_json: &str,
) -> Result<TokenStats, String> {
    let messages = database::get_messages_for_session(&session_id)
        .map_err(|e| format!("Failed to get messages: {}", e))?;
    
    let messages_json = serde_json::to_string(&messages)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    
    let tokens = estimate_messages_tokens(&messages_json)?;
    
    let config: serde_json::Value = serde_json::from_str(config_json)
        .map_err(|e| format!("Invalid config: {}", e))?;
    
    let sm_threshold = config.get("sm_auto_threshold_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(80_000) as usize;
    
    let legacy_threshold = config.get("legacy_auto_threshold_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(120_000) as usize;
    
    let warning_buffer = config.get("warning_buffer_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(20_000) as usize;
    
    let blocking_buffer = config.get("legacy_keep_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(3_000) as usize;
    
    let current = tokens.total;
    let warning_threshold = legacy_threshold.saturating_sub(warning_buffer);
    let blocking_threshold = legacy_threshold.saturating_sub(blocking_buffer);
    
    Ok(TokenStats {
        current_tokens: current,
        warning_threshold,
        blocking_threshold,
        sm_threshold,
        legacy_threshold,
        user_tokens: tokens.by_role.0,
        assistant_tokens: tokens.by_role.1,
        message_count: messages.len(),
    })
}

/**
 * 获取最近的工具结果消息（用于调试）
 */
#[command]
pub fn get_recent_tool_results(
    session_id: String,
    limit: usize,
) -> Result<Vec<serde_json::Value>, String> {
    let messages = database::get_messages_for_session(&session_id)
        .map_err(|e| format!("Failed to get messages: {}", e))?;
    
    let tool_results: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role == "user" && is_tool_result_message(&m.content))
        .rev() // 倒序，最近的在前面
        .take(limit)
        .map(|m| {
            let tool_call_id = extract_tool_result(&m.content)
                .map(|(id, _)| id)
                .unwrap_or_default();
            let is_cleared = is_tool_result_cleared(&m.content);
            let preview = if is_cleared {
                "[已清除]".to_string()
            } else {
                let content = extract_tool_result(&m.content)
                    .map(|(_, r)| r.clone())
                    .unwrap_or_default();
                if content.len() > 100 {
                    format!("{}...", &content[..100])
                } else {
                    content
                }
            };
            serde_json::json!({
                "id": m.id,
                "tool_call_id": tool_call_id,
                "is_cleared": is_cleared,
                "preview": preview,
                "timestamp": m.created_at,
            })
        })
        .collect();
    
    Ok(tool_results)
}
