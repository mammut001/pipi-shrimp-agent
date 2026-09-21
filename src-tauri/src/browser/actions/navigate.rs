use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::{
    ActionContext, ActionResult, ActionTimeoutPolicy, BrowserAction, BrowserActionError,
};
use super::wait::wait_for_selector;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavigateInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait_selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavigateOutput {
    pub current_url: Option<String>,
    pub title: Option<String>,
    pub waited_for_selector: bool,
}

pub struct NavigateAction;

/// AUDIT-FIX [R2-10] — CDP `page.goto` must only accept http(s) (plus exact
/// `about:blank` used for blank-page launches). Rejects `file`, `javascript`,
/// `data`, and other non-http(s) schemes before any CDP call.
pub(crate) fn assert_http_navigation_url(url: &str) -> Result<(), BrowserActionError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(BrowserActionError::navigation_failed(
            "navigation URL cannot be empty",
        ));
    }

    // Exact blank page only — used by session/new_page launches.
    if trimmed == "about:blank" {
        return Ok(());
    }

    let scheme = trimmed
        .split_once(':')
        .map(|(scheme, _)| scheme)
        .unwrap_or("");

    if scheme.is_empty() {
        return Err(BrowserActionError::navigation_failed(format!(
            "Blocked navigation: URL must use http or https scheme (got no scheme): {trimmed}"
        )));
    }

    let scheme_lower = scheme.to_ascii_lowercase();
    let rest = &trimmed[scheme.len()..];
    let is_http_absolute =
        (scheme_lower == "http" || scheme_lower == "https") && rest.starts_with("://");

    if is_http_absolute {
        return Ok(());
    }

    Err(BrowserActionError::navigation_failed(format!(
        "Blocked navigation to non-http(s) URL scheme '{scheme}': only http, https, and about:blank are allowed"
    )))
}

#[async_trait]
impl BrowserAction for NavigateAction {
    type Input = NavigateInput;
    type Output = NavigateOutput;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let url = input
            .url
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        if let Some(url) = url.as_ref() {
            assert_http_navigation_url(url)?;

            let nav_timeout_ms = input
                .timeout_ms
                .unwrap_or_else(|| ActionTimeoutPolicy::default().timeout_ms);
            let nav_timeout = std::time::Duration::from_millis(nav_timeout_ms);

            tokio::time::timeout(nav_timeout, page.goto(url))
                .await
                .map_err(|_| {
                    BrowserActionError::navigation_failed(format!(
                        "goto 超时（{}ms），URL: {}",
                        nav_timeout_ms, url
                    ))
                })?
                .map_err(|error| BrowserActionError::navigation_failed(error.to_string()))?;

            // wait_for_navigation 仅尽力而为：page.goto 已经发起并通常已完成导航。
            // 某些站点（如 GitHub Turbo 这类带持久连接 / SPA 的页面）不会再触发
            // 终态 load 事件，若在此硬等下一次导航会一直卡到超时并误报“导航失败”。
            // 因此这里超时即视为已稳定，继续后续状态采集。
            let settle_timeout = std::time::Duration::from_millis(nav_timeout_ms.min(8_000));
            let _ = tokio::time::timeout(settle_timeout, page.wait_for_navigation()).await;
        }

        let waited_for_selector = if let Some(selector) = input
            .wait_selector
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            wait_for_selector(
                &page,
                selector,
                input
                    .timeout_ms
                    .unwrap_or_else(|| ActionTimeoutPolicy::default().timeout_ms.min(10_000)),
            )
            .await?;
            true
        } else {
            false
        };

        ctx.refresh_connection_metadata().await?;
        ctx.invalidate_page_state().await;

        let title = page
            .evaluate("(function() { return document.title; })()")
            .await
            .ok()
            .and_then(|value| value.into_value::<String>().ok());

        let current_url = ctx
            .capture_page_state()
            .await
            .ok()
            .map(|page_state| page_state.url);

        Ok(NavigateOutput {
            current_url,
            title,
            waited_for_selector,
        })
    }
}

pub async fn navigate(ctx: &ActionContext, input: NavigateInput) -> ActionResult<NavigateOutput> {
    let detail = input.url.clone().or_else(|| input.wait_selector.clone());
    let result = ctx
        .run_instrumented("navigate", detail, NavigateAction.execute(ctx, input))
        .await;

    if let Ok(output) = &result {
        ctx.record_navigation(output.title.clone(), output.current_url.clone())
            .await;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::assert_http_navigation_url;

    fn assert_blocked(url: &str) {
        let err = assert_http_navigation_url(url).expect_err("expected blocked URL");
        assert_eq!(err.code, "browser.navigation_failed");
        assert!(
            err.message.contains("Blocked") || err.message.contains("cannot be empty"),
            "unexpected message for {url}: {}",
            err.message
        );
    }

    #[test]
    fn test_file_scheme_rejected() {
        assert_blocked("file:///etc/passwd");
        assert_blocked("FILE:///tmp/secret");
        assert_blocked("file://localhost/tmp/x");
    }

    #[test]
    fn test_http_https_schemes_allowed() {
        assert_http_navigation_url("https://example.com").unwrap();
        assert_http_navigation_url("http://example.com/path?q=1").unwrap();
        assert_http_navigation_url("  HTTPS://Example.COM  ").unwrap();
        assert_http_navigation_url("HTTP://127.0.0.1:8080/").unwrap();
    }

    #[test]
    fn test_dangerous_and_non_http_schemes_rejected() {
        assert_blocked("javascript:alert(1)");
        assert_blocked("data:text/html,hi");
        assert_blocked("about:srcdoc");
        assert_blocked("about:blank#frag");
        assert_blocked("blob:https://example.com/uuid");
        assert_blocked("chrome://settings");
        assert_blocked("example.com");
        assert_blocked("//evil.example");
        assert_blocked("");
        assert_blocked("   ");
    }

    #[test]
    fn test_about_blank_exact_allowed() {
        assert_http_navigation_url("about:blank").unwrap();
        assert_blocked("ABOUT:blank");
        assert_blocked("about:BLANK");
    }

    #[test]
    fn test_reject_message_mentions_scheme() {
        let err = assert_http_navigation_url("file:///etc/passwd").unwrap_err();
        assert!(
            err.message.contains("file"),
            "message should mention scheme: {}",
            err.message
        );
    }
}
