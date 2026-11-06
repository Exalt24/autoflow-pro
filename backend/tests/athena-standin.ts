// LIFESPAN: permanent
// A stand-in for the Athena API, written from the Athena API reference (StartQueryExecution, GetQueryExecution,
// GetQueryResults, StopQueryExecution, QueryExecutionStatus, AthenaError and the common error list).
// It is NOT AWS: it exists so the client in src/athena can be driven over real HTTP with the real AWS SDK.
// Request and response bodies follow the reference. The envelope (HTTP POST, X-Amz-Target AmazonAthena.<Action>,
// application/x-amz-json-1.1) is what the SDK sends, and the stand-in checks that it arrives that way.
// It enforces the documented limits, so a client that breaks them is refused the way the service would refuse it.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Scenario {
  // States returned by successive GetQueryExecution calls. The last one repeats.
  states: string[];
  statementType?: "DML" | "DDL" | "UTILITY";
  columns?: string[];
  rows?: (string | null)[][];
  // Include the column names as the first row of the first page, as Athena does for a SELECT.
  headerRow?: boolean;
  failure?: { message: string; retryable: boolean; category?: number; type?: number };
  cancelReason?: string;
  // Faults, counted per action across the whole run.
  throttleStart?: number; // the first N StartQueryExecution calls answer ThrottlingException (HTTP 400)
  serverErrorGet?: number; // the first N GetQueryExecution calls answer InternalServerException (HTTP 500)
  tooManyResults?: number; // the first N GetQueryResults calls answer TooManyRequestsException (HTTP 400)
  dropFirstStartResponse?: boolean; // the first StartQueryExecution is executed, then the connection is cut
  repeatNextToken?: boolean; // GetQueryResults hands back the token it was given
}

interface Execution {
  id: string;
  token?: string;
  sql: string;
  workGroup?: string;
  scenario: Scenario;
  getCalls: number;
  stopped: boolean;
}

export interface LoggedCall {
  action: string;
  body: any;
}

export interface StandIn {
  url: string;
  calls: LoggedCall[];
  executions: Execution[];
  close(): Promise<void>;
}

function err(res: ServerResponse, status: number, type: string, message: string, extra: Record<string, unknown> = {}) {
  res.writeHead(status, { "content-type": "application/x-amz-json-1.1", "x-amzn-errortype": type });
  res.end(JSON.stringify({ __type: type, message, ...extra }));
}

