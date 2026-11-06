import { randomUUID } from "node:crypto";
import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
  type AthenaClientConfig,
} from "@aws-sdk/client-athena";
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
  type BackoffPolicy,
  type Cell,
} from "./policy.js";

// Runs one SQL statement on Athena and returns its rows: StartQueryExecution, then GetQueryExecution until the
// query is finished, then GetQueryResults page by page. Written from the Athena API reference.

export class AthenaQueryFailedError extends Error {
  constructor(
    message: string,
    readonly queryExecutionId: string,
    readonly retryable: boolean,
    readonly errorCategory?: number,
    readonly errorType?: number,
  ) {
    super(message);
    this.name = "AthenaQueryFailedError";
  }
}

export class AthenaQueryCancelledError extends Error {
  constructor(message: string, readonly queryExecutionId: string) {
    super(message);
    this.name = "AthenaQueryCancelledError";
  }
}

export class AthenaTimeoutError extends Error {
  constructor(message: string, readonly queryExecutionId: string) {
    super(message);
    this.name = "AthenaTimeoutError";
  }
}

// Athena answered with something the API reference does not describe (a state it does not list, a page token that
// never advances). Not worth retrying.
export class AthenaProtocolError extends Error {
  constructor(message: string, readonly queryExecutionId?: string) {
    super(message);
    this.name = "AthenaProtocolError";
  }
}

export interface AthenaSdk {
  send(command: unknown): Promise<any>;
}

export interface AthenaDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

const realDeps: AthenaDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  random: Math.random,
};

export interface AthenaSettings {
  workGroup: string;
  database?: string;
  catalog?: string;
  // Needed only when the workgroup does not enforce its own result location.
  outputLocation?: string;
  // How long to wait for the query to finish, then stop it.
  timeoutMs: number;
  // Rows per GetQueryResults page, 1 to 1000.
  pageSize: number;
  // Stop reading pages after this many rows (the result then says truncated).
  maxRows: number;
  // Total runs of one statement. 2 means a failed run that Athena marks Retryable is submitted once more.
  maxRuns: number;
  // Tries for one API call that fails with a transient error.
  maxCallAttempts: number;
  poll: BackoffPolicy;
  callBackoff: BackoffPolicy;
}

export const DEFAULT_SETTINGS: Omit<AthenaSettings, "workGroup"> = {
  timeoutMs: 120_000,
  pageSize: 1000,
  maxRows: 100_000,
  maxRuns: 2,
  maxCallAttempts: 4,
  poll: POLL_BACKOFF,
  callBackoff: CALL_BACKOFF,
};

export interface AthenaResult {
  queryExecutionId: string;
  columns: string[];
  rows: Record<string, Cell>[];
  truncated: boolean;
  runs: number;
  dataScannedBytes?: number;
  totalExecutionMs?: number;
}

// maxAttempts 1: the SDK's own retry is switched off so every retry decision is made (and tested) in policy.ts.
export function createAthenaClient(config: AthenaClientConfig = {}): AthenaClient {
  return new AthenaClient({ maxAttempts: 1, ...config });
}

export class AthenaQueryClient {
  private readonly settings: AthenaSettings;
  private readonly deps: AthenaDeps;

  constructor(
    private readonly sdk: AthenaSdk,
    settings: Pick<AthenaSettings, "workGroup"> & Partial<AthenaSettings>,
    deps: Partial<AthenaDeps> = {},
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.settings.pageSize = validatePageSize(this.settings.pageSize);
    this.deps = { ...realDeps, ...deps };
  }

  async runQuery(sql: string): Promise<AthenaResult> {
    if (!sql.trim()) throw new RangeError("the query string is empty");
    for (let run = 1; ; run++) {
      try {
        const result = await this.runOnce(sql);
        return { ...result, runs: run };
      } catch (e) {
        if (!(e instanceof AthenaQueryFailedError)) throw e;
        const decision = decideAfterFailure(e.retryable, run, this.settings.maxRuns);
        if (decision.action === "fail") throw e;
        // The next run gets a fresh client request token (runOnce makes one): the old token would hand back the failed run.
      }
    }
  }

