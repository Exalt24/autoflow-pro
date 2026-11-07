use serde_json::{json, Value};

use crate::client::{CliError, GraphQlClient};
use crate::models::{PageInfo, Run, Workflow};

const RUN_FIELDS: &str = "id state completedSteps totalSteps error cancelRequested workflow { name }";

fn from_value<T: serde::de::DeserializeOwned>(v: &Value, what: &str) -> Result<T, CliError> {
    serde_json::from_value(v.clone()).map_err(|e| CliError::Parse(format!("{what}: {e}")))
}

/// A mutation answers with a union. The API's error members all end in `Error`; this turns one into a message.
pub fn typed_error(value: &Value) -> Option<String> {
    let kind = value.get("__typename")?.as_str()?;
    if !kind.ends_with("Error") {
        return None;
    }
    let message = value.get("message").and_then(Value::as_str).unwrap_or("no message");
    let mut text = format!("{kind}: {message}");
    if let Some(issues) = value.get("issues").and_then(Value::as_array) {
        for i in issues {
            let path = i.get("path").and_then(Value::as_str).unwrap_or("?");
            let msg = i.get("message").and_then(Value::as_str).unwrap_or("?");
            text.push_str(&format!("\n  {path}: {msg}"));
        }
    }
    Some(text)
}

pub async fn list_workflows(c: &GraphQlClient) -> Result<Vec<Workflow>, CliError> {
    let data =
        c.request("{ workflows(first: 100) { edges { node { id name runCount steps { id type } } } } }", json!({})).await?;
    let edges = data["workflows"]["edges"].as_array().ok_or_else(|| CliError::Parse("workflows.edges".into()))?;
    edges.iter().map(|e| from_value(&e["node"], "workflow")).collect()
}

pub fn format_workflows(list: &[Workflow]) -> String {
    if list.is_empty() {
        return "no workflows\n".to_string();
    }
    let mut out = format!("{:<38}  {:<20}  {:>5}  {:>4}\n", "ID", "NAME", "STEPS", "RUNS");
    for w in list {
        out.push_str(&format!("{:<38}  {:<20}  {:>5}  {:>4}\n", w.id, w.name, w.steps.len(), w.run_count));
    }
    out
}

pub struct RunQuery {
    pub workflow_id: Option<String>,
    pub state: Option<String>,
    pub first: u32,
    pub all: bool,
}

/// One page, or with `all` every page by following the cursor.
pub async fn list_runs(c: &GraphQlClient, q: &RunQuery) -> Result<(Vec<Run>, u64), CliError> {
    let query = format!(
        "query($workflowId: ID, $state: RunState, $first: Int, $after: String) {{ runs(workflowId: $workflowId, state: $state, first: $first, after: $after) {{ totalCount pageInfo {{ hasNextPage endCursor }} edges {{ node {{ {RUN_FIELDS} }} }} }} }}"
    );
    let mut runs: Vec<Run> = Vec::new();
    let mut after: Option<String> = None;
    let mut total = 0;
    loop {
        let data =
            c.request(&query, json!({ "workflowId": q.workflow_id, "state": q.state, "first": q.first, "after": after })).await?;
        let conn = &data["runs"];
        total = conn["totalCount"].as_u64().unwrap_or(total);
        let edges = conn["edges"].as_array().ok_or_else(|| CliError::Parse("runs.edges".into()))?;
        for e in edges {
            runs.push(from_value(&e["node"], "run")?);
        }
        let page: PageInfo = from_value(&conn["pageInfo"], "pageInfo")?;
        if !q.all || !page.has_next_page {
            break;
        }
        after = page.end_cursor;
    }
    Ok((runs, total))
}

pub fn format_run_line(r: &Run) -> String {
    let name = r.workflow.as_ref().map(|w| w.name.as_str()).unwrap_or("?");
    let mut line = format!("{}  {:<10}  {}/{} steps  {}", r.id, r.state, r.completed_steps.len(), r.total_steps, name);
    if r.cancel_requested && !crate::follow::is_terminal(&r.state) {
        line.push_str("  (cancel requested)");
    }
    if let Some(e) = &r.error {
        line.push_str(&format!("  error: {e}"));
    }
    line
}

pub fn format_runs(runs: &[Run], total: u64) -> String {
    if runs.is_empty() {
        return "no runs\n".to_string();
    }
    let mut out: String = runs.iter().map(|r| format!("{}\n", format_run_line(r))).collect();
    out.push_str(&format!("{} of {} runs\n", runs.len(), total));
    out
}

