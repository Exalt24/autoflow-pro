// Input rules for the GraphQL API, written with zod. GraphQL's own types say a field is a String; these say what string.
import { z } from "zod";
import type { StepType } from "../types/database.js";
import { MAX_STEPS } from "../temporal/types.js";

export const STEP_TYPES = [
  "navigate", "click", "fill", "extract", "wait", "screenshot", "scroll", "hover", "press_key", "execute_js",
  "conditional", "loop", "set_variable", "extract_to_variable", "download_file", "drag_drop", "set_cookie", "get_cookie",
  "set_localstorage", "get_localstorage", "select_dropdown", "right_click", "double_click",
] as const satisfies readonly StepType[];

// Fails to compile if a step type is added to the app and not to this list.
type MissingStepTypes = Exclude<StepType, (typeof STEP_TYPES)[number]>;
export const allStepTypesListed: [MissingStepTypes] extends [never] ? true : never = true;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "must be 1 to 128 letters, digits, _ or -");

// GraphQL ID values arrive as strings. Step ids are chosen by the client; they only need to be unique within a workflow.
export const createWorkflowInput = z.object({
  name: z.string().trim().min(1, "must not be empty").max(100, "must be at most 100 characters"),
  description: z.string().trim().max(1000, "must be at most 1000 characters").nullish(),
  steps: z
    .array(z.object({ id, type: z.enum(STEP_TYPES, { error: `must be one of the ${STEP_TYPES.length} step types` }) }))
    .min(1, "a workflow needs at least one step")
    .max(MAX_STEPS, `a workflow has at most ${MAX_STEPS} steps`)
    .refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, "step ids must be unique"),
});

export const startRunInput = z.object({
  workflowId: id,
  stepTimeoutMs: z.number().int("must be a whole number").min(100, "must be at least 100").max(3_600_000, "must be at most 3600000").nullish(),
});

export const idArg = id;

export const pageArgs = z.object({
  first: z.number().int("must be a whole number").min(1, "must be at least 1").max(100, "must be at most 100").default(20),
  after: z.string().max(200, "is not a valid cursor").nullish(),
});

export interface Issue {
  path: string;
  message: string;
}

export function issuesOf(error: z.ZodError, prefix: string): Issue[] {
  return error.issues.map((i) => ({ path: [prefix, ...i.path].filter((p) => p !== "").join("."), message: i.message }));
}
