/**
 * Commands module
 *
 * Contains all Tauri command handlers organized by feature:
 * - chat: Session and message handling
 * - code: Code execution (bash, python, node)
 * - file: File system operations
 * - config: Application configuration
 * - web: Web automation
 * - search: High-performance text searching (ripgrep)
 * - workspace: Work directory management
 */

pub mod browser;    // NEW - Browser window commands for PageAgent
pub mod chat;
pub mod code;
pub mod compact;     // Context compression system - Layer 1: Microcompact
pub mod config;
pub mod file;
pub mod models;
pub mod search;
pub mod session_memory; // Layer 2: Session Memory
pub mod telegram;    // Telegram Bot API commands
pub mod tools;       // Tool pipeline: unified tool execution
pub mod web;
pub mod workspace;

pub use browser::*;  // NEW
pub use chat::*;
pub use code::*;
pub use compact::*;
pub use config::*;
pub use file::*;
pub use models::*;
pub use search::*;
pub use session_memory::*;
pub use telegram::*;
pub use tools::*;
pub use web::*;
pub use workspace::*;
