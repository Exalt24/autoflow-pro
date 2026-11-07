use std::time::Duration;

use clap::{Args, Parser, Subcommand};

use crate::follow::FollowOptions;

const STATES: [&str; 6] = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];

#[derive(Debug, Parser)]
#[command(name = "autoflow-cli", version, about = "Command line client for the AutoFlow Pro GraphQL API")]
pub struct Cli {
    /// Where the GraphQL endpoint is.
    #[arg(long, global = true, env = "AUTOFLOW_URL", default_value = "http://127.0.0.1:4000/graphql")]
    pub url: String,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Args, Clone)]
pub struct FollowArgs {
    /// First wait between looks, in milliseconds. The wait doubles while nothing changes.
    #[arg(long, default_value_t = 250)]
    pub interval_ms: u64,
    /// The wait never grows past this, in milliseconds.
    #[arg(long, default_value_t = 3000)]
    pub max_interval_ms: u64,
    /// Give up after this many seconds.
    #[arg(long, default_value_t = 300)]
    pub timeout_secs: u64,
}

impl FollowArgs {
    pub fn options(&self) -> FollowOptions {
        let initial = Duration::from_millis(self.interval_ms.max(1));
        FollowOptions {
            initial,
            max: Duration::from_millis(self.max_interval_ms).max(initial),
            timeout: Duration::from_secs(self.timeout_secs),
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// List the workflows.
    Workflows,
    /// List runs, newest first.
    Runs {
        /// Only runs of this workflow id.
        #[arg(long)]
        workflow: Option<String>,
        /// Only runs in this state.
        #[arg(long, value_parser = STATES)]
        state: Option<String>,
        /// Page size, 1 to 100.
        #[arg(long, default_value_t = 20, value_parser = clap::value_parser!(u32).range(1..=100))]
        first: u32,
        /// Keep reading pages until there are no more.
        #[arg(long)]
        all: bool,
    },
    /// Start a run of a workflow, named by id or by name.
    Start {
        workflow: String,
        /// Budget for one step including its retries, in milliseconds.
        #[arg(long, value_parser = clap::value_parser!(u32).range(100..=3_600_000))]
        step_timeout_ms: Option<u32>,
        /// Follow the run until it ends.
        #[arg(long)]
        follow: bool,
        #[command(flatten)]
        follow_args: FollowArgs,
    },
    /// Watch a run until it ends. The exit code says how it ended: 0 completed, 1 failed, 2 cancelled, 3 timed out.
    Follow {
        run_id: String,
        #[command(flatten)]
        follow_args: FollowArgs,
    },
    /// Ask a run to stop.
    Cancel { run_id: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("autoflow-cli").chain(args.iter().copied()))
    }

    #[test]
    fn every_subcommand_parses() {
        assert!(matches!(parse(&["workflows"]).unwrap().command, Command::Workflows));
        assert!(matches!(parse(&["runs"]).unwrap().command, Command::Runs { first: 20, all: false, .. }));
        assert!(matches!(parse(&["start", "Quick check"]).unwrap().command, Command::Start { follow: false, .. }));
        assert!(matches!(parse(&["follow", "abc"]).unwrap().command, Command::Follow { .. }));
        assert!(matches!(parse(&["cancel", "abc"]).unwrap().command, Command::Cancel { .. }));
    }

    #[test]
    fn bad_values_are_refused() {
        assert!(parse(&["runs", "--state", "DONE"]).is_err());
        assert!(parse(&["runs", "--first", "0"]).is_err());
        assert!(parse(&["runs", "--first", "101"]).is_err());
        assert!(parse(&["start", "x", "--step-timeout-ms", "99"]).is_err());
        assert!(parse(&["follow"]).is_err());
        assert!(parse(&[]).is_err());
    }

    #[test]
    fn the_url_can_come_after_the_subcommand() {
        let cli = parse(&["workflows", "--url", "http://example.test/graphql"]).unwrap();
        assert_eq!(cli.url, "http://example.test/graphql");
    }

    #[test]
    fn follow_options_never_let_the_ceiling_sit_below_the_start() {
        let args = FollowArgs { interval_ms: 500, max_interval_ms: 100, timeout_secs: 5 };
        let o = args.options();
        assert_eq!(o.initial, Duration::from_millis(500));
        assert_eq!(o.max, Duration::from_millis(500));
        let zero = FollowArgs { interval_ms: 0, max_interval_ms: 10, timeout_secs: 1 }.options();
        assert_eq!(zero.initial, Duration::from_millis(1));
    }
}
