#![allow(dead_code)]
/**
 * Request Composer
 *
 * Validates and normalizes message sequences before sending to the API.
 * Ensures tool_call/tool_result chains are complete and properly ordered.
 *
 * Key responsibilities:
 * - Detect and repair orphaned tool_results
 * - Detect and drop incomplete tool_call blocks
 * - Reorder parallel tool_results to match tool_calls order
 * - Validate message sequence integrity
 */

use super::message::Message;

/// Result of validating a message sequence
#[derive(Debug, Clone)]
pub struct ValidationResult {
    /// Whether the sequence is valid
    pub is_valid: bool,
    /// Warning messages (non-fatal issues)
    pub warnings: Vec<String>,
    /// Errors that caused validation failure
    pub errors: Vec<String>,
    /// Indices of messages that were dropped
    pub dropped_indices: Vec<usize>,
}

impl Default for ValidationResult {
    fn default() -> Self {
        Self {
            is_valid: true,
            warnings: Vec::new(),
            errors: Vec::new(),
            dropped_indices: Vec::new(),
        }
    }
}

impl ValidationResult {
    pub fn error(msg: &str) -> Self {
        Self {
            is_valid: false,
            warnings: Vec::new(),
            errors: vec![msg.to_string()],
            dropped_indices: Vec::new(),
        }
    }

    pub fn warning(msg: &str) -> Self {
        Self {
            is_valid: true,
            warnings: vec![msg.to_string()],
            errors: Vec::new(),
            dropped_indices: Vec::new(),
        }
    }
}

/// Tool call tracker - tracks expected tool calls and their results
#[derive(Debug, Clone)]
struct ToolCallTracker {
    /// Tool calls we've seen but not yet received results for
    pending_calls: Vec<String>,
    /// All tool call IDs we've seen (for orphan detection)
    all_calls: Vec<String>,
}

impl ToolCallTracker {
    fn new() -> Self {
        Self {
            pending_calls: Vec::new(),
            all_calls: Vec::new(),
        }
    }

    /// Record a tool call
    fn add_call(&mut self, tool_call_id: &str) {
        self.pending_calls.push(tool_call_id.to_string());
        self.all_calls.push(tool_call_id.to_string());
    }

    /// Record a tool result - returns true if valid, false if orphan
    fn add_result(&mut self, tool_call_id: &str) -> bool {
        if let Some(pos) = self.pending_calls.iter().position(|id| id == tool_call_id) {
            self.pending_calls.remove(pos);
            true
        } else {
            false
        }
    }

    /// Check if a tool call ID is orphaned (no matching call was ever made)
    fn is_orphan_result(&self, tool_call_id: &str) -> bool {
        // A result is orphaned if we never saw the corresponding tool call
        !self.all_calls.contains(&tool_call_id.to_string())
    }

    /// Get pending tool calls (for error reporting)
    fn pending(&self) -> &[String] {
        &self.pending_calls
    }

    /// Check if there are unclosed tool calls
    fn has_unclosed(&self) -> bool {
        !self.pending_calls.is_empty()
    }
}

/// Extract tool call IDs from a message
fn extract_tool_call_ids(msg: &Message) -> Vec<String> {
    msg.tool_calls
        .as_ref()
        .map(|calls| calls.iter().map(|tc| tc.tool_call_id.clone()).collect())
        .unwrap_or_default()
}

/// Check if a message is a tool result
fn is_tool_result(msg: &Message) -> bool {
    msg.role == "user"
        && (msg.content.starts_with("__TOOL_RESULT__:")
            || msg.tool_call_id.is_some())
}

/// Extract tool call ID from a tool result message
fn extract_tool_result_id(msg: &Message) -> Option<String> {
    if let Some(ref id) = msg.tool_call_id {
        return Some(id.clone());
    }

    // Try to parse from content
    if let Some(rest) = msg.content.strip_prefix("__TOOL_RESULT__:") {
        if let Some(colon_pos) = rest.find(':') {
            return Some(rest[..colon_pos].to_string());
        }
    }

    None
}

