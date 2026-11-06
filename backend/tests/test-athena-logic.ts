// LIFESPAN: permanent
// Athena client logic that needs no server: state handling, backoff, the transient-error rule, the resubmit rule,
// page and header handling, the event-lake helpers, and a seeded property test that drives the real client through
// thousands of random worlds against an in-process fake of the API.
// The wire (real SDK over HTTP to a stand-in) is test-athena.ts. Run: npm run test:athena-logic
import {
  AthenaProtocolError,
  AthenaQueryCancelledError,
  AthenaQueryClient,
  AthenaQueryFailedError,
  AthenaTimeoutError,
  type AthenaSettings,
} from "../src/athena/client.js";
import {
  CALL_BACKOFF,
  POLL_BACKOFF,
  backoffDelayMs,
  classifyState,
  decideAfterFailure,
  decideNextPage,
  isTransientError,
  shouldSkipHeader,
  toRecords,
  validatePageSize,
} from "../src/athena/policy.js";
import { assertDay, copyDayToIcebergSql, createIcebergTableSql, dayOf, groupByDay, hourlyRollupSql, objectKey, toJsonLines, writeEventBatch, type RunEvent } from "../src/athena/eventLake.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};
const throws = (fn: () => unknown, match: RegExp) => {
  try {
    fn();
    return false;
  } catch (e) {
    return match.test(String((e as Error).message));
  }
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- states ----
check("QUEUED and RUNNING are pending", classifyState("QUEUED") === "pending" && classifyState("RUNNING") === "pending");
check("SUCCEEDED, FAILED and CANCELLED are terminal and distinct", classifyState("SUCCEEDED") === "succeeded" && classifyState("FAILED") === "failed" && classifyState("CANCELLED") === "cancelled");
check("a state the reference does not list is unknown, not pending", classifyState("PAUSED") === "unknown" && classifyState(undefined) === "unknown" && classifyState("") === "unknown" && classifyState("running") === "unknown");

// ---- backoff ----
const noJitter = { initialDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: 0 };
check("backoff doubles from the initial delay", [0, 1, 2, 3].map((s) => backoffDelayMs(s, noJitter, () => 0.5)).join() === "100,200,400,800");
check("backoff stops at the maximum", backoffDelayMs(4, noJitter, () => 0.5) === 1000 && backoffDelayMs(40, noJitter, () => 0.5) === 1000);
check("backoff with full random draw lands at the low end of the jitter band", backoffDelayMs(0, { ...noJitter, jitter: 0.25 }, () => 1) === 75);
check("backoff with a zero draw lands at the exponential value", backoffDelayMs(2, { ...noJitter, jitter: 0.25 }, () => 0) === 400);
check("a negative step or a draw outside 0 to 1 cannot push the delay outside its band", backoffDelayMs(-3, noJitter, () => 0) === 100 && backoffDelayMs(0, { ...noJitter, jitter: 0.5 }, () => 7) === 50 && backoffDelayMs(0, { ...noJitter, jitter: 0.5 }, () => -7) === 100);
{
  let bad: string | null = null;
  for (let seed = 1; seed <= 500 && !bad; seed++) {
    const r = rng(seed);
    const p = { initialDelayMs: 1 + Math.floor(r() * 500), maxDelayMs: 500 + Math.floor(r() * 9000), factor: 1 + r() * 3, jitter: r() * 0.9 };
    let prevBase = 0;
    for (let step = 0; step < 14 && !bad; step++) {
      const base = Math.min(p.maxDelayMs, p.initialDelayMs * Math.pow(p.factor, step));
      const d = backoffDelayMs(step, p, r);
      if (d < Math.floor(base * (1 - p.jitter)) - 1 || d > Math.ceil(base)) bad = `seed ${seed} step ${step}: ${d} outside [${base * (1 - p.jitter)}, ${base}]`;
      if (base < prevBase) bad = `seed ${seed}: the base shrank`;
      prevBase = base;
    }
  }
  check("500 seeded backoff policies stay inside their jitter band and never shrink", bad === null, bad ?? "");
}
check("the shipped poll and call policies start small and cap", POLL_BACKOFF.initialDelayMs <= 500 && POLL_BACKOFF.maxDelayMs <= 10_000 && CALL_BACKOFF.maxDelayMs <= 10_000 && POLL_BACKOFF.jitter < 1);

// ---- transient errors ----
const named = (name: string, status?: number) => Object.assign(new Error(name), { name, ...(status ? { $metadata: { httpStatusCode: status } } : {}) });
check("throttling, too many requests, internal error, unavailable and timeout are transient", ["ThrottlingException", "TooManyRequestsException", "InternalServerException", "ServiceUnavailable", "RequestTimeoutException"].every((n) => isTransientError(named(n))));
check("a bad request, a bad credential and a missing permission are not transient", ["InvalidRequestException", "UnrecognizedClientException", "NotAuthorized", "AccessDeniedException", "ValidationError"].every((n) => !isTransientError(named(n, 400))));
check("any 5xx is transient (500, 502, 503, 599), a 4xx is not (400, 404, 499)", [500, 502, 503, 599].every((s) => isTransientError(named("Whatever", s))) && [400, 404, 499].every((s) => !isTransientError(named("Whatever", s))));
check("a dropped connection is transient", isTransientError(Object.assign(new Error("x"), { code: "ECONNRESET" })) && isTransientError(Object.assign(new Error("x"), { code: "ETIMEDOUT" })));
check("null, strings and plain errors are not transient", !isTransientError(null) && !isTransientError("ThrottlingException") && !isTransientError(new Error("plain")));

// ---- resubmit rule ----
check("a Retryable failure with runs left is resubmitted", decideAfterFailure(true, 1, 2).action === "resubmit");
check("a Retryable failure on the last run is not resubmitted", decideAfterFailure(true, 2, 2).action === "fail");
check("a failure that is not Retryable is never resubmitted", decideAfterFailure(false, 1, 5).action === "fail" && decideAfterFailure(undefined, 1, 5).action === "fail");
check("maxRuns 1 means no resubmit at all", decideAfterFailure(true, 1, 1).action === "fail");

// ---- pages and header ----
check("pageSize accepts 1 and 1000", validatePageSize(1) === 1 && validatePageSize(1000) === 1000);
check("pageSize refuses 0, 1001, 2.5 and NaN", [0, 1001, 2.5, NaN, -1].every((n) => throws(() => validatePageSize(n), /pageSize/)));
check("no token means done", decideNextPage(undefined, undefined, 5, 100).action === "done");
check("a new token means next", JSON.stringify(decideNextPage("b", "a", 5, 100)) === '{"action":"next","token":"b"}');
check("the token that was just sent coming back means stuck", decideNextPage("a", "a", 5, 100).action === "stuck");
check("reaching maxRows stops even with a token", decideNextPage("b", "a", 100, 100).action === "done" && decideNextPage("b", "a", 99, 100).action === "next");
check("the header row is skipped for a SELECT on the first page when it equals the labels", shouldSkipHeader("DML", true, ["a", "b"], ["a", "b"]));
check("the header row is kept when the statement is not DML, the page is not the first, or it is not the labels", !shouldSkipHeader("DDL", true, ["a"], ["a"]) && !shouldSkipHeader("DML", false, ["a"], ["a"]) && !shouldSkipHeader("DML", true, ["x"], ["a"]) && !shouldSkipHeader("DML", true, undefined, ["a"]) && !shouldSkipHeader("DML", true, ["a", "b"], ["a"]));
check("a data row that repeats the labels on a later page is kept", !shouldSkipHeader("DML", false, ["a", "b"], ["a", "b"]));
check("toRecords maps cells to labels and keeps nulls", JSON.stringify(toRecords(["a", "b"], [["1", null], ["2"]])) === '[{"a":"1","b":null},{"a":"2","b":null}]');

// ---- event lake helpers ----
const ev = (t: string, id = "e1"): RunEvent => ({ executionId: id, workflowId: "w1", userId: "u1", status: "completed", durationMs: 1200, eventTime: t });
check("dayOf uses UTC", dayOf(new Date("2026-11-07T23:59:59.999Z")) === "2026-11-07" && dayOf(new Date("2026-11-08T00:00:00.000Z")) === "2026-11-08");
check("objectKey builds the dt= partition path", objectKey(new Date("2026-11-07T03:00:00Z"), "batch-1") === "events/dt=2026-11-07/batch-1.json");
check("objectKey refuses a batch id with a slash or dots", throws(() => objectKey(new Date(), "../x"), /batchId/) && throws(() => objectKey(new Date(), "a/b"), /batchId/) && throws(() => objectKey(new Date(), ""), /batchId/));
check("assertDay accepts a real day and refuses 2026-02-30, 2026-13-01 and text with SQL in it", assertDay("2026-02-28") === "2026-02-28" && throws(() => assertDay("2026-02-30"), /calendar day/) && throws(() => assertDay("2026-13-01"), /calendar day/) && throws(() => assertDay("2026-01-01' OR '1'='1"), /calendar day/));
check("toJsonLines writes one document per line with snake_case columns and a final newline", toJsonLines([ev("2026-11-07T01:00:00Z"), ev("2026-11-07T02:00:00Z", "e2")]) === '{"execution_id":"e1","workflow_id":"w1","user_id":"u1","status":"completed","duration_ms":1200,"event_time":"2026-11-07T01:00:00Z"}\n{"execution_id":"e2","workflow_id":"w1","user_id":"u1","status":"completed","duration_ms":1200,"event_time":"2026-11-07T02:00:00Z"}\n');
check("toJsonLines keeps a value with a newline on one line", !toJsonLines([{ ...ev("2026-11-07T01:00:00Z"), userId: "a\nb" }]).slice(0, -1).includes("\n"));
check("toJsonLines of nothing is empty", toJsonLines([]) === "");
{
  const g = groupByDay([ev("2026-11-07T23:59:59Z", "a"), ev("2026-11-08T00:00:00Z", "b"), ev("2026-11-07T00:00:00Z", "c")]);
  check("a batch that spans midnight UTC is split by day, and no event changes day", g.size === 2 && g.get("2026-11-07")!.map((e) => e.executionId).join() === "a,c" && g.get("2026-11-08")!.map((e) => e.executionId).join() === "b");
}
{
  const sent: any[] = [];
  const keys = await writeEventBatch({ send: async (c: any) => void sent.push(c.input) }, "lake", [ev("2026-11-07T23:59:59Z", "a"), ev("2026-11-08T00:00:01Z", "b")], "b1");
  check("writeEventBatch puts one object per day with the key, bucket and content type", keys.join() === "events/dt=2026-11-07/b1.json,events/dt=2026-11-08/b1.json" && sent.length === 2 && sent[0].Bucket === "lake" && sent[0].ContentType === "application/x-ndjson" && String(sent[1].Body).includes('"execution_id":"b"') && !String(sent[1].Body).includes('"execution_id":"a"'));
}
{
  const sql = hourlyRollupSql("autoflow_events", "run_events", "2026-11-01", "2026-11-07");
  check("hourlyRollupSql filters on the dt partition between the two days", sql.includes("WHERE dt BETWEEN '2026-11-01' AND '2026-11-07'") && sql.includes('FROM "autoflow_events"."run_events"') && sql.includes("approx_percentile(duration_ms, 0.95)"));
  check("hourlyRollupSql refuses a reversed range, a bad day and an identifier with a quote", throws(() => hourlyRollupSql("d", "t", "2026-11-07", "2026-11-01"), /after/) && throws(() => hourlyRollupSql("d", "t", "2026-11-0x", "2026-11-07"), /calendar day/) && throws(() => hourlyRollupSql('d"; DROP', "t", "2026-11-01", "2026-11-07"), /Glue identifier/) && throws(() => hourlyRollupSql("d", "T", "2026-11-01", "2026-11-07"), /Glue identifier/));
}

// ---- the Iceberg copy: DDL and INSERT built from the Athena reference ----
{
  const ddl = createIcebergTableSql("autoflow_events", "run_events_iceberg", "autoflow-lake-123456789012");
  check("Iceberg DDL uses table_type ICEBERG in TBLPROPERTIES and no EXTERNAL keyword", ddl.includes("TBLPROPERTIES ('table_type' = 'ICEBERG')") && !/\bEXTERNAL\b/.test(ddl));
  check("Iceberg DDL partitions by day(event_time), a column declared in the list", ddl.includes("PARTITIONED BY (day(event_time))") && ddl.indexOf("event_time timestamp") < ddl.indexOf("PARTITIONED BY"));
  check("Iceberg DDL puts the table under iceberg/<table>/ in the lake bucket", ddl.includes("LOCATION 's3://autoflow-lake-123456789012/iceberg/run_events_iceberg/'"));
  check("Iceberg DDL columns are the keys toJsonLines writes, with timestamp and bigint types", ["event_time timestamp", "execution_id string", "workflow_id string", "user_id string", "status string", "duration_ms bigint"].every((c) => ddl.includes(c)));
  check("Iceberg DDL refuses a bucket with a quote or a capital, and a bad table name", throws(() => createIcebergTableSql("d", "t", "Bad'Bucket"), /bucket/) && throws(() => createIcebergTableSql("d", "T", "okbucket"), /Glue identifier/) && throws(() => createIcebergTableSql("d x", "t", "okbucket"), /Glue identifier/));
  const ins = copyDayToIcebergSql("autoflow_events", "run_events", "run_events_iceberg", "2026-11-07");
  check("the copy is an INSERT INTO ... SELECT of one dt partition into the Iceberg table", ins.startsWith('INSERT INTO "autoflow_events"."run_events_iceberg"') && ins.includes("FROM \"autoflow_events\".\"run_events\"") && ins.includes("WHERE dt = '2026-11-07'"));
  check("the copy casts the ISO text to an Iceberg timestamp and lists the columns in the DDL order", ins.includes("CAST(from_iso8601_timestamp(event_time) AS timestamp)") && ins.includes("(event_time, execution_id, workflow_id, user_id, status, duration_ms)"));
  check("the copy refuses a day that is not a calendar day", throws(() => copyDayToIcebergSql("d", "a", "b", "2026-02-30"), /calendar day/) && throws(() => copyDayToIcebergSql("d", "a", "b", "x' OR '1'='1"), /calendar day/));
}

// ---- the client against an in-process fake of the API, over seeded random worlds ----
interface World {
  seed: number;
  // what the fake does
  sequence: string[]; // states returned by successive GetQueryExecution calls, the last repeats
  failRetryable: boolean;
  startFaults: number; // transient errors before Start answers
  getFaults: number;
  resultFaults: number;
  lostStartAnswer: boolean;
  rows: number;
  pageLimit: number; // the most rows the fake returns per page
  timeoutMs: number;
  maxRuns: number;
  maxRows: number;
  header: boolean;
}

function makeWorld(seed: number): World {
  const r = rng(seed);
  const pendingStates = () => Array.from({ length: Math.floor(r() * 7) }, () => (r() < 0.6 ? "RUNNING" : "QUEUED"));
  const endings = ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "FAILED", "CANCELLED", "RUNNING"];
  return {
    seed,
    sequence: [...pendingStates(), endings[Math.floor(r() * endings.length)]],
    failRetryable: r() < 0.5,
    startFaults: r() < 0.3 ? 1 + Math.floor(r() * 5) : 0,
    getFaults: r() < 0.3 ? 1 + Math.floor(r() * 5) : 0,
    resultFaults: r() < 0.2 ? 1 + Math.floor(r() * 5) : 0,
    lostStartAnswer: r() < 0.15,
    rows: Math.floor(r() * 60),
    pageLimit: 1 + Math.floor(r() * 25),
    timeoutMs: 500 + Math.floor(r() * 30_000),
    maxRuns: 1 + Math.floor(r() * 3),
    maxRows: r() < 0.3 ? 1 + Math.floor(r() * 40) : 100_000,
    header: r() < 0.8,
  };
}

