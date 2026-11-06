import { PutObjectCommand } from "@aws-sdk/client-s3";

// Run events as a small S3 data lake that Athena reads. One line of JSON per event, files grouped by day under
// events/dt=YYYY-MM-DD/, which is the layout the Glue table in deploy/athena projects its dt partition over.

export const EVENTS_PREFIX = "events/";
export const ICEBERG_PREFIX = "iceberg/";

export interface RunEvent {
  executionId: string;
  workflowId: string;
  userId: string;
  status: "completed" | "failed" | "cancelled";
  durationMs: number;
  // ISO 8601 with a zone, e.g. 2026-11-07T03:15:00.000Z
  eventTime: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The UTC day of an instant, as it appears in the dt= part of the key.
export function dayOf(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new RangeError("invalid date");
  return at.toISOString().slice(0, 10);
}

// Accepts only a real calendar day (2026-02-30 is refused), because the value ends up inside SQL text.
export function assertDay(value: string): string {
  const parsed = DAY.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || dayOf(parsed) !== value) {
    throw new RangeError(`not a calendar day (YYYY-MM-DD): ${value}`);
  }
  return value;
}

export function objectKey(at: Date, batchId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(batchId)) throw new RangeError("batchId may hold letters, digits, _ and - only");
  return `${EVENTS_PREFIX}dt=${dayOf(at)}/${batchId}.json`;
}

// Column names are snake_case because the Glue table's columns are. One event per line, no pretty printing: the Hive
// JSON SerDe reads one JSON document per line.
export function toJsonLines(events: RunEvent[]): string {
  return events
    .map((e) =>
      JSON.stringify({
        execution_id: e.executionId,
        workflow_id: e.workflowId,
        user_id: e.userId,
        status: e.status,
        duration_ms: e.durationMs,
        event_time: e.eventTime,
      }),
    )
    .join("\n")
    .concat(events.length ? "\n" : "");
}

// A batch can span midnight UTC. Split it so every file holds one day, and an event never lands in a day it is not from.
export function groupByDay(events: RunEvent[]): Map<string, RunEvent[]> {
  const out = new Map<string, RunEvent[]>();
  for (const e of events) {
    const day = dayOf(new Date(e.eventTime));
    const list = out.get(day);
    if (list) list.push(e);
    else out.set(day, [e]);
  }
  return out;
}

export async function writeEventBatch(
  s3: { send(command: unknown): Promise<unknown> },
  bucket: string,
  events: RunEvent[],
  batchId: string,
): Promise<string[]> {
  const keys: string[] = [];
  for (const [day, list] of groupByDay(events)) {
    const key = objectKey(new Date(`${day}T00:00:00Z`), batchId);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: toJsonLines(list), ContentType: "application/x-ndjson" }));
    keys.push(key);
  }
  return keys;
}

const IDENT = /^[a-z][a-z0-9_]{0,63}$/;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new RangeError(`not a Glue identifier (lowercase letters, digits, _): ${name}`);
  return name;
}

// Runs and the 95th percentile duration per hour and status. The dt filter prunes to the partitions between the two
// days, and the hour comes from event_time.
export function hourlyRollupSql(database: string, table: string, fromDay: string, toDay: string): string {
  const from = assertDay(fromDay);
  const to = assertDay(toDay);
  if (from > to) throw new RangeError("fromDay is after toDay");
  return [
    "SELECT date_trunc('hour', from_iso8601_timestamp(event_time)) AS hour,",
    "       status,",
    "       count(*) AS runs,",
    "       approx_percentile(duration_ms, 0.95) AS p95_ms",
    `FROM "${ident(database)}"."${ident(table)}"`,
    `WHERE dt BETWEEN '${from}' AND '${to}'`,
    "GROUP BY 1, 2",
    "ORDER BY 1, 2",
  ].join("\n");
}

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

// The Iceberg copy of the events, for queries that need a table Athena can insert into and time travel over. Athena
// creates an Iceberg table with CREATE TABLE and the table_type property (no EXTERNAL keyword, the partition columns
// declared first, hidden partitioning through day(event_time)). The DDL form takes unquoted lowercase names, which
// ident() already guarantees.
export function createIcebergTableSql(database: string, table: string, lakeBucket: string): string {
  if (!BUCKET.test(lakeBucket)) throw new RangeError(`not an S3 bucket name: ${lakeBucket}`);
  return [
    `CREATE TABLE ${ident(database)}.${ident(table)} (`,
    "  event_time timestamp,",
    "  execution_id string,",
    "  workflow_id string,",
    "  user_id string,",
    "  status string,",
    "  duration_ms bigint",
    ")",
    "PARTITIONED BY (day(event_time))",
    `LOCATION 's3://${lakeBucket}/${ICEBERG_PREFIX}${ident(table)}/'`,
    "TBLPROPERTIES ('table_type' = 'ICEBERG')",
  ].join("\n");
}

// Copies one day of the JSON events into the Iceberg table. Iceberg timestamps have no zone, so the ISO text is parsed
// as a zoned timestamp and cast, which keeps the UTC clock time. Run it once per day: a second run for the same day
// would insert the rows again, so the caller owns that.
export function copyDayToIcebergSql(database: string, jsonTable: string, icebergTable: string, day: string): string {
  const d = assertDay(day);
  return [
    `INSERT INTO "${ident(database)}"."${ident(icebergTable)}" (event_time, execution_id, workflow_id, user_id, status, duration_ms)`,
    "SELECT CAST(from_iso8601_timestamp(event_time) AS timestamp), execution_id, workflow_id, user_id, status, duration_ms",
    `FROM "${ident(database)}"."${ident(jsonTable)}"`,
    `WHERE dt = '${d}'`,
  ].join("\n");
}
