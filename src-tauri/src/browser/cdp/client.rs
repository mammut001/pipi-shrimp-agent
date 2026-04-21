use chromiumoxide::browser::Browser;
use chromiumoxide::cdp::browser_protocol::target::TargetInfo;
use chromiumoxide::page::Page;
use futures::StreamExt;
use tokio::task::JoinHandle;

use super::{run_with_timeout, CdpConfig, CdpError};

#[derive(Debug, Clone)]
pub struct ChromiumoxideCdpClient {
    config: CdpConfig,
}

impl ChromiumoxideCdpClient {
    pub fn new(config: CdpConfig) -> Self {
        Self { config }
    }

    pub async fn connect(&self, ws_url: &str) -> Result<(Browser, JoinHandle<()>), CdpError> {
        let (browser, mut handler) = run_with_timeout(
            "Browser::connect",
            self.config.timeout,
            Browser::connect(ws_url),
        )
        .await?
        .map_err(|error| CdpError::Connection(format!(
            "Unable to connect to CDP websocket {}: {}",
            ws_url, error
        )))?;

        let handle = tokio::spawn(async move {
            while let Some(_event) = handler.next().await {}
        });

        Ok((browser, handle))
    }

    pub async fn list_pages(&self, browser: &Browser) -> Result<Vec<Page>, CdpError> {
        run_with_timeout("Browser::pages", self.config.timeout, browser.pages())
            .await?
            .map_err(|error| CdpError::Session(format!("Unable to list browser pages: {}", error)))
    }

    pub async fn fetch_targets(&self, browser: &mut Browser) -> Result<Vec<TargetInfo>, CdpError> {
        run_with_timeout("Browser::fetch_targets", self.config.timeout, browser.fetch_targets())
            .await?
            .map_err(|error| CdpError::Session(format!("Unable to fetch browser targets: {}", error)))
    }

    pub async fn new_page(&self, browser: &Browser, url: &str) -> Result<Page, CdpError> {
        run_with_timeout("Browser::new_page", self.config.timeout, browser.new_page(url))
            .await?
            .map_err(|error| CdpError::Session(format!(
                "Unable to create browser page '{}': {}",
                url, error
            )))
    }

    pub async fn page_url(&self, page: &Page) -> Result<Option<String>, CdpError> {
        run_with_timeout("Page::url", self.config.timeout, page.url())
            .await?
            .map_err(|error| CdpError::Session(format!("Unable to read page url: {}", error)))
    }
}