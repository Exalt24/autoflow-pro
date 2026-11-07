import { DEFAULT_STEP_TIMEOUT_MS, MAX_STEPS, type RunInput } from "./types.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Returns the first problem with a run input, or null when it is fine. Pure, so it is tested without Temporal. */
export function findRunInputProblem(input: unknown): string | null {
  if (!input || typeof input !== "object") return "input is not an object";
  const i = input as Partial<RunInput>;
  for (const key of ["runId", "workflowId", "userId"] as const) {
    if (typeof i[key] !== "string" || !ID.test(i[key] as string)) return `${key} must be 1 to 128 letters, digits, _ or -`;
  }
  if (!Array.isArray(i.steps) || i.steps.length === 0) return "a run needs at least one step";
  if (i.steps.length > MAX_STEPS) return `a run has at most ${MAX_STEPS} steps`;
  const seen = new Set<string>();
  for (const [n, s] of i.steps.entries()) {
    if (!s || typeof s !== "object") return `step ${n + 1} is not an object`;
    if (typeof s.id !== "string" || !ID.test(s.id)) return `step ${n + 1} has no valid id`;
    if (typeof s.type !== "string" || s.type.length === 0 || s.type.length > 64) return `step ${n + 1} has no type`;
    if (seen.has(s.id)) return `step id ${s.id} is used twice`;
    seen.add(s.id);
  }
  if (i.stepTimeoutMs !== undefined) {
    if (!Number.isInteger(i.stepTimeoutMs) || i.stepTimeoutMs < 100 || i.stepTimeoutMs > 3_600_000) {
      return "stepTimeoutMs must be a whole number from 100 to 3600000";
    }
  }
  return null;
}

export const stepTimeoutOf = (input: RunInput): number => input.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
