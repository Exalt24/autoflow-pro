# Telemetry pipeline

AutoFlow Pro already has an Athena client and an S3 lake for run events. This adds the piece that handles time series: readings from an asset (power, voltage, temperature) arrive in batches, are validated and deduplicated, rolled up per 5 minutes and per hour with energy in kWh, and written to the lake in a layout that Athena tables project. The code is in `backend/src/telemetry/`, the Terraform in `deploy/athena/telemetry.tf`.

```
RabbitMQ message { readings: [...] }
   -> consumer (backend/src/messaging, manual ack)
   -> handler -> pipeline.process(readings, batchId)
        1. stage     validate, drop duplicates, apply the watermark (memory untouched)
        2. write     reading files and quarantine file go to the lake
        3. apply     memory changes
        4. rollups   touched 5 minute and 1 hour buckets are recomputed, day files replaced
   -> ack
```

## The reading

One JSON object per reading:

```json
{ "asset_id": "pv-001", "ts": "2026-11-06T10:15:00Z", "power_kw": 3.2, "voltage_v": 612.5, "temp_c": 41.0 }
```

| Field | Rule |
| --- | --- |
| `asset_id` | 1 to 64 letters, digits, `_` or `-` (it becomes a folder name) |
| `ts` | ISO 8601 with a zone (`Z` or `+hh:mm`), up to 3 fractional digits, a real calendar time, not before 2000-01-01, not more than 5 minutes ahead of the ingest clock. A time with no zone is refused as ambiguous |
| `power_kw` | required, a finite number from 0 to 10000. A negative power is a sensor fault for a solar asset |
| `voltage_v` | optional, 0 to 2000 |
| `temp_c` | optional, -60 to 150 |

Any other field is refused. A numeric string is not coerced. Every reading that fails is set aside in the quarantine list with the rule that refused it and the input as it was sent; it is never loaded. The reasons are `invalid_shape`, `unknown_field`, `invalid_asset_id`, `invalid_timestamp`, `future_timestamp`, `missing_value`, `invalid_value`, `out_of_range`, `conflicting_duplicate` and `too_late`.

## Ingest

Readings are keyed by (asset id, timestamp). In the order a reading meets the rules:

1. **Schema.** A failure is quarantined with its reason.
2. **Duplicates.** A key that is already stored with the same values is a no-op, counted as a duplicate. The same key with other values follows one rule: **the first write wins** and the later one is quarantined as `conflicting_duplicate`, with the value that was kept named in the detail. The rule does not depend on how often a batch is replayed, so sending any batch again, in any order, changes nothing. The cost is that which of two conflicting values wins depends on which arrived first.
3. **Lateness.** Each asset has a watermark: its newest accepted timestamp minus the allowed lateness (15 minutes by default). A reading older than the watermark is quarantined as `too_late`. One at or after it is merged into its place in time order, even when it arrives out of order, and its buckets are rolled up again. Readings are judged in arrival order, so splitting a stream into batches of any size gives the same result. A reading that is rejected never moves a watermark, and a reading more than 5 minutes ahead of the clock is refused so one wrong device clock cannot push every other reading behind the watermark.

Every batch adds up: received = stored + duplicates + quarantined. The same input quarantined twice is kept once in the quarantine list (the counters still count each occurrence), so replays do not grow it.

## Rollups and gaps

For each asset, a 5 minute and a 1 hour bucket (UTC) holds, per channel, the count of values, min, max and mean, plus `readings` (rows in the bucket), `energy_kwh` and `gap_segments`.

- **Energy** is the trapezoid rule over the readings. The segment between two consecutive readings adds (power of the first plus power of the second) / 2 times the hours between them, and belongs to the bucket of the first reading. So an hour is exactly the sum of its twelve 5 minute buckets, and the segment that crosses midnight lands in the last bucket of the earlier day. A late reading re-rolls its own bucket and the bucket of the reading before it.
- **Gaps.** Two consecutive readings more than 1.5 expected intervals apart are a gap. A gap segment adds no energy and is counted in `gap_segments`; nothing is invented to cover it. `detectGaps` reports each gap with the readings before and after it and how many readings are missing, and with a window (a day, say) also reports the stretch before the first reading and after the last. A bucket with no readings has no row; `missingBuckets` lists them.

## The lake

Files are JSON lines, one file per partition, behind a small interface (`LakeStore`: `put`, `get`, `list`). `FsLakeStore` writes to a local folder (a temporary file in the same folder, then a rename, so a reader never sees half a file), `MemoryLakeStore` is for tests, and `S3LakeStore` makes the calls the AWS SDK documents for PutObject, GetObject and ListObjectsV2 with paging. Switching to S3 is a different constructor, not different code.

