import { CHANNELS, isoOf, dayOf } from "./schema.js";
import { lowerBound, type Inserted, type ReadingStore, type Series } from "./store.js";

// Rollups of the readings at 5 minutes and 1 hour, per asset. Per bucket and per channel: n, min, max, mean. For power,
// also the energy in kWh by the trapezoid rule.
//
// Energy rule: the segment between two consecutive readings a and b counts (power_a + power_b) / 2 * hours between them,
// and belongs to the bucket that holds a (the reading it starts at). That makes an hour exactly the sum of its twelve
// 5 minute buckets, and a reading only ever changes the segment before it and the one after it, so a late reading
// re-rolls its own bucket and the bucket of the reading before it.
//
// A segment longer than 1.5 expected intervals is a gap: it adds no energy (nothing is invented to fill it), it is
// counted in gap_segments of the bucket it starts in, and detectGaps() reports it. A bucket with no readings has no row.

export const HOUR_MS = 3_600_000;
export const RESOLUTIONS = [
  { name: "5m", ms: 300_000 },
  { name: "1h", ms: HOUR_MS },
] as const;
export type ResolutionName = (typeof RESOLUTIONS)[number]["name"];

export interface RollupConfig {
  /** How often an asset reports. A gap is more than 1.5 of these between two readings. */
  expectedIntervalMs: number;
}

export const gapThresholdMs = (cfg: RollupConfig): number => cfg.expectedIntervalMs * 1.5;

export type RollupRow = Record<string, string | number | null>;

export const STAT_SUFFIXES = ["n", "min", "max", "mean"] as const;

export interface Column {
  name: string;
  type: "string" | "bigint" | "double";
}

// The files and the Glue tables share these lists (deploy/athena/telemetry.tf is checked against them).
export const ROLLUP_COLUMNS: Column[] = [
  { name: "asset_id", type: "string" },
  { name: "bucket_start", type: "string" },
  { name: "readings", type: "bigint" },
  ...CHANNELS.flatMap((c): Column[] => [
    { name: `${c}_n`, type: "bigint" },
    { name: `${c}_min`, type: "double" },
    { name: `${c}_max`, type: "double" },
    { name: `${c}_mean`, type: "double" },
  ]),
  { name: "energy_kwh", type: "double" },
  { name: "gap_segments", type: "bigint" },
];

