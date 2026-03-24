/**
 * Stream Parser
 *
 * Unified SSE streaming implementation that separates:
 * - SSE frame reading (bytes -> lines -> data strings)
 * - Semantic parsing (delegates to ProviderAdapter)
 *
 * Design goals:
 * - Single streaming implementation for all providers
 * - SSE reading is provider-agnostic
 * - Semantic parsing is delegated to adapter's parse_stream_chunk
 * - Unified event format: claude-token / claude-reasoning / claude-tool-use
 */

use futures::stream::StreamExt;
use reqwest::Response;
use tauri::Window;

use crate::utils::{AppError, AppResult};

use super::adapter::{get_adapter_for_config, StreamContext, StreamEvent};
use super::provider::ResolvedProviderConfig;

/// Parse a single SSE data line into a string
///
/// Handles:
/// - "data: " prefix removal
/// - "[DONE]" marker detection
/// - Empty line handling
pub fn parse_sse_data_line(line: &str) -> Option<String> {
    let line = line.trim();

    // Must start with "data: "
    if !line.starts_with("data: ") {
        return None;
    }

    let data_str = &line[6..]; // Remove "data: " prefix

    // Empty or [DONE] marker
    if data_str.is_empty() || data_str == "[DONE]" {
        return None;
    }

    Some(data_str.to_string())
}

/// Parse SSE data string into StreamEvents using the appropriate adapter
///
/// Returns events to emit to frontend and accumulates state in ctx.
pub fn parse_stream_data(
    data: &str,
    config: &ResolvedProviderConfig,
    ctx: &mut StreamContext,
) -> AppResult<Vec<StreamEvent>> {
    let adapter = get_adapter_for_config(config);
    adapter.parse_stream_chunk(data, ctx)
}

/// Stream a response using the unified stream parser
///
/// This function:
/// 1. Reads SSE frames from the response
/// 2. Parses each frame using the provider's adapter
/// 3. Emits events to the frontend window
///
/// Returns the final ChatResponse after all chunks are processed.
pub async fn stream_response(
    response: Response,
    config: &ResolvedProviderConfig,
    window: Option<Window>,
    estimated_input: i32,
) -> AppResult<super::message::ChatResponse> {
    let adapter = get_adapter_for_config(config);
    let mut ctx = StreamContext::new(estimated_input, window);

    // Stream response body
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                return Err(AppError::ProcessError(format!("Stream error: {}", e)));
            }
        };

        let text = String::from_utf8_lossy(&chunk);
        let lines: Vec<&str> = text.lines().collect();

        for line in lines {
            // Parse SSE data line
            let data_str = match parse_sse_data_line(line) {
                Some(s) => s,
                None => continue,
            };

            // Parse using adapter
            match adapter.parse_stream_chunk(&data_str, &mut ctx) {
                Ok(events) => {
                    // Check for done or error
                    for event in &events {
                        match event {
                            StreamEvent::Done => {
                                // Stream complete
                                return adapter.finalize_stream(ctx, config);
                            }
                            StreamEvent::Error(msg) => {
                                return Err(AppError::ProcessError(format!("Stream error: {}", msg)));
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    // Log parse error but continue streaming
                    eprintln!("⚠️ Failed to parse stream chunk: {}", e);
                }
            }
        }
    }

    // Stream ended without explicit Done - finalize anyway
    adapter.finalize_stream(ctx, config)
}

/// Extract content from a plain (non-SSE) response
pub fn parse_plain_response(
    body: serde_json::Value,
    config: &ResolvedProviderConfig,
) -> AppResult<super::message::ChatResponse> {
    let adapter = get_adapter_for_config(config);
    adapter.parse_response(body, config)
}

/// Split content that may contain inline <think>...</think> tags
///
/// Returns iterator of (segment, is_reasoning) tuples.
pub struct ThinkSegmentIter<'a> {
    content: &'a str,
    in_think: bool,
    pos: usize,
}

impl<'a> ThinkSegmentIter<'a> {
    pub fn new(content: &'a str) -> Self {
        Self {
            content,
            in_think: false,
            pos: 0,
        }
    }
}

