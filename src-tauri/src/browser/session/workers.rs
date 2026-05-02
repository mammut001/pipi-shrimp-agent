use std::sync::{Arc, Weak};

use chromiumoxide::browser::Browser;
use chromiumoxide::cdp::browser_protocol::dom::EventDocumentUpdated;
use chromiumoxide::cdp::browser_protocol::page::{
    EventDocumentOpened, EventFrameDetached, EventFrameNavigated, EventNavigatedWithinDocument,
};
use chromiumoxide::page::Page;
use futures::StreamExt;
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;

use crate::browser::cdp::health::CdpHealthStatus;
use crate::browser::cdp::{CdpConfig, CdpError, ChromiumoxideCdpClient, discover_browser_ws_url};
use crate::browser::observability::{BrowserBenchmarkKind, BrowserEventKind, BrowserEventLevel};
use crate::browser::session::reconnect::next_reconnect_delay;

use super::cdp_target::{select_active_page_with_client, select_attach_page_with_client};
use super::manager::BrowserSessionManager;
use super::state::BrowserLaunchMode;

impl BrowserSessionManager {
    pub fn start_background_workers(&mut self, manager_handle: Arc<Mutex<BrowserSessionManager>>) {
        self.manager_handle = Some(Arc::downgrade(&manager_handle));
        self.stop_background_workers();

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        self.worker_shutdown = Some(shutdown_tx);
        self.health_worker = Some(spawn_health_worker(manager_handle.clone(), shutdown_rx));
        let idle_shutdown_rx = self
            .worker_shutdown
            .as_ref()
            .map(|shutdown| shutdown.subscribe())
            .expect("idle worker shutdown channel should exist");
        self.idle_worker = Some(spawn_idle_worker(manager_handle.clone(), idle_shutdown_rx));
        self.restart_runtime_event_worker_if_running();
    }

    pub(super) fn stop_background_workers(&mut self) {
        if let Some(shutdown_tx) = self.worker_shutdown.take() {
            let _ = shutdown_tx.send(true);
        }
        if let Some(worker) = self.health_worker.take() {
            worker.abort();
        }
        if let Some(worker) = self.reconnect_worker.take() {
            worker.abort();
        }
        if let Some(worker) = self.runtime_event_worker.take() {
            worker.abort();
        }
        self.idle_worker.take();
    }

    pub(super) async fn disconnect_with_reason(&mut self, reason: &str, idle_cleanup: bool) {
        let launch_mode = self.session.as_ref().map(|session| session.launch_mode);
        let idle_elapsed_ms = self.idle_elapsed_ms();

        if idle_cleanup {
            let launch_mode_label = launch_mode
                .map(|mode| mode.as_str().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let benchmark = self.event_bus.build_benchmark_sample(
                format!("idle_cleanup.{}", launch_mode_label),
                format!("idle cleanup ({})", launch_mode_label),
                BrowserBenchmarkKind::IdleCleanup,
                Some(launch_mode_label.clone()),
                idle_elapsed_ms,
                true,
                Some(reason.to_string()),
                None,
                None,
                None,
            );
            self.event_bus.publish(
                BrowserEventKind::IdleCleanup,
                BrowserEventLevel::Warning,
                "Idle cleanup triggered",
                Some(reason.to_string()),
                None,
                Some(benchmark),
            );
        }

        self.stop_background_workers();

        if matches!(launch_mode, Some(BrowserLaunchMode::Launch)) {
            if let Some(browser) = self.browser.as_mut() {
                let _ = tokio::time::timeout(self.config.timeout, browser.close()).await;
            }
        }

        if let Some(handler) = self.handler.take() {
            handler.abort();
        }

        self.page = None;
        self.browser = None;
        self.session = None;
        self.snapshot_cache.clear();

        let previous_status = self.health.status;
        self.health.mark_disconnected();
        self.emit_health_event_if_changed(previous_status);
        self.event_bus.publish(
            BrowserEventKind::Disconnected,
            BrowserEventLevel::Warning,
            "Browser disconnected",
            Some(reason.to_string()),
            None,
            None,
        );
    }

    pub(super) fn restart_runtime_event_worker_if_running(&mut self) {
        if let Some(worker) = self.runtime_event_worker.take() {
            worker.abort();
        }

        let Some(manager_handle) = self.manager_handle.as_ref().and_then(Weak::upgrade) else {
            return;
        };
        let Some(shutdown_rx) = self
            .worker_shutdown
            .as_ref()
            .map(|shutdown| shutdown.subscribe())
        else {
            return;
        };

        self.runtime_event_worker = Some(spawn_runtime_event_worker(manager_handle, shutdown_rx));
    }
}

fn spawn_health_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let ping_interval = {
            let manager = manager_handle.lock().await;
            manager.config.ping_interval
        };
        let mut ticker = tokio::time::interval(ping_interval);

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    break;
                }
                _ = ticker.tick() => {
                    let snapshot = {
                        let manager = manager_handle.lock().await;
                        manager.worker_snapshot()
                    };

                    let Some(snapshot) = snapshot else {
                        continue;
                    };

                    match snapshot.client.page_url(&snapshot.page).await {
                        Ok(current_url) => {
                            let mut manager = manager_handle.lock().await;
                            manager.record_ping_success(current_url);
                        }
                        Err(error) => {
                            let should_reconnect = {
                                let mut manager = manager_handle.lock().await;
                                if manager.reconnect_worker_running() {
                                    manager.mark_reconnecting(error.to_string());
                                    false
                                } else {
                                    manager.record_ping_failure(error.to_string())
                                }
                            };

                            if should_reconnect {
                                maybe_spawn_reconnect_worker(manager_handle.clone()).await;
                            }
                        }
                    }
                }
            }
        }
    })
}

