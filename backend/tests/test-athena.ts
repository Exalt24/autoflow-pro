// LIFESPAN: permanent
// The Athena client driven by the real AWS SDK over HTTP against a stand-in written from the Athena API reference
// (tests/athena-standin.ts). No AWS account, no network beyond 127.0.0.1. The clock is fake, so a 2 minute timeout runs
// in milliseconds. Run: npm run test:athena
import {
  AthenaProtocolError,
  AthenaQueryCancelledError,
  AthenaQueryClient,
  AthenaQueryFailedError,
  AthenaTimeoutError,
  createAthenaClient,
} from "../src/athena/client.js";
import { CALL_BACKOFF, POLL_BACKOFF } from "../src/athena/policy.js";
import { copyDayToIcebergSql, createIcebergTableSql, hourlyRollupSql } from "../src/athena/eventLake.js";
import { startStandIn, type Scenario, type StandIn } from "./athena-standin.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

function fakeClock(randomValue = 0) {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    deps: {
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      now: () => t,
      random: () => randomValue,
    },
  };
}

async function withStandIn<T>(pick: (sql: string, wg: string | undefined, nth: number) => Scenario, body: (s: StandIn) => Promise<T>): Promise<T> {
  const s = await startStandIn(pick);
  try {
    return await body(s);
  } finally {
    await s.close();
  }
}

function clientFor(s: StandIn, extra: Record<string, unknown> = {}, clock = fakeClock()) {
  const sdk = createAthenaClient({ region: "ap-southeast-2", endpoint: s.url, credentials: { accessKeyId: "test", secretAccessKey: "test" } });
  const c = new AthenaQueryClient(sdk, { workGroup: "autoflow-events", database: "autoflow_events", ...extra }, clock.deps);
  return { c, clock, sdk };
}

const rows5 = [["1", "a"], ["2", "b"], ["3", null], ["4", "d"], ["5", "e"]];
const base: Scenario = { states: ["QUEUED", "RUNNING", "SUCCEEDED"], columns: ["id", "val"], rows: rows5, headerRow: true };
const inBand = (ms: number, step: number, p: typeof POLL_BACKOFF) => {
  const top = Math.min(p.maxDelayMs, p.initialDelayMs * Math.pow(p.factor, step));
  return ms >= Math.floor(top * (1 - p.jitter)) - 1 && ms <= Math.ceil(top);
};

