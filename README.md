# AutoFlow Pro

Browser automation platform: drag steps onto a canvas, a Playwright worker runs them, and logs stream live.

![AutoFlow Pro running on a local stack: sign in, build a workflow by dragging steps onto the canvas, run it, watch the logs stream, read the extracted data](docs/demo.gif)

*Recorded against a local stack (Supabase CLI, Redis in Docker, a test page served from the same machine). It plays at 2x except for the live run.*

[![CI](https://github.com/Exalt24/autoflow-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/Exalt24/autoflow-pro/actions/workflows/ci.yml) **Proof:** 23 step types, 46 backend test scripts, and CI that builds both the backend and the frontend on every push, runs the AWS S3 archive target against a local AWS emulator, runs the RabbitMQ consumer and the telemetry worker against a real broker, checks the Terraform and Helm files and the Athena client against a stand-in API, and runs the Temporal workflow, the GraphQL API, the Rust CLI and a Nixpacks build.

It runs locally with Docker and Node, and the recording above is one such run.

## What it is and why

You build a workflow out of steps (navigate, click, fill, extract, loops, conditionals), and a BullMQ queue hands it to a Playwright worker. A WebSocket pushes logs and progress to the dashboard as it runs. Jobs can run on a cron schedule and pause themselves after consecutive failures. Every row is scoped to its owner with Supabase Row Level Security. I built it to wire a visual editor, a job queue and a browser worker into one product end to end.

## What it does

- Visual builder with React Flow and 23 step types: navigate, click, fill, extract, wait, screenshot, scroll, hover, key press, run JavaScript, conditional, loop, variables, file download, drag and drop, cookies, localStorage, dropdown, right and double click.
- Cron scheduling with presets and failure monitoring.
- Live monitoring over Socket.IO with automatic reconnection.
- Analytics: execution trends, success rates, error analysis.
- Optional archival of old executions to Cloudflare R2 (the default) or AWS S3, chosen with `ARCHIVE_PROVIDER`; it stays off until the matching settings are present.

## Architecture

```mermaid
flowchart TD
    UI["Next.js dashboard<br/>React Flow builder"] -- "REST" --> API["Fastify API"]
    API --> DB[("Supabase<br/>Postgres, Auth, RLS")]
    API -- "enqueue" --> Q[("Redis<br/>BullMQ")]
    Q --> W["Playwright worker"]
    W -- "logs, progress" --> API
    API -- "Socket.IO" --> UI
    API -. "archive" .-> R2[("Cloudflare R2<br/>or AWS S3")]
```

## Run it

```bash
docker compose up -d redis
# a local Supabase stack, then the migration backend/migrations/001_initial_schema.sql (see docs/LOCAL_SETUP.md)
cd backend && npm install && npx playwright-core install chromium && cp .env.example .env && npm run dev
cd ../frontend && npm install && cp .env.example .env.local && npm run dev
```

Open http://localhost:3000 and sign up (a local Supabase has email confirmation off). The Supabase steps, env values and a sample workflow are in [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). More: [API](docs/API.md), [user guide](docs/USER_GUIDE.md), [deployment](docs/DEPLOYMENT.md), [troubleshooting](docs/TROUBLESHOOTING.md).

## Tests

CI runs `npm ci` and `npm run build` for the backend and the frontend, plus `npm run test:pipelines`. A fourth job, `aws-emulator`, starts moto, applies the Terraform in `deploy/aws` to it, runs the archive tests and destroys it again. The 46 scripts in `backend/tests/` run with `tsx` (for example `npm run test:queue`, `npm run test:api`), print their results, and most run against a local Supabase and Redis. The frontend is checked with `npm run lint` and `npx tsc --noEmit`.

## CI and deploy targets

Each target below ships as a config file and was run against the thing named beside it. The captured output of every run is in [docs/test-runs](docs/test-runs).

| Target | Files | Run against | Result |
| --- | --- | --- | --- |
| GitHub Actions | `.github/workflows/ci.yml` | GitHub Actions on every push | backend, frontend, pipelines and aws-emulator jobs |
| GitLab CI | `.gitlab-ci.yml` | `gitlab-ci-local` 4.77.0 with the Docker executor and the `node:22` image | all three jobs passed in 37 s, [output](docs/test-runs/2026-10-30-gitlab-ci-local.txt) |
| Azure Pipelines | `azure-pipelines.yml` | the official Azure Pipelines JSON schema (v1.261.1, kept in `scripts/schemas`) checked with ajv | schema check passed, [output](docs/test-runs/2026-10-30-pipeline-parity-and-azure-schema.txt) |
| Netlify | `netlify.toml` | `npx netlify-cli build --offline` (netlify-cli 27.16.1) on this machine | the Next.js build and the server handler packaging completed, [output](docs/test-runs/2026-10-30-netlify-build.txt) |
| Google Cloud Run | `backend/Dockerfile`, `deploy/cloudrun/service.yaml` | `docker build` and `docker run` of the image as a local container next to a Redis container | `GET /health` answered 200 on port 8080, image 483 MB, runs as the `node` user, [output](docs/test-runs/2026-10-30-cloud-run-container.txt) |
| AWS S3 | `deploy/aws/` (Terraform), `backend/src/config/archiveTarget.ts` | `terraform apply` and `terraform destroy` against a local AWS emulator (moto 5.2.5, AWS provider 6.71.0), then the backend archive code and `ArchivalService` signed in as the IAM user Terraform created, with moto's IAM checks on | 34 emulator checks, 30 provider switch checks and 19 Terraform plan checks passed, 20 of 20 deliberately broken rules were caught, the bucket answered 404 after destroy, [output](docs/test-runs/2026-10-31-aws-s3-moto-terraform.txt) |
| AWS S3 (AWS account) | `deploy/aws/` (Terraform) | `terraform apply` and `terraform destroy` against an AWS account in ap-southeast-2 (AWS provider 6.71.0), then signed requests as the IAM user Terraform created | 9 resources created, the bucket's settings read back from AWS, the user wrote and read under `executions/` and got 403 for another prefix, the bucket settings and an unprefixed list, then 9 destroyed and the bucket answered 404, [output](docs/test-runs/2026-10-31-aws-s3-real-account.txt) |
| AWS EKS | `deploy/eks/` (Terraform) | `terraform validate`, an offline `terraform plan` with dummy credentials (AWS provider 6.72.0), then applied for real on my own AWS account and destroyed | the VPC, an EKS cluster and a two node managed node group came up and ran (nodes Ready, coredns, kube-proxy and the CNI running), 26 resources destroyed and read back gone; the run found a free tier instance type limit and a slow node group deletion, both fixed in the module; the IAM OIDC provider and IRSA role were blocked by an organization policy on that account; 29 resources planned, 89 deploy file checks passed, 13 of 13 deliberate breaks caught, [plan output](docs/test-runs/2026-11-07-eks-terraform-and-helm.txt), [apply output](docs/test-runs/2026-11-07-eks-apply.txt) |
| Kubernetes (Helm) | `deploy/helm/autoflow-pro/` | `helm lint --strict`, `helm template`, `kubeconform` against Kubernetes 1.34, then a Helm install on a local kind cluster (Kubernetes 1.37) with the real backend image | 9 of 9 objects valid, API and worker pods Ready, [kind run](docs/test-runs/2026-11-07-kind-cluster.txt) |
| RabbitMQ | `backend/src/messaging/` | a real RabbitMQ 3.13.7 and Redis 7 in Docker | 41 logic checks and 38 broker checks passed, 4 of 4 deliberate breaks caught, [output](docs/test-runs/2026-11-07-rabbitmq-consumer.txt) |
| Athena | `backend/src/athena/`, `deploy/athena/` (Terraform) | the real AWS SDK against a stand-in Athena API written from the API reference, then `terraform validate` and an offline `terraform plan` with dummy credentials, never applied | 37 checks against the stand-in, 45 logic and property checks over 3000 seeded worlds, 12 resources planned, 33 plan rules, 52 of 52 deliberate breaks caught, [output](docs/test-runs/2026-11-07-athena-client.txt) |
| Telemetry | `backend/src/telemetry/`, `deploy/athena/telemetry.tf` (Terraform) | generated solar telemetry on a local filesystem and a real RabbitMQ 3.13.7 broker in Docker; the Athena Terraform validated and planned offline with dummy credentials | 160 logic and property checks over 400 seeded worlds, 21 end to end checks, 48 Terraform plan checks, 22 broker checks passed, 18 resources planned, 101 of 101 deliberate breaks caught, 1,023,000 readings through ingest and rollup in 1.25 s (821,245 per second), [output](docs/test-runs/2026-11-07-telemetry-tests.txt), [load run](docs/test-runs/2026-11-07-telemetry-load.txt) |
| Temporal | `backend/src/temporal/` | the SDK's time-skipping test server, then a real local `temporal server start-dev` with a real worker; not Temporal Cloud, no cluster; the step executor is a dry run | `npm run test:temporal` 31 checks, `npm run test:temporal-e2e` 12 checks, 19 of 19 deliberate breaks caught on the test server and 6 of 6 on the dev server, [output](docs/test-runs/2026-11-07-temporal-tests.txt), [breaks](docs/test-runs/2026-11-07-services-mutation-check.txt) |
| GraphQL | `backend/src/graphql/` | the real Yoga on Fastify server over HTTP with an in-memory run store, and driving a real worker on the Temporal dev server; no authentication | `npm run test:graphql` 42 checks, `npm run test:graphql-temporal` 9 checks, 29 of 29 deliberate breaks caught, [output](docs/test-runs/2026-11-07-graphql-tests.txt) |
| Rust CLI | `cli/` | `cargo test` against a mock GraphQL server, then the binary against the local GraphQL and Temporal servers | fmt and `clippy -D warnings` clean, 14 unit and 17 mock server tests passed, 9 of 9 deliberate breaks caught, [tests](docs/test-runs/2026-11-07-rust-cli.txt), [real run](docs/test-runs/2026-11-07-rust-cli-against-graphql.txt) |
| Nixpacks | `backend/nixpacks.toml`, `scripts/nixpacks-*.sh` | `nixpacks build` 1.41.0 on this machine, not Railway | with no config it chose Node 18 and the container crashed at start; with Node 22 pinned `GET /health` answered 200, [output](docs/test-runs/2026-11-07-nixpacks-build.txt) |

The archive target is one setting. It defaults to R2, so nothing existing changes. For S3 the same client code uses the AWS region and the SDK's own endpoint resolution, and `AWS_S3_ENDPOINT` points it at an emulator:

```bash
ARCHIVE_PROVIDER=s3
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET_NAME=autoflow-archive-123456789012
```

`deploy/aws/` creates the bucket (public access blocked, versioned, AES256 encrypted, archives expire after 90 days) and an IAM user whose policy covers the `executions/` prefix only; its README has the commands for a real account and for moto. In the moto run that user could write, read, list and delete under `executions/`, and put, get and delete-version elsewhere in the bucket were refused with 403. In the AWS account run the same user wrote, read and listed under `executions/` and was refused for another prefix, for the bucket settings and for a list with no prefix. The Terraform checks read the plan JSON for each rule, and [the mutation log](docs/test-runs/2026-10-31-aws-s3-mutation-check.txt) shows each rule broken in a scratch copy and the matching test going red.

`npm run test:pipelines` keeps the three pipelines in step. It reads the GitHub, GitLab and Azure files and checks that each job runs the same commands in the same folders with the same environment and Node 22, then validates the Azure file against the schema. It also runs as the `pipelines` job in all three CI files.

The EKS Terraform builds a VPC, a cluster, a managed node group and an IAM role the worker pods assume through the cluster's OIDC provider (IRSA); the Helm chart deploys the API and the worker with probes, limits, an HPA, a secret reference and an optional Traefik Ingress (run on the kind cluster, [output](docs/test-runs/2026-11-07-traefik-ingress-kind.txt)). Details and exactly what was run are in [docs/kubernetes-eks.md](docs/kubernetes-eks.md).

An Athena client written from the AWS API reference starts a query, polls it with backoff, reads the results page by page and resubmits a failure Athena marks retryable; run events go to S3 as JSON lines under `dt=` folders, and the Terraform builds the buckets, a Glue table with partition projection and a workgroup. See [docs/athena.md](docs/athena.md).

The telemetry pipeline takes batches of readings from an asset (power, voltage, temperature), quarantines the ones that break a rule, stores each reading once by asset and timestamp, merges late data inside a per asset watermark, rolls up 5 minute and hourly buckets with energy in kWh, reports gaps without filling them, and writes JSON lines to a partitioned lake layout that new Glue tables project. A RabbitMQ worker acks only after the files are written. See [docs/telemetry.md](docs/telemetry.md).

A Temporal workflow orchestrates one run (retries, a step deadline, a cancel signal, a status query, always archived), a TypeScript GraphQL API starts and cancels runs through it, and a small Rust CLI follows a run with a back-off, all against a local Temporal dev server only. See [docs/temporal-graphql-rust.md](docs/temporal-graphql-rust.md) and [cli/README.md](cli/README.md).

The RabbitMQ worker reads run requests from a durable queue, retries failures through delay queues and a dead-letter exchange, skips duplicates and stops gracefully on SIGTERM, then adds the run to the BullMQ queue. See [docs/rabbitmq.md](docs/rabbitmq.md).

The Cloud Run image runs the API on the `PORT` Cloud Run provides. The Playwright worker reaches its browser through `BROWSER_WS_URL`, the remote browser setting the engine already supports. Secrets (Supabase, Redis) are read from Secret Manager references in `service.yaml`, and the Netlify site takes the two `NEXT_PUBLIC_SUPABASE_*` values from its settings.

## Next steps

- The API rate limit is 100 requests per 15 minutes per client, counted in the backend process; a shared store for the counter is next, and restarting the backend clears it meanwhile.
- The usage view shows per-user quota rows (10 workflows, 50 executions a month by default); enforcing them in the backend is next.
- The data model is per-user rows with RLS; organizations and workspaces are next.
- The tests are scripts today; moving them into a test framework that CI runs is next.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, React Flow, Recharts, Fastify 5, Playwright, BullMQ, Socket.IO, Supabase, Redis, Cloudflare R2, AWS S3, RabbitMQ, Terraform, Kubernetes (EKS), Helm, Traefik, Amazon Athena and Glue, Temporal, GraphQL (Yoga, zod, DataLoader), Rust (clap, reqwest, tokio), Nixpacks. When hosted it ran on free tiers (Vercel, Render, Supabase, Upstash).

## License

MIT, see [LICENSE](LICENSE). By Daniel Alexis Cruz, [dacruz.vercel.app](https://dacruz.vercel.app).
