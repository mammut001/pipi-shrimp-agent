use super::*;
use crate::browser::actions;
use crate::browser::actions::common::BrowserActionError;
use crate::browser::actions::test_support::{
    load_page_state_fixture, CheckoutFlowServer, FixtureActionHarness, LiveActionHarness,
};
use crate::browser::actions::ElementReference;
use crate::browser::dom::InteractiveElement;
use anyhow::Result as AnyhowResult;
use std::sync::Mutex as StdMutex;

pub(super) fn find_live_element<F>(
    page_state: &PageState,
    label: &str,
    predicate: F,
) -> AnyhowResult<InteractiveElement>
where
    F: Fn(&InteractiveElement) -> bool,
{
    let element_debug = serde_json::to_string_pretty(&page_state.elements)
        .unwrap_or_else(|_| format!("{:?}", page_state.elements));

    page_state
        .elements
        .iter()
        .find(|element| predicate(element))
        .cloned()
        .ok_or_else(|| {
            anyhow::anyhow!(
                "expected {} in live page state; elements={}",
                label,
                element_debug
            )
        })
}

pub(super) async fn read_selector_text_live(
    harness: &LiveActionHarness,
    selector: &str,
) -> AnyhowResult<String> {
    let script = format!(
        "(function() {{ const node = document.querySelector({selector:?}); return node ? node.textContent : ''; }})()",
    );
    harness
        .page()
        .evaluate(script)
        .await
        .map_err(anyhow::Error::from)?
        .into_value::<String>()
        .map_err(anyhow::Error::from)
}

pub(super) fn sample_page_state() -> PageState {
    PageState {
        url: "https://example.com/dashboard".to_string(),
        title: "Dashboard".to_string(),
        navigation_id: "nav-42".to_string(),
        frame_count: 2,
        viewport: None,
        warnings: vec!["cross_origin_iframe_partial".to_string()],
        elements: vec![InteractiveElement {
            index: 1,
            backend_node_id: 101,
            frame_id: "root".to_string(),
            role: "button".to_string(),
            name: "Sync Now".to_string(),
            tag_name: Some("button".to_string()),
            bounds: None,
            is_visible: true,
            is_clickable: true,
            is_editable: false,
            selector_hint: Some("button[data-action=\"sync\"]".to_string()),
            text_hint: None,
            href: None,
            input_type: None,
        }],
        screenshot: None,
    }
}

pub(super) struct FixtureBrowserChatRuntime {
    harness: FixtureActionHarness,
    last_resolved_element: StdMutex<Option<InteractiveElement>>,
}

impl FixtureBrowserChatRuntime {
    pub(super) async fn new(
        cached_page_state: Option<PageState>,
        queued_page_states: Vec<PageState>,
    ) -> Self {
        Self {
            harness: FixtureActionHarness::new(cached_page_state, queued_page_states).await,
            last_resolved_element: StdMutex::new(None),
        }
    }

    pub(super) async fn capture_count(&self) -> usize {
        self.harness.capture_count().await
    }

    pub(super) fn last_resolved_element(&self) -> Option<InteractiveElement> {
        self.last_resolved_element.lock().unwrap().clone()
    }

    fn to_element_reference(target: &BrowserToolTarget) -> ElementReference {
        ElementReference {
            index: target.element_id,
            backend_node_id: target.backend_node_id,
            navigation_id: target.navigation_id.clone(),
        }
    }

    async fn resolve_target(
        &self,
        target: &BrowserToolTarget,
    ) -> Result<InteractiveElement, String> {
        let element = self
            .harness
            .resolve_element(Self::to_element_reference(target))
            .await
            .map_err(|error| error.to_string())?;
        *self.last_resolved_element.lock().unwrap() = Some(element.clone());
        Ok(element)
    }
}

pub(super) struct LiveHarnessBrowserChatRuntime<'a> {
    harness: &'a LiveActionHarness,
}

impl<'a> LiveHarnessBrowserChatRuntime<'a> {
    pub(super) fn new(harness: &'a LiveActionHarness) -> Self {
        Self { harness }
    }

    fn to_element_reference(target: &BrowserToolTarget) -> ElementReference {
        ElementReference {
            index: target.element_id,
            backend_node_id: target.backend_node_id,
            navigation_id: target.navigation_id.clone(),
        }
    }
}