```
telemetry/readings/asset=<id>/dt=YYYY-MM-DD/hour=HH/part-<batch>.jsonl
telemetry/rollups_5m/asset=<id>/dt=YYYY-MM-DD/rollup.jsonl
telemetry/rollups_1h/asset=<id>/dt=YYYY-MM-DD/rollup.jsonl
telemetry/quarantine/dt=YYYY-MM-DD/part-<batch>.jsonl
```

The day and hour are UTC. A reading file is named by the batch that wrote it, so writing a batch again replaces the same file with the same lines. A rollup file holds a whole day of one asset and is replaced when a bucket in it changes.

`deploy/athena/telemetry.tf` adds, to the existing Glue database:

- four external tables over those folders (`telemetry_readings`, `telemetry_rollup_5m`, `telemetry_rollup_1h`, `telemetry_quarantine`), whose columns come from the same lists the code writes with (`READING_COLUMNS`, `ROLLUP_COLUMNS`, `QUARANTINE_COLUMNS`)
- partition projection: `dt` is a date range from 2026-01-01 to `NOW`, `hour` is an integer 0 to 23 padded to two digits, and `asset` is an injected projection, because a fleet has no fixed list of ids. A query on these tables must name the asset with an equality predicate (`WHERE asset = 'pv-001'`)
- `telemetry_read` (Glue read on the four tables, S3 read under `telemetry/`) to attach next to the existing query policy, and `telemetry_write` (put and read back under `telemetry/`, no delete) for the worker
- a lifecycle rule that expires `telemetry/` files after 400 days

## The worker

`createTelemetryHandler` in `worker.ts` plugs the pipeline into `ReliableConsumer`, which acks only after the handler resolves. The handler resolves only after the reading files, the quarantine file and the rollup files are in the lake. What that gives:

- **A crash before the ack** redelivers the message. A new process opens the lake (`TelemetryPipeline.open`), which rebuilds every reading and repairs any rollup file that is missing or stale, and the redelivery finds every reading already stored: all duplicates, nothing counted twice, no file changed.
- **A failed write** leaves memory untouched (stage first, write, apply last), so the consumer's retry through the delay queue stages the batch as new and stores it once. A failed rollup write is remembered and finished by the next call, even if that call carries only duplicates.
- **Two messages at once** with the same readings are processed one after another inside the pipeline, so the readings are stored once.
- **A body that is not `{ "readings": [...] }`** (or holds more than 10,000 readings) is a `PermanentError` and goes to the dead letter queue. A bad reading inside a good body is quarantined and the message is acked.

Run one worker per lake folder: the watermarks and the duplicate check live in the process.

## Run it

```bash
cd backend
npm run test:telemetry-logic        # rules, rollups, lake, crash order, 400 seeded worlds against a reference model
npm run test:telemetry-e2e          # generated solar days -> pipeline -> lake files -> read back -> recomputation
npm run telemetry:load              # 1,000,000+ generated readings through ingest and rollup, then a lake write and read back
npm run test:telemetry-terraform    # fmt, validate, offline plan of deploy/athena, rules on the plan JSON
docker run -d --name afp-tel-rabbit -p 56730:5672 rabbitmq:3-management
RABBITMQ_URL=amqp://guest:guest@localhost:56730 npm run test:telemetry-rabbitmq
node ../scripts/mutation-check-telemetry.mjs   # each guard removed in a scratch copy; add RABBITMQ_URL for the broker mutants
```

The worker itself: `npm run build`, then `RABBITMQ_URL=... TELEMETRY_LAKE_DIR=./telemetry-lake npm run start:telemetry` (settings are listed at the top of `src/telemetry/main.ts`).

`generator.ts` makes a deterministic solar day for an asset (daylight curve, noise, optional voltage and temperature gaps) and plants one of each defect at fixed fractions of the day: an exact duplicate, a conflicting duplicate, a reading delivered past the allowed lateness, one delivered late but inside it, a 20 minute gap, a negative power and two bad timestamps. The tests count them back.

## What was run

The captured output of each run is in [docs/test-runs](test-runs): [tests](test-runs/2026-11-07-telemetry-tests.txt), [load run](test-runs/2026-11-07-telemetry-load.txt) and [mutation check](test-runs/2026-11-07-telemetry-mutation-check.txt).

