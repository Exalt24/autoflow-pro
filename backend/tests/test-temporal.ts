// LIFESPAN: permanent
// The Temporal run workflow (backend/src/temporal) on the SDK's time-skipping test environment: retry then success,
// retries used up, validation, cancel in the middle of a run, a step timeout, the status query, and an archive that fails.
// The SDK's time-skipping server runs the workflows. Measured here: it did NOT skip the retry back-offs or a step timer
// while an activity was in flight, so those cases use short real budgets and the whole file takes about 15 s. Also checks the pure input rules
// over seeded random inputs. Nothing here talks to a Temporal server of mine: the SDK starts its own test server.
// Run: npm run test:temporal
import { Context } from "@temporalio/activity";
import { DefaultLogger, Runtime } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode, type WorkflowBundle } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { workflowsPath, HEARTBEAT_TUNING } from "../src/temporal/worker.js";
import { findRunInputProblem } from "../src/temporal/validation.js";
import { createActivities, DryRunExecutor, FileRunArchive } from "../src/temporal/activities.js";
import {
  CANCEL_SIGNAL,
  MAX_STEPS,
  RETRY_POLICY,
  STATUS_QUERY,
  VALIDATION_ERROR,
  type ArchiveRecord,
  type RunActivities,
  type RunInput,
  type RunResult,
  type RunStatus,
} from "../src/temporal/types.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationFailure } from "@temporalio/common";

Runtime.install({ logger: new DefaultLogger("ERROR") });

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

// ---------- pure input rules ----------
const good: RunInput = { runId: "r1", workflowId: "w1", userId: "u1", steps: [{ id: "a", type: "navigate" }, { id: "b", type: "click" }] };
check("input rules: a good input has no problem", findRunInputProblem(good) === null);
check("input rules: no steps is refused", findRunInputProblem({ ...good, steps: [] }) !== null);
check("input rules: a repeated step id is refused", /twice/.test(findRunInputProblem({ ...good, steps: [{ id: "a", type: "x" }, { id: "a", type: "y" }] }) ?? ""));
check("input rules: a run id with a slash is refused", findRunInputProblem({ ...good, runId: "a/b" }) !== null);
check("input rules: MAX_STEPS steps pass and one more is refused",
  findRunInputProblem({ ...good, steps: Array.from({ length: MAX_STEPS }, (_, i) => ({ id: `s${i}`, type: "x" })) }) === null &&
    findRunInputProblem({ ...good, steps: Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({ id: `s${i}`, type: "x" })) }) !== null);
check("input rules: stepTimeoutMs 99 and 3600001 and 1.5 are refused, 100 and 3600000 pass",
  [99, 3_600_001, 1.5].every((ms) => findRunInputProblem({ ...good, stepTimeoutMs: ms }) !== null) &&
    [100, 3_600_000].every((ms) => findRunInputProblem({ ...good, stepTimeoutMs: ms }) === null));
check("input rules: null, a string and an array are refused", [null, "x", []].every((v) => findRunInputProblem(v) !== null));

// Property: over seeded random inputs, the rules agree with an independent description of a valid input.
{
  const r = rng(20261107);
  let agree = 0;
  const N = 1500;
  for (let n = 0; n < N; n++) {
    const count = Math.floor(r() * 5);
    const steps = Array.from({ length: count }, (_, i) => ({
      id: r() < 0.1 ? "dup" : r() < 0.05 ? "bad/id" : `s${i}`,
      type: r() < 0.05 ? "" : "navigate",
    }));
    const input = { ...good, steps, ...(r() < 0.3 ? { stepTimeoutMs: Math.floor(r() * 5000) } : {}) };
    const ids = steps.map((s) => s.id);
    const expectOk =
      count >= 1 &&
      steps.every((s) => /^[A-Za-z0-9_-]+$/.test(s.id) && s.type.length > 0) &&
      new Set(ids).size === ids.length &&
      (input.stepTimeoutMs === undefined || input.stepTimeoutMs >= 100);
    if ((findRunInputProblem(input) === null) === expectOk) agree++;
  }
  check(`input rules: ${N} seeded random inputs agree with an independent description`, agree === N, `${agree}/${N}`);
}

