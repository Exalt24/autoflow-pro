import { fileURLToPath } from "node:url";
import { NativeConnection, Worker, type WorkerOptions } from "@temporalio/worker";
import { TASK_QUEUE, type RunActivities } from "./types.js";

// Under tsx this file is a .ts; from the build it is a .js. The workflow bundle is made from whichever sits beside it.
const ext = import.meta.url.endsWith(".ts") ? "ts" : "js";
export const workflowsPath = fileURLToPath(new URL(`./workflows.${ext}`, import.meta.url));

/** Cancellation reaches a running activity in the answer to a heartbeat, so heartbeats must not be held back for long. */
export const HEARTBEAT_TUNING = {
  defaultHeartbeatThrottleInterval: "250 ms",
  maxHeartbeatThrottleInterval: "500 ms",
} as const;

export interface WorkerSettings {
  address: string;
  namespace?: string;
  taskQueue?: string;
  activities: RunActivities;
}

export async function createRunWorker(s: WorkerSettings): Promise<{ worker: Worker; connection: NativeConnection }> {
  const connection = await NativeConnection.connect({ address: s.address });
  const options: WorkerOptions = {
    connection,
    namespace: s.namespace ?? "default",
    taskQueue: s.taskQueue ?? TASK_QUEUE,
    workflowsPath,
    ...HEARTBEAT_TUNING,
    activities: { ...s.activities },
  };
  return { worker: await Worker.create(options), connection };
}
