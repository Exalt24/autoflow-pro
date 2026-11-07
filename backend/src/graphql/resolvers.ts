// Resolvers, typed by the generated Resolvers type (src/graphql/generated/types.ts, made by graphql-codegen).
// Rules: a mutation never throws for something a client did wrong, it returns a typed error from a union
// (ValidationError, NotFoundError, ConflictError, UnavailableError). A query throws a GraphQLError with
// extensions.code = BAD_USER_INPUT for a bad argument. Anything else is a bug and Yoga masks it as "Unexpected error."
import { GraphQLError } from "graphql";
import type { Resolvers } from "./generated/types.js";
import { createWorkflowInput, idArg, issuesOf, pageArgs, startRunInput, type Issue } from "./inputs.js";
import { TERMINAL_STATES, type RunModel } from "./store.js";

export function encodeRunCursor(seq: number): string {
  return Buffer.from(`run:${seq}`).toString("base64url");
}

/** Returns the position a cursor stands for, or null when the text is not a cursor this API made. */
export function decodeRunCursor(cursor: string): number | null {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const m = /^run:([1-9][0-9]{0,15})$/.exec(text);
  return m ? Number(m[1]) : null;
}

const encodeWorkflowCursor = (id: string) => Buffer.from(`wf:${id}`).toString("base64url");
function decodeWorkflowCursor(cursor: string): string | null {
  const m = /^wf:([A-Za-z0-9_-]{1,128})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return m ? m[1]! : null;
}

function badInput(message: string, issues: Issue[]): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT", issues } });
}

function pageOrThrow(args: { first?: number | null; after?: string | null }) {
  const parsed = pageArgs.safeParse({ ...(args.first == null ? {} : { first: args.first }), after: args.after });
  if (!parsed.success) throw badInput("Invalid paging arguments.", issuesOf(parsed.error, "args"));
  return parsed.data;
}

const validation = (issues: Issue[]) => ({
  __typename: "ValidationError" as const,
  message: "The input is not valid.",
  code: "VALIDATION" as const,
  issues,
});
const notFound = (resource: string, id: string) => ({
  __typename: "NotFoundError" as const,
  message: `No ${resource} with id ${id}.`,
  code: "NOT_FOUND" as const,
  resource,
  id,
});
const unavailable = (message: string) => ({ __typename: "UnavailableError" as const, message, code: "UNAVAILABLE" as const });

function connectionOfRuns(runs: RunModel[], first: number, hasNextPage: boolean, totalCount: number) {
  const edges = runs.slice(0, first).map((r) => ({ cursor: encodeRunCursor(r.seq), node: r }));
  return { edges, pageInfo: { hasNextPage, endCursor: edges.at(-1)?.cursor ?? null }, totalCount };
}

