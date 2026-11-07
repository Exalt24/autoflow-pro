// LIFESPAN: permanent
// GraphQL API -> Temporal -> worker -> run store, all real, in one process, against `temporal server start-dev`:
// the startRun mutation starts a real workflow, the worker's activities move the run through the store the API reads,
// and the cancelRun mutation sends the real signal. Skipped without a server unless REQUIRE_TEMPORAL=1.
// Run: temporal server start-dev   then   npm run test:graphql-temporal
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection } from "@temporalio/client";
import { DefaultLogger, Runtime } from "@temporalio/worker";
import { createActivities, DryRunExecutor, FileRunArchive } from "../src/temporal/activities.js";
import { TemporalRunLauncher } from "../src/temporal/client.js";
import { createRunWorker } from "../src/temporal/worker.js";
import { buildServer } from "../src/graphql/server.js";
import { MemoryRunStore } from "../src/graphql/store.js";

Runtime.install({ logger: new DefaultLogger("ERROR") });

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
try {
  const probe = await Connection.connect({ address, connectTimeout: 3000 });
  await probe.close();
} catch (e) {
  if (process.env.REQUIRE_TEMPORAL === "1") {
    console.log(`FAIL  no Temporal server at ${address}: ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(`SKIPPED  no Temporal server at ${address} (start one with: temporal server start-dev)`);
  process.exit(0);
}

const taskQueue = `gql-${Date.now().toString(36)}`;
const dir = mkdtempSync(join(tmpdir(), "graphql-temporal-"));
const store = new MemoryRunStore();
const activities = createActivities({ executor: new DryRunExecutor(), archive: new FileRunArchive(dir), recorder: store });
const { worker, connection } = await createRunWorker({ address, taskQueue, activities });
const launcher = await TemporalRunLauncher.connect(address, "default", taskQueue);
const app = await buildServer({ store, launcher });
await app.listen({ port: 0, host: "127.0.0.1" });
const port = (app.server.address() as { port: number }).port;
const gql = async (query: string, variables?: Record<string, unknown>) => {
  const res = await fetch(`http://127.0.0.1:${port}/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  return (await res.json()) as { data?: any; errors?: any[] };
};
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitForState(runId: string, want: string[], ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const r = (await gql(`query($id: ID!) { run(id: $id) { state error completedSteps totalSteps cancelRequested startedAt finishedAt } }`, { id: runId })).data.run;
    if (want.includes(r.state)) return r;
    if (Date.now() - t0 > ms) throw new Error(`run ${runId} stuck in ${r.state}`);
    await sleepReal(100);
  }
}
const make = async (name: string, steps: Array<[string, string]>) =>
  (await gql(`mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { ... on Workflow { id } } }`, { input: { name, steps: steps.map(([id, type]) => ({ id, type })) } })).data.createWorkflow.id as string;
const start = async (workflowId: string, stepTimeoutMs?: number) =>
  (await gql(`mutation($input: StartRunInput!) { startRun(input: $input) { __typename ... on Run { id state } } }`, { input: { workflowId, stepTimeoutMs } })).data.startRun;

try {
  await worker.runUntil(async () => {
    const okWf = await make("ok", [["open", "navigate"], ["read", "extract"]]);
    const t0 = Date.now();
    const r1 = await start(okWf);
    check("graphql+temporal: startRun returns a QUEUED or RUNNING run at once", r1.__typename === "Run" && ["QUEUED", "RUNNING"].includes(r1.state), JSON.stringify(r1));
    const done1 = await waitForState(r1.id, ["COMPLETED", "FAILED"]);
    check(`graphql+temporal: the run reaches COMPLETED through the worker (${Date.now() - t0} ms), both steps done, start and finish times set`, done1.state === "COMPLETED" && done1.completedSteps.join() === "open,read" && done1.startedAt && done1.finishedAt, JSON.stringify(done1));

    const flakyWf = await make("flaky", [["open", "navigate"], ["flaky-read", "extract"]]);
    const r2 = await start(flakyWf);
    const done2 = await waitForState(r2.id, ["COMPLETED", "FAILED"]);
    check("graphql+temporal: a step that fails twice is retried by Temporal and the run still ends COMPLETED", done2.state === "COMPLETED", JSON.stringify(done2));

    const brokenWf = await make("broken", [["broken-click", "click"]]);
    const r3 = await start(brokenWf);
    const done3 = await waitForState(r3.id, ["COMPLETED", "FAILED"]);
    check("graphql+temporal: a step that always fails ends FAILED with the step named in the error", done3.state === "FAILED" && /broken-click/.test(done3.error ?? ""), JSON.stringify(done3));

    const slowWf = await make("slow", [["open", "navigate"], ["slow-wait", "wait"], ["after", "click"]]);
    const r4 = await start(slowWf);
    await waitForState(r4.id, ["RUNNING"]);
    const t4 = Date.now();
    let mid = (await gql(`query($id: ID!) { run(id: $id) { completedSteps } }`, { id: r4.id })).data.run;
    while (!mid.completedSteps.includes("open") && Date.now() - t4 < 10000) {
      await sleepReal(50);
      mid = (await gql(`query($id: ID!) { run(id: $id) { completedSteps } }`, { id: r4.id })).data.run;
    }
    check("graphql+temporal: while the run is still going, a finished step already shows in completedSteps", mid.completedSteps.join() === "open", JSON.stringify(mid));
    const c = (await gql(`mutation($id: ID!) { cancelRun(runId: $id) { __typename ... on Run { cancelRequested } } }`, { id: r4.id })).data.cancelRun;
    const done4 = await waitForState(r4.id, ["CANCELLED", "COMPLETED", "FAILED"]);
    check("graphql+temporal: cancelRun sends the signal; the 20 second step is cut short and the run ends CANCELLED", c.__typename === "Run" && c.cancelRequested === true && done4.state === "CANCELLED" && !done4.completedSteps.includes("after"), JSON.stringify({ c, done4 }));
    const again = (await gql(`mutation($id: ID!) { cancelRun(runId: $id) { __typename } }`, { id: r4.id })).data.cancelRun;
    check("graphql+temporal: cancelling a finished run is a ConflictError", again.__typename === "ConflictError");

    const timeoutWf = await make("timeout", [["slow-wait", "wait"]]);
    const r5 = await start(timeoutWf, 1500);
    const done5 = await waitForState(r5.id, ["TIMED_OUT", "COMPLETED", "FAILED"]);
    check("graphql+temporal: a stepTimeoutMs of 1500 ends a 20 second step as TIMED_OUT", done5.state === "TIMED_OUT", JSON.stringify(done5));

    const list = (await gql(`{ workflows { edges { node { name runCount lastRun { state } } } } }`)).data.workflows.edges.map((e: any) => e.node);
    check("graphql+temporal: the workflows query reports each workflow's run count and last state", list.length === 5 && list.every((w: any) => w.runCount === 1) && list.find((w: any) => w.name === "slow").lastRun.state === "CANCELLED", JSON.stringify(list));
  });
} finally {
  await app.close();
  launcher.close();
  await connection.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