// ---------- the workflow on the time-skipping server ----------
const env = await TestWorkflowEnvironment.createTimeSkipping();
const bundle: WorkflowBundle = await bundleWorkflowCode({ workflowsPath });
let queueNo = 0;

type Calls = { validate: number; start: number; steps: Array<{ id: string; attempt: number }>; archived: ArchiveRecord[]; aborted: string[] };
function mocks(over: Partial<RunActivities> = {}, stepBehaviour?: (id: string, attempt: number, abort: AbortSignal) => Promise<void>) {
  const calls: Calls = { validate: 0, start: 0, steps: [], archived: [], aborted: [] };
  const acts: RunActivities = {
    async validateRun(input) {
      calls.validate++;
      const problem = findRunInputProblem(input);
      if (problem) throw ApplicationFailure.create({ message: problem, type: VALIDATION_ERROR });
    },
    async startRun() {
      calls.start++;
    },
    async executeStep(req) {
      const ctx = Context.current();
      const attempt = ctx.info.attempt;
      calls.steps.push({ id: req.step.id, attempt });
      const abort = new AbortController();
      ctx.cancellationSignal.addEventListener("abort", () => abort.abort(), { once: true });
      const beat = setInterval(() => ctx.heartbeat(), 100);
      try {
        await stepBehaviour?.(req.step.id, attempt, abort.signal);
      } finally {
        clearInterval(beat);
        if (abort.signal.aborted) calls.aborted.push(req.step.id);
      }
    },
    async archiveRun(record) {
      calls.archived.push(record);
      return `mem://${record.runId}`;
    },
    ...over,
  };
  return { acts, calls };
}

const SCENARIO_DEADLINE_MS = 40_000;
const forever = (abort: AbortSignal) =>
  new Promise<void>((_, reject) => abort.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 15000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition not reached in time");
    await sleepReal(25);
  }
}

