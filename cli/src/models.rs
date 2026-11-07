use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Step {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub steps: Vec<Step>,
    pub run_count: u32,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct WorkflowRef {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub state: String,
    pub completed_steps: Vec<String>,
    pub total_steps: u32,
    pub error: Option<String>,
    pub cancel_requested: bool,
    pub workflow: Option<WorkflowRef>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub has_next_page: bool,
    pub end_cursor: Option<String>,
}
