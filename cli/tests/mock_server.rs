//! Integration tests: the real client and the real binary against a local mock GraphQL server (wiremock).
//! The mock answers with the same shapes the TypeScript API returns. Nothing here talks to the real API;
//! the README shows that run separately.

use std::time::Duration;

use autoflow_cli::client::{CliError, GraphQlClient};
use autoflow_cli::commands::{cancel_run, list_runs, list_workflows, resolve_workflow, start_run, RunQuery};
use autoflow_cli::follow::{follow, Event, FollowOptions};
use serde_json::{json, Value};
use wiremock::matchers::{body_partial_json, body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn run_json(id: &str, state: &str, done: usize) -> Value {
    json!({
        "__typename": "Run", "id": id, "state": state,
        "completedSteps": (0..done).map(|i| format!("s{i}")).collect::<Vec<_>>(),
        "totalSteps": 3, "error": null, "cancelRequested": false,
        "workflow": { "name": "Quick check" }
    })
}

fn data(v: Value) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({ "data": v }))
}

async fn mount_workflows(server: &MockServer) {
    let node = |id: &str, name: &str| json!({ "node": { "id": id, "name": name, "runCount": 2, "steps": [{ "id": "open", "type": "navigate" }, { "id": "read", "type": "extract" }] } });
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("workflows(first: 100)"))
        .respond_with(data(json!({ "workflows": { "edges": [node("wf-1", "Quick check"), node("wf-2", "Flaky page")] } })))
        .mount(server)
        .await;
}

async fn mount_run_sequence(server: &MockServer, id: &str, states: &[(&str, usize)]) {
    // Earlier mocks win while they have answers left, so each state is mounted with a count of one.
    for (state, done) in states {
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .and(body_string_contains("run(id: $id)"))
            .and(body_partial_json(json!({ "variables": { "id": id } })))
            .respond_with(data(json!({ "run": run_json(id, state, *done) })))
            .up_to_n_times(1)
            .mount(server)
            .await;
    }
}

fn client(server: &MockServer) -> GraphQlClient {
    GraphQlClient::new(&format!("{}/graphql", server.uri())).unwrap()
}

fn fast() -> FollowOptions {
    FollowOptions { initial: Duration::from_millis(10), max: Duration::from_millis(50), timeout: Duration::from_secs(10) }
}

#[tokio::test]
async fn workflows_are_listed_and_resolved_by_id_or_name() {
    let server = MockServer::start().await;
    mount_workflows(&server).await;
    let c = client(&server);
    let list = list_workflows(&c).await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].steps.len(), 2);
    assert_eq!(resolve_workflow(&c, "wf-2").await.unwrap().name, "Flaky page");
    assert_eq!(resolve_workflow(&c, "QUICK CHECK").await.unwrap().id, "wf-1");
    let err = resolve_workflow(&c, "nope").await.unwrap_err();
    assert!(matches!(err, CliError::NotFound(_)), "{err}");
}

#[tokio::test]
async fn runs_follow_the_cursor_across_pages_only_when_asked() {
    let server = MockServer::start().await;
    let page = |ids: &[&str], next: bool, cursor: &str| {
        data(json!({ "runs": { "totalCount": 3, "pageInfo": { "hasNextPage": next, "endCursor": cursor },
            "edges": ids.iter().map(|id| json!({ "node": run_json(id, "COMPLETED", 3) })).collect::<Vec<_>>() } }))
    };
    Mock::given(method("POST"))
        .and(body_partial_json(json!({ "variables": { "after": null } })))
        .respond_with(page(&["r3", "r2"], true, "c2"))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(body_partial_json(json!({ "variables": { "after": "c2" } })))
        .respond_with(page(&["r1"], false, "c1"))
        .mount(&server)
        .await;
    let c = client(&server);
    let one = RunQuery { workflow_id: None, state: None, first: 2, all: false };
    let (runs, total) = list_runs(&c, &one).await.unwrap();
    assert_eq!((runs.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), total), (vec!["r3", "r2"], 3));
    let all = RunQuery { all: true, ..one };
    let (runs, _) = list_runs(&c, &all).await.unwrap();
    assert_eq!(runs.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["r3", "r2", "r1"]);
}

#[tokio::test]
async fn the_filters_are_sent_as_variables() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_partial_json(json!({ "variables": { "workflowId": "wf-1", "state": "FAILED", "first": 5 } })))
        .respond_with(data(
            json!({ "runs": { "totalCount": 0, "pageInfo": { "hasNextPage": false, "endCursor": null }, "edges": [] } }),
        ))
        .expect(1)
        .mount(&server)
        .await;
    let q = RunQuery { workflow_id: Some("wf-1".into()), state: Some("FAILED".into()), first: 5, all: false };
    assert!(list_runs(&client(&server), &q).await.unwrap().0.is_empty());
}

