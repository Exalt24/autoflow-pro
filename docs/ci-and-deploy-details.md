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
