use std::process::ExitCode;

use autoflow_cli::cli::{Cli, Command, FollowArgs};
use autoflow_cli::client::{CliError, GraphQlClient};
use autoflow_cli::commands::{
    cancel_run, format_run_line, format_runs, format_workflows, list_runs, list_workflows, resolve_workflow, start_run, RunQuery,
};
use autoflow_cli::follow::{exit_code, follow, Event};
use autoflow_cli::models::Run;
use clap::Parser;

async fn follow_and_print(client: &GraphQlClient, run_id: &str, args: &FollowArgs) -> Result<i32, CliError> {
    let mut printer = |event: Event<'_>| match event {
        Event::Update(run) => println!("{}", format_run_line(run)),
        Event::Wait(d) => eprintln!("  next look in {} ms", d.as_millis()),
    };
    let run: Run = follow(client, run_id, &args.options(), &mut printer).await?;
    Ok(exit_code(&run.state))
}

async fn run(cli: Cli) -> Result<i32, CliError> {
    let client = GraphQlClient::new(&cli.url)?;
    match cli.command {
        Command::Workflows => {
            print!("{}", format_workflows(&list_workflows(&client).await?));
            Ok(0)
        }
        Command::Runs { workflow, state, first, all } => {
            let (runs, total) = list_runs(&client, &RunQuery { workflow_id: workflow, state, first, all }).await?;
            print!("{}", format_runs(&runs, total));
            Ok(0)
        }
        Command::Start { workflow, step_timeout_ms, follow, follow_args } => {
            let wf = resolve_workflow(&client, &workflow).await?;
            let run = start_run(&client, &wf.id, step_timeout_ms).await?;
            println!("started {}", format_run_line(&run));
            if follow {
                return follow_and_print(&client, &run.id, &follow_args).await;
            }
            Ok(0)
        }
        Command::Follow { run_id, follow_args } => follow_and_print(&client, &run_id, &follow_args).await,
        Command::Cancel { run_id } => {
            let run = cancel_run(&client, &run_id).await?;
            println!("cancel requested: {}", format_run_line(&run));
            Ok(0)
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Cli::parse()).await {
        Ok(code) => ExitCode::from(code as u8),
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(10)
        }
    }
}
