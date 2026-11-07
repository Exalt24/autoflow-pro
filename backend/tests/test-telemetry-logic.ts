// LIFESPAN: permanent
// The telemetry rules that need no broker and no AWS: the reading schema, idempotent ingest and its duplicate rule, the
// watermark and late data, rollups (min, max, mean, count, trapezoid energy), gap detection, the lake layout and its
// stores, the generator, the order of write and apply (crash and retry), and seeded random worlds checked against a
// separate reference model. The end to end run is test-telemetry-e2e.ts, the broker is test-telemetry-rabbitmq.ts.
// Run: npm run test:telemetry-logic
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHANNEL_SPECS, MIN_TS, parseTimestamp, sameValues, validateReading, type Reading } from "../src/telemetry/schema.js";
import { ReadingStore, type StoreConfig } from "../src/telemetry/store.js";
import { RESOLUTIONS, RollupIndex, computeRows, detectGaps, gapThresholdMs, missingBuckets, ROLLUP_COLUMNS, type RollupRow } from "../src/telemetry/rollup.js";
import {
  FsLakeStore,
  MemoryLakeStore,
  PARTITION_TEMPLATES,
  QUARANTINE_COLUMNS,
  READING_COLUMNS,
  S3LakeStore,
  quarantineKey,
  readQuarantine,
  readReadings,
  readingFromLine,
  readingToLine,
  readingsKey,
  rollupBody,
  rollupKey,
  writeReadings,
  type LakeStore,
} from "../src/telemetry/lake.js";
import { TelemetryPipeline } from "../src/telemetry/pipeline.js";
import { GAP_MS, generateSolarDay } from "../src/telemetry/generator.js";
import { MAX_READINGS_PER_MESSAGE, batchIdFor, parseTelemetryMessage } from "../src/telemetry/worker.js";
import { PermanentError } from "../src/messaging/retryPolicy.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};
const throws = (fn: () => unknown, match: RegExp) => {
  try {
    fn();
    return false;
  } catch (e) {
    return match.test(String((e as Error).message));
  }
};
const rejects = async (fn: () => Promise<unknown>, match: RegExp) => {
  try {
    await fn();
    return false;
  } catch (e) {
    return match.test(String((e as Error).message));
  }
};

