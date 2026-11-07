// Activities: everything the workflow does that touches the world. Dependencies are passed in, so the worker uses the
// default ones below and a test passes its own.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { findRunInputProblem } from "./validation.js";
import { VALIDATION_ERROR, type ArchiveRecord, type RunActivities, type RunInput, type RunStepInput } from "./types.js";

export interface StepContext {
  runId: string;
  index: number;
  /** 1 for the first try of this step, 2 for the first retry, and so on. */
  attempt: number;
}

export interface StepExecutor {
  execute(step: RunStepInput, ctx: StepContext, signal: AbortSignal): Promise<void>;
}

export interface RunArchive {
  /** Stores the record and returns where it went. Writing the same run twice replaces the file, so a retry is safe. */
  write(record: ArchiveRecord): Promise<string>;
}

/** Called by the activities so another part of the system (the GraphQL run store) can follow a run. */
export interface RunRecorder {
  started(input: RunInput): void | Promise<void>;
  /** A step ended without an error, so a reader sees progress while the run is still going. */
  stepDone?(runId: string, stepId: string): void | Promise<void>;
  finished(record: ArchiveRecord, archiveKey: string): void | Promise<void>;
}

export interface ActivityDeps {
  executor: StepExecutor;
  archive: RunArchive;
  recorder?: RunRecorder;
}

const HEARTBEAT_MS = 500;

export function createActivities(deps: ActivityDeps): RunActivities {
  return {
    async validateRun(input) {
      const problem = findRunInputProblem(input);
      // Retryable by its own flag; it is the retry policy's nonRetryableErrorTypes that stops the retries.
      if (problem) throw ApplicationFailure.create({ message: problem, type: VALIDATION_ERROR });
    },
    async startRun(input) {
      await deps.recorder?.started(input);
    },
    async executeStep(req) {
      const ctx = Context.current();
      const abort = new AbortController();
      ctx.cancellationSignal.addEventListener("abort", () => abort.abort(), { once: true });
      // Temporal tells a running activity it was cancelled only in the answer to a heartbeat, so a step that can take a
      // while heartbeats; that is how a timeout or a cancel signal reaches the executor.
      const beat = setInterval(() => ctx.heartbeat(), HEARTBEAT_MS);
      try {
        await deps.executor.execute(req.step, { runId: req.runId, index: req.index, attempt: ctx.info.attempt }, abort.signal);
      } finally {
        clearInterval(beat);
      }
      await deps.recorder?.stepDone?.(req.runId, req.step.id);
    },
    async archiveRun(record) {
      const key = await deps.archive.write(record);
      await deps.recorder?.finished(record, key);
      return key;
    },
  };
}

/**
 * The step executor the dev worker starts with. It does NOT open a browser: it records that a step ran, waits for a
 * `wait` step's `ms`, and can fail on purpose so retries can be seen:
 *   config.failFirstAttempts: n   the first n tries of this step throw (a retry then succeeds)
 *   config.alwaysFail: true       every try throws (the retries run out)
 *   config.ms: n                  the step takes n milliseconds (capped at 10 minutes)
 * A step id that starts with `flaky`, `slow` or `broken` gets failFirstAttempts 2, ms 20000 or alwaysFail without any config.
 */
export class DryRunExecutor implements StepExecutor {
  readonly log: string[] = [];
  /** Every try of every step, including the ones that failed, keyed `runId:stepId`. */
  readonly tries = new Map<string, number>();

  async execute(step: RunStepInput, ctx: StepContext, signal: AbortSignal): Promise<void> {
    const key = `${ctx.runId}:${step.id}`;
    this.tries.set(key, (this.tries.get(key) ?? 0) + 1);
    const cfg = { ...demoBehaviour(step.id), ...step.config };
    const ms = typeof cfg.ms === "number" && cfg.ms > 0 ? Math.min(cfg.ms, 600_000) : 0;
    if (ms > 0) await abortableDelay(ms, signal);
    if (cfg.alwaysFail === true) throw new Error(`step ${step.id} was told to always fail`);
    if (typeof cfg.failFirstAttempts === "number" && ctx.attempt <= cfg.failFirstAttempts) {
      throw new Error(`step ${step.id} failed on purpose, try ${ctx.attempt}`);
    }
    this.log.push(`${ctx.runId}:${step.id}:${step.type}:try${ctx.attempt}`);
  }
}

/** Lets a demo make a step misbehave through its id alone, since the GraphQL step input has no config. */
function demoBehaviour(stepId: string): Record<string, unknown> {
  if (stepId.startsWith("flaky")) return { failFirstAttempts: 2 };
  if (stepId.startsWith("slow")) return { ms: 20_000 };
  if (stepId.startsWith("broken")) return { alwaysFail: true };
  return {};
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("cancelled"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Writes one JSON file per run. A temp file and a rename mean a reader never sees half a record. */
export class FileRunArchive implements RunArchive {
  constructor(private readonly dir: string) {}

  async write(record: ArchiveRecord): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${record.runId}.json`);
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(record, null, 2));
    await rename(tmp, file);
    return file;
  }
}
