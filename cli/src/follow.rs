use std::time::{Duration, Instant};

use crate::client::{CliError, GraphQlClient};
use crate::commands::get_run;
use crate::models::Run;

#[derive(Debug, Clone)]
pub struct FollowOptions {
    /// First wait between looks, and the wait after any progress.
    pub initial: Duration,
    /// The wait never grows past this.
    pub max: Duration,
    /// Give up after this long.
    pub timeout: Duration,
}

impl Default for FollowOptions {
    fn default() -> Self {
        Self { initial: Duration::from_millis(250), max: Duration::from_secs(3), timeout: Duration::from_secs(300) }
    }
}

/// What `follow` tells its caller as it goes.
#[derive(Debug)]
pub enum Event<'a> {
    /// The run changed state or finished another step.
    Update(&'a Run),
    /// About to wait this long before looking again.
    Wait(Duration),
}

pub fn is_terminal(state: &str) -> bool {
    matches!(state, "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT")
}

/// The process exit code for a run's final state, so a script can branch on it.
pub fn exit_code(state: &str) -> i32 {
    match state {
        "COMPLETED" => 0,
        "FAILED" => 1,
        "CANCELLED" => 2,
        "TIMED_OUT" => 3,
        _ => 4,
    }
}

/// Doubles the wait, up to `max`.
pub fn next_delay(current: Duration, max: Duration) -> Duration {
    (current * 2).min(max)
}

/// Looks at the run until it ends. The wait between looks doubles while nothing changes and starts over when the
/// run moves (a new state or another finished step), so a quiet run is not hammered and a busy one is followed closely.
pub async fn follow(
    client: &GraphQlClient,
    run_id: &str,
    opts: &FollowOptions,
    observer: &mut dyn FnMut(Event<'_>),
) -> Result<Run, CliError> {
    let started = Instant::now();
    let mut delay = opts.initial;
    let mut last: Option<(String, usize)> = None;
    loop {
        let run = get_run(client, run_id).await?;
        let key = (run.state.clone(), run.completed_steps.len());
        let progressed = last.as_ref() != Some(&key);
        if progressed {
            observer(Event::Update(&run));
        }
        last = Some(key);
        if is_terminal(&run.state) {
            return Ok(run);
        }
        if started.elapsed() >= opts.timeout {
            return Err(CliError::Timeout(format!("gave up after {} s; the run is still {}", opts.timeout.as_secs(), run.state)));
        }
        delay = if progressed { opts.initial } else { next_delay(delay, opts.max) };
        observer(Event::Wait(delay));
        tokio::time::sleep(delay).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_states_are_exactly_the_four_final_ones() {
        for s in ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] {
            assert!(is_terminal(s), "{s} should be terminal");
        }
        for s in ["QUEUED", "RUNNING", "", "completed", "UNKNOWN"] {
            assert!(!is_terminal(s), "{s:?} should not be terminal");
        }
    }

    #[test]
    fn each_final_state_has_its_own_exit_code() {
        assert_eq!(exit_code("COMPLETED"), 0);
        assert_eq!(exit_code("FAILED"), 1);
        assert_eq!(exit_code("CANCELLED"), 2);
        assert_eq!(exit_code("TIMED_OUT"), 3);
        assert_eq!(exit_code("RUNNING"), 4);
    }

    #[test]
    fn the_wait_doubles_and_stops_at_the_ceiling() {
        let max = Duration::from_millis(1000);
        let mut d = Duration::from_millis(100);
        let mut seen = Vec::new();
        for _ in 0..6 {
            seen.push(d.as_millis());
            d = next_delay(d, max);
        }
        assert_eq!(seen, vec![100, 200, 400, 800, 1000, 1000]);
    }

    #[test]
    fn the_wait_never_exceeds_the_ceiling_for_any_start() {
        let max = Duration::from_millis(3000);
        for start_ms in [1u64, 7, 250, 1500, 2999, 3000, 10_000] {
            let mut d = Duration::from_millis(start_ms);
            for _ in 0..20 {
                d = next_delay(d, max);
                assert!(d <= max.max(Duration::from_millis(start_ms)), "start {start_ms}: {d:?}");
            }
        }
    }
}
