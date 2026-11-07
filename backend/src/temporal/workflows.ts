// The workflow: one automation run as a sequence of activities. Workflow code must be deterministic, so it does no I/O:
// everything that touches the world is an activity.
//   validate -> start -> execute each step (retry, step timeout, cancel) -> archive (always, even after a failure or cancel)
import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import {
  CANCEL_SIGNAL,
  RETRY_POLICY,
  STATUS_QUERY,
  type FinalRunState,
  type RunActivities,
  type RunInput,
  type RunResult,
  type RunStatus,
} from "./types.js";
import { stepTimeoutOf } from "./validation.js";

export const cancelRunSignal = defineSignal<[string?]>(CANCEL_SIGNAL);
export const statusQuery = defineQuery<RunStatus>(STATUS_QUERY);

const acts = proxyActivities<RunActivities>({
  startToCloseTimeout: "30 seconds",
  retry: RETRY_POLICY,
  // Let the workflow move on at once when a step is cancelled or times out, instead of waiting for the activity to confirm.
  cancellationType: ActivityCancellationType.TRY_CANCEL,
});

type StepOutcome = "ok" | "timeout" | "cancelled";

export async function runWorkflow(input: RunInput): Promise<RunResult> {
  const status: RunStatus = {
    runId: input.runId,
    state: "pending",
    currentStep: 0,
    totalSteps: input.steps?.length ?? 0,
    completedSteps: [],
  };
  let cancelRequested = false;
  let cancelReason: string | undefined;

  setHandler(cancelRunSignal, (reason) => {
    cancelRequested = true;
    cancelReason = reason;
  });
  setHandler(statusQuery, () => ({ ...status, completedSteps: [...status.completedSteps] }));

  const finish = async (state: FinalRunState, error?: string): Promise<RunResult> => {
    status.state = "archiving";
    const result: RunResult = { runId: input.runId, state, completedSteps: [...status.completedSteps] };
    if (error) result.error = error;
    try {
      // Not cancellable: a cancelled run still has to be written down.
      result.archiveKey = await CancellationScope.nonCancellable(() =>
        acts.archiveRun({
          runId: input.runId,
          workflowId: input.workflowId,
          userId: input.userId,
          state,
          completedSteps: result.completedSteps,
          ...(error ? { error } : {}),
        }),
      );
    } catch (e) {
      result.archiveError = messageOf(e);
    }
    status.state = state;
    if (error) status.error = error;
    return result;
  };

  // One step with a deadline (which covers its retries) and a cancel signal that can arrive at any moment.
  const runStep = async (index: number): Promise<StepOutcome> => {
    const step = input.steps[index]!;
    const work = new CancellationScope();
    const watchers = new CancellationScope();
    const done = work.run(() => acts.executeStep({ runId: input.runId, index, step })).then(() => "ok" as const);
    const timer = watchers.run(() => sleep(stepTimeoutOf(input))).then(() => "timeout" as const);
    const cancel = watchers.run(() => condition(() => cancelRequested)).then(() => "cancelled" as const);
    // A watcher that is cancelled because the step finished first rejects; that is expected and not an error.
    timer.catch(() => undefined);
    cancel.catch(() => undefined);
    try {
      const outcome = await Promise.race([done, timer, cancel]);
      if (outcome !== "ok") {
        work.cancel();
        await done.catch(() => undefined);
      }
      return outcome;
    } finally {
      watchers.cancel();
    }
  };

  status.state = "validating";
  try {
    await acts.validateRun(input);
  } catch (e) {
    return finish("failed", `validation failed: ${messageOf(e)}`);
  }
  if (cancelRequested) return finish("cancelled", cancelReason);

  status.state = "running";
  try {
    await acts.startRun(input);
  } catch (e) {
    return finish("failed", `could not start: ${messageOf(e)}`);
  }

  for (let i = 0; i < input.steps.length; i++) {
    if (cancelRequested) return finish("cancelled", cancelReason);
    status.currentStep = i + 1;
    const step = input.steps[i]!;
    let outcome: StepOutcome;
    try {
      outcome = await runStep(i);
    } catch (e) {
      if (isCancellation(e)) return finish("cancelled", cancelReason);
      return finish("failed", `step ${step.id} failed: ${messageOf(e)}`);
    }
    if (outcome === "timeout") return finish("timed_out", `step ${step.id} did not finish within ${stepTimeoutOf(input)} ms`);
    if (outcome === "cancelled") return finish("cancelled", cancelReason);
    status.completedSteps.push(step.id);
  }
  return finish("completed");
}

// An ActivityFailure wraps the real error; the innermost cause carries the message a person wants to read.
function messageOf(e: unknown): string {
  let cur: unknown = e;
  let msg = e instanceof Error ? e.message : String(e);
  while (cur instanceof Error && (cur as { cause?: unknown }).cause instanceof Error) {
    cur = (cur as { cause?: unknown }).cause;
    msg = (cur as Error).message;
  }
  return msg;
}
