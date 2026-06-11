use std::time::Duration;

use chromiumoxide::browser::Browser;
use chromiumoxide::cdp::browser_protocol::target::{TargetId, TargetInfo};
use chromiumoxide::page::Page;
use tokio::task::JoinHandle;

use crate::browser::cdp::{CdpError, ChromiumoxideCdpClient};

use super::manager::BrowserSessionManager;
use super::state::{BrowserLaunchMode, BrowserSession};

const EXISTING_TARGET_SETTLE_DELAY_MS: u64 = 75;

impl BrowserSessionManager {
    pub(super) async fn connect_with_ws_url(
        &mut self,
        ws_url: String,
        launch_mode: BrowserLaunchMode,
    ) -> Result<BrowserSession, CdpError> {
        let (mut browser, handler) = self.client.connect(&ws_url).await?;
        let page = match launch_mode {
            BrowserLaunchMode::Attach => self.select_attach_page(&mut browser).await?,
            BrowserLaunchMode::Launch => self.select_active_page(&browser).await?,
        };

        self.replace_runtime(browser, page, handler, ws_url, launch_mode)
            .await?;
        self.session_snapshot().ok_or_else(|| {
            CdpError::Session(
                "Connected to browser but failed to materialize session metadata".to_string(),
            )
        })
    }

    pub(super) async fn select_attach_page(&self, browser: &mut Browser) -> Result<Page, CdpError> {
        select_attach_page_with_client(&self.client, browser).await
    }

    pub(super) async fn select_active_page(&self, browser: &Browser) -> Result<Page, CdpError> {
        select_active_page_with_client(&self.client, browser).await
    }

    pub(super) async fn replace_runtime(
        &mut self,
        browser: Browser,
        page: Page,
        handler: JoinHandle<()>,
        ws_url: String,
        launch_mode: BrowserLaunchMode,
    ) -> Result<(), CdpError> {
        if let Some(old_handler) = self.handler.take() {
            old_handler.abort();
        }

        let previous_status = self.health.status;
        self.browser = Some(browser);
        self.page = Some(page);
        self.handler = Some(handler);
        self.health.mark_healthy();
        self.snapshot_cache.clear();
        self.session = Some(BrowserSession::new(
            ws_url,
            launch_mode,
            self.health.clone(),
        ));
        self.restart_runtime_event_worker_if_running();
        self.touch_activity();
        self.refresh_session_metadata().await?;
        self.sync_session_health();
        self.event_bus.publish(
            crate::browser::observability::BrowserEventKind::Connected,
            crate::browser::observability::BrowserEventLevel::Success,
            format!("Browser connected ({})", launch_mode.as_str()),
            self.session
                .as_ref()
                .and_then(|session| session.current_url.clone()),
            None,
            None,
        );
        self.emit_health_event_if_changed(previous_status);
        Ok(())
    }

    pub(super) async fn refresh_session_metadata(&mut self) -> Result<(), CdpError> {
        let (current_url, target_id, session_id) = match self.page.as_ref() {
            Some(page) => (
                self.client.page_url(page).await?,
                Some(page.target_id().as_ref().to_string()),
                Some(page.session_id().as_ref().to_string()),
            ),
            None => (None, None, None),
        };

        if let Some(session) = self.session.as_mut() {
            session.current_url = current_url;
            session.target_id = target_id;
            session.session_id = session_id;
            session.health = self.health.clone();
            session.last_activity_at_ms = self.last_activity_at_ms;
        }

        Ok(())
    }

    pub(super) fn sync_session_health(&mut self) {
        if let Some(session) = self.session.as_mut() {
            session.health = self.health.clone();
            session.last_activity_at_ms = self.last_activity_at_ms;
        }
    }
}

