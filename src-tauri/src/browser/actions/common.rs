use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use chromiumoxide::cdp::browser_protocol::dom::{BackendNodeId, GetBoxModelParams, ResolveNodeParams};
use chromiumoxide::cdp::js_protocol::runtime::CallFunctionOnParams;
use chromiumoxide::page::Page;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::browser::dom::{InteractiveElement, PageState};
use crate::browser::session::BrowserSessionManager;

pub type ActionResult<T> = Result<T, BrowserActionError>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActionTimeoutPolicy {
    pub timeout_ms: u64,
}

impl Default for ActionTimeoutPolicy {
    fn default() -> Self {
        Self { timeout_ms: 30_000 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrowserActionError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    pub retry_hint: Option<String>,
}

impl BrowserActionError {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        recoverable: bool,
        retry_hint: Option<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable,
            retry_hint,
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(
            "browser.invalid_input",
            message,
            true,
            Some("Check the browser action input payload and retry.".to_string()),
        )
    }

    pub fn not_connected() -> Self {
        Self::new(
            "browser.not_connected",
            "Browser is not connected.",
            true,
            Some("Connect Chrome before retrying the browser action.".to_string()),
        )
    }

    pub fn page_state_stale(message: impl Into<String>) -> Self {
        Self::new(
            "browser.page_state_stale",
            message,
            true,
            Some("Refresh page state and retry the action.".to_string()),
        )
    }

    pub fn element_not_found(reference: impl Into<String>) -> Self {
        Self::new(
            "browser.element_not_found",
            format!("Element not found: {}", reference.into()),
            true,
            Some("Call browser_get_page to refresh the page state and inspect the latest elements.".to_string()),
        )
    }

    pub fn element_not_interactable(message: impl Into<String>) -> Self {
        Self::new(
            "browser.element_not_interactable",
            message,
            true,
            Some("Wait for the page to settle or choose a visible interactive element.".to_string()),
        )
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(
            "browser.timeout",
            message,
            true,
            Some("Retry the action after the page finishes loading.".to_string()),
        )
    }

    pub fn navigation_failed(message: impl Into<String>) -> Self {
        Self::new(
            "browser.navigation_failed",
            message,
            true,
            Some("Verify the URL or authentication state before retrying navigation.".to_string()),
        )
    }

    pub fn execution_failed(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(code, message, false, None)
    }

    pub fn session(message: impl Into<String>) -> Self {
        let message = message.into();
        if is_not_connected_message(&message) {
            Self::not_connected()
        } else {
            Self::execution_failed("browser.session_failed", message)
        }
    }
}

impl fmt::Display for BrowserActionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match serde_json::to_string(self) {
            Ok(encoded) => f.write_str(&encoded),
            Err(_) => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for BrowserActionError {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ElementReference {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend_node_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub navigation_id: Option<String>,
}

impl ElementReference {
    pub fn is_empty(&self) -> bool {
        self.index.is_none() && self.backend_node_id.is_none()
    }

    pub fn description(&self) -> String {
        let mut parts = Vec::new();

        if let Some(backend_node_id) = self.backend_node_id {
            parts.push(format!("backend_node_id={}", backend_node_id));
        }

        if let Some(index) = self.index {
            parts.push(format!("index={}", index));
        }

        if let Some(navigation_id) = self.navigation_id.as_deref() {
            parts.push(format!("navigation_id={}", navigation_id));
        }

        if parts.is_empty() {
            "missing target".to_string()
        } else {
            parts.join(" ")
        }
    }
}

#[derive(Clone)]
pub struct ActionContext {
    manager: Arc<Mutex<BrowserSessionManager>>,
}

impl ActionContext {
    pub fn new(manager: Arc<Mutex<BrowserSessionManager>>) -> Self {
        Self { manager }
    }

    pub async fn page(&self) -> ActionResult<Page> {
        let manager = self.manager.lock().await;
        manager.page_cloned().ok_or_else(BrowserActionError::not_connected)
    }

    pub async fn capture_page_state(&self) -> ActionResult<PageState> {
        let mut manager = self.manager.lock().await;
        manager
            .capture_page_state()
            .await
            .map_err(|error| BrowserActionError::session(error.to_string()))
    }

    pub async fn cached_or_capture_page_state(&self, force_refresh: bool) -> ActionResult<PageState> {
        let mut manager = self.manager.lock().await;
        if force_refresh {
            manager
                .capture_page_state()
                .await
                .map_err(|error| BrowserActionError::page_state_stale(error.to_string()))
        } else if let Some(page_state) = manager.consume_cached_page_state() {
            Ok(page_state)
        } else {
            manager
                .capture_page_state()
                .await
                .map_err(|error| BrowserActionError::page_state_stale(error.to_string()))
        }
    }

    pub async fn page_state_text(&self) -> ActionResult<String> {
        let mut manager = self.manager.lock().await;
        manager
            .page_state_text()
            .await
            .map_err(|error| BrowserActionError::page_state_stale(error.to_string()))
    }

    pub async fn resolve_element(&self, reference: &ElementReference) -> ActionResult<InteractiveElement> {
        if reference.is_empty() {
            return Err(BrowserActionError::invalid_input(
                "click/type actions require either index or backend_node_id.",
            ));
        }

        if reference.backend_node_id.is_none() && reference.navigation_id.is_none() {
            if let Some(index) = reference.index {
                let mut manager = self.manager.lock().await;
                return manager
                    .resolve_interactive_element(index)
                    .await
                    .map_err(|error| BrowserActionError::page_state_stale(error.to_string()));
            }
        }

        let cached_page_state = self.cached_or_capture_page_state(false).await?;
        if let Ok(element) = resolve_reference_in_page_state(&cached_page_state, reference) {
            return Ok(element);
        }

        let fresh_page_state = self.cached_or_capture_page_state(true).await?;
        resolve_reference_in_page_state(&fresh_page_state, reference)
    }

    pub async fn refresh_connection_metadata(&self) -> ActionResult<()> {
        let mut manager = self.manager.lock().await;
        manager
            .refresh_connection_metadata()
            .await
            .map_err(|error| BrowserActionError::session(error.to_string()))
    }

    pub async fn invalidate_page_state(&self) {
        let mut manager = self.manager.lock().await;
        manager.invalidate_page_state();
    }

    pub async fn record_navigation(&self, title: Option<String>, detail: Option<String>) {
        let mut manager = self.manager.lock().await;
        manager.record_navigation(title, detail);
    }

    pub async fn run_instrumented<T, Fut>(
        &self,
        action_name: &'static str,
        detail: Option<String>,
        future: Fut,
    ) -> ActionResult<T>
    where
        Fut: Future<Output = ActionResult<T>>,
    {
        {
            let mut manager = self.manager.lock().await;
            manager.record_action_started(action_name, detail.clone());
        }

        let started_at = Instant::now();
        let result = future.await;
        let duration_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let error = result.as_ref().err().map(|err| err.message.clone());

        {
            let mut manager = self.manager.lock().await;
            manager.record_action_finished(action_name, detail, duration_ms, result.is_ok(), error);
        }

        result
    }
}

fn match_in_page_state(page_state: &PageState, reference: &ElementReference) -> Option<InteractiveElement> {
    if let Some(backend_node_id) = reference.backend_node_id {
        return page_state
            .find_element_by_backend_node_id(backend_node_id)
            .cloned();
    }

    reference
        .index
        .and_then(|index| page_state.find_element(index).cloned())
}

fn resolve_reference_in_page_state(
    page_state: &PageState,
    reference: &ElementReference,
) -> ActionResult<InteractiveElement> {
    if let Some(expected_navigation_id) = reference.navigation_id.as_deref() {
        if page_state.navigation_id != expected_navigation_id {
            return Err(BrowserActionError::page_state_stale(format!(
                "Expected navigation_id '{}' but current page state is '{}'.",
                expected_navigation_id, page_state.navigation_id
            )));
        }
    }

    match_in_page_state(page_state, reference)
        .ok_or_else(|| BrowserActionError::element_not_found(reference.description()))
}

fn is_not_connected_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("not connected") || message.contains("未连接")
}

pub async fn call_backend_node_function(
    page: &Page,
    backend_node_id: i64,
    function_declaration: &str,
) -> ActionResult<serde_json::Value> {
    let resolved = page
        .execute(
            ResolveNodeParams::builder()
                .backend_node_id(BackendNodeId::new(backend_node_id))
                .build(),
        )
        .await
        .map_err(|error| {
            BrowserActionError::execution_failed(
                "browser.element_not_found",
                format!("Unable to resolve backend_node_id {}: {}", backend_node_id, error),
            )
        })?;
    let object_id = resolved
        .result
        .object
        .object_id
        .ok_or_else(|| {
            BrowserActionError::execution_failed(
                "browser.element_not_found",
                format!("backend_node_id {} did not return an object id", backend_node_id),
            )
        })?;
    let response = page
        .execute(
            CallFunctionOnParams::builder()
                .object_id(object_id)
                .function_declaration(function_declaration)
                .await_promise(true)
                .return_by_value(true)
                .build()
                .map_err(|error| {
                    BrowserActionError::execution_failed(
                        "browser.invalid_input",
                        format!("Failed to build Runtime.callFunctionOn params: {}", error),
                    )
                })?,
        )
        .await
        .map_err(|error| {
            BrowserActionError::execution_failed(
                "browser.action_failed",
                format!("Failed to execute browser node function: {}", error),
            )
        })?;

    if let Some(exception) = response.result.exception_details {
        return Err(BrowserActionError::execution_failed(
            "browser.action_failed",
            format!("Browser node script threw an exception: {:?}", exception),
        ));
    }

    response.result.result.value.ok_or_else(|| {
        BrowserActionError::execution_failed(
            "browser.action_failed",
            "Browser node script did not return a value.",
        )
    })
}

pub async fn backend_node_click_point(page: &Page, backend_node_id: i64) -> ActionResult<(f64, f64)> {
    let box_model = page
        .execute(
            GetBoxModelParams::builder()
                .backend_node_id(BackendNodeId::new(backend_node_id))
                .build(),
        )
        .await
        .map_err(|error| {
            BrowserActionError::execution_failed(
                "browser.element_not_interactable",
                format!("Failed to read element box model: {}", error),
            )
        })?;
    let quad = box_model.result.model.content.inner();
    if quad.len() != 8 {
        return Err(BrowserActionError::element_not_interactable(format!(
            "backend_node_id {} returned an invalid click area",
            backend_node_id
        )));
    }

    let xs = [quad[0], quad[2], quad[4], quad[6]];
    let ys = [quad[1], quad[3], quad[5], quad[7]];
    let min_x = xs.iter().copied().fold(f64::INFINITY, f64::min);
    let max_x = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let min_y = ys.iter().copied().fold(f64::INFINITY, f64::min);
    let max_y = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);

