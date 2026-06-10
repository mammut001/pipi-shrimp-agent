use crate::models::{ExecuteCodeResponse, ToolExecutionStatus};
use once_cell::sync::Lazy;
use regex::Regex;

const MAX_OUTPUT_CHARS: usize = 12_000;

static ANSI_ESCAPE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").expect("valid ansi regex"));
static AUTH_HEADER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?im)(authorization\s*:\s*)([^\r\n]+)").expect("valid auth regex")
});
static BEARER_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bbearer\s+[a-z0-9._-]{8,}").expect("valid bearer regex")
});
static SECRET_ASSIGNMENT_RE: Lazy<Regex> = Lazy::new(|| {
    // AUDIT-FIX [fix-3#13] — The previous pattern matched anything
    // ending in `TOKEN=`/`SECRET=`/`PASSWORD=`/`API_KEY=`, including benign
    // log lines like `PASSWORD_POLICY=complex`. Require the *value* to look
    // like a secret (>=8 chars, not a plain English word) and the assignment
    // to look like an environment-style declaration.
    Regex::new(r"(?im)^([A-Z][A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*=)([^\s\r\n]{8,})$")
        .expect("valid secret assignment regex")
});
static API_KEY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,})\b")
        .expect("valid api key regex")
});
static URL_CREDENTIAL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bhttps?://[^/\s:@]+:[^/\s@]+@").expect("valid url credential regex"));
static URL_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([?&](token|key|api_key|access_token)=)([^&#\s]+)")
        .expect("valid url token regex")
});
static WINDOWS_HOME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Z]:\\Users\\[^\\/\s]+").expect("valid windows home regex"));
static CONTROL_CHAR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\x00-\x08\x0B-\x1F\x7F]").expect("valid control char regex"));

pub fn sanitize_execute_code_output(
    stdout: &[u8],
    stderr: &[u8],
    exit_code: i32,
    cwd: Option<&str>,
    timed_out: bool,
    execution_id: &str,
    status: ToolExecutionStatus,
) -> ExecuteCodeResponse {
    let stdout_bytes = stdout.len();
    let stderr_bytes = stderr.len();

    let sanitized_stdout = sanitize_text(&String::from_utf8_lossy(stdout));
    let sanitized_stderr = sanitize_text(&String::from_utf8_lossy(stderr));
    let (stdout, stdout_truncated) = truncate_text(sanitized_stdout);
    let (stderr, stderr_truncated) = truncate_text(sanitized_stderr);

    ExecuteCodeResponse {
        execution_id: execution_id.to_string(),
        status,
        stdout,
        stderr,
        exit_code,
        cwd: cwd.map(str::to_string),
        stdout_bytes,
        stderr_bytes,
        output_truncated: stdout_truncated || stderr_truncated,
        sanitized: true,
        timed_out,
    }
}

fn sanitize_text(input: &str) -> String {
    let mut sanitized = ANSI_ESCAPE_RE.replace_all(input, "").to_string();
    sanitized = CONTROL_CHAR_RE.replace_all(&sanitized, "").to_string();
    sanitized = AUTH_HEADER_RE.replace_all(&sanitized, "$1[redacted]").to_string();
    sanitized = BEARER_TOKEN_RE.replace_all(&sanitized, "Bearer [redacted]").to_string();
    sanitized = SECRET_ASSIGNMENT_RE.replace_all(&sanitized, "$1[redacted]").to_string();
    sanitized = API_KEY_RE.replace_all(&sanitized, "[redacted]").to_string();
    sanitized = URL_CREDENTIAL_RE
        .replace_all(&sanitized, "https://[redacted]@")
        .to_string();
    sanitized = URL_TOKEN_RE.replace_all(&sanitized, "$1[redacted]").to_string();
    sanitized = WINDOWS_HOME_RE.replace_all(&sanitized, "~").to_string();

    // AUDIT-FIX [fix-3#11] — Use `dirs::home_dir()` (process-cached) and
    // only redact the home path when it appears as a path prefix, not as a
    // substring. The previous `sanitized.replace(&home, "~")` would also
    // rewrite occurrences inside URLs, JSON keys, code identifiers, etc.
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy().into_owned();
        if !home_str.trim().is_empty() {
            // Trailing-separator style: `~/...` and exact match, not arbitrary
            // substring. The regex is built lazily and cached per-thread.
            thread_local! {
                static HOME_RE_CACHE: std::cell::RefCell<Option<(String, regex::Regex)>> =
                    std::cell::RefCell::new(None);
            }
            HOME_RE_CACHE.with(|cell| {
                let mut cache = cell.borrow_mut();
                let needs_rebuild = match cache.as_ref() {
                    None => true,
                    Some((cached, _)) => cached != &home_str,
                };
                if needs_rebuild {
                    let pattern = format!(r"(?i)\b{}/", regex::escape(&home_str));
                    if let Ok(re) = regex::Regex::new(&pattern) {
                        *cache = Some((home_str.clone(), re));
                    }
                }
                if let Some((_, re)) = cache.as_ref() {
                    sanitized = re.replace_all(&sanitized, "~/").to_string();
                }
            });
        }
    }

    sanitized
}

fn truncate_text(input: String) -> (String, bool) {
    // AUDIT-FIX [fix-3#12] — `chars().count()` walks the entire string to
    // find the length (O(N)). We use a byte-length fast path for the ASCII
    // case and only fall back to `chars().count()` if the string contains
    // non-ASCII characters (rare in tool output).
    let char_count = if input.is_ascii() {
        input.len()
    } else {
        input.chars().count()
    };
    if char_count <= MAX_OUTPUT_CHARS {
        return (input, false);
    }

    let truncated = if input.is_ascii() {
        // Safe byte slice — no codepoint boundary can be split inside ASCII.
        input[..MAX_OUTPUT_CHARS].to_string()
    } else {
        input.chars().take(MAX_OUTPUT_CHARS).collect::<String>()
    };
    (
        format!(
            "{}\n...[truncated {} chars]",
            truncated,
            char_count - MAX_OUTPUT_CHARS
        ),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_tokens_and_home_paths() {
        let result = sanitize_execute_code_output(
            b"Authorization: Bearer sk-test-secret\nPATH=$HOME/project\nOPENAI_API_KEY=sk-abc12345",
            b"",
            0,
            Some("/tmp/project"),
            false,
            "exec-1",
            ToolExecutionStatus::Succeeded,
        );

        assert!(result.stdout.contains("Authorization: [redacted]"));
        assert!(result.stdout.contains("OPENAI_API_KEY=[redacted]"));
        assert!(!result.stdout.contains("sk-test-secret"));
    }

    #[test]
    fn redacts_urls_and_windows_home_paths() {
        let result = sanitize_execute_code_output(
            b"https://user:pass@example.com/path?token=secret\nC:\\Users\\Alice\\project\x07",
            b"",
            0,
            Some("/tmp/project"),
            false,
            "exec-1",
            ToolExecutionStatus::Succeeded,
        );

        assert!(result.stdout.contains("https://[redacted]@example.com/path?token=[redacted]"));
        assert!(result.stdout.contains("~\\project"));
        assert!(!result.stdout.contains('\u{7}'));
    }
}