// Seeded generator so a failure can be replayed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 6, 10, 0, 0); // 2026-11-06 10:00:00Z
const NOW = Date.UTC(2026, 10, 7, 0, 0, 0);
const LATE = 15 * MIN;
const CFG: StoreConfig = { allowedLatenessMs: LATE, maxFutureMs: 5 * MIN };
const iso = (ms: number) => new Date(ms).toISOString();
const raw = (asset: string, ms: number, p: number, extra: Record<string, unknown> = {}) => ({ asset_id: asset, ts: iso(ms), power_kw: p, ...extra });
const rd = (asset: string, ms: number, p: number, v: number | null = null, t: number | null = null): Reading => ({ assetId: asset, ts: ms, power_kw: p, voltage_v: v, temp_c: t });
const V = { nowMs: NOW, maxFutureMs: 5 * MIN };
const reasonOf = (x: unknown, opts = V) => {
  const v = validateReading(x, opts);
  return v.ok ? "ok" : v.reason;
};
const ingest = (store: ReadingStore, raws: unknown[], now = NOW) => {
  const staged = store.stage(raws, now);
  return { staged, inserted: store.apply(staged) };
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// ================================================================ 1. the reading schema
{
  const ok = validateReading({ asset_id: "pv-001", ts: "2026-11-06T10:15:00Z", power_kw: 3.2, voltage_v: 612.5, temp_c: 41 }, V);
  check("schema: a full reading passes and ts becomes UTC epoch milliseconds", ok.ok && ok.reading.ts === Date.UTC(2026, 10, 6, 10, 15) && ok.reading.voltage_v === 612.5 && ok.reading.temp_c === 41);
  const opt = validateReading({ asset_id: "a", ts: "2026-11-06T10:15:00Z", power_kw: 0 }, V);
  check("schema: only power_kw is required, voltage and temperature become null, and 0 kW is a valid power", opt.ok && opt.reading.voltage_v === null && opt.reading.temp_c === null && opt.reading.power_kw === 0);
  check("schema: an explicit null for an optional channel is accepted", reasonOf({ asset_id: "a", ts: "2026-11-06T10:15:00Z", power_kw: 1, voltage_v: null, temp_c: null }) === "ok");
  check("schema: an offset is converted to UTC (+08:00 is 8 hours earlier, -05:30 is 5.5 hours later)", parseTimestamp("2026-11-06T18:00:00+08:00") === Date.UTC(2026, 10, 6, 10) && parseTimestamp("2026-11-06T04:30:00-05:30") === Date.UTC(2026, 10, 6, 10));
  check("schema: milliseconds are kept, one to three digits", parseTimestamp("2026-11-06T10:00:00.5Z") === T0 + 500 && parseTimestamp("2026-11-06T10:00:00.123Z") === T0 + 123);
  check("schema: four fractional digits are refused", typeof parseTimestamp("2026-11-06T10:00:00.1234Z") === "string");
  check("schema: a time with no zone is refused as ambiguous", reasonOf({ asset_id: "a", ts: "2026-11-06T10:15:00", power_kw: 1 }) === "invalid_timestamp");
  check("schema: month 13, day 45, hour 25 and minute 61 are not real times", ["2026-13-01T00:00:00Z", "2026-11-45T00:00:00Z", "2026-11-06T25:00:00Z", "2026-11-06T10:61:00Z"].every((t) => typeof parseTimestamp(t) === "string"));
  check("schema: 2026-02-30 and a non leap 02-29 do not exist, 2028-02-29 does", typeof parseTimestamp("2026-02-30T00:00:00Z") === "string" && typeof parseTimestamp("2027-02-29T00:00:00Z") === "string" && typeof parseTimestamp("2028-02-29T00:00:00Z") === "number");
  check("schema: hour 24 and second 60 are refused", typeof parseTimestamp("2026-11-06T24:00:00Z") === "string" && typeof parseTimestamp("2026-11-06T10:00:60Z") === "string");
  check("schema: an offset of +25:00 or +01:60 is refused", typeof parseTimestamp("2026-11-06T10:00:00+25:00") === "string" && typeof parseTimestamp("2026-11-06T10:00:00+01:60") === "string");
  check("schema: a number, null, an empty string and free text are not timestamps", [1730000000000, null, undefined, "", "yesterday", "2026-11-06"].every((t) => typeof parseTimestamp(t) === "string"));
  check("schema: a time before 2000-01-01 is refused (a device that lost its clock)", reasonOf({ asset_id: "a", ts: "1970-01-01T00:00:00Z", power_kw: 1 }) === "invalid_timestamp" && MIN_TS === Date.UTC(2000, 0, 1));
  const skew = { nowMs: NOW, maxFutureMs: 5 * MIN };
  check("schema: a time exactly at the allowed future skew is accepted and one millisecond past it is refused", reasonOf(raw("a", NOW + 5 * MIN, 1), skew) === "ok" && reasonOf(raw("a", NOW + 5 * MIN + 1, 1), skew) === "future_timestamp");
  check("schema: null, an array and a string are not readings", [null, [], "x", 5, undefined].every((x) => reasonOf(x) === "invalid_shape"));
  check("schema: an unknown field is refused, not ignored", reasonOf({ ...raw("a", T0, 1), humidity: 40 }) === "unknown_field");
  check("schema: asset ids that are empty, too long, hold a slash or a space, or are not strings are refused", ["", "x".repeat(65), "a/b", "a b", "../x", 7].every((id) => reasonOf({ asset_id: id, ts: iso(T0), power_kw: 1 }) === "invalid_asset_id") && reasonOf({ ts: iso(T0), power_kw: 1 }) === "invalid_asset_id");
  check("schema: a 64 character asset id with letters, digits, _ and - is accepted", reasonOf(raw(`${"a1_-".repeat(16)}`, T0, 1)) === "ok");
  check("schema: a negative power is refused (a solar asset does not consume)", reasonOf(raw("a", T0, -0.001)) === "out_of_range");
  check("schema: power at its limits 0 and 10000 is accepted, just past them is refused", reasonOf(raw("a", T0, CHANNEL_SPECS.power_kw.max)) === "ok" && reasonOf(raw("a", T0, CHANNEL_SPECS.power_kw.max + 0.001)) === "out_of_range");
  check("schema: voltage 0 to 2000 and temperature -60 to 150 are the limits", reasonOf(raw("a", T0, 1, { voltage_v: 2000, temp_c: -60 })) === "ok" && reasonOf(raw("a", T0, 1, { voltage_v: 2000.1 })) === "out_of_range" && reasonOf(raw("a", T0, 1, { voltage_v: -1 })) === "out_of_range" && reasonOf(raw("a", T0, 1, { temp_c: -60.1 })) === "out_of_range" && reasonOf(raw("a", T0, 1, { temp_c: 150.1 })) === "out_of_range");
  check("schema: a missing power_kw is missing_value", reasonOf({ asset_id: "a", ts: iso(T0) }) === "missing_value" && reasonOf({ asset_id: "a", ts: iso(T0), power_kw: null }) === "missing_value");
  check("schema: NaN, Infinity, a numeric string and a boolean are invalid_value, never coerced", [Number.NaN, Infinity, -Infinity, "3.2", true, {}].every((p) => reasonOf(raw("a", T0, p as number)) === "invalid_value") && reasonOf(raw("a", T0, 1, { temp_c: "hot" })) === "invalid_value");
  check("schema: sameValues compares every channel, null against a number differs", sameValues(rd("a", 1, 2, 3, 4), rd("a", 1, 2, 3, 4)) && !sameValues(rd("a", 1, 2, 3, 4), rd("a", 1, 2, 3, 5)) && !sameValues(rd("a", 1, 2, null), rd("a", 1, 2, 0)) && !sameValues(rd("a", 1, 2), rd("a", 1, 3)));
}

// ================================================================ 2. idempotent ingest and the duplicate rule
{
  const s = new ReadingStore(CFG);
  const batch = [raw("a", T0, 1), raw("a", T0 + MIN, 2), raw("b", T0, 3)];
  const first = ingest(s, batch);
  check("ingest: a new batch is accepted in full", first.staged.accepted.length === 3 && s.count() === 3 && first.staged.duplicates === 0);
  const snap = JSON.stringify([...s.series.entries()]);
  const second = ingest(s, batch);
  check("ingest: the same batch twice changes nothing and is counted as 3 duplicates", second.staged.accepted.length === 0 && second.staged.duplicates === 3 && JSON.stringify([...s.series.entries()]) === snap && second.inserted.length === 0);
  const third = ingest(s, [batch[2], batch[0], batch[1], batch[0]]);
  check("ingest: a replay in another order, with a repeat, changes nothing either", third.staged.accepted.length === 0 && third.staged.duplicates === 4 && JSON.stringify([...s.series.entries()]) === snap);
  const conflict = ingest(s, [raw("a", T0, 99)]);
  check("duplicate rule: the same key with other values is quarantined as conflicting_duplicate and the first value is kept", conflict.staged.reasons.conflicting_duplicate === 1 && s.get("a", T0)?.power_kw === 1 && conflict.staged.accepted.length === 0);
  check("duplicate rule: a different voltage alone makes a conflict", ingest(s, [raw("a", T0, 1, { voltage_v: 5 })]).staged.reasons.conflicting_duplicate === 1);
  const q = s.quarantine.size;
  ingest(s, [raw("a", T0, 99), raw("a", T0, 99)]);
  check("duplicate rule: the same conflicting input sent again is not added to the quarantine list twice", s.quarantine.size === q);
  const dupBatch = ingest(new ReadingStore(CFG), [raw("a", T0, 1), raw("a", T0, 1), raw("a", T0, 2)]);
  check("duplicate rule: inside one batch the first wins, an identical repeat is a duplicate, a different one is quarantined", dupBatch.staged.accepted.length === 1 && dupBatch.staged.duplicates === 1 && dupBatch.staged.reasons.conflicting_duplicate === 1);
  check("duplicate rule: the same timestamp under two assets is two readings, not a duplicate", ingest(new ReadingStore(CFG), [raw("a", T0, 1), raw("b", T0, 2)]).staged.accepted.length === 2);
  check("duplicate rule: the same instant written with another offset is the same key", ingest(s, [{ asset_id: "a", ts: "2026-11-06T18:00:00+08:00", power_kw: 1 }]).staged.duplicates === 1);

  const bad = new ReadingStore(CFG);
  const mixed = ingest(bad, [raw("a", T0, 1), raw("a", T0 + MIN, -5), { nonsense: true }, raw("a", T0 + 2 * MIN, 3, { temp_c: 999 })]);
  check("quarantine: bad readings are kept with their reasons and are never stored", bad.count() === 1 && mixed.staged.quarantined.length === 3 && mixed.staged.quarantined.map((e) => e.reason).sort().join() === "out_of_range,out_of_range,unknown_field");
  const e0 = mixed.staged.quarantined.find((e) => e.reason === "unknown_field");
  const e1 = mixed.staged.quarantined.find((e) => e.assetId === "a" && e.ts === iso(T0 + MIN));
  check("quarantine: an entry names the reason, a detail, the asset and ts when they can be read, and the raw input", e0 !== undefined && e0.raw === '{"nonsense":true}' && e0.assetId === null && e1 !== undefined && e1.detail.includes("power_kw") && JSON.parse(e1.raw).power_kw === -5);
  check("quarantine: received = stored + duplicates + quarantined", mixed.staged.received === 4 && mixed.staged.accepted.length + mixed.staged.duplicates + Object.values(mixed.staged.reasons).reduce((a, b) => a + (b ?? 0), 0) === 4);
  const huge = ingest(new ReadingStore(CFG), [{ asset_id: "a", ts: iso(T0), power_kw: 1, note: "x".repeat(5000) }]);
  check("quarantine: the raw text is cut at 2000 characters", huge.staged.quarantined[0].raw.length === 2000);
  const cyc: any = { asset_id: "a" };
  cyc.self = cyc;
  check("quarantine: an input JSON cannot print (a cycle) is still quarantined", ingest(new ReadingStore(CFG), [cyc]).staged.quarantined.length === 1);

  const st = new ReadingStore(CFG);
  const staged = st.stage([raw("a", T0, 1)], NOW);
  check("stage and apply: stage changes nothing in the store", st.count() === 0 && st.quarantine.size === 0);
  st.apply(staged);
  check("stage and apply: apply stores the staged readings", st.count() === 1);
  check("stage and apply: applying a staged batch whose keys were stored meanwhile is refused instead of corrupting the series", throws(() => {
    const again = new ReadingStore(CFG);
    const x = again.stage([raw("a", T0 + MIN, 1)], NOW);
    const y = again.stage([raw("a", T0 + MIN, 1), raw("a", T0 + 2 * MIN, 1)], NOW);
    again.apply(x);
    again.stage([raw("a", T0 + 3 * MIN, 1)], NOW);
    again.apply({ ...y, accepted: [...y.accepted] });
  }, /stale staged batch/));
  const r = new ReadingStore(CFG);
  r.restore([rd("a", T0 + MIN, 1), rd("a", T0, 2), rd("a", T0, 5)]);
  check("restore: loads readings from the lake without applying the rules, keeps the first of a repeated key and sorts them", r.count() === 2 && r.get("a", T0)?.power_kw === 2 && r.series.get("a")?.ts.join() === `${T0},${T0 + MIN}`);
}

// ================================================================ 3. watermark, out of order and late data
{
  const s = new ReadingStore(CFG);
  check("watermark: an asset never seen has none", s.watermark("a") === null);
  ingest(s, [raw("a", T0 + 30 * MIN, 1)]);
  check("watermark: it is the newest accepted timestamp minus the allowed lateness", s.watermark("a") === T0 + 30 * MIN - LATE);
  const atMark = ingest(s, [raw("a", T0 + 15 * MIN, 2)]);
  check("late data: a reading exactly at the watermark is accepted and counted as late and merged", atMark.staged.accepted.length === 1 && atMark.staged.lateMerged === 1);
  const behind = ingest(s, [raw("a", T0 + 15 * MIN - 1, 2)]);
  check("late data: one millisecond behind the watermark is quarantined as too_late", behind.staged.accepted.length === 0 && behind.staged.reasons.too_late === 1 && s.get("a", T0 + 15 * MIN - 1) === undefined);
  check("late data: the too_late detail says how far behind the watermark it was", behind.staged.quarantined[0].detail === "older than the watermark by 1 ms");
  ingest(s, [raw("a", T0 + 20 * MIN, 3)]);
  check("late data: a merged late reading lands in its place in time order", s.series.get("a")?.ts.join() === [T0 + 15 * MIN, T0 + 20 * MIN, T0 + 30 * MIN].join());
  check("late data: the watermark follows the newest reading, never goes back after a late one", s.watermark("a") === T0 + 30 * MIN - LATE);
  const own = new ReadingStore(CFG);
  ingest(own, [raw("a", T0, 1), raw("b", T0 + 5 * HOUR, 1)]);
  check("late data: the watermark is per asset, so a busy asset does not make a quiet one late", ingest(own, [raw("a", T0 + MIN, 1)]).staged.accepted.length === 1 && own.watermark("a") === T0 + MIN - LATE && own.watermark("b") === T0 + 5 * HOUR - LATE);
  const inBatch = ingest(new ReadingStore(CFG), [raw("a", T0 + HOUR, 1), raw("a", T0, 1)]);
  check("late data: readings are judged in arrival order inside a batch (a newer one first makes an older one late)", inBatch.staged.accepted.length === 1 && inBatch.staged.reasons.too_late === 1);
  const reverse = ingest(new ReadingStore(CFG), [raw("a", T0, 1), raw("a", T0 + HOUR, 1)]);
  check("late data: the same two readings in time order are both accepted and none is late", reverse.staged.accepted.length === 2 && reverse.staged.lateMerged === 0);
  const split = new ReadingStore(CFG);
  ingest(split, [raw("a", T0 + HOUR, 1)]);
  check("late data: splitting the same arrivals into two batches gives the same verdict", ingest(split, [raw("a", T0, 1)]).staged.reasons.too_late === 1);
  const mark = new ReadingStore(CFG);
  ingest(mark, [raw("a", T0 + 30 * MIN, 1)]);
  ingest(mark, [raw("a", T0 + 29 * MIN, 1, { power_kw: -1 }), raw("a", NOW + 99 * HOUR, 1), raw("a", T0 + 10 * HOUR, -3)]);
  check("late data: a rejected reading (bad power, too far in the future) does not move the watermark", mark.watermark("a") === T0 + 30 * MIN - LATE);
  const dupLate = new ReadingStore(CFG);
  ingest(dupLate, [raw("a", T0, 1), raw("a", T0 + 2 * HOUR, 1)]);
  check("late data: an old reading that is already stored is a plain duplicate when it is sent again after the watermark passed it", ingest(dupLate, [raw("a", T0, 1)]).staged.duplicates === 1 && dupLate.quarantine.size === 0);
  check("late data: a reading far in the future is refused so it cannot push every other reading behind the watermark", ingest(new ReadingStore(CFG), [raw("a", NOW + 6 * MIN, 1)]).staged.reasons.future_timestamp === 1);
  const idx = new ReadingStore(CFG);
  const ins = ingest(idx, [raw("a", T0, 1), raw("a", T0 + 10 * MIN, 1), raw("a", T0 + 5 * MIN, 1)]).inserted;
  check("late data: apply reports the reading before each insert, so the changed segment is known", ins.map((i) => i.prevTs).join() === `,${T0},${T0}`);
}

// ================================================================ 4. rollups
const grid = (asset: string, n: number, f: (i: number) => number, stepMs = MIN, start = T0): Reading[] => Array.from({ length: n }, (_, i) => rd(asset, start + i * stepMs, f(i), 100 + i, i % 2 ? null : 20));
const storeOf = (readings: Reading[]) => {
  const s = new ReadingStore({ allowedLatenessMs: 1e12, maxFutureMs: 1e12 });
  s.restore(readings);
  return s;
};
const rowsOf = (readings: Reading[], res: "5m" | "1h", expected = MIN) => {
  const s = storeOf(readings);
  const idx = new RollupIndex(s, { expectedIntervalMs: expected });
  idx.markAll();
  idx.flush();
  return idx.rowsFor(readings[0].assetId, res);
};
{
  const hour = rowsOf(grid("a", 60, () => 2), "1h");
  check("rollup: 2 kW for a full hour is 2 kWh, one reading per minute, with the stats of one channel", hour.length === 1 && hour[0].readings === 60 && near(hour[0].energy_kwh as number, 59 / 60 * 2) && hour[0].power_kw_min === 2 && hour[0].power_kw_max === 2 && hour[0].power_kw_mean === 2);
  const full = rowsOf(grid("a", 61, () => 2), "1h");
  check("rollup: a segment belongs to the bucket of the reading it starts at, so 61 readings put the 60th minute's segment in hour one", full[0].readings === 60 && near(full[0].energy_kwh as number, 2) && full[1].readings === 1 && full[1].energy_kwh === 0);
  const ramp = rowsOf(grid("a", 61, (i) => (i * 6) / 60), "1h");
  check("rollup: a ramp from 0 to 6 kW over an hour is 3 kWh by the trapezoid rule", near(ramp[0].energy_kwh as number, 3));
  const tri = rowsOf([rd("a", T0, 0), rd("a", T0 + 30 * MIN, 4), rd("a", T0 + 60 * MIN, 0)], "1h", 30 * MIN);
  check("rollup: a triangle 0, 4, 0 kW over two half hours is 2 kWh", near(tri[0].energy_kwh as number, 2));
  const stats = rowsOf([rd("a", T0, 1, 10, null), rd("a", T0 + MIN, 3, null, null), rd("a", T0 + 2 * MIN, 8, 30, null)], "5m")[0];
  check("rollup: min, max, mean and n are per channel and skip missing values", stats.power_kw_n === 3 && stats.power_kw_min === 1 && stats.power_kw_max === 8 && near(stats.power_kw_mean as number, 4) && stats.voltage_v_n === 2 && stats.voltage_v_min === 10 && stats.voltage_v_max === 30 && stats.voltage_v_mean === 20 && stats.readings === 3);
  check("rollup: a channel with no values has n 0 and null stats, not zeros", stats.temp_c_n === 0 && stats.temp_c_min === null && stats.temp_c_max === null && stats.temp_c_mean === null);
  check("rollup: the bucket start is the UTC start of the 5 minute or 1 hour window", stats.bucket_start === iso(T0) && rowsOf([rd("a", T0 + 7 * MIN, 1)], "5m")[0].bucket_start === iso(T0 + 5 * MIN) && rowsOf([rd("a", T0 + 7 * MIN, 1)], "1h")[0].bucket_start === iso(T0));
  check("rollup: a reading exactly on a boundary belongs to the bucket that starts there", rowsOf([rd("a", T0 + 5 * MIN - 1, 1), rd("a", T0 + 5 * MIN, 1)], "5m").map((r) => r.readings).join() === "1,1");

  const readings = grid("a", 180, (i) => 1 + (i % 7) * 0.5);
  const r5 = rowsOf(readings, "5m");
  const r1 = rowsOf(readings, "1h");
  const sum5 = (hourStart: string) => r5.filter((r) => Date.parse(r.bucket_start as string) >= Date.parse(hourStart) && Date.parse(r.bucket_start as string) < Date.parse(hourStart) + HOUR);
  check("rollup: an hour is exactly the sum of its twelve 5 minute buckets, in energy and in count", r1.every((h) => near(h.energy_kwh as number, sum5(h.bucket_start as string).reduce((x, r) => x + (r.energy_kwh as number), 0)) && h.readings === sum5(h.bucket_start as string).reduce((x, r) => x + (r.readings as number), 0)));
  check("rollup: the hourly min and max are the min and max of the 5 minute rows", r1.every((h) => h.power_kw_min === Math.min(...sum5(h.bucket_start as string).map((r) => r.power_kw_min as number)) && h.power_kw_max === Math.max(...sum5(h.bucket_start as string).map((r) => r.power_kw_max as number))));

  // gaps
  const cfg = { expectedIntervalMs: MIN };
  const ex = rowsOf([rd("a", T0, 3), rd("a", T0 + 90_000, 3)], "5m")[0];
  check("gap: a segment of exactly 1.5 expected intervals is still integrated", near(ex.energy_kwh as number, (3 * 90) / 3600) && ex.gap_segments === 0);
  const over = rowsOf([rd("a", T0, 3), rd("a", T0 + 90_001, 3)], "5m")[0];
  check("gap: a segment one millisecond longer is a gap, adds no energy and is counted in gap_segments", over.energy_kwh === 0 && over.gap_segments === 1);
  const gapSeries = grid("a", 60, () => 4).filter((r) => r.ts < T0 + 20 * MIN || r.ts >= T0 + 30 * MIN);
  const g1 = rowsOf(gapSeries, "1h")[0];
  check("gap: a 10 minute hole in an hour of 4 kW leaves 48 minutes of segments in the energy (nothing is invented to fill it)", near(g1.energy_kwh as number, (4 * 48) / 60), `${g1.energy_kwh}`);
  check("gap: that hole is one gap segment", g1.gap_segments === 1 && g1.readings === 50);
  const r5g = rowsOf(gapSeries, "5m");
  check("gap: a 5 minute bucket with no readings has no row, and missingBuckets reports it", r5g.length === 10 && missingBuckets(r5g, 5 * MIN, T0, T0 + HOUR).join() === `${T0 + 20 * MIN},${T0 + 25 * MIN}`);
  const gs = detectGaps("a", storeOf(gapSeries).series.get("a"), cfg);
  check("gap: detectGaps names the stretch, the last reading before it, the first after, and how many readings are missing", gs.length === 1 && gs[0].fromMs === T0 + 19 * MIN && gs[0].toMs === T0 + 30 * MIN && gs[0].missing === 10, JSON.stringify(gs));
  check("gap: a clean series has no gap", detectGaps("a", storeOf(grid("a", 30, () => 1)).series.get("a"), cfg).length === 0);
  const jitter = grid("a", 100, () => 1).map((r, i) => ({ ...r, ts: r.ts + ((i * 7919) % 20_000) - 10_000 }));
  check("gap: readings off their grid by 10 seconds either way are not gaps", detectGaps("a", storeOf(jitter).series.get("a"), cfg).length === 0);
  const win = { fromMs: T0, toMs: T0 + HOUR };
  check("gap: two readings exactly 1.5 intervals apart are not a gap, one millisecond more is, and it counts one missing reading", detectGaps("a", storeOf([rd("a", T0, 1), rd("a", T0 + 90_000, 1)]).series.get("a"), cfg).length === 0 && JSON.stringify(detectGaps("a", storeOf([rd("a", T0, 1), rd("a", T0 + 90_001, 1)]).series.get("a"), cfg).map((g) => g.missing)) === "[1]");
  check("gap: with a window, the start of the hour before the first reading counts (3 missing)", detectGaps("a", storeOf(grid("a", 57, () => 1, MIN, T0 + 3 * MIN)).series.get("a"), cfg, win).map((g) => `${g.fromMs - T0}:${g.toMs - T0}:${g.missing}`).join() === `0:${3 * MIN}:3`);
  check("gap: with a window, the end of the hour after the last reading counts (5 missing)", detectGaps("a", storeOf(grid("a", 55, () => 1)).series.get("a"), cfg, win).map((g) => `${g.fromMs - T0}:${g.toMs - T0}:${g.missing}`).join() === `${54 * MIN}:${60 * MIN}:5`);
  check("gap: with a window and every slot present, readings plus missing equals the slots of the window", (() => {
    const s = grid("a", 60, () => 1).filter((r) => (r.ts - T0) / MIN !== 10 && (r.ts - T0) / MIN !== 11 && (r.ts - T0) / MIN !== 59);
    const missing = detectGaps("a", storeOf(s).series.get("a"), cfg, win).reduce((x, g) => x + g.missing, 0);
    return s.length + missing === 60;
  })());
  check("gap: an asset with no readings in the window is one gap for the whole window", (() => {
    const g = detectGaps("a", undefined, cfg, win);
    return g.length === 1 && g[0].missing === 60 && g[0].fromMs === T0 && g[0].toMs === T0 + HOUR;
  })());
  check("gap: the threshold is 1.5 times the expected interval", gapThresholdMs(cfg) === 90_000);

  // late data re-rolls its buckets
  const inOrder = grid("a", 120, (i) => 1 + (i % 5));
  const target = inOrder[59]; // last minute of the first hour, in the middle of a segment chain
  const sortedStore = new ReadingStore({ allowedLatenessMs: 20 * MIN, maxFutureMs: 1e12 });
  const sortedIdx = new RollupIndex(sortedStore, { expectedIntervalMs: MIN });
  for (const r of inOrder) sortedIdx.markInserted(ingest(sortedStore, [raw("a", r.ts, r.power_kw, r.voltage_v === null ? {} : { voltage_v: r.voltage_v })], T0 + 10 * HOUR).inserted);
  sortedIdx.flush();
  const lateStore = new ReadingStore({ allowedLatenessMs: 20 * MIN, maxFutureMs: 1e12 });
  const lateIdx = new RollupIndex(lateStore, { expectedIntervalMs: MIN });
  const arrival = inOrder.filter((r) => r !== target);
  arrival.splice(63, 0, target); // delivered four readings late
  let lateSeen = 0;
  const before: RollupRow[] = [];
  arrival.forEach((r, i) => {
    const res = ingest(lateStore, [raw("a", r.ts, r.power_kw, r.voltage_v === null ? {} : { voltage_v: r.voltage_v })], T0 + 10 * HOUR);
    lateSeen += res.staged.lateMerged;
    lateIdx.markInserted(res.inserted);
    lateIdx.flush();
    if (i === 62) before.push(...lateIdx.rowsFor("a", "1h"), ...lateIdx.rowsFor("a", "5m"));
  });
  const same = (a: RollupRow[], b: RollupRow[]) => JSON.stringify(a) === JSON.stringify(b);
  check("late data: one reading delivered four minutes late is merged (counted once as late)", lateSeen === 1);
  check("late data: after the merge the 5 minute and hourly rollups equal the ones from the same readings in time order, exactly", same(lateIdx.rowsFor("a", "5m"), sortedIdx.rowsFor("a", "5m")) && same(lateIdx.rowsFor("a", "1h"), sortedIdx.rowsFor("a", "1h")));
  check("late data: the merge changed the hour that held the hole (59 readings before the late one arrived, 60 after)", before[0].readings === 59 && lateIdx.rowsFor("a", "1h")[0].readings === 60 && before[0].energy_kwh !== lateIdx.rowsFor("a", "1h")[0].energy_kwh);
  const gapped = new ReadingStore({ allowedLatenessMs: 20 * MIN, maxFutureMs: 1e12 });
  const gappedIdx = new RollupIndex(gapped, { expectedIntervalMs: MIN });
  gappedIdx.markInserted(ingest(gapped, [raw("a", T0, 3), raw("a", T0 + 2 * MIN, 3), raw("a", T0 + 3 * MIN, 3)], T0 + HOUR).inserted);
  gappedIdx.flush();
  const beforeLate = gappedIdx.rowsFor("a", "5m")[0];
  gappedIdx.markInserted(ingest(gapped, [raw("a", T0 + MIN, 3)], T0 + HOUR).inserted);
  gappedIdx.flush();
  const afterLate = gappedIdx.rowsFor("a", "5m")[0];
  check("late data: filling the hole turns a 2 minute gap segment into energy and removes the gap count", beforeLate.gap_segments === 1 && afterLate.gap_segments === 0 && (afterLate.energy_kwh as number) > (beforeLate.energy_kwh as number) && afterLate.readings === 4);
  const edgeStore = new ReadingStore({ allowedLatenessMs: 20 * MIN, maxFutureMs: 1e12 });
  const edgeIdx = new RollupIndex(edgeStore, { expectedIntervalMs: 5 * MIN });
  edgeIdx.markInserted(ingest(edgeStore, [raw("a", T0 + 4 * MIN, 2), raw("a", T0 + 7 * MIN, 2)], T0 + HOUR).inserted);
  edgeIdx.flush();
  const e0 = edgeIdx.rowsFor("a", "5m")[0].energy_kwh as number;
  edgeIdx.markInserted(ingest(edgeStore, [raw("a", T0 + 5 * MIN, 20)], T0 + HOUR).inserted);
  edgeIdx.flush();
  const e1 = edgeIdx.rowsFor("a", "5m")[0];
  check("late data: a late reading in the next 5 minute bucket re-rolls the earlier bucket whose last segment it split", near(e0, (2 * 3) / 60) && e1.readings === 1 && near(e1.energy_kwh as number, (11 * 1) / 60) && (e1.energy_kwh as number) > e0);

  check("rollup columns: the rollup file keys are exactly ROLLUP_COLUMNS in order, and the types are bigint for counts, double for stats", (() => {
    const names = ROLLUP_COLUMNS.map((c) => c.name);
    const row = rowsOf(grid("a", 3, () => 1), "5m")[0];
    return Object.keys(row).join() === names.join() && ROLLUP_COLUMNS.filter((c) => c.type === "bigint").every((c) => Number.isInteger(row[c.name]));
  })());
  check("rollup columns: the file body has one line per row with only those columns", (() => {
    const row = rowsOf(grid("a", 3, () => 1), "5m");
    const body = rollupBody(row);
    return body.endsWith("\n") && body.split("\n").length === 2 && Object.keys(JSON.parse(body.split("\n")[0])).join() === ROLLUP_COLUMNS.map((c) => c.name).join();
  })());
  check("rollup: computeRows on an empty range gives no rows (nothing is made up)", computeRows("a", storeOf(grid("a", 3, () => 1)).series.get("a")!, 0, 0, 300_000, 90_000).length === 0);
  check("rollup: the two resolutions are 5 minutes and 1 hour", RESOLUTIONS.map((r) => `${r.name}:${r.ms}`).join() === "5m:300000,1h:3600000");
}

// ================================================================ 5. the lake: layout, stores, serialising
{
  check("layout: a reading goes to asset=<id>/dt=<UTC day>/hour=<UTC hour>/part-<batch>.jsonl", readingsKey("pv-001", Date.UTC(2026, 10, 6, 9, 5), "b1") === "telemetry/readings/asset=pv-001/dt=2026-11-06/hour=09/part-b1.jsonl");
  check("layout: the day and hour are UTC even for a reading sent with an offset", (() => {
    const v = validateReading({ asset_id: "a", ts: "2026-11-07T06:30:00+08:00", power_kw: 1 }, { nowMs: NOW + 99 * HOUR, maxFutureMs: 0 });
    return v.ok && readingsKey("a", v.reading.ts, "b") === "telemetry/readings/asset=a/dt=2026-11-06/hour=22/part-b.jsonl";
  })());
  check("layout: 23:59:59.999 stays in its day and hour, and the next millisecond opens the next day at hour 00", readingsKey("a", Date.UTC(2026, 10, 6, 23, 59, 59, 999), "b").includes("dt=2026-11-06/hour=23/") && readingsKey("a", Date.UTC(2026, 10, 7), "b").includes("dt=2026-11-07/hour=00/"));
  check("layout: rollup and quarantine keys", rollupKey("5m", "a", "2026-11-06") === "telemetry/rollups_5m/asset=a/dt=2026-11-06/rollup.jsonl" && rollupKey("1h", "a", "2026-11-06") === "telemetry/rollups_1h/asset=a/dt=2026-11-06/rollup.jsonl" && quarantineKey("2026-11-06", "b") === "telemetry/quarantine/dt=2026-11-06/part-b.jsonl");
  check("layout: every key starts with the template of its table", readingsKey("a", T0, "b").startsWith(PARTITION_TEMPLATES.readings.replace("{asset}", "a").replace("{dt}", "2026-11-06").replace("{hour}", "10")) && PARTITION_TEMPLATES.quarantine === "telemetry/quarantine/dt={dt}/");
  check("layout: an asset id or batch id that could escape the folder is refused", throws(() => readingsKey("../x", T0, "b"), /not an asset id/) && throws(() => readingsKey("a", T0, "../b"), /batchId/) && throws(() => rollupKey("5m", "a/b", "2026-11-06"), /not an asset id/) && throws(() => quarantineKey("2026-11-06", ""), /batchId/));
  check("columns: reading and quarantine files carry exactly the columns the tables declare", readingToLine(rd("a", T0, 1, 2, 3)) === '{"asset_id":"a","ts":"2026-11-06T10:00:00.000Z","power_kw":1,"voltage_v":2,"temp_c":3}' && Object.keys(JSON.parse(readingToLine(rd("a", T0, 1)))).join() === READING_COLUMNS.map((c) => c.name).join() && QUARANTINE_COLUMNS.map((c) => c.name).join() === "reason,detail,asset_id,ts,raw");
  const rt = rd("a", T0 + 123, 1.25, null, -3.5);
  check("columns: a reading line reads back to the same reading, nulls included", JSON.stringify(readingFromLine(readingToLine(rt))) === JSON.stringify(rt));
  check("columns: a corrupt line in the lake is an error, never skipped", throws(() => readingFromLine('{"asset_id":"a","ts":"nope","power_kw":1}'), /corrupt reading line/) && throws(() => readingFromLine("{not json"), /./));

  // one contract, three stores
  class FakeS3 {
    objects = new Map<string, string>();
    constructor(private bucket: string, private pageSize = 2) {}
    async send(cmd: any) {
      const name = cmd.constructor.name as string;
      const i = cmd.input;
      if (i.Bucket !== this.bucket) throw new Error("wrong bucket");
      if (name === "PutObjectCommand") {
        this.objects.set(i.Key, String(i.Body));
        return {};
      }
      if (name === "GetObjectCommand") {
        if (!this.objects.has(i.Key)) throw Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" });
        const text = this.objects.get(i.Key) as string;
        return { Body: { transformToString: async () => text } };
      }
      if (name === "ListObjectsV2Command") {
        const all = [...this.objects.keys()].filter((k) => k.startsWith(i.Prefix ?? "")).sort();
        const start = i.ContinuationToken ? all.findIndex((k) => k > i.ContinuationToken) : 0;
        const page = start < 0 ? [] : all.slice(start, start + this.pageSize);
        const more = start >= 0 && start + this.pageSize < all.length;
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? page[page.length - 1] : undefined };
      }
      throw new Error(`unexpected command ${name}`);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "telemetry-lake-"));
  const stores: [string, LakeStore][] = [
    ["local folder", new FsLakeStore(dir)],
    ["memory", new MemoryLakeStore()],
    ["S3 calls against an in-memory stand-in", new S3LakeStore(new FakeS3("lake-bucket"), "lake-bucket")],
  ];
  for (const [label, lake] of stores) {
    await lake.put("telemetry/readings/asset=a/dt=2026-11-06/hour=10/part-1.jsonl", "one\n");
    await lake.put("telemetry/readings/asset=a/dt=2026-11-06/hour=11/part-1.jsonl", "two\n");
    await lake.put("telemetry/readings/asset=b/dt=2026-11-06/hour=10/part-1.jsonl", "three\n");
    await lake.put("telemetry/rollups_5m/asset=a/dt=2026-11-06/rollup.jsonl", "four\n");
    check(`lake store (${label}): get returns what put wrote, and null for a missing key`, (await lake.get("telemetry/readings/asset=b/dt=2026-11-06/hour=10/part-1.jsonl")) === "three\n" && (await lake.get("telemetry/none.jsonl").catch(() => "threw")) === null);
    check(`lake store (${label}): list returns the keys under a prefix, sorted, across several pages`, (await lake.list("telemetry/readings/asset=a/")).join() === "telemetry/readings/asset=a/dt=2026-11-06/hour=10/part-1.jsonl,telemetry/readings/asset=a/dt=2026-11-06/hour=11/part-1.jsonl" && (await lake.list("telemetry/readings/")).length === 3 && (await lake.list("telemetry/")).length === 4 && (await lake.list("telemetry/nothing/")).length === 0);
    await lake.put("telemetry/readings/asset=a/dt=2026-11-06/hour=10/part-1.jsonl", "replaced\n");
    check(`lake store (${label}): putting the same key again replaces the content and adds no key`, (await lake.get("telemetry/readings/asset=a/dt=2026-11-06/hour=10/part-1.jsonl")) === "replaced\n" && (await lake.list("telemetry/readings/")).length === 3);
    check(`lake store (${label}): a key with .., a leading slash, a backslash or an empty part is refused`, await rejects(() => lake.put("../x", "a"), /not a lake key/) && await rejects(() => lake.put("/x", "a"), /not a lake key/) && await rejects(() => lake.put("a\\b", "a"), /not a lake key/) && await rejects(() => lake.put("a//b", "a"), /not a lake key/));
  }
  check("lake store (local folder): a write leaves no temporary file behind", (() => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [e.name]));
    return walk(dir).every((n) => !n.includes(".tmp-"));
  })());
  writeFileSync(join(dir, "telemetry", "stray.jsonl.tmp-abc"), "half written");
  check("lake store (local folder): an unfinished temporary file from a crash is not listed", !(await stores[0][1].list("telemetry/")).some((k) => k.includes(".tmp-")));
  const s3 = new FakeS3("lake-bucket");
  check("lake store (S3): a request for another bucket is not served by the stand-in (the stand-in itself checks the bucket)", await rejects(() => new S3LakeStore(s3, "other").put("telemetry/x.jsonl", "a"), /wrong bucket/));
  rmSync(dir, { recursive: true, force: true });

  const mem = new MemoryLakeStore();
  const rows = [rd("a", T0 + 2 * MIN, 3), rd("a", T0, 1), rd("a", T0 + HOUR, 2), rd("b", T0, 5)];
  const keys = await writeReadings(mem, rows, "batch1");
  check("write: one file per asset, day and hour that the readings touch", keys.length === 3 && keys.includes("telemetry/readings/asset=a/dt=2026-11-06/hour=11/part-batch1.jsonl"));
  check("write: the lines of a file are in time order whatever the arrival order", (await mem.get("telemetry/readings/asset=a/dt=2026-11-06/hour=10/part-batch1.jsonl"))?.split("\n").filter(Boolean).map((l) => JSON.parse(l).ts).join() === `${iso(T0)},${iso(T0 + 2 * MIN)}`);
  const before = JSON.stringify([...mem.objects]);
  await writeReadings(mem, [...rows].reverse(), "batch1");
  check("write: writing the same batch again, in another order, leaves the same files with the same bytes", JSON.stringify([...mem.objects]) === before);
  check("read: the lake reads back as the readings written", (await readReadings(mem)).length === 4 && (await readReadings(mem, "telemetry/readings/asset=b/")).length === 1);
  await mem.put("telemetry/readings/asset=z/dt=2026-11-06/hour=10/part-bad.jsonl", "{broken\n");
  check("read: a broken file stops the read with an error instead of dropping lines", await rejects(() => readReadings(mem), /./));
}

