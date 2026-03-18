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

pub use commands::*;
pub use message::{Message, ChatResponse};
pub use http_client::ClaudeClient;
pub use http_client::stop_current_request;
pub use http_client::has_running_request;
