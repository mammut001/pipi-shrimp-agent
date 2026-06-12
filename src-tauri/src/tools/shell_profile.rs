use crate::utils::{AppError, AppResult};
use std::process::Command;

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum WindowsShellProfile {
    #[default]
    Auto,
    Powershell,
    Wsl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellPathKind {
    Windows,
    Wsl,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedShellKind {
    Default,
    Powershell,
    Wsl,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellCommandPlan {
    pub requested_profile: WindowsShellProfile,
    pub resolved_profile: ResolvedShellKind,
    pub program: String,
    pub args: Vec<String>,
    pub host_cwd: Option<String>,
    pub display_cwd: Option<String>,
    pub reason: String,
    pub warning: Option<String>,
    pub blocking_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalShellPlan {
    pub program: String,
    pub args: Vec<String>,
    pub host_cwd: Option<String>,
    pub warning: Option<String>,
}

pub fn detect_path_kind(path: Option<&str>) -> ShellPathKind {
    let value = path.unwrap_or("").trim();
    if value.is_empty() {
        return ShellPathKind::Unknown;
    }

    let lower = value.to_ascii_lowercase();
    if lower.starts_with("\\\\wsl$\\") || lower.starts_with("\\\\wsl.localhost\\") {
        return ShellPathKind::Wsl;
    }
    if value.starts_with('/') {
        return ShellPathKind::Wsl;
    }
    if value.len() >= 3
        && value.as_bytes()[1] == b':'
        && is_path_separator(value.as_bytes()[2] as char)
    {
        return ShellPathKind::Windows;
    }
    if let Some(rest) = value.strip_prefix("\\\\?\\") {
        if rest.len() >= 3
            && rest.as_bytes()[1] == b':'
            && is_path_separator(rest.as_bytes()[2] as char)
        {
            return ShellPathKind::Windows;
        }
    }
    if value.starts_with("\\\\") || value.starts_with("//") {
        return ShellPathKind::Windows;
    }
    ShellPathKind::Unknown
}

pub fn convert_windows_path_to_wsl(path: &str) -> Option<String> {
    let mut value = path.trim();
    if value.is_empty() {
        return None;
    }

    if let Some(stripped) = value.strip_prefix("\\\\?\\") {
        value = stripped;
    }

    let lower = value.to_ascii_lowercase();
    if lower.starts_with("\\\\wsl$\\") || lower.starts_with("\\\\wsl.localhost\\") {
        let mut parts = value.split('\\').filter(|segment| !segment.is_empty());
        let _share = parts.next()?;
        let _distro = parts.next()?;
        let remainder = parts.collect::<Vec<_>>().join("/");
        return Some(if remainder.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", remainder)
        });
    }

    let bytes = value.as_bytes();
    if bytes.len() >= 3 && bytes[1] == b':' && is_path_separator(bytes[2] as char) {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let rest = value[3..].replace('\\', "/");
        return Some(if rest.is_empty() {
            format!("/mnt/{}", drive)
        } else {
            format!("/mnt/{}/{}", drive, rest)
        });
    }

    if value.starts_with('/') {
        return Some(value.to_string());
    }

    None
}

pub fn looks_like_bash_only_command(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }

    let lowered = trimmed.to_ascii_lowercase();
    lowered.starts_with("bash ")
        || lowered.starts_with("source ")
        || lowered.contains(".sh")
        || lowered.contains("./")
        || lowered.contains(" export ")
        || lowered.starts_with("export ")
        || lowered.contains(" && export ")
}

pub fn is_windows_tauri_build_command(command: &str) -> bool {
    let lowered = command.trim().to_ascii_lowercase();
    lowered.contains("npm run tauri:build")
        || lowered.contains("pnpm tauri build")
        || lowered.contains("yarn tauri build")
        || lowered.contains("cargo-tauri build")
}

pub fn resolve_command_shell(
    requested_profile: Option<WindowsShellProfile>,
    cwd: Option<&str>,
    command: &str,
) -> AppResult<ShellCommandPlan> {
    resolve_command_shell_for_platform(
        cfg!(target_os = "windows"),
        requested_profile.unwrap_or_default(),
        cwd,
        command,
        command_exists_for_platform("pwsh.exe", cfg!(target_os = "windows")),
    )
}

pub fn resolve_terminal_shell(
    requested_profile: Option<WindowsShellProfile>,
    cwd: Option<&str>,
) -> AppResult<Option<TerminalShellPlan>> {
    resolve_terminal_shell_for_platform(
        cfg!(target_os = "windows"),
        requested_profile.unwrap_or_default(),
        cwd,
        command_exists_for_platform("pwsh.exe", cfg!(target_os = "windows")),
    )
}

pub fn resolve_command_shell_for_platform(
    is_windows: bool,
    requested_profile: WindowsShellProfile,
    cwd: Option<&str>,
    command: &str,
    prefer_pwsh: bool,
) -> AppResult<ShellCommandPlan> {
    let cwd = cwd.map(str::trim).filter(|value| !value.is_empty());

    if !is_windows {
        return Ok(ShellCommandPlan {
            requested_profile,
            resolved_profile: ResolvedShellKind::Default,
            program: "bash".to_string(),
            args: vec!["-lc".to_string(), command.to_string()],
            host_cwd: cwd.map(str::to_string),
            display_cwd: cwd.map(str::to_string),
            reason: "Non-Windows platform: keeping the existing bash execution behavior."
                .to_string(),
            warning: None,
            blocking_message: None,
        });
    }

    let path_kind = detect_path_kind(cwd);
    let resolved_profile = match requested_profile {
        WindowsShellProfile::Auto => match path_kind {
            ShellPathKind::Wsl => ResolvedShellKind::Wsl,
            _ => ResolvedShellKind::Powershell,
        },
        WindowsShellProfile::Powershell => ResolvedShellKind::Powershell,
        WindowsShellProfile::Wsl => ResolvedShellKind::Wsl,
    };

    match resolved_profile {
        ResolvedShellKind::Powershell => {
            let shell = if prefer_pwsh {
                "pwsh.exe"
            } else {
                "powershell.exe"
            };
            let blocking_message = match path_kind {
                ShellPathKind::Wsl => Some(
                    "This workspace appears to be inside WSL. Switch the Windows shell profile to WSL before running commands here."
                        .to_string(),
                ),
                _ if looks_like_bash_only_command(command) => Some(
                    "This command looks like a bash-only workflow. Switch the Windows shell profile to WSL or run it in Git Bash instead of PowerShell."
                        .to_string(),
                ),
                _ => None,
            };

            Ok(ShellCommandPlan {
                requested_profile,
                resolved_profile,
                program: shell.to_string(),
                args: vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                    "-Command".to_string(),
                    command.to_string(),
                ],
                host_cwd: cwd.map(str::to_string),
                display_cwd: cwd.map(str::to_string),
                reason: match requested_profile {
                    WindowsShellProfile::Auto => {
                        "Auto-selected PowerShell for a Windows workspace.".to_string()
                    }
                    WindowsShellProfile::Powershell => "User selected PowerShell.".to_string(),
                    WindowsShellProfile::Wsl => unreachable!(),
                },
                warning: None,
                blocking_message,
            })
        }
        ResolvedShellKind::Wsl => {
            let resolved_wsl_cwd = match cwd {
                Some(value) => convert_windows_path_to_wsl(value).ok_or_else(|| {
                    AppError::ProcessError(format!(
                        "Unable to convert '{}' into a WSL working directory. Switch the Windows shell profile to PowerShell or open the workspace inside WSL.",
                        value
                    ))
                })?,
                None => String::new(),
            };

            let mut warning = match (requested_profile, path_kind) {
                (_, ShellPathKind::Windows) if cwd.is_some() => Some(
                    "WSL will use a converted /mnt/... working directory. Avoid mixing WSL and PowerShell installs or build artifacts in the same workspace."
                        .to_string(),
                ),
                _ => None,
            };
            let blocking_message = if is_windows_tauri_build_command(command)
                && requested_profile != WindowsShellProfile::Wsl
            {
                Some(
                    "Windows Tauri builds should run in PowerShell. WSL will build for Linux unless cross-compilation is configured."
                        .to_string(),
                )
            } else {
                if is_windows_tauri_build_command(command) {
                    warning = merge_warning(
                        warning,
                        Some(
                            "Windows Tauri builds usually belong in PowerShell. WSL will build for Linux unless cross-compilation is configured."
                                .to_string(),
                        ),
                    );
                }
                None
            };

            let mut args = Vec::new();
            if !resolved_wsl_cwd.is_empty() {
                args.push("--cd".to_string());
                args.push(resolved_wsl_cwd.clone());
            }
            args.push("--".to_string());
            args.push("bash".to_string());
            args.push("-lc".to_string());
            args.push(command.to_string());

            Ok(ShellCommandPlan {
                requested_profile,
                resolved_profile,
                program: "wsl.exe".to_string(),
                args,
                host_cwd: None,
                display_cwd: if resolved_wsl_cwd.is_empty() {
                    None
                } else {
                    Some(resolved_wsl_cwd)
                },
                reason: match requested_profile {
                    WindowsShellProfile::Auto => {
                        "Auto-selected WSL for a WSL/Linux workspace.".to_string()
                    }
                    WindowsShellProfile::Wsl => "User selected WSL.".to_string(),
                    WindowsShellProfile::Powershell => unreachable!(),
                },
                warning,
                blocking_message,
            })
        }
        ResolvedShellKind::Default => unreachable!(),
    }
}

pub fn resolve_terminal_shell_for_platform(
    is_windows: bool,
    requested_profile: WindowsShellProfile,
    cwd: Option<&str>,
    prefer_pwsh: bool,
) -> AppResult<Option<TerminalShellPlan>> {
    if !is_windows {
        return Ok(None);
    }

    let cwd = cwd.map(str::trim).filter(|value| !value.is_empty());
    let path_kind = detect_path_kind(cwd);
    let resolved_profile = match requested_profile {
        WindowsShellProfile::Auto => match path_kind {
            ShellPathKind::Wsl => ResolvedShellKind::Wsl,
            _ => ResolvedShellKind::Powershell,
        },
        WindowsShellProfile::Powershell => ResolvedShellKind::Powershell,
        WindowsShellProfile::Wsl => ResolvedShellKind::Wsl,
    };

    match resolved_profile {
        ResolvedShellKind::Powershell => {
            if path_kind == ShellPathKind::Wsl {
                return Err(AppError::ProcessError(
                    "This workspace appears to be inside WSL. Switch the Windows shell profile to WSL before opening a terminal here."
                        .to_string(),
                ));
            }

            Ok(Some(TerminalShellPlan {
                program: if prefer_pwsh {
                    "pwsh.exe".to_string()
                } else {
                    "powershell.exe".to_string()
                },
                args: vec!["-NoLogo".to_string(), "-NoProfile".to_string()],
                host_cwd: cwd.map(str::to_string),
                warning: None,
            }))
        }
        ResolvedShellKind::Wsl => {
            let resolved_wsl_cwd = match cwd {
                Some(value) => convert_windows_path_to_wsl(value).ok_or_else(|| {
                    AppError::ProcessError(format!(
                        "Unable to convert '{}' into a WSL working directory. Switch the Windows shell profile to PowerShell or open the workspace inside WSL.",
                        value
                    ))
                })?,
                None => String::new(),
            };

            let mut args = Vec::new();
            if !resolved_wsl_cwd.is_empty() {
                args.push("--cd".to_string());
                args.push(resolved_wsl_cwd);
            }
            args.push("--".to_string());
            args.push("bash".to_string());
            args.push("-l".to_string());

            Ok(Some(TerminalShellPlan {
                program: "wsl.exe".to_string(),
                args,
                host_cwd: None,
                warning: match (requested_profile, path_kind) {
                    (_, ShellPathKind::Windows) if cwd.is_some() => Some(
                        "WSL will use a converted /mnt/... working directory. Avoid mixing WSL and PowerShell builds in the same workspace."
                            .to_string(),
                    ),
                    _ => None,
                },
            }))
        }
        ResolvedShellKind::Default => Ok(None),
    }
}

fn command_exists_for_platform(command: &str, is_windows: bool) -> bool {
    let locator = if is_windows { "where" } else { "which" };
    Command::new(locator)
        .arg(command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn is_path_separator(ch: char) -> bool {
    ch == '\\' || ch == '/'
}

fn merge_warning(current: Option<String>, next: Option<String>) -> Option<String> {
    match (current, next) {
        (Some(existing), Some(additional)) => Some(format!("{} {}", existing, additional)),
        (Some(existing), None) => Some(existing),
        (None, Some(additional)) => Some(additional),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_auto_uses_powershell_for_windows_path() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Auto,
            Some(r"C:\Users\Payton\project"),
            "npm run build",
            true,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Powershell);
        assert_eq!(plan.program, "pwsh.exe");
    }

    #[test]
    fn windows_explicit_powershell_uses_powershell() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Powershell,
            Some(r"C:\Users\Payton\project"),
            "cargo build",
            false,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Powershell);
        assert_eq!(plan.program, "powershell.exe");
    }

    #[test]
    fn windows_explicit_wsl_converts_windows_path() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Wsl,
            Some(r"C:\Users\Payton\project"),
            "npm test",
            true,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Wsl);
        assert_eq!(plan.program, "wsl.exe");
        assert_eq!(
            plan.display_cwd.as_deref(),
            Some("/mnt/c/Users/Payton/project")
        );
        assert!(plan.warning.is_some());
    }

    #[test]
    fn windows_auto_uses_wsl_for_linux_home_path() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Auto,
            Some("/home/payton/project"),
            "npm test",
            true,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Wsl);
        assert_eq!(plan.display_cwd.as_deref(), Some("/home/payton/project"));
    }

    #[test]
    fn windows_auto_uses_wsl_for_unc_wsl_path() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Auto,
            Some(r"\\wsl$\Ubuntu\home\payton\project"),
            "npm test",
            true,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Wsl);
        assert_eq!(plan.display_cwd.as_deref(), Some("/home/payton/project"));
    }

    #[test]
    fn non_windows_keeps_existing_shell_behavior() {
        let plan = resolve_command_shell_for_platform(
            false,
            WindowsShellProfile::Auto,
            Some("/tmp/project"),
            "npm test",
            true,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Default);
        assert_eq!(plan.program, "bash");
    }

    #[test]
    fn powershell_blocks_bash_only_commands() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Auto,
            Some(r"C:\Users\Payton\project"),
            "bash tools/smoke-autoresearch-local.sh",
            true,
        )
        .expect("plan");

        assert!(plan
            .blocking_message
            .as_deref()
            .unwrap_or_default()
            .contains("bash-only"));
    }

    #[test]
    fn auto_wsl_blocks_windows_tauri_builds() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Auto,
            Some("/home/payton/project"),
            "cargo-tauri build",
            true,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Wsl);
        assert!(plan
            .blocking_message
            .as_deref()
            .unwrap_or_default()
            .contains("PowerShell"));
    }

    #[test]
    fn explicit_wsl_keeps_tauri_build_with_warning() {
        let plan = resolve_command_shell_for_platform(
            true,
            WindowsShellProfile::Wsl,
            Some("/home/payton/project"),
            "npm run tauri:build",
            true,
        )
        .expect("plan");

        assert_eq!(plan.resolved_profile, ResolvedShellKind::Wsl);
        assert!(plan.blocking_message.is_none());
        assert!(plan
            .warning
            .as_deref()
            .unwrap_or_default()
            .contains("PowerShell"));
    }
}
