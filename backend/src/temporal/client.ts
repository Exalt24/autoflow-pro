import { Client, Connection, WorkflowIdReusePolicy, type WorkflowHandle } from "@temporalio/client";
import { CANCEL_SIGNAL, STATUS_QUERY, TASK_QUEUE, runWorkflowId, type RunInput, type RunResult, type RunStatus } from "./types.js";
import type { runWorkflow } from "./workflows.js";

/** The small surface the rest of the app uses to drive a run, so the GraphQL layer can be tested with a fake. */
export interface RunLauncher {
  start(input: RunInput): Promise<{ workflowId: string }>;
  cancel(runId: string, reason?: string): Promise<void>;
  status(runId: string): Promise<RunStatus>;
}

export class TemporalRunLauncher implements RunLauncher {
  constructor(
    private readonly client: Client,
    private readonly taskQueue = TASK_QUEUE,
  ) {}

  static async connect(address: string, namespace = "default", taskQueue = TASK_QUEUE): Promise<TemporalRunLauncher> {
    const connection = await Connection.connect({ address });
    return new TemporalRunLauncher(new Client({ connection, namespace }), taskQueue);
  }

  async start(input: RunInput): Promise<{ workflowId: string }> {
    const workflowId = runWorkflowId(input.runId);
    await this.client.workflow.start<typeof runWorkflow>("runWorkflow", {
      args: [input],
      taskQueue: this.taskQueue,
      workflowId,
      // Starting the same run id twice must not run it twice.
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    });
    return { workflowId };
  }

  private handle(runId: string): WorkflowHandle {
    return this.client.workflow.getHandle(runWorkflowId(runId));
  }

  async cancel(runId: string, reason?: string): Promise<void> {
    await this.handle(runId).signal(CANCEL_SIGNAL, reason);
  }

  async status(runId: string): Promise<RunStatus> {
    return this.handle(runId).query<RunStatus>(STATUS_QUERY);
  }

  async result(runId: string): Promise<RunResult> {
    return this.handle(runId).result();
  }

  close(): void {
    this.client.connection.close();
  }
}
