use async_trait::async_trait;

use crate::browser::dom::PageState;

use super::common::{ActionContext, ActionResult, BrowserAction};

pub struct GetPageStateAction;

#[async_trait]
impl BrowserAction for GetPageStateAction {
    type Input = ();
    type Output = PageState;

    async fn execute(&self, ctx: &ActionContext, _input: Self::Input) -> ActionResult<Self::Output> {
        ctx.capture_page_state().await
    }
}

pub async fn get_page_state(ctx: &ActionContext) -> ActionResult<PageState> {
    GetPageStateAction.execute(ctx, ()).await
}

pub async fn get_page_state_text(ctx: &ActionContext) -> ActionResult<String> {
    ctx.page_state_text().await
}