export const resolvers: Resolvers = {
  Query: {
    async workflows(_p, args, ctx) {
      const page = pageOrThrow(args);
      let afterId: string | null = null;
      if (page.after != null) {
        afterId = decodeWorkflowCursor(page.after);
        if (afterId === null) throw badInput("Invalid cursor.", [{ path: "args.after", message: "is not a valid cursor" }]);
      }
      const res = await ctx.store.listWorkflows({ first: page.first, afterId });
      const edges = res.items.map((w) => ({ cursor: encodeWorkflowCursor(w.id), node: w }));
      return { edges, pageInfo: { hasNextPage: res.hasNextPage, endCursor: edges.at(-1)?.cursor ?? null }, totalCount: res.totalCount };
    },
    async workflow(_p, { id }, ctx) {
      const ok = idArg.safeParse(id);
      if (!ok.success) throw badInput("Invalid id.", issuesOf(ok.error, "id"));
      return ctx.loaders.workflowById.load(id);
    },
    async run(_p, { id }, ctx) {
      const ok = idArg.safeParse(id);
      if (!ok.success) throw badInput("Invalid id.", issuesOf(ok.error, "id"));
      return (await ctx.store.getRunsByIds([id]))[0] ?? null;
    },
    async runs(_p, args, ctx) {
      const page = pageOrThrow(args);
      for (const [key, value] of [["workflowId", args.workflowId]] as const) {
        if (value != null) {
          const ok = idArg.safeParse(value);
          if (!ok.success) throw badInput("Invalid id.", issuesOf(ok.error, key));
        }
      }
      let after: { seq: number } | null = null;
      if (page.after != null) {
        const seq = decodeRunCursor(page.after);
        if (seq === null) throw badInput("Invalid cursor.", [{ path: "args.after", message: "is not a valid cursor" }]);
        after = { seq };
      }
      const res = await ctx.store.listRuns(
        { ...(args.workflowId == null ? {} : { workflowId: args.workflowId }), ...(args.state == null ? {} : { state: args.state }) },
        { first: page.first, after },
      );
      return connectionOfRuns(res.items, page.first, res.hasNextPage, res.totalCount);
    },
  },

  Mutation: {
    async createWorkflow(_p, { input }, ctx) {
      const parsed = createWorkflowInput.safeParse(input);
      if (!parsed.success) return validation(issuesOf(parsed.error, "input"));
      const { name, description, steps } = parsed.data;
      return ctx.store.createWorkflow({ name, description: description ?? null, steps });
    },

    async startRun(_p, { input }, ctx) {
      const parsed = startRunInput.safeParse(input);
      if (!parsed.success) return validation(issuesOf(parsed.error, "input"));
      const workflow = await ctx.loaders.workflowById.load(parsed.data.workflowId);
      if (!workflow) return notFound("workflow", parsed.data.workflowId);
      const run = await ctx.store.createRun(workflow);
      try {
        await ctx.launcher.start({
          runId: run.id,
          workflowId: workflow.id,
          userId: ctx.userId,
          steps: workflow.steps.map((s) => ({ id: s.id, type: s.type })),
          ...(parsed.data.stepTimeoutMs == null ? {} : { stepTimeoutMs: parsed.data.stepTimeoutMs }),
        });
      } catch (e) {
        // The run exists but never started: record that instead of leaving it QUEUED forever.
        await ctx.store.markRunFailed(run.id, "could not start the Temporal workflow");
        return unavailable(`Could not reach Temporal: ${(e as Error).message.slice(0, 200)}`);
      }
      return run;
    },

    async cancelRun(_p, { runId }, ctx) {
      const ok = idArg.safeParse(runId);
      if (!ok.success) return validation(issuesOf(ok.error, "runId"));
      const run = (await ctx.store.getRunsByIds([runId]))[0];
      if (!run) return notFound("run", runId);
      if (TERMINAL_STATES.has(run.state)) {
        return { __typename: "ConflictError" as const, message: `The run already ended as ${run.state}.`, code: "CONFLICT" as const, state: run.state };
      }
      try {
        await ctx.launcher.cancel(run.id);
      } catch (e) {
        return unavailable(`Could not reach Temporal: ${(e as Error).message.slice(0, 200)}`);
      }
      return (await ctx.store.requestCancel(run.id)) ?? run;
    },
  },

  Workflow: {
    steps: (w) => w.steps,
    async runCount(w, _a, ctx) {
      return (await ctx.loaders.runsByWorkflowId.load(w.id)).length;
    },
    async lastRun(w, _a, ctx) {
      return (await ctx.loaders.runsByWorkflowId.load(w.id))[0] ?? null;
    },
    async runs(w, args, ctx) {
      const page = pageOrThrow(args);
      const all = await ctx.loaders.runsByWorkflowId.load(w.id);
      let start = 0;
      if (page.after != null) {
        const seq = decodeRunCursor(page.after);
        if (seq === null) throw badInput("Invalid cursor.", [{ path: "args.after", message: "is not a valid cursor" }]);
        start = all.findIndex((r) => r.seq < seq);
        if (start === -1) start = all.length;
      }
      const slice = all.slice(start, start + page.first);
      return connectionOfRuns(slice, page.first, start + page.first < all.length, all.length);
    },
  },

  Run: {
    async workflow(r, _a, ctx) {
      const w = await ctx.loaders.workflowById.load(r.workflowId);
      if (!w) throw new Error(`run ${r.id} points at a missing workflow ${r.workflowId}`);
      return w;
    },
  },

  CreateWorkflowResult: { __resolveType: (o) => ("__typename" in o && o.__typename ? o.__typename : "Workflow") },
  StartRunResult: { __resolveType: (o) => ("__typename" in o && o.__typename ? o.__typename : "Run") },
  CancelRunResult: { __resolveType: (o) => ("__typename" in o && o.__typename ? o.__typename : "Run") },
  UserError: { __resolveType: (o) => (o as { __typename: "ValidationError" }).__typename },
};