fn spawn_idle_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let idle_check_interval = {
            let manager = manager_handle.lock().await;
            manager.config.idle_check_interval
        };
        let mut ticker = tokio::time::interval(idle_check_interval);

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    break;
                }
                _ = ticker.tick() => {
                    let should_cleanup = {
                        let manager = manager_handle.lock().await;
                        manager.has_connection() && manager.idle_timed_out()
                    };

                    if !should_cleanup {
                        continue;
                    }

                    let mut manager = manager_handle.lock().await;
                    if manager.has_connection() && manager.idle_timed_out() {
                        let session_id = manager
                            .session
                            .as_ref()
                            .and_then(|session| session.session_id.clone())
                            .or_else(|| manager.session.as_ref().and_then(|session| session.target_id.clone()))
                            .unwrap_or_else(|| "browser-session".to_string());
                        let _ = manager
                            .cleanup_session(&session_id, super::cleanup::CleanupReason::Timeout)
                            .await;
                    }
                }
            }
        }
    })
}

fn spawn_runtime_event_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let page = {
            let manager = manager_handle.lock().await;
            manager.page_cloned()
        };

        let Some(page) = page else {
            return;
        };

        let mut frame_navigated = match page.event_listener::<EventFrameNavigated>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut navigated_within_document =
            match page.event_listener::<EventNavigatedWithinDocument>().await {
                Ok(stream) => stream,
                Err(_) => return,
            };
        let mut frame_detached = match page.event_listener::<EventFrameDetached>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut document_opened = match page.event_listener::<EventDocumentOpened>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut document_updated = match page.event_listener::<EventDocumentUpdated>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };

        loop {
            tokio::select! {
                biased;
                _ = shutdown_rx.changed() => {
                    break;
                }
                event = frame_navigated.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_frame_navigated");
                }
                event = navigated_within_document.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_same_document_navigation");
                }
                event = frame_detached.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_frame_detached");
                }
                event = document_updated.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    if !manager.invalidate_page_state_for_runtime_event("cdp_dom_document_updated") {
                        let upgraded_from_document_opened = manager.upgrade_runtime_event_invalidation_reason(
                            "cdp_document_opened",
                            "cdp_dom_document_updated",
                        );
                        if !upgraded_from_document_opened {
                            manager.upgrade_runtime_event_invalidation_reason(
                                "cdp_frame_detached",
                                "cdp_dom_document_updated",
                            );
                        }
                    }
                }
                event = document_opened.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_document_opened");
                }
            }
        }
    })
}

async fn maybe_spawn_reconnect_worker(manager_handle: Arc<Mutex<BrowserSessionManager>>) {
    let mut manager = manager_handle.lock().await;
    if manager.reconnect_worker_running() {
        return;
    }

    let Some(shutdown_rx) = manager.worker_shutdown.as_ref().map(|tx| tx.subscribe()) else {
        return;
    };

    manager.reconnect_worker = Some(spawn_reconnect_worker(manager_handle.clone(), shutdown_rx));
}

fn spawn_reconnect_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut attempt = 0_u32;

        loop {
            let (launch_mode, config) = {
                let mut manager = manager_handle.lock().await;

                if manager.health.status == CdpHealthStatus::Healthy {
                    manager.clear_reconnect_worker();
                    return;
                }

                let Some(session) = manager.session_snapshot() else {
                    manager.clear_reconnect_worker();
                    return;
                };

                manager.mark_reconnecting(format!("reconnect attempt {}", attempt + 1));
                (session.launch_mode, manager.config.clone())
            };

            let delay = next_reconnect_delay(attempt, &config);
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    let mut manager = manager_handle.lock().await;
                    manager.clear_reconnect_worker();
                    return;
                }
                _ = tokio::time::sleep(delay) => {}
            }

            let reconnect_result = match discover_browser_ws_url(&config).await {
                Ok(ws_url) => build_runtime_from_ws_url(&config, launch_mode, ws_url).await,
                Err(error) => Err(error),
            };

            match reconnect_result {
                Ok(runtime) => {
                    let mut manager = manager_handle.lock().await;
                    if let Err(error) = manager
                        .replace_runtime(
                            runtime.browser,
                            runtime.page,
                            runtime.handler,
                            runtime.ws_url,
                            runtime.launch_mode,
                        )
                        .await
                    {
                        manager.health.mark_failed(error.to_string());
                        manager.sync_session_health();
                        attempt = attempt.saturating_add(1);
                        continue;
                    }
                    manager.clear_reconnect_worker();
                    return;
                }
                Err(error) => {
                    let mut manager = manager_handle.lock().await;
                    manager.mark_reconnecting(error.to_string());
                }
            }

            attempt = attempt.saturating_add(1);
        }
    })
}

struct ConnectedRuntime {
    browser: Browser,
    page: Page,
    handler: JoinHandle<()>,
    ws_url: String,
    launch_mode: BrowserLaunchMode,
}

async fn build_runtime_from_ws_url(
    config: &CdpConfig,
    launch_mode: BrowserLaunchMode,
    ws_url: String,
) -> Result<ConnectedRuntime, CdpError> {
    let client = ChromiumoxideCdpClient::new(config.clone());
    let (mut browser, handler) = client.connect(&ws_url).await?;
    let page = match launch_mode {
        BrowserLaunchMode::Attach => select_attach_page_with_client(&client, &mut browser).await?,
        BrowserLaunchMode::Launch => select_active_page_with_client(&client, &browser).await?,
    };

    Ok(ConnectedRuntime {
        browser,
        page,
        handler,
        ws_url,
        launch_mode,
    })
}
