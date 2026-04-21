use std::future::Future;
use std::time::Duration;

use super::CdpError;

pub async fn run_with_timeout<F, T>(
    operation: &str,
    timeout: Duration,
    future: F,
) -> Result<T, CdpError>
where
    F: Future<Output = T>,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| CdpError::Timeout {
            operation: operation.to_string(),
            timeout_ms: timeout.as_millis() as u64,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::Instant;

    #[tokio::test]
    async fn test_timeout_wrapper_returns_timeout_error() {
        let result = run_with_timeout(
            "pending-op",
            Duration::from_millis(10),
            async {
                tokio::time::sleep(Duration::from_millis(30)).await;
                42_u8
            },
        )
        .await;

        assert_eq!(
            result,
            Err(CdpError::Timeout {
                operation: "pending-op".to_string(),
                timeout_ms: 10,
            })
        );
    }

    #[tokio::test]
    async fn test_timeout_wrapper_returns_before_future_completes() {
        let started_at = Instant::now();

        let result = run_with_timeout(
            "pending-op",
            Duration::from_millis(25),
            async {
                tokio::time::sleep(Duration::from_secs(1)).await;
                42_u8
            },
        )
        .await;

        assert!(matches!(result, Err(CdpError::Timeout { .. })));
        assert!(started_at.elapsed() < Duration::from_millis(200));
    }
}