  private async call<T>(make: () => unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return (await this.sdk.send(make())) as T;
      } catch (e) {
        if (!isTransientError(e) || attempt >= this.settings.maxCallAttempts) throw e;
        await this.deps.sleep(backoffDelayMs(attempt - 1, this.settings.callBackoff, this.deps.random));
      }
    }
  }

  private async runOnce(sql: string): Promise<Omit<AthenaResult, "runs">> {
    const s = this.settings;
    // One token per run, reused when StartQueryExecution is repeated after a lost answer, so the repeat returns the
    // same execution instead of starting a second query.
    const token = randomUUID();
    const started = await this.call<{ QueryExecutionId?: string }>(
      () =>
        new StartQueryExecutionCommand({
          QueryString: sql,
          ClientRequestToken: token,
          WorkGroup: s.workGroup,
          ...(s.database || s.catalog ? { QueryExecutionContext: { ...(s.database ? { Database: s.database } : {}), ...(s.catalog ? { Catalog: s.catalog } : {}) } } : {}),
          ...(s.outputLocation ? { ResultConfiguration: { OutputLocation: s.outputLocation } } : {}),
        }),
    );
    const id = started.QueryExecutionId;
    if (!id) throw new AthenaProtocolError("StartQueryExecution returned no QueryExecutionId");

    const deadline = this.deps.now() + s.timeoutMs;
    for (let poll = 0; ; poll++) {
      const got = await this.call<{ QueryExecution?: any }>(() => new GetQueryExecutionCommand({ QueryExecutionId: id }));
      const qe = got.QueryExecution;
      const status = qe?.Status;
      const kind = classifyState(status?.State);

      if (kind === "succeeded") {
        const pages = await this.readResults(id, qe?.StatementType);
        return {
          queryExecutionId: id,
          ...pages,
          dataScannedBytes: qe?.Statistics?.DataScannedInBytes,
          totalExecutionMs: qe?.Statistics?.TotalExecutionTimeInMillis,
        };
      }
      if (kind === "failed") {
        const ae = status?.AthenaError;
        throw new AthenaQueryFailedError(
          ae?.ErrorMessage ?? status?.StateChangeReason ?? "the query failed",
          id,
          ae?.Retryable === true,
          ae?.ErrorCategory,
          ae?.ErrorType,
        );
      }
      if (kind === "cancelled") {
        throw new AthenaQueryCancelledError(status?.StateChangeReason ?? "the query was cancelled", id);
      }
      if (kind === "unknown") {
        throw new AthenaProtocolError(`unexpected query state "${String(status?.State)}"`, id);
      }

      // Pending (QUEUED or RUNNING). The deadline is checked after the state read, so a query that finished just in
      // time is still returned.
      const remaining = deadline - this.deps.now();
      if (remaining <= 0) {
        await this.stopQuietly(id);
        throw new AthenaTimeoutError(`the query did not finish within ${s.timeoutMs} ms and was stopped`, id);
      }
      await this.deps.sleep(Math.min(backoffDelayMs(poll, s.poll, this.deps.random), remaining));
    }
  }

  private async stopQuietly(id: string): Promise<void> {
    try {
      await this.sdk.send(new StopQueryExecutionCommand({ QueryExecutionId: id }));
    } catch {
      // The query may have finished in the meantime. The caller gets the timeout either way.
    }
  }

  private async readResults(id: string, statementType: string | undefined): Promise<Pick<AthenaResult, "columns" | "rows" | "truncated">> {
    const s = this.settings;
    let columns: string[] = [];
    const cells: Cell[][] = [];
    let token: string | undefined;
    let truncated = false;

    for (let page = 0; ; page++) {
      const res = await this.call<{ NextToken?: string; ResultSet?: any }>(
        () => new GetQueryResultsCommand({ QueryExecutionId: id, MaxResults: s.pageSize, ...(token ? { NextToken: token } : {}) }),
      );
      const set = res.ResultSet;
      if (page === 0) columns = (set?.ResultSetMetadata?.ColumnInfo ?? []).map((c: any) => String(c.Label ?? c.Name));
      let rows: Cell[][] = (set?.Rows ?? []).map((r: any) => (r.Data ?? []).map((d: any) => d?.VarCharValue ?? null));
      if (shouldSkipHeader(statementType, page === 0, rows[0], columns)) rows = rows.slice(1);
      cells.push(...rows);

      const next = decideNextPage(res.NextToken, token, cells.length, s.maxRows);
      if (next.action === "done") {
        truncated = !!res.NextToken && cells.length >= s.maxRows;
        break;
      }
      if (next.action === "stuck") throw new AthenaProtocolError("GetQueryResults returned the same NextToken twice", id);
      token = next.token;
    }

    const kept = cells.slice(0, s.maxRows);
    return { columns, rows: toRecords(columns, kept), truncated: truncated || cells.length > s.maxRows };
  }
}