// ================================================================ 6. the generator
{
  const opts = { assetId: "pv-001", day: "2026-11-06", allowedLatenessMs: LATE, seed: 3 };
  const a = generateSolarDay(opts);
  const b = generateSolarDay(opts);
  check("generator: the same options give the same readings, byte for byte", JSON.stringify(a.raw) === JSON.stringify(b.raw));
  check("generator: another seed gives other values", JSON.stringify(generateSolarDay({ ...opts, seed: 4 }).raw) !== JSON.stringify(a.raw));
  check("generator: the grid is one reading per minute, 1440 a day, and the clean list is the grid minus the gap and the too late reading", a.clean.length === 1440 - GAP_MS / MIN - 1 && a.expected.accepted === a.clean.length);
  const clean = generateSolarDay({ ...opts, defects: false });
  check("generator: without defects every reading is sent once, in order, and all are expected", clean.raw.length === 1440 && clean.expected.accepted === 1440 && clean.raw.every((r, i) => Date.parse(r.ts as string) === Date.UTC(2026, 10, 6) + i * MIN));
  const power = clean.clean.map((r) => r.power_kw);
  check("generator: power follows the sun, zero at night, a peak around noon and never over the asset's limit", power[0] === 0 && power[5 * 60] === 0 && power[19 * 60] === 0 && Math.max(...power) > 4 && Math.max(...power) <= 5.5 && power[12 * 60] > 4);
  check("generator: every clean reading passes the schema", clean.raw.every((r) => validateReading(r, V).ok));
  check("generator: some optional channels are missing, like a real sensor", clean.clean.some((r) => r.voltage_v === null) && clean.clean.some((r) => r.temp_c === null));
  const s = new ReadingStore(CFG);
  let acc = 0, dup = 0, lateN = 0;
  const reasons: Record<string, number> = {};
  for (const x of a.raw) {
    const st = s.stage([x], NOW);
    s.apply(st);
    acc += st.accepted.length;
    dup += st.duplicates;
    lateN += st.lateMerged;
    for (const [k, v] of Object.entries(st.reasons)) reasons[k] = (reasons[k] ?? 0) + (v ?? 0);
  }
  check("generator: ingest finds exactly the planted defects (1 duplicate, 1 late merge, too_late, conflicting_duplicate, out_of_range, 2 invalid_timestamp)", acc === a.expected.accepted && dup === 1 && lateN === 1 && JSON.stringify(Object.entries(reasons).sort()) === JSON.stringify(Object.entries({ invalid_timestamp: 2, conflicting_duplicate: 1, out_of_range: 1, too_late: 1 }).sort()), JSON.stringify({ acc, dup, lateN, reasons }));
  check("generator: what ingest stored is the clean list", JSON.stringify(s.series.get("pv-001")?.rows) === JSON.stringify(a.clean));
  const found = detectGaps("pv-001", s.series.get("pv-001"), { expectedIntervalMs: MIN }, { fromMs: Date.UTC(2026, 10, 6), toMs: Date.UTC(2026, 10, 7) });
  check("generator: detectGaps finds the planted gaps (the 20 minute hole and the one missing reading), as planted", JSON.stringify(found) === JSON.stringify(a.expected.gaps) && found.reduce((x, g) => x + g.missing, 0) === 21);
  check("generator: the planting refuses a lateness that leaves no room in the day", throws(() => generateSolarDay({ ...opts, allowedLatenessMs: 10 * HOUR }), /no room/));
  check("generator: an interval that does not divide a day is refused", throws(() => generateSolarDay({ ...opts, intervalMs: 7_000 }), /even and divide a day/));
}

