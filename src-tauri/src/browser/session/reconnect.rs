use std::time::Duration;

use crate::browser::cdp::CdpConfig;

#[allow(dead_code)]
pub fn next_reconnect_delay(attempt: u32, config: &CdpConfig) -> Duration {
    let min_ms = config.reconnect_backoff_min.as_millis() as u64;
    let max_ms = config.reconnect_backoff_max.as_millis() as u64;
    let exponent = attempt.min(16);
    let multiplier = 1_u64 << exponent;
    let delay_ms = min_ms.saturating_mul(multiplier).min(max_ms.max(min_ms));
    Duration::from_millis(delay_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::cdp::CdpConfig;

    #[test]
    fn test_reconnect_delay_caps_at_max() {
        let config = CdpConfig::default();

        assert_eq!(next_reconnect_delay(0, &config), Duration::from_secs(1));
        assert_eq!(next_reconnect_delay(1, &config), Duration::from_secs(2));
        assert_eq!(next_reconnect_delay(10, &config), Duration::from_secs(54));
    }
}