pub mod adapter;
pub mod composer;
pub mod http;
pub mod http_client;
/**
 * Claude Module
 *
 * Integration with Claude Code for AI-assisted operations
 * and Claude SDK (Anthropic API) integration
 */
pub mod ipc;
pub mod message;
pub mod provider;
pub mod stream_parser;

pub use http_client::stop_current_request;
pub use http_client::ClaudeClient;
pub use message::{ChatResponse, Message};