    Ok(((min_x + max_x) / 2.0, (min_y + max_y) / 2.0))
}

#[async_trait]
pub trait BrowserAction {
    type Input;
    type Output;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_support::{load_page_state_fixture, FixtureActionHarness};

    fn sample_page_state() -> PageState {
        PageState {
            url: "https://example.com/login".to_string(),
            title: "Login".to_string(),
            navigation_id: "nav-1".to_string(),
            frame_count: 1,
            viewport: None,
            warnings: Vec::new(),
            elements: vec![
                InteractiveElement {
                    index: 1,
                    backend_node_id: 42,
                    frame_id: "root".to_string(),
                    role: "button".to_string(),
                    name: "Cancel".to_string(),
                    tag_name: Some("button".to_string()),
                    bounds: None,
                    is_visible: true,
                    is_clickable: true,
                    is_editable: false,
                    selector_hint: None,
                    text_hint: None,
                    href: None,
                    input_type: None,
                },
                InteractiveElement {
                    index: 7,
                    backend_node_id: 88,
                    frame_id: "root".to_string(),
                    role: "button".to_string(),
                    name: "Continue".to_string(),
                    tag_name: Some("button".to_string()),
                    bounds: None,
                    is_visible: true,
                    is_clickable: true,
                    is_editable: false,
                    selector_hint: Some("button[type=submit]".to_string()),
                    text_hint: None,
                    href: None,
                    input_type: None,
                },
            ],
            screenshot: None,
        }
    }

