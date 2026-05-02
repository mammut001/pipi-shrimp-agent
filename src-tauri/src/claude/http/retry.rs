use std::future::Future;
use std::time::Duration;

use tokio::time::sleep;

use super::error_mapping::ClaudeHttpError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: usize,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

pub const DEFAULT_RETRY_POLICY: RetryPolicy = RetryPolicy {
    max_attempts: 3,
    base_delay_ms: 250,
    max_delay_ms: 2_000,
};

pub fn next_retry_delay(attempt: usize, policy: RetryPolicy) -> Duration {
    let multiplier = 2_u64.saturating_pow(attempt.saturating_sub(1) as u32);
    Duration::from_millis((policy.base_delay_ms.saturating_mul(multiplier)).min(policy.max_delay_ms))
}

pub fn should_retry(error: &ClaudeHttpError) -> bool {
    error.retryable()
}

pub async fn run_with_retry<T, F, Fut>(
    mut operation: F,
    policy: RetryPolicy,
) -> Result<T, ClaudeHttpError>
where
    F: FnMut(usize) -> Fut,
    Fut: Future<Output = Result<T, ClaudeHttpError>>,
{
    let mut attempt = 1;
    loop {
        match operation(attempt).await {
            Ok(value) => return Ok(value),
            Err(error) if attempt < policy.max_attempts && should_retry(&error) => {
                sleep(next_retry_delay(attempt, policy)).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn computes_exponential_backoff_with_cap() {
        let policy = RetryPolicy {
            max_attempts: 4,
            base_delay_ms: 100,
            max_delay_ms: 250,
        };

        assert_eq!(next_retry_delay(1, policy), Duration::from_millis(100));
        assert_eq!(next_retry_delay(2, policy), Duration::from_millis(200));
        assert_eq!(next_retry_delay(3, policy), Duration::from_millis(250));
    }

    #[tokio::test]
    async fn retries_retryable_errors_until_success() {
        let calls = Arc::new(Mutex::new(0usize));
        let calls_clone = Arc::clone(&calls);

        let result = run_with_retry(
            move |_| {
                let calls_clone = Arc::clone(&calls_clone);
                async move {
                    let mut count = calls_clone.lock().unwrap();
                    *count += 1;
                    if *count < 3 {
                        Err(ClaudeHttpError::Network { retryable: true })
                    } else {
                        Ok("ok")
                    }
                }
            },
            RetryPolicy {
                max_attempts: 3,
                base_delay_ms: 0,
                max_delay_ms: 0,
            },
        )
        .await;

        assert_eq!(result.unwrap(), "ok");
        assert_eq!(*calls.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn stops_on_non_retryable_errors() {
        let result = run_with_retry(
            |_| async {
                Err::<(), _>(ClaudeHttpError::Validation {
                    field: "request".to_string(),
                    message: "bad".to_string(),
                })
            },
            DEFAULT_RETRY_POLICY,
        )
        .await;

        assert!(matches!(result, Err(ClaudeHttpError::Validation { .. })));
    }
}
