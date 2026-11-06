// Decisions the Athena client makes, kept free of I/O so they can be tested (and broken on purpose) without a server.
// Written from the Athena API reference: QueryExecutionStatus (states), AthenaError (Retryable), GetQueryResults
// (MaxResults 1 to 1000, NextToken) and the common error list.

export type StateKind = "pending" | "succeeded" | "failed" | "cancelled" | "unknown";

// QUEUED and RUNNING are both "not finished". The reference says a query can move from RUNNING back to QUEUED after
// a transient error, so the state is never treated as one-way. FAILED is always terminal.
export function classifyState(state: string | undefined): StateKind {
  switch (state) {
    case "QUEUED":
    case "RUNNING":
      return "pending";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}

export interface BackoffPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  // 0 means no jitter. 0.25 means the wait is somewhere between 75 and 100 percent of the exponential value.
  jitter: number;
}

export const POLL_BACKOFF: BackoffPolicy = { initialDelayMs: 250, maxDelayMs: 5000, factor: 2, jitter: 0.25 };
export const CALL_BACKOFF: BackoffPolicy = { initialDelayMs: 200, maxDelayMs: 4000, factor: 2, jitter: 0.25 };

// step 0 waits about initialDelayMs, each later step waits factor times longer, never more than maxDelayMs.
export function backoffDelayMs(step: number, p: BackoffPolicy, random: () => number): number {
  const exp = Math.min(p.maxDelayMs, p.initialDelayMs * Math.pow(p.factor, Math.max(0, step)));
  const r = Math.min(1, Math.max(0, random()));
  return Math.round(exp * (1 - p.jitter * r));
}

const TRANSIENT_NAMES = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "InternalServerException",
  "ServiceUnavailable",
  "RequestTimeoutException",
]);
const TRANSIENT_NETWORK = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

// A failed API call that is worth repeating: throttling, a platform fault, a timeout, a dropped connection.
// InvalidRequestException (a bad query string, a missing workgroup) and the credential errors are not.
export function isTransientError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!e || typeof e !== "object") return false;
  if (e.name && TRANSIENT_NAMES.has(e.name)) return true;
  if (e.code && TRANSIENT_NETWORK.has(e.code)) return true;
  const status = e.$metadata?.httpStatusCode;
  return typeof status === "number" && status >= 500;
}

export type FailureDecision = { action: "resubmit" } | { action: "fail" };

// AthenaError.Retryable is "true if the query might succeed if resubmitted". The client resubmits only then, and only
// while it has runs left. maxRuns counts the first run, so maxRuns 2 means one resubmit.
export function decideAfterFailure(retryable: boolean | undefined, runsUsed: number, maxRuns: number): FailureDecision {
  return retryable === true && runsUsed < maxRuns ? { action: "resubmit" } : { action: "fail" };
}

export const MAX_PAGE_SIZE = 1000;

export function validatePageSize(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) {
    throw new RangeError(`pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}, got ${n}`);
  }
  return n;
}

// For a SELECT, Athena returns the column names as the first row of the first page. Skip it only for a DML statement,
// only on the first page, and only when the row really is the column labels, so a table whose first data row
// happens to look like text is never eaten and a statement without a header row loses nothing.
export function shouldSkipHeader(statementType: string | undefined, firstPage: boolean, firstRow: (string | null)[] | undefined, labels: string[]): boolean {
  if (!firstPage || statementType !== "DML" || !firstRow) return false;
  return firstRow.length === labels.length && firstRow.every((v, i) => v === labels[i]);
}

export type Cell = string | null;

export function toRecords(labels: string[], rows: Cell[][]): Record<string, Cell>[] {
  return rows.map((r) => {
    const o: Record<string, Cell> = {};
    labels.forEach((l, i) => {
      o[l] = r[i] ?? null;
    });
    return o;
  });
}

// What to do with the NextToken of a page.
export type PageDecision = { action: "done" } | { action: "next"; token: string } | { action: "stuck" };

export function decideNextPage(nextToken: string | undefined, previousToken: string | undefined, rowsSoFar: number, maxRows: number): PageDecision {
  if (!nextToken) return { action: "done" };
  if (rowsSoFar >= maxRows) return { action: "done" };
  if (nextToken === previousToken) return { action: "stuck" };
  return { action: "next", token: nextToken };
}
