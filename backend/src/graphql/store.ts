// The run model behind the GraphQL API. RunStore is the interface the resolvers use; MemoryRunStore is the one that ships
// (and the one the tests and the demo use). It also implements RunRecorder, so the Temporal activities can move a run
// from queued to running to its final state in the same store the API reads.
import { randomUUID } from "node:crypto";
import type { ArchiveRecord, RunInput } from "../temporal/types.js";
import type { RunRecorder } from "../temporal/activities.js";

export type StoredState = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
export const TERMINAL_STATES: ReadonlySet<StoredState> = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);

export interface WorkflowModel {
  id: string;
  name: string;
  description: string | null;
  steps: Array<{ id: string; type: string }>;
  createdAt: string;
}

export interface RunModel {
  id: string;
  /** Creation order, 1 for the first run. The newest-first order and the cursors are built on it. */
  seq: number;
  workflowId: string;
  state: StoredState;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  completedSteps: string[];
  totalSteps: number;
  error: string | null;
  cancelRequested: boolean;
  archiveKey: string | null;
}

export interface Page<T> {
  items: T[];
  hasNextPage: boolean;
  totalCount: number;
}

export interface RunFilter {
  workflowId?: string;
  state?: StoredState;
}

export interface RunStore {
  createWorkflow(input: { name: string; description: string | null; steps: Array<{ id: string; type: string }> }): Promise<WorkflowModel>;
  getWorkflowsByIds(ids: readonly string[]): Promise<Array<WorkflowModel | null>>;
  listWorkflows(page: { first: number; afterId: string | null }): Promise<Page<WorkflowModel>>;
  createRun(workflow: WorkflowModel): Promise<RunModel>;
  getRunsByIds(ids: readonly string[]): Promise<Array<RunModel | null>>;
  /** Newest first. `after` is the position of the last item the caller already has. */
  listRuns(filter: RunFilter, page: { first: number; after: RunPosition | null }): Promise<Page<RunModel>>;
  /** For a batch of workflows at once: their runs, newest first. */
  runsForWorkflows(ids: readonly string[]): Promise<Array<RunModel[]>>;
  markRunFailed(runId: string, error: string): Promise<RunModel | null>;
  requestCancel(runId: string): Promise<RunModel | null>;
}

/** A position in the newest-first run order: the pair never repeats, so a cursor is exact even with equal timestamps. */
export interface RunPosition {
  seq: number;
}

export class MemoryRunStore implements RunStore, RunRecorder {
  private readonly workflows = new Map<string, WorkflowModel>();
  private readonly workflowOrder: string[] = [];
  private readonly runs = new Map<string, RunModel>();
  private nextSeq = 1;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createWorkflow(input: { name: string; description: string | null; steps: Array<{ id: string; type: string }> }) {
    const w: WorkflowModel = { id: randomUUID(), ...input, createdAt: this.now().toISOString() };
    this.workflows.set(w.id, w);
    this.workflowOrder.push(w.id);
    return w;
  }

  async getWorkflowsByIds(ids: readonly string[]) {
    return ids.map((id) => this.workflows.get(id) ?? null);
  }

  async listWorkflows(page: { first: number; afterId: string | null }) {
    let start = 0;
    if (page.afterId !== null) {
      const at = this.workflowOrder.indexOf(page.afterId);
      start = at === -1 ? this.workflowOrder.length : at + 1;
    }
    const ids = this.workflowOrder.slice(start, start + page.first);
    return {
      items: ids.map((id) => this.workflows.get(id)!),
      hasNextPage: start + page.first < this.workflowOrder.length,
      totalCount: this.workflowOrder.length,
    };
  }

  async createRun(workflow: WorkflowModel) {
    const run: RunModel = {
      id: randomUUID(),
      seq: this.nextSeq++,
      workflowId: workflow.id,
      state: "QUEUED",
      createdAt: this.now().toISOString(),
      startedAt: null,
      finishedAt: null,
      completedSteps: [],
      totalSteps: workflow.steps.length,
      error: null,
      cancelRequested: false,
      archiveKey: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async getRunsByIds(ids: readonly string[]) {
    return ids.map((id) => this.runs.get(id) ?? null);
  }

  private newestFirst(filter: RunFilter): RunModel[] {
    return [...this.runs.values()]
      .filter((r) => (filter.workflowId === undefined || r.workflowId === filter.workflowId) && (filter.state === undefined || r.state === filter.state))
      .sort((a, b) => b.seq - a.seq);
  }

  async listRuns(filter: RunFilter, page: { first: number; after: RunPosition | null }) {
    const all = this.newestFirst(filter);
    const rest = page.after === null ? all : all.filter((r) => r.seq < page.after!.seq);
    return { items: rest.slice(0, page.first), hasNextPage: rest.length > page.first, totalCount: all.length };
  }

  async runsForWorkflows(ids: readonly string[]) {
    const wanted = new Set(ids);
    const by = new Map<string, RunModel[]>();
    for (const r of this.newestFirst({})) {
      if (!wanted.has(r.workflowId)) continue;
      const list = by.get(r.workflowId) ?? [];
      list.push(r);
      by.set(r.workflowId, list);
    }
    return ids.map((id) => by.get(id) ?? []);
  }

  async markRunFailed(runId: string, error: string) {
    const r = this.runs.get(runId);
    if (!r) return null;
    r.state = "FAILED";
    r.error = error;
    r.finishedAt = this.now().toISOString();
    return r;
  }

  async requestCancel(runId: string) {
    const r = this.runs.get(runId);
    if (!r) return null;
    r.cancelRequested = true;
    return r;
  }

  // ---- RunRecorder: called by the Temporal activities
  started(input: RunInput): void {
    const r = this.runs.get(input.runId);
    if (!r || TERMINAL_STATES.has(r.state)) return;
    r.state = "RUNNING";
    r.startedAt = r.startedAt ?? this.now().toISOString();
  }

  stepDone(runId: string, stepId: string): void {
    const r = this.runs.get(runId);
    if (r && !TERMINAL_STATES.has(r.state) && !r.completedSteps.includes(stepId)) r.completedSteps.push(stepId);
  }

  finished(record: ArchiveRecord, archiveKey: string): void {
    const r = this.runs.get(record.runId);
    if (!r) return;
    r.state = record.state.toUpperCase() as StoredState;
    r.completedSteps = [...record.completedSteps];
    r.error = record.error ?? null;
    r.archiveKey = archiveKey;
    r.finishedAt = this.now().toISOString();
  }
}
