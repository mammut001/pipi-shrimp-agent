//! Deterministic Manual D barrier harness.
//!
//! `test_barrier_tool` blocks until `release_test_barrier(barrier_id)` or
//! cancellation via `cancel_tool_execution(executionId)`. Waiters register
//! under both `barrier_id` and optional `executionId` so dual-session cancel
//! isolation can be proven without sleep races.

use crate::tools::process_manager::CancelToolExecutionResponse;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarrierWaitOutcome {
    Released,
    Cancelled,
}

struct BarrierInner {
    released: bool,
    /// Active waiters currently blocked on this barrier.
    waiter_count: usize,
}

struct Barrier {
    inner: Mutex<BarrierInner>,
    cv: Condvar,
}

struct ExecutionWaiter {
    barrier_id: String,
    cancelled: bool,
    barrier: Arc<Barrier>,
}

#[derive(Default)]
struct BarrierRegistry {
    barriers: HashMap<String, Arc<Barrier>>,
    executions: HashMap<String, Arc<Mutex<ExecutionWaiter>>>,
}

static REGISTRY: Lazy<Mutex<BarrierRegistry>> = Lazy::new(|| Mutex::new(BarrierRegistry::default()));

fn get_or_create_barrier(registry: &mut BarrierRegistry, barrier_id: &str) -> Arc<Barrier> {
    registry
        .barriers
        .entry(barrier_id.to_string())
        .or_insert_with(|| {
            Arc::new(Barrier {
                inner: Mutex::new(BarrierInner {
                    released: false,
                    waiter_count: 0,
                }),
                cv: Condvar::new(),
            })
        })
        .clone()
}

/// True when at least one waiter is blocked on `barrier_id` (Ready-gate poll).
pub fn barrier_waiter_count(barrier_id: &str) -> usize {
    let registry = REGISTRY.lock().expect("barrier registry poisoned");
    registry
        .barriers
        .get(barrier_id)
        .and_then(|b| b.inner.lock().ok().map(|g| g.waiter_count))
        .unwrap_or(0)
}

/// True when `execution_id` is registered as an active barrier waiter.
pub fn is_execution_waiting(execution_id: &str) -> bool {
    let registry = REGISTRY.lock().expect("barrier registry poisoned");
    registry.executions.contains_key(execution_id)
}

/// Block until the barrier is released or this execution is cancelled.
pub fn wait_on_barrier(
    barrier_id: &str,
    execution_id: Option<&str>,
) -> anyhow::Result<BarrierWaitOutcome> {
    if barrier_id.trim().is_empty() {
        anyhow::bail!("Missing required parameter: barrier_id");
    }

    let barrier = {
        let mut registry = REGISTRY.lock().expect("barrier registry poisoned");
        let barrier = get_or_create_barrier(&mut registry, barrier_id);

        if let Some(exec_id) = execution_id.map(str::trim).filter(|v| !v.is_empty()) {
            if registry.executions.contains_key(exec_id) {
                anyhow::bail!(
                    "executionId '{}' is already waiting on a test barrier",
                    exec_id
                );
            }
            registry.executions.insert(
                exec_id.to_string(),
                Arc::new(Mutex::new(ExecutionWaiter {
                    barrier_id: barrier_id.to_string(),
                    cancelled: false,
                    barrier: barrier.clone(),
                })),
            );
        }

        barrier
    };

    {
        let mut inner = barrier.inner.lock().expect("barrier lock poisoned");
        if inner.released {
            cleanup_execution(execution_id);
            return Ok(BarrierWaitOutcome::Released);
        }
        inner.waiter_count = inner.waiter_count.saturating_add(1);
    }

    let outcome = loop {
        let cancelled = execution_id
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .and_then(|exec_id| {
                let registry = REGISTRY.lock().expect("barrier registry poisoned");
                registry
                    .executions
                    .get(exec_id)
                    .and_then(|w| w.lock().ok().map(|g| g.cancelled))
            })
            .unwrap_or(false);

        if cancelled {
            break BarrierWaitOutcome::Cancelled;
        }

        let inner = barrier.inner.lock().expect("barrier lock poisoned");
        if inner.released {
            break BarrierWaitOutcome::Released;
        }

        let (_guard, _) = barrier
            .cv
            .wait_timeout(inner, Duration::from_millis(25))
            .expect("barrier wait poisoned");
    };

    {
        let mut inner = barrier.inner.lock().expect("barrier lock poisoned");
        inner.waiter_count = inner.waiter_count.saturating_sub(1);
    }
    cleanup_execution(execution_id);

    Ok(outcome)
}

