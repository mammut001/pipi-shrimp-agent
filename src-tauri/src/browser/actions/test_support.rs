use std::sync::Arc;
use std::time::Duration;
use std::path::PathBuf;

use anyhow::{Context, Result};
use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::page::Page;
use futures::StreamExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::browser::cdp::CdpConfig;
use crate::browser::dom::{build_page_state_from_snapshot, CapturedPageSnapshot, InteractiveElement, PageState};
use crate::browser::session::BrowserSessionManager;
use crate::browser::session::state::BrowserLaunchMode;

use super::{ActionContext, ActionResult, ElementReference};

const PARTIAL_WARNING_ROOT_HOST: &str = "warning-root.test";
const PARTIAL_WARNING_FRAME_HOST: &str = "warning-frame.test";

pub fn load_snapshot_fixture(name: &str) -> CapturedPageSnapshot {
    let raw = match name {
        "iframe-shadow" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/browser-page-state-iframe-shadow.json"
        )),
        "iframe-retry-cache" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/browser-page-state-iframe-retry-cache.json"
        )),
        "navigation-refresh" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/browser-page-state-navigation-refresh.json"
        )),
        "partial-warnings" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/browser-page-state-partial-warnings.json"
        )),
        other => panic!("unknown fixture: {}", other),
    };

    serde_json::from_str(raw).expect("fixture should deserialize into CapturedPageSnapshot")
}

pub fn load_page_state_fixture(name: &str) -> PageState {
    build_page_state_from_snapshot(load_snapshot_fixture(name))
}

#[derive(Clone)]
pub struct FixtureActionHarness {
    ctx: ActionContext,
    manager: Arc<Mutex<BrowserSessionManager>>,
}

impl FixtureActionHarness {
    pub async fn new(cached_page_state: Option<PageState>, queued_page_states: Vec<PageState>) -> Self {
        let manager = Arc::new(Mutex::new(BrowserSessionManager::new(CdpConfig::default())));
        {
            let mut manager_guard = manager.lock().await;
            if let Some(page_state) = cached_page_state {
                manager_guard.set_cached_page_state_for_test(page_state);
            }
            for page_state in queued_page_states {
                manager_guard.enqueue_page_state_capture_for_test(Ok(page_state));
            }
        }

        Self {
            ctx: ActionContext::new(manager.clone()),
            manager,
        }
    }

    pub fn ctx(&self) -> &ActionContext {
        &self.ctx
    }

    pub async fn resolve_element(&self, reference: ElementReference) -> ActionResult<InteractiveElement> {
        self.ctx.resolve_element(&reference).await
    }

    pub async fn capture_count(&self) -> usize {
        self.manager.lock().await.page_state_capture_count_for_test()
    }
}

pub struct CheckoutFlowServer {
    base_url: String,
    port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl CheckoutFlowServer {
    pub async fn start() -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("failed to bind checkout flow test server")?;
        let address = listener
            .local_addr()
            .context("failed to read checkout flow test server address")?;
        let port = address.port();
        let base_url = format!("http://{}", address);
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        let partial_warning_frame_origin = format!("http://{}:{}", PARTIAL_WARNING_FRAME_HOST, port);
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accept_result = listener.accept() => {
                        let (mut socket, _) = match accept_result {
                            Ok(value) => value,
                            Err(_) => break,
                        };
                        let partial_warning_frame_origin = partial_warning_frame_origin.clone();
                        tokio::spawn(async move {
                            let mut buffer = [0_u8; 4096];
                            let bytes_read = match socket.read(&mut buffer).await {
                                Ok(value) => value,
                                Err(_) => return,
                            };
                            if bytes_read == 0 {
                                return;
                            }

                            let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                            let path = request
                                .lines()
                                .next()
                                .and_then(|line| line.split_whitespace().nth(1))
                                .unwrap_or("/");

                            let (status, content_type, body) = match path {
                                "/" | "/checkout" => (
                                    "200 OK",
                                    "text/html; charset=utf-8",
                                    checkout_flow_root_html("Checkout Flow", "/iframe-payment"),
                                ),
                                "/dom-rewrite" => (
                                    "200 OK",
                                    "text/html; charset=utf-8",
                                    dom_rewrite_root_html().to_string(),
                                ),
                                "/shadow-checkout" => (
                                    "200 OK",
                                    "text/html; charset=utf-8",
                                    checkout_flow_root_html("Shadow Checkout Flow", "/iframe-shadow-payment"),
                                ),
                                "/partial-warning-checkout" => (
                                    "200 OK",
                                    "text/html; charset=utf-8",
                                    partial_warning_root_html(&partial_warning_frame_origin),
                                ),
                                "/iframe-payment" => (
                                    "200 OK",
                                    "text/html; charset=utf-8",
                                    checkout_flow_iframe_html().to_string(),
                                ),
                                "/iframe-shadow-payment" => (
                                    "200 OK",
                                    "text/html; charset=utf-8",
                                    shadow_checkout_flow_iframe_html().to_string(),
                                ),
                                _ => (
                                    "404 Not Found",
                                    "text/plain; charset=utf-8",
                                    "not found".to_string(),
                                ),
                            };

                            let response = format!(
                                "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                status,
                                content_type,
                                body.as_bytes().len(),
                                body,
                            );

                            let _ = socket.write_all(response.as_bytes()).await;
                            let _ = socket.shutdown().await;
                        });
                    }
                }
            }
        });

        Ok(Self {
            base_url,
            port,
            shutdown_tx: Some(shutdown_tx),
            task,
        })
    }

    pub fn checkout_url(&self) -> String {
        self.url("/checkout")
    }

    pub fn shadow_checkout_url(&self) -> String {
        self.url("/shadow-checkout")
    }

    pub fn dom_rewrite_url(&self) -> String {
        self.url("/dom-rewrite")
    }

    pub fn partial_warning_checkout_url(&self) -> String {
        format!(
            "http://{}:{}{}",
            PARTIAL_WARNING_ROOT_HOST,
            self.port,
            "/partial-warning-checkout"
        )
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    pub async fn shutdown(self) -> Result<()> {
        let Self {
            base_url: _,
            port: _,
            shutdown_tx,
            task,
        } = self;

        if let Some(shutdown_tx) = shutdown_tx {
            let _ = shutdown_tx.send(());
        }

        task.await.context("checkout flow test server task failed")?;
        Ok(())
    }
}