// ================================================================ 7. write, then apply: crash, retry, restart
const sortedEntries = (m: MemoryLakeStore) => JSON.stringify([...m.objects.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
class FlakyLake implements LakeStore {
  puts = 0;
  constructor(private inner: LakeStore, public failWhen: (key: string, n: number) => boolean = () => false) {}
  async put(key: string, body: string) {
    this.puts++;
    if (this.failWhen(key, this.puts)) throw new Error("disk full");
    return this.inner.put(key, body);
  }
  get(key: string) {
    return this.inner.get(key);
  }
  list(prefix: string) {
    return this.inner.list(prefix);
  }
}
const POPTS = { expectedIntervalMs: MIN, allowedLatenessMs: LATE, maxFutureMs: 5 * MIN, now: () => NOW };
const day = generateSolarDay({ assetId: "pv-001", day: "2026-11-06", allowedLatenessMs: LATE, seed: 11 });
const chunks = (arr: unknown[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const BATCHES = chunks(day.raw, 97);
{
  const ref = new MemoryLakeStore();
  const refPipe = new TelemetryPipeline(ref, POPTS);
  const results: Awaited<ReturnType<TelemetryPipeline["process"]>>[] = [];
  for (const [i, b] of BATCHES.entries()) results.push(await refPipe.process(b, `m${i}`));
  const total = (k: "accepted" | "duplicates" | "lateMerged" | "quarantined") => results.reduce((x, r) => x + r[k], 0);
  check("pipeline: the counts of a whole day add up to what the generator planted", total("accepted") === day.expected.accepted && total("duplicates") === 1 && total("lateMerged") === 1 && total("quarantined") === 5);
  check("pipeline: every batch's received = accepted + duplicates + quarantined", results.every((r) => r.received === r.accepted + r.duplicates + r.quarantined));
  const keysNow = [...ref.objects.keys()];
  check("pipeline: the lake holds reading files, a 5 minute and an hourly rollup file for the day, and a quarantine file", keysNow.some((k) => k.includes("readings/asset=pv-001/dt=2026-11-06/hour=10/")) && keysNow.includes("telemetry/rollups_5m/asset=pv-001/dt=2026-11-06/rollup.jsonl") && keysNow.includes("telemetry/rollups_1h/asset=pv-001/dt=2026-11-06/rollup.jsonl") && keysNow.some((k) => k.startsWith("telemetry/quarantine/dt=2026-11-07/")));
  const snap = sortedEntries(ref);
  for (const [i, b] of BATCHES.entries()) await refPipe.process(b, `m${i}`);
  check("pipeline: sending every batch again, same ids, changes no file", sortedEntries(ref) === snap);
  for (const [i, b] of BATCHES.entries()) await refPipe.process(b, `replay-${i}`);
  check("pipeline: sending every batch again under new batch ids still changes no file (nothing new to store or quarantine)", sortedEntries(ref) === snap);
  const reopened = await TelemetryPipeline.open(ref, POPTS);
  check("restart: opening the lake rebuilds every reading and quarantined input, and finds the rollup files already right", reopened.restored === day.expected.accepted && reopened.pipeline.store.quarantine.size === 5 && reopened.rollupFilesRepaired === 0, JSON.stringify({ restored: reopened.restored, repaired: reopened.rollupFilesRepaired }));
  let replayAccepted = 0;
  for (const [i, b] of BATCHES.entries()) replayAccepted += (await reopened.pipeline.process(b, `again-${i}`)).accepted;
  check("restart: after a restart the redelivered messages find everything stored, count nothing twice and change no file", replayAccepted === 0 && sortedEntries(ref) === snap);

  // a failed write leaves the store alone, and the retry stores the batch once
  const lakeA = new MemoryLakeStore();
  const flaky = new FlakyLake(lakeA, (key, n) => n === 1 && key.includes("/readings/"));
  const pipeA = new TelemetryPipeline(flaky, POPTS);
  const failed1 = await rejects(() => pipeA.process(BATCHES[0], "m0"), /disk full/);
  check("crash: when the reading write fails the batch is rejected and memory is untouched", failed1 && pipeA.store.count() === 0 && pipeA.store.quarantine.size === 0);
  const retried = await pipeA.process(BATCHES[0], "m0");
  check("crash: the retry of the same message is staged as new and stored once", retried.accepted === results[0].accepted && pipeA.store.count() === results[0].accepted);
  const lakeB = new MemoryLakeStore();
  const pipeB = new TelemetryPipeline(lakeB, POPTS);
  await pipeB.process(BATCHES[0], "m0");
  check("crash: the lake after a failed try and a retry equals the lake after one clean try", sortedEntries(lakeA) === sortedEntries(lakeB));

  // a failed rollup write is finished by the next call
  const lakeC = new MemoryLakeStore();
  let rollupFailures = 1;
  const flakyRoll = new FlakyLake(lakeC, (key) => key.includes("/rollups_") && rollupFailures-- > 0);
  const pipeC = new TelemetryPipeline(flakyRoll, POPTS);
  const firstTry = await rejects(() => pipeC.process(BATCHES[0], "m0"), /disk full/);
  check("crash: when a rollup write fails the readings are already stored and applied", firstTry && pipeC.store.count() === results[0].accepted && [...lakeC.objects.keys()].some((k) => k.includes("/readings/")));
  const redelivered = await pipeC.process(BATCHES[0], "m0");
  check("crash: the redelivered message is all duplicates but still writes the rollup files that were missed", redelivered.accepted === 0 && redelivered.duplicates === results[0].accepted && redelivered.rollupFilesWritten > 0);
  check("crash: the lake then equals the lake of an uninterrupted run", sortedEntries(lakeC) === sortedEntries(lakeB));

  // a restart repairs a rollup file that was lost or is stale
  const lakeD = new MemoryLakeStore();
  const pD = new TelemetryPipeline(lakeD, POPTS);
  for (const [i, b] of BATCHES.entries()) await pD.process(b, `m${i}`);
  const good = sortedEntries(lakeD);
  lakeD.objects.delete("telemetry/rollups_1h/asset=pv-001/dt=2026-11-06/rollup.jsonl");
  lakeD.objects.set("telemetry/rollups_5m/asset=pv-001/dt=2026-11-06/rollup.jsonl", "stale\n");
  const repaired = await TelemetryPipeline.open(lakeD, POPTS);
  check("restart: a deleted rollup file and a stale one are both rewritten when the lake is opened", repaired.rollupFilesRepaired === 2 && sortedEntries(lakeD) === good);

  // two messages at once
  const lakeE = new MemoryLakeStore();
  const pE = new TelemetryPipeline(lakeE, POPTS);
  const same = BATCHES[3];
  const both = await Promise.all([pE.process(same, "x1"), pE.process(same, "x2"), pE.process(same, "x3")]);
  check("concurrency: the same readings arriving in three messages at once are stored once", both.reduce((x, r) => x + r.accepted, 0) === both[0].accepted + 0 && pE.store.count() === both[0].accepted && both[1].accepted === 0 && both[2].accepted === 0);
  const lakeF = new MemoryLakeStore();
  const pF = new TelemetryPipeline(new FlakyLake(lakeF, (_k, n) => n === 1), POPTS);
  const settled = await Promise.allSettled([pF.process(BATCHES[0], "f0"), pF.process(BATCHES[1], "f1")]);
  check("concurrency: a failed batch does not block the next one in the queue", settled[0].status === "rejected" && settled[1].status === "fulfilled");

  // quarantine persistence
  const lakeG = new MemoryLakeStore();
  const pG = new TelemetryPipeline(lakeG, POPTS);
  await pG.process([raw("a", T0, 1), raw("a", T0 + MIN, -1)], "q1");
  const qFiles = (await lakeG.list("telemetry/quarantine/")).length;
  await pG.process([raw("a", T0 + MIN, -1)], "q2");
  check("quarantine: input that is already quarantined is not written to a second file", qFiles === 1 && (await lakeG.list("telemetry/quarantine/")).length === 1);
  const stored = await readQuarantine(lakeG);
  check("quarantine: the file holds the reason, asset, timestamp and the rejected input, under the day of the ingest clock", stored.length === 1 && stored[0].reason === "out_of_range" && stored[0].assetId === "a" && JSON.parse(stored[0].raw).power_kw === -1 && (await lakeG.list("telemetry/quarantine/"))[0].includes("dt=2026-11-07"));
  const flaky2 = new FlakyLake(new MemoryLakeStore(), (key) => key.includes("/quarantine/"));
  const pH = new TelemetryPipeline(flaky2, POPTS);
  check("quarantine: a failed quarantine write rejects the batch and stores none of its readings", (await rejects(() => pH.process([raw("a", T0, 1), raw("a", T0 + MIN, -1)], "q"), /disk full/)) && pH.store.count() === 0);
}

// ================================================================ 8. the worker's message check
{
  check("worker: a body with a readings array passes", parseTelemetryMessage({ readings: [raw("a", T0, 1)] }).length === 1);
  check("worker: a body that is not an object with a readings array is a PermanentError (dead letter, no retry)", [null, [], "x", {}, { readings: "no" }, { readings: {} }].every((p) => { try { parseTelemetryMessage(p); return false; } catch (e) { return e instanceof PermanentError; } }));
  check("worker: a body with more than the limit is a PermanentError", (() => { try { parseTelemetryMessage({ readings: new Array(MAX_READINGS_PER_MESSAGE + 1).fill(0) }); return false; } catch (e) { return e instanceof PermanentError; } })() && parseTelemetryMessage({ readings: new Array(MAX_READINGS_PER_MESSAGE).fill(0) }).length === MAX_READINGS_PER_MESSAGE);
  check("worker: the file name part comes from the message id, the same every time, and is a safe name", batchIdFor("m-1") === batchIdFor("m-1") && batchIdFor("m-1") !== batchIdFor("m-2") && /^[0-9a-f]{24}$/.test(batchIdFor("a/b ../c")));
}

// ================================================================ 9. seeded random worlds against a reference model
interface World {
  batches: unknown[][];
  cfg: StoreConfig;
}
function makeWorld(seed: number): World {
  const rnd = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const assets = ["a", "b", "c"].slice(0, 1 + Math.floor(rnd() * 3));
  const lateness = pick([0, 5 * MIN, 15 * MIN, HOUR]);
  const cfg: StoreConfig = { allowedLatenessMs: lateness, maxFutureMs: 5 * MIN };
  const items: { at: number; raw: unknown }[] = [];
  for (const asset of assets) {
    const start = Math.floor(T0 / HOUR) * HOUR + Math.floor(rnd() * 3) * HOUR + Math.floor(rnd() * 20) * MIN + pick([0, 50 * MIN]); // some cross an hour or midnight
    const step = pick([MIN, 2 * MIN, 30_000]);
    const n = 20 + Math.floor(rnd() * 140);
    let t = start;
    for (let i = 0; i < n; i++) {
      t += step * (rnd() < 0.08 ? 2 + Math.floor(rnd() * 5) : 1);
      const x = raw(asset, t, Math.round(rnd() * 5000) / 1000, rnd() < 0.7 ? { voltage_v: Math.round(rnd() * 6000) / 10 } : {});
      const jitter = rnd() < 0.2 ? rnd() * (lateness * 2 + 10 * MIN) : 0; // delivered behind: some inside the allowed lateness, some past it
      items.push({ at: t + jitter, raw: x });
      if (rnd() < 0.05) items.push({ at: t + jitter + rnd() * 5 * MIN, raw: { ...x } }); // exact repeat
      if (rnd() < 0.04) items.push({ at: t + rnd() * 5 * MIN, raw: { ...x, power_kw: 9.999 } }); // same key, other value
      if (rnd() < 0.03) items.push({ at: t + rnd() * MIN, raw: pick<unknown>([{ ...x, power_kw: -1 }, { ...x, ts: "2026-02-30T00:00:00Z" }, { ...x, extra: 1 }, { ...x, ts: iso(NOW + 10 * HOUR) }, null, [], { ...x, asset_id: "bad id" }, { ...x, temp_c: 500 }]) });
    }
  }
  items.sort((p, q) => p.at - q.at);
  const stream = items.map((i) => i.raw);
  const batches: unknown[][] = [];
  for (let i = 0; i < stream.length; ) {
    const size = 1 + Math.floor(rnd() * 40);
    batches.push(stream.slice(i, i + size));
    i += size;
  }
  return { batches, cfg };
}
interface Oracle {
  stored: Map<string, Map<number, Reading>>;
  accepted: number;
  duplicates: number;
  lateMerged: number;
  reasons: Record<string, number>;
}
function oracle(batches: unknown[][], cfg: StoreConfig): Oracle {
  const o: Oracle = { stored: new Map(), accepted: 0, duplicates: 0, lateMerged: 0, reasons: {} };
  for (const batch of batches) {
    for (const x of batch) {
      const v = validateReading(x, { nowMs: NOW, maxFutureMs: cfg.maxFutureMs });
      if (!v.ok) {
        o.reasons[v.reason] = (o.reasons[v.reason] ?? 0) + 1;
        continue;
      }
      const r = v.reading;
      const m = o.stored.get(r.assetId) ?? new Map<number, Reading>();
      o.stored.set(r.assetId, m);
      const ex = m.get(r.ts);
      if (ex) {
        if (sameValues(ex, r)) o.duplicates++;
        else o.reasons.conflicting_duplicate = (o.reasons.conflicting_duplicate ?? 0) + 1;
        continue;
      }
      const top = m.size ? Math.max(...m.keys()) : -Infinity;
      if (r.ts < top - cfg.allowedLatenessMs) {
        o.reasons.too_late = (o.reasons.too_late ?? 0) + 1;
        continue;
      }
      if (r.ts < top) o.lateMerged++;
      m.set(r.ts, r);
      o.accepted++;
    }
  }
  return o;
}
// The reference for rollups: group the sorted readings, add up by hand, no shared code with rollup.ts.
function oracleRollup(rows: Reading[], resMs: number, gapMs: number): RollupRow[] {
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  const byBucket = new Map<number, number[]>();
  sorted.forEach((r, i) => {
    const b = Math.floor(r.ts / resMs) * resMs;
    byBucket.set(b, [...(byBucket.get(b) ?? []), i]);
  });
  return [...byBucket.entries()].map(([b, idx]) => {
    const row: RollupRow = { asset_id: sorted[0].assetId, bucket_start: iso(b), readings: idx.length };
    for (const ch of ["power_kw", "voltage_v", "temp_c"] as const) {
      const vals = idx.map((i) => sorted[i][ch]).filter((v): v is number => v !== null);
      row[`${ch}_n`] = vals.length;
      row[`${ch}_min`] = vals.length ? Math.min(...vals) : null;
      row[`${ch}_max`] = vals.length ? Math.max(...vals) : null;
      row[`${ch}_mean`] = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
    }
    let e = 0;
    let g = 0;
    for (const i of idx) {
      if (i + 1 >= sorted.length) continue;
      const dt = sorted[i + 1].ts - sorted[i].ts;
      if (dt <= gapMs) e += ((sorted[i].power_kw + sorted[i + 1].power_kw) / 2) * (dt / HOUR);
      else g++;
    }
    row.energy_kwh = e;
    row.gap_segments = g;
    return row;
  });
}
const rowsClose = (a: RollupRow[], b: RollupRow[]) =>
  a.length === b.length &&
  a.every((r, i) => Object.keys(r).length === Object.keys(b[i]).length && Object.entries(r).every(([k, v]) => (typeof v === "number" && typeof b[i][k] === "number" ? near(v, b[i][k] as number, 1e-9) : v === b[i][k])));

interface Outcome {
  problem: string | null;
}
async function runWorld(seed: number, makeStore: (cfg: StoreConfig) => ReadingStore): Promise<Outcome> {
  const w = makeWorld(seed);
  const want = oracle(w.batches, w.cfg);
  const store = makeStore(w.cfg);
  const idx = new RollupIndex(store, { expectedIntervalMs: MIN });
  let acc = 0, dup = 0, late = 0, quarantined = 0;
  const reasons: Record<string, number> = {};
  for (const b of w.batches) {
    const staged = store.stage(b, NOW);
    idx.markInserted(store.apply(staged));
    idx.flush();
    acc += staged.accepted.length;
    dup += staged.duplicates;
    late += staged.lateMerged;
    for (const [k, v] of Object.entries(staged.reasons)) {
      reasons[k] = (reasons[k] ?? 0) + (v ?? 0);
      quarantined += v ?? 0;
    }
    if (staged.received !== staged.accepted.length + staged.duplicates + Object.values(staged.reasons).reduce((x, y) => x + (y ?? 0), 0)) return { problem: `seed ${seed}: a batch does not add up` };
  }
  if (acc !== want.accepted || dup !== want.duplicates || late !== want.lateMerged) return { problem: `seed ${seed}: counts ${acc}/${dup}/${late} vs reference ${want.accepted}/${want.duplicates}/${want.lateMerged}` };
  if (JSON.stringify(Object.entries(reasons).sort()) !== JSON.stringify(Object.entries(want.reasons).sort())) return { problem: `seed ${seed}: reasons ${JSON.stringify(reasons)} vs ${JSON.stringify(want.reasons)}` };
  for (const [asset, m] of want.stored) {
    const s = store.series.get(asset);
    const wantRows = [...m.values()].sort((p, q) => p.ts - q.ts);
    if ((s?.rows.length ?? 0) !== wantRows.length || wantRows.some((r, i) => JSON.stringify(r) !== JSON.stringify(s?.rows[i]))) return { problem: `seed ${seed}: stored readings of ${asset} differ from the reference` };
    if (s && s.ts.some((t, i) => i > 0 && t <= s.ts[i - 1])) return { problem: `seed ${seed}: series of ${asset} is not strictly ascending` };
    if (!wantRows.length) continue;
    for (const res of RESOLUTIONS) {
      if (!rowsClose(idx.rowsFor(asset, res.name), oracleRollup(wantRows, res.ms, MIN * 1.5))) return { problem: `seed ${seed}: ${res.name} rollup of ${asset} differs from the reference` };
    }
    const hours = idx.rowsFor(asset, "1h");
    const fives = idx.rowsFor(asset, "5m");
    for (const h of hours) {
      const sum = fives.filter((f) => Date.parse(f.bucket_start as string) >= Date.parse(h.bucket_start as string) && Date.parse(f.bucket_start as string) < Date.parse(h.bucket_start as string) + HOUR);
      if (!near(h.energy_kwh as number, sum.reduce((x, r) => x + (r.energy_kwh as number), 0), 1e-9)) return { problem: `seed ${seed}: an hour is not the sum of its 5 minute buckets` };
    }
  }
  // replay everything: nothing may change
  const snap = JSON.stringify([...store.series.entries()]) + store.quarantine.size;
  const rowsBefore = JSON.stringify(idx.assets().map((a) => [idx.rowsFor(a, "5m"), idx.rowsFor(a, "1h")]));
  let again = 0;
  for (const b of w.batches) {
    const staged = store.stage(b, NOW);
    again += staged.accepted.length;
    idx.markInserted(store.apply(staged));
    idx.flush();
  }
  if (again !== 0 || JSON.stringify([...store.series.entries()]) + store.quarantine.size !== snap || JSON.stringify(idx.assets().map((a) => [idx.rowsFor(a, "5m"), idx.rowsFor(a, "1h")])) !== rowsBefore) return { problem: `seed ${seed}: replaying the whole stream changed something` };
  // the whole stream as one batch gives the same stored readings
  const one = makeStore(w.cfg);
  const st1 = one.stage(w.batches.flat(), NOW);
  one.apply(st1);
  if (JSON.stringify([...one.series.entries()]) !== JSON.stringify([...(makeStore(w.cfg), (() => { const x = makeStore(w.cfg); for (const b of w.batches) x.apply(x.stage(b, NOW)); return x; })()).series.entries()])) return { problem: `seed ${seed}: one big batch and many small ones store different readings` };
  return { problem: null };
}
{
  const WORLDS = 400;
  let bad: string | null = null;
  for (let seed = 1; seed <= WORLDS && !bad; seed++) bad = (await runWorld(seed, (cfg) => new ReadingStore(cfg))).problem;
  check(`property: ${WORLDS} seeded random worlds (1 to 3 assets, gaps, repeats, conflicting repeats, junk, late and very late data, any batch size) match the reference model and obey every rule`, bad === null, bad ?? "");
  let activity = { late: 0, tooLate: 0, conflicts: 0, junk: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const o = oracle(makeWorld(seed).batches, makeWorld(seed).cfg);
    activity = { late: activity.late + o.lateMerged, tooLate: activity.tooLate + (o.reasons.too_late ?? 0), conflicts: activity.conflicts + (o.reasons.conflicting_duplicate ?? 0), junk: activity.junk + (o.reasons.out_of_range ?? 0) + (o.reasons.invalid_timestamp ?? 0) + (o.reasons.unknown_field ?? 0) };
  }
  check("property: the worlds really contain late merges, too late readings, conflicts and junk (the test exercises the rules)", activity.late > 100 && activity.tooLate > 50 && activity.conflicts > 20 && activity.junk > 20, JSON.stringify(activity));
  // controls: a broken store must turn the property red
  const noLateCheck = (await Promise.all(Array.from({ length: 80 }, (_, i) => runWorld(i + 1, (cfg) => new ReadingStore({ ...cfg, allowedLatenessMs: 1e15 }))))).some((o) => o.problem !== null);
  check("control: a store that never says too late is caught", noLateCheck);
  const doubleLate = (await Promise.all(Array.from({ length: 80 }, (_, i) => runWorld(i + 1, (cfg) => new ReadingStore({ ...cfg, allowedLatenessMs: cfg.allowedLatenessMs * 2 + 1 }))))).some((o) => o.problem !== null);
  check("control: a store whose allowed lateness is wrong is caught", doubleLate);
  class LastWins extends ReadingStore {
    override stage(raws: unknown[], nowMs: number) {
      return super.stage(raws.filter((x) => !(x && typeof x === "object" && (x as any).power_kw === 9.999)), nowMs);
    }
  }
  check("control: a store that drops the conflicting repeat silently, without quarantining it, is caught", (await Promise.all(Array.from({ length: 80 }, (_, i) => runWorld(i + 1, (cfg) => new LastWins(cfg))))).some((o) => o.problem !== null));
  class NoQuarantine extends ReadingStore {
    override stage(raws: unknown[], nowMs: number) {
      const s = super.stage(raws, nowMs);
      return { ...s, reasons: {} };
    }
  }
  check("control: a store that stops counting rejected readings is caught", (await Promise.all(Array.from({ length: 80 }, (_, i) => runWorld(i + 1, (cfg) => new NoQuarantine(cfg))))).some((o) => o.problem !== null));
}

console.log(failed === 0 ? `\nAll ${passed} telemetry logic checks passed` : `\n${failed} of ${passed + failed} telemetry logic check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