fn cleanup_execution(execution_id: Option<&str>) {
    let Some(exec_id) = execution_id.map(str::trim).filter(|v| !v.is_empty()) else {
        return;
    };
    let mut registry = REGISTRY.lock().expect("barrier registry poisoned");
    registry.executions.remove(exec_id);
}

/// Release all waiters on `barrier_id`. Idempotent.
pub fn release_test_barrier(barrier_id: &str) -> serde_json::Value {
    let barrier = {
        let mut registry = REGISTRY.lock().expect("barrier registry poisoned");
        get_or_create_barrier(&mut registry, barrier_id)
    };

    {
        let mut inner = barrier.inner.lock().expect("barrier lock poisoned");
        inner.released = true;
    }
    barrier.cv.notify_all();

    serde_json::json!({
        "status": "released",
        "barrierId": barrier_id,
        "waiterCount": barrier_waiter_count(barrier_id),
    })
}

/// Cancel a specific barrier waiter by execution id (mirrors process cancel).
pub fn cancel_by_execution_id(execution_id: &str) -> CancelToolExecutionResponse {
    let registry = REGISTRY.lock().expect("barrier registry poisoned");
    let Some(waiter) = registry.executions.get(execution_id).cloned() else {
        return CancelToolExecutionResponse {
            execution_id: execution_id.to_string(),
            cancelled: false,
            status: "not_found".to_string(),
            message: "Barrier execution was not found or has already been cleaned up.".to_string(),
        };
    };
    drop(registry);

    {
        let mut guard = waiter.lock().expect("execution waiter poisoned");
        if guard.cancelled {
            return CancelToolExecutionResponse {
                execution_id: execution_id.to_string(),
                cancelled: false,
                status: "already_finished".to_string(),
                message: "Barrier wait was already cancelled.".to_string(),
            };
        }
        guard.cancelled = true;
        guard.barrier.cv.notify_all();
    }

    CancelToolExecutionResponse {
        execution_id: execution_id.to_string(),
        cancelled: true,
        status: "cancelled".to_string(),
        message: "Cancellation signal sent to the barrier waiter.".to_string(),
    }
}

/// Drop all barriers and waiters (test harness reset).
pub fn reset_test_barriers() -> serde_json::Value {
    let mut registry = REGISTRY.lock().expect("barrier registry poisoned");
    let barrier_count = registry.barriers.len();
    let execution_count = registry.executions.len();

    for barrier in registry.barriers.values() {
        if let Ok(mut inner) = barrier.inner.lock() {
            inner.released = true;
        }
        barrier.cv.notify_all();
    }

    registry.barriers.clear();
    registry.executions.clear();

    serde_json::json!({
        "status": "reset",
        "clearedBarriers": barrier_count,
        "clearedExecutions": execution_count,
    })
}

