Terraform for the Athena side of AutoFlow Pro: an S3 bucket for run events, a bucket for query results, a Glue database and an external table over the events, an Athena workgroup, and an IAM policy that lets the backend run queries and nothing else. Full description and the checks that were run: `docs/athena.md`.

```bash
terraform init -backend=false
terraform validate
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test terraform plan -var offline_plan=true -var account_id=123456789012   # no AWS call
```

The table reads `events/dt=YYYY-MM-DD/*.json` and uses partition projection for `dt`, so no crawler and no `ADD PARTITION` is needed. The files are written by `writeEventBatch` in `backend/src/athena/eventLake.ts`, and `backend/tests/test-athena-terraform.ts` checks that the table columns are the keys that function writes.

Before a real apply: add a state backend, and decide whether `force_destroy` should stay false. Then attach `terraform output -raw query_policy_arn` to the role the backend runs as, and pass the `workgroup` and `database` outputs to `AthenaQueryClient` as its `workGroup` and `database` settings.

`telemetry.tf` adds four more Glue tables in the same database for the telemetry pipeline (`telemetry_readings`, `telemetry_rollup_5m`, `telemetry_rollup_1h`, `telemetry_quarantine`), two IAM policies (`telemetry_read` next to the query policy, `telemetry_write` for the worker) and a lifecycle rule for the `telemetry/` prefix. The offline plan now holds 18 resources, 12 of them the original ones above. Layout, columns and the checks that were run: `docs/telemetry.md`. A query on `telemetry_readings` or either rollup table must name the asset with an equality predicate (`WHERE asset = 'pv-001'`), because `asset` is an injected partition projection.
