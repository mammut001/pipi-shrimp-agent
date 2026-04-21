use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 60;
const DEFAULT_PING_INTERVAL_SECS: u64 = 5;
const DEFAULT_RECONNECT_MIN_SECS: u64 = 1;
const DEFAULT_RECONNECT_MAX_SECS: u64 = 54;
const DEFAULT_REMOTE_DEBUGGING_PORT: u16 = 9222;
const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 300;
const DEFAULT_IDLE_CHECK_INTERVAL_SECS: u64 = 30;
const DEFAULT_EVENT_HISTORY_LIMIT: usize = 120;
const DEFAULT_BENCHMARK_SAMPLE_LIMIT: usize = 120;
const DEFAULT_SNAPSHOT_CACHE_LIMIT: usize = 8;

#[derive(Debug, Clone)]
pub struct CdpConfig {
    pub timeout: Duration,
    pub ping_interval: Duration,
    pub reconnect_backoff_min: Duration,
    pub reconnect_backoff_max: Duration,
    pub remote_debugging_port: u16,
    pub prefer_attach: bool,
    pub idle_timeout: Duration,
    pub idle_check_interval: Duration,
    pub event_history_limit: usize,
    pub benchmark_sample_limit: usize,
    pub snapshot_cache_limit: usize,
}

impl Default for CdpConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
            ping_interval: Duration::from_secs(DEFAULT_PING_INTERVAL_SECS),
            reconnect_backoff_min: Duration::from_secs(DEFAULT_RECONNECT_MIN_SECS),
            reconnect_backoff_max: Duration::from_secs(DEFAULT_RECONNECT_MAX_SECS),
            remote_debugging_port: DEFAULT_REMOTE_DEBUGGING_PORT,
            prefer_attach: true,
            idle_timeout: Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS),
            idle_check_interval: Duration::from_secs(DEFAULT_IDLE_CHECK_INTERVAL_SECS),
            event_history_limit: DEFAULT_EVENT_HISTORY_LIMIT,
            benchmark_sample_limit: DEFAULT_BENCHMARK_SAMPLE_LIMIT,
            snapshot_cache_limit: DEFAULT_SNAPSHOT_CACHE_LIMIT,
        }
    }
}

impl CdpConfig {
    pub fn from_env() -> Self {
        Self::from_env_with(|key| std::env::var(key).ok())
    }

    pub fn from_env_with<F>(env_get: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        let defaults = Self::default();

        Self {
            timeout: Duration::from_secs(parse_u64_env(
                env_get("PIPI_CDP_TIMEOUT_S"),
                defaults.timeout.as_secs(),
            )),
            ping_interval: Duration::from_secs(parse_u64_env(
                env_get("PIPI_CDP_PING_INTERVAL_S"),
                defaults.ping_interval.as_secs(),
            )),
            reconnect_backoff_min: Duration::from_secs(parse_u64_env(
                env_get("PIPI_CDP_RECONNECT_MIN_S"),
                defaults.reconnect_backoff_min.as_secs(),
            )),
            reconnect_backoff_max: Duration::from_secs(parse_u64_env(
                env_get("PIPI_CDP_RECONNECT_MAX_S"),
                defaults.reconnect_backoff_max.as_secs(),
            )),
            remote_debugging_port: parse_u16_env(
                env_get("PIPI_CDP_PORT"),
                defaults.remote_debugging_port,
            ),
            prefer_attach: parse_bool_env(env_get("PIPI_CDP_PREFER_ATTACH"), defaults.prefer_attach),
            idle_timeout: Duration::from_secs(parse_u64_env(
                env_get("PIPI_CDP_IDLE_TIMEOUT_S"),
                defaults.idle_timeout.as_secs(),
            )),
            idle_check_interval: Duration::from_secs(parse_u64_env(
                env_get("PIPI_CDP_IDLE_CHECK_INTERVAL_S"),
                defaults.idle_check_interval.as_secs(),
            )),
            event_history_limit: parse_usize_env(
                env_get("PIPI_BROWSER_EVENT_HISTORY_LIMIT"),
                defaults.event_history_limit,
            ),
            benchmark_sample_limit: parse_usize_env(
                env_get("PIPI_BROWSER_BENCHMARK_SAMPLE_LIMIT"),
                defaults.benchmark_sample_limit,
            ),
            snapshot_cache_limit: parse_usize_env(
                env_get("PIPI_BROWSER_SNAPSHOT_CACHE_LIMIT"),
                defaults.snapshot_cache_limit,
            ),
        }
    }
}