/// Validate and normalize a message sequence
///
/// Returns validated messages with orphaned tool_results removed and
/// incomplete tool_call blocks flagged.
pub fn normalize_messages(messages: &[Message]) -> (Vec<Message>, ValidationResult) {
    let mut tracker = ToolCallTracker::new();
    let mut result = ValidationResult::default();
    let mut normalized = Vec::new();

    for (index, msg) in messages.iter().enumerate() {
        // Track tool calls in assistant messages
        if msg.role == "assistant" && msg.tool_calls.is_some() {
            let tool_call_ids = extract_tool_call_ids(msg);
            for id in &tool_call_ids {
                tracker.add_call(id);
            }

            // If this assistant message has tool calls but also has content,
            // that's fine - the content is preserved
            normalized.push(msg.clone());
            continue;
        }

        // Handle tool results
        if is_tool_result(msg) {
            if let Some(result_id) = extract_tool_result_id(msg) {
                if tracker.is_orphan_result(&result_id) {
                    // Orphaned result - skip it with a warning
                    result.warnings.push(format!(
                        "Dropping orphaned tool_result at index {} (id: {})",
                        index, result_id
                    ));
                    result.dropped_indices.push(index);
                    continue;
                }
                tracker.add_result(&result_id);
            }
            normalized.push(msg.clone());
            continue;
        }

        // Regular messages pass through
        normalized.push(msg.clone());
    }

    // Check for unclosed tool calls at the end
    if tracker.has_unclosed() {
        let pending: Vec<String> = tracker.pending().to_vec();
        result.warnings.push(format!(
            "Unclosed tool calls at end of sequence: {:?}",
            pending
        ));
    }

    (normalized, result)
}

/// Validate that a message sequence is complete and ready to send
///
/// This is a stricter check that returns an error if there are issues.
pub fn validate_sequence(messages: &[Message]) -> ValidationResult {
    let (_, result) = normalize_messages(messages);

    // Check for critical issues
    if !result.warnings.is_empty() {
        // Only fail on errors, not warnings
        for warning in &result.warnings {
            if warning.contains("Unclosed tool calls") {
                // This is a critical issue - we have assistant messages with
                // tool calls but no results
                return ValidationResult::error(&format!(
                    "Cannot send: assistant message has tool_calls without results. {}",
                    warning
                ));
            }
        }
    }

    result
}

/// Reorder tool results to match the order of tool calls
///
/// Some providers require tool_results to be in the exact same order
/// as the corresponding tool_calls. This function reorders them.
pub fn reorder_tool_results(messages: &[Message]) -> Vec<Message> {
    let mut result = Vec::with_capacity(messages.len());
    let mut tool_call_order: Vec<String> = Vec::new();

    // First pass: collect tool call order
    for msg in messages {
        if msg.role == "assistant" && msg.tool_calls.is_some() {
            if let Some(calls) = &msg.tool_calls {
                for tc in calls {
                    tool_call_order.push(tc.tool_call_id.clone());
                }
            }
        }
    }

    // Build a map of tool_result_id -> message
    let mut tool_results: std::collections::HashMap<String, Message> =
        std::collections::HashMap::new();

    for msg in messages {
        if is_tool_result(msg) {
            if let Some(id) = extract_tool_result_id(msg) {
                tool_results.insert(id, msg.clone());
            }
        }
    }

    // Add tool results in tool_call order
    for id in tool_call_order {
        if let Some(tool_msg) = tool_results.remove(&id) {
            result.push(tool_msg);
        }
    }

    // Add any remaining tool results that weren't in our order list
    for (_, tool_msg) in tool_results {
        result.push(tool_msg);
    }

    result
}

/// Strip internal prefixes from tool result content
///
/// Converts "__TOOL_RESULT__:{id}:{result}" to just "{result}"
pub fn strip_tool_result_prefix(content: &str) -> String {
    if let Some(rest) = content.strip_prefix("__TOOL_RESULT__:") {
        if let Some(colon_pos) = rest.find(':') {
            return rest[colon_pos + 1..].to_string();
        }
        return rest.to_string();
    }
    content.to_string()
}

