import { isoOf, sameValues, validateReading, type Reading, type RejectReason } from "./schema.js";

// The reading store: idempotent by (asset id, timestamp), a watermark per asset, and a quarantine list.
//
// Rules, in the order a reading meets them:
//  1. The schema (schema.ts). A reading that fails is quarantined with that reason and never loaded.
//  2. A key (asset id, ts) that is already stored: the same values are a no-op ("duplicate"); different values are
//     quarantined as conflicting_duplicate. First write wins. The rule does not depend on how many times a batch is
//     replayed, so replaying any batch, in any order, changes nothing.
//  3. Lateness. The watermark of an asset is its newest accepted timestamp minus allowedLatenessMs. A reading older than
//     the watermark is quarantined as too_late; one at or after it is merged, even if it arrives out of order.
//  Readings are judged in arrival order, so a stream split into batches of any size has the same outcome.
//
// stage() decides and changes nothing; apply() changes memory. The caller writes the staged result somewhere durable
// between the two, so a failed write leaves the store as it was and a retry sees the batch as new.

export interface StoreConfig {
  allowedLatenessMs: number;
  maxFutureMs: number;
}

export interface QuarantineEntry {
  reason: RejectReason;
  detail: string;
  assetId: string | null;
  ts: string | null;
  /** The rejected input as JSON text, cut at 2000 characters. */
  raw: string;
}

export interface Series {
  /** Ascending, unique. rows[i] is the reading at ts[i]. */
  ts: number[];
  rows: Reading[];
}

export interface StagedBatch {
  received: number;
  accepted: Reading[];
  /** Same key, same values, already stored (or earlier in this batch). */
  duplicates: number;
  /** Accepted readings that arrived behind a newer one of the same asset (out of order, inside the allowed lateness). */
  lateMerged: number;
  /** Entries not yet in the quarantine list, one per distinct rejected input. These are what the caller persists. */
  quarantined: QuarantineEntry[];
  /** Every rejected input of the batch by reason, repeats included. received = accepted + duplicates + sum(reasons). */
  reasons: Partial<Record<RejectReason, number>>;
}

export interface Inserted {
  reading: Reading;
  /** The timestamp of the reading just before it in its series, or null. The segment between them changed. */
  prevTs: number | null;
}

export function lowerBound(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function describeRaw(raw: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(raw) ?? String(raw);
  } catch {
    text = String(raw);
  }
  return text.slice(0, 2000);
}

function looseField(raw: unknown, field: string): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>)[field];
  return typeof v === "string" ? v.slice(0, 80) : null;
}

export function quarantineEntry(reason: RejectReason, detail: string, raw: unknown): QuarantineEntry {
  return { reason, detail, assetId: looseField(raw, "asset_id"), ts: looseField(raw, "ts"), raw: describeRaw(raw) };
}

export const quarantineKeyOf = (e: QuarantineEntry): string => `${e.reason}|${e.raw}`;

export class ReadingStore {
  readonly series = new Map<string, Series>();
  readonly quarantine = new Map<string, QuarantineEntry>();

  constructor(readonly cfg: StoreConfig) {}

  get(assetId: string, ts: number): Reading | undefined {
    const s = this.series.get(assetId);
    if (!s) return undefined;
    const i = lowerBound(s.ts, ts);
    return s.ts[i] === ts ? s.rows[i] : undefined;
  }

  /** The newest accepted timestamp minus the allowed lateness, or null for an asset never seen. */
  watermark(assetId: string): number | null {
    const s = this.series.get(assetId);
    if (!s || s.ts.length === 0) return null;
    return s.ts[s.ts.length - 1] - this.cfg.allowedLatenessMs;
  }

  count(): number {
    let n = 0;
    for (const s of this.series.values()) n += s.ts.length;
    return n;
  }

  stage(raws: unknown[], nowMs: number): StagedBatch {
    const accepted: Reading[] = [];
    const quarantined: QuarantineEntry[] = [];
    const seenKeys = new Set<string>();
    const reasons: Partial<Record<RejectReason, number>> = {};
    const pending = new Map<string, Reading>();
    const batchTop = new Map<string, number>();
    let duplicates = 0;
    let lateMerged = 0;

    const reject = (reason: RejectReason, detail: string, raw: unknown) => {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      const entry = quarantineEntry(reason, detail, raw);
      const key = quarantineKeyOf(entry);
      if (!this.quarantine.has(key) && !seenKeys.has(key)) {
        seenKeys.add(key);
        quarantined.push(entry);
      }
    };

    for (const raw of raws) {
      const v = validateReading(raw, { nowMs, maxFutureMs: this.cfg.maxFutureMs });
      if (!v.ok) {
        reject(v.reason, v.detail, raw);
        continue;
      }
      const r = v.reading;
      const key = `${r.assetId}|${r.ts}`;
      const existing = pending.get(key) ?? this.get(r.assetId, r.ts);
      if (existing) {
        if (sameValues(existing, r)) duplicates++;
        else reject("conflicting_duplicate", `already stored at ${isoOf(r.ts)} with other values; the first write is kept`, raw);
        continue;
      }
      let top = batchTop.get(r.assetId);
      if (top === undefined) {
        const s = this.series.get(r.assetId);
        top = s && s.ts.length > 0 ? s.ts[s.ts.length - 1] : -Infinity;
      }
      const watermark = top - this.cfg.allowedLatenessMs;
      if (r.ts < watermark) {
        const behindMs = watermark - r.ts;
        reject("too_late", `older than the watermark by ${behindMs} ms`, raw);
        continue;
      }
      if (r.ts < top) lateMerged++;
      else batchTop.set(r.assetId, r.ts);
      accepted.push(r);
      pending.set(key, r);
    }
    return { received: raws.length, accepted, duplicates, lateMerged, quarantined, reasons };
  }

  apply(staged: StagedBatch): Inserted[] {
    const inserted: Inserted[] = [];
    for (const r of staged.accepted) inserted.push(this.insert(r));
    for (const e of staged.quarantined) this.quarantine.set(quarantineKeyOf(e), e);
    return inserted;
  }

  /** Load readings that were already accepted once (from the lake), with no rules applied. A key already present is skipped. */
  restore(readings: Reading[]): Inserted[] {
    const inserted: Inserted[] = [];
    for (const r of readings) {
      if (this.get(r.assetId, r.ts)) continue;
      inserted.push(this.insert(r));
    }
    return inserted;
  }

  private insert(r: Reading): Inserted {
    let s = this.series.get(r.assetId);
    if (!s) {
      s = { ts: [], rows: [] };
      this.series.set(r.assetId, s);
    }
    const n = s.ts.length;
    if (n === 0 || r.ts > s.ts[n - 1]) {
      const prevTs = n > 0 ? s.ts[n - 1] : null;
      s.ts.push(r.ts);
      s.rows.push(r);
      return { reading: r, prevTs };
    }
    const i = lowerBound(s.ts, r.ts);
    if (s.ts[i] === r.ts) throw new Error(`stale staged batch: ${r.assetId} at ${isoOf(r.ts)} is already stored`);
    const prevTs = i > 0 ? s.ts[i - 1] : null;
    s.ts.splice(i, 0, r.ts);
    s.rows.splice(i, 0, r);
    return { reading: r, prevTs };
  }
}
