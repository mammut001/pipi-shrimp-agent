pub(crate) fn normalize_browser_url(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{}", url)
    }
}

pub(crate) fn strip_thinking_content(body: String) -> String {
    let mut result = body;
    loop {
        match (result.find("<think>"), result.find("</think>")) {
            (Some(start), Some(end_tag_pos)) if end_tag_pos >= start => {
                let end = end_tag_pos + "</think>".len();
                result = format!("{}{}", &result[..start], &result[end..]);
            }
            _ => break,
        }
    }
    result
}

/// Inline page-agent IIFE bundle — embedded at compile time so we never load from CDN.
/// Tauri's eval() is native-level injection that bypasses any page CSP (unlike <script src>).
const PAGE_AGENT_IIFE: &str =
    include_str!("../../../../node_modules/page-agent/dist/iife/page-agent.demo.js");

#[allow(non_snake_case)]
pub(crate) fn build_page_agent_script(
    task: &str,
    baseUrl: Option<String>,
    apiKey: &str,
    model: &str,
    systemPrompt: Option<String>,
) -> String {
    let base_url_js = match baseUrl {
        Some(url) => format!("\"{}\"", url),
        None => "undefined".to_string(),
    };

    let system_prompt_js = match systemPrompt {
        Some(prompt) => format!(
            "\"{}\"",
            prompt
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
        ),
        None => "undefined".to_string(),
    };

    let escaped_task = task
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    let escaped_api_key = apiKey.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_model = model.replace('\\', "\\\\").replace('"', "\\\"");

    format!(
        r#"
(function() {{
    console.log('[PageAgent] Script injected. __TAURI_INTERNALS__ exists:', !!window.__TAURI_INTERNALS__);
    // --- Override fetch to proxy LLM API calls (bypass CSP connect-src) ---
    var __origFetch = window.fetch;
    var LLM_API_PATTERNS = [
        'api.openai.com',
        'api.anthropic.com',
        'api-biz.alibaba.com',
        'api.minimaxi.com',
        'page-ag-testing',
        'api.minimax.chat',
        'localhost',
        '127.0.0.1',
        ':8000', ':8080', ':3000', ':5000'
    ];

    function shouldProxy(url) {{
        var urlStr = String(url).toLowerCase();
        var matchesPattern = LLM_API_PATTERNS.some(function(pattern) {{
            return urlStr.indexOf(pattern) !== -1;
        }});

        if (matchesPattern) return true;

        var baseUrl = {base_url_js};
        if (baseUrl && baseUrl !== 'undefined') {{
            var baseUrlStr = String(baseUrl).toLowerCase();
            if (urlStr.startsWith(baseUrlStr)) return true;
        }}

        return false;
    }}

    function toPlainHeaders(h) {{
        var obj = {{}};
        if (!h) return obj;
        if (typeof h.forEach === 'function') {{
            h.forEach(function(v, k) {{ obj[k] = v; }});
        }} else if (typeof h === 'object') {{
            for (var k in h) {{ if (Object.prototype.hasOwnProperty.call(h, k)) obj[k] = h[k]; }}
        }}
        return obj;
    }}

    window.fetch = async function(url, options) {{
        if (!shouldProxy(url)) {{
            return __origFetch.apply(this, arguments);
        }}

        try {{
            var method = (options && options.method) || 'POST';
            var headers = toPlainHeaders(options && options.headers);
            var body = options && options.body;

            if (body && typeof body !== 'string') {{
                body = JSON.stringify(body);
            }}

            console.log('[FetchProxy] Intercepted:', String(url).substring(0, 80));
            console.log('[FetchProxy] __TAURI_INTERNALS__:', !!window.__TAURI_INTERNALS__);

            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                try {{
                    console.log('[FetchProxy] Calling proxy_http_request via IPC...');
                    var result = await window.__TAURI_INTERNALS__.invoke('proxy_http_request', {{
                        request: {{
                            url: String(url),
                            method: method,
                            headers: headers,
                            body: body || null
                        }}
                    }});
                    console.log('[FetchProxy] IPC success, status:', result && result.status);

                    return new Response(result.body, {{
                        status: result.status,
                        statusText: result.status_text || 'OK',
                        headers: new Headers(result.headers || {{}})
                    }});
                }} catch(tauri_error) {{
                    var errMsg = tauri_error && (tauri_error.message || String(tauri_error));
                    console.warn('[FetchProxy] Tauri IPC failed:', errMsg);
                    try {{
                        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                            window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                                event: 'agent_log',
                                windowLabel: null,
                                payload: {{ timestamp: Date.now(), message: '[FetchProxy] IPC error: ' + errMsg, level: 'error' }}
                            }}).catch(function(){{}});
                        }}
                    }} catch(e) {{}}
                }}
            }}

            console.warn('[FetchProxy] Falling back to native fetch (may fail due to CSP)');
            return __origFetch.apply(this, [url, options]);
        }} catch (error) {{
            console.error('[FetchProxy] All methods failed:', error && error.message);
            return __origFetch.apply(this, [url, options]);
        }}
    }};

    var __origSetTimeout = window.setTimeout;
    window.setTimeout = function() {{ return 0; }};

    {iife}

    window.setTimeout = __origSetTimeout;

    function emitLog(level, message) {{
        console.log('[PageAgent ' + level + ']', message);
        try {{
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                    event: 'agent_log',
                    windowLabel: null,
                    payload: {{ timestamp: new Date().toISOString(), message: message, level: level }}
                }}).catch(function(){{}});
            }}
        }} catch(e) {{}}
    }}

    function emitComplete(success, result) {{
        emitLog(success ? 'success' : 'error', 'Task ' + (success ? 'completed' : 'failed') + ': ' + result);
        try {{
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                    event: 'agent_task_complete',
                    windowLabel: null,
                    payload: {{ success: success, final_url: window.location.href, result: result }}
                }}).catch(function(){{}});
            }}
        }} catch(e) {{}}
    }}

    (async function() {{
        try {{
            emitLog('info', 'Initializing PageAgent...');

            if (typeof window.PageAgent === 'undefined') {{
                throw new Error('PageAgent not available after inline injection');
            }}

            emitLog('info', 'Creating PageAgent instance...');
            const agent = new window.PageAgent({{
                baseURL: {base_url_js},
                apiKey: "{escaped_api_key}",
                model: "{escaped_model}",
                systemPrompt: {system_prompt_js}
            }});

            emitLog('info', 'Executing task: {escaped_task}');
            const result = await agent.execute("{escaped_task}");
            let resultText;
            if (typeof result === 'string') {{
                resultText = result;
            }} else if (result && typeof result === 'object') {{
                resultText = result.text || result.message || result.content ||
                             result.summary || result.output || result.answer || result.result;
                if (!resultText) {{
                    if (Array.isArray(result.choices) && result.choices[0] && result.choices[0].message) {{
                        resultText = result.choices[0].message.content || result.choices[0].message.text;
                    }}
                }}
                if (!resultText) {{
                    const raw = JSON.stringify(result);
                    resultText = raw.length > 2000 ? raw.substring(0, 2000) + '...' : raw;
                }}
            }} else {{
                resultText = String(result);
            }}
            emitLog('success', 'Task completed: ' + String(resultText).substring(0, 200));
            emitComplete(true, String(resultText));
        }} catch (error) {{
            emitLog('error', 'Error: ' + (error && error.message ? error.message : String(error)));
            emitComplete(false, error && error.message ? error.message : String(error));
        }}
    }})();
}})();
"#,
        iife = PAGE_AGENT_IIFE,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_browser_url_adds_https_when_missing() {
        assert_eq!(normalize_browser_url("example.com"), "https://example.com");
        assert_eq!(normalize_browser_url("https://example.com"), "https://example.com");
    }

    #[test]
    fn strip_thinking_content_removes_embedded_reasoning_blocks() {
        let body = "hello<think>private reasoning</think>world".to_string();
        assert_eq!(strip_thinking_content(body), "helloworld");
    }

    #[test]
    fn build_page_agent_script_includes_runtime_arguments() {
        let script = build_page_agent_script(
            "collect page summary",
            Some("https://example.com/api".to_string()),
            "secret-key",
            "gpt-test",
            Some("be precise".to_string()),
        );

        assert!(script.contains("collect page summary"));
        assert!(script.contains("https://example.com/api"));
        assert!(script.contains("secret-key"));
        assert!(script.contains("gpt-test"));
    }
}