    #[test]
    fn resolve_reference_prefers_backend_node_id_over_index() {
        let page_state = sample_page_state();
        let reference = ElementReference {
            index: Some(1),
            backend_node_id: Some(88),
            navigation_id: Some("nav-1".to_string()),
        };

        let resolved = resolve_reference_in_page_state(&page_state, &reference)
            .expect("backend_node_id should win over index");

        assert_eq!(resolved.backend_node_id, 88);
        assert_eq!(resolved.index, 7);
    }

    #[test]
    fn resolve_reference_returns_page_state_stale_when_navigation_changes() {
        let page_state = sample_page_state();
        let reference = ElementReference {
            index: Some(7),
            backend_node_id: Some(88),
            navigation_id: Some("nav-2".to_string()),
        };

        let error = resolve_reference_in_page_state(&page_state, &reference)
            .expect_err("navigation mismatch should be treated as stale page state");

        assert_eq!(error.code, "browser.page_state_stale");
        assert!(error.recoverable);
    }

    #[test]
    fn resolve_reference_returns_element_not_found_for_missing_target() {
        let page_state = sample_page_state();
        let reference = ElementReference {
            index: Some(999),
            backend_node_id: Some(999),
            navigation_id: Some("nav-1".to_string()),
        };

        let error = resolve_reference_in_page_state(&page_state, &reference)
            .expect_err("missing element should remain recoverable");

        assert_eq!(error.code, "browser.element_not_found");
        assert!(error.recoverable);
    }