/// Check if a message sequence has the correct tool call/result ordering
///
/// Returns Ok if valid, or an error describing the issue.
pub fn check_tool_chain_integrity(messages: &[Message]) -> Result<(), String> {
    let mut tool_calls: Vec<(usize, String)> = Vec::new(); // (message_index, id)
    let mut tool_results: Vec<(usize, String)> = Vec::new();

    for (index, msg) in messages.iter().enumerate() {
        if msg.role == "assistant" && msg.tool_calls.is_some() {
            if let Some(calls) = &msg.tool_calls {
                for tc in calls {
                    tool_calls.push((index, tc.tool_call_id.clone()));
                }
            }
        }

        if is_tool_result(msg) {
            if let Some(id) = extract_tool_result_id(msg) {
                tool_results.push((index, id));
            }
        }
    }

    // Check: every tool_result should have a corresponding tool_call
    for (result_index, result_id) in &tool_results {
        let has_call = tool_calls.iter().any(|(_, call_id)| call_id == result_id);
        if !has_call {
            return Err(format!(
                "Tool result at index {} has no matching tool_call (id: {})",
                result_index, result_id
            ));
        }
    }

    // Check: tool_calls should come before their results
    for (call_index, call_id) in &tool_calls {
        for (result_index, result_id) in &tool_results {
            if call_id == result_id {
                if result_index < call_index {
                    return Err(format!(
                        "Tool result at index {} comes before its tool_call at index {}",
                        result_index, call_index
                    ));
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::message::ToolCall;

    fn make_message(role: &str, content: &str) -> Message {
        Message {
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    fn make_tool_call(id: &str, name: &str, args: &str) -> ToolCall {
        ToolCall {
            tool_call_id: id.to_string(),
            name: name.to_string(),
            arguments: args.to_string(),
        }
    }

    #[test]
    fn test_normalize_simple_conversation() {
        let messages = vec![
            make_message("user", "Hello"),
            make_message("assistant", "Hi there!"),
        ];

        let (normalized, result) = normalize_messages(&messages);
        assert!(result.is_valid);
        assert_eq!(normalized.len(), 2);
    }

    #[test]
    fn test_normalize_removes_orphaned_tool_result() {
        // Tool result without a corresponding tool call
        let messages = vec![
            make_message("user", "__TOOL_RESULT__:call_123:result"),
        ];

        let (normalized, result) = normalize_messages(&messages);
        assert!(result.is_valid); // Still valid, just drops orphaned
        assert!(result.warnings[0].contains("orphaned"));
        assert_eq!(normalized.len(), 0);
    }

    #[test]
    fn test_normalize_preserves_valid_tool_chain() {
        let messages = vec![
            make_message("assistant", "").with_tool_calls(vec![make_tool_call("call_1", "read_file", "{}")]),
            make_message("user", "__TOOL_RESULT__:call_1:file content"),
        ];

        let (normalized, result) = normalize_messages(&messages);
        assert!(result.is_valid);
        assert_eq!(normalized.len(), 2);
    }

    #[test]
    fn test_check_tool_chain_integrity_valid() {
        let messages = vec![
            make_message("assistant", "").with_tool_calls(vec![make_tool_call("call_1", "read_file", "{}")]),
            make_message("user", "__TOOL_RESULT__:call_1:file content"),
        ];

        assert!(check_tool_chain_integrity(&messages).is_ok());
    }

    #[test]
    fn test_check_tool_chain_integrity_orphaned_result() {
        let messages = vec![
            make_message("user", "__TOOL_RESULT__:call_999:orphan"),
        ];

        assert!(check_tool_chain_integrity(&messages).is_err());
    }

    #[test]
    fn test_strip_tool_result_prefix() {
        assert_eq!(
            strip_tool_result_prefix("__TOOL_RESULT__:call_123:file content"),
            "file content"
        );
        assert_eq!(
            strip_tool_result_prefix("plain text"),
            "plain text"
        );
    }

    // Helper to set tool_calls
    impl Message {
        fn with_tool_calls(mut self, calls: Vec<ToolCall>) -> Self {
            self.tool_calls = Some(calls);
            self
        }
    }
}