/// Tool handler entry used by ToolRegistry.
pub fn execute_test_barrier_tool(args: &serde_json::Value) -> anyhow::Result<String> {
    let barrier_id = args
        .get("barrier_id")
        .or_else(|| args.get("barrierId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Missing required parameter: barrier_id"))?;

    let execution_id = args
        .get("executionId")
        .or_else(|| args.get("execution_id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty());

    match wait_on_barrier(barrier_id, execution_id)? {
        BarrierWaitOutcome::Released => Ok(serde_json::json!({
            "status": "done",
            "barrier_id": barrier_id,
            "executionId": execution_id,
        })
        .to_string()),
        BarrierWaitOutcome::Cancelled => Ok(serde_json::json!({
            "status": "cancelled",
            "barrier_id": barrier_id,
            "executionId": execution_id,
        })
        .to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::registry::{register_builtin_tools, ToolRegistry};
    use crate::tools::scheduler::execute_tool_calls;
    use crate::tools::{ToolCallRequest, ToolExecutionSource};
    use once_cell::sync::Lazy;
    use std::sync::Mutex;
    use std::thread;
    use std::time::{Duration, Instant};

    /// Serialize harness tests: they share a process-global barrier registry and
    /// `reset_test_barriers` would otherwise race parallel #[test] threads.
    static TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn unique(label: &str) -> String {
        format!("barrier-{}-{}", label, uuid::Uuid::new_v4())
    }

    fn wait_until(predicate: impl Fn() -> bool, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if predicate() {
                return;
            }
            thread::yield_now();
            thread::sleep(Duration::from_millis(1));
        }
        panic!("timed out waiting for barrier readiness");
    }

    fn make_barrier_tool_request(
        call_id: &str,
        barrier_id: &str,
        execution_id: &str,
    ) -> ToolCallRequest {
        ToolCallRequest {
            id: call_id.to_string(),
            name: "test_barrier_tool".to_string(),
            arguments: serde_json::json!({
                "barrier_id": barrier_id,
                "executionId": execution_id,
            })
            .to_string(),
            work_dir: None,
            source: ToolExecutionSource::AssistantToolCall,
            allowed_tools: None,
            api_key: None,
            model: None,
            base_url: None,
            provider: None,
            api_format: None,
            provider_capabilities: None,
            approval_token: None,
            execution_mode: None,
        }
    }

    fn make_builtin_registry() -> ToolRegistry {
        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry);
        registry
    }

    fn run_tool_batch_on_session(
        request: ToolCallRequest,
        session_id: &'static str,
    ) -> Vec<crate::tools::ToolCallResult> {
        let registry = make_builtin_registry();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(execute_tool_calls(&[request], &registry, None, session_id))
    }

    #[test]
    fn release_unblocks_waiter_with_done_status() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        let barrier_id = unique("release");
        let exec_id = unique("exec-release");
        let barrier_for_thread = barrier_id.clone();
        let exec_for_thread = exec_id.clone();

        let handle =
            thread::spawn(move || wait_on_barrier(&barrier_for_thread, Some(&exec_for_thread)));

        wait_until(|| is_execution_waiting(&exec_id), Duration::from_secs(2));
        release_test_barrier(&barrier_id);

        let outcome = handle.join().expect("thread join").expect("wait ok");
        assert_eq!(outcome, BarrierWaitOutcome::Released);
        assert!(!is_execution_waiting(&exec_id));
    }

    #[test]
    fn tool_release_returns_done_json() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        let barrier_id = unique("tool-release");
        let barrier_for_thread = barrier_id.clone();
        let exec_id = unique("exec");
        let exec_for_thread = exec_id.clone();

        let handle = thread::spawn(move || {
            execute_test_barrier_tool(&serde_json::json!({
                "barrier_id": barrier_for_thread,
                "executionId": exec_for_thread,
            }))
        });

        wait_until(|| is_execution_waiting(&exec_id), Duration::from_secs(2));
        release_test_barrier(&barrier_id);

        let content = handle.join().expect("join").expect("tool ok");
        let parsed: serde_json::Value = serde_json::from_str(&content).expect("json");
        assert_eq!(parsed["status"], "done");
        assert_eq!(parsed["barrier_id"], barrier_id);
    }

    #[test]
    fn cancel_while_waiting_does_not_hang() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        let barrier_id = unique("cancel");
        let barrier_for_thread = barrier_id.clone();
        let exec_id = unique("exec-cancel");
        let exec_for_thread = exec_id.clone();

        let handle =
            thread::spawn(move || wait_on_barrier(&barrier_for_thread, Some(&exec_for_thread)));

        wait_until(|| is_execution_waiting(&exec_id), Duration::from_secs(2));

        let cancel = cancel_by_execution_id(&exec_id);
        assert!(cancel.cancelled);
        assert_eq!(cancel.status, "cancelled");

        let outcome = handle.join().expect("join").expect("wait ok");
        assert_eq!(outcome, BarrierWaitOutcome::Cancelled);
        assert!(!is_execution_waiting(&exec_id));
    }

    #[test]
    fn dual_session_cancel_a_release_b_isolation() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        let barrier_a = unique("A");
        let barrier_b = unique("B");
        let exec_a = unique("exec-a");
        let exec_b = unique("exec-b");

        let a_barrier = barrier_a.clone();
        let a_exec = exec_a.clone();
        let handle_a = thread::spawn(move || wait_on_barrier(&a_barrier, Some(&a_exec)));

        let b_barrier = barrier_b.clone();
        let b_exec = exec_b.clone();
        let handle_b = thread::spawn(move || wait_on_barrier(&b_barrier, Some(&b_exec)));

        wait_until(
            || is_execution_waiting(&exec_a) && is_execution_waiting(&exec_b),
            Duration::from_secs(2),
        );

        let cancel_a = cancel_by_execution_id(&exec_a);
        assert!(cancel_a.cancelled);
        assert!(
            is_execution_waiting(&exec_b),
            "B must remain waiting after A cancel"
        );

        release_test_barrier(&barrier_b);

        let outcome_a = handle_a.join().expect("join a").expect("a ok");
        let outcome_b = handle_b.join().expect("join b").expect("b ok");
        assert_eq!(outcome_a, BarrierWaitOutcome::Cancelled);
        assert_eq!(outcome_b, BarrierWaitOutcome::Released);
    }


    /// GPT #73 Ready gate: dual-session cancel isolation through the real
    /// ToolRegistry + ToolScheduler path (execute_tool_calls), not wait_on_barrier().
    #[test]
    fn dual_session_cancel_a_release_b_via_registry_scheduler() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        let barrier_a = unique("sched-A");
        let barrier_b = unique("sched-B");
        let exec_a = unique("sched-execA");
        let exec_b = unique("sched-execB");

        let req_a = make_barrier_tool_request("call-a", &barrier_a, &exec_a);
        let req_b = make_barrier_tool_request("call-b", &barrier_b, &exec_b);

        let handle_a = thread::spawn(move || run_tool_batch_on_session(req_a, "session_a"));
        let handle_b = thread::spawn(move || run_tool_batch_on_session(req_b, "session_b"));

        wait_until(
            || {
                is_execution_waiting(&exec_a)
                    && is_execution_waiting(&exec_b)
                    && barrier_waiter_count(&barrier_a) >= 1
                    && barrier_waiter_count(&barrier_b) >= 1
            },
            Duration::from_secs(5),
        );

        // Public cancel_tool_execution command path (process cancel → barrier cancel).
        let cancel_a = {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("tokio runtime");
            rt.block_on(crate::commands::cancel_tool_execution(exec_a.clone()))
                .expect("cancel_tool_execution")
        };
        assert!(
            cancel_a.cancelled,
            "execA cancel must succeed via cancel_tool_execution: {:?}",
            cancel_a
        );
        assert!(
            is_execution_waiting(&exec_b),
            "B must remain waiting after A cancel (no cross-interference)"
        );
        assert_eq!(
            barrier_waiter_count(&barrier_b),
            1,
            "B waiter count must stay 1 after A cancel"
        );

        // Public release_test_barrier command path for B only.
        let release_b = {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("tokio runtime");
            rt.block_on(crate::commands::release_test_barrier(barrier_b.clone()))
                .expect("release_test_barrier")
        };
        assert_eq!(release_b["status"], "released");

        let results_a = handle_a.join().expect("join a");
        let results_b = handle_b.join().expect("join b");
        assert_eq!(results_a.len(), 1, "session_a should return one tool result");
        assert_eq!(results_b.len(), 1, "session_b should return one tool result");
        assert!(
            !results_a[0].is_error,
            "A should complete as cancelled JSON, not tool error: {}",
            results_a[0].content
        );
        assert!(
            !results_b[0].is_error,
            "B should complete as done JSON, not tool error: {}",
            results_b[0].content
        );

        let parsed_a: serde_json::Value =
            serde_json::from_str(&results_a[0].content).expect("A result json");
        let parsed_b: serde_json::Value =
            serde_json::from_str(&results_b[0].content).expect("B result json");
        assert_eq!(parsed_a["status"], "cancelled");
        assert_eq!(parsed_a["barrier_id"], barrier_a);
        assert_eq!(parsed_b["status"], "done");
        assert_eq!(parsed_b["barrier_id"], barrier_b);
        assert!(!is_execution_waiting(&exec_a));
        assert!(!is_execution_waiting(&exec_b));
    }

    #[test]
    fn reset_wakes_and_clears_waiters() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        // Isolate this test from parallel peers by using a unique exec id, then
        // reset only after the waiter is confirmed registered.
        let barrier_id = unique("reset");
        let barrier_for_thread = barrier_id.clone();
        let exec_id = unique("exec-reset");
        let exec_for_thread = exec_id.clone();

        let handle =
            thread::spawn(move || wait_on_barrier(&barrier_for_thread, Some(&exec_for_thread)));
        wait_until(|| is_execution_waiting(&exec_id), Duration::from_secs(2));

        let result = reset_test_barriers();
        assert_eq!(result["status"], "reset");

        let outcome = handle.join().expect("join").expect("wait ok");
        assert!(
            matches!(
                outcome,
                BarrierWaitOutcome::Released | BarrierWaitOutcome::Cancelled
            ),
            "reset must unblock waiter, got {:?}",
            outcome
        );
        assert!(!is_execution_waiting(&exec_id));
    }
}