pub struct LiveActionHarness {
    ctx: ActionContext,
    manager: Arc<Mutex<BrowserSessionManager>>,
    browser: Browser,
    page: Page,
    handler_task: JoinHandle<()>,
    user_data_dir: PathBuf,
}

impl LiveActionHarness {
    pub async fn launch() -> Result<Self> {
        Self::launch_with_args(Vec::new()).await
    }

    pub async fn launch_site_isolated() -> Result<Self> {
        let host_resolver_rules = format!(
            "MAP {} 127.0.0.1,MAP {} 127.0.0.1",
            PARTIAL_WARNING_ROOT_HOST,
            PARTIAL_WARNING_FRAME_HOST
        );

        Self::launch_with_args(vec![
            "--site-per-process".to_string(),
            format!("--host-resolver-rules={}", host_resolver_rules),
        ])
        .await
    }

    async fn launch_with_args(args: Vec<String>) -> Result<Self> {
        let user_data_dir = std::env::temp_dir().join(format!(
            "pipi-shrimp-browser-action-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&user_data_dir)
            .with_context(|| format!("failed to create browser test profile dir {}", user_data_dir.display()))?;

        let mut config_builder = BrowserConfig::builder()
            .no_sandbox()
            .user_data_dir(&user_data_dir)
            .request_timeout(Duration::from_secs(5))
            .launch_timeout(Duration::from_secs(20));
        if !args.is_empty() {
            config_builder = config_builder.args(args);
        }

        let config = config_builder
            .build()
            .map_err(|error| anyhow::anyhow!("failed to build Chromiumoxide browser config: {}", error))?;

        let (browser, mut handler) = Browser::launch(config)
            .await
            .map_err(|error| {
                let _ = std::fs::remove_dir_all(&user_data_dir);
                error
            })
            .context("failed to launch Chromiumoxide browser")?;

        let handler_task = tokio::spawn(async move {
            while let Some(event) = handler.next().await {
                let _ = event;
            }
        });

        let page = browser
            .new_page("about:blank")
            .await
            .context("failed to create Chromiumoxide test page")?;

        let manager = Arc::new(Mutex::new(BrowserSessionManager::new(CdpConfig::default())));
        {
            let mut manager_guard = manager.lock().await;
            manager_guard
                .install_connected_page_for_test(page.clone(), BrowserLaunchMode::Launch)
                .await
                .context("failed to install live test page into BrowserSessionManager")?;
        }

        Ok(Self {
            ctx: ActionContext::new(manager.clone()),
            manager,
            browser,
            page,
            handler_task,
            user_data_dir,
        })
    }

    pub fn ctx(&self) -> &ActionContext {
        &self.ctx
    }

    pub fn manager(&self) -> Arc<Mutex<BrowserSessionManager>> {
        self.manager.clone()
    }

    pub async fn start_background_workers(&self) {
        let mut manager_guard = self.manager.lock().await;
        manager_guard.start_background_workers(self.manager.clone());
    }

    pub fn page(&self) -> &Page {
        &self.page
    }

    pub async fn shutdown(self) -> Result<()> {
        let Self {
            ctx: _,
            manager,
            mut browser,
            page,
            handler_task,
            user_data_dir,
        } = self;

        manager.lock().await.disconnect().await;

        let _ = page.close().await;
        browser
            .close()
            .await
            .context("failed to close Chromiumoxide browser")?;
        let _ = browser.wait().await;
        handler_task.abort();
        let _ = handler_task.await;
        let _ = std::fs::remove_dir_all(user_data_dir);
        Ok(())
    }
}

fn checkout_flow_root_html(title: &str, iframe_src: &str) -> String {
        format!(r#"<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
        <title>{title}</title>
    <style>
            body {{ font-family: sans-serif; padding: 24px; }}
            #payment-frame {{ width: 460px; height: 220px; border: 1px solid #ccc; }}
            #page-ready, #late-ready, #payment-status {{ margin-bottom: 12px; }}
    </style>
  </head>
  <body>
    <div id="page-ready">warming</div>
        <div id="late-ready">warming</div>
    <div id="payment-status">pending</div>
        <iframe id="payment-frame" src="{iframe_src}" title="payment"></iframe>
    <script>
            setTimeout(() => {{
        const ready = document.querySelector('#page-ready');
        ready.textContent = 'ready';
        ready.classList.add('ready');
            }}, 150);

            setTimeout(() => {{
                const lateReady = document.querySelector('#late-ready');
                lateReady.textContent = 'ready';
                lateReady.classList.add('ready');
            }}, 450);

            window.addEventListener('message', (event) => {{
                if (!event.data || event.data.type !== 'payment-confirmed') {{
          return;
                }}

        const status = document.querySelector('#payment-status');
        status.textContent = 'confirmed:' + event.data.value;
        status.classList.add('ready');
            }});
    </script>
  </body>
</html>
"#, title = title, iframe_src = iframe_src)
}

fn checkout_flow_iframe_html() -> &'static str {
    r#"<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Payment Frame</title>
  </head>
  <body>
        <label>
            Card number
            <input id="card-number" type="text" placeholder="Card number" />
        </label>
        <button id="confirm-payment">Confirm Payment</button>
    <script>
            document.querySelector('#confirm-payment').addEventListener('click', () => {
        parent.postMessage(
          {
            type: 'payment-confirmed',
                        value: document.querySelector('#card-number').value,
          },
          '*'
        );
      });
    </script>
  </body>
</html>
"#
}

fn dom_rewrite_root_html() -> &'static str {
        r#"<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>DOM Rewrite Playground</title>
        <style>
            body { font-family: sans-serif; padding: 24px; }
            #page-ready, #rewrite-status { margin-bottom: 12px; }
        </style>
    </head>
    <body>
        <div id="page-ready">warming</div>
        <div id="rewrite-status">pending</div>
        <button id="rewrite-action" type="button">Rewrite</button>
        <script>
            setTimeout(() => {
                const ready = document.querySelector('#page-ready');
                ready.textContent = 'ready';
                ready.classList.add('ready');
            }, 150);
        </script>
    </body>
</html>
"#
}

fn shadow_checkout_flow_iframe_html() -> &'static str {
        r#"<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>Shadow Payment Frame</title>
    </head>
    <body>
        <div id="shadow-host"></div>
        <script>
            const host = document.querySelector('#shadow-host');
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = `
                <style>
                    label, button { display: block; margin: 12px 0; font-family: sans-serif; }
                    input { width: 320px; height: 36px; }
                    button { height: 40px; }
                </style>
                <label>
                    Shadow card number
                    <input id="shadow-card-number" type="text" placeholder="Shadow card number" />
                </label>
                <button id="shadow-confirm-payment" type="button">Confirm Shadow Payment</button>
            `;

