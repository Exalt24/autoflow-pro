# Athena client and run event lake

AutoFlow Pro keeps a record of every run. This adds a way to ask questions about that record with SQL: run events go to S3 as small JSON files, an Athena table sits over them, and a TypeScript client runs a query and returns the rows. The code is in `backend/src/athena/`, the Terraform in `deploy/athena/`.

## The client

`AthenaQueryClient.runQuery(sql)` in `backend/src/athena/client.ts` does what the Athena API reference describes, in order:

1. `StartQueryExecution` with the workgroup, an optional database and result location, and a `ClientRequestToken` (36 characters, the reference asks for 32 to 128). The token is made once per run and reused if the call is repeated after a lost answer, so a repeat returns the same query instead of starting a second one.
2. `GetQueryExecution` until the state is final. `QUEUED` and `RUNNING` both mean wait, and a query can go from `RUNNING` back to `QUEUED`, so the client never treats the order as one way. Waits grow from 250 ms to 5 s with jitter. If the timeout runs out the client calls `StopQueryExecution` and throws `AthenaTimeoutError`. A query that finishes exactly at the deadline is returned.
3. `GetQueryResults` page by page with `MaxResults` (1 to 1000) and `NextToken`. For a `SELECT` Athena sends the column names as the first row of the first page. The client drops that row only when the statement type is `DML`, the page is the first one and the row equals the column labels, so a statement without a header loses nothing. The reference page for the result set does not spell this behaviour out, so the guard is deliberately narrow. A token that comes back unchanged stops the read with `AthenaProtocolError`, and `maxRows` cuts the read short and says `truncated`.

What each end state does:

| State | Result |
| --- | --- |
| `SUCCEEDED` | rows as records, column names, bytes scanned and run time |
| `FAILED` | `AthenaQueryFailedError` with Athena's message. If `AthenaError.Retryable` is true and runs are left (`maxRuns`, default 2) the statement is submitted once more under a new token |
| `CANCELLED` | `AthenaQueryCancelledError`, never resubmitted |
| any other state | `AthenaProtocolError` |

API calls that fail with throttling, `TooManyRequestsException`, `InternalServerException`, a timeout, a 5xx or a dropped connection are repeated up to `maxCallAttempts` times with backoff. `InvalidRequestException` and credential errors are thrown at once. The SDK's own retries are switched off (`maxAttempts: 1`) so every one of these decisions is made in `policy.ts` where it is tested.

## The event lake

`eventLake.ts` writes run events as one JSON document per line to `events/dt=YYYY-MM-DD/<batch>.json` (the day is UTC; a batch that spans midnight is split so no event lands in a day it is not from). `hourlyRollupSql` builds a query for runs and 95th percentile duration per hour and status. It takes only real calendar days and lowercase Glue names, because they end up inside SQL text.

The events also have an Apache Iceberg copy. `createIcebergTableSql` builds the Athena `CREATE TABLE` for it (the `table_type` property set to `ICEBERG`, no `EXTERNAL` keyword, `PARTITIONED BY (day(event_time))`, location under `iceberg/` in the lake bucket) and `copyDayToIcebergSql` builds an `INSERT INTO ... SELECT` that copies one day of the JSON events into it, casting the ISO text to an Iceberg timestamp. Both go through the same client. The Terraform policy lets the backend create and update only that one Glue table and write only under `iceberg/`.

## The Terraform

`deploy/athena/` creates:

- a lake bucket and a results bucket, both with public access blocked and AES256 encryption, event files expiring after 365 days and query results after 7
- a Glue database `autoflow_events` and an external table `run_events` using the Hive JSON SerDe, partitioned by `dt` with partition projection (date type, `yyyy-MM-dd`, from 2026-01-01 to `NOW`), so a new day needs no crawler and no `ADD PARTITION`
- an Athena workgroup `autoflow-events` that enforces its own result location and SSE_S3 encryption, publishes CloudWatch metrics and stops a query that would scan more than 10 GiB
- an IAM policy that starts, reads and stops queries in that one workgroup, reads that one table, reads `events/` in the lake, and writes and reads `queries/` in the results bucket

## What was run

Everything below is in [docs/test-runs/2026-11-07-athena-client.txt](test-runs/2026-11-07-athena-client.txt). No AWS account was used for any of it.

- **A stand-in for the Athena API.** `backend/tests/athena-standin.ts` is a small HTTP server written from the Athena API reference pages for `StartQueryExecution`, `GetQueryExecution`, `GetQueryResults`, `StopQueryExecution`, `QueryExecutionStatus` and `AthenaError`, and the common error list. It enforces the documented limits (query string length, token length, `MaxResults` 1 to 1000, results refused until the query has finished, a token reused with a different query refused) and it can be scripted to throttle, answer 500, cut a connection after starting a query, or repeat a page token. The real AWS SDK talks to it over HTTP. It is not AWS: the body shapes come from the reference, and the envelope (POST, `X-Amz-Target: AmazonAthena.<Action>`, `application/x-amz-json-1.1`) is what the SDK sends.
- `npm run test:athena`: 37 checks against the stand-in, including nine that prove the stand-in itself refuses what the reference refuses.
- `npm run test:athena-logic`: 45 checks, including 3000 seeded random worlds run through the real client against an in-process fake (faults, lost answers, page limits, cancelled, failed, never-finishing queries) and three controls where a deliberately broken client must turn the property red.
- `npm run test:athena-terraform`: `terraform fmt`, `validate` and an offline plan (dummy credentials, 12 resources to add, nothing applied), then 33 rules on the plan JSON, including that the table columns are the keys `toJsonLines` writes and the projected location is the path the writer uses.
- `node scripts/mutation-check-athena.mjs`: each decision above broken in a scratch copy, 32 in the client and the event lake and 20 in the Terraform, all caught. The list is in the test run file.

## Not covered

- Nothing here ran against a real Athena endpoint or a real AWS account. The Terraform was validated and planned, not applied.
- The first-row header behaviour is the one detail taken from how the service is known to answer rather than from a reference page, which is why the skip is guarded three ways.
- The Iceberg DDL and the insert are checked against the reference's syntax and run through the client against the stand-in, not against a real Athena engine. Table maintenance (compaction, snapshot expiry) is not written.
- No Spark sessions, no prepared statements, no workgroup per tenant.
- The client is not wired into an API route yet. It is a module with its own settings.
