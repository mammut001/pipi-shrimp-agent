use async_trait::async_trait;
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchMouseEventParams, DispatchMouseEventType, MouseButton,
};
use serde::{Deserialize, Serialize};

use super::common::{
    backend_node_click_point, call_backend_node_function, ActionContext, ActionResult,
    BrowserAction, BrowserActionError, ElementReference,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClickInput {
    #[serde(flatten)]
    pub target: ElementReference,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClickOutput {
    pub backend_node_id: i64,
    pub used_fallback: bool,
    pub tag_name: Option<String>,
}

pub struct ClickAction;

#[async_trait]
impl BrowserAction for ClickAction {
    type Input = ClickInput;
    type Output = ClickOutput;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let element = ctx.resolve_element(&input.target).await?;

        if !element.is_visible || !element.is_clickable {
            return Err(BrowserActionError::element_not_interactable(format!(
                "{} is not a visible clickable element.",
                input.target.description()
            )));
        }

        if let Ok(response) = call_backend_node_function(
            &page,
            element.backend_node_id,
            r#"function() {
                if (!this || !(this instanceof Element)) {
                    return { ok: false, reason: "not_element" };
                }
                this.scrollIntoView({ block: "center", inline: "center" });
                try {
                    if (typeof this.click === "function") {
                        this.click();
                        return { ok: true, method: "js_click", tag: this.tagName };
                    }
                } catch (error) {
                    return { ok: false, reason: String(error), tag: this.tagName };
                }
                return { ok: false, reason: "missing_click", tag: this.tagName };
            }"#,
        )
        .await
        {
            if response.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
                ctx.invalidate_page_state().await;
                return Ok(ClickOutput {
                    backend_node_id: element.backend_node_id,
                    used_fallback: false,
                    tag_name: response
                        .get("tag")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                });
            }
        }

        let (x, y) = backend_node_click_point(&page, element.backend_node_id).await?;
        if x == 0.0 && y == 0.0 {
            return Err(BrowserActionError::element_not_interactable(format!(
                "{} resolved to zero coordinates in the current tab.",
                input.target.description()
            )));
        }

        let params_down = DispatchMouseEventParams::builder()
            .r#type(DispatchMouseEventType::MousePressed)
            .x(x)
            .y(y)
            .button(MouseButton::Left)
            .click_count(1)
            .build()
            .map_err(|error| {
                BrowserActionError::execution_failed(
                    "browser.action_failed",
                    format!("Failed to build mouse-down event: {}", error),
                )
            })?;

        let params_up = DispatchMouseEventParams::builder()
            .r#type(DispatchMouseEventType::MouseReleased)
            .x(x)
            .y(y)
            .button(MouseButton::Left)
            .click_count(1)
            .build()
            .map_err(|error| {
                BrowserActionError::execution_failed(
                    "browser.action_failed",
                    format!("Failed to build mouse-up event: {}", error),
                )
            })?;

        page.execute(params_down)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        page.execute(params_up)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;

        ctx.invalidate_page_state().await;
        Ok(ClickOutput {
            backend_node_id: element.backend_node_id,
            used_fallback: true,
            tag_name: element.tag_name,
        })
    }
}

pub async fn click(ctx: &ActionContext, input: ClickInput) -> ActionResult<ClickOutput> {
    let detail = Some(input.target.description());
    ctx.run_instrumented("click", detail, ClickAction.execute(ctx, input))
        .await
}