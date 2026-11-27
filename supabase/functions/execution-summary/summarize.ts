// Pure summary logic for the execution-summary edge function. No Deno or network calls in this file,
// so the backend test scripts can import it with tsx and the function imports the same code.

export interface ExecutionRow {
  workflow_id: string;
  status: "queued" | "running" | "completed" | "failed";
  started_at: string;
  duration: number | null;
}

export interface WorkflowSummary {
  workflow_id: string;
  total: number;
  completed: number;
  failed: number;
  in_flight: number;
  // completed / (completed + failed), or null when nothing has finished yet
  success_rate: number | null;
  // milliseconds, averaged over finished runs that recorded a duration, or null
  avg_duration_ms: number | null;
}

export interface Summary {
  days: number;
  since: string;
  total: number;
  workflows: WorkflowSummary[];
}

export const MIN_DAYS = 1;
export const MAX_DAYS = 90;
export const DEFAULT_DAYS = 7;

// Reads the days query value. Missing means the default; anything that is not a whole number
// from MIN_DAYS to MAX_DAYS is an error the caller turns into a 400, never silently clamped.
export function parseDays(raw: string | null): { ok: true; days: number } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, days: DEFAULT_DAYS };
  if (!/^\d+$/.test(raw)) return { ok: false, error: "days must be a whole number" };
  const days = Number(raw);
  if (days < MIN_DAYS || days > MAX_DAYS) return { ok: false, error: `days must be from ${MIN_DAYS} to ${MAX_DAYS}` };
  return { ok: true, days };
}

export function sinceFor(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function summarize(rows: ExecutionRow[], now: Date, days: number): Summary {
  const byWorkflow = new Map<string, { total: number; completed: number; failed: number; inFlight: number; durSum: number; durCount: number }>();
  for (const r of rows) {
    let w = byWorkflow.get(r.workflow_id);
    if (!w) {
      w = { total: 0, completed: 0, failed: 0, inFlight: 0, durSum: 0, durCount: 0 };
      byWorkflow.set(r.workflow_id, w);
    }
    w.total += 1;
    if (r.status === "completed") w.completed += 1;
    else if (r.status === "failed") w.failed += 1;
    else w.inFlight += 1;
    if ((r.status === "completed" || r.status === "failed") && typeof r.duration === "number") {
      w.durSum += r.duration;
      w.durCount += 1;
    }
  }
  const workflows: WorkflowSummary[] = [...byWorkflow.entries()]
    .map(([workflow_id, w]) => {
      const finished = w.completed + w.failed;
      return {
        workflow_id,
        total: w.total,
        completed: w.completed,
        failed: w.failed,
        in_flight: w.inFlight,
        success_rate: finished === 0 ? null : Math.round((w.completed / finished) * 1000) / 1000,
        avg_duration_ms: w.durCount === 0 ? null : Math.round(w.durSum / w.durCount),
      };
    })
    .sort((a, b) => b.total - a.total || a.workflow_id.localeCompare(b.workflow_id));
  return { days, since: sinceFor(now, days), total: rows.length, workflows };
}