    #[tokio::test]
    async fn resolve_element_retries_with_fresh_fixture_capture() {
        let harness = FixtureActionHarness::new(
            Some(load_page_state_fixture("iframe-retry-cache")),
            vec![load_page_state_fixture("iframe-shadow")],
        )
        .await;

        let resolved = harness
            .resolve_element(ElementReference {
                index: None,
                backend_node_id: Some(310),
                navigation_id: Some("loader-root-1".to_string()),
            })
            .await
            .expect("fresh capture should recover the iframe element");

        assert_eq!(resolved.backend_node_id, 310);
        assert_eq!(resolved.selector_hint.as_deref(), Some("#card-number"));
        assert_eq!(harness.capture_count().await, 1);
    }

    #[tokio::test]
    async fn cached_page_state_reuses_snapshot_cache_until_invalidated() {
        let first_page_state = load_page_state_fixture("iframe-shadow");
        let refreshed_page_state = load_page_state_fixture("navigation-refresh");
        let harness = FixtureActionHarness::new(
            None,
            vec![first_page_state.clone(), refreshed_page_state.clone()],
        )
        .await;

        let first_capture = harness
            .ctx()
            .cached_or_capture_page_state(false)
            .await
            .expect("first lookup should capture the initial page state");
        let cached_capture = harness
            .ctx()
            .cached_or_capture_page_state(false)
            .await
            .expect("second lookup should reuse the snapshot cache");

        assert_eq!(first_capture.navigation_id, first_page_state.navigation_id);
        assert_eq!(cached_capture.navigation_id, first_page_state.navigation_id);
        assert_eq!(harness.capture_count().await, 1);

        harness.ctx().invalidate_page_state().await;

        let refreshed_capture = harness
            .ctx()
            .cached_or_capture_page_state(false)
            .await
            .expect("invalidating the active cache should force a fresh capture");

        assert_eq!(refreshed_capture.navigation_id, refreshed_page_state.navigation_id);
        assert_eq!(harness.capture_count().await, 2);
    }
}