// ---- the stand-in itself refuses what the reference refuses (so a pass above is not a pass against a pushover) ----
await withStandIn(() => base, async (s) => {
  const post = async (target: string | null, body: unknown, ct = "application/x-amz-json-1.1") => {
    const headers: Record<string, string> = { "content-type": ct };
    if (target) headers["x-amz-target"] = target;
    const r = await fetch(s.url, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const a = await post("AmazonAthena.StartQueryExecution", { QueryString: "" });
  check("stand-in: an empty QueryString is an InvalidRequestException (HTTP 400)", a.status === 400 && a.json.__type === "InvalidRequestException");
  const b = await post("AmazonAthena.StartQueryExecution", { QueryString: "SELECT 1", ClientRequestToken: "short" });
  check("stand-in: a ClientRequestToken under 32 characters is refused", b.status === 400);
  const c1 = await post("AmazonAthena.StartQueryExecution", { QueryString: "SELECT 1", ClientRequestToken: "t".repeat(36), WorkGroup: "wg" });
  const c2 = await post("AmazonAthena.StartQueryExecution", { QueryString: "SELECT 1", ClientRequestToken: "t".repeat(36), WorkGroup: "wg" });
  check("stand-in: the same token and query returns the same QueryExecutionId and starts one execution", c1.json.QueryExecutionId === c2.json.QueryExecutionId && s.executions.length === 1);
  const c3 = await post("AmazonAthena.StartQueryExecution", { QueryString: "SELECT 2", ClientRequestToken: "t".repeat(36) });
  check("stand-in: the same token with a changed QueryString is refused", c3.status === 400);
  const d = await post("AmazonAthena.GetQueryResults", { QueryExecutionId: c1.json.QueryExecutionId });
  check("stand-in: results of a query that has not finished are refused", d.status === 400);
  const e = await post("AmazonAthena.GetQueryResults", { QueryExecutionId: c1.json.QueryExecutionId, MaxResults: 1001 });
  check("stand-in: MaxResults 1001 is refused", e.status === 400);
  const f = await post("AmazonAthena.GetQueryExecution", { QueryExecutionId: "nope" });
  check("stand-in: an unknown QueryExecutionId is an InvalidRequestException", f.status === 400 && f.json.__type === "InvalidRequestException");
  const g = await post(null, {});
  const h = await post("AmazonAthena.GetQueryExecution", {}, "application/json");
  check("stand-in: a request without X-Amz-Target, or with the wrong content type, is not served", g.status === 404 && h.status === 404);
  const i = await post("AmazonAthena.StartQueryExecution", { QueryString: "SELECT 1", WorkGroup: "bad group" });
  check("stand-in: a workgroup name with a space is refused", i.status === 400);
});

// ---- a normal run ----
await withStandIn(() => base, async (s) => {
  const { c, clock } = clientFor(s, { pageSize: 2 });
  const res = await c.runQuery("SELECT id, val FROM t");
  check("a run returns the rows as records, the header row removed, a null cell kept as null", res.rows.length === 5 && res.columns.join() === "id,val" && res.rows[2].val === null && res.rows[0].id === "1" && res.rows[4].val === "e", JSON.stringify(res.rows));
  check("the six rows (header plus five) came in three pages of two, each page asking for the next token", s.calls.filter((x) => x.action === "GetQueryResults").map((x) => `${x.body.MaxResults}:${x.body.NextToken ?? "-"}`).join() === "2:-,2:page-2,2:page-4");
  const start = s.calls.find((x) => x.action === "StartQueryExecution")!.body;
  check("Start carries the query, workgroup, database and a 36 character token", start.QueryString === "SELECT id, val FROM t" && start.WorkGroup === "autoflow-events" && start.QueryExecutionContext?.Database === "autoflow_events" && start.ClientRequestToken.length === 36, JSON.stringify(start));
  check("it polled GetQueryExecution three times, waiting twice, each wait inside the poll backoff band", s.calls.filter((x) => x.action === "GetQueryExecution").length === 3 && clock.sleeps.length === 2 && inBand(clock.sleeps[0], 0, POLL_BACKOFF) && inBand(clock.sleeps[1], 1, POLL_BACKOFF), JSON.stringify(clock.sleeps));
  check("the statistics from the query execution are passed through", res.dataScannedBytes === 2048 && res.totalExecutionMs === 420 && res.runs === 1 && !res.truncated);
});

// ---- a state that goes backwards ----
await withStandIn(() => ({ ...base, states: ["RUNNING", "QUEUED", "RUNNING", "SUCCEEDED"] }), async (s) => {
  const { c } = clientFor(s);
  const res = await c.runQuery("SELECT 1");
  check("RUNNING back to QUEUED is not an end: the client keeps waiting and returns the rows", res.rows.length === 5 && s.calls.filter((x) => x.action === "GetQueryExecution").length === 4);
});

// ---- the end states ----
await withStandIn(() => ({ ...base, states: ["RUNNING", "FAILED"], failure: { message: "SYNTAX_ERROR: line 1:8: Column 'nope' cannot be resolved", retryable: false } }), async (s) => {
  const { c } = clientFor(s);
  let err: unknown;
  await c.runQuery("SELECT nope").catch((e) => (err = e));
  check("FAILED without Retryable throws AthenaQueryFailedError with Athena's message, once, with no resubmit and no result read", err instanceof AthenaQueryFailedError && /cannot be resolved/.test((err as Error).message) && (err as AthenaQueryFailedError).retryable === false && s.executions.length === 1 && !s.calls.some((x) => x.action === "GetQueryResults"));
});
{
  let runs = 0;
  await withStandIn((_q, _w, nth) => (++runs && nth === 0 ? { ...base, states: ["RUNNING", "FAILED"], failure: { message: "GENERIC_INTERNAL_ERROR: please retry", retryable: true } } : base), async (s) => {
    const { c } = clientFor(s);
    const res = await c.runQuery("SELECT 1");
    const tokens = s.calls.filter((x) => x.action === "StartQueryExecution").map((x) => x.body.ClientRequestToken);
    check("FAILED with Retryable is submitted again under a new token and the second run's rows are returned", res.runs === 2 && s.executions.length === 2 && tokens.length === 2 && tokens[0] !== tokens[1] && res.rows.length === 5);
  });
}
await withStandIn(() => ({ ...base, states: ["RUNNING", "FAILED"], failure: { message: "GENERIC_INTERNAL_ERROR", retryable: true } }), async (s) => {
  const { c } = clientFor(s, { maxRuns: 2 });
  let err: unknown;
  await c.runQuery("SELECT 1").catch((e) => (err = e));
  check("a Retryable failure that keeps failing stops after maxRuns runs", err instanceof AthenaQueryFailedError && s.executions.length === 2);
});
await withStandIn(() => ({ ...base, states: ["RUNNING", "CANCELLED"], cancelReason: "Query cancelled by user" }), async (s) => {
  const { c } = clientFor(s);
  let err: unknown;
  await c.runQuery("SELECT 1").catch((e) => (err = e));
  check("CANCELLED throws AthenaQueryCancelledError with the reason and is not resubmitted", err instanceof AthenaQueryCancelledError && /cancelled by user/.test((err as Error).message) && s.executions.length === 1);
});

await withStandIn(() => ({ ...base, states: ["RUNNING", "PAUSED"] }), async (s) => {
  const { c } = clientFor(s);
  let err: unknown;
  await c.runQuery("SELECT 1").catch((e) => (err = e));
  check("a state the reference does not list is an AthenaProtocolError, not an endless wait", err instanceof AthenaProtocolError && /PAUSED/.test((err as Error).message), String(err));
});

// ---- timeout ----
await withStandIn(() => ({ ...base, states: ["QUEUED", "RUNNING"] }), async (s) => {
  const { c, clock } = clientFor(s, { timeoutMs: 3000 });
  let err: unknown;
  await c.runQuery("SELECT 1").catch((e) => (err = e));
  const stops = s.calls.filter((x) => x.action === "StopQueryExecution");
  check("a query still running at the timeout is stopped once and AthenaTimeoutError is thrown", err instanceof AthenaTimeoutError && stops.length === 1 && stops[0].body.QueryExecutionId === s.executions[0].id && s.executions[0].stopped);
  check("the waits add up to the timeout and never pass it", clock.sleeps.reduce((a, b) => a + b, 0) === 3000, JSON.stringify(clock.sleeps));
});
await withStandIn(() => ({ ...base, states: ["RUNNING", "RUNNING", "SUCCEEDED"] }), async (s) => {
  const clock = fakeClock();
  // waits are 250 then 500, so the third read lands exactly on the 750 ms deadline: a query that is done by then is returned, not timed out
  const { c } = clientFor(s, { timeoutMs: 750 }, clock);
  const res = await c.runQuery("SELECT 1").catch((e) => e);
  check("a query that finishes at the deadline is returned, not timed out", !(res instanceof Error) && res.rows.length === 5, String(res));
});

// ---- transient faults ----
await withStandIn(() => ({ ...base, throttleStart: 2 }), async (s) => {
  const { c, clock } = clientFor(s);
  const res = await c.runQuery("SELECT 1");
  const starts = s.calls.filter((x) => x.action === "StartQueryExecution");
  check("a throttled Start is repeated with the same token until it is accepted", res.rows.length === 5 && starts.length === 3 && new Set(starts.map((x) => x.body.ClientRequestToken)).size === 1 && s.executions.length === 1);
  check("the waits between those tries follow the call backoff", inBand(clock.sleeps[0], 0, CALL_BACKOFF) && inBand(clock.sleeps[1], 1, CALL_BACKOFF), JSON.stringify(clock.sleeps));
});
await withStandIn(() => ({ ...base, dropFirstStartResponse: true }), async (s) => {
  const { c } = clientFor(s);
  const res = await c.runQuery("SELECT 1");
  check("an answer lost after the query started is repeated under the same token and still means one execution", res.rows.length === 5 && s.executions.length === 1 && s.calls.filter((x) => x.action === "StartQueryExecution").length === 2);
});
await withStandIn(() => ({ ...base, serverErrorGet: 2 }), async (s) => {
  const { c } = clientFor(s);
  const res = await c.runQuery("SELECT 1");
  check("two InternalServerException answers (HTTP 500) to GetQueryExecution are repeated", res.rows.length === 5);
});
await withStandIn(() => ({ ...base, tooManyResults: 2 }), async (s) => {
  const { c } = clientFor(s);
  const res = await c.runQuery("SELECT 1");
  check("two TooManyRequestsException answers to GetQueryResults are repeated", res.rows.length === 5);
});
await withStandIn(() => ({ ...base, throttleStart: 99 }), async (s) => {
  const { c } = clientFor(s, { maxCallAttempts: 3 });
  let err: any;
  await c.runQuery("SELECT 1").catch((e) => (err = e));
  check("a call that keeps being throttled gives up after maxCallAttempts and throws the throttling error", err?.name === "ThrottlingException" && s.calls.filter((x) => x.action === "StartQueryExecution").length === 3, String(err?.name));
});
await withStandIn(() => base, async (s) => {
  const { c } = clientFor(s, { workGroup: "bad group" });
  let err: any;
  await c.runQuery("SELECT 1").catch((e) => (err = e));
  check("an InvalidRequestException is thrown at once and not repeated", err?.name === "InvalidRequestException" && s.calls.length === 1, `${err?.name} calls=${s.calls.length}`);
});

// ---- results ----
await withStandIn(() => ({ ...base, repeatNextToken: true }), async (s) => {
  const { c } = clientFor(s, { pageSize: 2 });
  let err: unknown;
  await c.runQuery("SELECT 1").catch((e) => (err = e));
  check("a NextToken that never advances is an AthenaProtocolError, not an endless loop", err instanceof AthenaProtocolError, String(err));
});
await withStandIn(() => ({ ...base, rows: Array.from({ length: 10 }, (_, i) => [String(i), "x"]) }), async (s) => {
  const { c } = clientFor(s, { pageSize: 4, maxRows: 6 });
  const res = await c.runQuery("SELECT 1");
  check("maxRows stops the read, returns that many rows and says truncated", res.rows.length === 6 && res.truncated && res.rows[5].id === "5", JSON.stringify([res.rows.length, res.truncated]));
});
await withStandIn(() => ({ ...base, rows: [["1", "a"]] }), async (s) => {
  const { c } = clientFor(s, { maxRows: 1 });
  const res = await c.runQuery("SELECT 1");
  check("a result that has exactly maxRows rows is not called truncated", res.rows.length === 1 && !res.truncated);
});
await withStandIn(() => ({ ...base, statementType: "DDL", headerRow: false, columns: ["tab_name"], rows: [["tab_name"], ["run_events"]] }), async (s) => {
  const { c } = clientFor(s);
  const res = await c.runQuery("SHOW TABLES");
  check("for a DDL statement no row is dropped, even one that equals the column name", res.rows.length === 2 && res.rows[0].tab_name === "tab_name");
});
await withStandIn(() => ({ ...base, states: ["RUNNING", "SUCCEEDED"], rows: [], columns: ["id", "val"] }), async (s) => {
  const { c } = clientFor(s);
  const res = await c.runQuery("SELECT 1 WHERE false");
  check("a SELECT with no rows returns an empty list and the column names", res.rows.length === 0 && res.columns.join() === "id,val");
});
await withStandIn(() => ({ ...base, columns: ["hour", "status", "runs", "p95_ms"], rows: [["2026-11-07 01:00:00.000 UTC", "completed", "12", "1500.0"]] }), async (s) => {
  const { c } = clientFor(s);
  const sql = hourlyRollupSql("autoflow_events", "run_events", "2026-11-01", "2026-11-07");
  const res = await c.runQuery(sql);
  check("the hourly rollup query reaches the service unchanged and its row comes back keyed by column", s.calls.find((x) => x.action === "StartQueryExecution")!.body.QueryString === sql && res.rows[0].runs === "12" && res.rows[0].p95_ms === "1500.0");
});
await withStandIn((q) => (q.startsWith("CREATE TABLE") ? { states: ["RUNNING", "SUCCEEDED"], statementType: "DDL", columns: [], rows: [] } : { states: ["QUEUED", "SUCCEEDED"], statementType: "DML", columns: [], rows: [], headerRow: false }), async (s) => {
  const { c } = clientFor(s);
  const ddl = createIcebergTableSql("autoflow_events", "run_events_iceberg", "autoflow-lake-123456789012");
  const a = await c.runQuery(ddl);
  const b = await c.runQuery(copyDayToIcebergSql("autoflow_events", "run_events", "run_events_iceberg", "2026-11-07"));
  const sent = s.calls.filter((x) => x.action === "StartQueryExecution").map((x) => x.body.QueryString);
  check("the Iceberg DDL and the day copy each run to SUCCEEDED through the client, the DDL as a statement with no result rows", a.rows.length === 0 && b.rows.length === 0 && sent[0] === ddl && sent[1].startsWith("INSERT INTO"), JSON.stringify(sent.map((q: string) => q.slice(0, 30))));
});
await withStandIn(() => base, async (s) => {
  const { c } = clientFor(s, { outputLocation: "s3://autoflow-athena-results/queries/" });
  await c.runQuery("SELECT 1");
  const start = s.calls.find((x) => x.action === "StartQueryExecution")!.body;
  check("an output location, when given, goes in ResultConfiguration", start.ResultConfiguration?.OutputLocation === "s3://autoflow-athena-results/queries/");
});

console.log(failed === 0 ? `\nAll ${passed} Athena stand-in checks passed` : `\n${failed} of ${passed + failed} Athena stand-in check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
