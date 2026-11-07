// LIFESPAN: permanent
// End to end, with no broker: generated solar telemetry for 3 assets over 2 UTC days (planted defects included) goes
// through the pipeline into a local lake folder; then the lake is read back from disk and compared with a recomputation
// written here from the generator's clean readings alone. Also: replay changes no file, a restart rebuilds the same state.
// Run: npm run test:telemetry-e2e
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSolarDay, type SolarDay } from "../src/telemetry/generator.js";
import { FsLakeStore, readQuarantine, readReadings, readRollupDay } from "../src/telemetry/lake.js";
import { TelemetryPipeline, type ProcessResult } from "../src/telemetry/pipeline.js";
import { detectGaps, missingBuckets, type RollupRow } from "../src/telemetry/rollup.js";
import type { Reading } from "../src/telemetry/schema.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
const LATE = 15 * MIN;
const NOW = Date.UTC(2026, 10, 8);
const ASSETS = ["pv-001", "pv-002", "pv-003"];
const DAYS = ["2026-11-06", "2026-11-07"];
const iso = (ms: number) => new Date(ms).toISOString();
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// The reference: rollups from a sorted list of clean readings, by plain loops. Shares no code with src/telemetry/rollup.ts.
function reference(readings: Reading[], resMs: number): RollupRow[] {
  const out = new Map<number, { rows: Reading[]; energy: number; gaps: number }>();
  readings.forEach((r, i) => {
    const key = Math.floor(r.ts / resMs) * resMs;
    const b = out.get(key) ?? { rows: [], energy: 0, gaps: 0 };
    out.set(key, b);
    b.rows.push(r);
    const next = readings[i + 1];
    if (next) {
      const dt = next.ts - r.ts;
      if (dt <= 1.5 * MIN) b.energy += ((r.power_kw + next.power_kw) / 2) * (dt / HOUR);
      else b.gaps++;
    }
  });
  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, b]) => {
      const row: RollupRow = { asset_id: readings[0].assetId, bucket_start: iso(start), readings: b.rows.length };
      for (const ch of ["power_kw", "voltage_v", "temp_c"] as const) {
        const v = b.rows.map((r) => r[ch]).filter((x): x is number => x !== null);
        row[`${ch}_n`] = v.length;
        row[`${ch}_min`] = v.length ? Math.min(...v) : null;
        row[`${ch}_max`] = v.length ? Math.max(...v) : null;
        row[`${ch}_mean`] = v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
      }
      row.energy_kwh = b.energy;
      row.gap_segments = b.gaps;
      return row;
    });
}
const rowsMatch = (a: RollupRow[], b: RollupRow[]) =>
  a.length === b.length && a.every((r, i) => Object.entries(b[i]).every(([k, v]) => (typeof v === "number" && typeof r[k] === "number" ? near(r[k] as number, v) : r[k] === v)) && Object.keys(r).length === Object.keys(b[i]).length);

function fingerprint(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      if (e.isDirectory()) walk(join(d, e.name), `${rel}${e.name}/`);
      else {
        h.update(`${rel}${e.name}\n`);
        h.update(readFileSync(join(d, e.name)));
      }
    }
  };
  walk(dir, "");
  return h.digest("hex");
}
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), `${rel}${e.name}/`);
      else out.push(`${rel}${e.name}`);
    }
  };
  walk(dir, "");
  return out.sort();
}