pub(super) async fn select_attach_page_with_client(
    client: &ChromiumoxideCdpClient,
    browser: &mut Browser,
) -> Result<Page, CdpError> {
    let targets = match client.fetch_targets(browser).await {
        Ok(targets) => {
            if !targets.is_empty() {
                tokio::time::sleep(Duration::from_millis(EXISTING_TARGET_SETTLE_DELAY_MS)).await;
            }
            targets
        }
        Err(_) => Vec::new(),
    };

    let pages = client.list_pages(browser).await?;
    match select_attach_page_candidate(pages, &targets) {
        Some(page) => Ok(page),
        None => client.new_page(browser, "about:blank").await,
    }
}

pub(super) async fn select_active_page_with_client(
    client: &ChromiumoxideCdpClient,
    browser: &Browser,
) -> Result<Page, CdpError> {
    let pages = client.list_pages(browser).await?;
    let mut fallback_page: Option<Page> = None;

    for page in pages {
        let page_url = client.page_url(&page).await.ok().flatten();
        if matches!(page_url.as_deref(), Some(url) if !url.trim().is_empty() && url != "about:blank")
        {
            return Ok(page);
        }

        if fallback_page.is_none() {
            fallback_page = Some(page);
        }
    }

    match fallback_page {
        Some(page) => Ok(page),
        None => client.new_page(browser, "about:blank").await,
    }
}

pub(super) fn select_attach_page_candidate(
    mut pages: Vec<Page>,
    targets: &[TargetInfo],
) -> Option<Page> {
    if let Some(target_id) = select_attach_target_id(targets) {
        if let Some(index) = pages.iter().position(|page| page.target_id() == &target_id) {
            return Some(pages.swap_remove(index));
        }
    }

    pages.into_iter().next()
}

pub(super) fn select_attach_target_id(targets: &[TargetInfo]) -> Option<TargetId> {
    select_attach_target(targets).map(|target| target.target_id.clone())
}

pub(super) fn select_attach_target(targets: &[TargetInfo]) -> Option<&TargetInfo> {
    targets
        .iter()
        .min_by_key(|target| attach_target_sort_key(target))
}

pub(super) fn attach_target_sort_key(target: &TargetInfo) -> (u8, u8, u8, u8, &str, &str) {
    let is_not_page = u8::from(target.r#type != "page");
    let is_blank = u8::from(is_blank_target_url(&target.url));
    let has_opener = u8::from(target.opener_id.is_some());
    let missing_title = u8::from(target.title.trim().is_empty());

    (
        is_not_page,
        is_blank,
        has_opener,
        missing_title,
        target.url.as_str(),
        target.title.as_str(),
    )
}

pub(super) fn is_blank_target_url(url: &str) -> bool {
    let normalized = url.trim();
    normalized.is_empty() || normalized == "about:blank"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target_info(
        target_id: &str,
        target_type: &str,
        url: &str,
        title: &str,
        opener_id: Option<&str>,
    ) -> TargetInfo {
        let mut builder = TargetInfo::builder()
            .target_id(TargetId::new(target_id))
            .r#type(target_type)
            .title(title)
            .url(url)
            .attached(false)
            .can_access_opener(false);

        if let Some(opener_id) = opener_id {
            builder = builder.opener_id(TargetId::new(opener_id));
        }

        builder
            .build()
            .expect("target info fixture should be valid")
    }

    #[test]
    fn test_select_attach_target_prefers_non_blank_top_level_page() {
        let targets = vec![
            target_info("blank", "page", "about:blank", "", None),
            target_info(
                "popup",
                "page",
                "https://accounts.example.com",
                "Sign in",
                Some("root"),
            ),
            target_info(
                "main",
                "page",
                "https://github.com/copilot",
                "Copilot",
                None,
            ),
        ];

        let selected = select_attach_target(&targets).expect("should select a target");

        assert_eq!(selected.target_id.as_ref(), "main");
    }

    #[test]
    fn test_select_attach_target_falls_back_to_about_blank() {
        let targets = vec![target_info("blank", "page", "about:blank", "", None)];

        let selected = select_attach_target(&targets).expect("should select a target");

        assert_eq!(selected.target_id.as_ref(), "blank");
    }
}