pub(super) struct FakeBrowserChatRuntime {
    pub(super) navigate_result: Result<(), String>,
    pub(super) resync_result: Result<(), String>,
    pub(super) page_state_result: Result<PageState, String>,
    pub(super) click_result: Result<String, String>,
    pub(super) type_result: Result<String, String>,
    pub(super) scroll_result: Result<String, String>,
    pub(super) text_result: Result<String, String>,
    pub(super) screenshot_result: Result<String, String>,
    pub(super) extract_result: Result<String, String>,
    pub(super) press_key_result: Result<String, String>,
    pub(super) wait_result: Result<String, String>,
    pub(super) last_click_target: StdMutex<Option<BrowserToolTarget>>,
}

impl Default for FakeBrowserChatRuntime {
    fn default() -> Self {
        Self {
            navigate_result: Ok(()),
            resync_result: Ok(()),
            page_state_result: Ok(sample_page_state()),
            click_result: Ok("clicked".to_string()),
            type_result: Ok("输入成功: backend_node_id 701，共 5 个字符".to_string()),
            scroll_result: Ok("scrolled".to_string()),
            text_result: Ok("Page content".to_string()),
            screenshot_result: Ok("base64-image".to_string()),
            extract_result: Ok("structured content".to_string()),
            press_key_result: Ok("pressed".to_string()),
            wait_result: Ok("等待完成，目标选择器已出现（250ms）".to_string()),
            last_click_target: StdMutex::new(None),
        }
    }
}

#[async_trait]
impl BrowserChatRuntime for FakeBrowserChatRuntime {
    async fn navigate_and_wait(
        &self,
        _url: String,
        _wait_selector: Option<String>,
    ) -> Result<(), String> {
        self.navigate_result.clone()
    }

    async fn resync_page(&self) -> Result<(), String> {
        self.resync_result.clone()
    }

    async fn get_page_state(&self) -> Result<PageState, String> {
        self.page_state_result.clone()
    }

    async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
        *self.last_click_target.lock().unwrap() = Some(target.clone());
        self.click_result.clone()
    }

    async fn type_text(
        &self,
        _target: &BrowserToolTarget,
        _text: String,
    ) -> Result<String, String> {
        self.type_result.clone()
    }

    async fn scroll(&self, _direction: String, _pixels: i64) -> Result<String, String> {
        self.scroll_result.clone()
    }

    async fn get_text(&self, _max_length: Option<u64>) -> Result<String, String> {
        self.text_result.clone()
    }

    async fn screenshot(&self) -> Result<String, String> {
        self.screenshot_result.clone()
    }

    async fn extract_content(&self) -> Result<String, String> {
        self.extract_result.clone()
    }

    async fn press_key(&self, _key: String) -> Result<String, String> {
        self.press_key_result.clone()
    }

    async fn wait(
        &self,
        _seconds: Option<u64>,
        _wait_selector: Option<String>,
    ) -> Result<String, String> {
        self.wait_result.clone()
    }

    async fn delay_after_click(&self) {}
}

#[async_trait]
impl BrowserChatRuntime for FixtureBrowserChatRuntime {
    async fn navigate_and_wait(
        &self,
        _url: String,
        _wait_selector: Option<String>,
    ) -> Result<(), String> {
        Ok(())
    }

    async fn resync_page(&self) -> Result<(), String> {
        Ok(())
    }

    async fn get_page_state(&self) -> Result<PageState, String> {
        crate::browser::actions::get_page_state(self.harness.ctx())
            .await
            .map_err(|error| error.to_string())
    }

    async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
        let element = self.resolve_target(target).await?;
        if !element.is_visible || !element.is_clickable {
            return Err(BrowserActionError::element_not_interactable(format!(
                "{} is not a visible clickable element.",
                Self::to_element_reference(target).description()
            ))
            .to_string());
        }

