use std::time::{Duration, Instant};

use crate::browser::cdp::{discover_browser_ws_url, CdpError};

use super::manager::{duration_as_ms, BrowserSessionManager};
use super::state::{BrowserLaunchMode, BrowserSession};

impl BrowserSessionManager {
    pub async fn connect_attach(&mut self) -> Result<BrowserSession, CdpError> {
        if self.has_connection() {
            return self.session_snapshot().ok_or_else(|| {
                CdpError::Session(
                    "Manager is connected but session metadata is missing".to_string(),
                )
            });
        }

        let connect_started_at = Instant::now();
        let previous_status = self.health.status;
        self.health.mark_connecting();
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();

        let result: Result<BrowserSession, CdpError> = async {
            let ws_url = discover_browser_ws_url(&self.config).await?;
            self.connect_with_ws_url(ws_url, BrowserLaunchMode::Attach)
                .await
        }
        .await;

        if let Err(error) = &result {
            let previous_status = self.health.status;
            self.health.mark_failed(error.to_string());
            self.emit_health_event_if_changed(previous_status);
            self.sync_session_health();
            self.record_connect_benchmark(
                BrowserLaunchMode::Attach,
                duration_as_ms(connect_started_at.elapsed()),
                false,
                Some(error.to_string()),
            );
        } else {
            self.record_connect_benchmark(
                BrowserLaunchMode::Attach,
                duration_as_ms(connect_started_at.elapsed()),
                true,
                None,
            );
        }

        result
    }

    pub async fn connect_launch(&mut self) -> Result<BrowserSession, CdpError> {
        if self.has_connection() {
            return self.session_snapshot().ok_or_else(|| {
                CdpError::Session(
                    "Manager is connected but session metadata is missing".to_string(),
                )
            });
        }

        let connect_started_at = Instant::now();
        let previous_status = self.health.status;
        self.health.mark_connecting();
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();
        let deadline = Instant::now() + self.config.timeout;

        let timeout_error = loop {
            match discover_browser_ws_url(&self.config).await {
                Ok(ws_url) => {
                    let result = self
                        .connect_with_ws_url(ws_url, BrowserLaunchMode::Launch)
                        .await;
                    if let Err(error) = &result {
                        let previous_status = self.health.status;
                        self.health.mark_failed(error.to_string());
                        self.emit_health_event_if_changed(previous_status);
                        self.sync_session_health();
                        self.record_connect_benchmark(
                            BrowserLaunchMode::Launch,
                            duration_as_ms(connect_started_at.elapsed()),
                            false,
                            Some(error.to_string()),
                        );
                    } else {
                        self.record_connect_benchmark(
                            BrowserLaunchMode::Launch,
                            duration_as_ms(connect_started_at.elapsed()),
                            true,
                            None,
                        );
                    }
                    return result;
                }
                Err(error) => {
                    let error_message = error.to_string();

                    if Instant::now() >= deadline {
                        break CdpError::Discovery(format!(
                            "Chrome debug port did not become ready within {}ms: {}",
                            self.config.timeout.as_millis(),
                            error_message
                        ));
                    }

                    let previous_status = self.health.status;
                    self.health.mark_reconnecting(error_message);
                    self.emit_health_event_if_changed(previous_status);
                    self.sync_session_health();
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        };

        let previous_status = self.health.status;
        self.health.mark_failed(timeout_error.to_string());
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();
        self.record_connect_benchmark(
            BrowserLaunchMode::Launch,
            duration_as_ms(connect_started_at.elapsed()),
            false,
            Some(timeout_error.to_string()),
        );
        Err(timeout_error)
    }

    pub async fn resync_page(&mut self) -> Result<(), CdpError> {
        let browser = self
            .browser
            .as_ref()
            .ok_or_else(|| CdpError::Session("Browser not connected".to_string()))?;

        let active_page = self.select_active_page(browser).await?;
        self.page = Some(active_page);
        self.restart_runtime_event_worker_if_running();
        self.refresh_session_metadata().await?;
        self.touch_activity();
        self.record_navigation_event(
            self.session
                .as_ref()
                .and_then(|session| session.current_url.clone()),
            Some("Page reference re-synced".to_string()),
        );
        self.invalidate_page_state();
        Ok(())
    }

    pub async fn refresh_connection_metadata(&mut self) -> Result<(), CdpError> {
        self.refresh_session_metadata().await
    }
}