impl<'a> Iterator for ThinkSegmentIter<'a> {
    type Item = (&'a str, bool);

    fn next(&mut self) -> Option<Self::Item> {
        if self.pos >= self.content.len() {
            return None;
        }

        if self.in_think {
            // Looking for </think>
            if let Some(end) = self.content[self.pos..].find("</think>") {
                let segment = &self.content[self.pos..self.pos + end];
                self.pos += end + 8; // Skip </think>
                self.in_think = false;
                return Some((segment, true));
            } else {
                // No closing tag, rest is thinking
                let segment = &self.content[self.pos..];
                self.pos = self.content.len();
                return Some((segment, true));
            }
        } else {
            // Looking for <think>
            if let Some(start) = self.content[self.pos..].find("<think>") {
                if start > 0 {
                    // Text before <think>
                    let segment = &self.content[self.pos..self.pos + start];
                    self.pos += start;
                    return Some((segment, false));
                }
                // <think> at current position
                self.pos += 7; // Skip <think>
                self.in_think = true;
                return self.next(); // Recurse to handle think content
            } else {
                // No more <think>, rest is text
                let segment = &self.content[self.pos..];
                self.pos = self.content.len();
                return Some((segment, false));
            }
        }
    }
}

/// Split content with inline think tags, handling chunk boundaries
///
/// This is the stateful version used during streaming where a chunk may
/// start or end mid-tag.
///
/// Tags are treated as delimiters - only the content between them is returned.
pub fn split_think_content(content: &str, in_think: &mut bool) -> Vec<(String, bool)> {
    let mut result = Vec::new();
    let mut remaining = content;

    while !remaining.is_empty() {
        if *in_think {
            // Looking for </think>
            if let Some(end_pos) = remaining.find("</think>") {
                // Content before </think> is thinking
                if end_pos > 0 {
                    result.push((remaining[..end_pos].to_string(), true));
                }
                // Skip the closing tag
                remaining = &remaining[end_pos + 8..];
                *in_think = false;
            } else {
                // No closing tag - rest is thinking
                result.push((remaining.to_string(), true));
                remaining = "";
            }
        } else {
            // Looking for <think>
            if let Some(start_pos) = remaining.find("<think>") {
                // Text before <think>
                if start_pos > 0 {
                    result.push((remaining[..start_pos].to_string(), false));
                }
                // Skip the opening tag
                remaining = &remaining[start_pos + 7..];
                *in_think = true;
            } else {
                // No more tags - rest is text
                result.push((remaining.to_string(), false));
                remaining = "";
            }
        }
    }

    result
}


// Think tag constants - using string constants to avoid HTML rendering issues
const THINK_OPEN: &str = "\u{003c}think\u{003e}";   // <think>
const THINK_CLOSE: &str = "\u{003c}\u{002f}think\u{003e}";  // </think>

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sse_data_line() {
        assert_eq!(parse_sse_data_line("data: hello"), Some("hello".to_string()));
        assert_eq!(parse_sse_data_line("data: "), None);
        assert_eq!(parse_sse_data_line("data: [DONE]"), None);
        assert_eq!(parse_sse_data_line("hello"), None);
        assert_eq!(parse_sse_data_line("  data: hello  "), Some("hello".to_string()));
    }

    #[test]
    fn test_think_segment_iter() {
        let content = format!("Hello {} think1 {} world {} think2 {} end", THINK_OPEN, THINK_CLOSE, THINK_OPEN, THINK_CLOSE);
        let segments: Vec<(&str, bool)> = ThinkSegmentIter::new(&content).collect();
        assert_eq!(segments.len(), 5);
        assert_eq!(segments[0], ("Hello ", false));
        assert_eq!(segments[1], (" think1 ", true));
        assert_eq!(segments[2], (" world ", false));
        assert_eq!(segments[3], (" think2 ", true));
        assert_eq!(segments[4], (" end", false));
    }

    #[test]
    fn test_split_think_content_simple() {
        let mut in_think = false;
        let input = format!("Hello {} think {} world", THINK_OPEN, THINK_CLOSE);
        let result = split_think_content(&input, &mut in_think);
        assert_eq!(result.len(), 3, "Expected 3 segments, got {:?}", result);
        assert_eq!(result[0].0, "Hello ");
        assert!(!result[0].1);
        assert_eq!(result[1].0, " think ");
        assert!(result[1].1);
        assert_eq!(result[2].0, " world");
        assert!(!result[2].1);
    }

    #[test]
    fn test_split_think_content_chunk_boundary_start() {
        // Chunk starts mid-tag (already in think mode)
        let mut in_think = true;
        let input = format!("think {} world", THINK_CLOSE);
        let result = split_think_content(&input, &mut in_think);
        assert_eq!(result.len(), 2, "Expected 2 segments, got {:?}", result);
        assert_eq!(result[0].0, "think ");
        assert!(result[0].1);
        assert_eq!(result[1].0, " world");
        assert!(!result[1].1);
    }

    #[test]
    fn test_split_think_content_chunk_boundary_end() {
        // Chunk ends mid-tag (unclosed think block)
        let mut in_think = false;
        let input = format!("Hello {} think", THINK_OPEN);
        let result = split_think_content(&input, &mut in_think);
        assert_eq!(result.len(), 2, "Expected 2 segments, got {:?}", result);
        assert_eq!(result[0].0, "Hello ");
        assert!(!result[0].1);
        assert_eq!(result[1].0, " think");
        assert!(result[1].1);
    }

    #[test]
    fn test_split_think_content_unclosed() {
        // Unclosed think block
        let mut in_think = false;
        let input = format!("Hello {} unclosed", THINK_OPEN);
        let result = split_think_content(&input, &mut in_think);
        assert_eq!(result.len(), 2, "Expected 2 segments, got {:?}", result);
        assert_eq!(result[0].0, "Hello ");
        assert!(!result[0].1);
        assert_eq!(result[1].0, " unclosed");
        assert!(result[1].1);
    }
}