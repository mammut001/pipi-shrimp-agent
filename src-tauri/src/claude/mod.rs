/**
 * Claude Module
 *
 * Integration with Claude Code for AI-assisted operations
 * and Claude SDK (Anthropic API) integration
 */

pub mod ipc;
pub mod message;
pub mod http_client;
pub mod provider;
pub mod composer;
pub mod adapter;
pub mod stream_parser;

pub use message::{Message, ChatResponse};
pub use http_client::ClaudeClient;
pub use http_client::stop_current_request;