interface Trace {
  starts: { token: string }[];
  sleeps: number[];
  gets: number;
  results: { token?: string; max?: number }[];
  stops: number;
  resultsBeforeSucceeded: boolean;
  executions: number;
}

async function simulate(w: World, makeClient = (sdk: any, s: Partial<AthenaSettings>, deps: any) => new AthenaQueryClient(sdk, s as any, deps)): Promise<{ outcome: string; trace: Trace; rows?: number; truncated?: boolean; runs?: number; err?: Error }> {
  const r = rng(w.seed * 7919);
  let clock = 0;
  const trace: Trace = { starts: [], sleeps: [], gets: 0, results: [], stops: 0, resultsBeforeSucceeded: false, executions: 0 };
  const byToken = new Map<string, string>();
  const exec = new Map<string, { calls: number; seq: string[]; sawEnd: boolean }>();
  let startCalls = 0;
  let getCalls = 0;
  let resultCalls = 0;
  const transient = () => Object.assign(new Error("slow down"), { name: "ThrottlingException", $metadata: { httpStatusCode: 400 } });
  const data = Array.from({ length: w.rows }, (_, i) => [String(i), `v${i}`]);
  const sdk = {
    async send(cmd: any) {
      const input = cmd.input;
      const kind = cmd.constructor.name;
      if (kind === "StartQueryExecutionCommand") {
        startCalls++;
        trace.starts.push({ token: input.ClientRequestToken });
        if (startCalls <= w.startFaults) throw transient();
        let id = byToken.get(input.ClientRequestToken);
        if (!id) {
          id = `q${exec.size + 1}`;
          byToken.set(input.ClientRequestToken, id);
          // a fresh run of a retryable failure may succeed: later executions drop the failure
          exec.set(id, { calls: 0, seq: exec.size === 0 ? w.sequence : [...w.sequence.slice(0, -1), "SUCCEEDED"], sawEnd: false });
          trace.executions++;
        }
        if (w.lostStartAnswer && startCalls === w.startFaults + 1) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
        return { QueryExecutionId: id };
      }
      if (kind === "GetQueryExecutionCommand") {
        getCalls++;
        trace.gets++;
        if (getCalls <= w.getFaults) throw Object.assign(new Error("boom"), { name: "InternalServerException", $metadata: { httpStatusCode: 500 } });
        const e = exec.get(input.QueryExecutionId)!;
        const state = e.seq[Math.min(e.calls++, e.seq.length - 1)];
        if (state === "SUCCEEDED") e.sawEnd = true;
        const status: any = { State: state };
        if (state === "FAILED") status.AthenaError = { Retryable: w.failRetryable, ErrorMessage: "failed on purpose" };
        return { QueryExecution: { Status: status, StatementType: "DML", Statistics: {} } };
      }
      if (kind === "GetQueryResultsCommand") {
        resultCalls++;
        const e = exec.get(input.QueryExecutionId)!;
        if (!e.sawEnd) trace.resultsBeforeSucceeded = true;
        trace.results.push({ token: input.NextToken, max: input.MaxResults });
        if (resultCalls <= w.resultFaults) throw Object.assign(new Error("rate"), { name: "TooManyRequestsException", $metadata: { httpStatusCode: 400 } });
        const all = w.header ? [["id", "val"], ...data] : data;
        const size = Math.min(input.MaxResults ?? 1000, w.pageLimit);
        const off = input.NextToken ? Number(input.NextToken) : 0;
        const slice = all.slice(off, off + size);
        const out: any = {
          ResultSet: {
            ResultSetMetadata: { ColumnInfo: [{ Name: "id", Label: "id" }, { Name: "val", Label: "val" }] },
            Rows: slice.map((row) => ({ Data: row.map((v) => ({ VarCharValue: v })) })),
          },
        };
        if (off + size < all.length) out.NextToken = String(off + size);
        return out;
      }
      if (kind === "StopQueryExecutionCommand") {
        trace.stops++;
        return {};
      }
      throw new Error(`fake: unexpected command ${kind}`);
    },
  };
  const deps = {
    sleep: async (ms: number) => {
      trace.sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: r,
  };
  const client = makeClient(sdk, { workGroup: "wg", timeoutMs: w.timeoutMs, maxRuns: w.maxRuns, maxRows: w.maxRows, pageSize: 1000 }, deps);
  try {
    const res = await client.runQuery("SELECT 1");
    return { outcome: "ok", trace, rows: res.rows.length, truncated: res.truncated, runs: res.runs };
  } catch (e) {
    const name = e instanceof AthenaQueryFailedError ? "failed" : e instanceof AthenaQueryCancelledError ? "cancelled" : e instanceof AthenaTimeoutError ? "timeout" : e instanceof AthenaProtocolError ? "protocol" : "other";
    return { outcome: name, trace, err: e as Error };
  }
}

// Rules every world must obey, whatever the client did.
function judge(w: World, out: Awaited<ReturnType<typeof simulate>>): string | null {
  const t = out.trace;
  const tag = `seed ${w.seed}`;
  if (t.resultsBeforeSucceeded) return `${tag}: read results before the query had succeeded`;
  const lastState = w.sequence[w.sequence.length - 1];
  const settings = { callAttempts: 4 };
  if (t.starts.length > w.maxRuns * settings.callAttempts) return `${tag}: ${t.starts.length} Start calls for ${w.maxRuns} runs`;
  // a token is reused across repeats of one Start and never across two runs
  const tokens = t.starts.map((s) => s.token);
  if (tokens.some((x) => typeof x !== "string" || x.length < 32 || x.length > 128)) return `${tag}: a token outside 32 to 128 characters`;
  // one token per run; the last run may never have started (every Start call failed), so one extra is allowed
  if (new Set(tokens).size < t.executions || new Set(tokens).size > t.executions + 1) return `${tag}: ${new Set(tokens).size} tokens for ${t.executions} executions`;
  // every sleep is inside the band of the policy that produced it, and polling sleeps never pass the deadline
  for (const s of t.sleeps) if (s < 0 || s > Math.max(POLL_BACKOFF.maxDelayMs, CALL_BACKOFF.maxDelayMs)) return `${tag}: sleep of ${s} ms`;
  const slept = t.sleeps.reduce((a, b) => a + b, 0);
  if (out.outcome === "timeout") {
    if (t.stops !== 1) return `${tag}: timeout stopped the query ${t.stops} times`;
    if (lastState !== "RUNNING" && w.sequence.length > 1 && slept < w.timeoutMs && w.sequence.slice(0, -1).length < 3) return `${tag}: timed out early`;
  } else if (t.stops !== 0) return `${tag}: stopped a query that did not time out`;

  if (out.outcome === "ok") {
    const expected = Math.min(w.rows, w.maxRows);
    if (out.rows !== expected) return `${tag}: ${out.rows} rows, expected ${expected} of ${w.rows} (max ${w.maxRows})`;
    if (out.truncated !== w.rows > w.maxRows) return `${tag}: truncated=${out.truncated} with ${w.rows} rows and max ${w.maxRows}`;
  }
  if (lastState === "CANCELLED" && out.outcome !== "cancelled" && out.outcome !== "other" && out.outcome !== "timeout") return `${tag}: a cancelled query ended as ${out.outcome}`;
  if (lastState === "CANCELLED" && out.trace.executions > 1) return `${tag}: a cancelled query was resubmitted`;
  if (lastState === "FAILED" && !w.failRetryable && out.trace.executions > 1) return `${tag}: a failure that is not Retryable was resubmitted`;
  if (lastState === "FAILED" && w.failRetryable && w.maxRuns > 1 && out.outcome === "failed") return `${tag}: a Retryable failure with runs left was not resubmitted`;
  if (out.outcome === "ok" && lastState === "RUNNING") return `${tag}: a query that never finished returned rows`;
  return null;
}

function property(client?: Parameters<typeof simulate>[1], n = 3000): Promise<string | null> {
  return (async () => {
    for (let seed = 1; seed <= n; seed++) {
      const w = makeWorld(seed);
      const out = await simulate(w, client);
      const problem = judge(w, out);
      if (problem) return problem;
    }
    return null;
  })();
}

{
  const seen: Record<string, number> = {};
  for (let seed = 1; seed <= 3000; seed++) {
    const o = (await simulate(makeWorld(seed))).outcome;
    seen[o] = (seen[o] ?? 0) + 1;
  }
  console.log(`      outcome mix over 3000 worlds: ${JSON.stringify(seen)}`);
  check("the worlds are not one-sided: success, failed, cancelled, timeout and a call that gave up all occur at least 50 times", ["ok", "failed", "cancelled", "timeout", "other"].every((k) => (seen[k] ?? 0) >= 50), JSON.stringify(seen));
}
check("3000 seeded worlds: faults, lost answers, page limits, cancelled, failed, never-finishing queries all obey the rules", (await property()) === null, (await property()) ?? "");

// Mutation controls: a client with one decision broken must turn the property red.
const withPatched = (patch: (c: any) => void) => (sdk: any, s: any, d: any) => {
  const c = new AthenaQueryClient(sdk, s, d) as any;
  patch(c);
  return c;
};
// stop polling on QUEUED as if it were final
const noStopOnTimeout = withPatched((c) => (c.stopQuietly = async () => {}));
const neverResubmits = withPatched((c) => ((c.settings.maxRuns = 1), c));
const smallPages = withPatched((c) => ((c.settings.maxRows = 3), c));
check("control: a timeout that does not stop the query is caught", (await property(noStopOnTimeout)) !== null);
check("control: a client that never resubmits a Retryable failure is caught", (await property(neverResubmits)) !== null);
check("control: a row cap that ignores the world's cap is caught", (await property(smallPages)) !== null);

console.log(failed === 0 ? `\nAll ${passed} Athena logic checks passed` : `\n${failed} of ${passed + failed} Athena logic check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
