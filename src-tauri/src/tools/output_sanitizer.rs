use crate::models::ExecuteCodeResponse;
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
    Regex::new(r"(?im)^([A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*=).+$")
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
) -> ExecuteCodeResponse {
    let stdout_bytes = stdout.len();
    let stderr_bytes = stderr.len();

    let sanitized_stdout = sanitize_text(&String::from_utf8_lossy(stdout));
    let sanitized_stderr = sanitize_text(&String::from_utf8_lossy(stderr));
    let (stdout, stdout_truncated) = truncate_text(sanitized_stdout);
    let (stderr, stderr_truncated) = truncate_text(sanitized_stderr);

    ExecuteCodeResponse {
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

    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            sanitized = sanitized.replace(&home, "~");
        }
    }

    sanitized
}

fn truncate_text(input: String) -> (String, bool) {
    let char_count = input.chars().count();
    if char_count <= MAX_OUTPUT_CHARS {
        return (input, false);
    }

    let truncated = input.chars().take(MAX_OUTPUT_CHARS).collect::<String>();
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
        );

        assert!(result.stdout.contains("https://[redacted]@example.com/path?token=[redacted]"));
        assert!(result.stdout.contains("~\\project"));
        assert!(!result.stdout.contains('\u{7}'));
    }
}
