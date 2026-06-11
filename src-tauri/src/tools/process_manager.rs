use crate::models::ToolExecutionStatus;
use crate::utils::{AppError, AppResult};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug)]
struct ManagedProcess {
    child: Option<Child>,
    cancel_requested: bool,
    timed_out: bool,
}

type SharedManagedProcess = Arc<Mutex<ManagedProcess>>;

#[derive(Default)]
struct ProcessManager {
    processes: Mutex<HashMap<String, SharedManagedProcess>>,
}

pub struct ManagedProcessHandle {
    pub execution_id: String,
    process: SharedManagedProcess,
}

pub struct ManagedProcessOutput {
    pub output: Output,
    pub status: ToolExecutionStatus,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelToolExecutionResponse {
    pub execution_id: String,
    pub cancelled: bool,
    pub status: String,
    pub message: String,
}

static PROCESS_MANAGER: Lazy<ProcessManager> = Lazy::new(ProcessManager::default);

fn next_execution_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(unix)]
fn prepare_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn prepare_command(_command: &mut Command) {}

#[cfg(unix)]
fn kill_process_group(pid: u32) {
    let pgid = -(pid as i32);
    unsafe {
        libc::kill(pgid, libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(100));
    unsafe {
        libc::kill(pgid, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn kill_process_group(_pid: u32) {}

fn kill_managed_process(process: &mut ManagedProcess) {
    let Some(child) = process.child.as_mut() else {
        return;
    };

    if child.try_wait().ok().flatten().is_some() {
        return;
    }

    let pid = child.id();
    if pid > 0 {
        kill_process_group(pid);
    }
    let _ = child.kill();
}

impl ProcessManager {
    fn insert(&self, execution_id: String, child: Child) -> ManagedProcessHandle {
        let process = Arc::new(Mutex::new(ManagedProcess {
            child: Some(child),
            cancel_requested: false,
            timed_out: false,
        }));

        self.processes
            .lock()
            .expect("process manager poisoned")
            .insert(execution_id.clone(), process.clone());

        ManagedProcessHandle {
            execution_id,
            process,
        }
    }

    fn remove(&self, execution_id: &str) {
        self.processes
            .lock()
            .expect("process manager poisoned")
            .remove(execution_id);
    }

    fn get(&self, execution_id: &str) -> Option<SharedManagedProcess> {
        self.processes
            .lock()
            .expect("process manager poisoned")
            .get(execution_id)
            .cloned()
    }
}

pub fn spawn_bash_process(
    command: &str,
    cwd: &str,
    requested_execution_id: Option<&str>,
) -> AppResult<ManagedProcessHandle> {
    spawn_shell_process(
        "bash",
        &["-lc".to_string(), command.to_string()],
        Some(cwd),
        requested_execution_id,
    )
}

pub fn spawn_shell_process(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    requested_execution_id: Option<&str>,
) -> AppResult<ManagedProcessHandle> {
    let mut child_command = Command::new(program);
    child_command.args(args);
    if let Some(dir) = cwd {
        child_command.current_dir(dir);
    }
    child_command.stdout(Stdio::piped()).stderr(Stdio::piped());
    prepare_command(&mut child_command);

    let child = child_command
        .spawn()
        .map_err(|e| AppError::ProcessError(e.to_string()))?;

    Ok(PROCESS_MANAGER.insert(
        requested_execution_id
            .map(str::to_string)
            .unwrap_or_else(next_execution_id),
        child,
    ))
}

pub fn wait_for_managed_process(
    handle: ManagedProcessHandle,
    timeout_secs: u64,
) -> AppResult<ManagedProcessOutput> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        let finished = {
            let mut process = handle.process.lock().expect("process lock poisoned");
            let child_status = match process.child.as_mut() {
                Some(child) => child.try_wait(),
                None => {
                    return Err(AppError::ProcessError(
                        "Managed process handle lost its child process".to_string(),
                    ));
                }
            };

            match child_status {
                Ok(Some(_)) => {
                    let output = process
                        .child
                        .take()
                        .ok_or_else(|| {
                            AppError::ProcessError(
                                "Managed process handle lost its child process".to_string(),
                            )
                        })?
                        .wait_with_output()
                        .map_err(|e| AppError::ProcessError(e.to_string()))?;
                    let status = if process.cancel_requested {
                        ToolExecutionStatus::Cancelled
                    } else if process.timed_out {
                        ToolExecutionStatus::TimedOut
                    } else if output.status.success() {
                        ToolExecutionStatus::Succeeded
                    } else {
                        ToolExecutionStatus::Failed
                    };
                    Some((output, status))
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        process.timed_out = true;
                        kill_managed_process(&mut process);
                        let output = process
                            .child
                            .take()
                            .ok_or_else(|| {
                                AppError::ProcessError(
                                    "Managed process handle lost its child process".to_string(),
                                )
                            })?
                            .wait_with_output()
                            .map_err(|e| AppError::ProcessError(e.to_string()))?;
                        Some((output, ToolExecutionStatus::TimedOut))
                    } else {
                        None
                    }
                }
                Err(error) => {
                    return Err(AppError::ProcessError(error.to_string()));
                }
            }
        };

        if let Some((output, status)) = finished {
            PROCESS_MANAGER.remove(&handle.execution_id);
            return Ok(ManagedProcessOutput { output, status });
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

pub fn cancel_execution(execution_id: &str) -> AppResult<CancelToolExecutionResponse> {
    let Some(process_ref) = PROCESS_MANAGER.get(execution_id) else {
        return Ok(CancelToolExecutionResponse {
            execution_id: execution_id.to_string(),
            cancelled: false,
            status: "not_found".to_string(),
            message: "Execution was not found or has already been cleaned up.".to_string(),
        });
    };

    let mut process = process_ref.lock().expect("process lock poisoned");
    let child_status = match process.child.as_mut() {
        Some(child) => child
            .try_wait()
            .map_err(|e| AppError::ProcessError(e.to_string()))?,
        None => {
            PROCESS_MANAGER.remove(execution_id);
            return Ok(CancelToolExecutionResponse {
                execution_id: execution_id.to_string(),
                cancelled: false,
                status: "already_finished".to_string(),
                message: "Execution already finished before cancellation was requested."
                    .to_string(),
            });
        }
    };

    if child_status.is_some() {
        PROCESS_MANAGER.remove(execution_id);
        return Ok(CancelToolExecutionResponse {
            execution_id: execution_id.to_string(),
            cancelled: false,
            status: "already_finished".to_string(),
            message: "Execution already finished before cancellation was requested.".to_string(),
        });
    }

    process.cancel_requested = true;
    kill_managed_process(&mut process);

    Ok(CancelToolExecutionResponse {
        execution_id: execution_id.to_string(),
        cancelled: true,
        status: "cancelled".to_string(),
        message: "Cancellation signal sent to the running process.".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_temp_file(label: &str) -> String {
        std::env::temp_dir()
            .join(format!(
                "pipi-shrimp-process-manager-{}-{}",
                label,
                uuid::Uuid::new_v4()
            ))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn managed_process_can_be_cancelled() {
        let handle = spawn_bash_process("sleep 30", "/tmp", Some("cancel-test"))
            .expect("spawn should succeed");

        let cancel = cancel_execution("cancel-test").expect("cancel should succeed");
        assert!(cancel.cancelled);
        assert_eq!(cancel.status, "cancelled");

        let output = wait_for_managed_process(handle, 1).expect("wait should finish");
        assert_eq!(output.status, ToolExecutionStatus::Cancelled);
    }

    #[test]
    fn cancellation_stops_background_subprocesses() {
        let marker_path = unique_temp_file("cancel-marker");
        let command = format!("(sleep 1; echo survived > \"{}\") & wait", marker_path);
        let handle = spawn_bash_process(&command, "/tmp", Some("cancel-group-test"))
            .expect("spawn should succeed");

        cancel_execution("cancel-group-test").expect("cancel should succeed");
        let output = wait_for_managed_process(handle, 5).expect("wait should finish");
        assert_eq!(output.status, ToolExecutionStatus::Cancelled);

        std::thread::sleep(Duration::from_millis(1300));
        assert!(
            fs::metadata(&marker_path).is_err(),
            "background child should be terminated"
        );
    }

    #[test]
    fn timeout_kills_background_process_group() {
        let marker_path = unique_temp_file("timeout-marker");
        let command = format!("(sleep 2; echo survived > \"{}\") & wait", marker_path);
        let handle = spawn_bash_process(&command, "/tmp", Some("timeout-group-test"))
            .expect("spawn should succeed");

        let output = wait_for_managed_process(handle, 1).expect("wait should finish");
        assert_eq!(output.status, ToolExecutionStatus::TimedOut);

        std::thread::sleep(Duration::from_millis(2200));
        assert!(
            fs::metadata(&marker_path).is_err(),
            "timed out child should be terminated with its process group"
        );
    }
}