const dir = mkdtempSync(join(tmpdir(), "telemetry-e2e-"));
try {
  const lake = new FsLakeStore(dir);
  const opts = { expectedIntervalMs: MIN, allowedLatenessMs: LATE, maxFutureMs: 5 * MIN, now: () => NOW };
  const pipe = new TelemetryPipeline(lake, opts);

  // generate: every asset and day, arrival order kept per asset, assets interleaved
  const days = new Map<string, SolarDay>();
  for (const a of ASSETS) for (const d of DAYS) days.set(`${a}|${d}`, generateSolarDay({ assetId: a, day: d, allowedLatenessMs: LATE, seed: 5 }));
  const perAsset = ASSETS.map((a) => DAYS.flatMap((d) => (days.get(`${a}|${d}`) as SolarDay).raw));
  const batches: unknown[][] = [];
  for (let i = 0; ; i += 40) {
    const merged = perAsset.flatMap((s) => s.slice(i, i + 40));
    if (merged.length === 0) break;
    batches.push(merged);
  }
  const results: ProcessResult[] = [];
  for (const [i, b] of batches.entries()) results.push(await pipe.process(b, `batch${i}`));
  const sum = (k: "accepted" | "duplicates" | "lateMerged" | "quarantined" | "received") => results.reduce((x, r) => x + r[k], 0);
  const expectedAccepted = [...days.values()].reduce((x, d) => x + d.expected.accepted, 0);
  const sent = [...days.values()].reduce((x, d) => x + d.raw.length, 0);

  check(`generated ${sent} readings for ${ASSETS.length} assets over ${DAYS.length} days went in, in ${batches.length} batches`, sum("received") === sent);
  check("ingest stored exactly the readings the generator meant to keep", sum("accepted") === expectedAccepted && pipe.store.count() === expectedAccepted, `${sum("accepted")} vs ${expectedAccepted}`);
  check("ingest found the planted defects of every asset-day: 1 duplicate, 1 late merge, 5 quarantined", sum("duplicates") === 6 && sum("lateMerged") === 6 && sum("quarantined") === 30);

  // the lake on disk
  const files = listFiles(dir);
  const readingFiles = files.filter((f) => f.startsWith("telemetry/readings/"));
  const pathOk = readingFiles.every((f) => /^telemetry\/readings\/asset=pv-00[123]\/dt=2026-11-0[67]\/hour=([01]\d|2[0-3])\/part-batch\d+\.jsonl$/.test(f));
  check("lake layout: every reading file is under asset=<id>/dt=YYYY-MM-DD/hour=HH/ and named part-<batch>.jsonl", readingFiles.length > 0 && pathOk, readingFiles.slice(0, 2).join());
  check("lake layout: every line sits in the folder of its own UTC day and hour", readingFiles.every((f) => {
    const [, asset, dt, hour] = /asset=([^/]+)\/dt=([^/]+)\/hour=(\d\d)\//.exec(f) as RegExpExecArray;
    return readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).every((l) => {
      const o = JSON.parse(l);
      return o.asset_id === asset && o.ts.slice(0, 10) === dt && o.ts.slice(11, 13) === hour;
    });
  }));
  check("lake layout: one 5 minute and one hourly rollup file per asset and day, one quarantine file per batch that had rejects, nothing else", files.filter((f) => f.startsWith("telemetry/rollups_5m/")).length === 6 && files.filter((f) => f.startsWith("telemetry/rollups_1h/")).length === 6 && files.every((f) => /^telemetry\/(readings|rollups_5m|rollups_1h|quarantine)\//.test(f)));
  check("lake layout: the hour folders hold hours 00 to 23 for a day with data in every hour", [...new Set(readingFiles.filter((f) => f.includes("asset=pv-001/dt=2026-11-06")).map((f) => f.split("hour=")[1].slice(0, 2)))].length === 24);

  // read back and recompute
  const back = await readReadings(lake);
  let readingsOk = back.length === expectedAccepted;
  for (const a of ASSETS) {
    const want = DAYS.flatMap((d) => (days.get(`${a}|${d}`) as SolarDay).clean).sort((x, y) => x.ts - y.ts);
    const got = back.filter((r) => r.assetId === a).sort((x, y) => x.ts - y.ts);
    readingsOk &&= JSON.stringify(got) === JSON.stringify(want);
  }
  check("read back: the readings in the lake are exactly the clean readings, value for value", readingsOk);
  check("read back: nothing that was quarantined was loaded (no negative power, no 2026-13 timestamp, the conflicting value 9999 is absent)", back.every((r) => r.power_kw >= 0));

  let r5ok = true;
  let r1ok = true;
  let energyOk = true;
  for (const a of ASSETS) {
    const all = DAYS.flatMap((d) => (days.get(`${a}|${d}`) as SolarDay).clean).sort((x, y) => x.ts - y.ts);
    const ref5 = reference(all, 5 * MIN);
    const ref1 = reference(all, HOUR);
    for (const d of DAYS) {
      const got5 = await readRollupDay(lake, "5m", a, d);
      const got1 = await readRollupDay(lake, "1h", a, d);
      r5ok &&= rowsMatch(got5, ref5.filter((r) => (r.bucket_start as string).startsWith(d)));
      r1ok &&= rowsMatch(got1, ref1.filter((r) => (r.bucket_start as string).startsWith(d)));
      const dayEnergy = got1.reduce((x, r) => x + (r.energy_kwh as number), 0);
      const want = ref1.filter((r) => (r.bucket_start as string).startsWith(d)).reduce((x, r) => x + (r.energy_kwh as number), 0);
      energyOk &&= near(dayEnergy, want) && dayEnergy > 20;
    }
  }
  check("read back: every 5 minute rollup file equals the recomputation (min, max, mean, count, energy, gap segments)", r5ok);
  check("read back: every hourly rollup file equals the recomputation", r1ok);
  check("read back: the day's energy per asset is plausible for 5 kW peak solar (over 20 kWh) and equals the recomputation", energyOk);

  const midnight = (await readRollupDay(lake, "1h", "pv-001", "2026-11-06")).at(-1) as RollupRow;
  const lastClean = (days.get("pv-001|2026-11-06") as SolarDay).clean.at(-1) as Reading;
  check("read back: the segment from the last reading of day one to the first of day two is counted in day one's last bucket (hour 23)", midnight.bucket_start === "2026-11-06T23:00:00.000Z" && lastClean.ts === Date.UTC(2026, 10, 6, 23, 59) && near(midnight.energy_kwh as number, reference((days.get("pv-001|2026-11-06") as SolarDay).clean.concat((days.get("pv-001|2026-11-07") as SolarDay).clean), HOUR)[23].energy_kwh as number));

  // gaps are reported, never filled
  let gapsOk = true;
  let rowsInGap = 0;
  let missingOk = true;
  for (const a of ASSETS) {
    for (const [i, d] of DAYS.entries()) {
      const planted = (days.get(`${a}|${d}`) as SolarDay).expected.gaps;
      const fromLake = back.filter((r) => r.assetId === a).sort((x, y) => x.ts - y.ts);
      const day0 = Date.UTC(2026, 10, 6 + i);
      const found = detectGaps(a, { ts: fromLake.map((r) => r.ts), rows: fromLake }, { expectedIntervalMs: MIN }, { fromMs: day0, toMs: day0 + DAY_MS });
      gapsOk &&= JSON.stringify(found) === JSON.stringify(planted);
      const rows5 = await readRollupDay(lake, "5m", a, d);
      const gap = planted[1];
      rowsInGap += rows5.filter((r) => Date.parse(r.bucket_start as string) >= gap.fromMs + MIN && Date.parse(r.bucket_start as string) + 5 * MIN <= gap.toMs).length;
      const missing = missingBuckets(rows5, 5 * MIN, day0, day0 + DAY_MS);
      const have = new Set(fromLake.map((r) => Math.floor(r.ts / (5 * MIN)) * 5 * MIN));
      const expectMissing: number[] = [];
      for (let t = day0; t < day0 + DAY_MS; t += 5 * MIN) if (!have.has(t)) expectMissing.push(t);
      missingOk &&= missing.join() === expectMissing.join() && missing.length === 3;
    }
  }
  check("gaps: detectGaps on the readings read back from the lake finds the planted gaps of every asset-day (a 20 minute hole and one missing reading)", gapsOk);
  check("gaps: no rollup row exists for a 5 minute bucket wholly inside a gap (nothing was filled in)", rowsInGap === 0);
  check("gaps: missingBuckets names the three empty 5 minute buckets of each gap, and only those", missingOk);

  const q = await readQuarantine(lake);
  const byReason: Record<string, number> = {};
  for (const e of q) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  check("quarantine: the lake holds each distinct rejected input once with its reason: 6 too_late, 6 conflicting_duplicate, 6 out_of_range and 9 invalid_timestamp (the 12 bad timestamps were counted, but one asset sent the same impossible time on both days, which is one input)", q.length === 27 && byReason.too_late === 6 && byReason.conflicting_duplicate === 6 && byReason.out_of_range === 6 && byReason.invalid_timestamp === 9, JSON.stringify(byReason));
  check("quarantine: each entry keeps the rejected input as sent", q.filter((e) => e.reason === "out_of_range").every((e) => JSON.parse(e.raw).power_kw === -2.5) && q.filter((e) => e.reason === "invalid_timestamp").some((e) => JSON.parse(e.raw).ts === "2026-13-45T25:61:61Z"));

  // replay and restart
  const print = fingerprint(dir);
  let again = 0;
  for (const [i, b] of batches.entries()) again += (await pipe.process(b, `replay${i}`)).accepted;
  check("replay: sending all the batches again under new ids stores nothing and leaves every file byte for byte the same", again === 0 && fingerprint(dir) === print);
  const reopened = await TelemetryPipeline.open(new FsLakeStore(dir), opts);
  check("restart: a new process opening the folder rebuilds the same readings and repairs no rollup file", reopened.restored === expectedAccepted && reopened.rollupFilesRepaired === 0 && reopened.pipeline.store.quarantine.size === 27);
  let again2 = 0;
  for (const [i, b] of batches.entries()) again2 += (await reopened.pipeline.process(b, `restart${i}`)).accepted;
  check("restart: redelivering everything to the new process counts nothing twice and changes no file", again2 === 0 && fingerprint(dir) === print);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed === 0 ? `\nAll ${passed} telemetry end to end checks passed` : `\n${failed} of ${passed + failed} telemetry end to end check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
