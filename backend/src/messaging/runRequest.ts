import { PermanentError } from "./retryPolicy.js";

export interface RunRequest {
  workflowId: string;
  executionId: string;
  userId: string;
  definition: unknown;
}

const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);

/** Anything wrong with the payload is permanent: sending the same bytes again cannot fix it. */
export function validateRunRequest(payload: unknown): RunRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PermanentError("payload is not an object");
  }
  const p = payload as Record<string, unknown>;
  if (!isId(p.workflowId) || !isId(p.executionId) || !isId(p.userId)) {
    throw new PermanentError("workflowId, executionId and userId must be short ids");
  }
  if (p.definition === null || typeof p.definition !== "object") {
    throw new PermanentError("definition must be an object");
  }
  return { workflowId: p.workflowId, executionId: p.executionId, userId: p.userId, definition: p.definition };
}