        Ok(format!(
            "点击成功: backend_node_id {}{}",
            element.backend_node_id,
            element
                .tag_name
                .as_ref()
                .map(|tag| format!(" <{}>", tag))
                .unwrap_or_default()
        ))
    }

    async fn type_text(
        &self,
        target: &BrowserToolTarget,
        text: String,
    ) -> Result<String, String> {
        let element = self.resolve_target(target).await?;
        if !element.is_visible || !element.is_editable {
            return Err(BrowserActionError::element_not_interactable(format!(
                "{} is not an editable visible element.",
                Self::to_element_reference(target).description()
            ))
            .to_string());
        }

        Ok(format!(
            "输入成功: backend_node_id {}，共 {} 个字符",
            element.backend_node_id,
            text.chars().count()
        ))
    }

    async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
        Ok(format!("滚动: {} {}px", direction, pixels))
    }

    async fn get_text(&self, _max_length: Option<u64>) -> Result<String, String> {
        Ok(String::new())
    }

    async fn screenshot(&self) -> Result<String, String> {
        Ok("fixture-screenshot".to_string())
    }

    async fn extract_content(&self) -> Result<String, String> {
        Ok("fixture-content".to_string())
    }

    async fn press_key(&self, key: String) -> Result<String, String> {
        Ok(format!("已按下键 '{}'", key))
    }

    async fn wait(
        &self,
        seconds: Option<u64>,
        wait_selector: Option<String>,
    ) -> Result<String, String> {
        if wait_selector.is_some() {
            Ok("等待完成，目标选择器已出现（0ms）".to_string())
        } else {
            Ok(format!("已等待 {} 秒", seconds.unwrap_or(2)))
        }
    }

    async fn delay_after_click(&self) {}
}

#[async_trait]
impl BrowserChatRuntime for LiveHarnessBrowserChatRuntime<'_> {
    async fn navigate_and_wait(
        &self,
        url: String,
        wait_selector: Option<String>,
    ) -> Result<(), String> {
        actions::navigate(
            self.harness.ctx(),
            actions::NavigateInput {
                url: Some(url),
                wait_selector,
                timeout_ms: None,
            },
        )
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
    }

    async fn resync_page(&self) -> Result<(), String> {
        Ok(())
    }

    async fn get_page_state(&self) -> Result<PageState, String> {
        actions::get_page_state(self.harness.ctx())
            .await
            .map_err(|error| error.to_string())
    }

    async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
        let output = actions::click(
            self.harness.ctx(),
            actions::ClickInput {
                target: Self::to_element_reference(target),
            },
        )
        .await
        .map_err(|error| error.to_string())?;

        Ok(format!(
            "点击成功: backend_node_id {}{}",
            output.backend_node_id,
            output
                .tag_name
                .as_ref()
                .map(|tag| format!(" <{}>", tag))
                .unwrap_or_default()
        ))
    }

    async fn type_text(
        &self,
        target: &BrowserToolTarget,
        text: String,
    ) -> Result<String, String> {
        let text_len = text.chars().count();
        let output = actions::type_text(
            self.harness.ctx(),
            actions::TypeTextInput {
                target: Self::to_element_reference(target),
                text,
            },
        )
        .await
        .map_err(|error| error.to_string())?;

        Ok(format!(
            "输入成功: backend_node_id {}，共 {} 个字符",
            output.backend_node_id, text_len
        ))
    }

    async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
        actions::scroll(
            self.harness.ctx(),
            actions::ScrollInput { direction, pixels },
        )
        .await
        .map(|_| "ok".to_string())
        .map_err(|error| error.to_string())
    }

    async fn get_text(&self, max_length: Option<u64>) -> Result<String, String> {
        actions::get_text_content(
            self.harness.ctx(),
            actions::GetTextContentInput {
                max_length: max_length.unwrap_or(3_000) as usize,
            },
        )
        .await
        .map_err(|error| error.to_string())
    }

    async fn screenshot(&self) -> Result<String, String> {
        actions::screenshot(self.harness.ctx())
            .await
            .map(|screenshot| screenshot.value)
            .map_err(|error| error.to_string())
    }

    async fn extract_content(&self) -> Result<String, String> {
        actions::extract_content(self.harness.ctx(), actions::ExtractContentInput)
            .await
            .map_err(|error| error.to_string())
    }

    async fn press_key(&self, key: String) -> Result<String, String> {
        actions::press_key(self.harness.ctx(), actions::PressKeyInput { key })
            .await
            .map(|output| format!("已按下键 '{}'", output.key))
            .map_err(|error| error.to_string())
    }

    async fn wait(
        &self,
        seconds: Option<u64>,
        wait_selector: Option<String>,
    ) -> Result<String, String> {
        let output = actions::wait(
            self.harness.ctx(),
            actions::WaitInput {
                seconds,
                wait_selector,
                timeout_ms: None,
            },
        )
        .await
        .map_err(|error| error.to_string())?;

        if output.selector_matched {
            Ok(format!(
                "等待完成，目标选择器已出现（{}ms）",
                output.waited_ms
            ))
        } else {
            Ok(format!("已等待 {} 秒", output.waited_ms / 1_000))
        }
    }

    async fn delay_after_click(&self) {}
}