#[tokio::test]
async fn start_returns_the_run_and_sends_the_timeout() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_string_contains("startRun"))
        .and(body_partial_json(json!({ "variables": { "input": { "workflowId": "wf-1", "stepTimeoutMs": 5000 } } })))
        .respond_with(data(json!({ "startRun": run_json("r9", "QUEUED", 0) })))
        .expect(1)
        .mount(&server)
        .await;
    let run = start_run(&client(&server), "wf-1", Some(5000)).await.unwrap();
    assert_eq!((run.id.as_str(), run.state.as_str()), ("r9", "QUEUED"));
}

#[tokio::test]
async fn typed_errors_from_a_mutation_become_errors_with_their_details() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_string_contains("startRun"))
        .respond_with(data(json!({ "startRun": { "__typename": "ValidationError", "message": "The input is not valid.",
            "issues": [{ "path": "input.stepTimeoutMs", "message": "must be at least 100" }] } })))
        .mount(&server)
        .await;
    Mock::given(method("POST")).and(body_string_contains("cancelRun"))
        .respond_with(data(json!({ "cancelRun": { "__typename": "ConflictError", "message": "The run already ended as FAILED.", "state": "FAILED" } })))
        .mount(&server).await;
    let c = client(&server);
    let e = start_run(&c, "wf-1", Some(50)).await.unwrap_err();
    assert!(
        matches!(&e, CliError::Typed(m) if m.contains("ValidationError") && m.contains("input.stepTimeoutMs: must be at least 100")),
        "{e}"
    );
    let e = cancel_run(&c, "r1").await.unwrap_err();
    assert!(matches!(&e, CliError::Typed(m) if m.contains("ConflictError") && m.contains("already ended")), "{e}");
}

#[tokio::test]
async fn cancel_returns_the_run_with_the_request_flag() {
    let server = MockServer::start().await;
    let mut run = run_json("r1", "RUNNING", 1);
    run["cancelRequested"] = json!(true);
    Mock::given(method("POST"))
        .and(body_string_contains("cancelRun"))
        .and(body_partial_json(json!({ "variables": { "id": "r1" } })))
        .respond_with(data(json!({ "cancelRun": run })))
        .expect(1)
        .mount(&server)
        .await;
    assert!(cancel_run(&client(&server), "r1").await.unwrap().cancel_requested);
}

#[tokio::test]
async fn follow_waits_longer_while_nothing_changes_and_starts_over_on_progress() {
    let server = MockServer::start().await;
    mount_run_sequence(
        &server,
        "r1",
        &[
            ("QUEUED", 0),
            ("RUNNING", 0),
            ("RUNNING", 0),
            ("RUNNING", 0),
            ("RUNNING", 0),
            ("RUNNING", 1),
            ("RUNNING", 1),
            ("COMPLETED", 2),
        ],
    )
    .await;
    let mut waits: Vec<u128> = Vec::new();
    let mut updates: Vec<String> = Vec::new();
    let mut seen = |e: Event<'_>| match e {
        Event::Wait(d) => waits.push(d.as_millis()),
        Event::Update(r) => updates.push(format!("{}:{}", r.state, r.completed_steps.len())),
    };
    let run = follow(&client(&server), "r1", &fast(), &mut seen).await.unwrap();
    assert_eq!(run.state, "COMPLETED");
    assert_eq!(updates, vec!["QUEUED:0", "RUNNING:0", "RUNNING:1", "COMPLETED:2"]);
    // QUEUED (new) 10 | RUNNING (new) 10 | same 20 | same 40 | same 50 (ceiling) | step done 10 | same 20
    assert_eq!(waits, vec![10, 10, 20, 40, 50, 10, 20]);
}

#[tokio::test]
async fn follow_gives_up_at_its_timeout_and_says_what_state_the_run_is_in() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_string_contains("run(id: $id)"))
        .respond_with(data(json!({ "run": run_json("r1", "RUNNING", 1) })))
        .mount(&server)
        .await;
    let opts =
        FollowOptions { initial: Duration::from_millis(5), max: Duration::from_millis(10), timeout: Duration::from_millis(150) };
    let mut ignore = |_: Event<'_>| {};
    let result = tokio::time::timeout(Duration::from_secs(5), follow(&client(&server), "r1", &opts, &mut ignore))
        .await
        .expect("follow must stop by itself at its timeout");
    assert!(matches!(&result, Err(CliError::Timeout(m)) if m.contains("still RUNNING")), "{result:?}");
}

#[tokio::test]
async fn follow_on_an_unknown_run_is_not_found() {
    let server = MockServer::start().await;
    Mock::given(method("POST")).respond_with(data(json!({ "run": null }))).mount(&server).await;
    let mut ignore = |_: Event<'_>| {};
    let e = follow(&client(&server), "ghost", &fast(), &mut ignore).await.unwrap_err();
    assert!(matches!(e, CliError::NotFound(_)), "{e}");
}

#[tokio::test]
async fn a_refused_query_shows_the_graphql_message_even_on_a_400() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({ "errors": [{ "message": "Query is 9 levels deep; the limit is 6.", "extensions": { "code": "DEPTH_LIMIT_EXCEEDED" } }] })))
        .mount(&server).await;
    let e = list_workflows(&client(&server)).await.unwrap_err();
    assert!(matches!(&e, CliError::GraphQl(m) if m[0].contains("9 levels deep") && m[0].contains("DEPTH_LIMIT_EXCEEDED")), "{e}");
}

