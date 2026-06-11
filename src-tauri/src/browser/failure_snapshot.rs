use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::browser::observability::{BrowserEventKind, BrowserEventLevel};
use crate::browser::session::BrowserSessionManager;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFailureSnapshot {
    pub task_id: String,
    pub session_id: Option<String>,
    pub last_success_action: Option<String>,
    pub failed_action: String,
    pub url: String,
    pub title: String,
    pub screenshot_path: Option<String>,
    pub dom_snapshot_id: Option<String>,
    pub error_kind: String,
    pub error_message: String,
    pub ts: i64,
}

fn app_data_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("PIPI_SHRIMP_DATA_DIR") {
        return PathBuf::from(override_dir);
    }

    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pipi-shrimp-agent")
}

pub fn get_failure_directory() -> Result<PathBuf, String> {
    let directory = app_data_dir().join("data").join("browser-failures");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create browser failure directory: {}", error))?;
    Ok(directory)
}

fn sanitize_url(raw_url: &str) -> String {
    if let Ok(mut parsed) = Url::parse(raw_url) {
        let _ = parsed.set_username("");
        let _ = parsed.set_password(None);
        parsed.set_query(None);
        parsed.set_fragment(None);
        return parsed.to_string();
    }

    raw_url
        .split('?')
        .next()
        .unwrap_or(raw_url)
        .split('#')
        .next()
        .unwrap_or(raw_url)
        .to_string()
}

pub fn persist_failure_snapshot(snapshot: &BrowserFailureSnapshot) -> Result<PathBuf, String> {
    let snapshot_path = get_failure_directory()?.join(format!("{}.json", snapshot.task_id));
    let payload = serde_json::to_string_pretty(snapshot)
        .map_err(|error| format!("Failed to serialize browser failure snapshot: {}", error))?;
    fs::write(&snapshot_path, payload)
        .map_err(|error| format!("Failed to persist browser failure snapshot: {}", error))?;
    Ok(snapshot_path)
}

pub fn list_failure_snapshots() -> Result<Vec<BrowserFailureSnapshot>, String> {
    let directory = get_failure_directory()?;
    let mut snapshots = Vec::new();

    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read browser failure directory: {}", error))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to read browser failure entry: {}", error))?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read browser failure snapshot: {}", error))?;
        let snapshot: BrowserFailureSnapshot = serde_json::from_str(&raw)
            .map_err(|error| format!("Failed to parse browser failure snapshot: {}", error))?;
        snapshots.push(snapshot);
    }

    snapshots.sort_by(|left, right| right.ts.cmp(&left.ts));
    Ok(snapshots)
}

pub fn get_failure_snapshot(task_id: &str) -> Result<Option<BrowserFailureSnapshot>, String> {
    let snapshot_path = get_failure_directory()?.join(format!("{}.json", task_id));
    if !snapshot_path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&snapshot_path)
        .map_err(|error| format!("Failed to read browser failure snapshot: {}", error))?;
    let snapshot = serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse browser failure snapshot: {}", error))?;
    Ok(Some(snapshot))
}

impl BrowserSessionManager {
    pub fn record_failure_snapshot(
        &mut self,
        failed_action: &str,
        error_kind: Option<String>,
        error_message: String,
    ) -> Option<BrowserFailureSnapshot> {
        let cached_page_state = self.cached_page_state();
        let current_url = cached_page_state
            .as_ref()
            .map(|page_state| page_state.url.as_str())
            .or_else(|| {
                self.session
                    .as_ref()
                    .and_then(|session| session.current_url.as_deref())
            })
            .unwrap_or_default();
        let title = cached_page_state
            .as_ref()
            .map(|page_state| page_state.title.clone())
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                self.session
                    .as_ref()
                    .and_then(|session| session.current_url.clone())
            })
            .unwrap_or_else(|| "Browser task failed".to_string());

        let snapshot = BrowserFailureSnapshot {
            task_id: format!("browser-failure-{}", uuid::Uuid::new_v4()),
            session_id: self
                .session
                .as_ref()
                .and_then(|session| session.session_id.clone()),
            last_success_action: self.last_successful_action.clone(),
            failed_action: failed_action.to_string(),
            url: sanitize_url(current_url),
            title,
            screenshot_path: None,
            dom_snapshot_id: self.snapshot_cache.active_key().map(str::to_string),
            error_kind: error_kind.unwrap_or_else(|| "browser.unknown_failure".to_string()),
            error_message,
            ts: Utc::now().timestamp(),
        };

        match persist_failure_snapshot(&snapshot) {
            Ok(_) => Some(snapshot),
            Err(error) => {
                self.event_bus.publish(
                    BrowserEventKind::HealthChanged,
                    BrowserEventLevel::Warning,
                    "Browser failure snapshot save failed".to_string(),
                    Some(error),
                    None,
                    None,
                );
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::sync::Mutex;

    static TEST_ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn with_temp_data_dir(test_fn: impl FnOnce(&PathBuf)) {
        let _guard = TEST_ENV_LOCK.lock().expect("test env lock poisoned");
        let temp_dir = std::env::temp_dir().join(format!(
            "pipi-shrimp-browser-failure-tests-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp data dir");
        std::env::set_var("PIPI_SHRIMP_DATA_DIR", &temp_dir);

        test_fn(&temp_dir);

        std::env::remove_var("PIPI_SHRIMP_DATA_DIR");
        fs::remove_dir_all(&temp_dir).expect("remove temp data dir");
    }

    fn sample_snapshot(task_id: &str, ts: i64) -> BrowserFailureSnapshot {
        BrowserFailureSnapshot {
            task_id: task_id.to_string(),
            session_id: Some("session-1".to_string()),
            last_success_action: Some("click".to_string()),
            failed_action: "type_text".to_string(),
            url: "https://example.com/app".to_string(),
            title: "Example App".to_string(),
            screenshot_path: None,
            dom_snapshot_id: Some("snapshot-1".to_string()),
            error_kind: "browser.execution_failed".to_string(),
            error_message: "input went stale".to_string(),
            ts,
        }
    }

    #[test]
    fn sanitize_url_removes_query_and_fragment_secrets() {
        let sanitized = sanitize_url("https://user:secret@example.com/app?token=abc#frag");
        assert_eq!(sanitized, "https://example.com/app");
    }

    #[test]
    fn persist_and_list_failure_snapshots_round_trip() {
        with_temp_data_dir(|_| {
            persist_failure_snapshot(&sample_snapshot("failure-1", 10)).expect("persist failure-1");
            persist_failure_snapshot(&sample_snapshot("failure-2", 20)).expect("persist failure-2");

            let snapshots = list_failure_snapshots().expect("list failure snapshots");
            assert_eq!(snapshots.len(), 2);
            assert_eq!(snapshots[0].task_id, "failure-2");
            assert_eq!(snapshots[1].task_id, "failure-1");

            let loaded = get_failure_snapshot("failure-1")
                .expect("get failure snapshot")
                .expect("failure snapshot should exist");
            assert_eq!(loaded.error_message, "input went stale");
        });
    }
}
