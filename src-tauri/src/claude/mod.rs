/**
 * Claude Module
 *
 * Integration with Claude Code for AI-assisted operations
 * and Claude SDK (Anthropic API) integration
 */

pub mod ipc;
pub mod client;
pub mod commands;
pub mod message;
pub mod http_client;
pub mod provider;
pub mod composer;
pub mod adapter;
pub mod stream_parser;

pub use commands::*;
pub use message::{Message, ChatResponse};
pub use http_client::ClaudeClient;
pub use http_client::stop_current_request;
pub use http_client::has_running_request;
pub use provider::{ProviderId, ApiFormat, ProviderCapabilities, ResolvedProviderConfig, supports_thinking, thinking_budget};
pub use composer::{normalize_messages, validate_sequence, check_tool_chain_integrity};
pub use adapter::{ProviderAdapter, StreamEvent, StreamContext, get_adapter, get_adapter_for_config};
pub use stream_parser::{parse_sse_data_line, split_think_content, ThinkSegmentIter};
