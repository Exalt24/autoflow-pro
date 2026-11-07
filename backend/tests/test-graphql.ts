// LIFESPAN: permanent
// The GraphQL API (backend/src/graphql) served in process by the real Fastify + Yoga server over real HTTP, with an
// in-memory run store and a recording launcher (no Temporal here; test-graphql-temporal.ts runs it against Temporal).
// Covers: the committed schema snapshot, zod input validation, typed errors, cursor pagination (also as a seeded
// property over random worlds), DataLoader batching proved with a store call counter, the query depth limit, and
// that an unexpected error is masked.
// Run: npm run test:graphql
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/graphql/server.js";
import { MemoryRunStore, type RunStore } from "../src/graphql/store.js";
import { currentSchemaSdl, SNAPSHOT_PATH } from "../src/graphql/printSchema.js";
import { DEPTH_LIMIT_CODE } from "../src/graphql/depthLimit.js";
import { STEP_TYPES } from "../src/graphql/inputs.js";
import type { RunLauncher } from "../src/temporal/client.js";
import type { RunInput, RunStatus } from "../src/temporal/types.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
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

// A store that counts how many times each method is called.
function counting(store: MemoryRunStore) {
  const counts: Record<string, number> = {};
  const proxy = new Proxy(store, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        counts[String(key)] = (counts[String(key)] ?? 0) + 1;
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { store: proxy as unknown as RunStore, counts, reset: () => Object.keys(counts).forEach((k) => delete counts[k]) };
}

class FakeLauncher implements RunLauncher {
  started: RunInput[] = [];
  cancelled: string[] = [];
  down = false;
  async start(input: RunInput) {
    if (this.down) throw new Error("connect ECONNREFUSED 127.0.0.1:7233");
    this.started.push(input);
    return { workflowId: `run-${input.runId}` };
  }
  async cancel(runId: string) {
    if (this.down) throw new Error("connect ECONNREFUSED 127.0.0.1:7233");
    this.cancelled.push(runId);
  }
  async status(): Promise<RunStatus> {
    throw new Error("not used");
  }
}

interface GqlResult {
  data?: any;
  errors?: Array<{ message: string; extensions?: any }>;
}
async function serve(store: RunStore, launcher: RunLauncher, maxDepth?: number) {
  const app: FastifyInstance = await buildServer({ store, launcher, ...(maxDepth ? { maxDepth } : {}) });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/graphql`;
  const gql = async (query: string, variables?: Record<string, unknown>): Promise<GqlResult> => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
    return (await res.json()) as GqlResult;
  };
  return { app, gql, url };
}

const CREATE = `mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { __typename ... on Workflow { id name steps { id type } } ... on ValidationError { code issues { path message } } } }`;
const START = `mutation($input: StartRunInput!) { startRun(input: $input) { __typename ... on Run { id state totalSteps cancelRequested } ... on NotFoundError { code resource id } ... on ValidationError { code issues { path message } } ... on UnavailableError { code message } } }`;
const CANCEL = `mutation($id: ID!) { cancelRun(runId: $id) { __typename ... on Run { id state cancelRequested } ... on NotFoundError { code } ... on ConflictError { code state } ... on ValidationError { code } ... on UnavailableError { code } } }`;

// ---------- 1. the committed schema snapshot ----------
{
  const snap = readFileSync(SNAPSHOT_PATH, "utf8").replace(/\r\n/g, "\n");
  check("schema snapshot: src/graphql/schema.graphql is exactly what typeDefs.ts prints", snap === currentSchemaSdl(), "run: npm run graphql:schema");
  check("schema snapshot: it holds the mutation and the union result types", /startRun\(input: StartRunInput!\): StartRunResult!/.test(snap) && /union CancelRunResult = /.test(snap));
}

const memory = new MemoryRunStore();
const counted = counting(memory);
const launcher = new FakeLauncher();
const { app, gql } = await serve(counted.store, launcher);

try {
  // ---------- 2. createWorkflow and zod validation ----------
  const made = await gql(CREATE, { input: { name: "  Price check  ", description: "x", steps: [{ id: "a", type: "navigate" }, { id: "b", type: "extract" }] } });
  const wf = made.data?.createWorkflow;
  check("createWorkflow: a valid input returns the Workflow (name trimmed)", wf?.__typename === "Workflow" && wf.name === "Price check" && wf.steps.length === 2, JSON.stringify(made));

  const bad = async (input: Record<string, unknown>) => (await gql(CREATE, { input })).data?.createWorkflow;
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["an empty name", { name: "   ", steps: [{ id: "a", type: "click" }] }, /name/],
    ["a name over 100 characters", { name: "x".repeat(101), steps: [{ id: "a", type: "click" }] }, /name/],
    ["no steps", { name: "n", steps: [] }, /steps/],
    ["an unknown step type", { name: "n", steps: [{ id: "a", type: "teleport" }] }, /steps\.0\.type/],
    ["a step id with a slash", { name: "n", steps: [{ id: "a/b", type: "click" }] }, /steps\.0\.id/],
    ["two steps with the same id", { name: "n", steps: [{ id: "a", type: "click" }, { id: "a", type: "click" }] }, /steps/],
    ["a description over 1000 characters", { name: "n", description: "d".repeat(1001), steps: [{ id: "a", type: "click" }] }, /description/],
  ];
  for (const [label, input, path] of cases) {
    const r = await bad(input);
    check(`validation: ${label} gives a ValidationError with the field path`, r?.__typename === "ValidationError" && r.code === "VALIDATION" && r.issues.some((i: any) => path.test(i.path)), JSON.stringify(r));
  }
  check("validation: all 23 step types are accepted", (await bad({ name: "all", steps: STEP_TYPES.map((t, i) => ({ id: `s${i}`, type: t })) }))?.__typename === "Workflow");
  const wrongType = await gql(`mutation { createWorkflow(input: { name: 5, steps: [] }) { __typename } }`);
  check("validation: a wrong GraphQL type (5 for a String) is refused by GraphQL itself before any resolver", (wrongType.errors?.length ?? 0) > 0 && wrongType.data === undefined);

  // ---------- 3. startRun ----------
  const wid = wf.id as string;
  const started = (await gql(START, { input: { workflowId: wid, stepTimeoutMs: 5000 } })).data.startRun;
  check("startRun: returns the new Run, QUEUED, with the step count", started.__typename === "Run" && started.state === "QUEUED" && started.totalSteps === 2 && started.cancelRequested === false, JSON.stringify(started));
  check("startRun: the Temporal launcher got the run id, the steps and the timeout", launcher.started.length === 1 && launcher.started[0]!.runId === started.id && launcher.started[0]!.steps.length === 2 && launcher.started[0]!.stepTimeoutMs === 5000);
  const nf = (await gql(START, { input: { workflowId: "does-not-exist" } })).data.startRun;
  check("startRun: an unknown workflow is a NotFoundError and the launcher is not called", nf.__typename === "NotFoundError" && nf.code === "NOT_FOUND" && nf.resource === "workflow" && launcher.started.length === 1, JSON.stringify(nf));
  const badId = (await gql(START, { input: { workflowId: "../etc" } })).data.startRun;
  const badTimeout = (await gql(START, { input: { workflowId: wid, stepTimeoutMs: 50 } })).data.startRun;
  check("startRun: a bad workflow id and a timeout under 100 ms are ValidationErrors", badId.__typename === "ValidationError" && badTimeout.__typename === "ValidationError" && badTimeout.issues[0].path === "input.stepTimeoutMs", JSON.stringify(badTimeout));
  launcher.down = true;
  const down = (await gql(START, { input: { workflowId: wid } })).data.startRun;
  launcher.down = false;
  const downRun = (await gql(`{ runs(state: FAILED) { edges { node { id state error } } } }`)).data.runs.edges;
  check("startRun: when Temporal is unreachable the answer is an UnavailableError and the run is marked FAILED, not left QUEUED", down.__typename === "UnavailableError" && down.code === "UNAVAILABLE" && downRun.length === 1 && /could not start/.test(downRun[0].node.error), JSON.stringify({ down, downRun }));

  // ---------- 4. cancelRun ----------
  const c1 = (await gql(CANCEL, { id: started.id })).data.cancelRun;
  check("cancelRun: sends the signal and returns the Run with cancelRequested true", c1.__typename === "Run" && c1.cancelRequested === true && launcher.cancelled.join() === started.id, JSON.stringify(c1));
  check("cancelRun: an unknown run is a NotFoundError", (await gql(CANCEL, { id: "nope" })).data.cancelRun.__typename === "NotFoundError");
  check("cancelRun: a bad id is a ValidationError", (await gql(CANCEL, { id: "a b" })).data.cancelRun.__typename === "ValidationError");
  const failedRunId = downRun[0].node.id;
  const c2 = (await gql(CANCEL, { id: failedRunId })).data.cancelRun;
  check("cancelRun: a run that already ended is a ConflictError that names its state", c2.__typename === "ConflictError" && c2.state === "FAILED" && c2.code === "CONFLICT", JSON.stringify(c2));
  launcher.down = true;
  const other = (await gql(START, { input: { workflowId: wid } })).data.startRun; // unavailable, becomes FAILED
  launcher.down = false;
  const live = (await gql(START, { input: { workflowId: wid } })).data.startRun;
  launcher.down = true;
  const c3 = (await gql(CANCEL, { id: live.id })).data.cancelRun;
  launcher.down = false;
  check("cancelRun: when Temporal is unreachable it is an UnavailableError", c3.__typename === "UnavailableError" && other.__typename === "UnavailableError", JSON.stringify(c3));

  // ---------- 5. pagination ----------
  {
    const m = new MemoryRunStore();
    const l = new FakeLauncher();
    const s = await serve(m, l);
    try {
      const w = (await s.gql(CREATE, { input: { name: "w", steps: [{ id: "a", type: "click" }] } })).data.createWorkflow;
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) ids.push((await s.gql(START, { input: { workflowId: w.id } })).data.startRun.id);
      const Q = `query($after: String, $first: Int) { runs(first: $first, after: $after) { totalCount pageInfo { hasNextPage endCursor } edges { cursor node { id } } } }`;
      const pages: string[][] = [];
      const flags: boolean[] = [];
      let after: string | null = null;
      for (let i = 0; i < 5; i++) {
        const r: GqlResult = await s.gql(Q, { first: 10, after });
        pages.push(r.data.runs.edges.map((e: any) => e.node.id));
        flags.push(r.data.runs.pageInfo.hasNextPage);
        if (!r.data.runs.pageInfo.hasNextPage) break;
        // a new run created between pages must not shift the pages already read
        if (i === 0) await s.gql(START, { input: { workflowId: w.id } });
        after = r.data.runs.pageInfo.endCursor;
      }
      const flat = pages.flat();
      check("pagination: 25 runs read 10 at a time give pages of 10, 10, 5 with hasNextPage true, true, false", pages.map((p) => p.length).join() === "10,10,5" && flags.join() === "true,true,false", `${pages.map((p) => p.length)} ${flags}`);
      check("pagination: newest first, no run twice, none skipped, even though a run was created between page 1 and 2", flat.join() === [...ids].reverse().join(), "");
      const bad1 = await s.gql(Q, { first: 5, after: "not-a-cursor" });
      check("pagination: a made up cursor is a BAD_USER_INPUT error with the field named", bad1.errors?.[0]?.extensions?.code === "BAD_USER_INPUT" && bad1.errors[0].extensions.issues[0].path === "args.after", JSON.stringify(bad1.errors));
      const [z, big, frac] = await Promise.all([s.gql(Q, { first: 0 }), s.gql(Q, { first: 101 }), s.gql(Q, { first: 1.5 })]);
      check("pagination: first of 0 and 101 are BAD_USER_INPUT, 1.5 is refused by GraphQL", z.errors?.[0]?.extensions?.code === "BAD_USER_INPUT" && big.errors?.[0]?.extensions?.code === "BAD_USER_INPUT" && (frac.errors?.length ?? 0) > 0);
      const byState = (await s.gql(`{ runs(state: QUEUED, first: 100) { totalCount } other: runs(state: RUNNING) { totalCount } }`)).data;
      check("pagination: the state filter counts QUEUED 26 and RUNNING 0", byState.runs.totalCount === 26 && byState.other.totalCount === 0);
      const nested = (await s.gql(`query($id: ID!) { workflow(id: $id) { runCount runs(first: 10) { totalCount pageInfo { hasNextPage endCursor } edges { node { id } } } } }`, { id: w.id })).data.workflow;
      const n2 = (await s.gql(`query($id: ID!, $after: String) { workflow(id: $id) { runs(first: 100, after: $after) { edges { node { id } } } } }`, { id: w.id, after: nested.runs.pageInfo.endCursor })).data.workflow.runs.edges.map((e: any) => e.node.id);
      check("pagination: a workflow's own runs connection pages the same way (10 then the other 16), runCount is 26", nested.runCount === 26 && nested.runs.totalCount === 26 && nested.runs.edges.length === 10 && n2.length === 16 && new Set([...nested.runs.edges.map((e: any) => e.node.id), ...n2]).size === 26);
    } finally {
      await s.app.close();
    }
  }

  // Property: over seeded random worlds, walking the cursors with random page sizes returns every run exactly once, newest first.
  {
    const r = rng(777);
    let ok = 0;
    const WORLDS = 150;
    for (let w = 0; w < WORLDS; w++) {
      const m = new MemoryRunStore();
      const wfs = [];
      for (let i = 0; i < 1 + Math.floor(r() * 3); i++) wfs.push(await m.createWorkflow({ name: `w${i}`, description: null, steps: [{ id: "a", type: "click" }] }));
      const all: string[] = [];
      const n = Math.floor(r() * 40);
      for (let i = 0; i < n; i++) all.push((await m.createRun(wfs[Math.floor(r() * wfs.length)]!)).id);
      const target = wfs[0]!.id;
      const expected = (await m.listRuns({ workflowId: target }, { first: 1000, after: null })).items.map((x) => x.id);
      const seen: string[] = [];
      let after: { seq: number } | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const size = 1 + Math.floor(r() * 7);
        const page: Awaited<ReturnType<MemoryRunStore["listRuns"]>> = await m.listRuns({ workflowId: target }, { first: size, after });
        seen.push(...page.items.map((x) => x.id));
        if (!page.hasNextPage) break;
        after = { seq: page.items.at(-1)!.seq };
      }
      if (seen.join() === expected.join() && new Set(seen).size === seen.length) ok++;
    }
    check(`pagination property: ${WORLDS} seeded random worlds, random page sizes, every run exactly once in newest first order`, ok === WORLDS, `${ok}/${WORLDS}`);
  }

  // ---------- 6. DataLoader: one store call, not one per row ----------
  {
    const m = new MemoryRunStore();
    const c = counting(m);
    const s = await serve(c.store, new FakeLauncher(), 12); // a higher limit, so the deep loader query below is allowed
    try {
      const wfs = [];
      for (let i = 0; i < 8; i++) wfs.push(await m.createWorkflow({ name: `flow ${i}`, description: null, steps: [{ id: "a", type: "click" }] }));
      for (let i = 0; i < 40; i++) await m.createRun(wfs[i % 8]!);
      c.reset();
      const r1 = await s.gql(`{ runs(first: 40) { edges { node { id workflow { id name } } } } }`);
      const names = new Set(r1.data.runs.edges.map((e: any) => e.node.workflow.name));
      check("dataloader: 40 runs that each ask for their workflow load the 8 workflows in ONE store call (not 40)", c.counts.getWorkflowsByIds === 1 && c.counts.listRuns === 1 && names.size === 8, JSON.stringify(c.counts));
      c.reset();
      const r2 = await s.gql(`{ workflows(first: 8) { edges { node { runCount lastRun { id } runs(first: 2) { totalCount } } } } }`);
      check("dataloader: 8 workflows asking runCount, lastRun and runs(first) share ONE runs-by-workflow call (not 24)", c.counts.runsForWorkflows === 1 && r2.data.workflows.edges.every((e: any) => e.node.runCount === 5 && e.node.runs.totalCount === 5), JSON.stringify(c.counts));
      c.reset();
      const deep = await s.gql(`{ runs(first: 40) { edges { node { workflow { runs(first: 3) { edges { node { workflow { name } } } } } } } } }`);
      check("dataloader: a query that goes run to workflow to runs to workflow again still makes 1 + 1 + 1 store calls", deep.errors === undefined && c.counts.listRuns === 1 && c.counts.runsForWorkflows === 1 && (c.counts.getWorkflowsByIds ?? 0) <= 2, JSON.stringify({ counts: c.counts, errors: deep.errors }));
      c.reset();
      await s.gql(`{ runs(first: 5) { edges { node { workflow { name } } } } }`);
      await s.gql(`{ runs(first: 5) { edges { node { workflow { name } } } } }`);
      check("dataloader: a second request loads again, so one request's cache is never shared with another", c.counts.getWorkflowsByIds === 2, JSON.stringify(c.counts));
    } finally {
      await s.app.close();
    }
  }

  // ---------- 7. depth limit ----------
  {
    const m = new MemoryRunStore();
    const c = counting(m);
    const s = await serve(c.store, new FakeLauncher(), 6);
    try {
      const ok6 = await s.gql(`{ runs { edges { node { workflow { name } } } } }`); // runs.edges.node.workflow.name
      check("depth limit: a query 5 levels deep runs", ok6.errors === undefined, JSON.stringify(ok6.errors));
      const exactly6 = await s.gql(`{ runs { edges { node { workflow { runs { totalCount } } } } } }`);
      check("depth limit: a query exactly at the limit (6) runs", exactly6.errors === undefined, JSON.stringify(exactly6.errors));
      c.reset();
      const over = await s.gql(`query Deep { runs { edges { node { workflow { runs { edges { cursor } } } } } } }`);
      check("depth limit: a query 7 levels deep is refused with code DEPTH_LIMIT_EXCEEDED", over.errors?.[0]?.extensions?.code === DEPTH_LIMIT_CODE && over.errors[0].extensions.depth === 7 && over.errors[0].extensions.max === 6, JSON.stringify(over.errors));
      check("depth limit: the refused query never reached the store", Object.keys(c.counts).length === 0, JSON.stringify(c.counts));
      const viaFragment = await s.gql(`query Q { runs { ...A } } fragment A on RunConnection { edges { node { ...B } } } fragment B on Run { workflow { runs { edges { cursor } } } }`);
      check("depth limit: nesting hidden behind fragments is counted", viaFragment.errors?.[0]?.extensions?.code === DEPTH_LIMIT_CODE, JSON.stringify(viaFragment.errors));
      const inline = await s.gql(`{ runs { edges { ... on RunEdge { node { workflow { runs { edges { cursor } } } } } } } }`);
      check("depth limit: nesting inside an inline fragment is counted", inline.errors?.[0]?.extensions?.code === DEPTH_LIMIT_CODE);
      const cyc = await s.gql(`query Q { runs { ...A } } fragment A on RunConnection { ...B } fragment B on RunConnection { ...A }`);
      check("depth limit: a fragment cycle is rejected without hanging the validator", (cyc.errors?.length ?? 0) > 0);
    } finally {
      await s.app.close();
    }
  }

  // ---------- 8. an unexpected error is masked ----------
  {
    const m = new MemoryRunStore();
    const boom: RunStore = new Proxy(m as unknown as RunStore, {
      get(t, k) {
        if (k === "listRuns") return async () => { throw new Error("secret connection string postgres://user:pw@db/prod"); };
        return (t as any)[k].bind(t);
      },
    });
    const s = await serve(boom, new FakeLauncher());
    try {
      const res = await s.gql(`{ runs { totalCount } }`);
      const text = JSON.stringify(res);
      check("masked errors: a bug inside a resolver reaches the client as 'Unexpected error.' with no stack and no secret", res.errors?.[0]?.message === "Unexpected error." && !/postgres|secret|stack|\.ts:/.test(text), text);
    } finally {
      await s.app.close();
    }
  }

  // ---------- 9. plumbing ----------
  const h = await fetch(`${(app.server.address() as any) ? "http://127.0.0.1:" + (app.server.address() as any).port : ""}/health`);
  check("plumbing: /health answers 200", h.status === 200);
} finally {
  await app.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
