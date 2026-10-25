// Offline test for SchedulerService.checkScheduledJobs: no Supabase, no Redis, no network.
// It pins two layers that stop a job running twice when a polling tick overlaps a job still being queued:
//   1. next_run_at is moved BEFORE the job is queued (the order), so the next tick no longer sees the job as due.
//   2. an isChecking flag, so a tick that starts while another is still running returns at once.
// The real SchedulerService.ts is loaded as text, its four imports are swapped for fakes, and it is run. Each layer is also
// broken on purpose in a copy of the source, and the test requires the matching check to fail (a check that cannot fail is not a check).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "src", "services", "SchedulerService.ts"), "utf8");

const ORDER_LINE = "await scheduledJobService.updateNextRunTime(job.id);";
const FLAG_LINE = "if (this.isChecking) return;";

type Job = { id: string; user_id: string; workflow_id: string; is_active: boolean; next_run_at: string };

interface World {
  calls: string[];
  runs: string[];
  jobs: Job[];
  releaseQueue: () => void;
  jobSelects: { n: number };
  svc: any;
}

async function build(source: string, opts: { slowQueue: boolean }): Promise<World> {
  const calls: string[] = [];
  const runs: string[] = [];
  const jobs: Job[] = [{ id: "job1", user_id: "u1", workflow_id: "wf1", is_active: true, next_run_at: new Date(Date.now() - 1000).toISOString() }];
  const jobSelects = { n: 0 };
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });

  const chain = (table: string) => {
    if (table === "scheduled_jobs") jobSelects.n++;
    let lteValue: string | null = null;
    const c: any = {
      select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c,
      lte: (_col: string, v: string) => { lteValue = v; return c; },
      then: (resolve: any) => {
        if (table === "scheduled_jobs") resolve({ data: jobs.filter((j) => j.is_active && (lteValue === null || j.next_run_at <= lteValue)), error: null });
        else if (table === "workflows") resolve({ data: [{ id: "wf1", user_id: "u1", definition: {} }], error: null });
        else resolve({ data: null, error: null });
      },
    };
    return c;
  };

  const fakes = {
    supabase: { from: (t: string) => chain(t) },
    executionService: { createExecution: async () => { calls.push("createExecution"); return { id: "ex" + (runs.length + 1) }; } },
    scheduledJobService: {
      updateNextRunTime: async (id: string) => {
        calls.push("updateNextRunTime");
        jobs.find((j) => j.id === id)!.next_run_at = new Date(Date.now() + 3600_000).toISOString();
      },
    },
    queueService: {
      addJob: async (d: { executionId: string }) => {
        calls.push("addJob");
        runs.push(d.executionId);
        if (opts.slowQueue) await gate;
      },
    },
  };
  (globalThis as any).__schedFakes = fakes;

  const swapped = source
    .replace(/import \{ queueService \}[^\n]*\n/, "const { queueService } = (globalThis as any).__schedFakes;\n")
    .replace(/import \{ scheduledJobService \}[^\n]*\n/, "const { scheduledJobService } = (globalThis as any).__schedFakes;\n")
    .replace(/import \{ executionService \}[^\n]*\n/, "const { executionService } = (globalThis as any).__schedFakes;\n")
    .replace(/import \{ supabase \}[^\n]*\n/, "const { supabase } = (globalThis as any).__schedFakes;\n");
  if (swapped.includes("from \"./") || swapped.includes("from \"../")) throw new Error("an import of SchedulerService.ts was not replaced by a fake");
  const js = transformSync(swapped, { loader: "ts", format: "esm", target: "node20" }).code;
  const mod = await import("data:text/javascript;base64," + Buffer.from(js + "\n// " + Math.random()).toString("base64"));
  const svc = new mod.SchedulerService();
  return { calls, runs, jobs, releaseQueue: release, jobSelects, svc };
}

// Check 1, the order: createExecution, then updateNextRunTime, then addJob.
async function orderHolds(source: string): Promise<boolean> {
  const w = await build(source, { slowQueue: false });
  await w.svc.checkScheduledJobs();
  return w.calls.join(",") === "createExecution,updateNextRunTime,addJob";
}

// Check 2, the flag: a tick that starts while another is still queuing returns at once, so it never even reads the due jobs.
async function flagHolds(source: string): Promise<boolean> {
  const w = await build(source, { slowQueue: true });
  const first = w.svc.checkScheduledJobs();
  await new Promise((r) => setTimeout(r, 20));
  const second = w.svc.checkScheduledJobs();
  await new Promise((r) => setTimeout(r, 20));
  const reads = w.jobSelects.n;
  w.releaseQueue();
  await Promise.all([first, second]);
  return reads === 1 && w.runs.length === 1;
}

// Check 3, the outcome the two layers exist for: an overlapping tick never queues the job twice.
async function noDuplicate(source: string): Promise<boolean> {
  const w = await build(source, { slowQueue: true });
  const first = w.svc.checkScheduledJobs();
  await new Promise((r) => setTimeout(r, 20));
  const second = w.svc.checkScheduledJobs();
  await new Promise((r) => setTimeout(r, 20));
  w.releaseQueue();
  await Promise.all([first, second]);
  return w.runs.length === 1;
}

let passed = 0;
let failed = 0;
function expect(name: string, ok: boolean) {
  if (ok) { passed++; console.log("  ok   " + name); } else { failed++; console.log("  FAIL " + name); }
}

(async () => {
  if (!SRC.includes(ORDER_LINE) || !SRC.includes(FLAG_LINE)) throw new Error("the lines this test breaks on purpose have moved in SchedulerService.ts");

  console.log("real scheduler");
  expect("order: execution created, next_run_at moved, then queued", await orderHolds(SRC));
  expect("flag: an overlapping tick queues nothing while one is still running", await flagHolds(SRC));
  expect("outcome: the job is queued exactly once", await noDuplicate(SRC));

  console.log("mutants (each must be caught)");
  const afterQueue = SRC.replace(ORDER_LINE, "").replace(/(await queueService\.addJob\(\{[\s\S]*?\}\);)/, "$1\n          " + ORDER_LINE);
  if (afterQueue === SRC) throw new Error("mutant 1 did not change the source");
  expect("mutant 1, next_run_at moved after queuing: the order check fails", !(await orderHolds(afterQueue)));

  const noFlag = SRC.replace(FLAG_LINE, "");
  if (noFlag === SRC) throw new Error("mutant 2 did not change the source");
  expect("mutant 2, no isChecking flag: the flag check fails", !(await flagHolds(noFlag)));

  const neither = afterQueue.replace(FLAG_LINE, "");
  expect("mutant 3, neither layer: the job is queued twice, so the outcome check fails", !(await noDuplicate(neither)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
})().catch((e) => { console.error(e); process.exit(1); });