/// A workflow is named by its id or by its exact name (case does not matter).
pub async fn resolve_workflow(c: &GraphQlClient, name_or_id: &str) -> Result<Workflow, CliError> {
    let all = list_workflows(c).await?;
    let wanted = name_or_id.to_lowercase();
    all.iter()
        .find(|w| w.id == name_or_id)
        .or_else(|| all.iter().find(|w| w.name.to_lowercase() == wanted))
        .cloned()
        .ok_or_else(|| CliError::NotFound(format!("no workflow with id or name \"{name_or_id}\"")))
}

pub async fn start_run(c: &GraphQlClient, workflow_id: &str, step_timeout_ms: Option<u32>) -> Result<Run, CliError> {
    let query = format!(
        "mutation($input: StartRunInput!) {{ startRun(input: $input) {{ __typename ... on Run {{ {RUN_FIELDS} }} ... on NotFoundError {{ message }} ... on ValidationError {{ message issues {{ path message }} }} ... on UnavailableError {{ message }} }} }}"
    );
    let data = c.request(&query, json!({ "input": { "workflowId": workflow_id, "stepTimeoutMs": step_timeout_ms } })).await?;
    let value = &data["startRun"];
    if let Some(msg) = typed_error(value) {
        return Err(CliError::Typed(msg));
    }
    from_value(value, "startRun")
}

pub async fn cancel_run(c: &GraphQlClient, run_id: &str) -> Result<Run, CliError> {
    let query = format!(
        "mutation($id: ID!) {{ cancelRun(runId: $id) {{ __typename ... on Run {{ {RUN_FIELDS} }} ... on NotFoundError {{ message }} ... on ConflictError {{ message state }} ... on ValidationError {{ message issues {{ path message }} }} ... on UnavailableError {{ message }} }} }}"
    );
    let data = c.request(&query, json!({ "id": run_id })).await?;
    let value = &data["cancelRun"];
    if let Some(msg) = typed_error(value) {
        return Err(CliError::Typed(msg));
    }
    from_value(value, "cancelRun")
}

pub async fn get_run(c: &GraphQlClient, run_id: &str) -> Result<Run, CliError> {
    let query = format!("query($id: ID!) {{ run(id: $id) {{ {RUN_FIELDS} }} }}");
    let data = c.request(&query, json!({ "id": run_id })).await?;
    let value = &data["run"];
    if value.is_null() {
        return Err(CliError::NotFound(format!("no run with id {run_id}")));
    }
    from_value(value, "run")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_is_not_a_typed_error() {
        assert_eq!(typed_error(&json!({ "__typename": "Run", "id": "r1" })), None);
        assert_eq!(typed_error(&json!({ "id": "r1" })), None);
        assert_eq!(typed_error(&Value::Null), None);
    }

    #[test]
    fn every_error_member_of_the_unions_is_recognised() {
        for kind in ["NotFoundError", "ConflictError", "ValidationError", "UnavailableError"] {
            let msg = typed_error(&json!({ "__typename": kind, "message": "boom" })).expect(kind);
            assert_eq!(msg, format!("{kind}: boom"));
        }
    }

    #[test]
    fn validation_issues_are_listed_with_their_path() {
        let v = json!({ "__typename": "ValidationError", "message": "bad", "issues": [{ "path": "input.stepTimeoutMs", "message": "must be at least 100" }] });
        assert_eq!(typed_error(&v).unwrap(), "ValidationError: bad\n  input.stepTimeoutMs: must be at least 100");
    }

    fn run(state: &str, done: usize, cancel: bool, error: Option<&str>) -> Run {
        Run {
            id: "r1".into(),
            state: state.into(),
            completed_steps: (0..done).map(|i| format!("s{i}")).collect(),
            total_steps: 3,
            error: error.map(String::from),
            cancel_requested: cancel,
            workflow: Some(crate::models::WorkflowRef { name: "Quick check".into() }),
        }
    }

    #[test]
    fn a_run_line_shows_state_progress_and_workflow() {
        assert_eq!(format_run_line(&run("RUNNING", 1, false, None)), "r1  RUNNING     1/3 steps  Quick check");
    }

    #[test]
    fn a_pending_cancel_and_an_error_are_shown() {
        assert!(format_run_line(&run("RUNNING", 1, true, None)).ends_with("(cancel requested)"));
        assert!(!format_run_line(&run("CANCELLED", 1, true, None)).contains("cancel requested"));
        assert!(format_run_line(&run("FAILED", 1, false, Some("step open failed"))).ends_with("error: step open failed"));
    }

    #[test]
    fn empty_lists_say_so() {
        assert_eq!(format_runs(&[], 0), "no runs\n");
        assert_eq!(format_workflows(&[]), "no workflows\n");
    }
}
