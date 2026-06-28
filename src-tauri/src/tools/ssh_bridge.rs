use crate::commands::code::execute_bash_for_tool;
use crate::models::ExecuteCodeResponse;
use serde_json::Value;

#[derive(Debug, Clone)]
struct SshConfig {
    mode: String,
    host: String,
    user: String,
    port: u16,
    auth_mode: String,
    key_path: String,
    password: String,
    remote_work_dir: String,
}

fn shell_escape(value: &str) -> anyhow::Result<String> {
    if value.contains('\0') {
        return Err(anyhow::anyhow!("Invalid argument: contains null byte"));
    }
    // AUDIT-FIX [fix-3#5] — The previous version `replace('"', "\\\"")` was
    // a no-op because we wrap in single quotes; double quotes inside
    // single-quoted strings are literal. Drop the redundant transform so
    // the escape intent is unambiguous.
    Ok(format!("'{}'", value.replace('\'', "'\\''")))
}

fn shell_escape_path(path: &str) -> anyhow::Result<String> {
    if path == "~" {
        return Ok("~".to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        // AUDIT-FIX [fix-3#6] — The previous `format!("~/{ }", ...).replace("{ }", "")`
        // was an obfuscated way of writing `format!("~/{}", ...)`. Use the
        // direct form so the intent is obvious and the `{ }` placeholder
        // can't accidentally survive if `shell_escape` is changed.
        return Ok(format!("~/{}", shell_escape(rest)?));
    }
    shell_escape(path)
}

fn parse_ssh_config(args: &Value) -> anyhow::Result<SshConfig> {
    let mode = args
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("ssh")
        .to_string();
    let host = args
        .get("host")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let user = args
        .get("user")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let port = args.get("port").and_then(Value::as_u64).unwrap_or(22) as u16;
    let auth_mode = args
        .get("authMode")
        .or_else(|| args.get("auth_mode"))
        .and_then(Value::as_str)
        .unwrap_or("agent")
        .to_string();
    let key_path = args
        .get("keyPath")
        .or_else(|| args.get("key_path"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let password = args
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let remote_work_dir = args
        .get("remoteWorkDir")
        .or_else(|| args.get("remote_work_dir"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if mode == "ssh" {
        if host.trim().is_empty() {
            return Err(anyhow::anyhow!("host is required for ssh mode"));
        }
        if user.trim().is_empty() {
            return Err(anyhow::anyhow!("user is required for ssh mode"));
        }
        if auth_mode == "key" && key_path.trim().is_empty() {
            return Err(anyhow::anyhow!("keyPath is required for authMode=key"));
        }
        if auth_mode == "password" && password.trim().is_empty() {
            return Err(anyhow::anyhow!(
                "password is required for authMode=password"
            ));
        }
    }

    Ok(SshConfig {
        mode,
        host,
        user,
        port,
        auth_mode,
        key_path,
        password,
        remote_work_dir,
    })
}

fn build_ssh_args(cfg: &SshConfig, binary: &str) -> anyhow::Result<(String, String)> {
    let mut parts = vec![binary.to_string()];
    parts.push("-o".to_string());
    parts.push("StrictHostKeyChecking=accept-new".to_string());
    parts.push("-o".to_string());
    parts.push("ConnectTimeout=10".to_string());

    if cfg.auth_mode == "password" {
        parts.push("-o".to_string());
        parts.push("PreferredAuthentications=password".to_string());
        parts.push("-o".to_string());
        parts.push("PubkeyAuthentication=no".to_string());
    }

    if cfg.auth_mode == "key" && !cfg.key_path.is_empty() {
        parts.push("-i".to_string());
        parts.push(shell_escape_path(&cfg.key_path)?);
    }

    parts.push(if binary == "scp" { "-P" } else { "-p" }.to_string());
    parts.push(cfg.port.to_string());

    let env_prefix = if cfg.auth_mode == "password" {
        format!("SSHPASS={} sshpass -e ", shell_escape(&cfg.password)?)
    } else {
        String::new()
    };

    Ok((parts.join(" "), env_prefix))
}

/// Build the shell command string for local or remote execution.
///
/// Local mode returns `remote_cmd` unchanged — the working directory is passed
/// separately to `execute_bash_for_tool` so untrusted paths never appear in a
/// `cd … &&` shell prefix (R2-04).
fn build_remote_bash_command(cfg: &SshConfig, remote_cmd: &str) -> anyhow::Result<String> {
    if cfg.mode == "local" {
        return Ok(remote_cmd.to_string());
    }

    let wd = if cfg.remote_work_dir.is_empty() {
        String::new()
    } else {
        format!("cd {} && ", shell_escape_path(&cfg.remote_work_dir)?)
    };
    let inner = format!("{}{}", wd, remote_cmd);

    let (prefix, env_prefix) = build_ssh_args(cfg, "ssh")?;
    Ok(format!(
        "{}{} {}@{} {}",
        env_prefix,
        prefix,
        shell_escape(&cfg.user)?,
        shell_escape(&cfg.host)?,
        shell_escape(&inner)?,
    ))
}

fn build_upload_command(
    cfg: &SshConfig,
    local_path: &str,
    remote_path: &str,
) -> anyhow::Result<String> {
    if cfg.mode == "local" {
        return Ok(format!(
            "cp -f {} {}",
            shell_escape_path(local_path)?,
            shell_escape_path(remote_path)?,
        ));
    }

    let (prefix, env_prefix) = build_ssh_args(cfg, "scp")?;
    Ok(format!(
        "{}{} {} {}@{}:{}",
        env_prefix,
        prefix,
        shell_escape_path(local_path)?,
        shell_escape(&cfg.user)?,
        shell_escape(&cfg.host)?,
        shell_escape_path(remote_path)?,
    ))
}

fn serialize_execute_response(response: ExecuteCodeResponse) -> anyhow::Result<String> {
    serde_json::to_string(&response)
        .map_err(|e| anyhow::anyhow!("Failed to serialize SSH execution result: {}", e))
}

pub fn execute_ssh_exec(args: &Value) -> anyhow::Result<String> {
    let cfg = parse_ssh_config(args)?;
    let command = args
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("Missing required parameter: command"))?;
    let timeout_secs = args
        .get("timeout")
        .or_else(|| args.get("timeoutSecs"))
        .and_then(Value::as_u64);
    let execution_id = args
        .get("executionId")
        .or_else(|| args.get("execution_id"))
        .and_then(Value::as_str);

    let full_command = build_remote_bash_command(&cfg, command)?;
    // AUDIT-FIX [fix-3#7] — Pin the local workdir to the system temp dir for
    // SSH client invocations so `ssh`/`sshpass` run from a deterministic cwd.
    // Local mode instead passes `remote_work_dir` as the process cwd (R2-04).
    let pinned_workdir = std::env::temp_dir().to_string_lossy().to_string();
    let local_work_dir = if cfg.mode == "local" && !cfg.remote_work_dir.is_empty() {
        Some(cfg.remote_work_dir.as_str())
    } else {
        None
    };
    let execution_work_dir = local_work_dir.unwrap_or(pinned_workdir.as_str());
    let result = execute_bash_for_tool(
        &full_command,
        None,
        Some(execution_work_dir),
        timeout_secs,
        execution_id,
        None,
    )
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    serialize_execute_response(result)
}

pub fn execute_ssh_upload(args: &Value) -> anyhow::Result<String> {
    let cfg = parse_ssh_config(args)?;
    let remote_path = args
        .get("remotePath")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("Missing required parameter: remotePath"))?;
    // AUDIT-FIX [fix-3#10] — Wrap the temporary-file path in a guard so
    // it's always removed, even on early return / panic. Previously the
    // temp file lived until the OS rotated the temp dir (often forever on
    // some platforms), creating a disk leak per upload.
    struct TempFileGuard {
        path: Option<std::path::PathBuf>,
    }
    impl Drop for TempFileGuard {
        fn drop(&mut self) {
            if let Some(path) = self.path.take() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    let mut temp_guard = TempFileGuard { path: None };

    let local_path = if let Some(content) = args.get("content").and_then(Value::as_str) {
        let temp_path = std::env::temp_dir().join(format!(
            "pipi-shrimp-ssh-upload-{}.txt",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&temp_path, content)
            .map_err(|e| anyhow::anyhow!("Failed to write temporary upload file: {}", e))?;
        temp_guard.path = Some(temp_path.clone());
        temp_path.to_string_lossy().to_string()
    } else {
        args.get("localPath")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("Provide exactly one of localPath or content"))?
            .to_string()
    };

    let command = build_upload_command(&cfg, &local_path, remote_path)?;
    let result = execute_bash_for_tool(
        &command,
        None,
        Some(std::env::temp_dir().to_string_lossy().as_ref()),
        Some(120),
        None,
        None,
    )
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if result.exit_code != 0 {
        return Err(anyhow::anyhow!(if result.stderr.trim().is_empty() {
            format!("upload failed (exit {})", result.exit_code)
        } else {
            result.stderr.clone()
        }));
    }

    serde_json::to_string(&serde_json::json!({
        "success": true,
        "message": format!("Uploaded file to {}", remote_path),
    }))
    .map_err(|e| anyhow::anyhow!("Failed to serialize SSH upload result: {}", e))
}

pub fn execute_ssh_read_file(args: &Value) -> anyhow::Result<String> {
    let cfg = parse_ssh_config(args)?;
    let remote_path = args
        .get("remotePath")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("Missing required parameter: remotePath"))?;
    let max_lines = args.get("maxLines").and_then(Value::as_u64);
    let remote_cmd = if let Some(lines) = max_lines {
        format!(
            "head -n {} {}",
            lines.max(1),
            shell_escape_path(remote_path)?
        )
    } else {
        format!("cat {}", shell_escape_path(remote_path)?)
    };

    let read_cfg = SshConfig {
        remote_work_dir: String::new(),
        ..cfg
    };
    let command = build_remote_bash_command(&read_cfg, &remote_cmd)?;
    let result = execute_bash_for_tool(
        &command,
        None,
        Some(std::env::temp_dir().to_string_lossy().as_ref()),
        Some(30),
        None,
        None,
    )
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if result.exit_code != 0 {
        return Err(anyhow::anyhow!(if result.stderr.trim().is_empty() {
            format!("Failed to read file (exit {})", result.exit_code)
        } else {
            result.stderr.clone()
        }));
    }

    serde_json::to_string(&serde_json::json!({
        "content": result.stdout,
        "lineCount": result.stdout.lines().count(),
    }))
    .map_err(|e| anyhow::anyhow!("Failed to serialize SSH read result: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_cfg(remote_work_dir: &str) -> SshConfig {
        SshConfig {
            mode: "local".to_string(),
            host: String::new(),
            user: String::new(),
            port: 22,
            auth_mode: "agent".to_string(),
            key_path: String::new(),
            password: String::new(),
            remote_work_dir: remote_work_dir.to_string(),
        }
    }

    fn ssh_cfg(remote_work_dir: &str) -> SshConfig {
        SshConfig {
            mode: "ssh".to_string(),
            host: "example.com".to_string(),
            user: "deploy".to_string(),
            port: 22,
            auth_mode: "agent".to_string(),
            key_path: String::new(),
            password: String::new(),
            remote_work_dir: remote_work_dir.to_string(),
        }
    }

    #[test]
    fn shell_escape_simple_string() {
        assert_eq!(shell_escape("abc").unwrap(), "'abc'");
    }

    #[test]
    fn shell_escape_spaces() {
        assert_eq!(shell_escape("a b").unwrap(), "'a b'");
    }

    #[test]
    fn shell_escape_semicolon() {
        assert_eq!(shell_escape("a;b").unwrap(), "'a;b'");
    }

    #[test]
    fn shell_escape_dollar_sign() {
        assert_eq!(shell_escape("a$b").unwrap(), "'a$b'");
    }

    #[test]
    fn shell_escape_backtick() {
        assert_eq!(shell_escape("a`b").unwrap(), "'a`b'");
    }

    #[test]
    fn shell_escape_double_quote() {
        assert_eq!(shell_escape("a\"b").unwrap(), "'a\"b'");
    }

    #[test]
    fn shell_escape_single_quote() {
        assert_eq!(shell_escape("a'b").unwrap(), "'a'\\''b'");
    }

    #[test]
    fn shell_escape_empty_string() {
        assert_eq!(shell_escape("").unwrap(), "''");
    }

    #[test]
    fn shell_escape_path_with_parentheses() {
        assert_eq!(
            shell_escape_path("/tmp/(demo); echo PWNED").unwrap(),
            "'/tmp/(demo); echo PWNED'"
        );
    }

    #[test]
    fn shell_escape_path_with_unicode() {
        assert_eq!(shell_escape_path("/tmp/测试").unwrap(), "'/tmp/测试'");
    }

    #[test]
    fn shell_escape_rejects_null_byte() {
        assert!(shell_escape("a\0b").is_err());
    }

    #[test]
    fn shell_escape_path_preserves_tilde_expansion() {
        assert_eq!(shell_escape_path("~/work dir").unwrap(), "~/'work dir'");
    }

    #[test]
    fn local_mode_does_not_embed_cd_prefix_for_workdir() {
        let command = build_remote_bash_command(
            &local_cfg("/tmp; echo PWNED"),
            "echo SAFE",
        )
        .unwrap();
        assert_eq!(command, "echo SAFE");
        assert!(!command.contains("cd "));
        assert!(!command.contains("PWNED"));
    }

    #[test]
    fn ssh_mode_still_shell_escapes_workdir_and_command_wrapper() {
        let command = build_remote_bash_command(&ssh_cfg("/remote/work"), "echo SAFE").unwrap();
        assert!(command.contains("cd "));
        assert!(command.contains("/remote/work"));
        assert!(command.contains("echo SAFE"));
        assert!(command.contains("deploy"));
        assert!(command.contains("example.com"));
    }

    #[test]
    fn local_upload_treats_injection_payload_as_single_path_argument() {
        let command = build_upload_command(
            &local_cfg("/work"),
            "/tmp/foo; echo PWNED",
            "/tmp/bar",
        )
        .unwrap();
        assert_eq!(
            command,
            "cp -f '/tmp/foo; echo PWNED' '/tmp/bar'"
        );
    }

    #[test]
    fn local_read_file_treats_injection_payload_as_single_path_argument() {
        let remote_cmd = format!(
            "cat {}",
            shell_escape_path("/etc/passwd; echo PWNED").unwrap()
        );
        let command = build_remote_bash_command(&local_cfg(""), &remote_cmd).unwrap();
        assert_eq!(command, "cat '/etc/passwd; echo PWNED'");
        assert!(!command.contains("cd "));
    }
}
