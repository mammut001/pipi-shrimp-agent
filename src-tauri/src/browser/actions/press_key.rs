use async_trait::async_trait;
use chromiumoxide::cdp::browser_protocol::input::{DispatchKeyEventParams, DispatchKeyEventType};
use serde::{Deserialize, Serialize};

use super::common::{ActionContext, ActionResult, BrowserAction, BrowserActionError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PressKeyInput {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PressKeyOutput {
    pub key: String,
}

pub struct PressKeyAction;

struct KeyDispatchSpec {
    key: String,
    code: String,
    key_code: i64,
    text: Option<String>,
}

fn resolve_key_dispatch_spec(raw_key: &str) -> Option<KeyDispatchSpec> {
    match raw_key {
        "Enter" => Some(KeyDispatchSpec {
            key: "Enter".to_string(),
            code: "Enter".to_string(),
            key_code: 13,
            text: Some("\r".to_string()),
        }),
        "Tab" => Some(KeyDispatchSpec {
            key: "Tab".to_string(),
            code: "Tab".to_string(),
            key_code: 9,
            text: Some("\t".to_string()),
        }),
        "Escape" => Some(KeyDispatchSpec {
            key: "Escape".to_string(),
            code: "Escape".to_string(),
            key_code: 27,
            text: None,
        }),
        "Backspace" => Some(KeyDispatchSpec {
            key: "Backspace".to_string(),
            code: "Backspace".to_string(),
            key_code: 8,
            text: None,
        }),
        "ArrowDown" => Some(KeyDispatchSpec {
            key: "ArrowDown".to_string(),
            code: "ArrowDown".to_string(),
            key_code: 40,
            text: None,
        }),
        "ArrowUp" => Some(KeyDispatchSpec {
            key: "ArrowUp".to_string(),
            code: "ArrowUp".to_string(),
            key_code: 38,
            text: None,
        }),
        "ArrowLeft" => Some(KeyDispatchSpec {
            key: "ArrowLeft".to_string(),
            code: "ArrowLeft".to_string(),
            key_code: 37,
            text: None,
        }),
        "ArrowRight" => Some(KeyDispatchSpec {
            key: "ArrowRight".to_string(),
            code: "ArrowRight".to_string(),
            key_code: 39,
            text: None,
        }),
        "Space" | " " => Some(KeyDispatchSpec {
            key: " ".to_string(),
            code: "Space".to_string(),
            key_code: 32,
            text: Some(" ".to_string()),
        }),
        _ => {
            let mut chars = raw_key.chars();
            let first = chars.next()?;
            if chars.next().is_some() {
                return None;
            }

            if first.is_ascii_alphabetic() {
                let upper = first.to_ascii_uppercase();
                Some(KeyDispatchSpec {
                    key: first.to_string(),
                    code: format!("Key{}", upper),
                    key_code: upper as i64,
                    text: Some(first.to_string()),
                })
            } else if first.is_ascii_digit() {
                Some(KeyDispatchSpec {
                    key: first.to_string(),
                    code: format!("Digit{}", first),
                    key_code: first as i64,
                    text: Some(first.to_string()),
                })
            } else {
                Some(KeyDispatchSpec {
                    key: first.to_string(),
                    code: first.to_string(),
                    key_code: first as i64,
                    text: Some(first.to_string()),
                })
            }
        }
    }
}

#[async_trait]
impl BrowserAction for PressKeyAction {
    type Input = PressKeyInput;
    type Output = PressKeyOutput;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let spec = resolve_key_dispatch_spec(&input.key)
            .ok_or_else(|| BrowserActionError::invalid_input(format!("Unsupported key '{}'.", input.key)))?;

        let mut builder = DispatchKeyEventParams::builder()
            .key(spec.key.clone())
            .code(spec.code)
            .windows_virtual_key_code(spec.key_code)
            .native_virtual_key_code(spec.key_code);

        let key_down_type = if let Some(text) = spec.text.clone() {
            builder = builder.text(text);
            DispatchKeyEventType::KeyDown
        } else {
            DispatchKeyEventType::RawKeyDown
        };

        let key_down = builder
            .clone()
            .r#type(key_down_type)
            .build()
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;
        let key_up = builder
            .r#type(DispatchKeyEventType::KeyUp)
            .build()
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;

        page.execute(key_down)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;
        page.execute(key_up)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;

        ctx.invalidate_page_state().await;
        Ok(PressKeyOutput { key: input.key })
    }
}

pub async fn press_key(ctx: &ActionContext, input: PressKeyInput) -> ActionResult<PressKeyOutput> {
    let detail = Some(input.key.clone());
    ctx.run_instrumented("press_key", detail, PressKeyAction.execute(ctx, input))
        .await
}