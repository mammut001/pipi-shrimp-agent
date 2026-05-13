pub mod cleanup;
pub mod cdp_target;
pub mod events;
pub mod health;
pub mod lifecycle;
pub mod manager;
pub mod reconnect;
pub mod snapshot;
pub mod snapshot_cache;
pub mod state;
pub mod workers;

pub use cleanup::{CleanupReason, SessionCleanup};
pub use manager::BrowserSessionManager;
pub use state::BrowserConnectionState;

#[cfg(test)]
#[path = "__tests__/cleanup_test.rs"]
mod cleanup_test;
