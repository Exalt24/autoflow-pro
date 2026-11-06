// Pure decision logic for the RabbitMQ consumer: no broker, no clock, no I/O.
// Everything here is unit-tested without a broker (tests/test-rabbitmq-logic.ts).

export interface RetryPolicy {
  /** One entry per retry. [5000, 30000] means a message is tried 3 times: first try, retry after 5 s, retry after 30 s. */
  delaysMs: number[];
}

/** Throw this from a handler when trying again cannot help (bad payload, unknown workflow). The message goes straight to the dead-letter queue. */
export class PermanentError extends Error {
  override name = "PermanentError";
}

export type FailureDecision =
  | { action: "retry"; delayMs: number; nextAttempt: number }
  | { action: "dead"; reason: string };

export const ATTEMPT_HEADER = "x-attempt";
export const DEAD_REASON_HEADER = "x-dead-reason";
export const DEAD_ERROR_HEADER = "x-dead-error";

export function maxAttempts(policy: RetryPolicy): number {
  return policy.delaysMs.length + 1;
}

/** `attempt` is 1 for the first delivery. */
export function decideOnFailure(attempt: number, error: unknown, policy: RetryPolicy): FailureDecision {
  if (error instanceof PermanentError) {
    return { action: "dead", reason: "permanent-error" };
  }
  const delay = policy.delaysMs[attempt - 1];
  if (delay === undefined) {
    return { action: "dead", reason: "retries-exhausted" };
  }
  return { action: "retry", delayMs: delay, nextAttempt: attempt + 1 };
}

/** Reads the attempt counter from message headers. Missing, negative, fractional or non-numeric values count as attempt 1. */
export function readAttempt(headers: Record<string, unknown> | undefined): number {
  const raw = headers?.[ATTEMPT_HEADER];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 1000) return 1;
  return n;
}

export type Envelope = { ok: true; payload: unknown } | { ok: false; reason: string };

/** A body that is not valid JSON can never succeed, so it is a poison message. */
export function parseEnvelope(content: Buffer): Envelope {
  if (content.length === 0) return { ok: false, reason: "empty-body" };
  try {
    return { ok: true, payload: JSON.parse(content.toString("utf8")) };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}

export function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 500);
}

export function uniqueDelays(policy: RetryPolicy): number[] {
  return [...new Set(policy.delaysMs)].sort((a, b) => a - b);
}
