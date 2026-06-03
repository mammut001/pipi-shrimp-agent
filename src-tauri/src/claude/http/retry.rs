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

/// Compute the next retry delay, honouring an upstream Retry-After hint if present.
///
/// AUDIT-2026-06-02 (boundary): the previous `run_with_retry` always used a
/// fixed exponential schedule (capped at max_delay_ms) even when the 429
/// path had extracted a `Retry-After: N` value. The client therefore retried
/// faster than the server asked, producing more 429s and a longer outage.
///
/// We now honour the server hint: the actual delay is
/// `max(exponential_backoff, retry_after)` clamped by `max_delay_ms * 4` so
/// a pathological `Retry-After: 3600` from a misbehaving upstream can't
/// freeze the client indefinitely (the absolute ceiling is the max_delay_ms
/// for that policy multiplied by 4 — empirically enough for transient 429s
/// but not enough for hour-long server outages, which the user should see).
pub fn next_retry_delay_with_hint(
    attempt: usize,
    policy: RetryPolicy,
    error: &ClaudeHttpError,
) -> Duration {
    let backoff = next_retry_delay(attempt, policy);
    let hint_ms = match error {
        ClaudeHttpError::RateLimit { retry_after: Some(seconds) } => seconds.saturating_mul(1_000),
        _ => 0,
    };
    if hint_ms == 0 {
        return backoff;
    }
    let absolute_cap_ms = policy.max_delay_ms.saturating_mul(4).max(policy.max_delay_ms);
    let chosen_ms = hint_ms.max(backoff.as_millis() as u64).min(absolute_cap_ms);
    Duration::from_millis(chosen_ms)
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
                let delay = next_retry_delay_with_hint(attempt, policy, &error);
                sleep(delay).await;
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

    #[test]
    fn retry_after_overrides_exponential_when_larger() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 100,
            max_delay_ms: 500,
        };
        let err = ClaudeHttpError::RateLimit { retry_after: Some(2) };
        // 2s >> exponential of 100ms; should win, clamped by 4*max_delay = 2000ms.
        assert_eq!(
            next_retry_delay_with_hint(1, policy, &err),
            Duration::from_millis(2_000),
        );
    }

    #[test]
    fn retry_after_falls_back_to_exponential_when_smaller() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 1_000,
            max_delay_ms: 4_000,
        };
        let err = ClaudeHttpError::RateLimit { retry_after: Some(1) };
        // Exponential is 1s, hint is 1s → take the larger of the two (1s).
        // attempt=2 → exponential 2s, still capped at 4s, so hint of 1s
        // should not pull us BELOW exponential.
        assert_eq!(
            next_retry_delay_with_hint(2, policy, &err),
            Duration::from_millis(2_000),
        );
    }

    #[test]
    fn retry_after_clamped_to_absolute_cap_to_protect_against_pathological_upstream() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 100,
            max_delay_ms: 500,
        };
        let err = ClaudeHttpError::RateLimit { retry_after: Some(3_600) };
        // Pathological 1-hour Retry-After should not freeze the client.
        // Absolute cap is 4 * max_delay_ms = 2000ms.
        assert_eq!(
            next_retry_delay_with_hint(1, policy, &err),
            Duration::from_millis(2_000),
        );
    }

    #[test]
    fn no_retry_after_uses_pure_exponential() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 100,
            max_delay_ms: 500,
        };
        let err = ClaudeHttpError::Network { retryable: true };
        assert_eq!(
            next_retry_delay_with_hint(2, policy, &err),
            Duration::from_millis(200),
        );
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