/** Rollup rows for the readings with index i0 up to i1 (exclusive) of one series, grouped by bucket. */
export function computeRows(assetId: string, series: Series, i0: number, i1: number, resMs: number, gapMs: number): RollupRow[] {
  const out: RollupRow[] = [];
  const rows = series.rows;
  const nCh = CHANNELS.length;
  let i = i0;
  while (i < i1) {
    const start = Math.floor(rows[i].ts / resMs) * resMs;
    const end = start + resMs;
    const n = new Array<number>(nCh).fill(0);
    const min = new Array<number>(nCh).fill(Infinity);
    const max = new Array<number>(nCh).fill(-Infinity);
    const sum = new Array<number>(nCh).fill(0);
    let energy = 0;
    let gapSegments = 0;
    let count = 0;
    let j = i;
    while (j < i1 && rows[j].ts < end) {
      const r = rows[j];
      count++;
      for (let c = 0; c < nCh; c++) {
        const v = r[CHANNELS[c]];
        if (v === null) continue;
        n[c]++;
        sum[c] += v;
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
      const next = rows[j + 1];
      if (next) {
        const dt = next.ts - r.ts;
        if (dt <= gapMs) energy += (((r.power_kw + next.power_kw) / 2) * dt) / HOUR_MS;
        else gapSegments++;
      }
      j++;
    }
    const row: RollupRow = { asset_id: assetId, bucket_start: isoOf(start), readings: count };
    for (let c = 0; c < nCh; c++) {
      const ch = CHANNELS[c];
      row[`${ch}_n`] = n[c];
      row[`${ch}_min`] = n[c] ? min[c] : null;
      row[`${ch}_max`] = n[c] ? max[c] : null;
      row[`${ch}_mean`] = n[c] ? sum[c] / n[c] : null;
    }
    row.energy_kwh = energy;
    row.gap_segments = gapSegments;
    out.push(row);
    i = j;
  }
  return out;
}

export interface Gap {
  assetId: string;
  /** The last reading before the gap, or the start of the window when the asset had none yet. */
  fromMs: number;
  /** The first reading after the gap, or the end of the window. */
  toMs: number;
  /** Readings that should have arrived, by the expected interval. */
  missing: number;
}

/**
 * Intervals with no data. Between two readings it is a gap when they are more than 1.5 expected intervals apart. With a
 * window (fromMs inclusive, toMs exclusive) the stretch before the first reading and after the last one counts too, and
 * missing then equals the slots of the grid that hold nothing. Nothing is filled in.
 */
export function detectGaps(assetId: string, series: Series | undefined, cfg: RollupConfig, window?: { fromMs: number; toMs: number }): Gap[] {
  const e = cfg.expectedIntervalMs;
  const gaps: Gap[] = [];
  const ts = series?.ts ?? [];
  const lo = window ? lowerBound(ts, window.fromMs) : 0;
  const hi = window ? lowerBound(ts, window.toMs) : ts.length;
  if (window && lo >= hi) {
    const missing = Math.round((window.toMs - window.fromMs) / e);
    if (missing >= 1) gaps.push({ assetId, fromMs: window.fromMs, toMs: window.toMs, missing });
    return gaps;
  }
  if (window) {
    const missing = Math.round((ts[lo] - window.fromMs) / e);
    if (missing >= 1) gaps.push({ assetId, fromMs: window.fromMs, toMs: ts[lo], missing });
  }
  for (let i = lo + 1; i < hi; i++) {
    const dt = ts[i] - ts[i - 1];
    if (dt > gapThresholdMs(cfg)) gaps.push({ assetId, fromMs: ts[i - 1], toMs: ts[i], missing: Math.round(dt / e) - 1 });
  }
  if (window) {
    const missing = Math.round((window.toMs - ts[hi - 1]) / e) - 1;
    if (missing >= 1) gaps.push({ assetId, fromMs: ts[hi - 1], toMs: window.toMs, missing });
  }
  return gaps;
}

/** Bucket starts in [fromMs, toMs) that have no row. They are reported, never filled. */
export function missingBuckets(rows: RollupRow[], resMs: number, fromMs: number, toMs: number): number[] {
  const have = new Set(rows.map((r) => Date.parse(r.bucket_start as string)));
  const out: number[] = [];
  for (let t = Math.ceil(fromMs / resMs) * resMs; t < toMs; t += resMs) if (!have.has(t)) out.push(t);
  return out;
}

export interface FlushResult {
  recomputed: number;
  /** "assetId|YYYY-MM-DD" for every asset and day with a changed bucket. */
  days: Set<string>;
}

/** The rolled-up buckets of a store, kept current by recomputing only the buckets a new reading touched. */
export class RollupIndex {
  private rows = new Map<string, Map<number, RollupRow>[]>();
  private dirty = new Map<string, Set<number>[]>();

  constructor(private store: ReadingStore, readonly cfg: RollupConfig) {}

  private dirtyFor(assetId: string): Set<number>[] {
    let d = this.dirty.get(assetId);
    if (!d) {
      d = RESOLUTIONS.map(() => new Set<number>());
      this.dirty.set(assetId, d);
    }
    return d;
  }

  /** A reading changes its own bucket and the bucket of the reading before it (their segment moved). */
  markInserted(items: Inserted[]): void {
    for (const { reading, prevTs } of items) {
      const d = this.dirtyFor(reading.assetId);
      for (let k = 0; k < RESOLUTIONS.length; k++) {
        const ms = RESOLUTIONS[k].ms;
        d[k].add(Math.floor(reading.ts / ms) * ms);
        if (prevTs !== null) d[k].add(Math.floor(prevTs / ms) * ms);
      }
    }
  }

  markAll(): void {
    for (const [assetId, s] of this.store.series) {
      const d = this.dirtyFor(assetId);
      for (let k = 0; k < RESOLUTIONS.length; k++) {
        const ms = RESOLUTIONS[k].ms;
        for (const t of s.ts) d[k].add(Math.floor(t / ms) * ms);
      }
    }
  }

  flush(): FlushResult {
    const days = new Set<string>();
    let recomputed = 0;
    const gapMs = gapThresholdMs(this.cfg);
    for (const [assetId, sets] of this.dirty) {
      const series = this.store.series.get(assetId);
      if (!series) continue;
      let byRes = this.rows.get(assetId);
      if (!byRes) {
        byRes = RESOLUTIONS.map(() => new Map<number, RollupRow>());
        this.rows.set(assetId, byRes);
      }
      for (let k = 0; k < RESOLUTIONS.length; k++) {
        const ms = RESOLUTIONS[k].ms;
        for (const start of sets[k]) {
          const i0 = lowerBound(series.ts, start);
          const i1 = lowerBound(series.ts, start + ms);
          const fresh = computeRows(assetId, series, i0, i1, ms, gapMs);
          if (fresh.length) byRes[k].set(start, fresh[0]);
          else byRes[k].delete(start);
          recomputed++;
          days.add(`${assetId}|${dayOf(start)}`);
        }
        sets[k].clear();
      }
    }
    this.dirty.clear();
    return { recomputed, days };
  }

  /** All rows of an asset at a resolution, oldest first. Call flush() first. */
  rowsFor(assetId: string, res: ResolutionName): RollupRow[] {
    const k = RESOLUTIONS.findIndex((r) => r.name === res);
    const m = this.rows.get(assetId)?.[k];
    if (!m) return [];
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  }

  /** Rows of an asset at a resolution whose bucket starts on the given UTC day. */
  rowsForDay(assetId: string, res: ResolutionName, day: string): RollupRow[] {
    return this.rowsFor(assetId, res).filter((r) => (r.bucket_start as string).slice(0, 10) === day);
  }

  assets(): string[] {
    return [...this.rows.keys()].sort();
  }
}
