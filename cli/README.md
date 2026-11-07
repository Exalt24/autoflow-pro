# autoflow-cli

A small Rust command line client for the AutoFlow Pro GraphQL API (`backend/src/graphql`). It lists workflows and runs, starts a run, follows it until it ends and cancels it. Built with clap (derive), reqwest, serde and tokio.

```
cargo run -- workflows
cargo run -- runs [--workflow ID] [--state STATE] [--first N] [--all]
cargo run -- start <workflow id or name> [--step-timeout-ms N] [--follow]
cargo run -- follow <run id> [--interval-ms 250] [--max-interval-ms 3000] [--timeout-secs 300]
cargo run -- cancel <run id>
```

`--url` (or `AUTOFLOW_URL`) sets the endpoint, default `http://127.0.0.1:4000/graphql`. `follow` waits longer between looks while nothing changes (the wait doubles up to `--max-interval-ms`) and starts over when the run moves. The exit code of `start --follow` and `follow` says how the run ended: 0 completed, 1 failed, 2 cancelled, 3 timed out. Any error talking to the API exits 10.

## Checks

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`cargo test` runs 14 unit tests and 17 tests that drive the client and the compiled binary against a local mock GraphQL server (wiremock). Output: [docs/test-runs/2026-11-07-rust-cli.txt](../docs/test-runs/2026-11-07-rust-cli.txt). Each guard in the follow loop, the back-off, the error handling and the exit codes was broken on purpose and `cargo test` went red, see [the mutation log](../docs/test-runs/2026-11-07-services-mutation-check.txt).

## A real run

Against the local GraphQL server (`npm run start:graphql` in `backend/`, with a local `temporal server start-dev` behind it and a dry-run step executor, so no browser opens). The ids change each run, and the `next look in` lines go to stderr. The whole session is in [docs/test-runs/2026-11-07-rust-cli-against-graphql.txt](../docs/test-runs/2026-11-07-rust-cli-against-graphql.txt).

A step that fails twice is retried by Temporal and the run still completes:

```
$ autoflow-cli start "Flaky page" --follow --interval-ms 250 --max-interval-ms 2000
started f04b2596-a52c-49b5-bcef-cef833f82499  QUEUED      0/2 steps  Flaky page
f04b2596-a52c-49b5-bcef-cef833f82499  QUEUED      0/2 steps  Flaky page
  next look in 250 ms
f04b2596-a52c-49b5-bcef-cef833f82499  RUNNING     1/2 steps  Flaky page
  next look in 250 ms
  next look in 500 ms
  next look in 1000 ms
  next look in 2000 ms
f04b2596-a52c-49b5-bcef-cef833f82499  COMPLETED   2/2 steps  Flaky page
[exit 0]
```

A step that always fails uses up its retries and the run fails (exit code 1):

```
$ autoflow-cli start "Broken page" --follow
started 32059217-e926-4c5f-a0bf-b19e81c7cc22  QUEUED      0/2 steps  Broken page
32059217-e926-4c5f-a0bf-b19e81c7cc22  QUEUED      0/2 steps  Broken page
  next look in 250 ms
32059217-e926-4c5f-a0bf-b19e81c7cc22  RUNNING     1/2 steps  Broken page
  next look in 250 ms
  next look in 500 ms
  next look in 1000 ms
  next look in 2000 ms
  next look in 3000 ms
  next look in 3000 ms
32059217-e926-4c5f-a0bf-b19e81c7cc22  FAILED      1/2 steps  Broken page  error: step broken-click failed: step broken-click was told to always fail
[exit 1]
```

Cancelling a 20 second job (exit code 2 when followed to the end):

```
$ autoflow-cli start "Slow job"
started 86ef00ff-9601-44ee-a35c-5657948c2839  QUEUED      0/3 steps  Slow job

$ autoflow-cli cancel 86ef00ff-9601-44ee-a35c-5657948c2839
cancel requested: 86ef00ff-9601-44ee-a35c-5657948c2839  RUNNING     1/3 steps  Slow job  (cancel requested)
[exit 0]

$ autoflow-cli follow 86ef00ff-9601-44ee-a35c-5657948c2839
86ef00ff-9601-44ee-a35c-5657948c2839  RUNNING     1/3 steps  Slow job  (cancel requested)
  next look in 250 ms
86ef00ff-9601-44ee-a35c-5657948c2839  CANCELLED   1/3 steps  Slow job
[exit 2]

```

A step timeout of 1500 ms on the same job (exit code 3):

```
$ autoflow-cli start "Slow job" --step-timeout-ms 1500 --follow
started 82cb3ab4-8bca-4041-b365-30db3bfb411c  QUEUED      0/3 steps  Slow job
82cb3ab4-8bca-4041-b365-30db3bfb411c  QUEUED      0/3 steps  Slow job
  next look in 250 ms
82cb3ab4-8bca-4041-b365-30db3bfb411c  RUNNING     1/3 steps  Slow job
  next look in 250 ms
  next look in 500 ms
  next look in 1000 ms
82cb3ab4-8bca-4041-b365-30db3bfb411c  TIMED_OUT   1/3 steps  Slow job  error: step slow-wait did not finish within 1500 ms
[exit 3]
```

The workflow list and a typed error from the API (the run had already ended):

```
$ autoflow-cli workflows
ID                                      NAME                  STEPS  RUNS
18ad2dd7-8c55-4407-9bcd-8dc1cf3628f3    Quick check               3     1
774cfca0-de6a-428a-b9da-62571a131783    Flaky page                2     1
6a5f1123-a75f-40c7-ad8d-a0068da45ff0    Slow job                  3     2
350a52ec-d730-4a20-b319-1b3ad1000c4f    Broken page               2     1
[exit 0]

$ autoflow-cli cancel 86ef00ff-9601-44ee-a35c-5657948c2839
cancel requested: 86ef00ff-9601-44ee-a35c-5657948c2839  RUNNING     1/3 steps  Slow job  (cancel requested)
[exit 0]
```
