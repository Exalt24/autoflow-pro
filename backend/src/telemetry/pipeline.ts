import { dayOf, type RejectReason } from "./schema.js";
import { ReadingStore, quarantineKeyOf, type StoreConfig } from "./store.js";
import { RESOLUTIONS, RollupIndex, type RollupConfig } from "./rollup.js";
import { readQuarantine, readReadings, rollupBody, rollupKey, writeQuarantine, writeReadings, writeRollupDay, type LakeStore } from "./lake.js";

// Store + rollups + lake, with the order that makes a crash harmless:
//
//   1. stage        decide what the batch means; nothing in memory changes
//   2. write        readings and quarantined input go to the lake (replacing the same files on a retry)
//   3. apply        only now does memory change
//   4. rollups      the touched buckets are recomputed and their day files replaced
//
// The caller acknowledges the message after process() resolves. A failure in step 2 leaves memory untouched, so the
// retry stages the same batch as new. A failure in step 4 leaves the day in pendingDays; the next process() call (a retry,
// or the next message) writes it before anything else. A restart rebuilds memory from the lake (open()), where every
// reading that was written is a duplicate when its message arrives again.

export interface PipelineOptions extends StoreConfig, RollupConfig {
  now?: () => number;
}

export interface ProcessResult {
  received: number;
  accepted: number;
  duplicates: number;
  lateMerged: number;
  quarantined: number;
  reasons: Partial<Record<RejectReason, number>>;
  rollupFilesWritten: number;
}

export class TelemetryPipeline {
  readonly store: ReadingStore;
  readonly rollups: RollupIndex;
  private pendingDays = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private now: () => number;

  constructor(readonly lake: LakeStore, readonly opts: PipelineOptions) {
    this.store = new ReadingStore({ allowedLatenessMs: opts.allowedLatenessMs, maxFutureMs: opts.maxFutureMs });
    this.rollups = new RollupIndex(this.store, { expectedIntervalMs: opts.expectedIntervalMs });
    this.now = opts.now ?? Date.now;
  }

  /** A pipeline whose memory is rebuilt from what the lake holds, with every rollup file checked and repaired. */
  static async open(lake: LakeStore, opts: PipelineOptions): Promise<{ pipeline: TelemetryPipeline; restored: number; rollupFilesRepaired: number }> {
    const p = new TelemetryPipeline(lake, opts);
    const readings = await readReadings(lake);
    const inserted = p.store.restore(readings);
    for (const e of await readQuarantine(lake)) p.store.quarantine.set(quarantineKeyOf(e), e);
    p.rollups.markInserted(inserted);
    const flushed = p.rollups.flush();
    let repaired = 0;
    for (const entry of flushed.days) {
      const [assetId, day] = entry.split("|");
      for (const res of RESOLUTIONS) {
        const want = rollupBody(p.rollups.rowsForDay(assetId, res.name, day));
        const have = await lake.get(rollupKey(res.name, assetId, day));
        if (have !== want) {
          await writeRollupDay(lake, res.name, assetId, day, p.rollups.rowsForDay(assetId, res.name, day));
          repaired++;
        }
      }
    }
    return { pipeline: p, restored: inserted.length, rollupFilesRepaired: repaired };
  }

  /** One batch at a time, in arrival order, whatever the caller does concurrently. */
  process(raws: unknown[], batchId: string): Promise<ProcessResult> {
    const run = this.tail.then(() => this.processNow(raws, batchId));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async processNow(raws: unknown[], batchId: string): Promise<ProcessResult> {
    let written = await this.flushRollups();
    const nowMs = this.now();
    const staged = this.store.stage(raws, nowMs);
    await writeReadings(this.lake, staged.accepted, batchId);
    await writeQuarantine(this.lake, dayOf(nowMs), staged.quarantined, batchId);
    const inserted = this.store.apply(staged);
    this.rollups.markInserted(inserted);
    written += await this.flushRollups();
    const quarantined = Object.values(staged.reasons).reduce((a, b) => a + (b ?? 0), 0);
    return {
      received: staged.received,
      accepted: staged.accepted.length,
      duplicates: staged.duplicates,
      lateMerged: staged.lateMerged,
      quarantined,
      reasons: staged.reasons,
      rollupFilesWritten: written,
    };
  }

  /** Recompute the touched buckets and replace the day files that hold them. Days not yet written stay pending. */
  private async flushRollups(): Promise<number> {
    for (const d of this.rollups.flush().days) this.pendingDays.add(d);
    let written = 0;
    for (const entry of [...this.pendingDays].sort()) {
      const [assetId, day] = entry.split("|");
      for (const res of RESOLUTIONS) {
        await writeRollupDay(this.lake, res.name, assetId, day, this.rollups.rowsForDay(assetId, res.name, day));
        written++;
      }
      this.pendingDays.delete(entry);
    }
    return written;
  }
}