            root.querySelector('#shadow-confirm-payment').addEventListener('click', () => {
                parent.postMessage(
                    {
                        type: 'payment-confirmed',
                        value: root.querySelector('#shadow-card-number').value,
                    },
                    '*'
                );
            });
        </script>
    </body>
</html>
"#
}

fn partial_warning_root_html(frame_origin: &str) -> String {
    format!(r#"<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>Partial Warning Checkout</title>
        <style>
            body {{ font-family: sans-serif; padding: 24px; }}
            #warning-frame {{ width: 460px; height: 220px; border: 1px solid #ccc; }}
            #page-ready, #warning-status {{ margin-bottom: 12px; }}
        </style>
    </head>
    <body>
        <div id="page-ready">warming</div>
        <div id="frame-ready">waiting-frame</div>
        <div id="warning-status">pending</div>
        <button id="warning-root-action" type="button">Open Support</button>
        <iframe id="warning-frame" src="{frame_origin}/iframe-payment" title="cross-origin payment frame"></iframe>
        <script>
            setTimeout(() => {{
                const ready = document.querySelector('#page-ready');
                ready.textContent = 'ready';
                ready.classList.add('ready');
            }}, 150);

            document.querySelector('#warning-frame').addEventListener('load', () => {{
                const frameReady = document.querySelector('#frame-ready');
                frameReady.textContent = 'ready';
                frameReady.classList.add('ready');
            }});

            document.querySelector('#warning-root-action').addEventListener('click', () => {{
                const status = document.querySelector('#warning-status');
                status.textContent = 'support-opened';
                status.classList.add('ready');
            }});
        </script>
    </body>
</html>
"#, frame_origin = frame_origin)
}