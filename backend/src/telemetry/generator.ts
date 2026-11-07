import { createHash } from "node:crypto";
import type { Gap } from "./rollup.js";
import type { Reading, RejectReason } from "./schema.js";

// A deterministic synthetic day of readings for one solar asset: a daylight curve with noise, and a fixed set of defects
// planted at fixed fractions of the day. The same options give the same readings byte for byte.
//
// Planted defects (all on top of the clean grid of one reading per intervalMs):
//   30% of the day  an exact duplicate, sent right after the original
//   35%             a duplicate with a different power_kw (conflicting_duplicate)
//   40%             one reading delivered far behind the newest one, past the allowed lateness (too_late)
//   50%             one reading delivered late but inside the allowed lateness (merged, out of order)
//   60%             a 20 minute stretch with no readings at all (a gap)
//   70%             an extra reading between two grid points with a negative power_kw (out_of_range)
//   80% and 85%     two readings with a bad timestamp: not a real time, and a time with no zone (invalid_timestamp)

export interface SolarDayOptions {
  assetId: string;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  intervalMs?: number;
  seed?: number;
  peakKw?: number;
  /** The pipeline's allowed lateness, so the late readings land on the intended side of the watermark. */
  allowedLatenessMs: number;
  defects?: boolean;
}

export interface SolarDay {
  /** What the sender sends, in arrival order, defects included. */
  raw: Record<string, unknown>[];
  /** What should end up stored: the grid minus the gap and the too late reading, ascending. */
  clean: Reading[];
  expected: {
    accepted: number;
    duplicates: number;
    lateMerged: number;
    reasons: Partial<Record<RejectReason, number>>;
    gaps: Gap[];
  };
}

export const DAY_MS = 86_400_000;
export const GAP_MS = 20 * 60_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

export function seedFor(assetId: string, seed: number): number {
  return (createHash("sha256").update(`${assetId}:${seed}`).digest().readUInt32LE(0) ^ seed) >>> 0;
}

export function generateSolarDay(opts: SolarDayOptions): SolarDay {
  const interval = opts.intervalMs ?? 60_000;
  const peak = opts.peakKw ?? 5;
  const dayStart = Date.parse(`${opts.day}T00:00:00Z`);
  if (Number.isNaN(dayStart)) throw new RangeError(`not a day: ${opts.day}`);
  if (DAY_MS % interval !== 0 || interval % 2 !== 0) throw new RangeError("intervalMs must be even and divide a day");
  const n = DAY_MS / interval;
  const withDefects = opts.defects ?? true;
  const rnd = mulberry32(seedFor(opts.assetId, opts.seed ?? 1));
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

  const grid: Reading[] = [];
  for (let i = 0; i < n; i++) {
    const msOfDay = i * interval;
    const x = (msOfDay - 6 * 3_600_000) / (12 * 3_600_000);
    const sun = x > 0 && x < 1 ? Math.pow(Math.sin(Math.PI * x), 1.2) : 0;
    const power = sun === 0 ? 0 : Math.min(peak * 1.1, Math.max(0, peak * sun * (1 + 0.04 * gauss())));
    const voltage = round3(380 + 160 * (power / peak) + 2 * gauss());
    const temp = round3(14 + 22 * sun + 0.4 * gauss());
    grid.push({
      assetId: opts.assetId,
      ts: dayStart + msOfDay,
      power_kw: round3(power),
      voltage_v: rnd() < 0.02 ? null : voltage,
      temp_c: rnd() < 0.02 ? null : temp,
    });
  }
  const wire = (r: Reading): Record<string, unknown> => {
    const o: Record<string, unknown> = { asset_id: r.assetId, ts: new Date(r.ts).toISOString(), power_kw: r.power_kw };
    if (r.voltage_v !== null) o.voltage_v = r.voltage_v;
    if (r.temp_c !== null) o.temp_c = r.temp_c;
    return o;
  };

  if (!withDefects) {
    return { raw: grid.map(wire), clean: grid, expected: { accepted: n, duplicates: 0, lateMerged: 0, reasons: {}, gaps: [] } };
  }

  const at = (f: number) => Math.floor(n * f);
  const dupIdx = at(0.3);
  const conflictIdx = at(0.35);
  const tooLateIdx = at(0.4);
  const lateIdx = at(0.5);
  const gapStart = at(0.6);
  const negIdx = at(0.7);
  const bad1Idx = at(0.8);
  const bad2Idx = at(0.85);
  const gapLen = Math.round(GAP_MS / interval);
  const lateDelay = Math.max(1, Math.floor(opts.allowedLatenessMs / interval / 2));
  const tooLateDelay = Math.ceil(opts.allowedLatenessMs / interval) + 5;
  if (n < 200 || tooLateIdx + tooLateDelay >= lateIdx || lateIdx + lateDelay >= gapStart || gapStart + gapLen >= negIdx) {
    throw new RangeError("the interval and allowed lateness leave no room to plant the defects in one day");
  }

  const raw: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const inGap = i >= gapStart && i < gapStart + gapLen;
    if (!inGap && i !== tooLateIdx && i !== lateIdx) raw.push(wire(grid[i]));
    if (i === dupIdx) raw.push(wire(grid[i]));
    if (i === conflictIdx) raw.push({ ...wire(grid[i]), power_kw: round3(grid[i].power_kw + 1) });
    if (i === negIdx) raw.push({ asset_id: opts.assetId, ts: new Date(grid[i].ts + interval / 2).toISOString(), power_kw: -2.5 });
    if (i === bad1Idx) raw.push({ asset_id: opts.assetId, ts: "2026-13-45T25:61:61Z", power_kw: 1.5 });
    if (i === bad2Idx) raw.push({ asset_id: opts.assetId, ts: new Date(grid[i].ts + interval / 2).toISOString().replace("Z", ""), power_kw: 1.5 });
    if (i === tooLateIdx + tooLateDelay) raw.push(wire(grid[tooLateIdx]));
    if (i === lateIdx + lateDelay) raw.push(wire(grid[lateIdx]));
  }

  const clean = grid.filter((_, i) => !(i >= gapStart && i < gapStart + gapLen) && i !== tooLateIdx);
  // Worked out from where the defects were planted, not from detectGaps, so a test can compare the two.
  const gaps: Gap[] = [
    { assetId: opts.assetId, fromMs: grid[tooLateIdx - 1].ts, toMs: grid[tooLateIdx + 1].ts, missing: 1 },
    { assetId: opts.assetId, fromMs: grid[gapStart - 1].ts, toMs: grid[gapStart + gapLen].ts, missing: gapLen },
  ];
  return {
    raw,
    clean,
    expected: {
      accepted: clean.length,
      duplicates: 1,
      lateMerged: 1,
      reasons: { too_late: 1, conflicting_duplicate: 1, out_of_range: 1, invalid_timestamp: 2 },
      gaps,
    },
  };
}
