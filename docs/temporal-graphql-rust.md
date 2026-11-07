# Temporal, GraphQL, a Rust CLI and a Nixpacks build

AutoFlow Pro already runs a workflow through a BullMQ queue. This adds four more pieces around the same idea of a run: a Temporal workflow that orchestrates one run, a GraphQL API over the run model, a small Rust command line client for that API, and a Nixpacks build of the backend image. Everything here was run on one machine (Windows 11, Docker Desktop) and every command below was run for real. The printed output of each run is in [docs/test-runs](test-runs).

What this is not: Temporal ran against a local dev server and the SDK's test server only, never Temporal Cloud and never a cluster. The GraphQL API is a new TypeScript server tested in process, and its runs live in memory. The CLI is small. The Nixpacks image was built and started locally, not on Railway. Nothing here is in use by anyone.

## Temporal: one run as a workflow

Code: `backend/src/temporal/`. The SDK is `@temporalio/*` 1.25.0.

```
runWorkflow(input)
  validate  ->  start  ->  step 1 .. step N  ->  archive
                            each step: retries, a deadline, a cancel signal
```

- **Activities.** `validateRun`, `startRun`, `executeStep` and `archiveRun`. The workflow does no I/O; everything that touches the world is an activity, so the workflow can be replayed.
- **Retries.** Every activity has a retry policy: 4 tries, 1 s first wait, doubling up to 30 s. A `ValidationError` is listed as non retryable, so bad input fails at once instead of being tried four times.
- **Step deadline.** `stepTimeoutMs` (default 60 s) is a budget for one step including its retries. A workflow timer races the step; when the timer wins, the step is cancelled and the run ends as `timed_out`.
- **Cancel signal.** `cancelRun` ends the run as `cancelled`, even while a step is running. The running activity is told to stop through its heartbeat.
- **Always archived.** Whatever the outcome (completed, failed, cancelled, timed out) the run is written down. An archive that fails is recorded in the result and does not change how the run ended.
- **Status query.** `getStatus` returns the state, the step number and the finished steps while the workflow runs.
- **Client.** `TemporalRunLauncher` starts a run with the workflow id `run-<id>` and refuses a second start of the same id. It also sends the signal and runs the query.
- **Worker.** `npm run build && npm run start:temporal` starts a worker. The step executor it starts with is a dry run: it does not open a browser. A step whose id starts with `flaky`, `slow` or `broken` fails twice, waits 20 s or always fails, so retries, cancel and timeouts can be seen. Wiring the real Playwright engine in as an executor is the next step.

How it was tested:

- `npm run test:temporal`: 31 checks on the SDK's time-skipping test server (`TestWorkflowEnvironment`). Retry then success, retries used up, validation, cancel in the middle of a run, a step timeout, the status query, an archive that fails, the real activities, and the input rules over 1500 seeded random inputs. One measured surprise: the test server did not skip the retry back-offs or a step timer while an activity was running, so those cases use short real waits and the file takes about 20 s.
- `npm run test:temporal-e2e`: 12 checks against a real `temporal server start-dev` process (Temporal CLI 1.10.0, server 1.32.2) with a real worker and the real client. The 1 s and 2 s back-offs really elapse, a step that always fails is tried exactly 4 times, a 2 minute step is cut short by the signal in under 200 ms, and the server refuses a second start of the same run id.
- Mutants: the retry policy deleted, the retry count set to 1, the cancel handler emptied and the timeout taken out of the race were each put into a scratch copy, and the tests turned red every time, see [the mutation log](test-runs/2026-11-07-services-mutation-check.txt).

## GraphQL: the run model as an API

Code: `backend/src/graphql/`. Start it with `npm run build && npm run start:graphql` (needs a Temporal server, `temporal server start-dev` is enough). It serves `/graphql` and `/health`.