export async function startStandIn(pick: (sql: string, workGroup: string | undefined, nth: number) => Scenario): Promise<StandIn> {
  const calls: LoggedCall[] = [];
  const executions: Execution[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  let next = 0;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const target = String(req.headers["x-amz-target"] ?? "");
      const ct = String(req.headers["content-type"] ?? "");
      if (req.method !== "POST" || !target.startsWith("AmazonAthena.") || !ct.startsWith("application/x-amz-json-1.1")) {
        return err(res, 404, "UnknownOperationException", `unrecognised request ${req.method} ${target} ${ct}`);
      }
      const action = target.slice("AmazonAthena.".length);
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return err(res, 400, "SerializationException", "body is not JSON");
      }
      calls.push({ action, body });

      if (action === "StartQueryExecution") return start(body, res);
      if (action === "GetQueryExecution") return getExecution(body, res);
      if (action === "GetQueryResults") return getResults(body, res);
      if (action === "StopQueryExecution") return stop(body, res);
      return err(res, 404, "UnknownOperationException", `unsupported action ${action}`);
    });
  });

  function find(id: unknown): Execution | undefined {
    return typeof id === "string" ? executions.find((e) => e.id === id) : undefined;
  }

  function badId(res: ServerResponse, id: unknown): boolean {
    if (typeof id !== "string" || id.length < 1 || id.length > 128 || /\s/.test(id)) {
      err(res, 400, "InvalidRequestException", "QueryExecutionId must be 1 to 128 characters with no whitespace", { AthenaErrorCode: "INVALID_INPUT" });
      return true;
    }
    return false;
  }

  function start(body: any, res: ServerResponse) {
    const n = bump("start");
    const q = body.QueryString;
    if (typeof q !== "string" || q.length < 1 || q.length > 262144) {
      return err(res, 400, "InvalidRequestException", "QueryString must be 1 to 262144 characters", { AthenaErrorCode: "INVALID_INPUT" });
    }
    const t = body.ClientRequestToken;
    if (t !== undefined && (typeof t !== "string" || t.length < 32 || t.length > 128)) {
      return err(res, 400, "InvalidRequestException", "ClientRequestToken must be 32 to 128 characters", { AthenaErrorCode: "INVALID_INPUT" });
    }
    const wg = body.WorkGroup;
    if (wg !== undefined && !/^[a-zA-Z0-9._-]{1,128}$/.test(wg)) {
      return err(res, 400, "InvalidRequestException", "WorkGroup must match [a-zA-Z0-9._-]{1,128}", { AthenaErrorCode: "INVALID_INPUT" });
    }
    const scenario = pick(q, wg, executions.length);
    if (scenario.throttleStart && n <= scenario.throttleStart) {
      return err(res, 400, "ThrottlingException", "Your request rate is too high.");
    }
    if (t) {
      const same = executions.find((e) => e.token === t);
      if (same) {
        if (same.sql !== q) return err(res, 400, "InvalidRequestException", "ClientRequestToken was used with a different QueryString", { AthenaErrorCode: "INVALID_INPUT" });
        return void res.writeHead(200, { "content-type": "application/x-amz-json-1.1" }).end(JSON.stringify({ QueryExecutionId: same.id }));
      }
    }
    const ex: Execution = { id: `qe-${String(++next).padStart(4, "0")}-0000-0000-0000-000000000000`, token: t, sql: q, workGroup: wg, scenario, getCalls: 0, stopped: false };
    executions.push(ex);
    if (scenario.dropFirstStartResponse && n === 1) {
      res.socket?.destroy();
      return;
    }
    res.writeHead(200, { "content-type": "application/x-amz-json-1.1" }).end(JSON.stringify({ QueryExecutionId: ex.id }));
  }

  function getExecution(body: any, res: ServerResponse) {
    const n = bump("get");
    if (badId(res, body.QueryExecutionId)) return;
    const ex = find(body.QueryExecutionId);
    if (!ex) return err(res, 400, "InvalidRequestException", `QueryExecution ${body.QueryExecutionId} was not found`, { AthenaErrorCode: "INVALID_INPUT" });
    if (ex.scenario.serverErrorGet && n <= ex.scenario.serverErrorGet) return err(res, 500, "InternalServerException", "internal error");
    const i = Math.min(ex.getCalls++, ex.scenario.states.length - 1);
    const state = ex.stopped ? "CANCELLED" : ex.scenario.states[i];
    const status: any = { State: state, SubmissionDateTime: 1_800_000_000 };
    if (state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED") status.CompletionDateTime = 1_800_000_001;
    if (state === "FAILED" && ex.scenario.failure) {
      const f = ex.scenario.failure;
      status.StateChangeReason = f.message;
      status.AthenaError = { ErrorCategory: f.category ?? 2, ErrorType: f.type ?? 1, Retryable: f.retryable, ErrorMessage: f.message };
    }
    if (state === "CANCELLED") status.StateChangeReason = ex.scenario.cancelReason ?? "Query cancelled by user";
    const qe: any = {
      QueryExecutionId: ex.id,
      Query: ex.sql,
      StatementType: ex.scenario.statementType ?? "DML",
      WorkGroup: ex.workGroup ?? "primary",
      Status: status,
      Statistics: { DataScannedInBytes: 2048, TotalExecutionTimeInMillis: 420 },
    };
    res.writeHead(200, { "content-type": "application/x-amz-json-1.1" }).end(JSON.stringify({ QueryExecution: qe }));
  }

  function getResults(body: any, res: ServerResponse) {
    const n = bump("results");
    if (badId(res, body.QueryExecutionId)) return;
    const ex = find(body.QueryExecutionId);
    if (!ex) return err(res, 400, "InvalidRequestException", "QueryExecution was not found", { AthenaErrorCode: "INVALID_INPUT" });
    const max = body.MaxResults;
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 1000)) {
      return err(res, 400, "InvalidRequestException", "MaxResults must be 1 to 1000", { AthenaErrorCode: "INVALID_INPUT" });
    }
    const tok = body.NextToken;
    if (tok !== undefined && (typeof tok !== "string" || tok.length < 1 || tok.length > 1024)) {
      return err(res, 400, "InvalidRequestException", "NextToken must be 1 to 1024 characters", { AthenaErrorCode: "INVALID_INPUT" });
    }
    const last = ex.scenario.states[ex.scenario.states.length - 1];
    if (ex.getCalls === 0 || last !== "SUCCEEDED" || ex.getCalls < ex.scenario.states.length) {
      return err(res, 400, "InvalidRequestException", "Query has not yet finished. Current state: RUNNING", { AthenaErrorCode: "INVALID_INPUT" });
    }
    if (ex.scenario.tooManyResults && n <= ex.scenario.tooManyResults) return err(res, 400, "TooManyRequestsException", "Rate exceeded");

    const columns = ex.scenario.columns ?? [];
    const data = ex.scenario.rows ?? [];
    const all: (string | null)[][] = ex.scenario.headerRow ? [columns, ...data] : data;
    const size = max ?? 1000;
    const offset = tok ? Number(tok.replace(/^page-/, "")) : 0;
    if (tok && (!/^page-\d+$/.test(tok) || offset > all.length)) {
      return err(res, 400, "InvalidRequestException", "NextToken is not valid", { AthenaErrorCode: "INVALID_INPUT" });
    }
    const slice = all.slice(offset, offset + size);
    const more = offset + size < all.length;
    const out: any = {
      ResultSet: {
        ResultSetMetadata: { ColumnInfo: columns.map((c) => ({ Name: c, Label: c, Type: "varchar", Nullable: "UNKNOWN", CaseSensitive: true })) },
        Rows: slice.map((r) => ({ Data: r.map((v) => (v === null ? {} : { VarCharValue: v })) })),
      },
    };
    if (more) out.NextToken = ex.scenario.repeatNextToken && tok ? tok : `page-${offset + size}`;
    res.writeHead(200, { "content-type": "application/x-amz-json-1.1" }).end(JSON.stringify(out));
  }

  function stop(body: any, res: ServerResponse) {
    if (badId(res, body.QueryExecutionId)) return;
    const ex = find(body.QueryExecutionId);
    if (!ex) return err(res, 400, "InvalidRequestException", "QueryExecution was not found", { AthenaErrorCode: "INVALID_INPUT" });
    ex.stopped = true;
    res.writeHead(200, { "content-type": "application/x-amz-json-1.1" }).end("{}");
  }

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    executions,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