async function scenario<T>(acts: RunActivities, input: RunInput, body: (h: WorkflowHandle, taskQueue: string) => Promise<T>): Promise<T> {
  const taskQueue = `q-${++queueNo}`;
  const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowBundle: bundle, activities: { ...acts }, ...HEARTBEAT_TUNING, shutdownGraceTime: "2 seconds" });
  // A scenario that never finishes (a broken workflow waits forever) must show up as a FAIL line, not as a hung test.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`scenario ${input.runId} did not finish in ${SCENARIO_DEADLINE_MS} ms`)), SCENARIO_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      worker.runUntil(async () => {
        const handle = await env.client.workflow.start("runWorkflow", { args: [input], taskQueue, workflowId: `wf-${input.runId}-${queueNo}` });
        return body(handle, taskQueue);
      }),
      deadline,
    ]);
  } catch (e) {
    if (!/did not finish/.test((e as Error).message)) throw e;
    console.log(`FAIL  ${(e as Error).message}`);
    await Promise.race([env.teardown(), sleepReal(5000)]);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

const input = (n: number, extra: Partial<RunInput> = {}): RunInput => ({
  runId: `run${n}`,
  workflowId: "w1",
  userId: "u1",
  steps: [{ id: "s1", type: "navigate" }, { id: "s2", type: "click" }, { id: "s3", type: "extract" }],
  ...extra,
});

try {
  // 1. plain success
  {
    const { acts, calls } = mocks();
    const res = await scenario(acts, input(1), (h) => h.result() as Promise<RunResult>);
    check("success: three steps run in order and the run completes", res.state === "completed" && calls.steps.map((s) => s.id).join() === "s1,s2,s3" && res.completedSteps.join() === "s1,s2,s3", JSON.stringify(res));
    check("success: validate and start ran once each, every step ran on its first try, and the archive was written once",
      calls.validate === 1 && calls.start === 1 && calls.steps.every((s) => s.attempt === 1) && calls.archived.length === 1 && res.archiveKey === "mem://run1");
    check("success: the archive record says completed with all three steps", calls.archived[0]?.state === "completed" && calls.archived[0]?.completedSteps.length === 3);
  }

  // 2. retry then success
  {
    const { acts, calls } = mocks({}, async (id, attempt) => {
      if (id === "s2" && attempt <= 2) throw new Error(`flaky on try ${attempt}`);
    });
    const res = await scenario(acts, input(2), (h) => h.result() as Promise<RunResult>);
    const s2 = calls.steps.filter((s) => s.id === "s2").map((s) => s.attempt);
    check("retry: a step that fails twice then works is tried 3 times and the run completes", res.state === "completed" && s2.join() === "1,2,3", `tries of s2: ${s2.join()} state ${res.state}`);
    check("retry: the steps after it still ran, once each", calls.steps.filter((s) => s.id === "s3").length === 1);
  }

  // 3. retries exhausted
  {
    const { acts, calls } = mocks({}, async (id) => {
      if (id === "s2") throw new Error("always broken");
    });
    const res = await scenario(acts, input(3), (h) => h.result() as Promise<RunResult>);
    const s2 = calls.steps.filter((s) => s.id === "s2").length;
    check(`retry exhausted: a step that never works is tried exactly ${RETRY_POLICY.maximumAttempts} times, then the run fails`, res.state === "failed" && s2 === RETRY_POLICY.maximumAttempts, `tries ${s2}, state ${res.state}`);
    check("retry exhausted: the failure names the step and the real error", /s2/.test(res.error ?? "") && /always broken/.test(res.error ?? ""), res.error);
    check("retry exhausted: s1 is recorded as done, s3 never ran, and the failed run was still archived",
      res.completedSteps.join() === "s1" && !calls.steps.some((s) => s.id === "s3") && calls.archived.length === 1 && calls.archived[0]?.state === "failed");
  }

  // 4. validation failure is not retried
  {
    const { acts, calls } = mocks();
    const bad = input(4, { steps: [] });
    const res = await scenario(acts, bad, (h) => h.result() as Promise<RunResult>);
    check("validation: a run with no steps fails at once, validate ran once (a non retryable error is not retried), no step ran",
      res.state === "failed" && calls.validate === 1 && calls.steps.length === 0 && calls.start === 0, `validate ${calls.validate} state ${res.state}`);
    check("validation: the error says why, and the run was archived", /at least one step/.test(res.error ?? "") && calls.archived.length === 1);
  }

  // 5. cancel in the middle of a run
  {
    const { acts, calls } = mocks({}, async (id, _a, abort) => {
      if (id === "s2") await forever(abort);
    });
    const res = await scenario(acts, input(5), async (h) => {
      await until(() => calls.steps.some((s) => s.id === "s2"));
      await h.signal(CANCEL_SIGNAL, "user pressed stop");
      return (await h.result()) as RunResult;
    });
    check("cancel: a signal while s2 runs ends the run as cancelled with the reason", res.state === "cancelled" && res.error === "user pressed stop", JSON.stringify(res));
    check("cancel: s1 is done, s3 never started, and the running step was told to stop", res.completedSteps.join() === "s1" && !calls.steps.some((s) => s.id === "s3") && calls.aborted.includes("s2"), `aborted ${calls.aborted.join()}`);
    check("cancel: the cancelled run was still archived", calls.archived.length === 1 && calls.archived[0]?.state === "cancelled");
  }

  // 5b. cancel that arrives before the first step finishes starting: signal sent right after start
  {
    const { acts, calls } = mocks({}, async (_id, _a, abort) => forever(abort));
    const res = await scenario(acts, input(55), async (h) => {
      await until(() => calls.steps.length > 0);
      await h.signal(CANCEL_SIGNAL);
      return (await h.result()) as RunResult;
    });
    check("cancel: a cancel during the very first step leaves nothing completed and no second step", res.state === "cancelled" && res.completedSteps.length === 0 && calls.steps.length === 1);
  }

  // 6. step timeout: the step never finishes, so the workflow's own timer ends it. The test server does not skip time while
  // an activity is running, so this one uses a short real budget (300 ms).
  {
    const { acts, calls } = mocks({}, async (id, _a, abort) => {
      if (id === "s2") await forever(abort);
    });
    const res = await scenario(acts, input(6, { stepTimeoutMs: 300 }), (h) => h.result() as Promise<RunResult>);
    check("timeout: a step that never finishes ends the run as timed_out after its budget", res.state === "timed_out" && /s2/.test(res.error ?? "") && res.completedSteps.join() === "s1", JSON.stringify(res));
    check("timeout: s3 never ran, the stuck step was told to stop, and the run was archived as timed_out",
      !calls.steps.some((s) => s.id === "s3") && calls.aborted.includes("s2") && calls.archived[0]?.state === "timed_out");
  }

  // 7. the step budget covers its retries
  {
    const { acts, calls } = mocks({}, async (id) => {
      if (id === "s1") throw new Error("slow to heal");
    });
    // back-offs are 1 s then 2 s: tries at 0 s, 1 s, 3 s. A 2.5 s budget ends the step after the second try.
    const res = await scenario(acts, input(7, { stepTimeoutMs: 2500 }), (h) => h.result() as Promise<RunResult>);
    const tries = calls.steps.filter((s) => s.id === "s1").length;
    check("timeout: the step budget covers retries, so a retrying step ends as timed_out before its tries run out", res.state === "timed_out" && tries >= 1 && tries < RETRY_POLICY.maximumAttempts, `tries ${tries} state ${res.state}`);
  }

  // 8. the status query
  {
    const { acts, calls } = mocks({}, async (id, _a, abort) => {
      if (id === "s2") await forever(abort);
    });
    const seen = await scenario(acts, input(8), async (h) => {
      await until(() => calls.steps.some((s) => s.id === "s2"));
      const mid = await h.query<RunStatus>(STATUS_QUERY);
      await h.signal(CANCEL_SIGNAL);
      const res = (await h.result()) as RunResult;
      const end = await h.query<RunStatus>(STATUS_QUERY);
      return { mid, end, res };
    });
    check("status query: while s2 runs it reports running, step 2 of 3, s1 done", seen.mid.state === "running" && seen.mid.currentStep === 2 && seen.mid.totalSteps === 3 && seen.mid.completedSteps.join() === "s1", JSON.stringify(seen.mid));
    check("status query: after the run it reports the final state and the reason", seen.end.state === "cancelled", JSON.stringify(seen.end));
  }

  // 9. an archive that fails does not change how the run ended
  {
    const { acts, calls } = mocks({
      async archiveRun() {
        throw new Error("disk full");
      },
    });
    const res = await scenario(acts, input(9), (h) => h.result() as Promise<RunResult>);
    check("archive failure: the run still ends completed, with the archive error recorded and no archive key", res.state === "completed" && /disk full/.test(res.archiveError ?? "") && res.archiveKey === undefined, JSON.stringify(res));
    check("archive failure: steps ran once each", calls.steps.length === 3);
  }

  // 10. the real activity implementations (dry-run executor + file archive) through the same workflow
  {
    const dir = mkdtempSync(join(tmpdir(), "temporal-archive-"));
    try {
      const executor = new DryRunExecutor();
      const real = createActivities({ executor, archive: new FileRunArchive(dir) });
      const flaky = input(10, { steps: [{ id: "a", type: "navigate", config: { failFirstAttempts: 1 } }, { id: "b", type: "wait", config: { ms: 50 } }] });
      const res = await scenario(real, flaky, (h) => h.result() as Promise<RunResult>);
      const file = JSON.parse(readFileSync(join(dir, "run10.json"), "utf8")) as ArchiveRecord;
      check("real activities: the dry-run executor fails step a once, the retry works, the run completes", res.state === "completed" && executor.log.join("|") === "run10:a:navigate:try2|run10:b:wait:try1", executor.log.join("|"));
      check("real activities: the archive file holds the final record", file.state === "completed" && file.completedSteps.join() === "a,b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  await env.teardown();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
