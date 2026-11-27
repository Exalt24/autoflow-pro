# CI and deploy details

The notes below sit under the table of deploy targets in the README. Each paragraph says what was built for a target and links the longer page and the captured output.

The archive target is one setting. It defaults to R2, so nothing existing changes. For S3 the same client code uses the AWS region and the SDK's own endpoint resolution, and `AWS_S3_ENDPOINT` points it at an emulator:

```bash
ARCHIVE_PROVIDER=s3
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET_NAME=autoflow-archive-123456789012
```

`deploy/aws/` creates the bucket (public access blocked, versioned, AES256 encrypted, archives expire after 90 days) and an IAM user whose policy covers the `executions/` prefix only; its README has the commands for a real account and for moto. In the moto run that user could write, read, list and delete under `executions/`, and put, get and delete-version elsewhere in the bucket were refused with 403. In the AWS account run the same user wrote, read and listed under `executions/` and was refused for another prefix, for the bucket settings and for a list with no prefix. The Terraform checks read the plan JSON for each rule, and [the mutation log](test-runs/2026-10-31-aws-s3-mutation-check.txt) shows each rule broken in a scratch copy and the matching test going red.

`npm run test:pipelines` keeps the three pipelines in step. It reads the GitHub, GitLab and Azure files and checks that each job runs the same commands in the same folders with the same environment and Node 22, then validates the Azure file against the schema. It also runs as the `pipelines` job in all three CI files.

The EKS Terraform builds a VPC, a cluster, a managed node group and an IAM role the worker pods assume through the cluster's OIDC provider (IRSA); the Helm chart deploys the API and the worker with probes, limits, an HPA, a secret reference and an optional Traefik Ingress (run on the kind cluster, [output](test-runs/2026-11-07-traefik-ingress-kind.txt)). Details and exactly what was run are in [docs/kubernetes-eks.md](kubernetes-eks.md).

An Athena client written from the AWS API reference starts a query, polls it with backoff, reads the results page by page and resubmits a failure Athena marks retryable; run events go to S3 as JSON lines under `dt=` folders, and the Terraform builds the buckets, a Glue table with partition projection and a workgroup. See [docs/athena.md](athena.md).

The telemetry pipeline takes batches of readings from an asset (power, voltage, temperature), quarantines the ones that break a rule, stores each reading once by asset and timestamp, merges late data inside a per asset watermark, rolls up 5 minute and hourly buckets with energy in kWh, reports gaps without filling them, and writes JSON lines to a partitioned lake layout that new Glue tables project. A RabbitMQ worker acks only after the files are written. See [docs/telemetry.md](telemetry.md).

A Temporal workflow orchestrates one run (retries, a step deadline, a cancel signal, a status query, always archived), a TypeScript GraphQL API starts and cancels runs through it, and a small Rust CLI follows a run with a back-off, all against a local Temporal dev server only. See [docs/temporal-graphql-rust.md](temporal-graphql-rust.md) and [cli/README.md](../cli/README.md).

The RabbitMQ worker reads run requests from a durable queue, retries failures through delay queues and a dead-letter exchange, skips duplicates and stops gracefully on SIGTERM, then adds the run to the BullMQ queue. See [docs/rabbitmq.md](rabbitmq.md).

The Cloud Run image runs the API on the `PORT` Cloud Run provides. The Playwright worker reaches its browser through `BROWSER_WS_URL`, the remote browser setting the engine already supports. Secrets (Supabase, Redis) are read from Secret Manager references in `service.yaml`, and the Netlify site takes the two `NEXT_PUBLIC_SUPABASE_*` values from its settings.

The order pipeline in `serverless/` takes orders from an SQS queue with a dead-letter queue and a redrive policy, creates each one once in a single DynamoDB table (conditional writes, a version for optimistic locking, stock that cannot go negative), runs a Step Functions saga with retry, catch and compensating steps, builds a CQRS read model from the table's stream, publishes outcomes to SNS and EventBridge, and has a Bedrock Converse client with model access checks and a strangler fig router for moving read routes off a legacy handler. Everything ran against moto inside pytest and against stand-ins for the payment provider, the carrier and Bedrock, written from the AWS documentation. The saga's compensation rule is checked by a seeded property test over 300 random failure patterns and a validator on the definition, and `mutate.py` breaks 50 rules one at a time. See [serverless/README.md](../serverless/README.md) and [the run](test-runs/2026-11-17-serverless-order-pipeline.txt).

## Supabase Edge Function

`supabase/functions/execution-summary/` is a Deno function that answers `GET /functions/v1/execution-summary?days=N` (N from 1 to 90, default 7) with one signed-in user's execution counts per workflow: total, completed, failed, in flight, a success rate over finished runs and a mean duration in milliseconds. `summarize.ts` holds the pure logic and `index.ts` the handler.

The isolation is the row level security policy on `executions` (`auth.uid() = user_id`). The handler builds its Supabase client from the anon key and the caller's own `Authorization` header and never touches the service role key, so a query runs as the caller. A missing token, a junk token and the anon key used as a token (a valid JWT that is not a user) all answer 401, and a `days` outside the range answers 400 instead of being clamped. The read goes in pages of 1000 rows up to 20000 and the body says `truncated: true` if it stopped there.

`npm run test:edge` (in `backend/`) has three parts. Part A runs the summary logic on fixed cases and 300 seeded random worlds against a plain loop that shares no code with it. Part B needs the local stack from `docs/LOCAL_SETUP.md`: it creates two users through Supabase Auth, gives each workflows and executions (one older than the window), and calls the function with each user's token. Part C rewrites the function to use the service role key for a moment and requires the leak check to see one user's workflows in the other's answer, then restores the file byte for byte and checks the answer is clean again.

The edge runtime runs with `"policy": "oneshot"` in `supabase/config.jsonc`: the default `per_worker` policy did not pick up an edited file on a Windows bind mount during these runs, and a new function folder is not served until the stack restarts, so Part C edits the real file in place. The `edge-function` job in `ci.yml` starts the same stack on a Linux runner, applies the migration and runs the same tests. The captured run is `docs/test-runs/2026-11-27-supabase-edge-function.txt`. Not covered: a hosted Supabase project (`supabase functions deploy` was not run) and the Supabase Realtime, Studio and mail services, which the config switches off.
