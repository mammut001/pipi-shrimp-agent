use async_trait::async_trait;
use chromiumoxide::cdp::browser_protocol::input::{DispatchKeyEventParams, DispatchKeyEventType};
use serde::{Deserialize, Serialize};

use super::common::{
    call_backend_node_function, ActionContext, ActionResult, BrowserAction, BrowserActionError,
    ElementReference,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TypeTextInput {
    #[serde(flatten)]
    pub target: ElementReference,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TypeTextOutput {
    pub backend_node_id: i64,
    pub text_len: usize,
}

pub struct TypeTextAction;

#[async_trait]
impl BrowserAction for TypeTextAction {
    type Input = TypeTextInput;
    type Output = TypeTextOutput;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let element = ctx.resolve_element(&input.target).await?;

        if !element.is_visible || !element.is_editable {
            return Err(BrowserActionError::element_not_interactable(format!(
                "{} is not an editable visible element.",
                input.target.description()
            )));
        }

        let focus_response = call_backend_node_function(
            &page,
            element.backend_node_id,
            r#"function() {
                if (!this || !(this instanceof Element)) {
                    return { ok: false, reason: "not_element" };
                }
                this.scrollIntoView({ block: "center", inline: "center" });
                if (typeof this.focus === "function") {
                    this.focus();
                }
                if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
                    this.value = "";
                    this.dispatchEvent(new Event("input", { bubbles: true }));
                } else if (this.isContentEditable) {
                    this.textContent = "";
                    this.dispatchEvent(new Event("input", { bubbles: true }));
                }
                return { ok: true, tag: this.tagName };
            }"#,
        )
        .await?;

        if !focus_response
            .get("ok")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            return Err(BrowserActionError::element_not_interactable(format!(
                "{} could not be focused for text input.",
                input.target.description()
            )));
        }

        for ch in input.text.chars() {
            let char_str = ch.to_string();
            let key_event = DispatchKeyEventParams::builder()
                .r#type(DispatchKeyEventType::Char)
                .text(char_str)
                .build()
                .map_err(|error| {
                    BrowserActionError::execution_failed(
                        "browser.action_failed",
                        format!("Failed to build text key event: {}", error),
                    )
                })?;
            page.execute(key_event)
                .await
                .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }

        ctx.invalidate_page_state().await;
        Ok(TypeTextOutput {
            backend_node_id: element.backend_node_id,
            text_len: input.text.chars().count(),
        })
    }
}

pub async fn type_text(ctx: &ActionContext, input: TypeTextInput) -> ActionResult<TypeTextOutput> {
    let detail = Some(format!("{} len={}", input.target.description(), input.text.chars().count()));
    ctx.run_instrumented("type_text", detail, TypeTextAction.execute(ctx, input))
        .await
}