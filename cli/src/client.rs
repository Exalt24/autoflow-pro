use std::fmt;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

/// Everything that can go wrong, kept apart so the exit message says which kind it was.
#[derive(Debug)]
pub enum CliError {
    /// The server could not be reached at all.
    Transport(String),
    /// The server answered with a failing HTTP status and no GraphQL errors.
    Http(u16, String),
    /// GraphQL itself refused the request (bad query, depth limit, bad argument).
    GraphQl(Vec<String>),
    /// A mutation came back with one of the API's typed errors (NotFoundError, ConflictError, ...).
    Typed(String),
    /// The answer was not the shape this client expects.
    Parse(String),
    /// Nothing with that id or name.
    NotFound(String),
    /// `follow` ran out of time before the run ended.
    Timeout(String),
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::Transport(m) => write!(f, "cannot reach the server: {m}"),
            CliError::Http(code, body) => write!(f, "HTTP {code}: {body}"),
            CliError::GraphQl(msgs) => write!(f, "GraphQL error: {}", msgs.join("; ")),
            CliError::Typed(m) => write!(f, "{m}"),
            CliError::Parse(m) => write!(f, "unexpected answer: {m}"),
            CliError::NotFound(m) => write!(f, "{m}"),
            CliError::Timeout(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for CliError {}

#[derive(Debug, Deserialize)]
pub struct GraphQlError {
    pub message: String,
    pub extensions: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct GraphQlBody {
    data: Option<Value>,
    errors: Option<Vec<GraphQlError>>,
}

fn describe(e: &GraphQlError) -> String {
    match e.extensions.as_ref().and_then(|x| x.get("code")).and_then(Value::as_str) {
        Some(code) => format!("{} ({code})", e.message),
        None => e.message.clone(),
    }
}

pub struct GraphQlClient {
    http: reqwest::Client,
    url: String,
}

impl GraphQlClient {
    pub fn new(url: &str) -> Result<Self, CliError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| CliError::Transport(e.to_string()))?;
        Ok(Self { http, url: url.to_string() })
    }

    /// Sends one query or mutation and returns its `data` object.
    pub async fn request(&self, query: &str, variables: Value) -> Result<Value, CliError> {
        let response = self
            .http
            .post(&self.url)
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(|e| CliError::Transport(e.to_string()))?;
        let status = response.status();
        let text = response.text().await.map_err(|e| CliError::Transport(e.to_string()))?;
        let body: Result<GraphQlBody, _> = serde_json::from_str(&text);

        if !status.is_success() {
            // Yoga answers a refused query with a 4xx and a JSON body that says why.
            if let Ok(GraphQlBody { errors: Some(errors), .. }) = &body {
                return Err(CliError::GraphQl(errors.iter().map(describe).collect()));
            }
            let snippet: String = text.chars().take(200).collect();
            return Err(CliError::Http(status.as_u16(), snippet));
        }

        let body = body.map_err(|e| CliError::Parse(e.to_string()))?;
        if let Some(errors) = body.errors {
            return Err(CliError::GraphQl(errors.iter().map(describe).collect()));
        }
        body.data.ok_or_else(|| CliError::Parse("the answer has no data".to_string()))
    }
}
