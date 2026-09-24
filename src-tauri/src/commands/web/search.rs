use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchResult {
    pub url: String,
    pub content: String,
    pub content_type: String,
    pub bytes: usize,
}

/**
 * Web search using DuckDuckGo Lite
 *
 * Free, no API key required. Returns results with titles and snippets.
 * Uses the lite endpoint which has a stable, simpler HTML structure.
 */

pub(super) async fn web_search(
    query: String,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, String> {
    let encoded_query = urlencoding::encode(&query);
    let search_url = format!("https://lite.duckduckgo.com/lite/?q={}", encoded_query);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    let html = response.text().await.map_err(|e| e.to_string())?;

    // DuckDuckGo Lite uses <a class="result-link"> for result URLs/titles
    // and <td class="result-snippet"> for snippets.
    let result_pattern = regex::Regex::new(
        r#"(?i)<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>"#,
    )
    .map_err(|e| format!("Regex error: {}", e))?;
    let snippet_pattern =
        regex::Regex::new(r#"(?i)<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)</td>"#)
            .map_err(|e| format!("Regex error: {}", e))?;

    let strip_tags = regex::Regex::new(r"<[^>]+>").map_err(|e| format!("Regex error: {}", e))?;

    let mut results = Vec::new();
    let snippets: Vec<String> = snippet_pattern
        .captures_iter(&html)
        .map(|c| {
            let raw = c.get(1).map(|m| m.as_str()).unwrap_or("");
            strip_tags.replace_all(raw, "").trim().to_string()
        })
        .collect();

    for (i, cap) in result_pattern.captures_iter(&html).enumerate() {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let raw_title = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let title = strip_tags.replace_all(raw_title, "").trim().to_string();

        if url.is_empty() || title.is_empty() {
            continue;
        }

        let snippet = snippets.get(i).cloned().unwrap_or_default();

        // Filter by domain if specified
        let passes_filter = match (&allowed_domains, &blocked_domains) {
            (Some(allowed), _) if !allowed.is_empty() => {
                allowed.iter().any(|d| url.contains(d.as_str()))
            }
            (_, Some(blocked)) => !blocked.iter().any(|d| url.contains(d.as_str())),
            _ => true,
        };

        if passes_filter {
            results.push(SearchResult {
                title,
                url,
                snippet,
            });
        }

        if results.len() >= 20 {
            break;
        }
    }

    Ok(results)
}

/**
 * Fetch a URL and return its content
 *
 * Uses the browser if connected, otherwise uses HTTP client
 *
 * Note: The `prompt` parameter is reserved for future LLM-based content extraction.
 * Currently all text content is returned. Set maxContentLength in ToolSettings to limit.
 */

pub(super) async fn web_fetch(
    url: String,
    _prompt: String, // Reserved for future LLM extraction
) -> Result<FetchResult, String> {
    // If browser is connected, use it for better rendering
    // For now, use HTTP client as fallback

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Fetch request failed: {}", e))?;

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/html")
        .to_string();

    let bytes = response.content_length().unwrap_or(0) as usize;

    let body = response.text().await.map_err(|e| e.to_string())?;

    // If HTML, simplify the content (remove scripts, styles, etc.)
    // Note: LLM-based content extraction based on prompt is reserved for future
    let content = if content_type.contains("text/html") {
        extract_relevant_content(&body)
    } else {
        body
    };

    Ok(FetchResult {
        url,
        content,
        content_type,
        bytes,
    })
}

/**
 * Extract relevant content from HTML
 *
 * Removes scripts, styles, and extracts readable text.
 */

fn extract_relevant_content(html: &str) -> String {
    // Simple extraction: remove scripts, styles, and get text
    let mut result = String::new();
    let mut in_script = false;
    let mut in_style = false;
    let mut in_tag = false;
    let mut current_text = String::new();

    let chars: Vec<char> = html.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];

        if i + 6 < len {
            let tag: String = chars[i..i + 7].iter().collect();
            let tag_lower = tag.to_lowercase();
            if tag_lower.starts_with("<script") || tag_lower == "<script" {
                in_script = true;
            } else if tag_lower.starts_with("<style") || tag_lower == "<style" {
                in_style = true;
            } else if tag_lower.starts_with("</scri") {
                in_script = false;
            } else if tag_lower.starts_with("</sty") {
                in_style = false;
            }
        }

        if c == '<' && !in_script && !in_style {
            in_tag = true;
            if !current_text.is_empty() {
                let trimmed = current_text.trim();
                if !trimmed.is_empty() {
                    result.push_str(trimmed);
                    result.push('\n');
                }
                current_text.clear();
            }
        } else if c == '>' && !in_script && !in_style {
            in_tag = false;
        } else if !in_tag && !in_script && !in_style {
            current_text.push(c);
        }

        i += 1;
    }

    // Clean up whitespace
    let cleaned: String = result
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .chars()
        .take(50000) // Limit to 50k chars
        .collect();

    cleaned
}
