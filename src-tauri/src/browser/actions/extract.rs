use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::{ActionContext, ActionResult, BrowserAction, BrowserActionError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetTextContentInput {
    pub max_length: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExtractContentInput;

pub struct GetTextContentAction;
pub struct ExtractContentAction;

#[async_trait]
impl BrowserAction for GetTextContentAction {
    type Input = GetTextContentInput;
    type Output = String;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let max_length = input.max_length.min(20_000);
        let script = format!(
            r#"(function() {{ return document.body.innerText.substring(0, {}); }})()"#,
            max_length
        );
        page.evaluate(script)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?
            .into_value::<String>()
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))
    }
}

#[async_trait]
impl BrowserAction for ExtractContentAction {
    type Input = ExtractContentInput;
    type Output = String;

    async fn execute(&self, ctx: &ActionContext, _input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let extract_script = r#"
            (() => {
                const result = {};
                result.url = window.location.href;
                result.title = document.title;

                const mainSelectors = ['main', 'article', '[role="main"]', '#content', '.content', '#main'];
                let mainEl = null;
                for (const sel of mainSelectors) {
                    mainEl = document.querySelector(sel);
                    if (mainEl) break;
                }
                const contentRoot = mainEl || document.body;

                const headings = [];
                contentRoot.querySelectorAll('h1, h2, h3').forEach(h => {
                    const text = h.innerText.trim();
                    if (text) headings.push({ level: parseInt(h.tagName[1]), text: text.substring(0, 200) });
                });
                result.headings = headings.slice(0, 20);

                const links = [];
                contentRoot.querySelectorAll('a[href]').forEach(a => {
                    const text = a.innerText.trim();
                    const href = a.href;
                    if (text && href && !href.startsWith('javascript:') && text.length > 1) {
                        links.push({ text: text.substring(0, 100), href: href.substring(0, 300) });
                    }
                });
                result.links = links.slice(0, 30);

                result.text = contentRoot.innerText.replace(/\n{3,}/g, '\n\n').substring(0, 5000);

                const tables = [];
                contentRoot.querySelectorAll('table').forEach(table => {
                    const rows = [];
                    table.querySelectorAll('tr').forEach(tr => {
                        const cells = [];
                        tr.querySelectorAll('th, td').forEach(cell => {
                            cells.push(cell.innerText.trim().substring(0, 100));
                        });
                        if (cells.length > 0) rows.push(cells);
                    });
                    if (rows.length > 0 && rows.length <= 50) tables.push(rows);
                });
                result.tables = tables.slice(0, 5);

                const forms = [];
                contentRoot.querySelectorAll('input, select, textarea').forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') return;
                    forms.push({
                        tag: el.tagName.toLowerCase(),
                        type: el.type || '',
                        name: el.name || '',
                        placeholder: el.placeholder || '',
                        label: el.getAttribute('aria-label') || '',
                        value: (el.value || '').substring(0, 100)
                    });
                });
                result.forms = forms.slice(0, 20);

                return JSON.stringify(result, null, 2);
            })();
        "#;

        page.evaluate(extract_script)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?
            .into_value::<String>()
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))
    }
}

pub async fn get_text_content(ctx: &ActionContext, input: GetTextContentInput) -> ActionResult<String> {
    let detail = Some(format!("max_length={}", input.max_length));
    ctx.run_instrumented("get_text_content", detail, GetTextContentAction.execute(ctx, input))
        .await
}

pub async fn extract_content(ctx: &ActionContext, input: ExtractContentInput) -> ActionResult<String> {
    ctx.run_instrumented("extract_content", None, ExtractContentAction.execute(ctx, input))
        .await
}