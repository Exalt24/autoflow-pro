//! autoflow-cli: a small command line client for the AutoFlow Pro GraphQL API.
//! It lists workflows and runs, starts a run, follows it until it ends and cancels it.

pub mod cli;
pub mod client;
pub mod commands;
pub mod follow;
pub mod models;