- `npm run test:telemetry-logic`: 160 checks. Every rule above has its own check, including the boundaries (a reading exactly at the watermark, one millisecond behind it, a gap of exactly 1.5 intervals, a timestamp exactly at the future limit). 400 seeded random worlds (1 to 3 assets, gaps, repeats, conflicting repeats, junk, late and very late data, any batch size) are run against a reference model written in the test, and each checks the counts, the stored readings, the rollups, that an hour is the sum of its 5 minute buckets, and that replaying the whole stream changes nothing. Four controls (a store that is never late, one with the wrong lateness, one that drops a conflicting repeat without quarantining it, one that stops counting rejects) must turn the property red, and they do. The lake stores run one shared contract (put, get, list across pages, replace, unsafe keys) over a local folder, memory, and the S3 calls against an in-memory stand-in.
- `npm run test:telemetry-e2e`: 21 checks. 8550 generated readings for 3 assets over 2 UTC days go through the pipeline in 72 batches into a local folder; the files are then read back from disk and compared with a recomputation that shares no code with `rollup.ts`: every reading, every 5 minute and hourly rollup file, the day's energy, the planted gaps, the empty buckets and the quarantine. Sending every batch again leaves every file byte for byte the same, and so does a restart.
- `npm run telemetry:load`: 1,023,000 generated readings (120 assets, one day each, one reading per 10 seconds, with the planted defects) through ingest and rollup in 1.25 s, which is 821,245 readings per second (1.05 s ingest, 0.19 s rollup, batches of 5000, generation not counted). Heap 360 MiB after the run. 34,200 5 minute rows and 2,880 hourly rows came out, and their energy matches an independent trapezoid sum. Writing them to a local folder took 5.66 s for 3,121 files, and reading it all back took 2.93 s. Machine: win32 10.0.26300, AMD Ryzen 7 9800X3D 8-Core Processor x 16. The load run is a single process in memory, so the rate is what this code does on this machine, not a capacity figure for a deployment.
- `npm run test:telemetry-terraform`: 48 checks. `terraform fmt`, `validate` and an offline plan with dummy credentials (18 resources to add, 12 of them the original Athena ones, nothing applied), then rules on the plan JSON: the columns, types and order of the four tables equal the lists the code writes with, the projected locations equal the paths the writer uses, the partition keys are not also data columns, the hour projection matches `hour=00` to `hour=23`, the policies have no wildcard action and no delete and stay under `telemetry/`, and changing `telemetry_prefix` moves the tables, the policies and the lifecycle rule together.
- `npm run test:telemetry-rabbitmq`: 22 checks against a real RabbitMQ 3.13.7 in Docker: a generated day in 8 messages produces the same lake as a direct run; a replay under new and old message ids changes no file; a process killed after the write and before the ack gets the message back from the broker and the new process counts nothing twice; a failed write is retried through the delay queue and stored once; a bad body is dead lettered and a body with bad readings is acked; 20 messages with the same readings handled 10 at a time are stored once.
- `node scripts/mutation-check-telemetry.mjs`: 101 of 101 deliberate breaks caught (72 in the code, 22 in the Terraform, 7 that only the broker test can see), each removed from a scratch copy while the unbroken copy passes first.
- The existing Athena Terraform test and the pipeline parity test were run again with the new files in place and pass.
- CI: the `telemetry` job in `.github/workflows/ci.yml` runs the logic, end to end, load, Terraform and broker tests with a RabbitMQ service container.

Three things the runs found along the way, all fixed: a check on the day of the month that the month check already covered (the mutation run showed no test could tell it from its removal, so it was deleted), a concurrency test that still passed with the pipeline's one at a time rule removed (the lake in that test is now slow and the messages are published together, and it fails without the rule), and a retry test that read the queue before the retried handler had finished, which failed once before it waited on the handler (after the fix it passed 12 runs in a row).

## Register

Everything above ran against generated solar telemetry (a deterministic generator with planted defects) on a local filesystem and a real RabbitMQ broker in Docker. The Terraform was validated and planned offline with dummy credentials and never applied. There is no real telemetry system behind any of it, no Iceberg table for this data, and nothing ran against a live S3 bucket or a live Athena on this data. `S3LakeStore` was checked against an in-memory stand-in for the three S3 calls it makes, not against S3 or an S3 emulator. The projection settings in `telemetry.tf` (an injected `asset`, an integer `hour` with two digits) follow the Athena documentation and were planned by Terraform; no Athena query has read these tables.

Known limits: one worker per lake folder (the watermarks and the duplicate check live in the process, so two workers on one folder would not see each other's readings); the lake is read in full when a worker starts, which is fine for these sizes and would need partition pruning for a large lake; the first value wins for a conflicting duplicate, so a corrected value for an existing timestamp needs a new rule or a replay tool; the load figure is one process in memory on one machine.