fn parse_u64_env(raw: Option<String>, default: u64) -> u64 {
    raw.and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn parse_u16_env(raw: Option<String>, default: u16) -> u16 {
    raw.and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn parse_bool_env(raw: Option<String>, default: bool) -> bool {
    match raw.as_deref() {
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES") => true,
        Some("0") | Some("false") | Some("FALSE") | Some("no") | Some("NO") => false,
        _ => default,
    }
}

fn parse_usize_env(raw: Option<String>, default: usize) -> usize {
    raw.and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_config_defaults() {
        let cfg = CdpConfig::from_env_with(|_| None);
        assert_eq!(cfg.timeout, Duration::from_secs(60));
        assert_eq!(cfg.ping_interval, Duration::from_secs(5));
        assert_eq!(cfg.reconnect_backoff_min, Duration::from_secs(1));
        assert_eq!(cfg.reconnect_backoff_max, Duration::from_secs(54));
        assert_eq!(cfg.remote_debugging_port, 9222);
        assert!(cfg.prefer_attach);
        assert_eq!(cfg.idle_timeout, Duration::from_secs(300));
        assert_eq!(cfg.idle_check_interval, Duration::from_secs(30));
        assert_eq!(cfg.event_history_limit, 120);
        assert_eq!(cfg.benchmark_sample_limit, 120);
        assert_eq!(cfg.snapshot_cache_limit, 8);
    }

    #[test]
    fn test_config_parses_env_overrides() {
        let env = HashMap::from([
            ("PIPI_CDP_TIMEOUT_S", "15"),
            ("PIPI_CDP_PING_INTERVAL_S", "2"),
            ("PIPI_CDP_RECONNECT_MIN_S", "3"),
            ("PIPI_CDP_RECONNECT_MAX_S", "20"),
            ("PIPI_CDP_PORT", "9333"),
            ("PIPI_CDP_PREFER_ATTACH", "false"),
            ("PIPI_CDP_IDLE_TIMEOUT_S", "120"),
            ("PIPI_CDP_IDLE_CHECK_INTERVAL_S", "9"),
            ("PIPI_BROWSER_EVENT_HISTORY_LIMIT", "48"),
            ("PIPI_BROWSER_BENCHMARK_SAMPLE_LIMIT", "64"),
            ("PIPI_BROWSER_SNAPSHOT_CACHE_LIMIT", "6"),
        ]);

        let cfg = CdpConfig::from_env_with(|key| env.get(key).map(|value| value.to_string()));
        assert_eq!(cfg.timeout, Duration::from_secs(15));
        assert_eq!(cfg.ping_interval, Duration::from_secs(2));
        assert_eq!(cfg.reconnect_backoff_min, Duration::from_secs(3));
        assert_eq!(cfg.reconnect_backoff_max, Duration::from_secs(20));
        assert_eq!(cfg.remote_debugging_port, 9333);
        assert!(!cfg.prefer_attach);
        assert_eq!(cfg.idle_timeout, Duration::from_secs(120));
        assert_eq!(cfg.idle_check_interval, Duration::from_secs(9));
        assert_eq!(cfg.event_history_limit, 48);
        assert_eq!(cfg.benchmark_sample_limit, 64);
        assert_eq!(cfg.snapshot_cache_limit, 6);
    }
}