#[tokio::test]
async fn graphql_errors_in_a_200_answer_are_errors_too() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": null, "errors": [{ "message": "Unexpected error." }] })),
        )
        .mount(&server)
        .await;
    let e = list_workflows(&client(&server)).await.unwrap_err();
    assert!(matches!(&e, CliError::GraphQl(m) if m == &vec!["Unexpected error.".to_string()]), "{e}");
}

#[tokio::test]
async fn a_plain_server_error_is_reported_with_its_status() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500).set_body_string("upstream exploded"))
        .mount(&server)
        .await;
    let e = list_workflows(&client(&server)).await.unwrap_err();
    assert!(matches!(&e, CliError::Http(500, body) if body.contains("upstream exploded")), "{e}");
}

#[tokio::test]
async fn a_server_that_is_not_there_is_a_transport_error() {
    let c = GraphQlClient::new("http://127.0.0.1:1/graphql").unwrap();
    let e = list_workflows(&c).await.unwrap_err();
    assert!(matches!(e, CliError::Transport(_)), "{e}");
}

// ---- the compiled binary, end to end against the mock

async fn run_binary(server: &MockServer, args: &[&str]) -> (i32, String, String) {
    let out = tokio::process::Command::new(env!("CARGO_BIN_EXE_autoflow-cli"))
        .arg("--url")
        .arg(format!("{}/graphql", server.uri()))
        .args(args)
        .output()
        .await
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn binary_start_follow_prints_progress_and_exits_0_when_the_run_completes() {
    let server = MockServer::start().await;
    mount_workflows(&server).await;
    Mock::given(method("POST"))
        .and(body_string_contains("startRun"))
        .respond_with(data(json!({ "startRun": run_json("r1", "QUEUED", 0) })))
        .mount(&server)
        .await;
    mount_run_sequence(&server, "r1", &[("RUNNING", 1), ("RUNNING", 1), ("COMPLETED", 3)]).await;
    let (code, out, err) =
        run_binary(&server, &["start", "quick check", "--follow", "--interval-ms", "10", "--max-interval-ms", "40"]).await;
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("started r1  QUEUED"), "{out}");
    assert!(out.contains("r1  RUNNING     1/3 steps  Quick check"), "{out}");
    assert!(out.contains("r1  COMPLETED   3/3 steps  Quick check"), "{out}");
}

#[tokio::test(flavor = "multi_thread")]
async fn binary_follow_exits_1_for_a_failed_run_and_2_for_a_cancelled_one() {
    for (state, want) in [("FAILED", 1), ("CANCELLED", 2), ("TIMED_OUT", 3)] {
        let server = MockServer::start().await;
        mount_run_sequence(&server, "r1", &[(state, 1)]).await;
        let (code, out, _) = run_binary(&server, &["follow", "r1", "--interval-ms", "10"]).await;
        assert_eq!(code, want, "{state}: {out}");
        assert!(out.contains(state), "{out}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn binary_reports_an_unreachable_server_and_a_typed_error_with_exit_10() {
    let (code, _, err) = tokio::process::Command::new(env!("CARGO_BIN_EXE_autoflow-cli"))
        .args(["--url", "http://127.0.0.1:1/graphql", "workflows"])
        .output()
        .await
        .map(|o| (o.status.code().unwrap_or(-1), (), String::from_utf8_lossy(&o.stderr).into_owned()))
        .unwrap();
    assert_eq!(code, 10);
    assert!(err.contains("cannot reach the server"), "{err}");

    let server = MockServer::start().await;
    mount_workflows(&server).await;
    Mock::given(method("POST"))
        .and(body_string_contains("cancelRun"))
        .respond_with(data(json!({ "cancelRun": { "__typename": "NotFoundError", "message": "No run with id zzz." } })))
        .mount(&server)
        .await;
    let (code, _, err) = run_binary(&server, &["cancel", "zzz"]).await;
    assert_eq!(code, 10);
    assert!(err.contains("NotFoundError: No run with id zzz."), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn binary_workflows_and_runs_print_tables() {
    let server = MockServer::start().await;
    mount_workflows(&server).await;
    let (code, out, _) = run_binary(&server, &["workflows"]).await;
    assert_eq!(code, 0);
    assert!(out.contains("wf-1") && out.contains("Quick check") && out.contains("Flaky page"), "{out}");
    Mock::given(method("POST")).and(body_string_contains("runs(workflowId"))
        .respond_with(data(json!({ "runs": { "totalCount": 1, "pageInfo": { "hasNextPage": false, "endCursor": null }, "edges": [{ "node": run_json("r1", "COMPLETED", 3) }] } })))
        .mount(&server).await;
    let (code, out, _) = run_binary(&server, &["runs"]).await;
    assert_eq!(code, 0);
    assert!(out.contains("r1  COMPLETED   3/3 steps  Quick check") && out.contains("1 of 1 runs"), "{out}");
}
