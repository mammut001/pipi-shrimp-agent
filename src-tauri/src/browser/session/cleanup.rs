use async_trait::async_trait;
use serde::Serialize;

use crate::browser::cdp::CdpError;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CleanupReason {
    UserClosed,
    TaskCompleted,
    TaskFailed,
    Timeout,
    AppExiting,
}

impl CleanupReason {
    pub fn as_reason_key(self) -> &'static str {
        match self {
            Self::UserClosed => "manual_disconnect",
            Self::TaskCompleted => "task_completed",
            Self::TaskFailed => "task_failed",
            Self::Timeout => "idle_timeout",
            Self::AppExiting => "app_exit",
        }
    }

    pub fn is_idle_cleanup(self) -> bool {
        matches!(self, Self::Timeout)
    }
}

#[async_trait]
pub trait SessionCleanup {
    async fn cleanup_session(
        &mut self,
        session_id: &str,
        reason: CleanupReason,
    ) -> Result<(), CdpError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_cleanup_reasons_to_runtime_labels() {
        assert_eq!(CleanupReason::UserClosed.as_reason_key(), "manual_disconnect");
        assert_eq!(CleanupReason::TaskCompleted.as_reason_key(), "task_completed");
        assert_eq!(CleanupReason::TaskFailed.as_reason_key(), "task_failed");
        assert_eq!(CleanupReason::Timeout.as_reason_key(), "idle_timeout");
        assert_eq!(CleanupReason::AppExiting.as_reason_key(), "app_exit");
        assert!(CleanupReason::Timeout.is_idle_cleanup());
        assert!(!CleanupReason::UserClosed.is_idle_cleanup());
    }
}