- **Server.** graphql-yoga on Fastify. Yoga is built on web standard Request and Response, has a ready Fastify handler and plain plugin hooks (used for the depth limit), and is one small package.
- **Schema.** `Workflow`, `Run`, `RunState`, a `runs` connection with cursor pagination (`first`, `after`, `pageInfo`, `totalCount`, newest first), and three mutations: `createWorkflow`, `startRun` (creates the run and starts its Temporal workflow) and `cancelRun` (sends the cancel signal). The schema is committed as `src/graphql/schema.graphql` and a test fails when it and the code disagree.
- **Generated types.** `npm run graphql:codegen` makes `src/graphql/generated/types.ts` from the schema, and the resolvers are typed with it. CI regenerates both files and fails on any difference.
- **Input rules with zod.** A name of 1 to 100 characters, 1 to 200 steps with unique ids and one of the 23 step types, a step timeout from 100 to 3,600,000 ms, a page size from 1 to 100. A compile time check fails if a step type is added to the app and not to the list.
- **Typed errors.** A mutation does not throw for something the caller did wrong. It returns a member of a union: `ValidationError` (with the field path of every problem), `NotFoundError`, `ConflictError` (cancelling a run that already ended) or `UnavailableError` (Temporal cannot be reached, and the run is marked `FAILED` rather than left `QUEUED`). A bad argument to a query is a GraphQL error with `extensions.code = BAD_USER_INPUT`. An unexpected error reaches the client as `Unexpected error.` with no stack.
- **DataLoader.** Asking 40 runs for their workflow makes one store call, not 40. The tests count the store calls to prove it. Loaders are created per request.
- **Depth limit.** A query nested deeper than 6 levels is refused before any resolver runs, with `extensions.code = DEPTH_LIMIT_EXCEEDED`. Fragments are followed.
- **Not done.** There is no authentication (every request is one user) and the runs are kept in memory. The existing REST API's Supabase auth and tables are not wired in.

How it was tested:

- `npm run test:graphql`: 42 checks with the real server over real HTTP in one process and a recording stand in for the Temporal launcher: the schema snapshot, validation, typed errors, pagination (also 150 seeded random worlds with random page sizes), the store call counter, the depth limit and masked errors.
- `npm run test:graphql-temporal`: 9 checks with the API, the Temporal client, a real worker and a real dev server all running, so `startRun` starts a real workflow and the run ends `COMPLETED`, `FAILED`, `CANCELLED` or `TIMED_OUT` in the store the API reads.
- Mutants: the depth limit removed, the loaders unbatched, the validation rules loosened and 26 more, each turned the tests red.

## Rust: autoflow-cli

Code: `cli/` (a crate with clap, reqwest, serde and tokio). It talks to the GraphQL API at `--url` or `AUTOFLOW_URL` (default `http://127.0.0.1:4000/graphql`).

```
autoflow-cli workflows
autoflow-cli runs [--workflow ID] [--state STATE] [--first N] [--all]
autoflow-cli start <workflow id or name> [--step-timeout-ms N] [--follow]
autoflow-cli follow <run id>
autoflow-cli cancel <run id>
```

`follow` looks at the run again and again with a back-off: the wait doubles while nothing changes (250 ms, 500 ms, 1 s, 2 s, up to 3 s) and starts over when the run moves to a new state or finishes another step. It gives up after `--timeout-secs`. The exit code says how the run ended: 0 completed, 1 failed, 2 cancelled, 3 timed out, 10 for an error talking to the API.

How it was tested:

- `cargo test`: 14 unit tests and 17 tests that run the client and the compiled binary against a local mock GraphQL server (wiremock). `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` are clean.
- A real run of the binary against the local GraphQL server and the local Temporal dev server is in [the output file](test-runs/2026-11-07-rust-cli-against-graphql.txt) and in [cli/README.md](../cli/README.md).
- Mutants: a follow loop that stops after one look, a back-off that never grows or never stops growing, a swallowed GraphQL error, a swallowed HTTP error, a typed error shown as success and a wrong exit code each turned `cargo test` red.

## Nixpacks: the backend image

`backend/nixpacks.toml` pins Node 22. `scripts/nixpacks-build.sh` runs the real Nixpacks 1.41.0 binary inside a container that shares the host's Docker, builds `backend/` and leaves the image `autoflow-backend-nixpacks` in the local Docker. `scripts/nixpacks-check.sh` starts that image next to a Redis container and asks `/health`.

- The first build had no `nixpacks.toml`. Nixpacks chose Node 18, the build succeeded, and the container then crashed at start because the Supabase client needs the WebSocket that Node 22 has. Both runs are in [the output file](test-runs/2026-11-07-nixpacks-build.txt).
- With Node 22 pinned the image started and `GET /health` answered 200. It is 1.59 GB because the build keeps the dev dependencies, and it runs as root, where the existing `backend/Dockerfile` image is 483 MB and runs as the `node` user. Trimming that is next.
- It ran on this machine only: not on Railway, nothing deployed.

## Run it all

```bash
temporal server start-dev                          # a local Temporal server (Temporal CLI)
cd backend && npm ci && npm run build
npm run start:graphql                               # GraphQL on :4000 with a worker in the same process
cd ../cli && cargo run -- start "Flaky page" --follow
```
