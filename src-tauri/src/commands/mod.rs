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
 */

pub mod chat;
pub mod code;
pub mod config;
pub mod file;
pub mod models;
pub mod search;
pub mod web;

pub use chat::*;
pub use code::*;
pub use config::*;
pub use file::*;
pub use models::*;
pub use search::*;
pub use web::*;
