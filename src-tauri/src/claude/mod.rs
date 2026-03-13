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
pub mod node_subprocess;

pub use commands::*;
pub use message::{Message, ChatResponse};
pub use node_subprocess::ClaudeClient;
