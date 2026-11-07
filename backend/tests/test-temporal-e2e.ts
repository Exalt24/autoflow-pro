// LIFESPAN: permanent
// The Temporal run workflow against a REAL Temporal server: `temporal server start-dev` (the Temporal CLI's dev server).
// A real worker with the real activities (dry-run executor, JSON file archive), the real client, nothing mocked.
// Needs TEMPORAL_ADDRESS (default localhost:7233). Without a reachable server it prints SKIPPED and exits 0, unless
// REQUIRE_TEMPORAL=1 (CI sets it), then it fails. This is a local dev server only: not Temporal Cloud, not a cluster.
// Run: temporal server start-dev   then   npm run test:temporal-e2e
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection } from "@temporalio/client";
import { DefaultLogger, Runtime } from "@temporalio/worker";
import { createActivities, DryRunExecutor, FileRunArchive } from "../src/temporal/activities.js";
import { TemporalRunLauncher } from "../src/temporal/client.js";
import { createRunWorker } from "../src/temporal/worker.js";
import { RETRY_POLICY, type ArchiveRecord, type RunInput, type RunStatus } from "../src/temporal/types.js";

Runtime.install({ logger: new DefaultLogger("ERROR") });

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => Promise<boolean> | boolean, ms = 15000) {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("condition not reached in time");
    await sleepReal(50);
  }
}

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
try {
  const probe = await Connection.connect({ address, connectTimeout: 3000 });
  const info = await probe.workflowService.getSystemInfo({});
  console.log(`connected to ${address}, server version ${info.serverVersion}`);
  await probe.close();
} catch (e) {
  if (process.env.REQUIRE_TEMPORAL === "1") {
    console.log(`FAIL  no Temporal server at ${address}: ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(`SKIPPED  no Temporal server at ${address} (start one with: temporal server start-dev)`);
  process.exit(0);
}

const suffix = Date.now().toString(36);
const taskQueue = `e2e-${suffix}`;
const dir = mkdtempSync(join(tmpdir(), "temporal-e2e-"));
const executor = new DryRunExecutor();
const activities = createActivities({ executor, archive: new FileRunArchive(dir) });
const { worker, connection } = await createRunWorker({ address, taskQueue, activities });
const launcher = await TemporalRunLauncher.connect(address, "default", taskQueue);
const archived = (runId: string): ArchiveRecord => JSON.parse(readFileSync(join(dir, `${runId}.json`), "utf8"));

// A run that never ends (a broken workflow retries forever) must show up as a FAIL line, not as a hung test.
const RESULT_DEADLINE_MS = 90_000;
async function outcome(runId: string) {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline")), RESULT_DEADLINE_MS);
  });
  try {
    return await Promise.race([launcher.result(runId), deadline]);
  } catch (e) {
    if ((e as Error).message !== "deadline") throw e;
    console.log(`FAIL  run ${runId} did not finish in ${RESULT_DEADLINE_MS} ms`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

const mk = (name: string, steps: RunInput["steps"], extra: Partial<RunInput> = {}): RunInput => ({
  runId: `${name}-${suffix}`,
  workflowId: "wf1",
  userId: "u1",
  steps,
  ...extra,
});

try {
  await worker.runUntil(async () => {
    // 1. a flaky step is retried by the server and the run completes
    {
      const input = mk("flaky", [{ id: "open", type: "navigate" }, { id: "read", type: "extract", config: { failFirstAttempts: 2 } }]);
      const t0 = Date.now();
      await launcher.start(input);
      const res = await outcome(input.runId);
      check("e2e retry: a step that fails twice works on the third try and the run completes", res.state === "completed", JSON.stringify(res));
      check("e2e retry: the executor saw try 1, 2 and 3 of the step (server-side retries with back-off)", executor.log.some((l) => l.endsWith(":read:extract:try3")), executor.log.join(" | "));
      check(`e2e retry: the 1 s and 2 s back-offs really elapsed (${Date.now() - t0} ms)`, Date.now() - t0 >= 3000);
      const rec = archived(input.runId);
      check("e2e retry: the archive file on disk says completed with both steps", rec.state === "completed" && rec.completedSteps.join() === "open,read");
    }

    // 2. retries run out
    {
      const input = mk("broken", [{ id: "boom", type: "click", config: { alwaysFail: true } }]);
      await launcher.start(input);
      const res = await outcome(input.runId);
      const tries = executor.tries.get(`${input.runId}:boom`);
      check(`e2e exhausted: a step that always fails ends the run as failed after exactly the ${RETRY_POLICY.maximumAttempts} allowed tries`, res.state === "failed" && /always fail/.test(res.error ?? "") && tries === RETRY_POLICY.maximumAttempts, `tries ${tries} ${JSON.stringify(res)}`);
      check("e2e exhausted: the failed run was archived as failed", archived(input.runId).state === "failed");
    }

    // 3. cancel signal and status query during a slow step
    {
      const input = mk("slow", [{ id: "quick", type: "navigate" }, { id: "slow", type: "wait", config: { ms: 120_000 } }, { id: "never", type: "click" }]);
      await launcher.start(input);
      await until(async () => (await launcher.status(input.runId)).currentStep === 2);
      const mid: RunStatus = await launcher.status(input.runId);
      check("e2e status: the query shows running, step 2 of 3, the first step done", mid.state === "running" && mid.totalSteps === 3 && mid.completedSteps.join() === "quick", JSON.stringify(mid));
      const t0 = Date.now();
      await launcher.cancel(input.runId, "stopped from the e2e test");
      const res = await outcome(input.runId);
      check(`e2e cancel: the signal ends a 2 minute step as cancelled in ${Date.now() - t0} ms`, res.state === "cancelled" && res.error === "stopped from the e2e test" && Date.now() - t0 < 10_000, JSON.stringify(res));
      check("e2e cancel: the third step never ran and the cancelled run was archived", !executor.log.some((l) => l.includes(":never:")) && archived(input.runId).state === "cancelled");
    }

    // 4. step timeout
    {
      const input = mk("late", [{ id: "stuck", type: "wait", config: { ms: 120_000 } }], { stepTimeoutMs: 1500 });
      await launcher.start(input);
      const res = await outcome(input.runId);
      check("e2e timeout: a step that outlives its 1.5 s budget ends the run as timed_out", res.state === "timed_out" && /stuck/.test(res.error ?? ""), JSON.stringify(res));
    }

    // 5. validation
    {
      const input = mk("empty", []);
      await launcher.start(input);
      const res = await outcome(input.runId);
      check("e2e validation: a run with no steps fails with the reason and is archived", res.state === "failed" && /at least one step/.test(res.error ?? "") && archived(input.runId).state === "failed", JSON.stringify(res));
    }

    // 6. the same run id cannot be started twice
    {
      const input = mk("flaky", [{ id: "open", type: "navigate" }]);
      let refused = false;
      try {
        await launcher.start(input);
      } catch (e) {
        refused = /already|started/i.test((e as Error).message);
      }
      check("e2e duplicate: starting a run id that already ran is refused by the server", refused);
    }
  });
} finally {
  launcher.close();
  await connection.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
