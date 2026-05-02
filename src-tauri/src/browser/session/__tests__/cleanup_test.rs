use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

use tokio::sync::watch;

use crate::browser::cdp::CdpConfig;
use crate::browser::dom::{PageState, PageViewport};
use crate::browser::session::cleanup::{CleanupReason, SessionCleanup};
use crate::browser::session::manager::BrowserSessionManager;
use crate::browser::session::state::{BrowserLaunchMode, BrowserSession};

struct TaskDropGuard {
    counter: Arc<AtomicUsize>,
}

impl Drop for TaskDropGuard {
    fn drop(&mut self) {
        self.counter.fetch_add(1, Ordering::SeqCst);
    }
}

fn test_page_state(seed: usize) -> PageState {
    PageState {
        url: format!("https://example.com/{seed}"),
        title: format!("Page {seed}"),
        navigation_id: format!("nav-{seed}"),
        frame_count: 1,
        viewport: Some(PageViewport {
            page_x: 0.0,
            page_y: 0.0,
            width: 1280.0,
            height: 720.0,
        }),
        warnings: vec![],
        elements: vec![],
        screenshot: None,
    }
}

fn spawn_abortable_task(counter: Arc<AtomicUsize>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let _guard = TaskDropGuard { counter };
        std::future::pending::<()>().await;
    })
}

fn spawn_shutdown_task(
    counter: Arc<AtomicUsize>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let _guard = TaskDropGuard { counter };
        let _ = shutdown_rx.changed().await;
    })
}

#[tokio::test]
async fn cleanup_session_releases_workers_and_snapshot_cache_across_repeated_cycles() {
    const ITERATIONS: usize = 1000;
    let drop_counter = Arc::new(AtomicUsize::new(0));

    for iteration in 0..ITERATIONS {
        let mut manager = BrowserSessionManager::new(CdpConfig::default());
        manager.session = Some(BrowserSession::new(
            format!("ws://127.0.0.1:9222/devtools/browser/{iteration}"),
            BrowserLaunchMode::Attach,
            manager.health.clone(),
        ));
        manager.set_cached_page_state_for_test(test_page_state(iteration));

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        manager.worker_shutdown = Some(shutdown_tx);
        manager.health_worker = Some(spawn_shutdown_task(drop_counter.clone(), shutdown_rx.clone()));
        manager.idle_worker = Some(spawn_shutdown_task(drop_counter.clone(), shutdown_rx.clone()));
        manager.runtime_event_worker = Some(spawn_shutdown_task(drop_counter.clone(), shutdown_rx));
        manager.reconnect_worker = Some(spawn_abortable_task(drop_counter.clone()));
        manager.handler = Some(spawn_abortable_task(drop_counter.clone()));

        assert_eq!(manager.snapshot_cache_entry_count_for_test(), 1);

        manager
            .cleanup_session(&format!("session-{iteration}"), CleanupReason::TaskFailed)
            .await
            .expect("cleanup should succeed");
        tokio::task::yield_now().await;

        assert!(manager.session.is_none());
        assert!(manager.browser.is_none());
        assert!(manager.page.is_none());
        assert!(manager.handler.is_none());
        assert!(manager.health_worker.is_none());
        assert!(manager.reconnect_worker.is_none());
        assert!(manager.runtime_event_worker.is_none());
        assert!(manager.idle_worker.is_none());
        assert!(manager.worker_shutdown.is_none());
        assert_eq!(manager.snapshot_cache_entry_count_for_test(), 0);
        assert!(!manager.has_connection());
    }

    assert!(
        drop_counter.load(Ordering::SeqCst) >= ITERATIONS * 5,
        "expected aborted/shutdown tasks to be dropped during cleanup"
    );
}
